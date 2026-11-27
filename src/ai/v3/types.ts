// AI v3 타입. 바깥(게임·대결장)과 주고받는 모양은 v2와 같게 유지 (decide → AiDecision)
import type { PlayerView } from '../../engine/view';

export type { PlayerView };
export type ActKey = 'fold' | 'check' | 'call' | 'raise';
export interface Option { key: string; act: ActKey; to?: number; ev?: number }

/** v3 프로필: 지금은 실력(레벨)만. 플레이 스타일(TAG·루즈 등)은 나중에 style로 붙인다 */
export interface V3Profile { version: 3; level: number; style?: string }

/** 한 스트리트에서 내가 세운 계획 (다음 스트리트 판단에 이어 씀) */
export type Intent = 'value' | 'thin' | 'protect' | 'bluff' | 'semibluff' | 'potControl' | 'bluffCatch' | 'trap' | 'float' | 'giveUp' | 'fold' | 'none';
export interface Plan { handNo: number; street: string; intent: Intent; note: string }

export interface V3Memory {
  version: 3;
  plans: Plan[]; // 이번 핸드에서 내가 세운 계획들
}

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
  clear?: string;
  calcMs: number;
  note?: string;
  /** v3: 생각 과정 (모듈별 한 줄) */
  thoughts?: string[];
  /** v3: 이번 행동의 의도 */
  intent?: Intent;
  /** v3: 판단한 두뇌 (gut=감, range=레인지 전략, solver=리버 솔버, pre=프리플랍) */
  brain?: string;
}

export interface AiDecision { type: ActKey; to?: number; thinkMs: number; memo: DecisionMemo }

export interface DecideOpts { quick?: boolean; rand: () => number; speedMult?: number }
