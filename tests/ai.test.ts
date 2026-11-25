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
