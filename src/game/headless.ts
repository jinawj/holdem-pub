// 화면 없이 AI끼리 핸드/토너먼트 진행 (셀프플레이, CLI, 대결, 시험지 공용)
import { decide, newMemory, updateMemory } from '../ai/v1';
import type { AiDecision, AiMemory, AiProfile } from '../ai/v1';
import { buildContext } from '../ai/v1/context';
import { forbidden } from '../ai/v1/guards';
import { COMBOS } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { applyMove, IllegalActionError, legalActions } from '../engine/hand';
import { aliveSeats, finishHand, startNextHand, TournamentState, totalTableChips } from '../engine/tournament';
import type { HandState, Move } from '../engine/types';
import { makePlayerView } from '../engine/view';
import { accumulate, newStat, StatAcc } from './stats';
import { summaryFor } from './summary';

export interface RunStats {
  hands: number;
  decisions: number;
  calcMs: number[];
  calcMsByStreet: Record<string, number[]>;
  illegal: number;
  forbidden: Record<string, number>;
  chipErrors: number;
  stats: Record<string, StatAcc>; // 키: 성향 id
  worst: { evLoss: number; desc: string }[];
}

export const newRunStats = (): RunStats => ({ hands: 0, decisions: 0, calcMs: [], calcMsByStreet: {}, illegal: 0, forbidden: {}, chipErrors: 0, stats: {}, worst: [] });

export function toMove(d: { type: string; to?: number }): Move {
  if (d.type === 'raise') return { type: 'raise', to: d.to! };
  return { type: d.type as 'fold' | 'check' | 'call' };
}

function riverNuts(h: HandState, seat: number) {
  const p = h.players.find((x) => x.seat === seat)!;
  if (h.board.length < 5) return false;
  const dead = new Set([...p.hole, ...h.board]);
  const my = evaluate([...p.hole, ...h.board]);
  for (const [a, b] of COMBOS) { if (dead.has(a) || dead.has(b)) continue; if (evaluate([a, b, ...h.board]) > my) return false; }
  return true;
}

export interface Actor { (h: HandState, seat: number): AiDecision }

/** 핸드 하나를 끝까지 진행 */
export function runHand(h: HandState, actor: Actor, rs: RunStats | null, playersLeft: number, keyOf?: (seat: number) => string): HandState {
  // 블라인드만으로 핸드가 끝난 경우(전원 올인 등)도 있으므로 시작 스택 기준으로 잰다
  const startTotal = h.players.reduce((a, p) => a + p.startStack, 0);
  let guard = 0;
  while (h.street !== 'done' && guard++ < 500) {
    const L = legalActions(h)!;
    const seat = L.seat;
    const d = actor(h, seat);
    if (rs) {
      rs.decisions++;
      rs.calcMs.push(d.memo.calcMs);
      (rs.calcMsByStreet[d.memo.street] ??= []).push(d.memo.calcMs);
      // 금지 행동 사후 점검 (안전장치와 독립적으로 확인)
      const view = makePlayerView(h, seat, playersLeft);
      const ctx = buildContext(view);
      const opt = { key: d.type, act: d.type, to: d.to } as const;
      const why = forbidden(opt as any, ctx, { eq: d.memo.street === 'river' ? d.memo.equity : undefined, riverNuts: h.street === 'river' && d.type === 'fold' ? riverNuts(h, seat) : false, evCut: 1 });
      if (why) rs.forbidden[why] = (rs.forbidden[why] ?? 0) + 1;
      const evs = d.memo.options.filter((o) => o.ev !== undefined);
      if (evs.length > 1) {
        const best = Math.max(...evs.map((o) => o.ev!));
        const ch = d.memo.options.find((o) => o.key === d.memo.chosen || (d.type === 'raise' && o.key.startsWith('raise')));
        if (ch?.ev !== undefined) {
          const loss = (best - ch.ev) / Math.max(1, h.players.reduce((a, p) => a + p.total, 0) + h.antePot);
          if (loss > 0.3) {
            rs.worst.push({ evLoss: loss, desc: `#${h.handNo} ${d.memo.persona}Lv${d.memo.level} ${d.memo.street} ${d.memo.chosen} (EV손실 팟의 ${(loss * 100).toFixed(0)}%) ${d.memo.note ?? ''}` });
            if (rs.worst.length > 200) { rs.worst.sort((a, b) => b.evLoss - a.evLoss); rs.worst.length = 100; }
          }
        }
      }
    }
    try {
      applyMove(h, toMove(d));
    } catch (e) {
      if (!(e instanceof IllegalActionError)) throw e;
      if (rs) rs.illegal++;
      applyMove(h, L.canCheck ? { type: 'check' } : { type: 'fold' });
    }
  }
  const endTotal = h.players.reduce((a, p) => a + p.stack, 0);
  if (rs) {
    rs.hands++;
    if (endTotal !== startTotal) {
      rs.chipErrors++;
      (rs as any).chipErrorSamples ??= [];
      (rs as any).chipErrorSamples.push({ startTotal, endTotal, level: h.level, button: h.buttonSeat, sb: h.sbSeat, bb: h.bbSeat, players: h.players.map((p) => ({ seat: p.seat, start: p.startStack, end: p.stack, total: p.total, ante: p.ante, folded: p.folded })), antePot: h.antePot, actions: h.actions, result: h.result });
    }
    if (keyOf) {
      const sd = h.result && !h.result.uncontested ? h.players.filter((p) => !p.folded).map((p) => p.seat) : [];
      for (const p of h.players) accumulate((rs.stats[keyOf(p.seat)] ??= newStat()), h.actions, p.seat, sd);
    }
  }
  return h;
}

export interface TourneyOpts { quick: boolean; rand: () => number; handsPerLevel: number; recallEnabled?: boolean; maxHands?: number; seedFn: () => string; randInt: (n: number) => number }

/** AI끼리 토너먼트 하나 */
export function runTournament(t: TournamentState, profiles: AiProfile[], rs: RunStats, o: TourneyOpts): { hands: number } {
  const mems: AiMemory[] = profiles.map(() => newMemory());
  const total0 = totalTableChips(t);
  let hands = 0;
  while (!t.finished && (o.maxHands === undefined || hands < o.maxHands)) {
    if (hands > 0 && hands % o.handsPerLevel === 0) t.pendingLevelUp++;
    const h = startNextHand(t, o.seedFn(), o.randInt);
    const left = aliveSeats(t).length;
    runHand(h, (hs, seat) => decide(makePlayerView(hs, seat, left), profiles[seat], mems[seat], { rand: o.rand, quick: o.quick, speedMult: 1, recallEnabled: o.recallEnabled }), rs, left, (s) => profiles[s].personaId);
    for (const p of h.players) mems[p.seat] = updateMemory(mems[p.seat], profiles[p.seat], summaryFor(h, p.seat), o.recallEnabled !== false);
    finishHand(t);
    if (totalTableChips(t) !== total0) rs.chipErrors++;
    hands++;
  }
  return { hands };
}
