// AI 입구 (앱·Worker가 쓰는 유일한 곳): v2 / v3(베타)를 프로필 모양으로 구분해 같은 방식으로 부른다.
//  v2를 없앨 때: 이 파일의 v2 분기와 import만 지우고 AiVersion을 'v3'만 남기면 된다.
import { DIFFICULTY, Difficulty } from '../config';
import type { HandState } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { summaryFor } from '../game/summary';
import * as V2 from './v2';
import * as V3 from './v3';

export type AiVersion = 'v2' | 'v3';
export const AI_VERSIONS: AiVersion[] = ['v2', 'v3'];
export const AI_VERSION_LABEL: Record<AiVersion, string> = { v2: 'V2', v3: 'V3 (베타)' };

export type AnyProfile = V2.AiProfile | V3.V3Profile;
export type AnyMemory = V2.AiMemory | V3.V3Memory;
/** 결정·메모 모양은 v3가 v2의 상위 집합 (생각 줄 thoughts 등이 추가됨) */
export type AiDecision = V3.AiDecision;
export type DecisionMemo = V3.DecisionMemo;

export const isV3 = (p: AnyProfile): p is V3.V3Profile => (p as V3.V3Profile).version === 3;
export const versionOf = (p: AnyProfile): AiVersion => (isV3(p) ? 'v3' : 'v2');

export function createProfiles(version: AiVersion, difficulty: Difficulty, n: number, rand: () => number): AnyProfile[] {
  if (version === 'v3') { const d = DIFFICULTY[difficulty]; return V3.createProfilesV3(d.minLv, d.maxLv, n, rand); }
  return V2.createAiProfiles(difficulty, n, rand);
}

export function newMemoryFor(p: AnyProfile): AnyMemory {
  return isV3(p) ? V3.newMemoryV3() : V2.newMemory();
}

export function decide(view: PlayerView, p: AnyProfile, mem: AnyMemory, opts: { rand: () => number; speedMult?: number; recallEnabled?: boolean; quick?: boolean }): AiDecision {
  if (isV3(p)) return V3.decide(view, p, mem as V3.V3Memory, opts);
  return V2.decide(view, p, mem as V2.AiMemory, opts) as AiDecision;
}

/** 핸드가 끝난 뒤 기억 갱신 (공개 정보만). v3는 쇼다운에서 본 상대 라인을 기억 */
export function afterHand(p: AnyProfile, mem: AnyMemory, h: HandState, seat: number, recallEnabled: boolean): AnyMemory {
  if (isV3(p)) {
    const m = mem as V3.V3Memory;
    const shown = h.result && !h.result.uncontested ? h.players.filter((x) => !x.folded).map((x) => ({ seat: x.seat, hole: [x.hole[0], x.hole[1]] as [number, number] })) : [];
    if (recallEnabled) V3.observeHandV3(m, seat, h.actions, h.board, shown);
    else { m.plans = []; m.handsSeen++; }
    return m;
  }
  return V2.updateMemory(mem as V2.AiMemory, p, summaryFor(h, seat), recallEnabled);
}

export function wantsToShow(p: AnyProfile, won: boolean, rand: () => number): boolean {
  return isV3(p) ? V3.wantsToShowV3(p, won, rand) : V2.wantsToShow(p, won, false, rand);
}

export function profileLabel(p: AnyProfile): string {
  return isV3(p) ? V3.profileLabelV3(p) : V2.profileLabel(p);
}

/** 사람 결정 시점의 "AI 기준" (기록용): 게임의 AI 버전과 같은 버전의 최고 레벨 */
export function baselineProfile(version: AiVersion): AnyProfile {
  return version === 'v3' ? V3.makeProfileV3(10) : V2.makeProfile('solver', 10, () => 0.5);
}
