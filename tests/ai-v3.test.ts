// AI v3 기본 점검: 여러 레벨이 6인 테이블에서 쳐도 규칙 위반·칩 오류·금지 행동이 없고, 판단이 빠르다
import { describe, expect, it } from 'vitest';
import * as V3 from '../src/ai/v3';
import { buildContext } from '../src/ai/v3/context';
import { parseCards } from '../src/engine/cards';
import { startHand } from '../src/engine/hand';
import { seedFromNumber, seedToString } from '../src/engine/rng';
import { makePlayerView } from '../src/engine/view';
import { newRunStats, runHand } from '../src/game/headless';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('AI v3', () => {
  it('6인 40핸드: 규칙 위반·칩 오류·금지 행동 0, 판단 200ms 미만', () => {
    const levels = [1, 3, 5, 7, 9, 10];
    const profs = levels.map((l) => V3.makeProfileV3(l));
    const mems = levels.map(() => V3.newMemoryV3());
    const rand = rng(7);
    const rs = newRunStats();
    for (let k = 0; k < 40; k++) {
      const btn = k % 6;
      const h = startHand({
        handNo: k + 1, seed: seedToString(seedFromNumber(1000 + k)), level: { level: 1, sb: 100, bb: 200, ante: 0 }, numSeats: 6,
        buttonSeat: btn, sbSeat: (btn + 1) % 6, bbSeat: (btn + 2) % 6,
        players: levels.map((_, s) => ({ seat: s, name: 'P' + s, stack: 20000 })),
      });
      runHand(h, (hs, seat) => V3.decide(makePlayerView(hs, seat, 6), profs[seat], mems[seat], { rand, quick: true }), rs, 6);
    }
    expect(rs.illegal).toBe(0);
    expect(rs.chipErrors).toBe(0);
    expect(rs.forbidden).toEqual({});
    expect(Math.max(...rs.calcMs)).toBeLessThan(200);
  });

  it('보드 투페어 + 더 높은 포켓 페어는 내 패(투페어), 더 낮은 포켓 페어는 보드가 플레이', () => {
    const mk = (hole: string, board = '2cTs2d4d4h') => ({
      handId: '1', handNo: 1, mySeat: 0, holeCards: parseCards(hole) as [number, number], board: parseCards(board), street: 'river',
      numSeats: 2, buttonSeat: 0, sbSeat: 0, bbSeat: 1,
      seats: [{ seat: 0, stack: 19000, committed: 0, startStack: 20000, status: 'active' }, { seat: 1, stack: 19000, committed: 0, startStack: 20000, status: 'active' }],
      pots: [{ amount: 2000, eligibleSeats: [0, 1] }], potTotal: 2000, actionLog: [],
      legal: { canCheck: true, callAmount: 0, canRaise: true, minRaiseTo: 200, maxRaiseTo: 19000, committed: 0, stack: 19000, currentBet: 0 },
      level: { level: 1, sb: 100, bb: 200, ante: 0 }, playersLeft: 2,
    } as any);
    expect(buildContext(mk('8c8s')).madeCat).toBe(2);
    expect(buildContext(mk('3c3s')).madeCat).toBe(2); // 44-33 > 44-22
    expect(buildContext(mk('3c3s', '5cTs5d4d4h')).madeCat).toBe(0); // 55-44 보드가 플레이
  });

  it('레벨이 보는 개념: 초급은 레인지 전략·솔버 없음, 고수는 둘 다', () => {
    expect(V3.skillOf(2).rangeStrategy).toBe(false);
    expect(V3.skillOf(2).potOdds).toBe(false);
    expect(V3.skillOf(7).rangeStrategy).toBe(true);
    expect(V3.skillOf(10).solver).toBe(true);
  });
});
