// PlayerView: 본인 카드 + 공개 정보만. AI는 이것만 받는다 (공정성 구조, overview 3.2)
import type { Card } from './cards';
import { currentPots, legalActions } from './hand';
import type { HandState, Level, PublicAction, Street } from './types';

export interface PlayerView {
  handId: string;
  handNo: number;
  mySeat: number;
  holeCards: [Card, Card];
  board: Card[];
  street: Street;
  numSeats: number;
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number;
  seats: { seat: number; stack: number; committed: number; startStack: number; status: 'active' | 'folded' | 'allin' }[];
  pots: { amount: number; eligibleSeats: number[] }[];
  potTotal: number;
  actionLog: PublicAction[];
  legal: { canCheck: boolean; callAmount: number; canRaise: boolean; minRaiseTo: number; maxRaiseTo: number; committed: number; stack: number; currentBet: number };
  level: Level;
  playersLeft: number;
}

export function makePlayerView(s: HandState, seat: number, playersLeft: number): PlayerView {
  const me = s.players.find((p) => p.seat === seat);
  if (!me) throw new Error('seat not in hand');
  const legal = legalActions(s);
  const pots = currentPots(s);
  return {
    handId: `${s.handNo}`,
    handNo: s.handNo,
    mySeat: seat,
    holeCards: [me.hole[0], me.hole[1]],
    board: [...s.board],
    street: s.street === 'done' ? 'river' : s.street,
    numSeats: s.numSeats,
    buttonSeat: s.buttonSeat,
    sbSeat: s.sbSeat,
    bbSeat: s.bbSeat,
    seats: s.players.map((p) => ({
      seat: p.seat, stack: p.stack, committed: p.committed, startStack: p.startStack,
      status: p.folded ? 'folded' : p.allIn ? 'allin' : 'active',
    })),
    pots: pots.map((p) => ({ amount: p.amount, eligibleSeats: p.eligible })),
    potTotal: pots.reduce((a, b) => a + b.amount, 0),
    actionLog: s.actions.map((a) => ({ ...a })),
    legal: legal && legal.seat === seat
      ? { canCheck: legal.canCheck, callAmount: legal.callAmount, canRaise: legal.canRaise, minRaiseTo: legal.minRaiseTo, maxRaiseTo: legal.maxRaiseTo, committed: legal.committed, stack: legal.stack, currentBet: legal.currentBet }
      : { canCheck: false, callAmount: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, committed: me.committed, stack: me.stack, currentBet: s.currentBet },
    level: { ...s.level },
    playersLeft,
  };
}
