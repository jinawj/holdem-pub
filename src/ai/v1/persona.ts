import personasJson from '../../data/personas.json';
import { DIFFICULTY, Difficulty, maxFish, AI } from '../../config';
import type { AiMemory, AiProfile, PersonaDef, PersonaId } from './types';

export const PERSONAS = personasJson as unknown as Record<PersonaId, PersonaDef>;
export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

/** 레벨이 정하는 것 (overview 3.6 표) */
export function levelFx(level: number) {
  const t = (level - 1) / 9; // 0(Lv1) .. 1(Lv10)
  return {
    /** 균등 분포와 섞는 비율 (실수 온도) */
    // 무작위 실수는 아주 조금만 (뜬금없는 실수 방지). 실력 차이는 방향 있는 실수(릭)·레인지 생각·푸시 정확도로 만든다
    noise: level >= 10 ? 0 : 0.07 * Math.pow(1 - t, 1.5),
    /** 푸시/폴드 표 경계 흐림 폭(BB): 이 폭 안의 경계 핸드만 헷갈림 */
    pushWidth: [0, 1.1, 0.9, 0.75, 0.5, 0.4, 0.3, 0.15, 0.1, 0.05, 0.02][level] ?? 0.3,
    /** 상대 레인지를 얼마나 반영하는지 (0 = 내 패만 봄, 1 = 레인지로 생각) */
    rangeWeight: level <= 3 ? 0 : [0, 0, 0, 0, 0.3, 0.45, 0.6, 0.8, 0.9, 1, 1][level],
    /** 팟오즈 감각 오차 (필요 승률에 더해지는 무작위 폭) */
    oddsNoise: 0.05 * (1 - t),
    /** EV softmax 온도 */
    evTemp: 0.02 + 0.14 * Math.pow(1 - t, 1.5),
    /** 'none' = 내 패만 봄, 'rough' = 레인지 대충, 'full' = 레인지로 생각 */
    rangeThinking: (level <= 3 ? 'none' : level <= 6 ? 'rough' : 'full') as 'none' | 'rough' | 'full',
    /** 블로커·MDF·블러프 비율까지 고려 */
    gtoMath: level >= 9,
    /** 숏스택 올인 범위 오차(%p) */
    pushNoise: level <= 3 ? 12 : level <= 6 ? 6 : level <= 8 ? 2 : 0,
    /** 이상한 베팅 크기 확률 */
    sizingMistake: level <= 3 ? 0.25 : level <= 6 ? 0.08 : level <= 8 ? 0.02 : 0,
    /** 감정 배수 */
    emotion: level >= 10 ? 0.3 : level <= 3 ? 1.3 : level <= 6 ? 1.0 : level <= 8 ? 0.6 : 0.4,
    /** 꼬리 자르기: 최선 대비 팟의 몇 배 이상 나쁜 행동 제거 */
    evCut: AI.guards.evLossCutLow + (AI.guards.evLossCutHigh - AI.guards.evLossCutLow) * t,
    /** 좋은 습관의 정확도 (지키는 비율 배수) */
    habitAcc: 0.7 + 0.3 * t,
  };
}

// 사람이 실제로 자주 하는 "방향 있는" 실수 (조사: 하수는 과다 콜·수동적·림프·약한 패 과대평가)
const LEAKS_BY_TIER: Record<string, string[]> = {
  // 피쉬는 '너무 많이 콜하고 수동적'인 쪽으로 틀림 (겁먹고 접는 실수는 중간 레벨 쪽)
  fish: ['overvalueTopPair', 'chaseDraws', 'minRaise', 'slowplayMonster', 'callDownLight', 'limpMarginal'],
  mid: ['overvalueTopPair', 'minRaise', 'scaredOfOvercards', 'fearBigBets', 'passiveDraws', 'autoCbet', 'giveUpAfterCaught'],
  strong: ['overvalueTopPair', 'fearBigBets', 'autoCbet'],
};

// 읽을 수 있는 버릇(텔): 낮은 레벨만. 솔버·레귤러는 없음
const TELLS = ['strongTank', 'weakSnap', 'bigMeansStrong', 'strongSmallBet'];

function jitter(x: number, rand: () => number, pct = 0.1) {
  return x * (1 + (rand() * 2 - 1) * pct);
}

export function makeProfile(personaId: PersonaId, level: number, rand: () => number): AiProfile {
  const d = PERSONAS[personaId];
  const fx = levelFx(level);
  const j = (x: number) => jitter(x, rand);
  const p = {
    loose: j(d.loose), aggression: d.aggression + (rand() * 2 - 1) * 0.08, bluffMult: j(d.bluffMult),
    cbetFreq: d.cbetFreq + (rand() * 2 - 1) * 0.05, stickiness: d.stickiness + (rand() * 2 - 1) * 0.05,
    foldToAggro: d.foldToAggro + (rand() * 2 - 1) * 0.05, limpFreq: Math.min(1, j(d.limpFreq)), sizing: d.sizing,
    evWeight: j(d.evWeight), tiltProne: Math.min(1, j(d.tiltProne)), moodRange: Math.min(1, j(d.moodRange)),
    recall: Math.min(1, j(d.recall)), showdownStyle: d.showdownStyle,
  };
  if (personaId === 'solver') { p.tiltProne = 0; p.moodRange = 0; p.recall = 0; p.aggression = 0; p.loose = 1; p.bluffMult = 1; }
  // 좋은 습관(레귤러 등)은 레벨이 높을수록 잘 지킴. 피쉬 성향의 습관은 레벨과 무관하게 일정
  // (피쉬의 레벨 차이는 방향 있는 실수의 개수·강도로 만든다)
  const habitScale = d.fish ? 1 : fx.habitAcc;
  const habits = d.habits.map((h) => ({ id: h.id, adherence: Math.min(0.98, h.adherence * habitScale) }));
  // 나쁜 습관(릭): Lv1–3: 3–4개 강하게, Lv4–6: 1–2개 약하게, Lv7–8: 0–1개 아주 약하게, Lv9+: 없음
  let leaks: { id: string; adherence: number }[] = [];
  const pick = (pool: string[], n: number, adh: number) => {
    const a = [...pool];
    const out: { id: string; adherence: number }[] = [];
    for (let i = 0; i < n && a.length; i++) out.push({ id: a.splice(Math.floor(rand() * a.length), 1)[0], adherence: adh });
    return out;
  };
  // 피쉬 구간 안에서도 레벨이 낮을수록 실수가 많고 강하게
  if (level <= 3) leaks = pick(LEAKS_BY_TIER.fish, level === 1 ? 4 : level === 2 ? 3 : 2, level === 1 ? 0.9 : level === 2 ? 0.72 : 0.5);
  else if (level <= 6) leaks = pick(LEAKS_BY_TIER.mid, 2, level === 4 ? 0.6 : level === 5 ? 0.5 : 0.4);
  else if (level <= 8) leaks = pick(LEAKS_BY_TIER.strong, rand() < 0.5 ? 1 : 0, 0.2);
  // 텔: Lv1–3 두 개, Lv4–5 한 개, 그 이상 없음. 솔버·레귤러는 없음
  let tells: string[] = [];
  if (personaId !== 'solver' && personaId !== 'reg') {
    const nT = level <= 3 ? 2 : level <= 5 ? 1 : 0;
    const pool = [...TELLS];
    // 서로 반대되는 사이즈 텔은 같이 갖지 않음
    for (let i = 0; i < nT && pool.length; i++) {
      const t = pool.splice(Math.floor(rand() * pool.length), 1)[0];
      tells.push(t);
      if (t === 'bigMeansStrong') pool.splice(pool.indexOf('strongSmallBet'), 1);
      if (t === 'strongSmallBet') pool.splice(pool.indexOf('bigMeansStrong'), 1);
    }
  }
  return { personaId, level, p, habits, leaks, tells };
}

export function newMemory(): AiMemory {
  return { tilt: 0, confidence: 0, foldStreak: 0, caughtBluff: 0, recall: [], handsPlayed: 0 };
}

export function isFish(personaId: PersonaId, level: number) {
  return level <= 4 || PERSONAS[personaId].fish;
}

/** 난이도에 따라 레벨을 고르게 배정하고, 피쉬 수 상한을 지키며 성향을 고른다 (overview 3.6) */
export function assignLevels(difficulty: Difficulty, n: number): number[] {
  const { minLv, maxLv } = DIFFICULTY[difficulty];
  const levels: number[] = [];
  for (let i = 0; i < n; i++) levels.push(n === 1 ? Math.round((minLv + maxLv) / 2) : Math.round(minLv + ((maxLv - minLv) * i) / (n - 1)));
  // 레벨 때문에 피쉬(Lv≤4)가 상한을 넘으면 가장 높은 피쉬 레벨부터 한 단계씩 올린다
  const cap = maxFish(difficulty, n);
  let guard = 0;
  while (levels.filter((l) => l <= 4).length > cap && guard++ < 50) {
    const idx = levels.reduce((best, l, i) => (l <= 4 && (best < 0 || l >= levels[best]) ? i : best), -1);
    levels[idx] = 5;
  }
  return levels.sort((a, b) => a - b);
}

export function createAiProfiles(difficulty: Difficulty, n: number, rand: () => number): AiProfile[] {
  const levels = assignLevels(difficulty, n);
  const cap = maxFish(difficulty, n);
  let fish = levels.filter((l) => l <= 4).length;
  const used: Record<string, number> = {};
  const out: AiProfile[] = [];
  for (const lv of levels) {
    let cands = PERSONA_IDS.filter((id) => lv >= PERSONAS[id].lv[0] && lv <= PERSONAS[id].lv[1]);
    const levelFish = lv <= 4;
    if (!levelFish && fish >= cap) cands = cands.filter((id) => !PERSONAS[id].fish);
    if (cands.length === 0) cands = ['reg'];
    const minUse = Math.min(...cands.map((c) => used[c] ?? 0));
    const least = cands.filter((c) => (used[c] ?? 0) === minUse);
    const id = least[Math.floor(rand() * least.length)];
    used[id] = (used[id] ?? 0) + 1;
    if (!levelFish && PERSONAS[id].fish) fish++;
    out.push(makeProfile(id, lv, rand));
  }
  // 좌석 무작위
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function profileLabel(pr: AiProfile): string {
  return `${PERSONAS[pr.personaId].name} Lv${pr.level}`;
}
