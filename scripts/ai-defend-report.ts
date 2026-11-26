// 오픈 레이즈 수비 점검 (10인 등): 첫 오픈 레이즈가 나온 뒤 각 자리가 계속(콜·3벳)하는 비율, 오픈이 그냥 이기는 비율
// 실행: npx tsx scripts/ai-defend-report.ts --ai v3 --level 8 --seats 10 --hands 3000 [--stack 100]
//       npx tsx scripts/ai-defend-report.ts --ai v2 --diff hard
import * as V2 from '../src/ai/v2';
import * as V3 from '../src/ai/v3';
import type { Difficulty } from '../src/config';
import { applyMove, legalActions, startHand } from '../src/engine/hand';
import { makePlayerView } from '../src/engine/view';
import { toMove } from '../src/game/headless';
import { arg, makeRng, table } from './lib';

const ai = arg('ai', 'v3'), n = +arg('seats', '10'), hands = +arg('hands', '3000'), stackBB = +arg('stack', '100');
const level = +arg('level', '8');
const BB = 200;
const R = makeRng(17);
let deciders: ((v: any) => any)[];
let label: string;
if (ai === 'v2') {
  const profs = V2.createAiProfiles(arg('diff', 'hard') as Difficulty, n, R.rand);
  const mems = profs.map(() => V2.newMemory());
  deciders = profs.map((p, i) => (v: any) => V2.decide(v, p, mems[i], { rand: R.rand, quick: true }));
  label = `v2 (${arg('diff', 'hard')}: ${profs.map((p) => V2.profileLabel(p)).join(', ')})`;
} else {
  const lvls = arg('levels', '') ? arg('levels', '').split(',').map(Number) : Array(n).fill(level);
  const profs = lvls.map((l: number) => V3.makeProfileV3(l));
  const mems = profs.map(() => V3.newMemoryV3());
  deciders = profs.map((p, i) => (v: any) => V3.decide(v, p, mems[i], { rand: R.rand, quick: true }));
  label = `v3 Lv${lvls.join(',')}`;
}
// 오픈 자리(뒤에 남은 사람 수)별: 오픈 수, 아무도 안 따라옴, 콜러 수 합, 3벳 수
const byOpen: Record<string, { opens: number; uncontested: number; callers: number; threeBets: number }> = {};
// 수비 자리별: 기회 수, 콜, 3벳 (첫 오픈에 처음 행동할 때만, 앞에 콜러가 없을 때)
const byDef: Record<string, { n: number; call: number; raise: number }> = {};
const posName = (behind: number, isSB: boolean, isBB: boolean) => (isBB ? 'BB' : isSB ? 'SB' : behind === 2 ? 'BTN' : behind === 3 ? 'CO' : behind === 4 ? 'HJ' : `앞자리(뒤 ${behind - 2})`);
for (let k = 0; k < hands; k++) {
  const btn = k % n;
  const h = startHand({
    handNo: k + 1, seed: R.seedStr(), level: { level: 1, sb: BB / 2, bb: BB, ante: 0 }, numSeats: n,
    buttonSeat: btn, sbSeat: (btn + 1) % n, bbSeat: (btn + 2) % n,
    players: Array.from({ length: n }, (_, s) => ({ seat: s, name: 'P' + s, stack: stackBB * BB })),
  });
  let opener: number | null = null, openKey = '';
  let threeBet = false, callers = 0;
  const seen = new Set<number>();
  while (h.street === 'preflop') {
    const L = legalActions(h)!;
    const seat = L.seat;
    const v = makePlayerView(h, seat, n);
    const d = deciders[seat](v);
    // 뒤에 남은 사람 수(프리플랍 순서 기준)
    const order: number[] = [];
    for (let i = 1; i <= n; i++) order.push((h.bbSeat + i) % n);
    const behind = order.length - 1 - order.indexOf(seat);
    const pos = posName(behind, seat === h.sbSeat, seat === h.bbSeat);
    if (opener === null) {
      if (d.type === 'raise') { opener = seat; openKey = pos; }
    } else if (!seen.has(seat) && !threeBet && seat !== opener) {
      seen.add(seat);
      if (callers === 0) {
        const b = (byDef[pos] ??= { n: 0, call: 0, raise: 0 });
        b.n++;
        if (d.type === 'call') b.call++;
        if (d.type === 'raise') b.raise++;
      }
      if (d.type === 'call') callers++;
      if (d.type === 'raise') threeBet = true;
    }
    applyMove(h, toMove(d));
    if (opener !== null && seat === opener && seen.size > 0 && h.street === 'preflop' && d.type !== 'raise') break;
  }
  if (opener !== null) {
    const o = (byOpen[openKey] ??= { opens: 0, uncontested: 0, callers: 0, threeBets: 0 });
    o.opens++;
    if (!threeBet && callers === 0) o.uncontested++;
    o.callers += callers;
    if (threeBet) o.threeBets++;
  }
}
const order = ['앞자리(뒤 7)', '앞자리(뒤 6)', '앞자리(뒤 5)', '앞자리(뒤 4)', '앞자리(뒤 3)', '앞자리(뒤 2)', '앞자리(뒤 1)', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
console.log(`=== 오픈 수비 점검: ${label}, ${n}인 ${stackBB}BB, ${hands}핸드 ===`);
console.log('\n오픈 자리별 결과');
console.log(table(order.filter((k) => byOpen[k]).map((k) => { const o = byOpen[k]; return [k, o.opens, pct(o.uncontested, o.opens), (o.callers / o.opens).toFixed(2), pct(o.threeBets, o.opens)]; }), ['오픈 자리', '오픈 수', '아무도 안 따라옴', '평균 콜러', '3벳 받음']));
console.log('\n수비 자리별 (첫 오픈에 앞 콜러 없이 처음 행동할 때)');
console.log(table(order.filter((k) => byDef[k]).map((k) => { const b = byDef[k]; return [k, b.n, pct(b.call, b.n), pct(b.raise, b.n), pct(b.call + b.raise, b.n)]; }), ['수비 자리', '기회', '콜', '3벳', '계속 합계']));
