// 토너먼트: 레벨, 좌석, 탈락·순위, 핸드 시작/종료 (순수 TS)
import blinds from '../data/blinds.json';
import { startHand } from './hand';
import { computePositions, PrevPositions, rankEliminations } from './positions';
import type { HandState, Level } from './types';

export const LEVELS: Level[] = blinds as Level[];

export interface TSeat { seat: number; name: string; isHuman: boolean; stack: number; out: boolean; place: number | null }

export interface TournamentState {
  numSeats: number;
  seats: TSeat[];
  levelIndex: number;
  pendingLevelUp: number; // 다음 핸드 시작 시 올릴 레벨 수
  handNo: number;
  prev: PrevPositions | null;
  finished: boolean;
  eliminations: { seat: number; place: number; handNo: number }[];
  hand: HandState | null;
}

export function createTournament(names: string[], humanSeat: number | null, startStack: number): TournamentState {
  return {
    numSeats: names.length,
    seats: names.map((name, seat) => ({ seat, name, isHuman: seat === humanSeat, stack: startStack, out: false, place: null })),
    levelIndex: 0, pendingLevelUp: 0, handNo: 0, prev: null, finished: false, eliminations: [], hand: null,
  };
}

export function currentLevel(t: TournamentState): Level {
  return LEVELS[Math.min(t.levelIndex, LEVELS.length - 1)];
}

export function aliveSeats(t: TournamentState): TSeat[] {
  return t.seats.filter((s) => !s.out);
}

export function startNextHand(t: TournamentState, seed: string, randomInt: (n: number) => number, deck?: number[]): HandState {
  if (t.pendingLevelUp > 0) {
    t.levelIndex = Math.min(LEVELS.length - 1, t.levelIndex + t.pendingLevelUp);
    t.pendingLevelUp = 0;
  }
  const alive = t.seats.map((s) => !s.out);
  const pos = computePositions(alive, t.prev, randomInt);
  t.handNo++;
  const hand = startHand({
    handNo: t.handNo, seed, level: currentLevel(t), numSeats: t.numSeats,
    buttonSeat: pos.button, sbSeat: pos.sb, bbSeat: pos.bb,
    players: aliveSeats(t).map((s) => ({ seat: s.seat, name: s.name, stack: s.stack })),
    deck,
  });
  t.prev = { button: pos.button, sbPos: pos.sbPos, bb: pos.bb };
  t.hand = hand;
  return hand;
}

/** 끝난 핸드의 결과를 반영. 이번 핸드 탈락자 목록 반환 */
export function finishHand(t: TournamentState): { seat: number; place: number }[] {
  const h = t.hand;
  if (!h || h.street !== 'done' || !h.result) throw new Error('hand not done');
  for (const p of h.players) t.seats[p.seat].stack = p.stack;
  const busted = h.players.filter((p) => p.stack === 0).map((p) => ({ seat: p.seat, startStack: p.startStack }));
  const remaining = aliveSeats(t).length - busted.length;
  const places = rankEliminations(busted, remaining);
  const out: { seat: number; place: number }[] = [];
  for (const b of busted) {
    const s = t.seats[b.seat];
    s.out = true; s.place = places[b.seat];
    t.eliminations.push({ seat: b.seat, place: s.place, handNo: h.handNo });
    out.push({ seat: b.seat, place: s.place });
  }
  if (remaining <= 1) {
    t.finished = true;
    const w = aliveSeats(t)[0];
    if (w) w.place = 1;
  }
  return out;
}

/** 게임 포기: 사람을 남은 인원 중 최하위로 처리하고 종료 */
export function forfeit(t: TournamentState, seat: number) {
  const s = t.seats[seat];
  if (s.out) { t.finished = true; return; }
  const remaining = aliveSeats(t).length;
  s.out = true; s.place = remaining;
  t.eliminations.push({ seat, place: remaining, handNo: t.handNo });
  t.finished = true;
}

export function totalTableChips(t: TournamentState): number {
  return t.seats.reduce((a, s) => a + s.stack, 0);
}
