// 직접 구현한 5~7장 핸드 평가기 (비트마스크 방식, 외부 라이선스 없음)
// 반환값: 클수록 강함. (카테고리 << 20) | 키커 5개 × 4비트
import { Card } from './cards';

export const CATEGORY_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

const rankCount = new Int32Array(13);
const suitCount = new Int32Array(4);
const suitMask = new Int32Array(4);

function straightHigh(mask: number): number {
  // bit0 = A(로우), bit1..13 = 2..A
  const m = ((mask << 1) | ((mask >> 12) & 1)) & 0x3fff;
  for (let h = 13; h >= 4; h--) {
    if (((m >> (h - 4)) & 0x1f) === 0x1f) return h - 1; // 원래 rank 인덱스 (wheel → 3 = '5')
  }
  return -1;
}

function topBits(mask: number, n: number): number {
  let out = 0, k = 0;
  for (let r = 12; r >= 0 && k < n; r--) {
    if (mask & (1 << r)) { out = (out << 4) | r; k++; }
  }
  for (; k < 5; k++) out <<= 4;
  return out;
}

function pack(cat: number, ...ks: number[]): number {
  let out = 0;
  for (let i = 0; i < 5; i++) out = (out << 4) | (ks[i] ?? 0);
  return cat * 1048576 + out;
}

export function evaluate(cards: ArrayLike<Card>, n = cards.length): number {
  rankCount.fill(0); suitCount.fill(0); suitMask.fill(0);
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2, s = c & 3;
    rankCount[r]++; suitCount[s]++; suitMask[s] |= 1 << r; rankMask |= 1 << r;
  }
  // 플러시 / 스트레이트 플러시
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      const sh = straightHigh(suitMask[s]);
      if (sh >= 0) return pack(8, sh);
      return 5 * 1048576 + topBits(suitMask[s], 5);
    }
  }
  let quad = -1, trips1 = -1, trips2 = -1, pair1 = -1, pair2 = -1, pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const c = rankCount[r];
    if (c === 4) quad = r;
    else if (c === 3) { if (trips1 < 0) trips1 = r; else if (trips2 < 0) trips2 = r; }
    else if (c === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; else if (pair3 < 0) pair3 = r; }
  }
  if (quad >= 0) {
    const kick = topBits(rankMask & ~(1 << quad), 1) >> 16;
    return pack(7, quad, kick);
  }
  if (trips1 >= 0 && (trips2 >= 0 || pair1 >= 0)) {
    const p = Math.max(trips2, pair1);
    return pack(6, trips1, p);
  }
  const sh = straightHigh(rankMask);
  if (sh >= 0) return pack(4, sh);
  if (trips1 >= 0) {
    const k = topBits(rankMask & ~(1 << trips1), 2) >> 12;
    return pack(3, trips1, (k >> 4) & 15, k & 15);
  }
  if (pair1 >= 0 && pair2 >= 0) {
    const k = topBits(rankMask & ~(1 << pair1) & ~(1 << pair2), 1) >> 16;
    return pack(2, pair1, pair2, k);
  }
  if (pair1 >= 0) {
    const k = topBits(rankMask & ~(1 << pair1), 3) >> 8;
    return pack(1, pair1, (k >> 8) & 15, (k >> 4) & 15, k & 15);
  }
  return topBits(rankMask, 5);
}

export function categoryOf(score: number): number {
  return Math.floor(score / 1048576);
}

export function describeHand(score: number): string {
  return CATEGORY_NAMES[categoryOf(score)];
}
