// 카드 = 0..51 정수. rank = c >> 2 (0=2 … 12=A), suit = c & 3 (0=♣ 1=♦ 2=♥ 3=♠)
import { Rng, Seed, shuffleInPlace } from './rng';

export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOL = ['♣', '♦', '♥', '♠'];

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

export function cardToString(c: Card): string {
  return RANKS[rankOf(c)] + SUITS[suitOf(c)];
}

export function parseCard(s: string): Card {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error('bad card ' + s);
  return makeCard(r, su);
}

export function parseCards(s: string): Card[] {
  const t = s.replace(/\s+/g, '');
  const out: Card[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(parseCard(t.slice(i, i + 2)));
  return out;
}

export function newDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function shuffledDeck(seed: Seed): Card[] {
  return shuffleInPlace(newDeck(), new Rng(seed));
}

/** 169 시작 핸드 키: "AA", "AKs", "AKo" */
export function handKey(a: Card, b: Card): string {
  let r1 = rankOf(a), r2 = rankOf(b);
  if (r2 > r1) [r1, r2] = [r2, r1];
  if (r1 === r2) return RANKS[r1] + RANKS[r2];
  return RANKS[r1] + RANKS[r2] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/** 1326 콤보 목록 (index → [c1,c2], c1 > c2) */
export const COMBOS: [Card, Card][] = (() => {
  const out: [Card, Card][] = [];
  for (let a = 51; a >= 0; a--) for (let b = a - 1; b >= 0; b--) out.push([a, b]);
  return out;
})();

export const COMBO_KEYS: string[] = COMBOS.map(([a, b]) => handKey(a, b));
