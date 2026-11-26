// 상황 정보(누구나 보는 사실): 팟·스택·SPR·포지션·보드 텍스처·내 족보. 해석은 concepts.ts가 한다
import { handKey, rankOf, suitOf } from '../../engine/cards';
import { categoryOf, evaluate } from '../../engine/evaluator';
import type { PlayerView } from '../../engine/view';
import { drawInfo } from '../core/equity';
import { handPct } from '../core/handrank';

export interface Ctx {
  view: PlayerView;
  bb: number;
  pot: number;
  toCall: number;
  effStack: number; // 남은 유효 스택 (칩)
  effBB: number; // 핸드 시작 기준 유효 스택 (BB)
  spr: number;
  street: PlayerView['street'];
  oppSeats: number[]; // 폴드 안 한 상대
  activeOpp: number[]; // 아직 행동 가능한 상대 (올인 제외)
  numOpp: number;
  ip: boolean; // 포스트플랍 마지막 행동자
  postOrder: number[]; // 포스트플랍 행동 순서 (살아 있는 좌석)
  behind: number; // 프리플랍: 내 뒤에 남은 사람 수
  raisesPre: number;
  lastPreRaiser: number | null;
  facingBet: boolean;
  key: string;
  pct: number;
  madeCat: number; // 내 카드가 관여한 족보 (보드만으로 된 족보면 0)
  boardPlays: boolean; // 리버 보드 5장이 그대로 내 최고 패
  flushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  wet: number; // 0..1
  paired: boolean;
  potOdds: number;
  betFrac: number; // 받은 벳 / 벳 전 팟
}

export function preflopOrder(view: PlayerView): number[] {
  const seats = view.seats.map((s) => s.seat);
  const out: number[] = [];
  for (let i = 1; i <= view.numSeats; i++) { const s = (view.bbSeat + i) % view.numSeats; if (seats.includes(s)) out.push(s); }
  return out;
}
export function behindPreflop(view: PlayerView, seat: number): number {
  const ord = preflopOrder(view);
  return ord.length - 1 - ord.indexOf(seat);
}

export function boardWetness(board: number[]): { wet: number; paired: boolean; maxSuit: number } {
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[suitOf(c)]++;
  const maxSuit = Math.max(...suits);
  const ranks = [...new Set(board.map(rankOf))].sort((a, b) => a - b);
  let conn = 0;
  for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2) conn++;
  const paired = ranks.length < board.length;
  let wet = 0;
  if (board.length >= 3) {
    wet = (maxSuit >= 3 ? 0.45 : maxSuit === 2 ? 0.25 : 0) + Math.min(0.5, conn * 0.2) + (ranks.some((r) => r >= 7 && r <= 11) ? 0.1 : 0);
    if (paired) wet -= 0.1;
    wet = Math.max(0, Math.min(1, wet));
  }
  return { wet, paired, maxSuit };
}

export function buildContext(view: PlayerView): Ctx {
  const bb = view.level.bb;
  const me = view.seats.find((s) => s.seat === view.mySeat)!;
  const others = view.seats.filter((s) => s.seat !== view.mySeat && s.status !== 'folded');
  const myTotal = me.stack + me.committed;
  const maxOther = Math.max(0, ...others.map((s) => s.stack + s.committed));
  const effStack = Math.max(0, Math.min(myTotal, maxOther) - me.committed);
  const effBB = Math.min(me.startStack, Math.max(0, ...others.map((s) => s.startStack))) / bb;
  const pot = view.potTotal;
  const toCall = view.legal.callAmount;
  const live = view.seats.filter((s) => s.status !== 'folded').map((s) => s.seat);
  const postOrder: number[] = [];
  for (let i = 1; i <= view.numSeats; i++) { const s = (view.buttonSeat + i) % view.numSeats; if (live.includes(s)) postOrder.push(s); }
  let raisesPre = 0, lastPreRaiser: number | null = null;
  for (const a of view.actionLog) if (a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet')) { raisesPre++; lastPreRaiser = a.seat; }
  const [h1, h2] = view.holeCards;
  let madeCat = 0;
  let boardPlays = false; // 리버에 보드 5장이 그대로 내 최고 패 (나눠 먹기가 최선)
  if (view.board.length >= 3) {
    const all = evaluate([h1, h2, ...view.board]);
    madeCat = categoryOf(all);
    const boardCat = categoryOf(evaluate(view.board));
    // 보드 족보와 같은 등급이면 내 카드가 실제로 쓰였는지 확인: 보드 카드와 같은 랭크를 들었거나, 보드의 낮은 페어보다 높은 포켓 페어
    //  (예: 보드 2-2-4-4-T에 88 = 투페어 88·44, 내 패가 쓰임 / 같은 보드에 33 = 보드가 플레이)
    if (madeCat === boardCat && boardCat <= 3) {
      const br = view.board.map(rankOf);
      const paired = br.filter((r, i) => br.indexOf(r) !== i);
      const hr = [rankOf(h1), rankOf(h2)];
      const uses = hr.some((r) => br.includes(r)) || (hr[0] === hr[1] && boardCat === 2 && paired.length > 0 && hr[0] > Math.min(...paired));
      if (!uses) madeCat = 0;
    }
    if (view.board.length === 5 && all === evaluate(view.board)) { madeCat = 0; boardPlays = true; }
  }
  const dHero = drawInfo([h1, h2], view.board);
  const dBoard = view.board.length >= 4 ? drawInfo([], view.board) : { flushDraw: false, oesd: false, gutshot: false };
  const tex = boardWetness(view.board);
  return {
    view, bb, pot, toCall, effStack, effBB, spr: effStack / Math.max(1, pot),
    street: view.street, oppSeats: others.map((s) => s.seat), activeOpp: others.filter((s) => s.status === 'active').map((s) => s.seat), numOpp: others.length,
    ip: postOrder[postOrder.length - 1] === view.mySeat, postOrder,
    behind: view.street === 'preflop' ? behindPreflop(view, view.mySeat) : 0,
    raisesPre, lastPreRaiser, facingBet: toCall > 0,
    key: handKey(h1, h2), pct: handPct(h1, h2), madeCat, boardPlays,
    flushDraw: dHero.flushDraw && !dBoard.flushDraw, oesd: dHero.oesd && !dBoard.oesd, gutshot: dHero.gutshot && !dBoard.gutshot,
    wet: tex.wet, paired: tex.paired,
    potOdds: toCall > 0 ? toCall / (pot + toCall) : 0,
    betFrac: toCall > 0 ? toCall / Math.max(1, pot - toCall) : 0,
  };
}
