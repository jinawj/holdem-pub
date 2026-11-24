import type { PlayerView } from '../../engine/view';

export type PersonaId = 'solver' | 'reg' | 'lag' | 'station' | 'nit' | 'maniac' | 'beginner';
export type Sizing = 'standard' | 'small' | 'overbet' | 'strengthTell';
export type ShowdownStyle = 'quiet' | 'sometimes' | 'shows' | 'showsBluffs' | 'showsWins';

export interface PersonaDef {
  name: string; style: string; fish: boolean; lv: [number, number];
  loose: number; aggression: number; bluffMult: number; cbetFreq: number; stickiness: number; foldToAggro: number;
  limpFreq: number; sizing: Sizing; evWeight: number; tiltProne: number; moodRange: number; recall: number;
  showdownStyle: ShowdownStyle;
  habits: { id: string; adherence: number }[];
  targets: { vpip: [number, number]; pfr: [number, number]; af: [number, number] };
}

/** 한 AI 좌석의 정체 (토너먼트 동안 고정, 저장 대상) */
export interface AiProfile {
  personaId: PersonaId;
  level: number; // 1..10
  /** 개인차(±10%)가 적용된 파라미터 */
  p: Omit<PersonaDef, 'habits' | 'targets' | 'name' | 'style' | 'lv' | 'fish'>;
  habits: { id: string; adherence: number }[];
  /** 레벨에 따른 나쁜 습관(릭) */
  leaks: { id: string; adherence: number }[];
}

/** 핸드 사이에 이어지는 기분·기억 (저장 대상) */
export interface AiMemory {
  tilt: number; // 0..1
  confidence: number; // -1..1
  foldStreak: number; // 연속 프리플랍 폴드 (지루함)
  caughtBluff: number; // 남은 핸드 수: 블러프 들킨 뒤
  recall: { seat: number; kind: 'sawBluff' | 'sawNutsBigBet' | 'beatMeBig'; handsLeft: number }[];
  handsPlayed: number;
}

export type ActKey = 'fold' | 'check' | 'call' | 'raise';
export interface Option { key: string; act: ActKey; to?: number; ev?: number }
export type Dist = Map<string, number>; // option key → 확률

export interface DecisionMemo {
  street: string;
  persona: string;
  level: number;
  equity?: number;
  potOdds?: number;
  handPct?: number;
  options: { key: string; p: number; ev?: number }[];
  chosen: string;
  habit?: string;
  guards: string[];
  calcMs: number;
  note?: string;
}

export interface AiDecision {
  type: ActKey;
  to?: number;
  thinkMs: number;
  memo: DecisionMemo;
}

export interface DecideOpts {
  quick?: boolean;
  /** [0,1) 난수 */
  rand: () => number;
  speedMult?: number;
  recallEnabled?: boolean;
}

export type { PlayerView };
