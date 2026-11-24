// 엔진 결과 → AI 기억 갱신용 요약 / 핸드 기록 (UI·시뮬레이터 공용)
import type { HandState } from '../engine/types';
import type { HandSummaryForAi } from '../ai/v1';
import { categoryOf, evaluate } from '../engine/evaluator';
import type { DecisionMemo } from '../ai/v1';
import type { PlayerView } from '../engine/view';

export function summaryFor(h: HandState, seat: number): HandSummaryForAi {
  const me = h.players.find((p) => p.seat === seat)!;
  const r = h.result!;
  const pre = h.actions.filter((a) => a.street === 'preflop' && a.seat === seat);
  const vpip = pre.some((a) => a.type === 'call' || a.type === 'raise' || a.type === 'bet');
  const foldedPreflop = pre.some((a) => a.type === 'fold');
  const riverActs = h.actions.filter((a) => a.street === 'river');
  const shown = r.shown.map((s) => {
    const p = h.players.find((x) => x.seat === s)!;
    const bets = riverActs.filter((a) => a.seat === s && (a.type === 'bet' || a.type === 'raise'));
    return {
      seat: s, hole: [...p.hole], riverBetter: bets.length > 0,
      bigBet: bets.some((a) => a.amount >= 0.6 * (h.snapshots.find((x) => x.street === 'river')?.pot ?? Infinity)),
      won: (r.won[s] ?? 0) > 0,
    };
  });
  let myBluffCaught = false;
  if (r.shown.includes(seat) && h.board.length === 5 && riverActs.some((a) => a.seat === seat && (a.type === 'bet' || a.type === 'raise')) && !(r.won[seat] > 0)) {
    myBluffCaught = categoryOf(evaluate([...me.hole, ...h.board])) <= 1;
  }
  let biggest: number | null = null, big = 0;
  if ((r.won[seat] ?? 0) === 0) for (const [s, v] of Object.entries(r.won)) if (v > big && +s !== seat) { big = v; biggest = +s; }
  return {
    mySeat: seat, startStack: me.startStack, endStack: me.stack, bb: h.level.bb, vpip, foldedPreflop,
    board: [...h.board], shown, myBluffCaught, biggestWinnerAgainstMe: biggest,
  };
}

export interface ActionMemo { actionIndex: number; seat: number; memo: DecisionMemo; view?: PlayerView }

export interface HandRecord {
  handNo: number;
  seed: string;
  level: HandState['level'];
  numSeats: number;
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number;
  players: { seat: number; name: string; startStack: number; endStack: number; hole: number[] }[];
  board: number[];
  actions: HandState['actions'];
  snapshots: HandState['snapshots'];
  result: HandState['result'];
  memos: ActionMemo[];
  /** 내 결정 시점의 AI 기준 (기록만, 화면 표시는 다음 단계) */
  aiBaseline: ActionMemo[];
  voluntaryShown: number[];
  humanSeat: number | null;
  forfeited?: boolean;
}

export function makeHandRecord(h: HandState, memos: ActionMemo[], aiBaseline: ActionMemo[], voluntaryShown: number[], humanSeat: number | null): HandRecord {
  return {
    handNo: h.handNo, seed: h.seed, level: { ...h.level }, numSeats: h.numSeats,
    buttonSeat: h.buttonSeat, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
    players: h.players.map((p) => ({ seat: p.seat, name: p.name, startStack: p.startStack, endStack: p.stack, hole: [...p.hole] })),
    board: [...h.board], actions: h.actions.map((a) => ({ ...a })), snapshots: h.snapshots, result: h.result,
    memos, aiBaseline, voluntaryShown, humanSeat,
  };
}
