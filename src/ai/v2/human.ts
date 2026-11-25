// 사람다움: 실수 온도, 금액 반올림, 고민 시간, 기분·기억 갱신, 쇼다운 행동 (overview 3.7, 3.8)
import { AI } from '../../config';
import type { Card } from '../../engine/cards';
import { categoryOf, evaluate } from '../../engine/evaluator';
import type { Ctx } from './context';
import { levelFx } from './persona';
import type { AiMemory, AiProfile, Option } from './types';

/** 실력 온도: 균등 분포와 섞기 */
export function applyTemperature(probs: number[], prof: AiProfile, options?: Option[]): number[] {
  const e = levelFx(prof.level).noise;
  if (e <= 0) return probs;
  if (!options) { const u = 1 / probs.length; return probs.map((p) => (1 - e) * p + e * u); }
  // 하수의 실수는 '수동적인' 방향 (조사: 과다 콜·체크, 공격은 강한 패일 때만)
  // → 흐트러진 확률의 70%는 체크/콜로, 20%는 폴드로, 10%만 벳·레이즈로
  const target = options.map((o) => (o.act === 'check' || o.act === 'call' ? 0.7 : o.act === 'fold' ? 0.2 : 0.1));
  const nRaise = options.filter((o) => o.act === 'raise').length || 1;
  const tw = target.map((t, i) => (options[i].act === 'raise' ? t / nRaise : t));
  const s = tw.reduce((a, b) => a + b, 0) || 1;
  return probs.map((p, i) => (1 - e) * p + e * (tw[i] / s));
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
  // v2: 같은 크기가 기계적으로 반복되지 않게 포스트플랍 벳은 ±12% 정도 흔들기 (사람은 매번 정확히 같은 비율로 안 냄)
  else if (ctx.street !== 'preflop' && !(prof.tells ?? []).length) t = L.committed + (t - L.committed) * (0.88 + rand() * 0.24);
  const unit = t < 2000 ? 100 : t < 10000 ? 500 : t < 50000 ? 1000 : 5000;
  t = Math.round(t / unit) * unit;
  if (t < L.minRaiseTo) t = L.minRaiseTo;
  if (t > L.maxRaiseTo || L.maxRaiseTo - t < unit) t = L.maxRaiseTo;
  // v2: 포스트플랍 벳(받은 벳 없음)은 팟의 20% 이상 — 셋·풀하우스로 1BB 벳 같은 어색한 크기 방지
  if (ctx.street !== 'preflop' && L.currentBet === 0 && t < L.maxRaiseTo) {
    const floor = Math.ceil(((0.22 + rand() * 0.1) * ctx.pot) / unit) * unit;
    if (t < floor) t = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, floor));
  }
  return t;
}

/** 고민 시간 (계산 시간과 분리된 연출) */
export function thinkTime(ctx: Ctx, opt: Option, probs: number[], prof: AiProfile, rand: () => number, speedMult: number, eq?: number): number {
  const ms0 = baseThink(ctx, opt, probs, prof, rand);
  // 텔(버릇): 낮은 레벨 AI만. 같은 사람은 매번 같은 방향으로 → 지켜보면 읽을 수 있음
  const tells = prof.tells ?? [];
  let ms = ms0;
  const strong = (eq ?? 0) > 0.75 || ctx.madeCat >= 3;
  const aggressive = opt.act === 'raise';
  if (tells.includes('strongTank') && strong && (aggressive || opt.act === 'call') && ctx.street !== 'preflop') ms = ms0 + 1300 + 900 * rand();
  if (tells.includes('weakSnap') && aggressive && (eq ?? 1) < 0.3 && ctx.street !== 'preflop') ms = 300 + 300 * rand();
  return Math.round(ms * speedMult);
}

function baseThink(ctx: Ctx, opt: Option, probs: number[], prof: AiProfile, rand: () => number): number {
  const T = AI.thinkMs;
  const sorted = [...probs].sort((a, b) => b - a);
  const difficulty = 1 - Math.min(1, (sorted[0] ?? 1) - (sorted[1] ?? 0));
  const size = Math.min(1, ctx.pot / (25 * ctx.bb));
  let ms = T.base + T.perDifficulty * difficulty * (0.4 + 0.6 * size) + T.random * rand();
  if (ctx.street === 'preflop' && opt.act === 'fold' && ctx.pct > 45) ms = 250 + 400 * rand(); // 쓰레기 패는 빠르게
  if (opt.act === 'call' && (ctx.flushDraw || ctx.oesd) && rand() < 0.5) ms = T.snap + 300 * rand(); // 드로우 스냅콜
  if (opt.act === 'fold' && difficulty > 0.5) ms += 700 * rand(); // 오래 고민하다 폴드
  if (prof.personaId === 'beginner' && opt.act === 'raise' && (ctx.madeCat >= 3)) ms += 1200; // 초보: 강한 패일 때 오래 고민
  // 큰 결정은 사람처럼 오래: 올인(또는 스택의 큰 부분)에 콜·폴드를 정할 때, 내가 올인할 때
  const L = ctx.view.legal;
  const myTotal = L.stack + L.committed;
  const bigCall = ctx.toCall > 0 && ctx.toCall >= 0.4 * myTotal;
  const shoving = opt.act === 'raise' && opt.to !== undefined && opt.to >= L.maxRaiseTo;
  if (bigCall && opt.act !== 'raise') ms += 1500 + 1500 * rand();
  else if (shoving) ms += 800 + 900 * rand();
  return ms;
}

/** 금액 텔: 큰 벳=강함 / 강할수록 작게 (낮은 레벨만) */
export function sizeTell(options: Option[], chosen: Option, eq: number, prof: AiProfile, ctx: Ctx): Option {
  const tells = prof.tells ?? [];
  if (chosen.act !== 'raise' || ctx.street === 'preflop') return chosen;
  const bets = options.filter((o) => o.act === 'raise' && o.to !== undefined).sort((a, b) => a.to! - b.to!);
  if (bets.length < 2) return chosen;
  if (tells.includes('bigMeansStrong')) return eq > 0.7 ? bets[bets.length - 1] : bets[0];
  if (tells.includes('strongSmallBet')) return eq > 0.75 ? bets[0] : eq < 0.3 ? bets[bets.length - 1] : chosen;
  return chosen;
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
