import { Card, parseCards } from '../src/engine/cards';
import { startHand } from '../src/engine/hand';
import type { Level } from '../src/engine/types';

/** 지정한 카드로 덱 만들기. holes: seat → "AhKd", board: "2c3d4h5s6c" */
export function riggedDeck(numSeats: number, button: number, seatsInHand: number[], holes: Record<number, string>, board = ''): Card[] {
  const used = new Set<Card>();
  const want: Record<number, Card[]> = {};
  for (const [s, str] of Object.entries(holes)) { want[+s] = parseCards(str); want[+s].forEach((c) => used.add(c)); }
  const b = parseCards(board); b.forEach((c) => used.add(c));
  const filler = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  const take = () => filler.shift()!;
  const order: number[] = [];
  for (let i = 1; i <= numSeats; i++) { const s = (button + i) % numSeats; if (seatsInHand.includes(s)) order.push(s); }
  const deck: Card[] = [];
  for (let r = 0; r < 2; r++) for (const s of order) deck.push(want[s] ? want[s][r] : take());
  const bd = [...b];
  const next = () => (bd.length ? bd.shift()! : take());
  deck.push(take(), next(), next(), next(), take(), next(), take(), next());
  while (filler.length) deck.push(filler.shift()!);
  return deck;
}

export const L1: Level = { level: 1, sb: 100, bb: 200, ante: 0 };
export const L5: Level = { level: 5, sb: 1000, bb: 2000, ante: 1000 };

export function mkHand(opts: { stacks: number[]; button: number; sb?: number | null; bb?: number; level?: Level; holes?: Record<number, string>; board?: string }) {
  const n = opts.stacks.length;
  const seats = opts.stacks.map((_, i) => i);
  const heads = n === 2;
  const sb = opts.sb !== undefined ? opts.sb : heads ? opts.button : (opts.button + 1) % n;
  const bb = opts.bb !== undefined ? opts.bb : heads ? (opts.button + 1) % n : (opts.button + 2) % n;
  return startHand({
    handNo: 1, seed: '0'.repeat(32), level: opts.level ?? L1, numSeats: n,
    buttonSeat: opts.button, sbSeat: sb, bbSeat: bb,
    players: opts.stacks.map((stack, seat) => ({ seat, name: 'P' + seat, stack })),
    deck: riggedDeck(n, opts.button, seats, opts.holes ?? {}, opts.board ?? ''),
  });
}

export function chipsInPlay(h: ReturnType<typeof startHand>) {
  return h.players.reduce((a, p) => a + p.stack + (h.street === 'done' ? 0 : p.total), 0) + (h.street === 'done' ? 0 : h.antePot);
}
