// 한 핸드 진행 (순수 TS, 상태를 직접 변경한다. UI는 복사본을 넘길 것)
import { Card, shuffledDeck } from './cards';
import { evaluate } from './evaluator';
import { seedFromString } from './rng';
import { computePots, splitPot } from './pots';
import type { HandPlayer, HandResult, HandState, Legal, Level, Move, PublicAction, Street } from './types';

export interface StartHandParams {
  handNo: number;
  seed: string; // 32 hex
  level: Level;
  numSeats: number;
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number;
  players: { seat: number; name: string; stack: number }[];
  /** 테스트용: 덱 순서를 직접 지정 (앞에서부터 사용) */
  deck?: Card[];
}

export class IllegalActionError extends Error {}

export function startHand(p: StartHandParams): HandState {
  const deck = p.deck ? [...p.deck] : shuffledDeck(seedFromString(p.seed));
  const players: HandPlayer[] = [...p.players]
    .sort((a, b) => a.seat - b.seat)
    .map((x) => ({
      seat: x.seat, name: x.name, startStack: x.stack, stack: x.stack,
      committed: 0, total: 0, ante: 0, hole: [0, 0] as [Card, Card],
      folded: false, allIn: false, actedAt: null,
    }));
  const s: HandState = {
    handNo: p.handNo, seed: p.seed, level: p.level, numSeats: p.numSeats,
    buttonSeat: p.buttonSeat, sbSeat: p.sbSeat, bbSeat: p.bbSeat,
    players, deck, deckPos: 0, board: [], street: 'preflop',
    currentBet: 0, lastRaiseSize: p.level.bb, toAct: null, actions: [],
    lastAggressor: null, antePot: 0, allInRunout: false, result: null, snapshots: [],
  };
  // 카드 분배: 버튼 왼쪽(SB 자리 방향)부터 한 장씩 두 바퀴
  const order = seatsFrom(s, s.buttonSeat);
  for (let r = 0; r < 2; r++) for (const seat of order) getP(s, seat).hole[r] = deck[s.deckPos++];

  // BB 앤티 → 블라인드 (BB 칩이 부족하면 앤티 먼저)
  const bb = getP(s, s.bbSeat);
  if (p.level.ante > 0) {
    const a = Math.min(bb.stack, p.level.ante);
    bb.stack -= a; bb.ante = a; s.antePot += a;
    if (bb.stack === 0) bb.allIn = true;
    s.actions.push({ seat: bb.seat, street: 'preflop', type: 'ante', amount: a, to: 0, allIn: bb.stack === 0 });
  }
  if (s.sbSeat !== null) post(s, getP(s, s.sbSeat), p.level.sb, 'sb');
  post(s, bb, p.level.bb, 'bb');
  s.currentBet = p.level.bb;
  s.lastRaiseSize = p.level.bb;
  snapshot(s, null, '블라인드');
  s.toAct = nextToAct(s, s.bbSeat);
  if (s.toAct === null) closeStreet(s);
  return s;
}

function post(s: HandState, pl: HandPlayer, amt: number, type: 'sb' | 'bb') {
  const a = Math.min(pl.stack, amt);
  pl.stack -= a; pl.committed += a; pl.total += a;
  if (pl.stack === 0) pl.allIn = true;
  s.actions.push({ seat: pl.seat, street: 'preflop', type, amount: a, to: pl.committed, allIn: pl.allIn });
}

export function getP(s: HandState, seat: number): HandPlayer {
  const p = s.players.find((x) => x.seat === seat);
  if (!p) throw new Error('no player at seat ' + seat);
  return p;
}

/** from 다음 자리부터 시계 방향으로 이번 핸드 참가자 좌석 */
export function seatsFrom(s: HandState, from: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= s.numSeats; i++) {
    const seat = (from + i) % s.numSeats;
    if (s.players.some((p) => p.seat === seat)) out.push(seat);
  }
  return out;
}

function needsToAct(s: HandState, p: HandPlayer): boolean {
  return !p.folded && !p.allIn && (p.actedAt === null || p.committed < s.currentBet);
}

function nextToAct(s: HandState, after: number): number | null {
  if (s.players.filter((p) => !p.folded).length <= 1) return null;
  // 행동 가능한 사람이 1명뿐이고 이미 맞춰 놓았으면 진행할 필요 없음
  for (const seat of seatsFrom(s, after)) {
    const p = getP(s, seat);
    if (needsToAct(s, p)) {
      const canActCount = s.players.filter((x) => !x.folded && !x.allIn).length;
      if (canActCount === 1 && p.committed >= maxCommittedOthers(s, seat)) return null;
      return seat;
    }
  }
  return null;
}

function maxCommittedOthers(s: HandState, seat: number) {
  return Math.max(0, ...s.players.filter((p) => p.seat !== seat).map((p) => p.committed));
}

export function legalActions(s: HandState): Legal | null {
  if (s.toAct === null || s.street === 'done') return null;
  const p = getP(s, s.toAct);
  const toCall = Math.max(0, s.currentBet - p.committed);
  const callAmount = Math.min(toCall, p.stack);
  const maxTo = p.committed + p.stack;
  // 이미 행동했고, 그 뒤로 완전한 레이즈를 받지 않았으면 레이즈 권리 없음
  const reopened = p.actedAt === null || s.currentBet - p.actedAt >= s.lastRaiseSize;
  const othersCanAct = s.players.some((x) => x.seat !== p.seat && !x.folded && !x.allIn);
  const canRaise = reopened && maxTo > s.currentBet && othersCanAct;
  const minTo = s.currentBet === 0 ? Math.min(s.level.bb, maxTo) : Math.min(s.currentBet + s.lastRaiseSize, maxTo);
  return {
    seat: p.seat, canCheck: toCall === 0, callAmount, canRaise,
    minRaiseTo: canRaise ? minTo : 0, maxRaiseTo: canRaise ? maxTo : 0,
    committed: p.committed, stack: p.stack, currentBet: s.currentBet,
  };
}

export function applyMove(s: HandState, mv: Move): HandState {
  const legal = legalActions(s);
  if (!legal) throw new IllegalActionError('no action expected');
  const p = getP(s, legal.seat);
  const street = s.street as Street;
  const rec = (type: PublicAction['type'], amount: number) =>
    s.actions.push({ seat: p.seat, street, type, amount, to: p.committed, allIn: p.allIn });

  switch (mv.type) {
    case 'fold':
      p.folded = true; p.actedAt = s.currentBet; rec('fold', 0); break;
    case 'check':
      if (!legal.canCheck) throw new IllegalActionError('cannot check');
      p.actedAt = s.currentBet; rec('check', 0); break;
    case 'call': {
      if (legal.canCheck) throw new IllegalActionError('nothing to call');
      const a = legal.callAmount;
      p.stack -= a; p.committed += a; p.total += a;
      if (p.stack === 0) p.allIn = true;
      p.actedAt = s.currentBet; rec('call', a); break;
    }
    case 'raise': {
      if (!legal.canRaise) throw new IllegalActionError('cannot raise');
      const to = mv.to;
      if (!Number.isFinite(to) || to > legal.maxRaiseTo || to <= s.currentBet) throw new IllegalActionError('bad raise ' + to);
      const isAllIn = to === legal.maxRaiseTo;
      if (to < legal.minRaiseTo && !isAllIn) throw new IllegalActionError(`raise below minimum ${to} < ${legal.minRaiseTo}`);
      const a = to - p.committed;
      const wasBet = s.currentBet === 0;
      const increment = to - s.currentBet;
      p.stack -= a; p.committed = to; p.total += a;
      if (p.stack === 0) p.allIn = true;
      if (increment >= s.lastRaiseSize) s.lastRaiseSize = increment; // 완전한 레이즈
      s.currentBet = to;
      p.actedAt = to;
      s.lastAggressor = p.seat;
      rec(wasBet ? 'bet' : 'raise', a);
      break;
    }
  }
  const last = s.actions[s.actions.length - 1];
  snapshot(s, p.seat, actionLabel(last));
  advance(s, p.seat);
  return s;
}

export function actionLabel(a: PublicAction): string {
  const n = (x: number) => x.toLocaleString('en-US');
  switch (a.type) {
    case 'fold': return '폴드';
    case 'check': return '체크';
    case 'call': return a.allIn ? `콜 ${n(a.amount)} (올인)` : `콜 ${n(a.amount)}`;
    case 'bet': return a.allIn ? `올인 ${n(a.to)}` : `벳 ${n(a.to)}`;
    case 'raise': return a.allIn ? `올인 ${n(a.to)}` : `레이즈 ${n(a.to)}`;
    case 'sb': return `SB ${n(a.amount)}`;
    case 'bb': return `BB ${n(a.amount)}`;
    case 'ante': return `앤티 ${n(a.amount)}`;
  }
}

function advance(s: HandState, lastSeat: number) {
  const live = s.players.filter((p) => !p.folded);
  if (live.length === 1) {
    returnUncalled(s);
    finishUncontested(s, live[0].seat);
    return;
  }
  const next = nextToAct(s, lastSeat);
  if (next !== null) { s.toAct = next; return; }
  closeStreet(s);
}

function returnUncalled(s: HandState) {
  const sorted = [...s.players].sort((a, b) => b.committed - a.committed);
  if (sorted.length < 2) return;
  const diff = sorted[0].committed - sorted[1].committed;
  if (diff > 0) {
    const p = sorted[0];
    p.committed -= diff; p.total -= diff; p.stack += diff;
    if (p.stack > 0) p.allIn = false;
  }
}

function closeStreet(s: HandState) {
  s.toAct = null;
  returnUncalled(s);
  for (const p of s.players) { p.committed = 0; p.actedAt = null; }
  s.currentBet = 0;
  s.lastRaiseSize = s.level.bb;
  const canAct = s.players.filter((p) => !p.folded && !p.allIn).length;
  if (s.street === 'river') { showdown(s); return; }
  if (canAct <= 1) s.allInRunout = true;
  dealNext(s);
  snapshot(s, null, streetName(s.street as Street));
  if (s.allInRunout) { closeStreet(s); return; }
  s.lastAggressor = null;
  s.toAct = nextToAct(s, s.buttonSeat);
  if (s.toAct === null) closeStreet(s);
}

export function streetName(st: Street): string {
  return { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' }[st];
}

function dealNext(s: HandState) {
  const burn = () => s.deckPos++;
  if (s.street === 'preflop') { burn(); s.board.push(s.deck[s.deckPos++], s.deck[s.deckPos++], s.deck[s.deckPos++]); s.street = 'flop'; }
  else if (s.street === 'flop') { burn(); s.board.push(s.deck[s.deckPos++]); s.street = 'turn'; }
  else if (s.street === 'turn') { burn(); s.board.push(s.deck[s.deckPos++]); s.street = 'river'; }
}

function orderFromButton(s: HandState): number[] {
  return seatsFrom(s, s.buttonSeat);
}

function finishUncontested(s: HandState, winner: number) {
  const pots = computePots(s.players.map((p) => ({ seat: p.seat, total: p.total, folded: p.folded })), s.antePot);
  const amount = pots.reduce((a, b) => a + b.amount, 0);
  getP(s, winner).stack += amount;
  for (const p of s.players) p.committed = 0;
  s.result = {
    uncontested: true,
    pots: [{ amount, eligible: [winner], winners: [winner], shares: [{ seat: winner, amount }] }],
    shown: [], scores: {}, showOrder: [],
    endStacks: Object.fromEntries(s.players.map((p) => [p.seat, p.stack])),
    won: { [winner]: amount },
  };
  s.street = 'done'; s.toAct = null;
  snapshot(s, null, '종료');
}

function showdown(s: HandState) {
  const live = s.players.filter((p) => !p.folded);
  const scores: Record<number, number> = {};
  for (const p of live) scores[p.seat] = evaluate([...p.hole, ...s.board]);
  const pots = computePots(s.players.map((p) => ({ seat: p.seat, total: p.total, folded: p.folded })), s.antePot);
  const order = orderFromButton(s);
  const won: Record<number, number> = {};
  const potResults = pots.map((pot) => {
    const best = Math.max(...pot.eligible.map((x) => scores[x]));
    const winners = pot.eligible.filter((x) => scores[x] === best);
    const shares = splitPot(pot.amount, winners, order);
    for (const sh of shares) { getP(s, sh.seat).stack += sh.amount; won[sh.seat] = (won[sh.seat] ?? 0) + sh.amount; }
    return { amount: pot.amount, eligible: pot.eligible, winners, shares };
  });
  // 쇼다운 순서: 리버 마지막 공격자 먼저, 없으면 버튼 왼쪽부터
  let showOrder = order.filter((x) => scores[x] !== undefined);
  const riverAgg = s.lastAggressor;
  if (riverAgg !== null && scores[riverAgg] !== undefined && !s.allInRunout) {
    const i = showOrder.indexOf(riverAgg);
    showOrder = [...showOrder.slice(i), ...showOrder.slice(0, i)];
  }
  let shown: number[];
  if (s.allInRunout) shown = [...showOrder];
  else {
    shown = [];
    let bestShown = -1;
    const winnersAll = new Set(potResults.flatMap((p) => p.winners));
    for (const seat of showOrder) {
      if (shown.length === 0 || scores[seat] >= bestShown || winnersAll.has(seat)) {
        shown.push(seat); bestShown = Math.max(bestShown, scores[seat]);
      }
    }
  }
  s.result = {
    uncontested: false, pots: potResults, shown, scores, showOrder,
    endStacks: Object.fromEntries(s.players.map((p) => [p.seat, p.stack])), won,
  };
  for (const p of s.players) p.committed = 0;
  s.street = 'done'; s.toAct = null;
  snapshot(s, null, '쇼다운');
}

function snapshot(s: HandState, actor: number | null, label: string) {
  const live = s.players.reduce((a, p) => a + p.total - p.committed, 0) + s.antePot;
  s.snapshots.push({
    i: s.actions.length - 1,
    street: s.street, board: [...s.board],
    seats: s.players.map((p) => ({ seat: p.seat, stack: p.stack, committed: p.committed, folded: p.folded, allIn: p.allIn })),
    pot: s.street === 'done' ? 0 : live,
    actor, label,
  });
}

/** 현재 팟 목록(스트리트에 놓인 칩 포함) */
export function currentPots(s: HandState) {
  return computePots(s.players.map((p) => ({ seat: p.seat, total: p.total, folded: p.folded })), s.antePot);
}

/** 중앙에 모인 팟(이번 스트리트 칩 제외) */
export function centerPots(s: HandState) {
  return computePots(s.players.map((p) => ({ seat: p.seat, total: p.total - p.committed, folded: p.folded })), s.antePot)
    .filter((p) => p.amount > 0);
}

export function totalChips(s: HandState): number {
  return s.players.reduce((a, p) => a + p.stack + p.total, 0) + s.antePot - (s.street === 'done' ? s.players.reduce((a, p) => a + p.total, 0) + s.antePot : 0);
}
