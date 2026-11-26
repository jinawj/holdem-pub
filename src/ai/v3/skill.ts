// 레벨 → '보는 능력'. 낮은 레벨은 개념 자체를 못 보거나 흐릿하게 본다 (일부러 틀리게 만들지 않음)
import { AI_V3, lv } from '../../config';

export interface Skill {
  level: number;
  rangeRead: number;
  eqNoise: number;
  boardDanger: number;
  bigBetFear: boolean;
  potOdds: boolean;
  position: boolean;
  lineBasic: boolean;
  betSize: boolean;
  plan: boolean;
  lineFull: boolean;
  rangeStrategy: boolean;
  oppMemory: boolean;
  overbet: boolean;
  solver: boolean;
  evTemp: number;
  evWeight: number;
  evCut: number;
  slip: number;
  pairPride: number;
}

export function skillOf(level: number): Skill {
  const L = Math.max(1, Math.min(10, Math.round(level)));
  const f = AI_V3.from;
  return {
    level: L,
    rangeRead: lv(AI_V3.rangeRead, L),
    eqNoise: lv(AI_V3.eqNoise, L),
    boardDanger: lv(AI_V3.boardDanger, L),
    bigBetFear: L >= f.bigBetFear,
    potOdds: L >= f.potOdds,
    position: L >= f.position,
    lineBasic: L >= f.lineBasic,
    betSize: L >= f.betSize,
    plan: L >= f.plan,
    lineFull: L >= f.lineFull,
    rangeStrategy: L >= f.rangeStrategy,
    oppMemory: L >= f.oppMemory,
    overbet: L >= f.overbet,
    solver: L >= f.solver,
    evTemp: lv(AI_V3.evTemp, L),
    evWeight: lv(AI_V3.evWeight, L),
    evCut: lv(AI_V3.evCut, L),
    slip: lv(AI_V3.slip, L),
    pairPride: lv(AI_V3.pairPride, L),
  };
}

export function tierName(level: number) {
  return level <= 3 ? '초급' : level <= 6 ? '중급' : level <= 8 ? '상급' : '고수';
}
