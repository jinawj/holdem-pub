import type { Card } from './cards';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = Street | 'done';
export type ActType = 'ante' | 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface Level { level: number; sb: number; bb: number; ante: number }

export interface PublicAction {
  seat: number;
  street: Street;
  type: ActType;
  /** 이번 액션으로 새로 넣은 칩 */
  amount: number;
  /** 이 스트리트에 넣은 총액(액션 후) */
  to: number;
  allIn: boolean;
}

export interface HandPlayer {
  seat: number;
  name: string;
  startStack: number;
  stack: number;
  /** 이번 스트리트에 넣은 칩 */
  committed: number;
  /** 이번 핸드에 넣은 라이브 칩 총액 (앤티 제외) */
  total: number;
  ante: number;
  hole: [Card, Card];
  folded: boolean;
  allIn: boolean;
  /** 이번 스트리트에 마지막으로 자발적 행동했을 때의 currentBet (null = 아직 안 함) */
  actedAt: number | null;
}

export interface Snapshot {
  /** 액션 인덱스 (-1 = 블라인드 직후) */
  i: number;
  street: Phase;
  board: Card[];
  seats: { seat: number; stack: number; committed: number; folded: boolean; allIn: boolean }[];
  pot: number; // 테이블 중앙(스트리트 앞에 놓인 칩 제외)
  actor: number | null;
  label: string;
}

export interface PotResult {
  amount: number;
  eligible: number[];
  winners: number[];
  shares: { seat: number; amount: number }[];
}

export interface HandResult {
  uncontested: boolean;
  pots: PotResult[];
  shown: number[];
  scores: Record<number, number>;
  endStacks: Record<number, number>;
  won: Record<number, number>;
  showOrder: number[];
}

export interface HandState {
  handNo: number;
  seed: string;
  level: Level;
  numSeats: number;
  buttonSeat: number;
  sbSeat: number | null; // SB 자리(데드 SB면 null)
  bbSeat: number;
  players: HandPlayer[]; // 이번 핸드에 카드 받은 사람, 좌석 순
  deck: Card[];
  deckPos: number;
  board: Card[];
  street: Phase;
  currentBet: number;
  lastRaiseSize: number;
  toAct: number | null;
  actions: PublicAction[];
  lastAggressor: number | null;
  antePot: number;
  allInRunout: boolean;
  result: HandResult | null;
  snapshots: Snapshot[];
}

export interface Legal {
  seat: number;
  canCheck: boolean;
  /** 콜에 추가로 넣어야 하는 칩 (스택으로 제한) */
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  committed: number;
  stack: number;
  currentBet: number;
}

export type Move =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }; // bet도 raise로 (총액 기준)
