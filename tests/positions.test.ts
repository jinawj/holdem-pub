import { describe, expect, it } from 'vitest';
import { computePositions, rankEliminations } from '../src/engine/positions';
import { applyMove } from '../src/engine/hand';
import { createTournament, finishHand, startNextHand } from '../src/engine/tournament';
import { riggedDeck } from './helpers';

// 문서의 좌석 1~7 → 인덱스 0~6 (좌석 n = 인덱스 n-1)
const S = (n: number) => n - 1;
const prev = { button: S(3), sbPos: S(4), bb: S(5) };
const all7 = () => Array(7).fill(true);

describe('dead button (overview 2.5 examples)', () => {
  it('no elimination → button 4, SB 5, BB 6', () => {
    const p = computePositions(all7(), prev, () => 0);
    expect(p).toMatchObject({ button: S(4), sb: S(5), bb: S(6) });
  });
  it('seat 5 (BB) busted → BB 6, dead SB, button 4', () => {
    const a = all7(); a[S(5)] = false;
    const p = computePositions(a, prev, () => 0);
    expect(p.bb).toBe(S(6)); expect(p.sb).toBeNull(); expect(p.sbPos).toBe(S(5)); expect(p.button).toBe(S(4));
  });
  it('seat 4 (SB) busted → BB 6, SB 5, dead button on 4', () => {
    const a = all7(); a[S(4)] = false;
    const p = computePositions(a, prev, () => 0);
    expect(p).toMatchObject({ bb: S(6), sb: S(5), button: S(4) });
    expect(a[p.button]).toBe(false);
  });
  it('seat 6 busted → BB 7, SB 5, button 4', () => {
    const a = all7(); a[S(6)] = false;
    const p = computePositions(a, prev, () => 0);
    expect(p).toMatchObject({ bb: S(7), sb: S(5), button: S(4) });
  });
  it('the hand after a dead SB puts the button on the empty seat', () => {
    const a = all7(); a[S(5)] = false;
    const p1 = computePositions(a, prev, () => 0); // BB 6, SB dead(5), btn 4
    const p2 = computePositions(a, { button: p1.button, sbPos: p1.sbPos, bb: p1.bb }, () => 0);
    expect(p2).toMatchObject({ bb: S(7), sb: S(6), button: S(5) });
    expect(a[p2.button]).toBe(false);
  });
  it('BB moves exactly one live seat each hand, never twice in a row', () => {
    let alive = Array(6).fill(true);
    let pv = computePositions(alive, null, () => 0);
    const bbs = [pv.bb];
    for (let i = 0; i < 12; i++) {
      if (i === 3) alive[(pv.bb + 2) % 6] = false;
      if (i === 6) alive[pv.sbPos] = false;
      pv = computePositions(alive, { button: pv.button, sbPos: pv.sbPos, bb: pv.bb }, () => 0);
      expect(pv.bb).not.toBe(bbs[bbs.length - 1]);
      bbs.push(pv.bb);
    }
  });
});

describe('heads-up transition', () => {
  it('player who was not BB becomes BB; button = SB', () => {
    // 3인: 0,1,2. 직전 btn 0, SB 1, BB 2. 0 탈락 → 1, 2 남음. 직전 BB=2 → 이번 BB=1, 버튼 2
    const a = [false, true, true];
    const p = computePositions(a, { button: 0, sbPos: 1, bb: 2 }, () => 0);
    expect(p.bb).toBe(1); expect(p.button).toBe(2); expect(p.sb).toBe(2);
  });
  it('previous BB busted → next alive after it is BB', () => {
    const a = [true, true, false];
    const p = computePositions(a, { button: 0, sbPos: 1, bb: 2 }, () => 0);
    expect(p.bb).toBe(0); expect(p.button).toBe(1);
  });
  it('heads-up alternates normally', () => {
    const a = [true, false, true];
    let p = computePositions(a, { button: 0, sbPos: 0, bb: 2 }, () => 0);
    expect(p).toMatchObject({ bb: 0, button: 2, sb: 2 });
    p = computePositions(a, { button: p.button, sbPos: p.sbPos, bb: p.bb }, () => 0);
    expect(p).toMatchObject({ bb: 2, button: 0, sb: 0 });
  });
});

describe('multiple eliminations in one hand', () => {
  it('bigger starting stack gets the better place, ties share', () => {
    expect(rankEliminations([{ seat: 1, startStack: 500 }, { seat: 2, startStack: 900 }], 3)).toEqual({ 2: 4, 1: 5 });
    expect(rankEliminations([{ seat: 1, startStack: 500 }, { seat: 2, startStack: 500 }, { seat: 3, startStack: 100 }], 2)).toEqual({ 1: 3, 2: 3, 3: 5 });
  });
  it('tournament ranks a double knockout by starting stack (incl. human)', () => {
    const t = createTournament(['A', 'B', 'C', 'D'], 0, 10000);
    t.seats[1].stack = 2000; t.seats[2].stack = 3000; t.seats[3].stack = 25000;
    // 버튼 0, SB 1, BB 2, UTG 3. D(3)가 AA로 쿼드
    const deck = riggedDeck(4, 0, [0, 1, 2, 3], { 3: 'AsAh', 1: '2c7d', 2: '3c8d', 0: '4h9s' }, 'AdAcKsQh2h');
    startNextHand(t, '0'.repeat(32), () => 0, deck);
    applyMove(t.hand!, { type: 'raise', to: 25000 }); // D 올인
    applyMove(t.hand!, { type: 'fold' }); // 나 폴드
    applyMove(t.hand!, { type: 'call' }); // B 올인 콜
    applyMove(t.hand!, { type: 'call' }); // C 올인 콜
    expect(t.hand!.street).toBe('done');
    const busted = finishHand(t);
    expect(busted.length).toBe(2);
    expect(t.seats[2].place).toBe(3); // C: 시작 3000
    expect(t.seats[1].place).toBe(4); // B: 시작 2000
    expect(t.seats.reduce((a, s) => a + s.stack, 0)).toBe(40000);
  });
});
