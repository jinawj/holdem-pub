// 상황 정보: 포지션(실제 행동 순서 기준), 유효스택, SPR, 팟오즈, 보드 텍스처 (overview 3.3)
import { handKey, rankOf, suitOf } from '../../engine/cards';
import { categoryOf, evaluate } from '../../engine/evaluator';
import type { PlayerView } from '../../engine/view';
import { drawInfo } from './equity';
import { handPct } from './handrank';
import { behindPreflop } from './range';

export interface Ctx {
  view: PlayerView;
  bb: number;
  pot: number;
  toCall: number;
  stack: number;
  committed: number;
  effStack: number; // 남은 유효 스택 (칩)
  effBB: number; // 핸드 시작 기준 유효 스택 (BB)
  spr: number;
  street: PlayerView['street'];
  oppSeats: number[]; // 폴드 안 한 상대
  activeOpp: number[]; // 아직 행동 가능한 상대 (올인 제외)
  numOpp: number;
  ip: boolean; // 포스트플랍 마지막 행동자
  behind: number; // 프리플랍: 내 뒤에 남은 사람 수
  raisesPre: number;
  lastPreRaiser: number | null;
  isPFA: boolean;
  raisesThisStreet: number;
  facingBet: boolean;
  checkedToMe: boolean;
  key: string;
  pct: number;
  madeCat: number; // 내 카드가 관여한 족보 카테고리 (보드만으로 된 족보면 0 취급)
  boardCat: number;
  flushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  wet: number; // 0..1
  paired: boolean;
  monotone: boolean;
  topPair: boolean;
  overcardsOnBoard: number; // 내 페어보다 높은 보드 카드 수 (페어일 때)
  potOdds: number; // 콜에 필요한 승률
  lastBetFrac: number; // 받은 벳 / (벳 전 팟)
}

export function buildContext(view: PlayerView): Ctx {
  const bb = view.level.bb;
  const me = view.seats.find((s) => s.seat === view.mySeat)!;
  const others = view.seats.filter((s) => s.seat !== view.mySeat && s.status !== 'folded');
  const activeOpp = others.filter((s) => s.status === 'active').map((s) => s.seat);
  const myTotal = me.stack + me.committed;
  const maxOther = Math.max(0, ...others.map((s) => s.stack + s.committed));
  const effStack = Math.min(myTotal, maxOther) - me.committed;
  const effBB = Math.min(me.startStack, Math.max(0, ...others.map((s) => s.startStack))) / bb;
  const pot = view.potTotal;
  const toCall = view.legal.callAmount;
  // 포스트플랍 순서: 버튼 왼쪽부터
  const live = view.seats.filter((s) => s.status !== 'folded').map((s) => s.seat);
  const post: number[] = [];
  for (let i = 1; i <= view.numSeats; i++) { const s = (view.buttonSeat + i) % view.numSeats; if (live.includes(s)) post.push(s); }
  const ip = post[post.length - 1] === view.mySeat;
  let raisesPre = 0, lastPreRaiser: number | null = null;
  let raisesThisStreet = 0;
  let lastBetAmountTo = 0;
  for (const a of view.actionLog) {
    if (a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet')) { raisesPre++; lastPreRaiser = a.seat; }
    if (a.street === view.street && (a.type === 'raise' || a.type === 'bet')) { raisesThisStreet++; lastBetAmountTo = a.to; }
  }
  const streetActs = view.actionLog.filter((a) => a.street === view.street && !['ante', 'sb', 'bb'].includes(a.type));
  const checkedToMe = view.street !== 'preflop' && raisesThisStreet === 0 && streetActs.some((a) => a.type === 'check');
  const [h1, h2] = view.holeCards;
  const key = handKey(h1, h2);
  let madeCat = 0, boardCat = 0, topPair = false, overcards = 0;
  if (view.board.length >= 3) {
    const all = evaluate([h1, h2, ...view.board]);
    madeCat = categoryOf(all);
    boardCat = categoryOf(evaluate(view.board));
    if (madeCat === boardCat && boardCat <= 3) madeCat = 0; // 보드 족보 (보드 페어·투페어·트립스는 내 패가 아님)
    const boardRanks = view.board.map(rankOf).sort((a, b) => b - a);
    const hr = [rankOf(h1), rankOf(h2)];
    topPair = madeCat === 1 && hr.includes(boardRanks[0]);
    if (madeCat === 1) {
      const pairRank = hr[0] === hr[1] ? hr[0] : hr.find((r) => boardRanks.includes(r)) ?? -1;
      overcards = boardRanks.filter((r) => r > pairRank).length;
    }
  }
  const dHero = drawInfo([h1, h2], view.board);
  const dBoard = view.board.length >= 4 ? drawInfo([], view.board) : { flushDraw: false, oesd: false, gutshot: false };
  // 텍스처
  const suits = [0, 0, 0, 0];
  for (const c of view.board.slice(0, 5)) suits[suitOf(c)]++;
  const maxSuit = Math.max(...suits);
  const ranks = [...new Set(view.board.map(rankOf))].sort((a, b) => a - b);
  let conn = 0;
  for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2) conn++;
  const paired = ranks.length < view.board.length;
  let wet = 0;
  if (view.board.length >= 3) {
    wet = (maxSuit >= 3 ? 0.45 : maxSuit === 2 ? 0.25 : 0) + Math.min(0.5, conn * 0.2) + (ranks.some((r) => r >= 7 && r <= 11) ? 0.1 : 0);
    if (paired) wet -= 0.1;
    wet = Math.max(0, Math.min(1, wet));
  }
  void lastBetAmountTo;
  const lastBetFrac = toCall > 0 ? toCall / Math.max(1, pot - toCall) : 0;
  return {
    view, bb, pot, toCall, stack: me.stack, committed: me.committed,
    effStack: Math.max(0, effStack), effBB, spr: Math.max(0, effStack) / Math.max(1, pot),
    street: view.street, oppSeats: others.map((s) => s.seat), activeOpp, numOpp: others.length,
    ip, behind: view.street === 'preflop' ? behindPreflop(view, view.mySeat) : 0,
    raisesPre, lastPreRaiser, isPFA: lastPreRaiser === view.mySeat,
    raisesThisStreet, facingBet: toCall > 0, checkedToMe,
    key, pct: handPct(h1, h2), madeCat, boardCat,
    flushDraw: dHero.flushDraw && !dBoard.flushDraw, oesd: dHero.oesd && !dBoard.oesd, gutshot: dHero.gutshot && !dBoard.gutshot,
    wet, paired, monotone: maxSuit >= 3, topPair, overcardsOnBoard: overcards,
    potOdds: toCall > 0 ? toCall / (pot + toCall) : 0,
    lastBetFrac: Math.max(0, lastBetFrac),
  };
}
