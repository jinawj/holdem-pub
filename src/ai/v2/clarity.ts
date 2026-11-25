// 명확한 자리 판별 (v2 마일스톤 6)
// "보는 사람이 한눈에 정답을 아는 자리"를 골라 허용 행동을 정한다.
//  - 명확한 자리에서는 레벨·성향과 상관없이 정답 행동만 한다 (무작위 실수·계산 흔들림 금지)
//  - 실력 차이는 이름 붙은 구멍(릭)으로만: 릭이 자기 자리에서 발동하면 그 구멍은 일부러 남긴다
//  - 판별은 자기 에퀴티 추정(레벨마다 다름)이 아니라 족보·보드·가격 같은 객관적 사실로만 한다
import { AI } from '../../config';
import type { Ctx } from './context';
import type { ActKey } from './types';

const AI_LEAN = AI.leanV2;

export interface Clear {
  id: string; // 자리 이름 (측정·로그용)
  ok: ActKey[]; // 허용 행동
}

const PREMIUM_ALWAYS = ['AA', 'KK'];
const PREMIUM = ['AA', 'KK', 'QQ', 'AKs', 'AKo'];

export function judgeClear(ctx: Ctx): Clear | null {
  return ctx.street === 'preflop' ? preflop(ctx) : postflop(ctx);
}

function preflop(ctx: Ctx): Clear | null {
  const L = ctx.view.legal;
  const facing = ctx.toCall > 0;
  // 아무도 레이즈 안 했는데 프리미엄 → 레이즈 (림프·폴드 금지)
  if (ctx.raisesPre === 0 && PREMIUM.includes(ctx.key) && L.canRaise) return { id: '프리미엄 오픈', ok: ['raise'] };
  // AA·KK는 어떤 상황에서도 접지 않음, QQ·AK는 오픈·3벳까지는 접지 않음
  if (facing && (PREMIUM_ALWAYS.includes(ctx.key) || (PREMIUM.includes(ctx.key) && ctx.raisesPre <= 2))) {
    return { id: '프리미엄 폴드 금지', ok: ['call', 'raise'] };
  }
  // 쓰레기 패(하위 35%)로 프리플랍 올인 콜 금지 (8BB 이상, 콜이 스택 대부분일 때)
  if (facing && ctx.pct >= 65 && ctx.effBB >= 8 && ctx.toCall >= 0.5 * (L.stack + L.committed)) return { id: '쓰레기 패 올인 콜 금지', ok: ['fold'] };
  // 아래는 깊은 스택에서만 (짧으면 푸시/폴드 표가 정함)
  if (ctx.effBB < 15) return null;
  // 4벳 이상을 받은 비프리미엄 패: 플랫 콜 금지 (폴드 또는 올인 5벳)
  if (ctx.raisesPre >= 3 && facing && !PREMIUM.includes(ctx.key) && ctx.toCall < 0.6 * L.stack) return { id: '4벳에 플랫 금지', ok: ['fold', 'raise'] };
  // 앞 포지션 쓰레기 패 오픈·림프 금지 (BB 체크는 제외)
  if (ctx.raisesPre === 0 && !L.canCheck && ctx.behind >= 4 && ctx.pct >= 70) return { id: '앞자리 쓰레기 패 폴드', ok: ['fold'] };
  // 레이즈 받은 쓰레기 패 (싼 BB 방어 제외)
  if (ctx.raisesPre >= 1 && facing && ctx.pct >= 65 && ctx.potOdds > 0.25) return { id: '레이즈 받은 쓰레기 패 폴드', ok: ['fold'] };
  return null;
}

function postflop(ctx: Ctx): Clear | null {
  const v = ctx.view;
  const river = ctx.street === 'river';
  const facing = ctx.toCall > 0;
  const drawing = !river && (ctx.flushDraw || ctx.oesd || ctx.gutshot);
  const bigDraw = !river && (ctx.flushDraw || ctx.oesd);
  const allInCall = ctx.toCall >= 0.6 * v.legal.stack;

  if (facing) {
    // 셋 이상(무늬 보드의 셋 제외)은 벳 한 번에 접지 않음
    if ((ctx.madeCat >= 4 || (ctx.madeCat === 3 && !ctx.monotone)) && ctx.raisesThisStreet <= 1) {
      return { id: '강한 패 폴드 금지', ok: ['call', 'raise'] };
    }
    // 원페어(보드 페어 투페어 포함)로 레이즈 전쟁 금지: 레이즈를 받은 뒤 다시 올리지 않음 (깊은 스택)
    const onePair = ctx.madeCat === 1 || (ctx.madeCat === 2 && ctx.paired);
    if (onePair && ctx.raisesThisStreet >= 2 && !bigDraw && ctx.spr > 1.5) return { id: '원페어 레이즈 전쟁 금지', ok: ['fold', 'call'] };
    // 리버 노페어로 큰 벳: 폴드 (리버 블러프 레이즈는 사람 눈에 이상해 보여 막음)
    if (river && ctx.madeCat === 0 && ctx.lastBetFrac >= 0.5) return { id: '리버 노페어 큰 벳 폴드', ok: ['fold'] };
    // 멀티웨이 에어(드로우도 없음)로 벳 따라가기 금지
    if (ctx.madeCat === 0 && !drawing && ctx.numOpp >= 2 && ctx.lastBetFrac >= (ctx.street === 'flop' ? 0.5 : 0.33)) return { id: '멀티웨이 에어 폴드', ok: ['fold'] };
    // 좋은 드로우 + 싼 가격은 계속
    if (bigDraw && ctx.potOdds <= 0.25 && !allInCall) return { id: '드로우 싼 가격 계속', ok: ['call', 'raise'] };
    // 페어 이상 + 아주 작은 벳은 계속
    if (ctx.madeCat >= 1 && ctx.potOdds < 0.2 && ctx.raisesThisStreet <= 1 && !allInCall) return { id: '작은 벳 페어 계속', ok: ['call', 'raise'] };
    return null;
  }
  // 리버 넛급 밸류: 체크를 받았거나 내가 주도권 → 벳
  if (river && v.legal.canRaise) {
    const nutty = ctx.madeCat >= 5 || (ctx.madeCat === 4 && !ctx.monotone) || (ctx.madeCat === 3 && !ctx.monotone && !ctx.paired && ctx.wet < 0.5);
    const myTurnToValue = ctx.checkedToMe || ctx.view.actionLog.filter((a) => a.street === 'turn' && (a.type === 'bet' || a.type === 'raise')).slice(-1)[0]?.seat === v.mySeat;
    if (nutty && myTurnToValue) return { id: '리버 강한 패 밸류벳', ok: ['raise'] };
  }
  return null;
}

// ---- 압박 자리: 꼭 정답은 아니지만 강하게 쳐야 사람 눈에 '잘 친다'로 보이는 자리 ----
//  해당 행동을 최소 비율 이상으로 끌어올린다 (피쉬 성향은 수동적인 게 특징이라 낮게)
export interface Lean { id: string; act: ActKey; min: number }

export function judgeLean(ctx: Ctx, fish: boolean, level = 6): Lean | null {
  const L = ctx.view.legal;
  if (!L.canRaise) return null;
  const P = AI_LEAN;
  const m = (x: number) => (fish ? x * P.fishMult : x);
  if (ctx.street === 'preflop') {
    if (ctx.raisesPre === 1 && ctx.toCall > 0 && ctx.effBB >= 20 && ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'].includes(ctx.key)) {
      return { id: '강한 패 3벳', act: 'raise', min: m(P.threeBet) };
    }
    // 고수의 3벳 블러프: A5s~A2s (A 블로커 + 휠), 깊은 스택에서 오픈 한 번 받았을 때
    if (!fish && level >= 7 && ctx.raisesPre === 1 && ctx.toCall > 0 && ctx.effBB >= 40 && ['A5s', 'A4s', 'A3s', 'A2s'].includes(ctx.key)) {
      return { id: '3벳 블러프(A5s류)', act: 'raise', min: P.threeBetBluff };
    }
    return null;
  }
  const HU = ctx.numOpp === 1;
  const facing = ctx.toCall > 0;
  const strongMade = ctx.madeCat >= 3 || (ctx.madeCat === 2 && !ctx.paired) || (ctx.madeCat === 1 && ctx.topPair && ctx.street !== 'river');
  // 체크를 받았거나 내가 직전 스트리트 공격자(주도권) + 강한 메이드 → 밸류벳 (멀티웨이는 셋 이상만)
  const order = ['preflop', 'flop', 'turn', 'river'];
  const prevAggr = ctx.view.actionLog.filter((a) => a.street === order[order.indexOf(ctx.street) - 1] && (a.type === 'bet' || a.type === 'raise')).slice(-1)[0]?.seat;
  const myMove = ctx.checkedToMe || prevAggr === ctx.view.mySeat;
  if (!facing && myMove && (HU || ctx.madeCat >= 3) && strongMade && !(ctx.monotone && ctx.madeCat < 5)) {
    return { id: '체크 받은 강한 패 밸류', act: 'raise', min: m(P.valueWhenChecked) };
  }
  if (facing && ctx.street !== 'river' && ctx.madeCat >= 3 && !ctx.monotone && ctx.wet > 0.4 && ctx.raisesThisStreet === 1) {
    return { id: '젖은 보드 몬스터 레이즈', act: 'raise', min: m(P.protectRaise) };
  }
  // 넛 플러시 드로우·콤보 드로우로 체크를 받음 → 세미블러프 (상대 2명까지)
  const all = [...ctx.view.holeCards, ...ctx.view.board];
  const aceFd = ctx.flushDraw && ctx.view.holeCards.some((c) => (c >> 2) === 12 && all.filter((x) => (x & 3) === (c & 3)).length === 4);
  if (!facing && ctx.checkedToMe && ctx.street !== 'river' && ctx.numOpp <= 2 && ctx.madeCat === 0 && (aceFd || (ctx.flushDraw && ctx.oesd))) {
    return { id: '넛 드로우 세미블러프', act: 'raise', min: m(P.semiBluff) };
  }
  return null;
}

/** 해당 행동 비율이 min보다 낮으면 나머지에서 비례로 가져와 min까지 올린다 */
export function leanTo(acts: ActKey[], probs: number[], lean: Lean): number[] {
  const idx = acts.map((a, i) => (a === lean.act ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return probs;
  const mass = idx.reduce((a, i) => a + probs[i], 0);
  if (mass >= lean.min) return probs;
  const rest = 1 - mass;
  const k = rest > 0 ? (1 - lean.min) / rest : 0;
  // 레이즈 크기는 기존 비율대로, 없으면 첫(작은) 크기
  return probs.map((p, i) => (idx.includes(i) ? (mass > 0 ? (p / mass) * lean.min : i === idx[0] ? lean.min : 0) : p * k));
}

/** 확률을 허용 행동 쪽으로 모은다. 남기는 비율(strength 밖)만 원래대로 */
export function lockToClear(acts: ActKey[], probs: number[], clear: Clear): number[] {
  const okMass = probs.reduce((a, p, i) => a + (clear.ok.includes(acts[i]) ? p : 0), 0);
  const okIdx = acts.map((a, i) => (clear.ok.includes(a) ? i : -1)).filter((i) => i >= 0);
  if (okIdx.length === 0) return probs;
  if (okMass <= 0) {
    // 허용 행동에 확률이 하나도 없으면 고르게 (레이즈가 허용이면 레이즈 중 첫 번째, 즉 작은 크기 우선)
    const pref = okIdx.find((i) => acts[i] !== 'raise') ?? okIdx[0];
    return probs.map((_, i) => (i === pref ? 1 : 0));
  }
  return probs.map((p, i) => (clear.ok.includes(acts[i]) ? p / okMass : 0));
}
