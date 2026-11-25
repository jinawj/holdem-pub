// 포스트플랍 습관 점검: C벳률, 동크율, C벳에 폴드율, 리버 큰 벳에 콜률 (성향별, v1과 비교)
// 실행: npx tsx scripts/ai-postflop-report.ts [--hands 800] [--stack 200] [--v 1]
import * as V2 from '../src/ai/v2';
import * as V1 from '../src/ai/v1';
import { startHand } from '../src/engine/hand';
import { seedToString, seedFromNumber } from '../src/engine/rng';
import { makePlayerView } from '../src/engine/view';
import { runHand } from '../src/game/headless';
import { arg, makeRng, table } from './lib';

const hands = +arg('hands', '800');
const stackBB = +arg('stack', '200');
const AI: any = arg('v', '2') === '1' ? V1 : V2;
const R = makeRng(11);
const BB = 200, N = 6;
const ids = ['solver', 'reg', 'lag', 'nit', 'station', 'beginner'];
type C = { cbOpp: number; cb: number; donkOpp: number; donk: number; facedCb: number; foldCb: number; rivBig: number; rivCall: number };
const acc: Record<string, C> = {};
const get = (id: string) => (acc[id] ??= { cbOpp: 0, cb: 0, donkOpp: 0, donk: 0, facedCb: 0, foldCb: 0, rivBig: 0, rivCall: 0 });

for (let k = 0; k < hands; k++) {
  const profs = Array.from({ length: N }, (_, i) => { const id = ids[(i + k) % ids.length]; const [lo, hi] = AI.PERSONAS[id].lv; return AI.makeProfile(id, Math.max(lo, Math.min(hi, 7)), R.rand); });
  const button = k % N;
  const h = startHand({
    handNo: k + 1, seed: seedToString(seedFromNumber(424242 + k)), level: { level: 1, sb: BB / 2, bb: BB, ante: 0 }, numSeats: N,
    buttonSeat: button, sbSeat: (button + 1) % N, bbSeat: (button + 2) % N,
    players: Array.from({ length: N }, (_, s) => ({ seat: s, name: 'P' + s, stack: stackBB * BB })),
  });
  const mems = profs.map(() => AI.newMemory());
  runHand(h, (hs, seat) => AI.decide(makePlayerView(hs, seat, N), profs[seat], mems[seat], { rand: R.rand, quick: true }), null, N);
  const pre = h.actions.filter((a) => a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet'));
  const pfa = pre.length ? pre[pre.length - 1].seat : -1;
  const flop = h.actions.filter((a) => a.street === 'flop');
  if (pfa >= 0 && flop.length) {
    // 레이저보다 먼저 행동한 사람: 동크 기회 / 동크
    const pfaIdx = flop.findIndex((a) => a.seat === pfa);
    let betSeen = false;
    for (let i = 0; i < flop.length; i++) {
      const a = flop[i];
      if (a.seat !== pfa && (pfaIdx < 0 || i < pfaIdx) && !betSeen) {
        const c = get(profs[a.seat].personaId); c.donkOpp++; if (a.type === 'bet') c.donk++;
      }
      if (a.type === 'bet' || a.type === 'raise') betSeen = true;
    }
    // 레이저의 C벳 기회 (앞에서 아무도 벳 안 함)
    if (pfaIdx >= 0 && !flop.slice(0, pfaIdx).some((a) => a.type === 'bet')) {
      const c = get(profs[pfa].personaId); c.cbOpp++;
      if (flop[pfaIdx].type === 'bet') {
        c.cb++;
        // C벳 받은 사람들의 반응 (첫 반응만)
        const seen = new Set<number>();
        for (const a of flop.slice(pfaIdx + 1)) {
          if (a.seat === pfa || seen.has(a.seat)) continue;
          seen.add(a.seat);
          const d = get(profs[a.seat].personaId); d.facedCb++; if (a.type === 'fold') d.foldCb++;
        }
      }
    }
  }
  // 리버 큰 벳(팟 75% 이상)에 대한 첫 반응
  const riv = h.actions.filter((a) => a.street === 'river');
  const potBeforeRiver = h.actions.filter((a) => a.street !== 'river').reduce((x, a) => x + a.amount, 0);
  let bigBettor = -1, running = potBeforeRiver;
  for (const a of riv) {
    if (bigBettor < 0 && a.type === 'bet' && a.amount >= 0.75 * running) { bigBettor = a.seat; }
    else if (bigBettor >= 0 && a.seat !== bigBettor && (a.type === 'call' || a.type === 'fold' || a.type === 'raise')) {
      const d = get(profs[a.seat].personaId); d.rivBig++; if (a.type !== 'fold') d.rivCall++;
    }
    running += a.amount;
  }
}
const pc = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}% (${b})` : '-');
console.log(`포스트플랍 습관 (${arg('v', '2') === '1' ? 'v1' : 'v2'}, ${stackBB}BB, ${hands}핸드, 레벨 7 근처)`);
console.log(table(ids.map((id) => { const c = get(id); return [AI.PERSONAS[id].name, pc(c.cb, c.cbOpp), pc(c.donk, c.donkOpp), pc(c.foldCb, c.facedCb), pc(c.rivCall, c.rivBig)]; }),
  ['성향', 'C벳률', '동크율', 'C벳에 폴드', '리버 큰 벳에 콜']));
