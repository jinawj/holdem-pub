// 명확한 자리 정답률 + 압박 강도 점검 (v2 마일스톤 6)
//  - 짧게 쳐 봤을 때 "맞는 행동이 얼마나 자주 나오나"를 칩 대신 결정 단위로 잰다
//  - 명확한 자리 판별은 src/ai/v2/clarity.ts (족보·가격 같은 객관 사실로만)
//  - 틀린 행동 중 릭(이름 붙은 구멍)이 발동한 것은 '의도된 구멍'으로 따로 셈
// 실행: npx tsx scripts/ai-clarity-report.ts [--hands 1500] [--stack 100] [--v 1] [--examples 1]
import * as V2 from '../src/ai/v2';
import * as V1 from '../src/ai/v1';
import { buildContext } from '../src/ai/v2/context';
import { judgeClear, judgeLean } from '../src/ai/v2/clarity';
import { startHand } from '../src/engine/hand';
import { seedToString, seedFromNumber } from '../src/engine/rng';
import { makePlayerView } from '../src/engine/view';
import { runHand } from '../src/game/headless';
import { arg, makeRng, table } from './lib';

const hands = +arg('hands', '1500');
const stackBB = +arg('stack', '100');
const ver = arg('v', '2');
const showEx = arg('examples', '0') === '1';
const AI: any = ver === '1' ? V1 : V2;
const R = makeRng(7);
const BB = 200, N = 6;
const ids = ['solver', 'reg', 'lag', 'nit', 'station', 'beginner', 'maniac'];
const tier = (lv: number) => (lv <= 3 ? 'Lv1-3' : lv <= 6 ? 'Lv4-6' : 'Lv7-10');

type Acc = { clear: number; ok: number; leak: number; bad: number; post: number; aggr: number; decisions: number; lean: number; leanDone: number };
const byTier: Record<string, Acc> = {};
const bySpot: Record<string, { n: number; bad: number; leak: number }> = {};
const examples: string[] = [];
const get = (k: string) => (byTier[k] ??= { clear: 0, ok: 0, leak: 0, bad: 0, post: 0, aggr: 0, decisions: 0, lean: 0, leanDone: 0 });

for (let k = 0; k < hands; k++) {
  const profs = Array.from({ length: N }, (_, i) => {
    const id = ids[(i * 3 + k) % ids.length];
    const [lo, hi] = AI.PERSONAS[id].lv;
    const lv = lo + Math.floor(R.rand() * (hi - lo + 1));
    return AI.makeProfile(id, lv, R.rand);
  });
  const button = k % N;
  const h = startHand({
    handNo: k + 1, seed: seedToString(seedFromNumber(777000 + k)), level: { level: 1, sb: BB / 2, bb: BB, ante: 0 }, numSeats: N,
    buttonSeat: button, sbSeat: (button + 1) % N, bbSeat: (button + 2) % N,
    players: Array.from({ length: N }, (_, s) => ({ seat: s, name: 'P' + s, stack: stackBB * BB })),
  });
  const mems = profs.map(() => AI.newMemory());
  runHand(h, (hs, seat) => {
    const view = makePlayerView(hs, seat, N);
    const d = AI.decide(view, profs[seat], mems[seat], { rand: R.rand, quick: true });
    const pr = profs[seat];
    const a = get(tier(pr.level));
    a.decisions++;
    if (view.street !== 'preflop') { a.post++; if (d.type === 'raise') a.aggr++; }
    const ctx = buildContext(view);
    const c = judgeClear(ctx);
    const ln = c ? null : judgeLean(ctx, AI.PERSONAS[pr.personaId].fish);
    if (ln) {
      a.lean++; if (d.type === ln.act) a.leanDone++;
      const s = (bySpot['(압박) ' + ln.id] ??= { n: 0, bad: 0, leak: 0 }); s.n++; if (d.type !== ln.act) s.bad++;
    }
    if (c) {
      a.clear++;
      const s = (bySpot[c.id] ??= { n: 0, bad: 0, leak: 0 });
      s.n++;
      const act = d.type === 'call' && view.legal.canCheck ? 'check' : d.type;
      if (c.ok.includes(act)) a.ok++;
      else {
        const leakIds: string[] = (pr.leaks ?? []).map((l: { id: string }) => l.id);
        const firedLeak = (d.memo.habit ?? '').split(',').some((x: string) => leakIds.includes(x));
        if (firedLeak) { a.leak++; s.leak++; }
        else {
          a.bad++; s.bad++;
          if (showEx && examples.length < 25) examples.push(`${AI.PERSONAS[pr.personaId].name} Lv${pr.level} [${c.id}] ${view.street} ${ctx.key} 보드 ${view.board.length}장 → ${d.type}  (${d.memo.note ?? ''})`);
        }
      }
    }
    return d;
  }, null, N);
}

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
console.log(`명확한 자리 점검 (${ver === '1' ? 'v1' : 'v2'}, 6인 ${stackBB}BB, ${hands}핸드, 레벨 무작위)`);
console.log(table(['Lv1-3', 'Lv4-6', 'Lv7-10'].map((t) => {
  const a = get(t);
  return [t, String(a.decisions), pc(a.clear, a.decisions), pc(a.ok, a.clear), pc(a.leak, a.clear), pc(a.bad, a.clear), `${pc(a.leanDone, a.lean)} (${a.lean})`, pc(a.aggr, a.post)];
}), ['레벨', '결정 수', '명확한 자리 비율', '정답률', '의도된 구멍', '실수', '압박 자리 실행', '포스트플랍 벳·레이즈']));
console.log('\n자리별');
console.log(table(Object.entries(bySpot).sort((x, y) => y[1].n - x[1].n).map(([id, s]) => [id, String(s.n), pc(s.bad, s.n), pc(s.leak, s.n)]),
  ['자리', '횟수', '실수 (압박 자리는 안 한 비율)', '의도된 구멍']));
if (showEx) { console.log('\n실수 예시'); examples.forEach((e) => console.log(' - ' + e)); }
