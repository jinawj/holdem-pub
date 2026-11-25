import data from '../../data/hand_rank_169.json';
import { Card, handKey } from '../../engine/cards';

const PCT: Record<string, number> = {};
const RANK: Record<string, number> = {};
for (const d of data as { key: string; pct: number; rank: number }[]) { PCT[d.key] = d.pct; RANK[d.key] = d.rank; }

/** 시작 핸드 백분위 (0에 가까울수록 강함, 0~100) */
export function handPct(a: Card, b: Card): number {
  return PCT[handKey(a, b)];
}
export function keyPct(key: string): number { return PCT[key]; }

/** 블러프 3벳/4벳 후보: A2s–A5s, 수딧 커넥터 */
export function isBluffCandidate(key: string): boolean {
  return ['A5s', 'A4s', 'A3s', 'A2s', 'KTs', 'QTs', 'JTs', 'T9s', '98s', '87s', '76s', '65s', '54s'].includes(key);
}
export function isWheelAceSuited(key: string): boolean {
  return ['A5s', 'A4s', 'A3s', 'A2s'].includes(key);
}
export function isPremium(key: string): boolean {
  return ['AA', 'KK', 'QQ', 'AKs', 'AKo'].includes(key);
}
