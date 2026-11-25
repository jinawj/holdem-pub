import { describe, expect, it } from 'vitest';
import { assignLevels, createAiProfiles, decide, isFish, newMemory, makeProfile, PERSONAS } from '../src/ai/v2';
import { DIFFICULTY, Difficulty, maxFish } from '../src/config';
import { makePlayerView } from '../src/engine/view';
import { Rng, seedFromNumber } from '../src/engine/rng';
import { mkHand } from './helpers';

const rng = new Rng(seedFromNumber(42));
const rand = () => rng.next();

describe('difficulty → levels & fish cap (overview 3.6)', () => {
  for (const d of ['normal', 'hard', 'veryhard'] as Difficulty[]) {
    for (const n of [5, 7, 9]) {
      it(`${d} with ${n} AIs: levels in range, evenly spread, fish cap kept`, () => {
        const { minLv, maxLv } = DIFFICULTY[d];
        const lv = assignLevels(d, n);
        expect(lv.every((l) => l >= minLv && l <= maxLv)).toBe(true);
        // 고르게: 범위의 양 끝 근처까지 쓰고, 같은 레벨이 과하게 몰리지 않음
        expect(Math.min(...lv)).toBeLessThanOrEqual(minLv + 1);
        expect(Math.max(...lv)).toBe(maxLv);
        const counts: Record<number, number> = {};
        lv.forEach((l) => (counts[l] = (counts[l] ?? 0) + 1));
        expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(Math.ceil(n / (maxLv - minLv + 1)) + 1);
        for (let k = 0; k < 30; k++) {
          const profs = createAiProfiles(d, n, rand);
          const fish = profs.filter((p) => isFish(p.personaId, p.level)).length;
          expect(fish).toBeLessThanOrEqual(maxFish(d, n));
          for (const p of profs) {
            expect(p.level).toBeGreaterThanOrEqual(minLv);
            expect(p.level).toBeLessThanOrEqual(maxLv);
            expect(p.level).toBeGreaterThanOrEqual(PERSONAS[p.personaId].lv[0]);
            expect(p.level).toBeLessThanOrEqual(PERSONAS[p.personaId].lv[1]);
          }
        }
      });
    }
  }
  it('very hard has no fish', () => {
    for (let k = 0; k < 20; k++) expect(createAiProfiles('veryhard', 9, rand).some((p) => isFish(p.personaId, p.level))).toBe(false);
  });
});

describe('AI smoke', () => {
  it('returns legal decisions within budget and never folds AA preflop', () => {
    const h = mkHand({ stacks: [40000, 40000, 40000, 40000, 40000, 40000], button: 0, holes: { 3: 'AsAh' } });
    const view = makePlayerView(h, 3, 6);
    for (const id of Object.keys(PERSONAS) as any[]) {
      for (let i = 0; i < 30; i++) {
        const d = decide(view, makeProfile(id, PERSONAS[id as 'reg'].lv[0], rand), newMemory(), { rand, quick: true });
        expect(d.type).not.toBe('fold');
        expect(d.memo.calcMs).toBeLessThan(80);
      }
    }
  });
});

// v2 마일스톤 6: 명확한 자리는 레벨·성향과 상관없이 정답 (실력 차이는 이름 붙은 구멍=릭으로만)
import { lockToClear, leanTo } from '../src/ai/v2/clarity';

describe('명확한 자리 (clarity)', () => {
  const all = (key: 'reg') => PERSONAS[key];
  it('앞자리 쓰레기 패(72o)는 모든 성향·레벨이 폴드', () => {
    const h = mkHand({ stacks: Array(6).fill(40000), button: 0, holes: { 3: '7h2c' } });
    const view = makePlayerView(h, 3, 6);
    for (const id of Object.keys(PERSONAS) as 'reg'[]) {
      const [lo, hi] = all(id).lv;
      for (let lv = lo; lv <= hi; lv++) {
        for (let i = 0; i < 5; i++) {
          const d = decide(view, makeProfile(id, lv, rand), newMemory(), { rand, quick: true });
          expect(d.type, `${id} Lv${lv}`).toBe('fold');
        }
      }
    }
  });
  it('프리미엄(AKo)은 아무도 안 들어왔으면 모든 성향·레벨이 레이즈', () => {
    const h = mkHand({ stacks: Array(6).fill(40000), button: 0, holes: { 3: 'AhKc' } });
    const view = makePlayerView(h, 3, 6);
    for (const id of Object.keys(PERSONAS) as 'reg'[]) {
      const [lo, hi] = all(id).lv;
      for (let lv = lo; lv <= hi; lv++) {
        const d = decide(view, makeProfile(id, lv, rand), newMemory(), { rand, quick: true });
        expect(d.type, `${id} Lv${lv}`).toBe('raise');
      }
    }
  });
  it('lockToClear: 허용 행동만 남기고 비율 유지, leanTo: 최소 비율 보장', () => {
    const p = lockToClear(['fold', 'call', 'raise'], [0.5, 0.3, 0.2], { id: 't', ok: ['call', 'raise'] });
    expect(p[0]).toBe(0);
    expect(p[1]).toBeCloseTo(0.6);
    expect(p[2]).toBeCloseTo(0.4);
    const q = leanTo(['check', 'raise', 'raise'], [0.8, 0.1, 0.1], { id: 't', act: 'raise', min: 0.85 });
    expect(q[1] + q[2]).toBeCloseTo(0.85);
    expect(q[1]).toBeCloseTo(q[2]);
    expect(q.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

import { drawInfo } from '../src/ai/v2/equity';
import { parseCards } from '../src/engine/cards';
describe('드로우 판정', () => {
  const d = (h: string, b: string) => drawInfo(parseCards(h), parseCards(b));
  it('한쪽이 막힌 A-K-Q-J는 거트샷', () => { expect(d('AdJh', '2dKcQs')).toMatchObject({ oesd: false, gutshot: true }); });
  it('9-8 on T-7-2 는 양방향', () => { expect(d('9s8s', 'Td7c2h')).toMatchObject({ oesd: true }); });
  it('A-2-3-4 휠 드로우는 거트샷', () => { expect(d('Ad2c', '3s4h9d')).toMatchObject({ oesd: false, gutshot: true }); });
  it('더블 거트(9-7 on J-8-5, 6·T 둘 다)는 양방향과 같게', () => { expect(d('9c7c', 'Jd8h5s')).toMatchObject({ oesd: true }); });
});

import { buildContext } from '../src/ai/v2/context';
import { applyMove } from '../src/engine/hand';
describe('보드 족보 판별', () => {
  it('보드 트립스(QQQ)는 내 패가 아님 (A4 = 노페어)', () => {
    let h = mkHand({ stacks: [40000, 40000], button: 0, holes: { 0: 'Ah4s', 1: '7c8d' }, board: 'QdQsQhKd2c' });
    h = applyMove(h, { type: 'call' } as any);
    h = applyMove(h, { type: 'check' } as any);
    const ctx = buildContext(makePlayerView(h, 1, 2));
    expect(ctx.street).toBe('flop');
    expect(ctx.madeCat).toBe(0);
  });
});

describe('보드가 플레이하는 패', () => {
  it('리버 보드 풀하우스(777 55)에 내 카드가 안 쓰이면 내 패 없음', () => {
    let h = mkHand({ stacks: [40000, 40000], button: 0, holes: { 0: 'AhKs', 1: '2c3d' }, board: '7d7s7h5d5c' });
    for (let i = 0; i < 7; i++) h = applyMove(h, { type: i === 0 ? 'call' : 'check' } as any);
    expect(h.street).toBe('river');
    expect(buildContext(makePlayerView(h, 1, 2)).madeCat).toBe(0);
  });
});
