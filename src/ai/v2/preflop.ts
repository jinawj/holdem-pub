// 프리플랍 정책: 169핸드 백분위 + 시그모이드 경계 + 숏스택 푸시/폴드 근사 (overview 3.4)
import { AI } from '../../config';
import type { Ctx } from './context';
import { equityVsRanges } from './equity';
import { isBluffCandidate, isPremium, isWheelAceSuited } from './handrank';
import { levelFx, PERSONAS } from './persona';
import { pushMargin } from './pushfold';
import { behindPreflop, buildRange, openPctFor, pushPctFor } from './range';
import type { AiMemory, AiProfile, Option } from './types';

const sig = (x: number) => 1 / (1 + Math.exp(-x));

export interface PolicyOut { options: Option[]; probs: number[]; equity?: number; note: string }

export function legalTo(ctx: Ctx, to: number): number {
  const L = ctx.view.legal;
  let t = Math.round(to / 100) * 100;
  if (t < L.minRaiseTo) t = L.minRaiseTo;
  if (t > L.maxRaiseTo) t = L.maxRaiseTo;
  // 남는 스택이 아주 적으면 올인
  if (L.maxRaiseTo - t < Math.max(ctx.bb, 0.15 * L.maxRaiseTo)) t = L.maxRaiseTo;
  return t;
}

export function moodAdj(prof: AiProfile, mem: AiMemory) {
  const fx = levelFx(prof.level);
  const m = prof.p.moodRange * fx.emotion;
  const tilt = mem.tilt * prof.p.tiltProne * fx.emotion;
  const bored = mem.foldStreak > 10 ? Math.min(1, (mem.foldStreak - 10) / 15) * m : 0;
  return {
    loose: 1 + 0.45 * tilt + 0.25 * bored + 0.1 * mem.confidence * m,
    aggr: 0.35 * tilt + 0.15 * mem.confidence * m,
  };
}

/**
 * 토너먼트 흐름에 따른 기어 변화 (overview 3.7 ④)
 *  - 초반(깊은 스택): 피쉬는 더 많이 들어오고, 레귤러류는 차분
 *  - 칩리더: 짧은 스택들을 압박 (오픈 넓게)
 *  - 아주 짧은 스택: 조급한 성향(매니악·초보)은 더 넓게 올인, 니트는 버팀
 */
export function gear(ctx: Ctx, prof: AiProfile): { openMult: number; pushShift: number; note: string } {
  let openMult = 1, pushShift = 0;
  const notes: string[] = [];
  const fish = PERSONAS[prof.personaId].fish;
  if (ctx.effBB > 80) {
    if (fish) { openMult *= 1.15; notes.push('초반 느슨'); }
    else if (prof.personaId === 'reg' || prof.personaId === 'nit') openMult *= 0.95;
  }
  const stacks = ctx.view.seats.map((s) => s.stack + s.committed).sort((a, b) => b - a);
  const me = ctx.view.seats.find((s) => s.seat === ctx.view.mySeat)!;
  const myTotal = me.stack + me.committed;
  const aggressive = prof.p.aggression >= 0.1 || prof.level >= 6;
  if (aggressive && stacks.length >= 3 && myTotal === stacks[0] && myTotal >= 1.5 * stacks[1]) {
    const others = ctx.view.seats.filter((s) => s.seat !== ctx.view.mySeat && s.status !== 'folded');
    const avgBB = others.reduce((a, s) => a + s.stack + s.committed, 0) / Math.max(1, others.length) / ctx.bb;
    if (avgBB < 25) { openMult *= 1.25; pushShift += 0.2; notes.push('칩리더 압박'); }
  }
  if (ctx.effBB < 8) {
    if (prof.personaId === 'maniac' || prof.personaId === 'beginner') { pushShift += 0.35; notes.push('조급함'); }
    if (prof.personaId === 'nit') { pushShift -= 0.25; notes.push('버티기'); }
  }
  return { openMult, pushShift, note: notes.length ? ' · ' + notes.join(', ') : '' };
}

/**
 * 깊이에 따른 "치기 좋은 정도": 올인 에퀴티 순위(pct)는 스몰 페어·수딧 커넥터를 낮게 평가함.
 * 사람은 깊은 스택에서 이런 패를 셋·스트레이트·플러시 노리고 콜함 → 순위를 앞당김. 약한 오프수트는 도미네이트 위험으로 뒤로.
 */
export function playablePct(key: string, pct: number, effBB: number): number {
  const deepF = Math.max(0, Math.min(1, (effBB - 40) / 100));
  if (deepF <= 0) return pct;
  const R = 'AKQJT98765432';
  const r1 = R.indexOf(key[0]), r2 = R.indexOf(key[1]);
  const suited = key[2] === 's', pair = key.length === 2;
  const gap = r2 - r1; // 0 = 페어, 1 = 커넥터
  let bonus = 0, penalty = 0;
  if (pair && r1 >= R.indexOf('9')) bonus = 9; // 22~99
  else if (suited && gap === 1 && r1 >= R.indexOf('J') && r2 <= R.indexOf('4')) bonus = 10; // JTs~54s
  else if (suited && gap === 2 && r1 >= R.indexOf('J')) bonus = 6; // 수딧 원갭
  else if (suited && key[0] === 'A') bonus = 6; // 수딧 A
  else if (suited && key[0] === 'K') bonus = 3;
  if (!suited && !pair && (key[0] === 'A' ? r2 >= R.indexOf('9') : r1 <= R.indexOf('Q') && r2 >= R.indexOf('9'))) penalty = 6; // A9o 이하, KTo·QTo·JTo류
  return Math.max(0.5, pct - deepF * bonus + deepF * penalty);
}

export function preflopPolicy(ctx: Ctx, prof: AiProfile, mem: AiMemory, rand: () => number, quick: boolean): PolicyOut {
  const L = ctx.view.legal;
  const p = prof.p;
  const fx = levelFx(prof.level);
  const mood = moodAdj(prof, mem);
  const loose = p.loose * mood.loose;
  const aggr = p.aggression + mood.aggr;
  const w = AI.sigmoidWidth * (1 + fx.noise * 4);
  const pct = ctx.pct;
  const bb = ctx.bb;
  const myTotal = L.stack + L.committed;
  const fold: Option = { key: 'fold', act: 'fold' };
  const check: Option = { key: 'check', act: 'check' };
  const call: Option = { key: 'call', act: 'call' };
  const raise = (to: number): Option => { const t = legalTo(ctx, to); return { key: 'raise:' + t, act: 'raise', to: t }; };
  const passive = L.canCheck ? check : fold;

  // 큰 금액을 걸어야 하는 결정 → 에퀴티로 EV 비교
  const facingAllInish = ctx.toCall > 0 && (ctx.toCall >= 0.35 * myTotal || ctx.raisesPre >= 3 || ctx.activeOpp.length === 0);
  if (facingAllInish) return evMode(ctx, prof, mem, rand, quick, loose);

  // 숏스택 푸시/폴드 (오픈 상황): 직접 계산한 균형 표의 "올인 이득"을 기준으로,
  // 레벨이 낮을수록 경계 근처 핸드에서만 헷갈림(사람다운 실수). 성향·기어로 이득 기준을 조금 이동.
  if (ctx.effBB <= AI.pushFoldBB && ctx.raisesPre === 0 && L.canRaise && !L.canCheck) {
    const anteBB = ctx.view.level.ante / ctx.bb;
    const m = pushMargin(ctx.key, Math.max(1, ctx.behind), ctx.effBB, anteBB);
    if (m !== null) {
      const g = gear(ctx, prof);
      const shift = (Math.min(loose, 2.5) - 1) * 0.8 + g.pushShift; // 루즈하면 넓게, 니트는 좁게 (BB)
      const width = Math.max(0.02, fx.pushWidth);
      const pr = sig((m + shift) / width);
      return { options: [raise(L.maxRaiseTo), passive], probs: [pr, 1 - pr], note: `푸시/폴드 ${ctx.effBB.toFixed(1)}BB (뒤 ${ctx.behind}명): 표 기준 올인 이득 ${m >= 0 ? '+' : ''}${m.toFixed(2)}BB${g.note}` };
    }
  }
  if (ctx.effBB <= AI.pushFoldBB && ctx.raisesPre === 0 && L.canRaise) {
    const noise = fx.pushNoise * (rand() * 2 - 1);
    let pp = pushPctFor(ctx.effBB, Math.max(1, ctx.behind)) * Math.sqrt(loose) + noise;
    if (L.canCheck) pp *= 0.6; // BB에서 림프팟 아이솔레이션
    const pr = sig((pp - pct) / w);
    return { options: [raise(L.maxRaiseTo), passive], probs: [pr, 1 - pr], note: `푸시/폴드 ${ctx.effBB.toFixed(1)}BB, 푸시 범위 ${pp.toFixed(0)}%` };
  }

  // 오픈 (아무도 레이즈 안 함)
  if (ctx.raisesPre === 0) {
    const limpers = ctx.view.actionLog.filter((a) => a.street === 'preflop' && a.type === 'call').length;
    if (L.canCheck) {
      // BB 옵션 (림프팟)
      const iso = 10 * Math.sqrt(loose) * (1 + aggr * 0.5);
      let pr = sig((iso - pct) / w);
      if (isWheelAceSuited(ctx.key)) pr = Math.max(pr, 0.15 * p.bluffMult);
      const size = (3 + limpers) * bb;
      return { options: [raise(size), check], probs: [pr, 1 - pr], note: `림프팟 BB, 레이즈 범위 ${iso.toFixed(0)}%` };
    }
    // 깊은 스택(100BB 넘음)일수록 뒤쪽 포지션 오픈을 넓힘
    const deepOpen = ctx.effBB > 100 && ctx.behind <= 3 ? 1.15 : ctx.effBB > 60 && ctx.behind <= 3 ? 1.07 : 1;
    let o = openPctFor(ctx.behind) * loose * gear(ctx, prof).openMult * deepOpen;
    if (limpers > 0) o *= 0.55;
    const prBase = sig((o - pct) / w);
    // 수동적인 성향은 레이즈 대신 림프
    const pr = aggr < 0 ? prBase * Math.max(0.15, 1 + aggr) : prBase;
    const playPct = Math.min(60, openPctFor(ctx.behind) * loose * 1.5 + 8);
    let pl = p.limpFreq * sig((playPct - pct) / w) * (1 - pr);
    // 림퍼 뒤 오버림프 (림프 성향 아니어도 스몰페어·수딧커넥터)
    if (limpers > 0 && p.limpFreq < 0.3) pl = Math.max(pl, 0.35 * sig((o * 2 - pct) / w) * (1 - pr));
    const deep = ctx.effBB > 100 ? 0.3 : ctx.effBB > 40 ? 0.2 : 0;
    const size = (ctx.behind === 1 ? 3 : 2.2 + deep + limpers) * bb;
    return {
      options: [raise(size), call, fold], probs: [pr, pl, Math.max(0, 1 - pr - pl)],
      note: `오픈 범위 ${o.toFixed(0)}% (뒤에 ${ctx.behind}명)`,
    };
  }

  // 오픈에 대응
  if (ctx.raisesPre === 1) {
    const opener = ctx.lastPreRaiser!;
    let o = openPctFor(behindPreflop(ctx.view, opener));
    const openTo = Math.max(...ctx.view.actionLog.filter((a) => a.street === 'preflop' && a.seat === opener).map((a) => a.to));
    if (openTo > 4 * bb) o *= 0.8;
    const coldCallers = ctx.view.actionLog.filter((a) => a.street === 'preflop' && a.type === 'call').length;
    let v = AI.threeBetValueRatio * o * (1 + aggr * 0.6) * Math.sqrt(loose);
    if (coldCallers > 0) v *= 0.8;
    const isBB = ctx.view.mySeat === ctx.view.bbSeat;
    const isSB = ctx.view.mySeat === ctx.view.sbSeat;
    // BB는 이미 낸 블라인드 덕에 싸게 콜 → 콜 가격이 쌀수록 넓게 방어. 깊으면 인포지션 콜드콜도 넓게 (셋·수딧 커넥터 노림)
    const need = ctx.toCall / Math.max(1, ctx.pot + ctx.toCall);
    const deep = Math.max(0, Math.min(1, (ctx.effBB - 40) / 100));
    const ipMult = isBB ? Math.max(1.35, Math.min(2.3, 0.33 / Math.max(0.05, need))) : isSB ? 0.45 : ctx.behind <= 2 ? 1.1 + 0.3 * deep : 0.9 + 0.2 * deep;
    const band = AI.callRatio * o * ipMult * loose * (1 + p.stickiness * 0.5) * (1 - Math.max(0, aggr) * 0.2);
    let p3 = sig((v - pct) / w);
    if (ctx.effBB > 40 && isBluffCandidate(ctx.key)) p3 = p3 + (1 - p3) * 0.3 * p.bluffMult;
    if (aggr < 0) p3 *= Math.max(0.2, 1 + aggr * 0.8);
    p3 = Math.min(1, p3);
    // 콜은 "깊은 스택에서 치기 좋은 패"를 더 쳐 줌 (스몰 페어·수딧 커넥터·수딧 A)
    const cpct = playablePct(ctx.key, pct, ctx.effBB);
    const pc = Math.max(0, sig((v + band - cpct) / w) - p3);
    const ip = !isBB && !isSB;
    const size = openTo * (ip ? 3 : 4) + coldCallers * openTo;
    let r = raise(size);
    if (r.to! > 0.35 * myTotal) r = raise(L.maxRaiseTo);
    const opts: Option[] = L.canRaise ? [r, call, fold] : [call, fold];
    const probs = L.canRaise ? [p3, pc, Math.max(0, 1 - p3 - pc)] : [p3 + pc, Math.max(0, 1 - p3 - pc)];
    return { options: opts, probs, note: `상대 오픈 ${o.toFixed(0)}% → 3벳 ${v.toFixed(1)}% · 콜 ${band.toFixed(1)}%` };
  }

  // 3벳에 대응
  const lastTo = ctx.view.legal.currentBet;
  const f4 = AI.fourBetPct * Math.sqrt(loose) * (1 + aggr * 0.5);
  let p4 = sig((f4 - pct) / 1.2);
  if (ctx.effBB > 60 && isWheelAceSuited(ctx.key)) p4 = p4 + (1 - p4) * 0.2 * p.bluffMult;
  const cband = AI.callThreeBetPct * loose * (ctx.behind <= 2 ? 1.3 : 0.9) * (1 + p.stickiness);
  const pc = Math.max(0, sig((f4 + cband - pct) / 1.5) - p4);
  let r = raise(lastTo * 2.3);
  if (r.to! > 0.4 * myTotal) r = raise(L.maxRaiseTo);
  if (isPremium(ctx.key) && ctx.key !== 'QQ') p4 = Math.max(p4, 0.6);
  const opts: Option[] = L.canRaise ? [r, call, fold] : [call, fold];
  const probs = L.canRaise ? [p4, pc, Math.max(0, 1 - p4 - pc)] : [p4 + pc, Math.max(0, 1 - p4 - pc)];
  return { options: opts, probs, note: `3벳 대응: 4벳 ${f4.toFixed(1)}% · 콜 ${cband.toFixed(1)}%` };
}

/** 올인급 결정: 상대 레인지 상대 에퀴티로 EV 비교 */
function evMode(ctx: Ctx, prof: AiProfile, mem: AiMemory, rand: () => number, quick: boolean, loose: number): PolicyOut {
  const L = ctx.view.legal;
  const fx = levelFx(prof.level);
  const villain = ctx.lastPreRaiser ?? ctx.oppSeats[0];
  const range = buildRange(ctx.view, villain, { thinking: fx.rangeWeight <= 0 ? 'none' : fx.rangeWeight >= 1 ? 'full' : 'rough', weight: fx.rangeWeight });
  const n = quick ? AI.preflopMcSamples.quick : AI.preflopMcSamples.normal;
  let eq = equityVsRanges(ctx.view.holeCards, [], [range], n, rand).eq;
  const others = ctx.oppSeats.length - 1;
  eq *= Math.pow(0.8, Math.max(0, others));
  const pot = ctx.pot;
  const evCall = eq * (pot + ctx.toCall) - ctx.toCall;
  const options: Option[] = [{ key: 'fold', act: 'fold', ev: 0 }, { key: 'call', act: 'call', ev: evCall }];
  if (L.canRaise) {
    const villainSeat = ctx.view.seats.find((s) => s.seat === villain);
    const villainAllIn = villainSeat?.status === 'allin';
    if (!villainAllIn) {
      const risk = L.maxRaiseTo - L.committed;
      const f = 0.35;
      const evShove = f * pot + (1 - f) * (eq * 0.92 * (pot + risk + Math.min(risk, (villainSeat?.stack ?? 0))) - risk);
      options.push({ key: 'raise:' + L.maxRaiseTo, act: 'raise', to: L.maxRaiseTo, ev: evShove });
    }
  }
  // 스타일: 루즈하거나 끈적하면 콜 쪽으로
  const stick = (loose - 1) * 0.04 + prof.p.stickiness * 0.03;
  const temp = fx.evTemp;
  const vals = options.map((o) => (o.ev ?? 0) / Math.max(pot, 1) + (o.act === 'call' ? stick : 0));
  const mx = Math.max(...vals);
  const ex = vals.map((v) => Math.exp((v - mx) / temp));
  const s = ex.reduce((a, b) => a + b, 0);
  return { options, probs: ex.map((x) => x / s), equity: eq, note: `올인급 결정: 에퀴티 ${(eq * 100).toFixed(0)}% / 필요 ${(ctx.potOdds * 100).toFixed(0)}%` };
}
