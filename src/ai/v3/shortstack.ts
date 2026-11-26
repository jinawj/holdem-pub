// 숏스택 싸움 모듈: 올인(리셔브·오픈 셔브·3벳 셔브)의 기대값을 직접 계산
//  EV(올인) = 모두 폴드할 확률 × 지금 팟 + 콜받을 확률 × (콜 범위 상대 승률 × 최종 팟 − 내가 건 돈)
//  - 상대가 콜할 범위: 상대 레인지(라인으로 추정) 중 '콜에 필요한 승률'을 넘는 상위 패 (config AI_V3.callPctByNeed)
//  - 뒤에 남은 사람도 아무 패나 중 상위 일부로 콜할 수 있음
//  - 토너먼트 위험 프리미엄: 내가 커버당하면 콜받았을 때의 승률을 조금 깎아 본다
import { AI_V3 } from '../../config';
import { COMBO_KEYS } from '../../engine/cards';
import { equityVsRanges } from '../core/equity';
import { keyPct } from '../core/handrank';
import type { Ctx } from './context';
import { buildRange, openPctFor, pushPctFor } from './range';
import { behindPreflop } from './context';
import type { Skill } from './skill';
import { riskPremium } from './stacks';

const PCT = COMBO_KEYS.map((k) => keyPct(k));

/** 콜에 필요한 승률 → 그 승률을 넘는 핸드 범위(전체 상위 %) */
export function callPctForNeed(need: number): number {
  const t = AI_V3.callPctByNeed;
  if (need >= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (need >= t[i][0]) {
      const [n0, p0] = t[i - 1], [n1, p1] = t[i];
      return p1 + ((need - n1) / (n0 - n1)) * (p0 - p1);
    }
  }
  return t[t.length - 1][1];
}

export interface JamOut { evJam: number; evCall?: number; foldEq: number; eqCalled: number; why: string }

/**
 * @param villain 주 상대(마지막 레이저). 없으면 블라인드 상대 오픈 셔브
 */
export function jamEV(ctx: Ctx, skill: Skill, rand: () => number, quick: boolean, villain: number | null): JamOut {
  const v = ctx.view, L = v.legal;
  const pot = ctx.pot;
  const risk = L.maxRaiseTo - L.committed; // 내가 더 넣는 돈
  const jamTo = L.maxRaiseTo;
  const others = v.seats.filter((s) => s.seat !== v.mySeat && s.status === 'active');
  let foldAll = 1;
  let eqCalled = 0.5;
  let callers: Float64Array | null = null;
  const notes: string[] = [];
  // 상대 콜 범위는 "내 올인 범위가 얼마나 넓어 보이나"에 따라 넓어짐 (표는 약 15% 올인 범위 기준).
  //  헤즈업·블라인드 싸움은 올인 범위가 넓어서 상대도 넓게 콜함 → 폴드 에퀴티를 과대평가하던 문제
  const J = v.seats.length === 2 ? 35 : villain === null ? pushPctFor(ctx.effBB, Math.max(1, ctx.behind)) : Math.max(8, Math.min(30, 0.45 * openPctFor(behindPreflop(v, villain), false) + 4));
  const widen = Math.pow(J / 15, 0.9);
  // 주 상대
  if (villain !== null) {
    const vs = v.seats.find((s) => s.seat === villain)!;
    const vAdd = Math.min(vs.stack + vs.committed, jamTo) - vs.committed;
    const need = vAdd / Math.max(1, pot + risk + vAdd);
    const cp = Math.min(95, callPctForNeed(need) * widen);
    const R = buildRange(v, villain, { read: Math.max(0.6, skill.rangeRead) });
    let tot = 0, call = 0;
    callers = new Float64Array(1326);
    for (let i = 0; i < 1326; i++) { if (R[i] <= 0) continue; tot += R[i]; if (PCT[i] <= cp) { call += R[i]; callers[i] = R[i]; } }
    const fv = tot > 0 ? 1 - call / tot : 0.5;
    foldAll *= fv;
    notes.push(`상대 ${villain}번은 상위 ${cp.toFixed(0)}%로 콜(필요 ${(need * 100).toFixed(0)}%) → 폴드 ${(fv * 100).toFixed(0)}%`);
  }
  // 뒤에 남은 사람들 (아직 액션 안 함): 아무 패 중 상위 일부로 콜 (콜드콜이라 조금 더 좁게)
  const acted = new Set(v.actionLog.filter((a) => a.street === 'preflop' && !['ante', 'sb', 'bb'].includes(a.type)).map((a) => a.seat));
  let restCp = 0;
  for (const o of others) {
    if (o.seat === villain) continue;
    const add = Math.min(o.stack + o.committed, jamTo) - o.committed;
    const need = add / Math.max(1, pot + risk + add);
    // 이미 콜(림프·콜드콜)한 사람은 레이즈를 안 한 만큼 강한 패가 덜 있음
    const cp = Math.min(95, callPctForNeed(need) * widen * (acted.has(o.seat) ? 0.6 : 0.85));
    foldAll *= 1 - cp / 100;
    restCp = Math.max(restCp, cp);
  }
  if (villain === null && restCp > 0) notes.push(`뒤 사람들 상위 약 ${restCp.toFixed(0)}%로 콜 → 모두 폴드 ${(foldAll * 100).toFixed(0)}%`);
  // 콜받았을 때 승률: 주 상대의 콜 범위(없으면 뒤 사람의 콜 범위)
  if (!callers || callers.every((x) => x === 0)) {
    callers = new Float64Array(1326);
    const cp = Math.max(restCp, 5);
    for (let i = 0; i < 1326; i++) callers[i] = PCT[i] <= cp ? 1 : 0;
  }
  const n = quick ? 220 : 500;
  eqCalled = equityVsRanges(v.holeCards, [], [callers], n, rand).eq;
  const prem = villain !== null ? riskPremium(v, villain) : 0;
  const eqAdj = Math.max(0, eqCalled - (skill.level >= 7 ? prem : 0));
  // 콜받았을 때 실제로 걸리는 돈: 상대가 맞출 수 있는 만큼만 (내가 더 크면 나머지는 돌려받음)
  const vs = villain !== null ? v.seats.find((s) => s.seat === villain)! : null;
  const vTotal = vs ? vs.stack + vs.committed : L.committed + Math.min(risk, ctx.effStack);
  const riskEff = Math.max(0, Math.min(risk, vTotal - L.committed));
  const vAdd = vs ? Math.min(vTotal, L.committed + riskEff) - vs.committed : riskEff;
  const evJam = foldAll * pot + (1 - foldAll) * (eqAdj * (pot + riskEff + vAdd) - riskEff);
  const why = `올인 EV ${(evJam / ctx.bb).toFixed(1)}BB: ${notes.join(', ')} · 콜받으면 승률 ${(eqCalled * 100).toFixed(0)}%${prem && skill.level >= 7 ? ` (생존 프리미엄 −${(prem * 100).toFixed(0)}%p)` : ''}`;
  return { evJam, foldEq: foldAll, eqCalled, why };
}
