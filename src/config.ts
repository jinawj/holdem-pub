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
  leanV2: { threeBet: 0.85, valueWhenChecked: 0.85, protectRaise: 0.6, semiBluff: 0.55, threeBetBluff: 0.4, fishMult: 0.6 },
  /** v2: 기대값 컷 최소 폭(팟 대비). 고레벨에서 좁은 컷이 단순 EV 계산의 최고 행동 하나만 남기던 문제 방지 */
  evCutMinV2: 0.3,
  /** v2: 이 확률 미만 행동은 고르지 않음 (v1은 guards.tailCut 0.03) */
  tailCutV2: 0.07,
  /** v2: 상대 올인 범위를 표로 만들 때 경계 폭(BB). 넓으면 범위가 실제보다 크게 잡혀 콜이 과다해짐 */
  pushRangeEdgeV2: 0.05,
  /** v2: 올인을 받았을 때 상대 범위 반영 최소 비율 (하수 포함) */
  allInReadMinV2: 0.4,
  /** v2: 니트(foldToAggro)가 올인 콜을 줄이는 정도 (팟 대비 EV 감점 배수) */
  nitAllInFoldV2: 0.12,
  /** v2: 벳을 받았을 때(몬스터 제외) 최종 레이즈 ≤ 계획 레이즈 × mult + add */
  raiseCapV2: { mult: 1.5, add: 0.03 },
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
};

// ---------- AI v3: 생각 모듈 + 레벨별 능력 ----------
/**
 * 레벨(1~10)이 정하는 '보는 능력'. 배열은 [Lv1, Lv2, ..., Lv10].
 * 실력 차이는 일부러 틀리게 만들지 않고, 어떤 개념을 보느냐·얼마나 정확히 보느냐로 만든다.
 */
export const AI_V3 = {
  /** 상대 라인을 레인지에 반영하는 정도 (0 = 아무 패나, 1 = 라인대로) */
  rangeRead: [0, 0, 0.15, 0.3, 0.45, 0.6, 0.8, 0.9, 1, 1],
  /** 승률 감각 오차(표준편차) */
  eqNoise: [0.16, 0.14, 0.12, 0.09, 0.07, 0.05, 0.03, 0.02, 0.01, 0],
  /** 보드가 위험해진 걸 알아챌 확률 */
  boardDanger: [0.2, 0.3, 0.5, 0.7, 0.85, 1, 1, 1, 1, 1],
  /** 개념을 쓰기 시작하는 레벨 */
  from: {
    bigBetFear: 2, // 턴·리버 큰 벳(팟 75%+)은 센 패 — 원페어로 끝까지 안 감 (벳 크기를 제대로 읽는 Lv5 전 단계)
    potOdds: 3, // 팟 오즈
    position: 4, // 포지션 (IP/OOP)
    lineBasic: 3, // 라인 읽기: 레이즈·체크레이즈는 강하다
    betSize: 5, // 벳 크기가 말하는 것 (작으면 넓게, 크면 양극화)
    plan: 5, // 이전 스트리트의 내 계획을 기억
    lineFull: 6, // 라인 읽기: 캡·지연·프로브·블러프 가능성
    rangeStrategy: 7, // 내 레인지 전체로 생각 (레인지 우위·넛 우위·MDF·블러프 비율·블로커)
    overbet: 9, // 넛 우위 있을 때 오버벳
    solver: 9, // 리버 미니 솔버
  },
  /** 계산(EV) 소프트맥스 온도 (팟 단위). 낮을수록 계산대로 */
  evTemp: [0.35, 0.3, 0.25, 0.18, 0.14, 0.1, 0.07, 0.05, 0.035, 0.025],
  /** 감(계획)과 계산을 섞을 때 계산 비중 */
  evWeight: [0.1, 0.12, 0.15, 0.22, 0.28, 0.32, 0.3, 0.3, 0.25, 0.25],
  /** 감 브레인(하수~중수): 최선 EV보다 팟의 이 비율 이상 나쁜 행동은 버림 */
  evCut: [0.6, 0.55, 0.5, 0.4, 0.32, 0.26, 0.22, 0.2, 0.18, 0.16],
  /** 집중력 흐트러짐: 이 비율만큼 '수동적인 쪽'(체크·콜)으로 흐트러짐 */
  slip: [0.12, 0.1, 0.08, 0.06, 0.04, 0.03, 0.02, 0.01, 0, 0],
  /** 하수의 '페어면 좋은 패' 과신 (중간 패 계속 비율 하한) */
  pairPride: [0.85, 0.8, 0.6, 0.5, 0.4, 0, 0, 0, 0, 0],
  /** 이 확률 미만 행동은 고르지 않음 */
  tailCut: 0.05,
  tailCutGut: 0.1,
  /** 초급(Lv1~3): 판단과 반대인 15% 미만 행동은 고르지 않음 (리뷰 4차: '페어니까 따라감'인데 16% 폴드 등) */
  tailCutLow: 0.15,
  /** 토너먼트 위험 프리미엄(올인 콜에 더 필요한 승률): 내가 커버할 때 / 10BB 미만 / 커버당할 때 기본 + 스택 깊이(10→40BB)만큼 */
  riskPremium: { covering: 0, short: 0.01, coveredBase: 0.03, coveredDeep: 0.05 },
  /** 숏스택(이 BB 이하) 오픈에 대한 리셔브·3벳 대응을 올인 EV로 계산 */
  jamBB: 28,
  /** 올인에 대한 상대 콜 범위 배수 (이론 범위보다 사람이 넓게 콜함. 리뷰 상황 1차: K3o·65s 리셔브 과다) */
  jamCallLoose: 1.6, // 자동 튜닝(2026-11-27) 1.3 → 1.6
  /** 헤즈업에서 상대가 보는 내 올인 범위(%) — 넓을수록 상대가 넓게 콜 (35 → 48: BB 리셔브 41%는 과다) */
  huJamPct: 66, // 상황 리뷰 2차 60 → 자동 튜닝 66
  /** 올인 앞에 이미 콜(림프·콜드콜)한 사람의 콜 범위 배수 (0.6 → 0.9) */
  jamCallerMult: 0.9,
  /** 숏스택 오픈에 콜(플랫)의 승률 실현율: BB / 인포지션 / SB(아웃오브포지션), 뒤에 남은 사람 1명당 배수(스퀴즈 위험), 콜 페널티(BB) */
  //  BB는 수딧·페어 bb / 오프수트 bbOff / K 이하 연결 안 된 오프수트 잡패 bbJunk (리뷰 상황 2차: BB 수비 콜 60~66% 과다)
  shortCall: { bb: 0.8, bbOff: 0.72, bbJunk: 0.6, ip: 0.72, sb: 0.62, perBehind: 0.93, penaltyBB: 0.5, pairOnlyBB: 15 },
  /** 레인지 브레인: 레이저 앞 리드(동크) 기본 비율 / 다들 체크한 인포지션 찔러보기 비율 / 체크레이즈 밸류 영역 배수 */
  donkBase: 0.11, // 자동 튜닝 0.09 → 0.11
  stabAllChecked: 0.36,
  xrMult: 2.5, // 자동 튜닝 2.0 → 2.5
  /** 리버 전 콜의 승률 실현율 (다음 스트리트에 접게 되는 몫) */
  callRealize: { ip: 0.85, oop: 0.85 }, // 자동 튜닝 (0.96/0.9 → 0.85/0.85): 리버 전 블러프 캐치 콜 줄임(WTSD 과다)
  /** 최고 레벨(9+): 이 확률 미만 행동은 고르지 않음 (판단과 반대인 드문 행동 제거. 솔버의 혼합은 제외) */
  tailCutTop: 0.15,
  /** 최고 레벨(9+) 프리플랍: 이 확률 미만 행동은 고르지 않음 (92% 오픈인데 8% 폴드 같은 것 — 상황별 점검) */
  tailCutPreTop: 0.1,
  /** 숏스택 올인 EV 층을 쓰기 시작하는 레벨 */
  shortStackFrom: 7,
  /** 상대가 올인에 콜하는 범위(전체 핸드 상위 %) — 콜에 필요한 승률별 [필요 승률, 상위 %] */
  callPctByNeed: [[0.5, 3], [0.45, 6], [0.4, 11], [0.35, 18], [0.3, 28], [0.25, 42], [0.2, 60], [0.1, 90]] as [number, number][],
  /** 칩리더 압박: 오픈 범위 최대 배수 */
  leaderOpenMult: 1.3,
  /** 고수(Lv9+) 벳 크기 섞기: 다른 크기로 보내는 비율 */
  sizeMixTop: 0.35,
  /** BB 수비 전체 범위(%) = (base + 오프너 오픈%) × √(refNeed / 콜에 필요한 승률), 최대 max. 팟 오즈를 못 보는 레벨은 noOddsBase + 0.6×오픈% */
  bbDefend: { base: 28, /* 자동 튜닝 23 → 28 */ refNeed: 0.28, max: 78, noOddsBase: 24 },
  /** 오픈에 콜(플랫) 범위 배수: 늦은 자리(뒤에 2명 이하) / 그 외 */
  coldCall: { late: 1.5, mid: 1.6, sb: 0.45 }, // 자동 튜닝 mid 1.15 → 1.6
  /** 오픈했다가 3벳을 받았을 때 계속(콜+4벳)할 비율 = 내 오픈 범위 × (포지션 있음 ip / 없음 oop) */
  vs3bet: { ip: 0.58, oop: 0.43 }, // 리뷰 상황 1차: 3벳에 폴드 57~65% → 45~50% 목표
  /**
   * 플레이 스타일 (docs/v3-styles.md). 축은 −1..1 (0 = 표준). tiers: 이 스타일이 나오는 레벨 구간 (low Lv1~3 / mid 4~6 / high 7~10)
   *  tight 참여 범위(+타이트) · aggro 공격성 · bluff 블러프 빈도 · sticky 끝까지 따라감 · trap 강한 패 숨기기 · limp 림프 버릇
   */
  styles: {
    standard: { name: '정석형', tiers: ['low', 'mid', 'high'], axes: {} },
    tag: { name: '타이트 공격형', tiers: ['mid', 'high'], axes: { tight: 0.5, aggro: 0.5 } },
    lag: { name: '루즈 공격형', tiers: ['high'], axes: { tight: -0.35, aggro: 0.45, bluff: 0.3 } },
    trapper: { name: '함정형', tiers: ['high'], axes: { trap: 0.5 } },
    // 고수 성격 (2026-11-27 상황별 리뷰): 실력은 같고 '무엇을 더 중시하나'가 다름
    //  (1차 축 0.8로는 통계 차이가 1~3%p뿐 → 키움. 고수 구간 ×0.6이 곱해짐)
    balance: { name: '밸런스형', tiers: ['high'], axes: { xr: 1.5, trap: 0.4 } }, // 레인지 균형: 체크레이즈·체크 레인지 보호
    pressure: { name: '압박형', tiers: ['high'], axes: { barrel: 1.5, aggro: 0.5, bluff: 0.3 } }, // 폴드 에퀴티: 배럴·블러프 3벳
    showdown: { name: '쇼다운형', tiers: ['high'], axes: { potCtl: 1.5, tight: 0.2, bluff: -0.3 } }, // 쇼다운 가치: 팟 조절, 큰 팟 원페어 자제
    sticky: { name: '콜 경향', tiers: ['mid'], axes: { sticky: 0.6, aggro: -0.3 } },
    scared: { name: '겁 많은 타입', tiers: ['mid', 'low'], axes: { tight: 0.6, sticky: -0.6, bluff: -0.6 } },
    beginner: { name: '입문자', tiers: ['low'], axes: { limp: 0.8, sticky: 0.4, aggro: -0.4 } },
    station: { name: '콜스테이션', tiers: ['low'], axes: { sticky: 0.75, tight: -0.3, aggro: -0.5 } },
    maniac: { name: '막 지르는 타입', tiers: ['low'], axes: { aggro: 0.8, bluff: 0.8, tight: -0.5 } },
  },
  /** 같은 스타일이라도 레벨이 높을수록 덜 극단적 (축 배수) */
  styleScale: { low: 1, mid: 0.8, high: 0.6 },
  /** 축 1.0일 때 옮기는 확률 몫 */
  styleEffect: { tight: 0.35, looseMaxPct: 55, limp: 0.5, aggroPre: 0.3, bluff: 0.6, sticky: 0.45, stickyMinEq: 0.12, aggroPost: 0.3, bluffPost: 0.5, trap: 0.35, xr: 0.5, barrel: 0.35, barrel3b: 0.5, potCtl: 0.45, potCtlFold: 0.35 },
  /** 임플라이드 오즈 콜(Lv4+): 유효 스택 / 콜 금액이 이 배수 이상이면 포켓페어·수딧 커넥터를 이 비율로 콜 */
  impliedOdds: { pairRatio: 18, pairCall: 0.8, scRatio: 50, scCall: 0.6 },
  /** 헤즈업 테이블 SB 오픈 범위(%) */
  huOpen: 80,
  /** 레인지 브레인 블러프 비율 배수 (이론값 b/(P+2b) 대비). 리버 1 미만 = 사람들이 리버에서 덜 접는 것 반영 */
  bluffMult: { flop: 1.2, turn: 1.49, river: 0.85 }, // 자동 튜닝 turn 1.35 → 1.49, 선형 벳 추가 후 재튜닝 flop 1.6 → 1.2 (턴 레인지 벳 0.5 → 0.625) // 상황 리뷰 2차: 플랍·턴 블러프 예산이 작아 AF 1.0 (1.3/1.1 → 1.6/1.35)
  /** 레인지 브레인 밸류 영역 경계 흐림 폭 (0.04 → 0.06) */
  valueEdge: 0.06,
  /** 레인지 브레인 벳 빈도 기본값: 주도권 있음(플랍 + 드라이/웻 보정, 턴 + 무서운 카드, 리버) / 체크로 넘어옴 */
  rangeBet: { flop: 0.69, dry: 0.15, wet: -0.12, turn: 0.625, scare: 0.05, river: 0.4, checkedFlop: 0.29, checkedTurn: 0.52, checkedRiver: 0.36 }, // 자동 튜닝 (flop 0.55·turn 0.45·checkedFlop 0.38·checkedTurn 0.42에서)
  /** 선형 벳: 레인지 벳 비율이 from에서 from+span으로 갈수록 블러프 몫의 share만큼을 얇은 밸류로 (사용자 신고: 고빈도 C벳 보드에서 중간 패 0%) */
  merge: { from: 0.35, span: 0.3, share: 0.7 },
  /** 레인지 브레인 수비 폭 = MDF × (base + bluffy × 상대 블러프 가능성) */
  defend: { base: 0.47, bluffy: 1.1 }, // 자동 튜닝 0.62 → 0.47
  /** 헤즈업 프리플랍: BB 3벳(올인 아닌) 범위 상한(%), BB 전체 수비 상한(%) */
  hu: { bb3bet: 10.5, bbDefend: 70 }, // 자동 튜닝 16 → 10.5
  /** 상급+(Lv7+) 자리별 오픈 배수: 뒤에 남은 사람 1·2·3·4·5명 이상 (SB·BTN·CO·HJ·UTG) */
  openScale: [0.88, 1, 1, 1.12, 1.25], // 자동 튜닝 (SB 좁게, HJ·UTG 넓게)
  /** 레인지 브레인 수비: 실현 승률이 가격 이상이면 최소 이 비율은 계속 */
  contFloorAtPrice: 0.65,
  /** 리버 솔버의 블러프 확률 배수 (같은 이유) */
  solverBluffScale: 0.75,
  /** 리버 솔버: 블러프 캐처 콜 배수 기본값 (× 상대 블러프 가능성/평균) */
  solverCallScale: 0.85,
  /** 레인지 추정: 벳·레이즈 레인지 속 블러프(세미블러프 포함) 비중 (평균적인 사람 기준, 라인이 배수로 조정) */
  rangeBluffShare: { bet: { flop: 0.38, turn: 0.3, river: 0.1 }, raise: { flop: 0.28, turn: 0.2, river: 0.1 } },
  /** 리버 벳 블러프 비중 배수 (기본 river 값 = 팟 50~110% 벳): 작은 벳 16% / 오버벳 8% 정도 */
  riverBluffBySize: { small: 1.6, over: 0.8 },
  /** 몬테카를로 샘플 */
  mc: { normal: 900, quick: 260 },
  /** 리버 솔버: 버킷 수, 반복, 시간 상한(ms) */
  solver: { buckets: 22, iters: 260, maxMs: 40 },
  /** 프리플랍: 레벨별 경계 흐림(백분위 폭), 림프 성향, 콜 과다 배수, 푸시 경계 흐림(BB) */
  pre: {
    width: [5.5, 5, 4.4, 3.6, 3.1, 2.7, 2.4, 2.2, 2.0, 1.8],
    limp: [0.32, 0.26, 0.1, 0.06, 0.03, 0, 0, 0, 0, 0], // Lv3부터 시작 패를 고름(림프·과다 콜이 크게 줄어듦)
    callMult: [1.5, 1.4, 1.12, 1.08, 1.04, 1, 1, 1, 1, 1],
    pushWidth: [1.1, 0.9, 0.75, 0.35, 0.25, 0.15, 0.1, 0.07, 0.05, 0.02],
    threeBetMult: [0.6, 0.7, 0.8, 0.9, 1, 1.05, 1.1, 1.15, 1.2, 1.2],
    bluff3bet: [0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.5],
  },
};
export const lv = (arr: number[], level: number) => arr[Math.max(1, Math.min(10, Math.round(level))) - 1];
