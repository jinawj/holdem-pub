// 포스트플랍: 레인지 상대 에퀴티 + 블러프 비율 b/(P+2b) + MDF P/(P+b) + 텍스처 사이즈 + EV(평균적 상대) (overview 3.5)
import { AI } from '../../config';
import type { Ctx } from './context';
import { equityVsRanges, eqVsTop, EquityResult } from './equity';
import { levelFx } from './persona';
import { legalTo, moodAdj, PolicyOut } from './preflop';
import { buildRange } from './range';
import type { AiMemory, AiProfile, Option } from './types';

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export interface PostOut extends PolicyOut { eqRes: EquityResult; base: number[]; evDist: number[] }

export function betSizesFor(ctx: Ctx, prof: AiProfile): number[] {
  let sizes: number[];
  if (ctx.street === 'river') sizes = [0.5, 1.0];
  else if (ctx.wet < 0.3) sizes = [0.33, 0.66];
  else sizes = [0.66, 1.0];
  if (prof.p.sizing === 'overbet') sizes = [...sizes, 1.5];
  if (prof.p.sizing === 'small') sizes = [0.33, 0.5];
  return sizes;
}

export function postflopPolicy(ctx: Ctx, prof: AiProfile, mem: AiMemory, rand: () => number, quick: boolean, recallAdj: { callBoost: number; foldBoost: number }): PostOut {
  const L = ctx.view.legal;
  const p = prof.p;
  const fx = levelFx(prof.level);
  const mood = moodAdj(prof, mem);
  const aggr = p.aggression + mood.aggr;
  const thinking = fx.rangeWeight <= 0 ? 'none' : fx.rangeWeight >= 1 ? 'full' : 'rough';
  const ranges = ctx.oppSeats.map((s) => buildRange(ctx.view, s, { thinking, weight: fx.rangeWeight }));
  const samples = quick ? AI.mcSamples.quick : AI.mcSamples.normal;
  const eqRes = equityVsRanges(ctx.view.holeCards, ctx.view.board, ranges, samples, rand);
  const eq = eqRes.eq;
  const n = ctx.numOpp;
  const pot = ctx.pot;
  const river = ctx.street === 'river';
  const real = river ? 1 : ctx.ip ? 0.95 : 0.85;
  const draw = !river && (ctx.flushDraw || ctx.oesd) ? 1 : !river && ctx.gutshot ? 0.4 : 0;
  const options: Option[] = [];
  const base: number[] = [];

  /** 평균적인 상대가 계속할 비율 */
  const contFrac = (b: number, P: number) => clamp((P / (P + b)) * 0.95, 0.08, 0.95);
  const eqWhenCalled = (c: number) => (n === 1 ? eqVsTop(eqRes, c) : eq * 0.85);
  const allFold = (c: number) => Math.pow(1 - c, Math.max(1, n));

  if (!ctx.facingBet) {
    options.push({ key: 'check', act: 'check', ev: eq * pot * real });
    const sizes = L.canRaise ? betSizesFor(ctx, prof) : [];
    const betOpts: Option[] = [];
    for (const s of sizes) {
      const to = legalTo(ctx, Math.max(ctx.bb, pot * s));
      if (betOpts.some((o) => o.to === to)) continue;
      const b = to - L.committed;
      const c = contFrac(b, pot);
      const f = allFold(c);
      const ev = f * pot + (1 - f) * (eqWhenCalled(c) * (pot + 2 * b) - b);
      betOpts.push({ key: 'raise:' + to, act: 'raise', to, ev });
    }
    if (L.canRaise && ctx.spr < 1.3 && !betOpts.some((o) => o.to === L.maxRaiseTo)) {
      const b = L.maxRaiseTo - L.committed;
      const c = contFrac(b, pot);
      const f = allFold(c);
      betOpts.push({ key: 'raise:' + L.maxRaiseTo, act: 'raise', to: L.maxRaiseTo, ev: f * pot + (1 - f) * (eqWhenCalled(c) * (pot + 2 * b) - b) });
    }
    options.push(...betOpts);

    // ---- 기본(균형) 전략 ----
    const vt = (river ? 0.6 : 0.64) + 0.07 * (n - 1);
    const pValue = sig((eq - vt) / 0.05);
    let pBluff = 0;
    if (eq < 0.35) {
      if (river) {
        const b = 0.75; // 대표 크기
        const r = b / (1 + 2 * b);
        pBluff = (r / (1 - r)) * 0.8 * (ctx.isPFA || ctx.checkedToMe ? 1 : 0.6);
      } else if (ctx.street === 'flop' && ctx.isPFA) {
        pBluff = (ctx.wet < 0.3 ? 0.55 : 0.3) + p.cbetFreq;
      } else if (ctx.street === 'turn' && ctx.isPFA) pBluff = 0.22;
      else if (ctx.checkedToMe) pBluff = 0.2;
      pBluff = clamp(pBluff, 0, 0.9);
    }
    const semi = draw * (ctx.street === 'flop' ? 0.5 : 0.35);
    const thin = eq >= 0.45 && eq < vt && !river && ctx.wet > 0.4 ? 0.2 : 0;
    let pBet = pValue + (1 - pValue) * Math.max(pBluff * p.bluffMult, semi * Math.max(0.5, p.bluffMult), thin);
    if (n > 1) pBet = pValue + (pBet - pValue) * 0.4;
    if (ctx.isPFA && ctx.street === 'flop') pBet = pBet + (1 - pBet) * Math.max(0, p.cbetFreq) * 0.5;
    // 드라이 보드 헤즈업 프리플랍 레이저: 레인지 전체로 작게 자주 C벳
    if (ctx.isPFA && ctx.street === 'flop' && n === 1 && ctx.wet < 0.3) pBet = Math.max(pBet, clamp((ctx.ip ? 0.75 : 0.5) + p.cbetFreq, 0, 0.95));
    if (eq > 0.35 || draw > 0) pBet = aggr >= 0 ? pBet + (1 - pBet) * aggr * 0.25 : pBet * (1 + aggr * 0.6);
    pBet = clamp(pBet, 0, 1);
    base.push(1 - pBet);
    // 크기 선택
    const bw = betOpts.map((o, i) => {
      if (p.sizing === 'overbet') return i === betOpts.length - 1 ? 0.5 : 0.5 / Math.max(1, betOpts.length - 1);
      if (p.sizing === 'strengthTell') return eq > 0.7 ? (i === betOpts.length - 1 ? 1 : 0.05) : i === 0 ? 1 : 0.05;
      if (o.to === L.maxRaiseTo && ctx.spr < 1.3) return eq > 0.6 ? 1.2 : 0.3;
      if (river && eq > 0.85) return i === betOpts.length - 1 ? 0.7 : 0.3;
      return i === 0 ? 0.65 : 0.35;
    });
    const bs = bw.reduce((a, b) => a + b, 0) || 1;
    for (const x of bw) base.push((pBet * x) / bs);
  } else {
    // ---- 벳을 받았을 때 ----
    const toCall = ctx.toCall;
    options.push({ key: 'fold', act: 'fold', ev: 0 });
    options.push({ key: 'call', act: 'call', ev: eq * real * (pot + toCall) - toCall });
    let raiseOpt: Option | null = null;
    if (L.canRaise) {
      const cur = L.currentBet;
      let to = legalTo(ctx, cur * 2.8 + (pot - cur - L.committed) * 0.3);
      if (ctx.spr < 2 || to > 0.45 * (L.stack + L.committed)) to = L.maxRaiseTo;
      const add = to - L.committed;
      const extra = to - cur;
      const potAfter = pot + add;
      const c = clamp((potAfter / (potAfter + extra)) * 0.85, 0.08, 0.95);
      const f = Math.pow(1 - c, 1);
      const ev = f * pot + (1 - f) * (eqWhenCalled(c) * (pot + add + extra) - add);
      raiseOpt = { key: 'raise:' + to, act: 'raise', to, ev };
      options.push(raiseOpt);
    }
    const betFrac = ctx.lastBetFrac;
    const needAdj = ctx.potOdds - p.stickiness * 0.06 - recallAdj.callBoost + recallAdj.foldBoost
      + Math.max(0, p.foldToAggro) * 0.08 * Math.min(2, betFrac) + Math.min(0, p.foldToAggro) * 0.05
      + fx.oddsNoise * (rand() * 2 - 1);
    let pCont = sig((eq * real - needAdj) / 0.035);
    if (draw > 0 && !river) pCont = Math.max(pCont, sig((eq + 0.08 - needAdj) / 0.04));
    let pRaise = 0;
    if (raiseOpt) {
      pRaise = eq > 0.82 ? (river ? 0.6 : 0.5) : eq > 0.7 ? 0.15 : 0;
      if (draw > 0) pRaise = Math.max(pRaise, 0.15 * p.bluffMult);
      if (river && eq < 0.15) pRaise = Math.max(pRaise, 0.04 * p.bluffMult);
      pRaise = clamp(pRaise * (1 + aggr * 0.8), 0, 0.95);
      if (aggr > 0.3) pRaise = clamp(pRaise + Math.max(0, pCont - pRaise) * (aggr - 0.3) * 0.5, 0, 0.95);
      if (raiseOpt.to === L.maxRaiseTo && eq < 0.5 && ctx.spr > 1.5) pRaise *= 0.3;
    }
    pRaise = Math.min(pRaise, Math.max(pCont, pRaise));
    const pCall = Math.max(0, pCont - pRaise);
    base.push(Math.max(0, 1 - pCall - pRaise), pCall);
    if (raiseOpt) base.push(pRaise);
  }

  // ---- EV 전략과 섞기 ----
  const vals = options.map((o) => (o.ev ?? 0) / Math.max(pot, 1));
  const mx = Math.max(...vals);
  const ex = vals.map((v) => Math.exp((v - mx) / fx.evTemp));
  const es = ex.reduce((a, b) => a + b, 0);
  const evDist = ex.map((x) => x / es);
  const bsum = base.reduce((a, b) => a + b, 0) || 1;
  const w = clamp(p.evWeight, 0, 1);
  const probs = base.map((b, i) => (b / bsum) * (1 - w) + evDist[i] * w);
  return {
    options, probs, equity: eq, eqRes, base: base.map((b) => b / bsum), evDist,
    note: `${ctx.street} 에퀴티 ${(eq * 100).toFixed(0)}% (상대 ${n}명, ${fx.rangeThinking === 'none' ? '내 패만 봄' : fx.rangeThinking === 'rough' ? '레인지 대충' : '레인지 추적'})`,
  };
}
