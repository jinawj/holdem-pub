// AI 시험지 (overview 3.14 ①). 실행: npm run ai:spots [-- --trials 150]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decide, makeProfile, newMemory, PERSONAS, PERSONA_IDS } from '../src/ai/v1';
import type { PersonaId } from '../src/ai/v1';
import { makePlayerView } from '../src/engine/view';
import { buildSpot, SpotDef } from '../src/game/spot';
import { arg, makeRng } from './lib';

const trials = +arg('trials', '150');
const spots: SpotDef[] = JSON.parse(readFileSync(new URL('../tests/ai-spots/spots.json', import.meta.url), 'utf8'));
const R = makeRng(12345);

type Who = { id: PersonaId; lv: number };
const defaultWho: Who[] = [{ id: 'solver', lv: 10 }, { id: 'reg', lv: 9 }];
const allWho: Who[] = PERSONA_IDS.flatMap((id) => [{ id, lv: PERSONAS[id].lv[0] }, { id, lv: PERSONAS[id].lv[1] }]);

let pass = 0, total = 0, coreFail = 0;
const failures: string[] = [];
const results: any[] = [];
for (const s of spots) {
  const who = s.personas === 'all' ? allWho : s.personas ? s.personas.map((id) => ({ id: id as PersonaId, lv: PERSONAS[id as PersonaId].lv[1] })) : defaultWho;
  for (const w of who) {
    const hands = s.heroHands ?? [s.heroHand!];
    const cnt = { fold: 0, check: 0, call: 0, raise: 0 };
    let bets = 0, smallBets = 0, n = 0;
    for (const hh of hands) {
      const h = buildSpot(s, hh);
      const view = makePlayerView(h, s.hero, h.players.length);
      const per = Math.max(20, Math.round(trials / hands.length));
      for (let t = 0; t < per; t++) {
        const prof = makeProfile(w.id, w.lv, R.rand);
        const d = decide(view, prof, newMemory(), { rand: R.rand, quick: true });
        cnt[d.type]++; n++;
        if (d.type === 'raise') {
          bets++;
          if ((d.to! - view.legal.committed) <= 0.45 * view.potTotal) smallBets++;
        }
      }
    }
    const fr = { fold: cnt.fold / n, check: cnt.check / n, call: cnt.call / n, raise: cnt.raise / n, continue: (cnt.call + cnt.raise) / n, smallBetShare: bets ? smallBets / bets : 1 };
    const bad: string[] = [];
    for (const [k, [lo, hi]] of Object.entries(s.expect) as [keyof typeof fr, [number, number]][]) {
      const v = fr[k];
      if (v < lo - 1e-9 || v > hi + 1e-9) bad.push(`${k}=${(v * 100).toFixed(0)}% (기대 ${lo * 100}–${hi * 100}%)`);
    }
    total++;
    const label = `${s.id} [${PERSONAS[w.id].name} Lv${w.lv}]`;
    if (bad.length === 0) pass++;
    else {
      failures.push(`${label}: ${s.desc} → ${bad.join(', ')}`);
      if (w.id === 'solver' || w.id === 'reg') coreFail++;
    }
    results.push({ spot: s.id, persona: w.id, level: w.lv, freq: fr, ok: bad.length === 0 });
  }
}
console.log(`\n=== AI 시험지: 문항 ${spots.length}개, 채점 ${total}건 ===`);
console.log(`통과율: ${pass}/${total} (${((100 * pass) / total).toFixed(1)}%)`);
console.log(`솔버·레귤러 미통과: ${coreFail}건`);
if (failures.length) { console.log('\n미통과 목록:'); for (const f of failures) console.log(' - ' + f); }
mkdirSync('reports', { recursive: true });
writeFileSync('reports/ai-spots-latest.json', JSON.stringify({ pass, total, coreFail, failures, results }, null, 2));
process.exit(coreFail === 0 ? 0 : 1);
