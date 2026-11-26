// 프리플랍 (v2 정책을 스타일 없이 '표준'으로 옮기고, 실력 차이는 레벨 표로)
//  개념: 포지션(뒤에 남은 사람), 핸드 순위, 깊이별 플레이어빌리티, 숏스택 푸시/폴드 표, BB 가격 방어, 3벳 밸류·블러프(블로커), 올인급은 EV
import { AI, AI_V3, lv } from '../../config';
import { equityVsRanges } from '../core/equity';
import { isBluffCandidate, isPremium, isWheelAceSuited } from '../core/handrank';
import { pushMargin } from '../core/pushfold';
import { behindPreflop, Ctx } from './context';
import { buildRange, openPctFor, pushPctFor } from './range';
import { jamEV } from './shortstack';
import { readStacks, riskPremium, StackRead } from './stacks';
import type { Skill } from './skill';
import { legalTo } from './strategy';
import type { Intent, Option } from './types';

const sig = (x: number) => 1 / (1 + Math.exp(-x));

export interface PreOut { options: Option[]; probs: number[]; intents: Intent[]; equity?: number; why: string }

export function playablePct(key: string, pct: number, effBB: number): number {
  // 핸드 순위표는 올인 승률 기준이라 오프수트 A·K를 높게, 수딧 커넥터·스몰 페어를 낮게 봄 → 스택이 깊을수록 "치기 좋은 정도"로 보정
  const deepF = Math.max(0, Math.min(1, (effBB - 25) / 60));
  if (deepF <= 0) return pct;
  const R = 'AKQJT98765432';
  const r1 = R.indexOf(key[0]), r2 = R.indexOf(key[1]);
  const suited = key[2] === 's', pair = key.length === 2;
  const gap = r2 - r1;
  let bonus = 0, penalty = 0;
  if (pair && r1 >= R.indexOf('9')) bonus = 10;
  else if (suited && gap === 1 && r1 >= R.indexOf('J') && r2 <= R.indexOf('4')) bonus = 14;
  else if (suited && gap === 2 && r1 >= R.indexOf('J')) bonus = 8;
  else if (suited && key[0] === 'A') bonus = 7;
  else if (suited && key[0] === 'K') bonus = 4;
  if (!suited && !pair && (key[0] === 'A' ? r2 >= R.indexOf('9') : r1 <= R.indexOf('J') && r2 >= R.indexOf('9'))) penalty = key[0] === 'A' && r2 >= R.indexOf('8') ? 11 : 8;
  return Math.max(0.5, pct - deepF * bonus + deepF * penalty);
}

export function preflopPolicy(ctx: Ctx, skill: Skill, rand: () => number, quick: boolean): PreOut {
  const st = readStacks(ctx.view);
  const base = basePolicy(ctx, skill, rand, quick, st);
  const ss = shortStackLayer(ctx, skill, rand, quick, base);
  const out = ss ?? base;
  if (skill.level >= 6) out.why = st.notes.join(' · ') + ' → ' + out.why;
  return out;
}

function basePolicy(ctx: Ctx, skill: Skill, rand: () => number, quick: boolean, st: StackRead): PreOut {
  const L = ctx.view.legal;
  const lvl = skill.level;
  const w = lv(AI_V3.pre.width, lvl);
  const pct = ctx.pct, bb = ctx.bb;
  const myTotal = L.stack + L.committed;
  const fold: Option = { key: 'fold', act: 'fold' }, check: Option = { key: 'check', act: 'check' }, call: Option = { key: 'call', act: 'call' };
  const raise = (to: number): Option => { const t = legalTo(ctx, to); return { key: 'raise:' + t, act: 'raise', to: t }; };
  const passive = L.canCheck ? check : fold;
  const callMult = lv(AI_V3.pre.callMult, lvl);

  const facingAllInish = ctx.toCall > 0 && (ctx.toCall >= 0.35 * myTotal || ctx.raisesPre >= 3 || ctx.activeOpp.length === 0);
  if (facingAllInish) return evMode(ctx, skill, rand, quick);

  // 숏스택 푸시/폴드 (표)
  if (ctx.effBB <= AI.pushFoldBB && ctx.raisesPre === 0 && L.canRaise) {
    const anteBB = ctx.view.level.ante / bb;
    const m = L.canCheck ? null : pushMargin(ctx.key, Math.max(1, ctx.behind), ctx.effBB, anteBB);
    if (m !== null) {
      const pr = sig(m / Math.max(0.02, lv(AI_V3.pre.pushWidth, lvl)));
      return { options: [raise(L.maxRaiseTo), passive], probs: [pr, 1 - pr], intents: ['value', 'fold'], why: `푸시/폴드 ${ctx.effBB.toFixed(1)}BB (뒤 ${ctx.behind}명): 표 기준 올인 이득 ${m >= 0 ? '+' : ''}${m.toFixed(2)}BB` };
    }
    let pp = pushPctFor(ctx.effBB, Math.max(1, ctx.behind));
    if (L.canCheck) pp *= 0.6;
    const pr = sig((pp - pct) / w);
    return { options: [raise(L.maxRaiseTo), passive], probs: [pr, 1 - pr], intents: ['value', 'none'], why: `푸시/폴드 ${ctx.effBB.toFixed(1)}BB, 범위 ${pp.toFixed(0)}%` };
  }

  // 오픈
  if (ctx.raisesPre === 0) {
    const limpers = ctx.view.actionLog.filter((a) => a.street === 'preflop' && a.type === 'call').length;
    if (L.canCheck) {
      const iso = 10;
      let pr = sig((iso - pct) / w);
      if (lvl >= 6 && isWheelAceSuited(ctx.key)) pr = Math.max(pr, 0.15);
      return { options: [raise((3 + limpers) * bb), check], probs: [pr, 1 - pr], intents: ['value', 'none'], why: `림프팟 BB: 상위 ${iso}% 레이즈` };
    }
    const deepOpen = lvl >= 5 ? (ctx.effBB > 100 && ctx.behind <= 3 ? 1.15 : ctx.effBB > 60 && ctx.behind <= 3 ? 1.07 : 1) : 1;
    // 초급은 포지션 감각이 약함: 앞자리도 뒷자리처럼 넓게, 뒷자리는 좁게
    const hu = ctx.view.seats.length === 2;
    const posO = skill.position ? openPctFor(ctx.behind, hu) : (openPctFor(ctx.behind, hu) + 20) / 2;
    let o = posO * deepOpen;
    if (limpers > 0) o *= 0.55;
    // 스택 보고 조절: 칩리더는 중간 스택들을 압박(넓게), 뒤에 나를 커버하는 빅스택·올인 받아칠 숏스택이 있으면 조금 좁게
    if (lvl >= 7 && st.pressure > 0) o *= 1 + (AI_V3.leaderOpenMult - 1) * st.pressure;
    if (lvl >= 6 && !st.isLeader && st.bigBehind > 0 && ctx.effBB >= 15 && ctx.effBB <= 40) o *= 0.9;
    if (lvl >= 6 && st.shortBehind >= 2) o *= 0.93;
    const opct = skill.position ? playablePct(ctx.key, pct, ctx.effBB) : pct;
    let pr = sig((o - opct) / w);
    const limp = lv(AI_V3.pre.limp, lvl);
    if (pct < 3.5) pr = Math.max(pr, 0.8);
    pr *= 1 - limp * 0.6;
    const playPct = Math.min(60, o * 1.5 + 8);
    let pl = limp * sig((playPct - opct) / w) * (1 - pr);
    if (limpers > 0) pl = Math.max(pl, 0.3 * sig((o * 2 - pct) / w) * (1 - pr));
    if (limpers > 0 && ctx.view.mySeat === ctx.view.sbSeat) pl = Math.max(pl, 0.85 * sig((70 - pct) / w) * (1 - pr));
    const deep = ctx.effBB > 100 ? 0.3 : ctx.effBB > 40 ? 0.2 : 0;
    // 짧으면 작게(2.1배): 올인을 받으면 쉽게 결정하고 칩을 아낌
    const size = (ctx.effBB <= 25 ? 2.1 + limpers : ctx.behind === 1 ? 3 : 2.2 + deep + limpers) * bb;
    return { options: [raise(size), call, fold], probs: [pr, pl, Math.max(0, 1 - pr - pl)], intents: [opct < o * 0.4 ? 'value' : 'none', 'none', 'fold'], why: `오픈 범위 ${Math.min(100, o).toFixed(0)}% (뒤에 ${ctx.behind}명)` };
  }

  // 오픈에 대응
  if (ctx.raisesPre === 1) {
    const opener = ctx.lastPreRaiser!;
    let o = openPctFor(behindPreflop(ctx.view, opener), ctx.view.seats.length === 2);
    const openTo = Math.max(...ctx.view.actionLog.filter((a) => a.street === 'preflop' && a.seat === opener).map((a) => a.to));
    if (openTo > 4 * bb) o *= 0.8;
    const openIdx = ctx.view.actionLog.findIndex((a) => a.street === 'preflop' && a.seat === opener && a.type === 'raise');
    const coldCallers = ctx.view.actionLog.filter((a, i) => i > openIdx && a.street === 'preflop' && a.type === 'call').length;
    let v = AI.threeBetValueRatio * o * lv(AI_V3.pre.threeBetMult, lvl);
    if (coldCallers > 0) v *= 0.8;
    const isBB = ctx.view.mySeat === ctx.view.bbSeat, isSB = ctx.view.mySeat === ctx.view.sbSeat;
    const need = ctx.toCall / Math.max(1, ctx.pot + ctx.toCall);
    const deep = Math.max(0, Math.min(1, (ctx.effBB - 40) / 100));
    const ipMult = isBB ? (skill.potOdds ? Math.max(1.35, Math.min(2.3, 0.33 / Math.max(0.05, need))) : 1.3) : isSB ? 0.7 : ctx.behind <= 2 && skill.position ? 1.1 + 0.3 * deep : 0.9 + 0.2 * deep;
    let band = AI.callRatio * o * ipMult * callMult;
    if (isBB && skill.potOdds) band = Math.max(band, o * (1.2 + (1.5 * Math.max(0, 0.33 - need)) / 0.33) - v);
    // 헤즈업 BB: 넓은 SB 오픈에 3벳 약 16%, 전체 수비 약 70% (초급은 가격 감각이 없어 좁게)
    if (ctx.view.seats.length === 2) { v = Math.min(v, 16); band = Math.min(band, (skill.potOdds ? 70 : 55) - v); }
    let p3 = sig((v - pct) / w);
    const b3 = lv(AI_V3.pre.bluff3bet, lvl);
    if (ctx.effBB > 40 && isBluffCandidate(ctx.key) && coldCallers === 0) p3 = p3 + (1 - p3) * b3;
    p3 = Math.min(1, p3);
    const cpct = skill.position ? playablePct(ctx.key, pct, ctx.effBB) : pct;
    const pc = Math.max(0, sig((v + band - cpct) / w) - p3);
    const ip = !isBB && !isSB;
    let r = raise(openTo * (ip ? 3 : 4) + coldCallers * openTo);
    if (r.to! > 0.35 * myTotal) r = raise(L.maxRaiseTo);
    const opts: Option[] = L.canRaise ? [r, call, fold] : [call, fold];
    const probs = L.canRaise ? [p3, pc, Math.max(0, 1 - p3 - pc)] : [p3 + pc, Math.max(0, 1 - p3 - pc)];
    const intents: Intent[] = L.canRaise ? [pct < v ? 'value' : 'bluff', 'none', 'fold'] : ['none', 'fold'];
    return { options: opts, probs, intents, why: `상대 오픈 ${o.toFixed(0)}% → 3벳 ${v.toFixed(1)}% · 콜 ${band.toFixed(1)}%` };
  }

  // 3벳 이상에 대응
  const lastTo = L.currentBet;
  const f4 = AI.fourBetPct * (lvl >= 7 ? 1.1 : 1);
  let p4 = sig((f4 - pct) / 1.2);
  if (lvl >= 7 && ctx.effBB > 60 && isWheelAceSuited(ctx.key)) p4 = p4 + (1 - p4) * 0.2;
  const cband = AI.callThreeBetPct * (ctx.behind <= 2 && skill.position ? 1.3 : 0.9) * callMult;
  const pc = Math.max(0, sig((f4 + cband - pct) / 1.5) - p4);
  let r = raise(lastTo * 2.3);
  if (r.to! > 0.4 * myTotal) r = raise(L.maxRaiseTo);
  if (isPremium(ctx.key) && ctx.key !== 'QQ') p4 = Math.max(p4, 0.6);
  const opts: Option[] = L.canRaise ? [r, call, fold] : [call, fold];
  const probs = L.canRaise ? [p4, pc, Math.max(0, 1 - p4 - pc)] : [p4 + pc, Math.max(0, 1 - p4 - pc)];
  return { options: opts, probs, intents: L.canRaise ? ['value', 'none', 'fold'] : ['none', 'fold'], why: `3벳 대응: 4벳 ${f4.toFixed(1)}% · 콜 ${cband.toFixed(1)}%` };
}

/** 올인급: 상대 레인지 상대 에퀴티로 EV 비교 */
function evMode(ctx: Ctx, skill: Skill, rand: () => number, quick: boolean): PreOut {
  const L = ctx.view.legal;
  const villain = ctx.lastPreRaiser ?? ctx.oppSeats[0];
  const range = buildRange(ctx.view, villain, { read: Math.max(skill.rangeRead, AI.allInReadMinV2) });
  const n = quick ? AI.preflopMcSamples.quick : AI.preflopMcSamples.normal;
  let eq = equityVsRanges(ctx.view.holeCards, [], [range], n, rand).eq;
  eq *= Math.pow(0.8, Math.max(0, ctx.oppSeats.length - 1));
  const pot = ctx.pot;
  // 상급+: 나를 커버하는 상대의 올인엔 생존 프리미엄만큼 승률이 더 필요
  const prem = skill.level >= 7 ? riskPremium(ctx.view, villain) : 0;
  const options: Option[] = [{ key: 'fold', act: 'fold', ev: 0 }, { key: 'call', act: 'call', ev: (eq - prem) * (pot + ctx.toCall) - ctx.toCall }];
  const vs = ctx.view.seats.find((s) => s.seat === villain);
  if (L.canRaise && vs?.status !== 'allin') {
    const risk = L.maxRaiseTo - L.committed;
    // 올인 레이즈에 상대가 접을 비율: 오픈 상대엔 꽤, 3벳·4벳 상대엔 거의 없음
    const f = ctx.raisesPre >= 3 ? 0.08 : ctx.raisesPre === 2 ? 0.22 : 0.35;
    options.push({ key: 'raise:' + L.maxRaiseTo, act: 'raise', to: L.maxRaiseTo, ev: f * pot + (1 - f) * (eq * 0.92 * (pot + risk + Math.min(risk, vs?.stack ?? 0)) - risk) });
  }
  const temp = skill.evTemp * 0.5;
  const vals = options.map((o) => (o.ev ?? 0) / Math.max(pot, 1));
  const mx = Math.max(...vals);
  const ex = vals.map((x) => Math.exp((x - mx) / temp));
  const s = ex.reduce((a, b) => a + b, 0);
  return { options, probs: ex.map((x) => x / s), intents: options.map((o) => (o.act === 'fold' ? 'fold' : o.act === 'raise' ? 'value' : 'none')), equity: eq, why: `올인급: 에퀴티 ${(eq * 100).toFixed(0)}% / 필요 ${(ctx.potOdds * 100).toFixed(0)}%${prem ? ` + 생존 프리미엄 ${(prem * 100).toFixed(0)}%p` : ''}` };
}

/**
 * 숏스택 층: 짧은 스택에서는 '레이즈-폴드'나 '콜'보다 올인이 나은 경우가 많다. 행동별 EV를 직접 계산해 기본 정책과 섞는다.
 *  ① 오픈을 받음(유효 AI_V3.jamBB 이하): 폴드 / 콜 / 리셔브
 *  ② 내가 오픈했는데 3벳을 받음(35BB 이하): 폴드 / 콜 / 올인
 *  ③ 오픈 자리 13~20BB(Lv6+): 강한 패는 작게 레이즈, 애매한 패는 표 기준 올인 이득이 있으면 올인(레이즈-폴드 안 함)
 * 레벨이 높을수록 계산을 더 믿는다 (Lv7+ 85%, Lv4~6 50%, Lv1~3 안 씀)
 */
function shortStackLayer(ctx: Ctx, skill: Skill, rand: () => number, quick: boolean, base: PreOut): PreOut | null {
  const v = ctx.view, L = v.legal;
  const lvl = skill.level;
  if (lvl < 4 || !L.canRaise) return null;
  const myOpened = v.actionLog.some((a) => a.street === 'preflop' && a.seat === v.mySeat && a.type === 'raise');
  const caseA = ctx.raisesPre === 1 && ctx.toCall > 0 && ctx.effBB <= AI_V3.jamBB;
  const caseB = ctx.raisesPre === 2 && myOpened && ctx.effBB <= 35;
  const caseC = ctx.raisesPre === 0 && !L.canCheck && ctx.effBB > AI.pushFoldBB && ctx.effBB <= 20 && lvl >= 6;
  if (caseC) {
    const m = pushMargin(ctx.key, Math.max(1, ctx.behind), ctx.effBB, v.level.ante / ctx.bb);
    const ri = base.options.findIndex((o) => o.act === 'raise');
    if (m === null || ri < 0 || ctx.pct <= 6) return null; // 프리미엄급은 작게 레이즈해 올인을 받는다
    const jamP = sig(m / 0.3);
    const pJam = Math.min(0.97, Math.max(base.probs[ri] * jamP, jamP * 0.85));
    return {
      options: [{ key: 'raise:' + L.maxRaiseTo, act: 'raise', to: L.maxRaiseTo }, { key: 'fold', act: 'fold' }], probs: [pJam, 1 - pJam], intents: ['value', 'fold'],
      why: `${ctx.effBB.toFixed(0)}BB 오픈 자리: 레이즈-폴드 대신 올인/폴드 (표 기준 올인 이득 ${m >= 0 ? '+' : ''}${m.toFixed(2)}BB)`,
    };
  }
  if (!caseA && !caseB) return null;
  const villain = ctx.lastPreRaiser!;
  const j = jamEV(ctx, skill, rand, quick, villain);
  const vr = buildRange(v, villain, { read: Math.max(0.6, skill.rangeRead) });
  const eqAll = equityVsRanges(v.holeCards, [], [vr], quick ? 150 : 400, rand).eq;
  const isBB = v.mySeat === v.bbSeat;
  const realize = isBB ? 0.8 : !caseA ? 0.75 : 0.85;
  const evCall = eqAll * realize * (ctx.pot + ctx.toCall) - ctx.toCall;
  const opts: Option[] = [{ key: 'fold', act: 'fold', ev: 0 }, { key: 'call', act: 'call', ev: evCall }, { key: 'raise:' + L.maxRaiseTo, act: 'raise', to: L.maxRaiseTo, ev: j.evJam }];
  const temp = lvl >= 7 ? 0.05 : 0.12;
  const vals = opts.map((o) => (o.ev ?? 0) / Math.max(1, ctx.pot));
  const mx = Math.max(...vals);
  const ex = vals.map((x) => Math.exp((x - mx) / temp));
  const es = ex.reduce((a, b) => a + b, 0);
  // 기본 정책을 같은 세 행동으로 옮김 (레이즈 = 올인으로 봄)
  const bp = [0, 0, 0];
  base.options.forEach((o, i) => { bp[o.act === 'fold' || o.act === 'check' ? 0 : o.act === 'call' ? 1 : 2] += base.probs[i]; });
  const w = lvl >= 7 ? 0.85 : 0.5;
  const probs = bp.map((b, i) => (1 - w) * b + w * (ex[i] / es));
  const why = `숏스택 대응(${caseA ? '오픈을 받음' : '3벳을 받음'}, 유효 ${ctx.effBB.toFixed(0)}BB): 콜 EV ${(evCall / ctx.bb).toFixed(1)}BB(승률 ${(eqAll * 100).toFixed(0)}%) · ${j.why}`;
  return { options: opts, probs, intents: ['fold', 'none', j.eqCalled >= 0.5 ? 'value' : 'semibluff'], why };
}
