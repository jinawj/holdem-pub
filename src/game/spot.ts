// AI 시험지 문항을 엔진으로 재현하는 도구 (overview 3.14 ①)
import { parseCards } from '../engine/cards';
import { applyMove, legalActions, startHand } from '../engine/hand';
import type { HandState } from '../engine/types';

export interface SpotDef {
  id: string;
  desc: string;
  seats?: number; // 기본 6
  button?: number; // 기본 0 (SB 1, BB 2, UTG 3 …)
  stacksBB?: number | number[]; // 기본 100
  bb?: number; // 기본 200
  ante?: number;
  hero: number;
  heroHand?: string;
  heroHands?: string[]; // 레인지 문항: 여러 핸드 평균
  board?: string; // 5장까지
  moves: string[]; // f, c, x, r:<BB 총액>, b:<팟 비율>, a(올인)
  personas?: string[] | 'all';
  expect: Partial<Record<'fold' | 'check' | 'call' | 'raise' | 'continue' | 'smallBetShare', [number, number]>>;
}

function deckFor(n: number, button: number, holes: Record<number, string>, board: string): number[] {
  const used = new Set<number>();
  const want: Record<number, number[]> = {};
  for (const [s, str] of Object.entries(holes)) { want[+s] = parseCards(str); want[+s].forEach((c) => used.add(c)); }
  const b = parseCards(board); b.forEach((c) => used.add(c));
  // 남는 카드는 섞이지 않은 고정 순서지만, 높은 카드부터 써서 상대 카드가 2·3 위주로 몰리지 않게 섞는다
  const filler = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  for (let i = filler.length - 1; i > 0; i--) { const j = (i * 7919 + 13) % (i + 1); [filler[i], filler[j]] = [filler[j], filler[i]]; }
  const take = () => filler.shift()!;
  const order: number[] = [];
  for (let i = 1; i <= n; i++) order.push((button + i) % n);
  const deck: number[] = [];
  for (let r = 0; r < 2; r++) for (const s of order) deck.push(want[s] ? want[s][r] : take());
  const bd = [...b];
  const next = () => (bd.length ? bd.shift()! : take());
  deck.push(take(), next(), next(), next(), take(), next(), take(), next());
  while (filler.length) deck.push(filler.shift()!);
  return deck;
}

export function buildSpot(def: SpotDef, heroHand: string): HandState {
  const n = def.seats ?? 6;
  const button = def.button ?? 0;
  const bb = def.bb ?? 200;
  const stacks = Array.isArray(def.stacksBB) ? def.stacksBB : Array(n).fill(def.stacksBB ?? 100);
  const heads = n === 2;
  const h = startHand({
    handNo: 1, seed: '0'.repeat(32), level: { level: 1, sb: bb / 2, bb, ante: def.ante ?? 0 }, numSeats: n,
    buttonSeat: button, sbSeat: heads ? button : (button + 1) % n, bbSeat: heads ? (button + 1) % n : (button + 2) % n,
    players: stacks.map((s, seat) => ({ seat, name: 'P' + seat, stack: Math.round(s * bb) })),
    deck: deckFor(n, button, { [def.hero]: heroHand }, def.board ?? ''),
  });
  for (const m of def.moves) {
    const L = legalActions(h);
    if (!L) throw new Error(`${def.id}: hand ended before move ${m}`);
    if (m === 'f') applyMove(h, { type: 'fold' });
    else if (m === 'c') applyMove(h, { type: 'call' });
    else if (m === 'x') applyMove(h, { type: 'check' });
    else if (m === 'a') applyMove(h, { type: 'raise', to: L.maxRaiseTo });
    else if (m.startsWith('r:')) applyMove(h, { type: 'raise', to: Math.min(L.maxRaiseTo, Math.round(parseFloat(m.slice(2)) * bb)) });
    else if (m.startsWith('b:')) {
      const pot = h.players.reduce((a, p) => a + p.total, 0) + h.antePot;
      const to = Math.max(L.minRaiseTo, Math.round((pot * parseFloat(m.slice(2))) / 100) * 100 + L.currentBet);
      applyMove(h, { type: 'raise', to: Math.min(L.maxRaiseTo, to) });
    } else throw new Error('bad move ' + m);
  }
  if (h.toAct !== def.hero) throw new Error(`${def.id}: expected hero ${def.hero} to act, got ${h.toAct}`);
  return h;
}
