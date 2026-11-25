// 튜닝용 숫자를 한 곳에 모은다. (AI 성향 파라미터는 src/data/personas.json)

export const CHIP_UNIT = 100; // 가장 작은 칩 = 최소 베팅 단위
export const START_STACK_BB_OPTIONS = [200, 300, 500];
/** 시작 스택 = BB 수 × 200 (첫 레벨 BB = 200) */
export const START_STACK_MULT = 200;
export const TABLE_SIZES = [6, 8, 10];
export const LEVEL_MINUTES_OPTIONS = [3, 5, 8, 10, 15];
export const DEFAULT_LEVEL_MINUTES = 5;

export type AiSpeed = 'fast' | 'normal' | 'real';
/** AI 고민 시간 배율 */
export const AI_SPEED_MULT: Record<AiSpeed, number> = { fast: 0.5, normal: 1.0, real: 1.6 };
/** AI 최소 고민 시간(ms): 아무리 쉬운 결정(쓰레기 패 폴드 등)이라도 이만큼은 생각하는 척 */
export const MIN_THINK_MS: Record<AiSpeed, number> = { fast: 500, normal: 1000, real: 1500 };
/** 앞 사람 액션 연출을 볼 수 있게, 다음 사람이 행동하기 전 최소 간격(ms) */
export const ACTION_GAP_MS: Record<AiSpeed, number> = { fast: 450, normal: 800, real: 1100 };
/** 칩 이동 애니메이션 길이(ms) — 연출 시간표의 기준값 */
export const CHIP_ANIM_MS: Record<AiSpeed, number> = { fast: 300, normal: 520, real: 700 };
/** 핸드 종료 후 결과를 보여주는 시간(ms) */
export const HAND_END_PAUSE_MS: Record<AiSpeed, number> = { fast: 300, normal: 500, real: 800 };

export type Difficulty = 'normal' | 'hard' | 'veryhard';
export const DIFFICULTY: Record<Difficulty, { name: string; minLv: number; maxLv: number; fishRatio: number }> = {
  normal: { name: '보통', minLv: 3, maxLv: 7, fishRatio: 0.3 },
  hard: { name: '어려움', minLv: 5, maxLv: 8, fishRatio: 0 /* 최대 1명 별도 처리 */ },
  veryhard: { name: '매우 어려움', minLv: 7, maxLv: 10, fishRatio: 0 },
};
export function maxFish(d: Difficulty, aiCount: number): number {
  if (d === 'normal') return Math.round(aiCount * 0.3);
  if (d === 'hard') return 1;
  return 0;
}

export const SAVE_VERSION = 1;

// ---------- AI 공통 튜닝값 ----------
export const AI = {
  /** 몬테카를로 샘플 수 (정상 / 빠른 모드) */
  mcSamples: { normal: 1200, quick: 250 },
  /** 프리플랍 대 레인지 에퀴티 샘플 */
  preflopMcSamples: { normal: 500, quick: 150 },
  /** 오픈 % (내 뒤에 남은 사람 수 → %) */
  openPctByBehind: { 1: 40, 2: 44, 3: 26, 4: 19, 5: 15, 6: 13, 7: 11, 8: 10, 9: 9 } as Record<number, number>,
  /** 10BB 기준 푸시 % (뒤에 남은 사람 수 → %) — 근사, 검증 안 됨 */
  pushPctAt10bb: { 1: 55, 2: 38, 3: 30, 4: 25, 5: 21, 6: 18, 7: 16, 8: 14, 9: 13 } as Record<number, number>,
  pushFoldBB: 13,
  sigmoidWidth: 2.2,
  /** 3벳 비율 = 상대 오픈 레인지 × */
  threeBetValueRatio: 0.25,
  callRatio: 0.42,
  fourBetPct: 2.6,
  callThreeBetPct: 3.0,
  /** 안전장치 */
  guards: {
    tailCut: 0.03,
    tinyCallNeedEq: 0.05,
    /** 최선 EV 대비 팟의 몇 배 이상 나쁜 행동 제거 (레벨 1 → 10 선형) */
    evLossCutLow: 0.45,
    evLossCutHigh: 0.12,
  },
  /** v2: 레벨별 구멍(릭) [개수, 지키는 비율]. 레벨 차이는 여기서 만든다 */
  leaksByLevel: {
    1: [3, 0.85], 2: [3, 0.8], 3: [2, 0.8], 4: [2, 0.7], 5: [1, 0.7], 6: [1, 0.6], 7: [1, 0.5], 8: [0, 0], 9: [0, 0], 10: [0, 0],
  } as Record<number, [number, number]>,
  /** v2: 애매한 자리의 무작위 실수 배수 (명확한 자리에는 아예 없음) */
  noiseMultV2: 0.5,
  /** v2: 압박 자리 최소 비율 (clarity.ts judgeLean). 피쉬 성향은 fishMult배 */
  leanV2: { threeBet: 0.85, valueWhenChecked: 0.85, protectRaise: 0.6, semiBluff: 0.55, fishMult: 0.6 },
  /** v2: 기대값 컷 최소 폭(팟 대비). 고레벨에서 좁은 컷이 단순 EV 계산의 최고 행동 하나만 남기던 문제 방지 */
  evCutMinV2: 0.3,
  /** v2: 이 확률 미만 행동은 고르지 않음 (v1은 guards.tailCut 0.03) */
  tailCutV2: 0.07,
  /** v2: 고수 일관성. 레벨 from 이상에서 확률을 (1 + perLevel×(레벨−from+1))제곱 후 정규화 (Lv10 ≈ 1.75제곱) */
  sharpenV2: { from: 6, perLevel: 0.15 },
  /** v2: 고수(Lv7+, 비피쉬) 3벳 범위 배수 */
  threeBetMultV2: 1.3,
  /** v2 전용 성향 조정 (personas.json은 v1 기준선과 같이 쓰므로 여기서 덮어씀). habits: 습관 id → 지키는 비율 */
  personaV2: {
    maniac: { p: { cbetFreq: 0.2 }, habits: { overbet: 0.35 } },
  } as Record<string, { p?: Record<string, number>; habits?: Record<string, number> }>,
  thinkMs: { base: 500, perDifficulty: 2200, random: 600, snap: 350 },
  tiltDecay: 0.85,
  recallHands: 8,
};
