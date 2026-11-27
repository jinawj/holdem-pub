// AI v3 기본 점검: 여러 레벨이 6인 테이블에서 쳐도 규칙 위반·칩 오류·금지 행동이 없고, 판단이 빠르다
import { describe, expect, it } from 'vitest';
import * as V3 from '../src/ai/v3';
import { buildContext } from '../src/ai/v3/context';
import { applyStyle, styleAxes, stylesFor } from '../src/ai/v3/style';
import { parseCards } from '../src/engine/cards';
import { startHand } from '../src/engine/hand';
import { seedFromNumber, seedToString } from '../src/engine/rng';
import { makePlayerView } from '../src/engine/view';
import { newRunStats, runHand } from '../src/game/headless';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 사용자 신고 재현: 신고에 저장된 화면 정보(PlayerView)를 그대로 v3에 넣어 행동 비율이 기대 범위인지 (tests/ai-spots/v3-reports.json)
import reports from './ai-spots/v3-reports.json';
describe('AI v3 신고 재현', () => {
  for (const r of reports as any[]) {
    it(`${r.id}: ${r.desc}`, () => {
      const rand = rng(42);
      const cnt: Record<string, number> = { fold: 0, check: 0, call: 0, raise: 0 };
      const n = 60;
      for (let t = 0; t < n; t++) cnt[V3.decide(r.view, r.profile, V3.newMemoryV3(), { rand, quick: true }).type]++;
      for (const [k, [lo, hi]] of Object.entries(r.expect as Record<string, [number, number]>)) {
        const v = cnt[k] / n;
        expect(v, `${k} ${(v * 100).toFixed(0)}% (기대 ${lo * 100}~${hi * 100}%)`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v).toBeLessThanOrEqual(hi + 1e-9);
      }
    });
  }
});

describe('AI v3', () => {
  it('6인 40핸드: 규칙 위반·칩 오류·금지 행동 0, 판단 95%가 200ms 미만', () => {
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
    // 시간은 기계·JIT 예열·GC에 흔들림 → 95% 구간은 200ms, 최악 1건만 넉넉히(CI 안정)
    const ms = [...rs.calcMs].sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length * 0.95)]).toBeLessThan(200);
    expect(ms[ms.length - 1]).toBeLessThan(2000);
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

  it('초급 개념이 레벨마다 다름: Lv2 큰 벳 경계, Lv3 팟 오즈·레이즈는 강하다', () => {
    expect(V3.skillOf(1).bigBetFear).toBe(false);
    expect(V3.skillOf(2).bigBetFear).toBe(true);
    expect(V3.skillOf(2).potOdds).toBe(false);
    expect(V3.skillOf(3).potOdds).toBe(true);
    expect(V3.skillOf(3).lineBasic).toBe(true);
  });

  it('스타일: 레벨 구간에 맞게 배정되고, 스타일은 확률만 민다', () => {
    const r = rng(3);
    for (const [lo, hi] of [[1, 3], [4, 6], [7, 10]]) {
      for (const p of V3.createProfilesV3(lo, hi, 9, r)) {
        if (p.style) expect(stylesFor(p.level)).toContain(p.style);
      }
    }
    expect(styleAxes('station', 2).sticky).toBeGreaterThan(styleAxes('station', 9).sticky - 1e-9); // 높은 레벨일수록 덜 극단적
    // 벳을 받은 자리: 콜스테이션은 폴드 몫 일부를 콜로
    const ctx = { street: 'turn', facingBet: true, potOdds: 0.3, pct: 50, raisesPre: 1 } as any;
    const opts = [{ key: 'fold', act: 'fold' }, { key: 'call', act: 'call' }] as any;
    const probs = [0.6, 0.4];
    expect(applyStyle(opts, probs, ['fold', 'bluffCatch'], ctx, styleAxes('station', 2), 0.3)).not.toBeNull();
    expect(probs[1]).toBeGreaterThan(0.4);
    // 승률이 아주 낮으면 스타일로도 콜을 만들지 않음
    const p2 = [0.9, 0.1];
    applyStyle(opts, p2, ['fold', 'bluffCatch'], ctx, styleAxes('station', 2), 0.05);
    expect(p2[1]).toBeCloseTo(0.1);
  });
});
