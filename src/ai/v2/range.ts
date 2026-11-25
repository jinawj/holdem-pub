// 상대 레인지 추적: 공개 액션으로 1326 콤보 가중치를 베이즈 갱신 (overview 3.5 ①)
// "평균적인 플레이어" 모델 기준. 특정 상대 통계는 쓰지 않는다(착취 없음).
import { COMBOS, COMBO_KEYS } from '../../engine/cards';
import { AI } from '../../config';
import type { PlayerView } from '../../engine/view';
import { keyPct, isBluffCandidate } from './handrank';
import { drawInfo, Range, strengthOnBoard, uniformRange } from './equity';
import { hasPushTable, pushMargin } from './pushfold';

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const PCT = COMBO_KEYS.map((k) => keyPct(k));
const BLUFFY = COMBO_KEYS.map((k) => isBluffCandidate(k));

const drawCache = new Map<string, Uint8Array>();
function drawFlags(board: number[]): Uint8Array {
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

export function openPctFor(behind: number): number {
  const t = AI.openPctByBehind;
  return t[Math.max(1, Math.min(9, behind))] ?? 15;
}

export function pushPctFor(effBB: number, behind: number): number {
  const base = AI.pushPctAt10bb[Math.max(1, Math.min(9, behind))] ?? 15;
  return Math.max(2, Math.min(100, base * Math.pow(10 / Math.max(1, effBB), 0.75)));
}

/** 프리플랍 행동 순서 (BB 다음부터) */
export function preflopOrder(view: PlayerView): number[] {
  const seats = view.seats.map((s) => s.seat);
  const out: number[] = [];
  for (let i = 1; i <= view.numSeats; i++) { const s = (view.bbSeat + i) % view.numSeats; if (seats.includes(s)) out.push(s); }
  return out;
}

export function behindPreflop(view: PlayerView, seat: number): number {
  const ord = preflopOrder(view);
  return ord.length - 1 - ord.indexOf(seat);
}

export interface RangeOpts { thinking: 'none' | 'rough' | 'full'; /** rough일 때 실제 레인지 반영 비율 */ weight?: number }

export function buildRange(view: PlayerView, seat: number, opts: RangeOpts): Range {
  const dead = [...view.holeCards, ...view.board];
  const r = uniformRange(dead);
  if (opts.thinking === 'none') return r;
  const bb = view.level.bb;
  const st = view.seats.find((s) => s.seat === seat)!;
  const behind = behindPreflop(view, seat);
  let raises = 0;
  // 각 액션 직전의 팟 크기 (벳 크기 비율 계산용)
  let potRun = 0;
  let lastOpenPct = 20;
  for (const a of view.actionLog) {
    const potBefore = potRun;
    potRun += a.amount;
    if (a.type === 'ante' || a.type === 'sb' || a.type === 'bb') continue;
    if (a.street === 'preflop') {
      if (a.seat === seat) {
        const stackBB = (st.startStack) / bb;
        if (a.type === 'raise' || a.type === 'bet') {
          let f: (p: number, i: number) => number;
          if (a.allIn && stackBB <= 18 && raises === 0 && hasPushTable(stackBB)) {
            // 첫 올인: 직접 계산한 푸시 균형 표 기준 (경계는 부드럽게)
            const anteBB = view.level.ante / bb;
            // 경계 폭은 좁게: 폭이 넓으면 올인 안 하는 수많은 쓰레기 패에 가중치가 붙어 범위가 2배로 넓어짐 (UTG 10BB 14%→30%)
            f = (_p, i) => { const m = pushMargin(COMBO_KEYS[i], behind, stackBB, anteBB); return m === null ? 0.5 : sig(m / AI.pushRangeEdgeV2); };
          } else if (a.allIn && stackBB <= 18) {
            const pp = raises === 0 ? pushPctFor(stackBB, behind) : Math.max(4, lastOpenPct * 0.45);
            f = (p) => sig((pp - p) / 3);
          } else if (raises === 0) {
            const o = openPctFor(behind);
            f = (p) => sig((o - p) / 3);
          } else if (raises === 1) {
            const v = AI.threeBetValueRatio * lastOpenPct + 1.5;
            f = (p, i) => Math.max(sig((v - p) / 1.5), BLUFFY[i] ? 0.35 : 0.02);
          } else {
            f = (p) => Math.max(sig((3 - p) / 1.2), 0.01);
          }
          for (let i = 0; i < 1326; i++) if (r[i] > 0) r[i] *= f(PCT[i], i);
        } else if (a.type === 'call') {
          let f: (p: number) => number;
          if (raises === 0) f = (p) => sig((45 - p) / 6) * (1 - 0.5 * sig((6 - p) / 2));
          else if (raises === 1) {
            const isBB = seat === view.bbSeat;
            const cMax = (AI.threeBetValueRatio + AI.callRatio * (isBB ? 1.6 : 1.2)) * lastOpenPct + 2;
            const vMin = AI.threeBetValueRatio * lastOpenPct;
            f = (p) => sig((cMax - p) / 4) * (1 - 0.6 * sig((vMin - p) / 1.5));
          } else f = (p) => sig((8 - p) / 2.5) * (1 - 0.5 * sig((2 - p) / 1));
          for (let i = 0; i < 1326; i++) if (r[i] > 0) r[i] *= f(PCT[i]);
        } else if (a.type === 'check') {
          for (let i = 0; i < 1326; i++) if (r[i] > 0) r[i] *= 1 - 0.7 * sig((10 - PCT[i]) / 3);
        }
      }
      if (a.type === 'raise' || a.type === 'bet') {
        if (raises === 0) lastOpenPct = openPctFor(behindPreflop(view, a.seat));
        raises++;
      }
      continue;
    }
    if (a.seat !== seat) continue;
    const boardAt = view.board.slice(0, a.street === 'flop' ? 3 : a.street === 'turn' ? 4 : 5);
    if (boardAt.length < 3) continue;
    const str = strengthOnBoard(boardAt);
    const dr = drawFlags(boardAt);
    for (let i = 0; i < 1326; i++) {
      if (r[i] <= 0) continue;
      const s = str[i], d = dr[i] === 2 ? 1 : dr[i] === 1 ? 0.4 : 0;
      let like = 1;
      // 벳: 밸류(강할수록) + 블러프(약할수록). 크게 벳할수록 양극화 → 블러프 비중 ↑ (사람들도 큰 벳으로 블러프함)
      if (a.type === 'bet' || a.type === 'raise') {
        const frac = potBefore > 0 ? a.amount / potBefore : 0.5;
        const bluffW = (a.street === 'river' ? 0.22 : 0.14) * Math.min(1.5, 0.5 + frac);
        const value = a.type === 'bet' ? 0.06 + 0.94 * Math.pow(s, 2.2) : 0.03 + 0.97 * Math.pow(s, 3);
        like = value + bluffW * Math.pow(1 - s, 2) + (a.type === 'bet' ? 0.35 : 0.25) * d;
      }
      else if (a.type === 'call') like = (0.15 + 0.85 * sig((s - 0.4) / 0.12) + 0.4 * d) * (1 - 0.35 * Math.pow(s, 6));
      else if (a.type === 'check') like = 1 - 0.55 * Math.pow(s, 3);
      r[i] *= like;
    }
  }
  if (opts.thinking === 'rough') {
    let tot = 0, cnt = 0;
    for (let i = 0; i < 1326; i++) if (r[i] > 0) { tot += r[i]; cnt++; }
    const avg = cnt > 0 ? tot / cnt : 1;
    const u = uniformRange(dead);
    const k = opts.weight ?? 0.5;
    for (let i = 0; i < 1326; i++) r[i] = k * r[i] + (1 - k) * u[i] * avg;
  }
  return r;
}
