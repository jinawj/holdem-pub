// 레인지 모듈: 공개 액션으로 1326 콤보 가중치를 갱신. 상대 레인지와 '내 레인지'(상대가 보는 나) 둘 다 만든다.
//  라인 읽기 결과(블러프 가능성·캡)를 반영. 평균적인 플레이어 모델 + 상대 기억.
import { COMBOS, COMBO_KEYS } from '../../engine/cards';
import { AI, AI_V3 } from '../../config';
import type { PlayerView } from '../../engine/view';
import { keyPct, isBluffCandidate } from '../core/handrank';
import { drawInfo, Range, strengthOnBoard } from '../core/equity';
import { hasPushTable, pushMargin } from '../core/pushfold';
import { behindPreflop } from './context';
import { STREETS } from './line';

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const PCT = COMBO_KEYS.map((k) => keyPct(k));
const BLUFFY = COMBO_KEYS.map((k) => isBluffCandidate(k));

const drawCache = new Map<string, Uint8Array>();
/** 콤보별 드로우: 2 = 플러시 드로우·양방향, 1 = 거트샷, 0 = 없음 */
export function drawFlags(board: number[]): Uint8Array {
  const key = board.join(',');
  const c = drawCache.get(key);
  if (c) return c;
  const out = new Uint8Array(1326);
  if (board.length >= 3 && board.length <= 4) {
    for (let i = 0; i < 1326; i++) {
      const d = drawInfo(COMBOS[i], board);
      out[i] = d.flushDraw || d.oesd ? 2 : d.gutshot ? 1 : 0;
    }
  }
  if (drawCache.size > 64) drawCache.clear();
  drawCache.set(key, out);
  return out;
}

/** 오픈 범위(%). 헤즈업 테이블(2명)의 SB 오픈은 따로 (AI_V3.huOpen) */
export function openPctFor(behind: number, hu = false): number {
  if (hu) return AI_V3.huOpen;
  return AI.openPctByBehind[Math.max(1, Math.min(9, behind))] ?? 15;
}
export function pushPctFor(effBB: number, behind: number): number {
  const base = AI.pushPctAt10bb[Math.max(1, Math.min(9, behind))] ?? 15;
  return Math.max(2, Math.min(100, base * Math.pow(10 / Math.max(1, effBB), 0.75)));
}

export interface RangeOpts {
  /** 0 = 아무 패나(라인 무시), 1 = 라인대로 */
  read: number;
  /** 빼야 할 카드 (기본: 내 카드 + 보드). 내 레인지를 만들 땐 보드만 */
  dead?: number[];
  /** 이 스트리트부터의 액션은 무시 (리버 솔버: 리버 시작 시점 레인지) */
  until?: (typeof STREETS)[number];
  /** 이 좌석의 블러프 비중 배수 (라인 읽기·기억) */
  bluffMult?: number;
}

export function blankRange(dead: number[]): Range {
  const r = new Float64Array(1326);
  const d = new Set(dead);
  for (let i = 0; i < 1326; i++) { const [a, b] = COMBOS[i]; r[i] = d.has(a) || d.has(b) ? 0 : 1; }
  return r;
}

export function buildRange(view: PlayerView, seat: number, o: RangeOpts): Range {
  const dead = o.dead ?? [...view.holeCards, ...view.board];
  const r = blankRange(dead);
  if (o.read <= 0) return r;
  const bb = view.level.bb;
  const st = view.seats.find((s) => s.seat === seat)!;
  const behind = behindPreflop(view, seat);
  const stopAt = o.until ? STREETS.indexOf(o.until) : 99;
  const bm = o.bluffMult ?? 1;
  let raises = 0, potRun = 0, lastOpenPct = 20;
  for (const a of view.actionLog) {
    const potBefore = potRun;
    potRun += a.amount;
    if (a.type === 'ante' || a.type === 'sb' || a.type === 'bb') continue;
    if (STREETS.indexOf(a.street as (typeof STREETS)[number]) >= stopAt) break;
    if (a.street === 'preflop') {
      if (a.seat === seat) {
        const stackBB = st.startStack / bb;
        let f: ((p: number, i: number) => number) | null = null;
        if (a.type === 'raise' || a.type === 'bet') {
          if (a.allIn && stackBB <= 18 && raises === 0 && hasPushTable(stackBB)) {
            const anteBB = view.level.ante / bb;
            f = (_p, i) => { const m = pushMargin(COMBO_KEYS[i], behind, stackBB, anteBB); return m === null ? 0.5 : sig(m / AI.pushRangeEdgeV2); };
          } else if (a.allIn && stackBB <= 18) {
            const pp = raises === 0 ? pushPctFor(stackBB, behind) : Math.max(4, lastOpenPct * 0.45);
            f = (p) => sig((pp - p) / 3);
          } else if (raises === 0) {
            const op = openPctFor(behind, view.seats.length === 2);
            f = (p) => sig((op - p) / 3);
          } else if (raises === 1) {
            const v = AI.threeBetValueRatio * lastOpenPct + 1.5;
            f = (p, i) => Math.max(sig((v - p) / 1.5), BLUFFY[i] ? 0.35 : 0.02);
          } else f = (p) => Math.max(sig((3 - p) / 1.2), 0.01);
        } else if (a.type === 'call') {
          if (raises === 0) f = (p) => sig((45 - p) / 6) * (1 - 0.5 * sig((6 - p) / 2));
          else if (raises === 1) {
            const isBB = seat === view.bbSeat;
            const cMax = (AI.threeBetValueRatio + AI.callRatio * (isBB ? 1.6 : 1.2)) * lastOpenPct + 2;
            const vMin = AI.threeBetValueRatio * lastOpenPct;
            f = (p) => sig((cMax - p) / 4) * (1 - 0.6 * sig((vMin - p) / 1.5));
          } else f = (p) => sig((8 - p) / 2.5) * (1 - 0.5 * sig((2 - p) / 1));
        } else if (a.type === 'check') f = (p) => 1 - 0.7 * sig((10 - p) / 3);
        if (f) for (let i = 0; i < 1326; i++) if (r[i] > 0) r[i] *= f(PCT[i], i);
      }
      if (a.type === 'raise' || a.type === 'bet') {
        if (raises === 0) lastOpenPct = openPctFor(behindPreflop(view, a.seat), view.seats.length === 2);
        raises++;
      }
      continue;
    }
    if (a.seat !== seat) continue;
    const boardAt = view.board.slice(0, a.street === 'flop' ? 3 : a.street === 'turn' ? 4 : 5);
    if (boardAt.length < 3) continue;
    const str = strengthOnBoard(boardAt);
    const dr = drawFlags(boardAt);
    const river = a.street === 'river';
    if (a.type === 'bet' || a.type === 'raise') {
      // 벳·레이즈 레인지 = 밸류 (1−β) + 블러프·세미블러프 β 로 '구성'을 정한다.
      //  (가중치를 그냥 곱하면 약한 패 콤보가 워낙 많아서 레인지가 블러프 투성이로 추정됨 → 체크레이즈 라인에 계속 콜하던 문제)
      const frac = potBefore > 0 ? a.amount / potBefore : 0.5;
      const raise = a.type === 'raise';
      const base = raise ? AI_V3.rangeBluffShare.raise : AI_V3.rangeBluffShare.bet;
      // 리버 벳은 크기별로: 작은 벳(팟 50% 이하)은 블러프가 더 섞이고, 오버벳은 덜 (사람 경향)
      const rSize = river && !raise ? (frac <= 0.5 ? AI_V3.riverBluffBySize.small : frac > 1.1 ? AI_V3.riverBluffBySize.over : 1) : 1;
      const beta = Math.max(0.03, Math.min(0.5, base[a.street as 'flop' | 'turn' | 'river'] * rSize * bm));
      const k = raise ? 4 : 2.5 + Math.max(0, frac - 0.6) * 1.5; // 크게 걸수록 밸류 쪽이 더 강함
      let V = 0, Bm = 0;
      const vv = new Float64Array(1326), bb2 = new Float64Array(1326);
      for (let i = 0; i < 1326; i++) {
        if (r[i] <= 0) continue;
        const s = str[i], d = dr[i] === 2 ? 1 : dr[i] === 1 ? 0.4 : 0;
        vv[i] = Math.pow(s, k);
        bb2[i] = river ? Math.pow(1 - s, 2) * (s < 0.5 ? 1 : 0.2) : 0.6 * d + 0.25 * Math.pow(1 - s, 2) * (s < 0.5 ? 1 : 0.2);
        V += r[i] * vv[i]; Bm += r[i] * bb2[i];
      }
      for (let i = 0; i < 1326; i++) {
        if (r[i] <= 0) continue;
        r[i] *= (V > 0 ? ((1 - beta) * vv[i]) / V : 0) + (Bm > 0 ? (beta * bb2[i]) / Bm : 0) + 1e-6;
      }
      continue;
    }
    for (let i = 0; i < 1326; i++) {
      if (r[i] <= 0) continue;
      const s = str[i], d = dr[i] === 2 ? 1 : dr[i] === 1 ? 0.4 : 0;
      let like = 1;
      if (a.type === 'call') like = (0.15 + 0.85 * sig((s - 0.4) / 0.12) + 0.4 * d) * (1 - 0.35 * Math.pow(s, 6));
      else if (a.type === 'check') like = 1 - 0.55 * Math.pow(s, 3);
      r[i] *= like;
    }
  }
  if (o.read < 1) {
    let tot = 0, cnt = 0;
    for (let i = 0; i < 1326; i++) if (r[i] > 0) { tot += r[i]; cnt++; }
    const avg = cnt > 0 ? tot / cnt : 1;
    const u = blankRange(dead);
    for (let i = 0; i < 1326; i++) r[i] = o.read * r[i] + (1 - o.read) * u[i] * avg;
  }
  return r;
}

/** 내 콤보 인덱스 */
export function comboIndex(a: number, b: number): number {
  for (let i = 0; i < 1326; i++) { const [x, y] = COMBOS[i]; if ((x === a && y === b) || (x === b && y === a)) return i; }
  return -1;
}

/**
 * 레인지 요약: 가중 평균 강도, 넛 비중(강도 0.9+), 콤보별 '실효 강도'(드로우 반영)
 */
export function rangeSummary(r: Range, board: number[]): { avg: number; nuts: number; eff: Float32Array } {
  const str = strengthOnBoard(board);
  const dr = drawFlags(board);
  const drawBonus = board.length === 3 ? 0.28 : board.length === 4 ? 0.18 : 0;
  const eff = new Float32Array(1326);
  let w = 0, s = 0, nuts = 0;
  for (let i = 0; i < 1326; i++) {
    const x = str[i];
    eff[i] = Math.min(1, Math.max(x, dr[i] === 2 ? 0.45 + drawBonus : dr[i] === 1 ? 0.3 + drawBonus * 0.5 : x));
    if (r[i] <= 0) continue;
    w += r[i]; s += r[i] * x; if (x >= 0.9) nuts += r[i];
  }
  return { avg: w > 0 ? s / w : 0.5, nuts: w > 0 ? nuts / w : 0, eff };
}

/** 레인지 안에서 값 v보다 큰(강한) 콤보의 가중 비율 */
export function massAbove(r: Range, val: Float32Array, v: number, exclude?: Set<number>): number {
  let w = 0, a = 0;
  for (let i = 0; i < 1326; i++) {
    if (r[i] <= 0) continue;
    const [x, y] = COMBOS[i];
    if (exclude && (exclude.has(x) || exclude.has(y))) continue;
    w += r[i]; if (val[i] > v) a += r[i];
  }
  return w > 0 ? a / w : 0;
}
