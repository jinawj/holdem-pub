// 사람이(또는 리뷰 에이전트가) 읽을 수 있는 핸드 기록 만들기: AI끼리 치게 하고 각 결정의 "생각"을 함께 출력
// 실행: npx tsx scripts/ai-review.ts [--hands 40] [--stack 200] [--seed 1] [--out reports/review-hands.md]
import { writeFileSync, mkdirSync } from 'node:fs';
import { decide, makeProfile, newMemory, PERSONAS, PERSONA_IDS, profileLabel } from '../src/ai/v2';
import type { AiProfile, PersonaId } from '../src/ai/v2';
import { cardToString } from '../src/engine/cards';
import { actionLabel, startHand } from '../src/engine/hand';
import { seedToString, seedFromNumber } from '../src/engine/rng';
import type { Street } from '../src/engine/types';
import { makePlayerView } from '../src/engine/view';
import { runHand } from '../src/game/headless';
import { arg, makeRng } from './lib';

const want = +arg('hands', '40');
const stackBB = +arg('stack', '200');
const seed = +arg('seed', '1');
const out = arg('out', 'reports/review-hands.md');
const BB = 200;
const R = makeRng(seed);
const N = 6;

// 테이블: 성향 섞어서 (사람다운지 보려면 다양하게), 레벨은 성향 범위 안 무작위
//  --tier low  : 하수 테이블 (각 성향의 가장 낮은 레벨)
//  --tier high : 고수 테이블 (솔버·레귤러·공격수 Lv9–10 + 바위 Lv7)
const tier = arg('tier', 'mix');
const TIER_IDS: Record<string, PersonaId[]> = {
  low: ['station', 'beginner', 'maniac', 'station', 'beginner', 'nit'],
  high: ['solver', 'reg', 'lag', 'reg', 'lag', 'nit'],
};
const profiles: AiProfile[] = Array.from({ length: N }, (_, i) => {
  const id = tier in TIER_IDS ? TIER_IDS[tier][i] : (['reg', 'lag', 'solver', 'station', 'nit', 'beginner', 'maniac'] as PersonaId[])[(i + seed) % 7] ?? PERSONA_IDS[i];
  const [lo, hi] = PERSONAS[id].lv;
  const lv = tier === 'low' ? lo + R.int(Math.min(2, hi - lo + 1)) : tier === 'high' ? (id === 'nit' ? hi : Math.max(lo, 9) + R.int(2)) : lo + R.int(hi - lo + 1);
  return makeProfile(id, Math.min(hi, lv), R.rand);
});

const lines: string[] = [`# AI 핸드 리뷰 (${stackBB}BB, ${N}인, 블라인드 ${BB / 2}/${BB})`, '', '좌석: ' + profiles.map((p, i) => `P${i}=${profileLabel(p)}${p.leaks.length ? `(릭: ${p.leaks.map((l) => l.id).join('·')})` : ''}`).join(', '), ''];
let written = 0;
for (let k = 0; written < want && k < want * 6; k++) {
  const button = k % N;
  const h = startHand({
    handNo: k + 1, seed: seedToString(seedFromNumber(seed * 100000 + k)), level: { level: 1, sb: BB / 2, bb: BB, ante: 0 }, numSeats: N,
    buttonSeat: button, sbSeat: (button + 1) % N, bbSeat: (button + 2) % N,
    players: Array.from({ length: N }, (_, s) => ({ seat: s, name: 'P' + s, stack: stackBB * BB })),
  });
  const thoughts: Record<number, string> = {};
  const chosen: Record<number, string> = {};
  const mems = profiles.map(() => newMemory());
  runHand(h, (hs, seat) => {
    const idx = hs.actions.length;
    const d = decide(makePlayerView(hs, seat, N), profiles[seat], mems[seat], { rand: R.rand, quick: true });
    const opts = d.memo.options.filter((o) => o.p >= 0.01).map((o) => `${o.key.replace('raise:', '레이즈')} ${Math.round(o.p * 100)}%`).join(' / ');
    chosen[idx] = d.type;
    const leaks = profiles[seat].leaks.map((l) => l.id);
    const habitTxt = d.memo.habit ? d.memo.habit.split(',').map((x) => (leaks.includes(x) ? `릭:${x}` : `습관:${x}`)).join(',') : '';
    thoughts[idx] = `${d.memo.note ?? ''}${habitTxt ? ` [${habitTxt}]` : ''}${d.memo.clear ? ` [${d.memo.clear}]` : ''} {${opts}}`;
    return d;
  }, null, N);
  // 플랍까지 간 핸드만 (포스트플랍 판단을 보기 위해)
  if (!h.actions.some((a) => a.street === 'flop')) continue;
  written++;
  lines.push(`## 핸드 ${written} (버튼 P${button})`);
  lines.push('카드: ' + h.players.map((p) => `P${p.seat}[${p.hole.map(cardToString).join(' ')}]`).join(' '));
  const boardAt: Record<Street, string> = {
    preflop: '', flop: h.board.slice(0, 3).map(cardToString).join(' '), turn: h.board.slice(0, 4).map(cardToString).join(' '), river: h.board.map(cardToString).join(' '),
  };
  let cur: Street | '' = '';
  h.actions.forEach((a, i) => {
    if (a.type === 'ante' || a.type === 'sb' || a.type === 'bb') return;
    if (a.street !== cur) { cur = a.street; lines.push(`- **${{ preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' }[a.street]}** ${boardAt[a.street]}`); }
    const typ = a.type === 'bet' ? 'raise' : a.type;
    const bad = chosen[i] && chosen[i] !== typ ? ` ⚠불일치(AI 선택 ${chosen[i]})` : '';
    lines.push(`  - P${a.seat}(${PERSONAS[profiles[a.seat].personaId].name}Lv${profiles[a.seat].level}) ${actionLabel(a)}${bad} — ${thoughts[i] ?? ''}`);
  });
  const r = h.result!;
  lines.push(`- 결과: ${Object.entries(r.won).map(([s, v]) => `P${s} +${v}`).join(', ')}${r.uncontested ? ' (모두 폴드)' : ' (쇼다운 ' + r.shown.map((s) => `P${s}`).join(',') + ')'}`);
  lines.push('');
}
mkdirSync('reports', { recursive: true });
writeFileSync(out, lines.join('\n'));
console.log(`${written}핸드 → ${out}`);
