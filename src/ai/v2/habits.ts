// 습관(조건 → 행동, 지키는 비율)과 레벨별 나쁜 습관(릭) (overview 3.7 ①②)
import type { Ctx } from './context';
import { isPremium, isWheelAceSuited } from './handrank';
import { openPctFor } from './range';
import type { AiMemory, Option } from './types';

export interface HabitInput { ctx: Ctx; eq: number; options: Option[]; probs: number[]; mem: AiMemory }
type Habit = (h: HabitInput) => number[] | null;

const idx = (opts: Option[], act: string) => opts.findIndex((o) => o.act === act);
const betIdx = (opts: Option[]) => opts.map((o, i) => (o.act === 'raise' ? i : -1)).filter((i) => i >= 0);
function only(opts: Option[], i: number): number[] | null {
  if (i < 0) return null;
  return opts.map((_, k) => (k === i ? 1 : 0));
}
/** 특정 행동 쪽으로 몰기 */
function toAct(h: HabitInput, act: 'fold' | 'check' | 'call' | 'raise', which: 'small' | 'big' | 'mid' = 'mid'): number[] | null {
  if (act === 'raise') {
    const bi = betIdx(h.options);
    if (bi.length === 0) return null;
    const sorted = [...bi].sort((a, b) => (h.options[a].to ?? 0) - (h.options[b].to ?? 0));
    const pick = which === 'small' ? sorted[0] : which === 'big' ? sorted[sorted.length - 1] : sorted[Math.floor((sorted.length - 1) / 2)];
    return only(h.options, pick);
  }
  if (act === 'fold' && idx(h.options, 'check') >= 0) return only(h.options, idx(h.options, 'check'));
  if (act === 'call' && idx(h.options, 'call') < 0) return only(h.options, idx(h.options, 'check'));
  return only(h.options, idx(h.options, act));
}
/** 레이즈 확률을 콜/체크로 옮기기 */
function moveRaise(h: HabitInput, to: 'call' | 'check' | 'fold'): number[] | null {
  const bi = betIdx(h.options);
  const ti = idx(h.options, to) >= 0 ? idx(h.options, to) : idx(h.options, 'check') >= 0 ? idx(h.options, 'check') : idx(h.options, 'call');
  if (bi.length === 0 || ti < 0) return null;
  const out = [...h.probs];
  for (const i of bi) { out[ti] += out[i]; out[i] = 0; }
  return out;
}
const draw = (c: Ctx) => c.street !== 'river' && (c.flushDraw || c.oesd);

export const HABITS: Record<string, Habit> = {
  // 레귤러
  dryCbetThird: (h) => (h.ctx.street === 'flop' && h.ctx.isPFA && h.ctx.numOpp === 1 && !h.ctx.facingBet && h.ctx.wet < 0.3 ? toAct(h, 'raise', 'small') : null),
  riverBigBetFold: (h) => (h.ctx.street === 'river' && h.ctx.facingBet && h.ctx.lastBetFrac >= 0.75 && h.eq < 0.4 ? toAct(h, 'fold') : null), // v2: 정말 약할 때만
  threeBetStrongOrA5s: (h) => (h.ctx.street === 'preflop' && h.ctx.raisesPre === 1 && h.ctx.pct > 5 && !isWheelAceSuited(h.ctx.key) ? moveRaise(h, 'call') : null),
  // 공격수
  wideLatePosition: (h) => (h.ctx.street === 'preflop' && h.ctx.raisesPre === 0 && !h.ctx.view.legal.canCheck && h.ctx.behind <= 3 && h.ctx.pct < openPctFor(h.ctx.behind) * 1.5 ? toAct(h, 'raise', 'small') : null),
  stabWhenChecked: (h) => (h.ctx.street !== 'preflop' && h.ctx.checkedToMe && h.ctx.numOpp === 1 && !h.ctx.facingBet ? toAct(h, 'raise', 'small') : null),
  drawSemiBluff: (h) => (draw(h.ctx) ? toAct(h, 'raise', 'mid') : null),
  // 콜링스테이션
  pairCallsDown: (h) => (h.ctx.street !== 'preflop' && h.ctx.facingBet && h.ctx.madeCat >= 1 ? toAct(h, 'call') : null),
  raiseOnlyStrong: (h) => (h.eq < 0.85 ? moveRaise(h, h.ctx.facingBet ? 'call' : 'check') : null),
  noBluff: (h) => (h.ctx.street !== 'preflop' && h.eq < 0.3 && !draw(h.ctx) ? moveRaise(h, h.ctx.facingBet ? 'fold' : 'check') : null),
  // 니트
  foldTo3betUnlessPremium: (h) => (h.ctx.street === 'preflop' && h.ctx.raisesPre >= 2 && !isPremium(h.ctx.key) ? toAct(h, 'fold') : null),
  bigPotNeedsSet: (h) => {
    const me = h.ctx.view.seats.find((s) => s.seat === h.ctx.view.mySeat)!;
    return h.ctx.street !== 'preflop' && h.ctx.facingBet && h.ctx.pot + h.ctx.toCall > 0.5 * me.startStack && h.ctx.madeCat < 3 ? toAct(h, 'fold') : null;
  },
  // 매니악
  overbet: (h) => (!h.ctx.facingBet && h.ctx.street !== 'preflop' && h.probs.some((p, i) => p > 0.2 && h.options[i].act === 'raise') ? toAct(h, 'raise', 'big') : null),
  bluffAgainAfterCaught: (h) => (h.mem.caughtBluff > 0 && h.ctx.street !== 'preflop' && !h.ctx.facingBet && h.eq < 0.35 ? toAct(h, 'raise', 'mid') : null),
  stackPressure: (h) => {
    if (h.ctx.street === 'preflop' || h.ctx.facingBet) return null;
    const me = h.ctx.view.seats.find((s) => s.seat === h.ctx.view.mySeat)!;
    const opp = h.ctx.view.seats.filter((s) => h.ctx.oppSeats.includes(s.seat));
    return opp.length === 1 && me.stack > 2 * opp[0].stack ? toAct(h, 'raise', 'big') : null;
  },
  // 초보
  limpAnyAce: (h) => (h.ctx.street === 'preflop' && h.ctx.raisesPre === 0 && h.ctx.key[0] === 'A' && h.ctx.pct > 8 && !h.ctx.view.legal.canCheck ? toAct(h, 'call') : null),
  chaseDraws: (h) => (h.ctx.facingBet && (h.ctx.flushDraw || h.ctx.oesd || h.ctx.gutshot) && h.ctx.street !== 'river' ? toAct(h, 'call') : null),
  slowplayMonster: (h) => (h.ctx.street !== 'preflop' && h.ctx.street !== 'river' && h.eq > 0.9 ? (h.ctx.facingBet ? toAct(h, 'call') : toAct(h, 'check')) : null),
  sizeEqualsStrength: (h) => (!h.ctx.facingBet && h.ctx.street !== 'preflop' && h.probs.some((p, i) => p > 0.3 && h.options[i].act === 'raise') ? toAct(h, 'raise', h.eq > 0.7 ? 'big' : 'small') : null),
  // 릭
  overvalueTopPair: (h) => (h.ctx.facingBet && h.ctx.topPair ? toAct(h, 'call') : null),
  scaredOfOvercards: (h) => (h.ctx.facingBet && h.ctx.madeCat === 1 && h.ctx.overcardsOnBoard >= 1 && !h.ctx.topPair ? toAct(h, 'fold') : null),
  // 리버에서 원페어 이상이면 웬만하면 콜 (하수의 가장 큰 누수: 과다 콜)
  callDownLight: (h) => (h.ctx.street === 'river' && h.ctx.facingBet && h.ctx.madeCat >= 1 && h.ctx.potOdds < 0.4 ? toAct(h, 'call') : null),
  // 애매한 패로 오픈 림프 (레크리에이션 플레이어의 대표 신호)
  limpMarginal: (h) => {
    if (h.ctx.street !== 'preflop' || h.ctx.raisesPre !== 0 || h.ctx.view.legal.canCheck) return null;
    const o = openPctFor(h.ctx.behind);
    return h.ctx.pct > o * 0.8 && h.ctx.pct < o * 2.2 ? toAct(h, 'call') : null;
  },
  // 큰 벳이 무서워서 꽤 좋은 패도 접음
  fearBigBets: (h) => (h.ctx.street !== 'preflop' && h.ctx.facingBet && h.ctx.lastBetFrac >= 0.75 && h.eq < 0.72 && h.eq > 0.3 ? toAct(h, 'fold') : null),
  // 드로우를 수동적으로만 (세미블러프를 안 함)
  passiveDraws: (h) => (!h.ctx.facingBet && h.ctx.street !== 'preflop' && h.ctx.street !== 'river' && (h.ctx.flushDraw || h.ctx.oesd) && h.eq < 0.55 ? toAct(h, 'check') : null),
  // 프리플랍 레이저면 플랍은 무조건 C벳 (멀티웨이·웻 보드 상관없이)
  autoCbet: (h) => (h.ctx.street === 'flop' && h.ctx.isPFA && !h.ctx.facingBet ? toAct(h, 'raise', 'mid') : null),
  // 블러프 한 번 걸리면 한동안 블러프를 안 함
  giveUpAfterCaught: (h) => (h.mem.caughtBluff > 0 && h.ctx.street !== 'preflop' && !h.ctx.facingBet && h.eq < 0.35 ? toAct(h, 'check') : null),
  minRaise: () => null, // 금액 단계에서 처리 (human.ts)
  resultOriented: () => null, // 기분(틸트) 쪽에서 처리
};

export function applyHabits(input: HabitInput, list: { id: string; adherence: number }[]): { probs: number[]; used: string[] } {
  let probs = input.probs;
  const used: string[] = [];
  for (const h of list) {
    const f = HABITS[h.id];
    if (!f) continue;
    const o = f({ ...input, probs });
    if (!o) continue;
    const s = o.reduce((a, b) => a + b, 0);
    if (s <= 0) continue;
    probs = probs.map((p, i) => (1 - h.adherence) * p + h.adherence * (o[i] / s));
    used.push(h.id);
  }
  return { probs, used };
}
