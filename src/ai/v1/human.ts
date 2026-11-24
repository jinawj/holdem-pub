// 사람다움: 실수 온도, 금액 반올림, 고민 시간, 기분·기억 갱신, 쇼다운 행동 (overview 3.7, 3.8)
import { AI } from '../../config';
import type { Card } from '../../engine/cards';
import { categoryOf, evaluate } from '../../engine/evaluator';
import type { Ctx } from './context';
import { levelFx } from './persona';
import type { AiMemory, AiProfile, Option } from './types';

/** 실력 온도: 균등 분포와 섞기 */
export function applyTemperature(probs: number[], prof: AiProfile): number[] {
  const e = levelFx(prof.level).noise;
  if (e <= 0) return probs;
  const u = 1 / probs.length;
  return probs.map((p) => (1 - e) * p + e * u);
}

/** 사람이 낼 법한 금액으로 반올림 + 레벨별 사이즈 실수 */
export function humanizeSize(to: number, ctx: Ctx, prof: AiProfile, rand: () => number): number {
  const L = ctx.view.legal;
  if (to >= L.maxRaiseTo) return L.maxRaiseTo;
  const fx = levelFx(prof.level);
  let t = to;
  const leakMin = prof.leaks.find((l) => l.id === 'minRaise');
  if ((leakMin && rand() < leakMin.adherence * 0.5) || rand() < fx.sizingMistake * 0.4) t = L.minRaiseTo;
  else if (rand() < fx.sizingMistake) t = t * (0.6 + rand() * 0.9);
  const unit = t < 2000 ? 100 : t < 10000 ? 500 : t < 50000 ? 1000 : 5000;
  t = Math.round(t / unit) * unit;
  if (t < L.minRaiseTo) t = L.minRaiseTo;
  if (t > L.maxRaiseTo || L.maxRaiseTo - t < unit) t = L.maxRaiseTo;
  return t;
}

/** 고민 시간 (계산 시간과 분리된 연출) */
export function thinkTime(ctx: Ctx, opt: Option, probs: number[], prof: AiProfile, rand: () => number, speedMult: number): number {
  const T = AI.thinkMs;
  const sorted = [...probs].sort((a, b) => b - a);
  const difficulty = 1 - Math.min(1, (sorted[0] ?? 1) - (sorted[1] ?? 0));
  const size = Math.min(1, ctx.pot / (25 * ctx.bb));
  let ms = T.base + T.perDifficulty * difficulty * (0.4 + 0.6 * size) + T.random * rand();
  if (ctx.street === 'preflop' && opt.act === 'fold' && ctx.pct > 45) ms = 250 + 400 * rand(); // 쓰레기 패는 빠르게
  if (opt.act === 'call' && (ctx.flushDraw || ctx.oesd) && rand() < 0.5) ms = T.snap + 300 * rand(); // 드로우 스냅콜
  if (opt.act === 'fold' && difficulty > 0.5) ms += 700 * rand(); // 오래 고민하다 폴드
  if (prof.personaId === 'beginner' && opt.act === 'raise' && (ctx.madeCat >= 3)) ms += 1200; // 초보: 강한 패일 때 오래 고민
  return Math.round(ms * speedMult);
}

export interface HandSummaryForAi {
  mySeat: number;
  startStack: number;
  endStack: number;
  bb: number;
  vpip: boolean; // 프리플랍에 자발적으로 참여
  foldedPreflop: boolean;
  board: Card[];
  /** 쇼다운에서 공개된 카드 */
  shown: { seat: number; hole: Card[]; riverBetter: boolean; bigBet: boolean; won: boolean }[];
  /** 내가 블러프하다 들켰는지 */
  myBluffCaught: boolean;
  biggestWinnerAgainstMe: number | null;
}

export function updateMemory(mem: AiMemory, prof: AiProfile, s: HandSummaryForAi, recallEnabled: boolean): AiMemory {
  const m: AiMemory = { ...mem, recall: mem.recall.map((r) => ({ ...r, handsLeft: r.handsLeft - 1 })).filter((r) => r.handsLeft > 0) };
  m.handsPlayed++;
  m.tilt *= AI.tiltDecay;
  m.confidence *= 0.9;
  if (m.caughtBluff > 0) m.caughtBluff--;
  const delta = s.endStack - s.startStack;
  if (delta < -0.3 * s.startStack && s.startStack > 0) m.tilt = Math.min(1, m.tilt + 0.5);
  else if (delta < -15 * s.bb) m.tilt = Math.min(1, m.tilt + 0.2);
  if (delta > 10 * s.bb) m.confidence = Math.min(1, m.confidence + 0.3);
  m.foldStreak = s.foldedPreflop ? m.foldStreak + 1 : 0;
  if (s.myBluffCaught) m.caughtBluff = 3;
  if (recallEnabled && prof.p.recall > 0) {
    const hands = Math.round(AI.recallHands * prof.p.recall) + 1;
    for (const sh of s.shown) {
      if (sh.seat === s.mySeat || !sh.riverBetter || s.board.length < 5) continue;
      const cat = categoryOf(evaluate([...sh.hole, ...s.board]));
      const boardCat = categoryOf(evaluate(s.board));
      if (cat <= Math.max(1, boardCat)) m.recall.push({ seat: sh.seat, kind: 'sawBluff', handsLeft: hands });
      else if (sh.bigBet && cat >= 4) m.recall.push({ seat: sh.seat, kind: 'sawNutsBigBet', handsLeft: hands });
    }
    if (s.biggestWinnerAgainstMe !== null && delta < -20 * s.bb) m.recall.push({ seat: s.biggestWinnerAgainstMe, kind: 'beatMeBig', handsLeft: hands });
  }
  return m;
}

/** 단순 기억 반응: 지금 벳한 상대에 대한 감정적 조정 */
export function recallAdjust(mem: AiMemory, prof: AiProfile, aggressor: number | null, enabled: boolean) {
  const out = { callBoost: 0, foldBoost: 0 };
  if (!enabled || aggressor === null) return out;
  const k = prof.p.recall;
  for (const r of mem.recall) {
    if (r.seat !== aggressor) continue;
    if (r.kind === 'sawBluff') out.callBoost += 0.06 * k;
    if (r.kind === 'sawNutsBigBet') out.foldBoost += 0.06 * k;
    if (r.kind === 'beatMeBig' && mem.tilt > 0.3) out.callBoost += 0.05 * k;
  }
  return out;
}

/** 쇼다운 행동: 보여주지 않아도 되는 카드를 보여줄지 */
export function wantsToShow(prof: AiProfile, won: boolean, wasBluff: boolean, rand: () => number): boolean {
  switch (prof.p.showdownStyle) {
    case 'quiet': return false;
    case 'sometimes': return rand() < 0.15;
    case 'shows': return rand() < 0.5;
    case 'showsBluffs': return wasBluff ? rand() < 0.5 : rand() < 0.15;
    case 'showsWins': return won && rand() < 0.7;
  }
}
