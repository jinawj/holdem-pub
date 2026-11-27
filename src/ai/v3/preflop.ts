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
  const v0 = ctx.view;
  const lvl = skill.level;
  const w = lv(AI_V3.pre.width, lvl);
  const pct = ctx.pct, bb = ctx.bb;
  const myTotal = L.stack + L.committed;
  const fold: Option = { key: 'fold', act: 'fold' }, check: Option = { key: 'check', act: 'check' }, call: Option = { key: 'call', act: 'call' };
  const raise = (to: number): Option => { const t = legalTo(ctx, to); return { key: 'raise:' + t, act: 'raise', to: t }; };
  const passive = L.canCheck ? check : fold;
  const callMult = lv(AI_V3.pre.callMult, lvl);

  const lastRaiserAllIn = ctx.lastPreRaiser !== null && ctx.view.seats.find((s) => s.seat === ctx.lastPreRaiser)?.status === 'allin';
  const facingAllInish = ctx.toCall > 0 && (ctx.toCall >= 0.35 * myTotal || ctx.raisesPre >= 3 || ctx.activeOpp.length === 0 || lastRaiserAllIn);
  if (facingAllInish) return evMode(ctx, skill, rand, quick);

  // 숏스택 푸시/폴드 (표)
  if (ctx.effBB <= AI.pushFoldBB && ctx.raisesPre === 0 && L.canRaise) {
    const anteBB = ctx.view.level.ante / bb;
    const m = L.canCheck ? null : pushMargin(ctx.key, Math.max(1, ctx.behind), ctx.effBB, anteBB);
    if (m !== null) {
      let pr = sig(m / Math.max(0.02, lv(AI_V3.pre.pushWidth, lvl)));
      // 상급+: 표가 손해(−0.1BB 이하)라고 하는 올인은 안 함 / 초급·중급 Lv3~4는 너무 늦게 올인하는 버릇(조금 더 기다림)
      if (lvl >= 7 && m < -0.1) pr = 0;
      if (lvl >= 3 && lvl <= 4) pr = sig((m - 0.3) / Math.max(0.02, lv(AI_V3.pre.pushWidth, lvl)));
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
    // v3 자리별 오픈 배수 (v2와 공유하는 표를 건드리지 않고 v3만 조정 — 상황별 점검 튜닝)
    let o = posO * deepOpen * (lvl >= 7 ? AI_V3.openScale[Math.max(1, Math.min(5, ctx.behind)) - 1] : 1);
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
    let size = (ctx.effBB <= 25 ? 2.1 + limpers : ctx.behind === 1 ? 3 : 2.2 + deep + limpers) * bb;
    // 크기 버릇: 초급은 2.5~4BB로 들쭉날쭉(강할수록 크게 내는 경향), 고수는 2.2~3BB를 섞어 크기로 읽히지 않게
    if (lvl <= 3 && ctx.effBB > 25) size = (2.5 + 1.5 * rand() + (ctx.pct < 8 ? 0.5 : 0) + limpers) * bb;
    else if (lvl >= 9 && ctx.effBB > 25 && ctx.behind > 1) size = (2.2 + [0, 0.3, 0.8][Math.floor(rand() * 3)] + limpers) * bb;
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
    // 콜(플랫) 범위: 인포지션일수록 넓게 (사람들은 3벳보다 콜을 훨씬 많이 함)
    const ipMult = isBB ? 1.3 : isSB ? AI_V3.coldCall.sb : ctx.behind <= 2 && skill.position ? AI_V3.coldCall.late + 0.3 * deep : AI_V3.coldCall.mid + 0.2 * deep;
    let band = AI.callRatio * o * ipMult * callMult;
    // BB 수비: 이미 1BB를 냈고 마지막에 행동 → 가격과 오프너 범위로 전체 수비를 정함
    //  (앞자리 오픈 약 35%, CO 약 50%, BTN·SB 60%+. 콜러가 있으면 가격이 좋아져 더 넓게)
    if (isBB) {
      const B = AI_V3.bbDefend;
      const D = skill.potOdds ? Math.min(B.max, (B.base + o) * Math.sqrt(B.refNeed / Math.max(0.1, need))) : B.noOddsBase + 0.6 * o;
      band = Math.max(band, D * Math.min(1.2, callMult) - v);
    }
    // 헤즈업 BB: 넓은 SB 오픈에 3벳 약 16%, 전체 수비 약 70% (초급은 가격 감각이 없어 좁게)
    if (ctx.view.seats.length === 2) { v = Math.min(v, AI_V3.hu.bb3bet); band = Math.min(band, (skill.potOdds ? AI_V3.hu.bbDefend : 55) - v); }
    let p3 = sig((v - pct) / w);
    // 블러프 3벳은 넓은 오픈(늦은 자리)을 상대로만. 앞자리 오픈(좁고 강함)엔 거의 안 함
    const b3 = lv(AI_V3.pre.bluff3bet, lvl) * (o >= 18 ? 1 : 0.25);
    if (ctx.effBB > 40 && isBluffCandidate(ctx.key) && coldCallers === 0) p3 = p3 + (1 - p3) * b3;
    p3 = Math.min(1, p3);
    const cpct = skill.position ? playablePct(ctx.key, pct, ctx.effBB) : pct;
    let pc = Math.max(0, sig((v + band - cpct) / w) - p3);
    const ip = !isBB && !isSB;
    // 임플라이드 오즈(Lv4+): 스택이 콜 금액보다 아주 크면 포켓페어(셋)·수딧 커넥터는 싸게 보고 큰 팟을 노린다
    if (skill.position && !isSB && coldCallers <= 1 && ctx.toCall > 0) {
      const ratio = (ctx.effBB * bb) / ctx.toCall;
      const R = 'AKQJT98765432';
      const k = ctx.key, r1 = R.indexOf(k[0]), r2 = R.indexOf(k[1]);
      const pair = k.length === 2, sc = k[2] === 's' && r2 - r1 <= 2 && r1 >= R.indexOf('J') && r2 <= R.indexOf('4');
      const io = AI_V3.impliedOdds;
      const want = pair && ratio >= io.pairRatio ? io.pairCall : sc && (ip || isBB) && ratio >= io.scRatio ? io.scCall * (r2 - r1 === 1 ? 1 : 0.6) : 0;
      if (want > pc) pc = Math.min(want, 1 - p3);
    }
    let r = raise(openTo * (ip ? 3 : 4) + coldCallers * openTo);
    if (r.to! > 0.35 * myTotal) r = raise(L.maxRaiseTo);
    const opts: Option[] = L.canRaise ? [r, call, fold] : [call, fold];
    const probs = L.canRaise ? [p3, pc, Math.max(0, 1 - p3 - pc)] : [p3 + pc, Math.max(0, 1 - p3 - pc)];
    const intents: Intent[] = L.canRaise ? [pct < v || lvl <= 3 ? 'value' : 'bluff', 'none', 'fold'] : ['none', 'fold'];
    return { options: opts, probs, intents, why: `상대 오픈 ${o.toFixed(0)}% → 3벳 ${v.toFixed(1)}% · 콜 ${band.toFixed(1)}%` };
  }

  // 3벳 이상에 대응
  const lastTo = L.currentBet;
  const f4 = AI.fourBetPct * (lvl >= 7 ? 1.1 : 1);
  let p4 = sig((f4 - pct) / 1.2);
  if (lvl >= 7 && ctx.effBB > 60 && isWheelAceSuited(ctx.key)) p4 = p4 + (1 - p4) * 0.2;
  let cband = AI.callThreeBetPct * (ctx.behind <= 2 && skill.position ? 1.3 : 0.9) * callMult;
  // 내가 오픈했다가 3벳을 받음: 내 오픈 범위의 약 절반은 계속해야 3벳 블러프가 공짜가 아님 (포지션 있으면 더 넓게)
  const myOpen = v0.actionLog.some((a) => a.street === 'preflop' && a.seat === v0.mySeat && a.type === 'raise') && ctx.raisesPre === 2;
  if (myOpen && skill.position) {
    const o = openPctFor(behindPreflop(v0, v0.mySeat), v0.seats.length === 2);
    const tb = ctx.lastPreRaiser!;
    const iAmIP = tb === v0.sbSeat || tb === v0.bbSeat;
    cband = Math.max(cband, o * (iAmIP ? AI_V3.vs3bet.ip : AI_V3.vs3bet.oop) - f4);
  }
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
  // 4벳·5벳 팟은 누구나 '아주 센 패'로 읽음 (초급도), 3벳 팟은 꽤 강하게
  //  헤즈업은 3벳(올인) 범위가 넓다 → 덜 좁혀 읽음 (리뷰 상황 1차: 헤즈업 SB가 3벳 받고 77% 폴드)
  const hu = ctx.view.seats.length === 2;
  const readMin = ctx.raisesPre >= 3 ? (hu ? 0.6 : 0.85) : ctx.raisesPre === 2 ? (hu ? 0.3 : 0.6) : AI.allInReadMinV2;
  const range = buildRange(ctx.view, villain, { read: Math.max(skill.rangeRead, readMin) });
  const n = quick ? AI.preflopMcSamples.quick : AI.preflopMcSamples.normal;
  // 이미 돈을 넣은 다른 사람(콜러·올인)은 그 사람 레인지까지 같이 계산 (푸시 뒤 콜러는 강함)
  //  아직 행동 안 한 사람은 '뒤에서 더 센 패가 깨어날' 작은 위험만 (예전엔 모두 참여자로 세서 AA가 44%로 나옴)
  const v = ctx.view;
  const acted = new Set(v.actionLog.filter((a) => a.street === 'preflop' && (a.type === 'call' || a.type === 'raise' || a.type === 'bet')).map((a) => a.seat));
  const involved = ctx.oppSeats.filter((s) => s !== villain && acted.has(s));
  const ranges = [range, ...involved.map((s) => buildRange(v, s, { read: Math.max(skill.rangeRead, readMin) }))];
  let eq = equityVsRanges(v.holeCards, [], ranges, n, rand).eq;
  const yetToAct = ctx.oppSeats.filter((s) => !acted.has(s) && s !== villain && v.seats.find((x) => x.seat === s)?.status === 'active').length;
  eq *= Math.pow(0.97, yetToAct);
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
  // 중급+: 필요 승률에 확실히 못 미치는 올인 콜은 확률로 뽑지 않음 (기계적 손해 콜)
  if (skill.level >= 4 && eq - prem < ctx.potOdds - 0.03) options[1].ev = -pot * 10;
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
  if (lvl < AI_V3.shortStackFrom || !L.canRaise) return null;
  const myOpened = v.actionLog.some((a) => a.street === 'preflop' && a.seat === v.mySeat && a.type === 'raise');
  const caseA = ctx.raisesPre === 1 && ctx.toCall > 0 && ctx.effBB <= AI_V3.jamBB;
  const caseB = ctx.raisesPre === 2 && myOpened && ctx.effBB <= 35;
  const caseC = ctx.raisesPre === 0 && !L.canCheck && ctx.effBB > AI.pushFoldBB && ctx.effBB <= 20 && lvl >= 6;
  if (caseC) {
    // 오픈 올인은 '내가 짧은 쪽'일 때만 (모두를 커버하는 칩리더가 숏스택 여럿에게 올인하면 콜이 몰림 → 작게 레이즈해 셔브/폴드를 시킨다)
    const st = readStacks(v);
    if (st.myBB > ctx.effBB * 1.3 || ctx.effBB > 16) return null;
    const m = pushMargin(ctx.key, Math.max(1, ctx.behind), ctx.effBB, v.level.ante / ctx.bb);
    const ri = base.options.findIndex((o) => o.act === 'raise');
    if (m === null || ri < 0 || ctx.pct <= 6 || m <= 0.05) return null; // 프리미엄은 작게 레이즈해 올인을 받고, 이득 없는 올인은 안 함
    // 프리미엄이 아닌데 표가 올인 이득이라고 하면: 올인/폴드 (소액 레이즈-폴드는 숏스택에서 칩 낭비)
    const jamP = Math.min(0.97, sig((m - 0.05) / 0.12));
    const jamTo = legalTo(ctx, L.maxRaiseTo);
    return {
      options: [{ key: 'raise:' + jamTo, act: 'raise', to: jamTo }, { key: 'fold', act: 'fold' }], probs: [jamP, 1 - jamP], intents: ['value', 'fold'],
      why: `${ctx.effBB.toFixed(0)}BB 오픈 자리: 표 기준 올인 이득 +${m.toFixed(2)}BB → 레이즈-폴드 대신 올인/폴드`,
    };
  }
  if (!caseA && !caseB) return null;
  const villain = ctx.lastPreRaiser!;
  // 이미 올인한 상대: 폴드 에퀴티가 없으니 단순 가격 계산(evMode)이 맞음
  if (v.seats.find((s) => s.seat === villain)?.status === 'allin') return null;
  const j = jamEV(ctx, skill, rand, quick, villain);
  const vr = buildRange(v, villain, { read: Math.max(0.6, skill.rangeRead) });
  const eqAll = equityVsRanges(v.holeCards, [], [vr], quick ? 150 : 400, rand).eq;
  const isBB = v.mySeat === v.bbSeat, isSB = v.mySeat === v.sbSeat && v.seats.length > 2;
  // 콜(플랫)의 승률 실현: 포지션·뒤에 남은 사람(스퀴즈 위험)만큼 깎는다. BB 아닌 플랫은 판단이 어려운 만큼 페널티
  //  (리뷰 상황 1차: 10~25BB에서 BB 외 플랫 35% — 생 승률을 다 실현한다고 가정했던 게 원인)
  const SC = AI_V3.shortCall;
  const behindN = ctx.activeOpp.filter((s) => s !== villain && !v.actionLog.some((a) => a.street === 'preflop' && a.seat === s && !['ante', 'sb', 'bb'].includes(a.type))).length;
  // BB도 패 종류별: 연결 안 된 오프수트 잡패는 플랍에서 대부분 접으므로 실현율이 낮다 (리뷰 상황 2차: 36o·23o·J2o 방어)
  const R13 = 'AKQJT98765432', k0 = ctx.key;
  const gap0 = R13.indexOf(k0[1]) - R13.indexOf(k0[0]);
  const junkOff = k0.length === 3 && k0[2] === 'o' && k0[0] !== 'A' && (gap0 >= 3 || (R13.indexOf(k0[0]) >= R13.indexOf('T') && gap0 >= 2));
  const bbReal = junkOff ? SC.bbJunk : k0.length === 3 && k0[2] === 'o' ? SC.bbOff : SC.bb;
  const realize = (isBB ? bbReal : !caseA ? 0.75 : isSB ? SC.sb : SC.ip) * Math.pow(SC.perBehind, caseA && !isBB ? behindN : 0);
  const evCall = eqAll * realize * (ctx.pot + ctx.toCall) - ctx.toCall - (caseA && !isBB ? SC.penaltyBB * ctx.bb : 0);
  // 짧은 스택(15BB 이하)에서 BB 아닌 자리의 플랫은 포켓페어(셋 노림)만
  const noFlat = caseA && !isBB && ctx.effBB <= SC.pairOnlyBB && ctx.key.length !== 2;
  const jamTo = legalTo(ctx, L.maxRaiseTo);
  const opts: Option[] = [{ key: 'fold', act: 'fold', ev: 0 }, { key: 'call', act: 'call', ev: evCall }, { key: 'raise:' + jamTo, act: 'raise', to: jamTo, ev: j.evJam }];
  const temp = lvl >= 7 ? 0.05 : 0.12;
  const vals = opts.map((o) => (o.ev ?? 0) / Math.max(1, ctx.pot));
  const mx = Math.max(...vals);
  // 아주 짧으면(8BB 이하) 콜하고 플랍 보는 건 낭비: 올인 아니면 폴드
  if (ctx.effBB <= 8 || noFlat) vals[1] = -Infinity;
  const ex = vals.map((x) => Math.exp((x - mx) / temp));
  const es = ex.reduce((a, b) => a + b, 0);
  // 기본 정책을 같은 세 행동으로 옮김 (레이즈 = 올인으로 봄)
  const bp = [0, 0, 0];
  base.options.forEach((o, i) => { bp[o.act === 'fold' || o.act === 'check' ? 0 : o.act === 'call' ? 1 : 2] += base.probs[i]; });
  const w = lvl >= 7 ? 0.85 : 0.5;
  if (ctx.effBB <= 8) { bp[2] += bp[1]; bp[1] = 0; }
  if (noFlat) { bp[0] += bp[1]; bp[1] = 0; }
  let probs = bp.map((b, i) => (1 - w) * b + w * (ex[i] / es));
  // 상급+: 최선보다 확실히 나쁜 선택(EV 손실이 Lv9+ 0.1BB, Lv7~8 0.25BB 넘음)은 고르지 않음 — 계산을 알면서 확률로 손해 보지 않게
  if (lvl >= 7) {
    const noCall = ctx.effBB <= 8 || noFlat;
    const best = Math.max(...opts.map((o, i) => (i === 1 && noCall ? -Infinity : o.ev ?? 0)));
    const cut = (lvl >= 9 ? 0.1 : 0.25) * ctx.bb;
    const kept = probs.map((x, i) => ((opts[i].ev ?? 0) < best - cut || (i === 1 && noCall) ? 0 : x));
    if (kept.some((x) => x > 0)) { const s = kept.reduce((a, b) => a + b, 0); probs = kept.map((x) => x / s); }
  }
  const why = `숏스택 대응(${caseA ? '오픈을 받음' : '3벳을 받음'}, 유효 ${ctx.effBB.toFixed(0)}BB): 콜 EV ${(evCall / ctx.bb).toFixed(1)}BB(승률 ${(eqAll * 100).toFixed(0)}%) · ${j.why}`;
  return { options: opts, probs, intents: ['fold', 'none', j.eqCalled >= 0.5 ? 'value' : 'semibluff'], why };
}
