// 에퀴티 계산: 가중 레인지 상대 몬테카를로 / 리버 전수 비교 + 강도 버킷 (overview 3.5 ②③)
import { COMBOS, Card } from '../../engine/cards';
import { evaluate } from '../../engine/evaluator';

export type Range = Float64Array; // 1326 가중치

export function uniformRange(dead: Card[]): Range {
  const r = new Float64Array(1326);
  const d = new Set(dead);
  for (let i = 0; i < 1326; i++) { const [a, b] = COMBOS[i]; r[i] = d.has(a) || d.has(b) ? 0 : 1; }
  return r;
}

export function removeDead(r: Range, dead: Card[]) {
  const d = new Set(dead);
  for (let i = 0; i < 1326; i++) { const [a, b] = COMBOS[i]; if (d.has(a) || d.has(b)) r[i] = 0; }
}

const buf7 = new Int32Array(7);

/** 보드 위에서 각 콤보의 현재 강도 백분위 (0 = 최약, 1 = 최강). 보드 없으면 null */
const strengthCache = new Map<string, Float32Array>();
export function strengthOnBoard(board: Card[]): Float32Array {
  const key = board.join(',');
  const c = strengthCache.get(key);
  if (c) return c;
  const d = new Set(board);
  const scores: { i: number; s: number }[] = [];
  for (let i = 0; i < 1326; i++) {
    const [a, b] = COMBOS[i];
    if (d.has(a) || d.has(b)) continue;
    buf7[0] = a; buf7[1] = b;
    for (let k = 0; k < board.length; k++) buf7[k + 2] = board[k];
    scores.push({ i, s: evaluate(buf7, board.length + 2) });
  }
  scores.sort((x, y) => x.s - y.s);
  const out = new Float32Array(1326);
  // 같은 점수는 같은 백분위
  let k = 0;
  while (k < scores.length) {
    let j = k;
    while (j + 1 < scores.length && scores[j + 1].s === scores[k].s) j++;
    const pct = (k + j) / 2 / Math.max(1, scores.length - 1);
    for (let m = k; m <= j; m++) out[scores[m].i] = pct;
    k = j + 1;
  }
  if (strengthCache.size > 64) strengthCache.clear();
  strengthCache.set(key, out);
  return out;
}

/** 드로우 여부: 플러시 드로우(4장) 또는 양방향 스트레이트 드로우 (플랍·턴) */
export function drawInfo(hole: Card[], board: Card[]): { flushDraw: boolean; oesd: boolean; gutshot: boolean } {
  if (board.length < 3 || board.length > 4) return { flushDraw: false, oesd: false, gutshot: false };
  const all = [...hole, ...board];
  const suitCnt = [0, 0, 0, 0];
  for (const c of all) suitCnt[c & 3]++;
  const holeSuits = hole.map((c) => c & 3);
  const flushDraw = suitCnt.some((n, s) => n === 4 && holeSuits.includes(s));
  let mask = 0;
  for (const c of all) mask |= 1 << (c >> 2);
  const m = ((mask << 1) | ((mask >> 12) & 1)) & 0x3fff;
  for (let lo = 0; lo <= 9; lo++) if (popcount((m >> lo) & 0x1f) === 5) return { flushDraw, oesd: false, gutshot: false }; // 이미 스트레이트
  // 스트레이트를 완성하는 랭크 수로 판정: 2개 이상 = 양방향(더블 거트 포함), 1개 = 거트샷
  //  (A-K-Q-J나 A-2-3-4처럼 한쪽이 막힌 4장은 거트샷과 같음)
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    const mm = mask | (1 << r);
    const m2 = ((mm << 1) | ((mm >> 12) & 1)) & 0x3fff;
    for (let lo = 0; lo <= 9; lo++) if (popcount((m2 >> lo) & 0x1f) === 5) { outs++; break; }
  }
  return { flushDraw, oesd: outs >= 2, gutshot: outs === 1 };
}

function popcount(x: number) { let c = 0; while (x) { x &= x - 1; c++; } return c; }

export interface EquityResult {
  eq: number;
  /** 첫 상대(헤즈업) 기준: 상대 강도 버킷별 내 에퀴티와 가중치 */
  bucketEq: number[];
  bucketW: number[];
}

class Sampler {
  idx: number[] = [];
  cum: number[] = [];
  total = 0;
  constructor(r: Range, dead: Set<number>) {
    for (let i = 0; i < 1326; i++) {
      const w = r[i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead.has(a) || dead.has(b)) continue;
      this.total += w; this.idx.push(i); this.cum.push(this.total);
    }
  }
  sample(rand: () => number): number {
    const x = rand() * this.total;
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cum[mid] < x) lo = mid + 1; else hi = mid; }
    return this.idx[lo];
  }
}

/**
 * hero 대 상대 레인지들의 에퀴티. 리버 헤즈업은 전수 비교, 나머지는 몬테카를로.
 */
export function equityVsRanges(hero: [Card, Card], board: Card[], ranges: Range[], samples: number, rand: () => number): EquityResult {
  const dead = new Set<number>([hero[0], hero[1], ...board]);
  const bucketEq = new Array(10).fill(0), bucketN = new Array(10).fill(0), bucketW = new Array(10).fill(0);
  const str = board.length >= 3 ? strengthOnBoard(board) : null;
  // 버킷 가중치 (첫 상대)
  if (ranges.length > 0) {
    for (let i = 0; i < 1326; i++) {
      const w = ranges[0][i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead.has(a) || dead.has(b)) continue;
      const bk = str ? Math.min(9, Math.floor(str[i] * 10)) : 0;
      bucketW[bk] += w;
    }
  }
  if (ranges.length === 0) return { eq: 1, bucketEq: bucketEq.fill(1), bucketW };

  // 리버 헤즈업: 전수
  if (board.length === 5 && ranges.length === 1) {
    for (let k = 0; k < 5; k++) buf7[k + 2] = board[k];
    buf7[0] = hero[0]; buf7[1] = hero[1];
    const my = evaluate(buf7, 7);
    let win = 0, tot = 0;
    for (let i = 0; i < 1326; i++) {
      const w = ranges[0][i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead.has(a) || dead.has(b)) continue;
      buf7[0] = a; buf7[1] = b;
      const op = evaluate(buf7, 7);
      const r = my > op ? 1 : my === op ? 0.5 : 0;
      win += w * r; tot += w;
      const bk = str ? Math.min(9, Math.floor(str[i] * 10)) : 0;
      bucketEq[bk] += w * r; bucketN[bk] += w;
    }
    for (let b = 0; b < 10; b++) bucketEq[b] = bucketN[b] > 0 ? bucketEq[b] / bucketN[b] : NaN;
    return { eq: tot > 0 ? win / tot : 0.5, bucketEq: fillNaN(bucketEq, win / Math.max(tot, 1e-9)), bucketW };
  }

  const samplers = ranges.map((r) => new Sampler(r, dead));
  if (samplers.some((s) => s.total <= 0)) return { eq: 0.5, bucketEq: bucketEq.fill(0.5), bucketW };
  const deckRest: number[] = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deckRest.push(c);
  const heroCards = new Int32Array(7), oppCards = new Int32Array(7);
  const need = 5 - board.length;
  let win = 0, n = 0;
  const used = new Uint8Array(52);
  for (let t = 0; t < samples; t++) {
    used.fill(0);
    const opp: number[] = [];
    let ok = true;
    for (const s of samplers) {
      let tries = 0, ci = -1;
      while (tries++ < 20) {
        const cand = s.sample(rand);
        const [a, b] = COMBOS[cand];
        if (!used[a] && !used[b]) { ci = cand; used[a] = 1; used[b] = 1; break; }
      }
      if (ci < 0) { ok = false; break; }
      opp.push(ci);
    }
    if (!ok) continue;
    // 보드 완성
    const fullBoard = [...board];
    let guard = 0;
    while (fullBoard.length < 5 && guard++ < 200) {
      const c = deckRest[Math.floor(rand() * deckRest.length)];
      if (!used[c] && !fullBoard.includes(c)) { used[c] = 1; fullBoard.push(c); }
    }
    void need;
    heroCards[0] = hero[0]; heroCards[1] = hero[1];
    for (let k = 0; k < 5; k++) { heroCards[k + 2] = fullBoard[k]; oppCards[k + 2] = fullBoard[k]; }
    const my = evaluate(heroCards, 7);
    let best = 0, ties = 0, lose = false;
    for (const ci of opp) {
      const [a, b] = COMBOS[ci];
      oppCards[0] = a; oppCards[1] = b;
      const op = evaluate(oppCards, 7);
      if (op > my) { lose = true; break; }
      if (op === my) ties++;
      best = Math.max(best, op);
    }
    const r = lose ? 0 : ties > 0 ? 1 / (ties + 1) : 1;
    win += r; n++;
    const bk = str ? Math.min(9, Math.floor(str[opp[0]] * 10)) : 0;
    bucketEq[bk] += r; bucketN[bk]++;
  }
  const eq = n > 0 ? win / n : 0.5;
  for (let b = 0; b < 10; b++) bucketEq[b] = bucketN[b] >= 3 ? bucketEq[b] / bucketN[b] : NaN;
  return { eq, bucketEq: fillNaN(bucketEq, eq), bucketW };
}

function fillNaN(a: number[], fallback: number): number[] {
  // 비어 있는 버킷은 가까운 버킷 값, 없으면 전체 에퀴티
  return a.map((v, i) => {
    if (!Number.isNaN(v)) return v;
    for (let d = 1; d < 10; d++) {
      if (i - d >= 0 && !Number.isNaN(a[i - d])) return a[i - d];
      if (i + d < 10 && !Number.isNaN(a[i + d])) return a[i + d];
    }
    return fallback;
  });
}

/** 상대가 레인지 상위 c(0..1)로만 계속할 때 그 레인지 상대 내 에퀴티 */
export function eqVsTop(res: EquityResult, c: number): number {
  const total = res.bucketW.reduce((a, b) => a + b, 0);
  if (total <= 0) return res.eq;
  let need = total * Math.max(0.01, Math.min(1, c));
  let acc = 0, w = 0;
  for (let b = 9; b >= 0 && need > 1e-9; b--) {
    const take = Math.min(res.bucketW[b], need);
    acc += take * res.bucketEq[b]; w += take; need -= take;
  }
  return w > 0 ? acc / w : res.eq;
}
