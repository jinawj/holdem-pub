// 플레이어 통계 (복기·평가용. AI 판단에는 쓰지 않음 — overview 3.8)
import type { PublicAction } from '../engine/types';

export interface StatAcc { hands: number; vpip: number; pfr: number; bets: number; calls: number; threeBetOpp: number; threeBet: number; cbetOpp: number; cbet: number; wentSD: number; sawFlop: number }

export const newStat = (): StatAcc => ({ hands: 0, vpip: 0, pfr: 0, bets: 0, calls: 0, threeBetOpp: 0, threeBet: 0, cbetOpp: 0, cbet: 0, wentSD: 0, sawFlop: 0 });

export function accumulate(st: StatAcc, actions: PublicAction[], seat: number, showdownSeats: number[]) {
  st.hands++;
  const pre = actions.filter((a) => a.street === 'preflop');
  const mine = pre.filter((a) => a.seat === seat);
  if (mine.some((a) => a.type === 'call' || a.type === 'raise' || a.type === 'bet')) st.vpip++;
  if (mine.some((a) => a.type === 'raise' || a.type === 'bet')) st.pfr++;
  // 3벳 기회: 내가 처음 행동할 때 레이즈가 정확히 1번 있었음
  let raises = 0, seenMine = false;
  for (const a of pre) {
    if (a.type === 'ante' || a.type === 'sb' || a.type === 'bb') continue;
    if (a.seat === seat && !seenMine) {
      seenMine = true;
      if (raises === 1) { st.threeBetOpp++; if (a.type === 'raise') st.threeBet++; }
    }
    if (a.type === 'raise' || a.type === 'bet') raises++;
  }
  for (const a of actions) {
    if (a.seat !== seat || a.street === 'preflop') continue;
    if (a.type === 'bet' || a.type === 'raise') st.bets++;
    if (a.type === 'call') st.calls++;
  }
  // C벳: 프리플랍 마지막 레이저가 나이고 플랍에서 내 첫 액션 기회에 벳
  const lastRaiser = [...pre].reverse().find((a) => a.type === 'raise' || a.type === 'bet')?.seat;
  const flop = actions.filter((a) => a.street === 'flop');
  if (flop.length) {
    if (!mine.some((a) => a.type === 'fold')) st.sawFlop++;
    if (lastRaiser === seat) {
      const before = flop.findIndex((a) => a.seat === seat);
      if (before >= 0 && !flop.slice(0, before).some((a) => a.type === 'bet')) {
        st.cbetOpp++;
        if (flop[before].type === 'bet') st.cbet++;
      }
    }
  }
  if (showdownSeats.includes(seat)) st.wentSD++;
}

export function statSummary(s: StatAcc) {
  const pc = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);
  return {
    hands: s.hands,
    vpip: pc(s.vpip, s.hands),
    pfr: pc(s.pfr, s.hands),
    af: s.calls > 0 ? s.bets / s.calls : s.bets,
    threeBet: pc(s.threeBet, s.threeBetOpp),
    cbet: pc(s.cbet, s.cbetOpp),
    wtsd: pc(s.wentSD, s.sawFlop),
  };
}
