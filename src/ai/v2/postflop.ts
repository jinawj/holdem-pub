// 포스트플랍: 레인지 상대 에퀴티 + 블러프 비율 b/(P+2b) + MDF P/(P+b) + 텍스처 사이즈 + EV(평균적 상대) (overview 3.5)
import { AI } from '../../config';
import type { Ctx } from './context';
import { equityVsRanges, eqVsTop, EquityResult } from './equity';
import { levelFx } from './persona';
import { legalTo, moodAdj, PolicyOut } from './preflop';
import { buildRange } from './range';
import { classRank, Read, readHand } from './read';
import type { AiMemory, AiProfile, Option } from './types';

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export interface PostOut extends PolicyOut { eqRes: EquityResult; base: number[]; evDist: number[]; read: Read; planBetP?: number }

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
  // 사람식 상황 읽기 (내 패 분류·주도권·보드·벳 크기)
  const rd = readHand(ctx, eq);
  let thought = '';
  let planBetP: number | undefined;
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

    // ---- 사람식 계획: "내 패 + 주도권 + 보드" 로 벳할지 정함 (v2) ----
    const pBet = planBet(rd, ctx, p, aggr, n);
    planBetP = pBet;
    thought = `${rd.desc} · ${rd.facingAggressorFirst ? '레이저 앞이라 체크 위주' : rd.initiative ? '주도권 있음' : '주도권 없음'}${rd.scareCard ? ' · 무서운 카드' : ''} → 벳 ${Math.round(pBet * 100)}%`;
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
    // ---- 사람식 판단: "내 패가 이 라인·벳 크기 상대로 버틸 만한가" (v2) ----
    const d = planDefense(rd, ctx, p, aggr, prof.level, recallAdj, eq);
    let pCont = d.cont;
    let pRaise = raiseOpt ? d.raise : 0;
    if (raiseOpt && raiseOpt.to === L.maxRaiseTo && classRank(rd.cls) < 4 && ctx.spr > 1.5) pRaise *= 0.3;
    thought = `${rd.desc} · ${rd.polarBet ? '큰 벳(강하거나 블러프)' : ctx.lastBetFrac <= 0.4 ? '작은 벳' : '보통 벳'} → ${d.why}`;
    void fx; void real; void draw;
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
  // 계산(EV)은 보조: 사람식 판단 비중을 높여 수학적 편향을 줄임
  const w = clamp(p.evWeight * 0.5, 0, 1);
  const probs = base.map((b, i) => (b / bsum) * (1 - w) + evDist[i] * w);
  return {
    options, probs, equity: eq, eqRes, base: base.map((b) => b / bsum), evDist, read: rd, planBetP,
    note: `${thought} (에퀴티 ${(eq * 100).toFixed(0)}%, 상대 ${n}명)`,
  };
}

/** 벳을 안 받았을 때 벳할 확률: 사람의 계획 (밸류·보호·C벳·배럴·찔러보기·블러프) */
function planBet(rd: Read, ctx: Ctx, p: AiProfile['p'], aggr: number, n: number): number {
  const S = ctx.street, HU = n === 1;
  const dry = ctx.wet < 0.3, wet = ctx.wet > 0.55;
  const c = rd.cls;
  let pb: number;
  if (rd.facingAggressorFirst) {
    // 레이저 앞에서는 체크가 기본 (동크 거의 안 함). 아주 강하거나 웻 보드 보호만 가끔
    pb = c === 'monster' ? 0.12 : c === 'strong' && wet ? 0.1 : 0.03;
  } else if (rd.initiative) {
    if (S === 'flop') {
      // C벳: 드라이 보드는 레인지 전체로 자주, 웻 보드는 덜, 멀티웨이는 확 줄임
      const cbet = (dry ? 0.78 : wet ? 0.5 : 0.64) * (ctx.ip ? 1 : 0.85) * (HU ? 1 : 0.6) + p.cbetFreq;
      pb = ({ monster: dry ? 0.7 : 0.9, strong: 0.88, medium: HU ? cbet : 0.35, weak: cbet * 0.85, draw: 0.75, air: cbet * (rd.backdoor ? 1 : 0.8) } as const)[c];
    } else if (S === 'turn') {
      // 배럴: 밸류·드로우는 계속, 블러프는 무서운 카드가 떨어졌을 때
      pb = ({ monster: 0.85, strong: 0.75, medium: 0.35, weak: rd.scareCard ? 0.4 : 0.15, draw: 0.62, air: rd.scareCard ? 0.45 : 0.2 } as const)[c];
    } else {
      // 리버: 밸류는 얇게라도, 블러프는 블로커 있을 때 위주, 쇼다운 가치 있으면 체크
      pb = ({ monster: 0.88, strong: 0.7, medium: 0.25, weak: 0.08, draw: rd.blocker ? 0.5 : 0.3, air: rd.blocker ? 0.55 : 0.3 } as const)[c];
    }
  } else {
    // 주도권 없음 + 상대가 체크(또는 마지막 행동): 밸류는 벳, 약하면 가끔 찔러보기
    const stab = ctx.checkedToMe && HU;
    pb = ({ monster: 0.72, strong: 0.7, medium: stab ? 0.35 : 0.15, weak: stab ? 0.3 : 0.05, draw: 0.5, air: stab ? (S === 'river' ? (rd.blocker ? 0.4 : 0.25) : 0.32) : 0.05 } as const)[c];
  }
  const bluffy = c === 'weak' || c === 'air' || c === 'draw';
  if (bluffy) pb *= HU ? 1 : 0.5;
  if (bluffy) pb = Math.min(0.95, pb * Math.max(0.15, p.bluffMult));
  pb = aggr >= 0 ? pb + (1 - pb) * aggr * 0.25 : pb * (1 + aggr * 0.6);
  return clamp(pb, 0, 0.97);
}

/** 벳을 받았을 때: 계속할 확률·레이즈 확률. 사람식: 패 강도 × 벳 크기 × 가격, 고수일수록 블러프를 의식(히어로콜) */
function planDefense(rd: Read, ctx: Ctx, p: AiProfile['p'], aggr: number, level: number, recall: { callBoost: number; foldBoost: number }, eq: number): { cont: number; raise: number; why: string } {
  const c = rd.cls;
  const river = ctx.street === 'river';
  const small = ctx.lastBetFrac <= 0.4;
  const polar = rd.polarBet;
  const wet = ctx.wet > 0.55;
  let cont: number, raise = 0, why = '';
  switch (c) {
    case 'monster': cont = 1; raise = river ? 0.55 : wet ? 0.55 : 0.35; why = '강해서 레이즈 또는 슬로플레이'; break;
    case 'strong': cont = polar && river ? 0.8 : 0.95; raise = wet ? 0.2 : 0.1; why = '좋은 패라 콜'; break;
    case 'medium': cont = small ? 0.9 : polar ? (river ? 0.45 : 0.6) : 0.75; raise = 0.03; why = '중간 패: 크기 보고 판단'; break;
    case 'weak': cont = small ? 0.55 : polar ? 0.12 : 0.3; why = '약한 패: 작은 벳만 따라감'; break;
    case 'draw': cont = ctx.potOdds <= 0.35 || ctx.effBB > 60 ? 0.9 : 0.55; raise = 0.18; why = '드로우: 가격 보고 따라감'; break;
    // 에어: 작은 벳엔 백도어·오버카드로 가끔 띄워 봄(플로트), 큰 벳·리버엔 대부분 폴드
    default: cont = small && !river ? (ctx.ip ? (rd.backdoor ? 0.5 : 0.25) : (rd.backdoor ? 0.3 : 0.1)) : 0.03; raise = river ? 0.03 : 0.05; why = cont > 0.2 ? '에어지만 작은 벳이라 한 번 띄워 봄' : '에어: 대부분 폴드';
  }
  // 고수: 큰 벳에도 블러프가 섞여 있다는 걸 앎 → 중간·약한 패로 히어로콜 (최소 수비 빈도 감각)
  if (polar && (c === 'medium' || c === 'weak')) {
    const hero = level >= 9 ? (c === 'medium' ? 0.7 : rd.blocker ? 0.45 : 0.25) : level >= 7 ? (c === 'medium' ? 0.6 : rd.blocker ? 0.3 : 0.12) : 0;
    if (hero > cont) { cont = hero; why = '큰 벳이지만 블러프도 있다고 보고 히어로콜'; }
  }
  // 가격이 아주 좋으면 (필요 승률 20% 미만) 웬만하면 콜
  if (ctx.potOdds < 0.2 && c !== 'air') cont = Math.max(cont, 0.8);
  // 계산이 '이건 진짜 아니다'라고 할 때만 브레이크 (보드 위험은 read에서 이미 반영)
  if (eq < 0.08 && c !== 'monster') cont *= 0.4;
  // 성향·기억
  if (c === 'medium' || c === 'weak') cont += (1 - cont) * Math.max(0, p.stickiness) * 0.35;
  if (polar) cont *= 1 - Math.max(0, p.foldToAggro) * 0.5;
  cont = clamp(cont + recall.callBoost * 2 - recall.foldBoost * 2, 0, 1);
  raise = clamp(raise * (1 + aggr * 0.8) * (c === 'air' || c === 'draw' ? Math.max(0.2, p.bluffMult) : 1), 0, 0.9);
  raise = Math.min(raise, cont);
  return { cont, raise, why };
}
