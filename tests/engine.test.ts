import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/engine/cards';
import { categoryOf, evaluate } from '../src/engine/evaluator';
import { applyMove, legalActions, IllegalActionError } from '../src/engine/hand';
import { computePots, splitPot } from '../src/engine/pots';
import { L1, L5, chipsInPlay, mkHand } from './helpers';

const ev = (s: string) => evaluate(parseCards(s));

describe('evaluator', () => {
  it('categories', () => {
    expect(categoryOf(ev('AhKhQhJhTh2c3d'))).toBe(8);
    expect(categoryOf(ev('Ah2h3h4h5h9c9d'))).toBe(8);
    expect(categoryOf(ev('AhAdAcAs2h3c4d'))).toBe(7);
    expect(categoryOf(ev('AhAdAcKsKh3c4d'))).toBe(6);
    expect(categoryOf(ev('Ah9h3h4h7hKcKd'))).toBe(5);
    expect(categoryOf(ev('Ah2c3d4h5s9c9d'))).toBe(4);
    expect(categoryOf(ev('2h2c2d9hKs7c4d'))).toBe(3);
    expect(categoryOf(ev('2h2c9d9hKs7c4d'))).toBe(2);
    expect(categoryOf(ev('2h2c8d9hKs7c4d'))).toBe(1);
    expect(categoryOf(ev('2h3c8d9hKs7cJd'))).toBe(0);
  });
  it('ordering and kickers', () => {
    expect(ev('AhAd KcQc 2s3s4d')).toBeGreaterThan(ev('AhAd KcJc 2s3s4d'));
    expect(ev('6h5c 2s3s4d 9h Td')).toBeGreaterThan(ev('Ah5c 2s3s4d 9h Td')); // 6하이 > 휠
    expect(ev('AhAd KcKd QcQd 2s')).toBe(ev('AhAd KcKd QcQs 3s')); // 투페어 + 키커 Q
    expect(ev('KhKd Kc 2s2d 3h3c')).toBe(ev('KhKd Kc 3s3d 2h2c'));
  });
});

describe('betting rules', () => {
  it('min raise = previous increment', () => {
    const h = mkHand({ stacks: [10000, 10000, 10000, 10000], button: 0 });
    // 액션: 3(UTG)
    expect(h.toAct).toBe(3);
    let l = legalActions(h)!;
    expect(l.minRaiseTo).toBe(400);
    applyMove(h, { type: 'raise', to: 700 }); // +500
    l = legalActions(h)!;
    expect(l.minRaiseTo).toBe(1200);
    expect(() => applyMove(h, { type: 'raise', to: 1100 })).toThrow(IllegalActionError);
    applyMove(h, { type: 'raise', to: 1200 });
    expect(legalActions(h)!.minRaiseTo).toBe(1700);
  });

  it('min bet = BB postflop', () => {
    const h = mkHand({ stacks: [10000, 10000, 10000], button: 0 });
    applyMove(h, { type: 'call' }); applyMove(h, { type: 'call' }); applyMove(h, { type: 'check' });
    expect(h.street).toBe('flop');
    const l = legalActions(h)!;
    expect(l.canCheck).toBe(true);
    expect(l.minRaiseTo).toBe(200);
  });

  it('incomplete all-in raise does not reopen action', () => {
    // 3인: 0 버튼, 1 SB, 2 BB. 0이 1000 레이즈, 1 콜, 2가 1300 올인(불완전)
    const h = mkHand({ stacks: [10000, 10000, 1300], button: 0 });
    applyMove(h, { type: 'raise', to: 1000 }); // BTN
    applyMove(h, { type: 'call' }); // SB
    applyMove(h, { type: 'raise', to: 1300 }); // BB 올인 (증가분 300 < 800)
    expect(h.toAct).toBe(0);
    const l = legalActions(h)!;
    expect(l.canRaise).toBe(false);
    expect(l.callAmount).toBe(300);
    applyMove(h, { type: 'call' });
    expect(legalActions(h)!.canRaise).toBe(false);
  });

  it('player who has not acted may re-raise over incomplete all-in', () => {
    const h = mkHand({ stacks: [10000, 1300, 10000, 10000], button: 0 });
    // 0 BTN, 1 SB, 2 BB, 3 UTG
    applyMove(h, { type: 'raise', to: 1000 }); // UTG
    applyMove(h, { type: 'call' }); // BTN
    applyMove(h, { type: 'raise', to: 1300 }); // SB 올인 불완전
    expect(h.toAct).toBe(2);
    expect(legalActions(h)!.canRaise).toBe(true); // BB는 아직 자발적 행동 전
    expect(legalActions(h)!.minRaiseTo).toBe(2100);
    applyMove(h, { type: 'call' });
    expect(h.toAct).toBe(3);
    expect(legalActions(h)!.canRaise).toBe(false);
  });

  it('cumulative full raise reopens', () => {
    const h = mkHand({ stacks: [10000, 10000, 10000, 10000], button: 0 });
    applyMove(h, { type: 'raise', to: 1000 }); // UTG(3), +800
    applyMove(h, { type: 'raise', to: 2000 }); // BTN(0), 풀 레이즈
    expect(legalActions(h)!.minRaiseTo).toBe(3000);
  });

  it('chips are conserved', () => {
    const h = mkHand({ stacks: [10000, 5000, 3000], button: 0 });
    const total = chipsInPlay(h);
    applyMove(h, { type: 'raise', to: 10000 });
    applyMove(h, { type: 'call' });
    applyMove(h, { type: 'call' });
    expect(h.street).toBe('done');
    expect(chipsInPlay(h)).toBe(total);
  });
});

describe('side pots', () => {
  it('3+ players all-in builds side pots correctly', () => {
    // 0: 1000, 1: 3000, 2: 6000, 3: 10000 모두 올인/콜
    const pots = computePots([
      { seat: 0, total: 1000, folded: false },
      { seat: 1, total: 3000, folded: false },
      { seat: 2, total: 6000, folded: false },
      { seat: 3, total: 6000, folded: false },
      { seat: 4, total: 500, folded: true },
    ]);
    expect(pots.map((p) => p.amount)).toEqual([4500, 6000, 6000]);
    expect(pots[0].eligible).toEqual([0, 1, 2, 3]);
    expect(pots[1].eligible).toEqual([1, 2, 3]);
    expect(pots[2].eligible).toEqual([2, 3]);
  });

  it('short stack wins main pot, bigger stack wins side pot', () => {
    const h = mkHand({
      stacks: [1000, 3000, 6000], button: 0,
      holes: { 0: 'AhAd', 1: 'KhKd', 2: 'QhQd' }, board: '2c3c7d9sJh',
    });
    applyMove(h, { type: 'raise', to: 1000 }); // BTN 올인
    applyMove(h, { type: 'raise', to: 3000 }); // SB 올인
    applyMove(h, { type: 'call' }); // BB 콜
    expect(h.street).toBe('done');
    const r = h.result!;
    expect(r.pots[0].amount).toBe(3000);
    expect(r.pots[0].winners).toEqual([0]);
    expect(r.pots[1].amount).toBe(4000);
    expect(r.pots[1].winners).toEqual([1]);
    expect(h.players.map((p) => p.stack)).toEqual([3000, 4000, 3000]);
  });
});

describe('split pot', () => {
  it('odd chip goes to first winner left of button', () => {
    const order = [3, 4, 0, 1, 2]; // 버튼 2
    expect(splitPot(500, [1, 4], order)).toEqual([{ seat: 4, amount: 300 }, { seat: 1, amount: 200 }]);
    expect(splitPot(1000, [0, 1, 4], order)).toEqual([
      { seat: 4, amount: 400 }, { seat: 0, amount: 300 }, { seat: 1, amount: 300 },
    ]);
  });
  it('board plays → split with odd chip in hand', () => {
    const h = mkHand({
      stacks: [10000, 10000, 10000], button: 0, level: { level: 1, sb: 100, bb: 200, ante: 0 },
      holes: { 0: '2h3d', 1: '2c3h', 2: '4c5d' }, board: 'AhKhQhJhTh',
    });
    applyMove(h, { type: 'call' }); applyMove(h, { type: 'call' }); applyMove(h, { type: 'check' });
    for (let i = 0; i < 9; i++) applyMove(h, { type: 'check' });
    expect(h.street).toBe('done');
    expect(h.result!.pots[0].winners.length).toBe(3);
  });
  it('odd chip in a real hand goes to winner nearest button-left', () => {
    // 버튼 2, SB 0, BB 1(앤티 100 포함) → 팟 500을 0과 1이 나눔 → 0이 300
    const h = mkHand({
      stacks: [10000, 10000, 10000], button: 2, level: { level: 1, sb: 100, bb: 200, ante: 100 },
      holes: { 0: 'AhKd', 1: 'AcKs', 2: '7c2d' }, board: 'AdKh9s5c3d',
    });
    expect(h.toAct).toBe(2);
    applyMove(h, { type: 'fold' });
    applyMove(h, { type: 'call' });
    applyMove(h, { type: 'check' });
    for (let i = 0; i < 6; i++) applyMove(h, { type: 'check' });
    expect(h.street).toBe('done');
    expect(h.result!.pots[0].amount).toBe(500);
    expect(h.players[0].stack).toBe(10100);
    expect(h.players[1].stack).toBe(9900);
  });
});

describe('heads-up blinds', () => {
  it('button posts SB, acts first preflop and last postflop', () => {
    const h = mkHand({ stacks: [10000, 10000], button: 0 });
    expect(h.sbSeat).toBe(0);
    expect(h.players[0].committed).toBe(100);
    expect(h.players[1].committed).toBe(200);
    expect(h.toAct).toBe(0);
    applyMove(h, { type: 'call' });
    expect(h.toAct).toBe(1); // BB 옵션
    applyMove(h, { type: 'check' });
    expect(h.street).toBe('flop');
    expect(h.toAct).toBe(1); // 플랍 이후 BB 먼저
  });
});

describe('BB ante', () => {
  it('ante is not part of BB live bet', () => {
    const h = mkHand({ stacks: [100000, 100000, 100000], button: 0, level: L5 });
    const bb = h.players[2];
    expect(bb.ante).toBe(1000);
    expect(bb.committed).toBe(2000);
    expect(h.antePot).toBe(1000);
    applyMove(h, { type: 'call' }); // BTN 2000
    applyMove(h, { type: 'call' }); // SB +1000
    expect(h.toAct).toBe(2);
    expect(legalActions(h)!.canCheck).toBe(true);
    applyMove(h, { type: 'check' });
    expect(h.street).toBe('flop');
    expect(h.snapshots[h.snapshots.length - 1].pot).toBe(7000);
  });
  it('short BB pays ante first, then blind', () => {
    const h = mkHand({ stacks: [100000, 100000, 2500], button: 0, level: L5 });
    const bb = h.players[2];
    expect(bb.ante).toBe(1000);
    expect(bb.committed).toBe(1500);
    expect(bb.allIn).toBe(true);
    expect(h.currentBet).toBe(2000); // 다른 사람은 BB 전액을 맞춰야 함
  });
  it('ante goes to main pot even when BB folds', () => {
    const h = mkHand({ stacks: [100000, 100000, 100000], button: 0, level: L5 });
    const total = chipsInPlay(h);
    applyMove(h, { type: 'raise', to: 5000 });
    applyMove(h, { type: 'fold' });
    applyMove(h, { type: 'fold' });
    expect(h.players[0].stack).toBe(100000 + 1000 + 2000 + 1000);
    expect(chipsInPlay(h)).toBe(total);
  });
});
