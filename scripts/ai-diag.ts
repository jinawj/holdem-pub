// v3 진단: 헤즈업에서 v3가 어떤 상황에서 칩을 잃고 따는지 (행동별 빈도·결과)
// 실행: npx tsx scripts/ai-diag.ts --level 10 --pairs 3000 [--opp v2|v3:5]
import * as V2 from '../src/ai/v2';
import * as V3 from '../src/ai/v3';
import { startHand } from '../src/engine/hand';
import { seedFromNumber, seedToString } from '../src/engine/rng';
import { makePlayerView } from '../src/engine/view';
import { runHand } from '../src/game/headless';
import { cardToString } from '../src/engine/cards';
import { arg, makeRng, table } from './lib';

const level = +arg('level', '10'), pairs = +arg('pairs', '3000'), opp = arg('opp', 'v2');
const BB = 200, stack = +arg('stack', '100'), anteBB = +arg('ante', '0');
const R = makeRng(3);
const cnt: Record<string, { n: number; net: number }> = {};
const add = (k: string, net: number) => { const c = (cnt[k] ??= { n: 0, net: 0 }); c.n++; c.net += net; };
const freq: Record<string, number> = {};
const worst: any[] = [];
for (let i = 0; i < pairs; i++) {
  const seed = seedToString(seedFromNumber(900000 + i));
  for (const swap of [false, true]) {
    const p3 = V3.makeProfileV3(level), m3 = V3.newMemoryV3();
    const oppDec = opp === 'v2'
      ? (() => { const id: V2.PersonaId = level >= 10 ? 'solver' : 'reg'; const pr = V2.makeProfile(id, level, R.rand), m = V2.newMemory(); return (v: any) => V2.decide(v, pr, m, { rand: R.rand, quick: true }); })()
      : (() => { const pr = V3.makeProfileV3(+opp.split(':')[1]), m = V3.newMemoryV3(); return (v: any) => V3.decide(v, pr, m, { rand: R.rand, quick: true }); })();
    const me = swap ? 1 : 0;
    const h = startHand({ handNo: i * 2 + (swap ? 1 : 0) + 1, seed, level: { level: 1, sb: BB / 2, bb: BB, ante: anteBB * BB }, numSeats: 2, buttonSeat: 0, sbSeat: 0, bbSeat: 1, players: [0, 1].map((s) => ({ seat: s, name: 'P' + s, stack: stack * BB })) });
    let last = ''; let lastMemo: any = null; const trail: string[] = [];
    runHand(h, (hs, seat) => {
      const v = makePlayerView(hs, seat, 2);
      if (seat !== me) return oppDec(v);
      const d = V3.decide(v, p3, m3, { rand: R.rand, quick: true });
      const situ = `${hs.street} ${v.legal.callAmount > 0 ? '벳받음' : '먼저'}`;
      const k = `${situ}:${d.type}`;
      freq[k] = (freq[k] ?? 0) + 1;
      last = `${situ} ${d.type}${d.memo.brain ? '(' + d.memo.brain + ')' : ''}`; lastMemo = d.memo; trail.push(`${hs.street} [${v.board.map(cardToString).join(' ')}] ${v.holeCards.map(cardToString).join('')} → ${d.type}${d.to ? ' ' + (d.to / BB).toFixed(1) : ''} | ${(d.memo.thoughts ?? []).slice(-2).join(' / ')}`);
      return d;
    }, null, 2);
    const p = h.players.find((x) => x.seat === me)!;
    const net = (p.stack - p.startStack) / BB;
    const end = p.folded ? `내가 폴드: ${last}` : h.result?.uncontested ? `상대 폴드: ${last}` : `쇼다운: ${last}`;
    add(end, net); if (net <= -60) worst.push({ net, end, trail: [...trail], opp: h.players.find((x) => x.seat !== me)!.hole.map(cardToString).join(''), acts: h.actions.filter((a) => a.type !== 'sb' && a.type !== 'bb').map((a) => (a.seat === me ? 'H:' : 'V:') + a.type[0] + (a.amount ? Math.round(a.amount / BB) : '')).join(' ') }); add(`${me === 0 ? 'SB(버튼)' : 'BB'}`, net);
  }
}
const rows = Object.entries(cnt).sort((a, b) => a[1].net - b[1].net).map(([k, c]) => [k, c.n, c.net, (c.net / c.n)]);
console.log(table(rows, ['끝난 방식: 마지막 내 행동', '횟수', '합계BB', '평균BB']));
const fr: Record<string, Record<string, number>> = {};
for (const [k, n] of Object.entries(freq)) { const [s, a] = k.split(':'); (fr[s] ??= {})[a] = n; }
console.log(table(Object.entries(fr).map(([s, m]) => { const t = Object.values(m).reduce((a, b) => a + b, 0); return [s, t, ...['fold', 'check', 'call', 'raise'].map((a) => ((100 * (m[a] ?? 0)) / t).toFixed(0) + '%')]; }), ['상황', 'n', 'fold', 'check', 'call', 'raise']));

if (process.argv.includes('--worst')) for (const w of worst.slice(0, +arg('nworst', '12'))) { console.log('\n### ' + w.net.toFixed(0) + 'BB ' + w.end + ' (상대 ' + w.opp + ') ' + w.acts); for (const t of w.trail) console.log('  ' + t); }
