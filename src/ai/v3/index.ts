// AI v3 진입점: 보는 것(인식) → 판단(두뇌) → 고르기(선택)
//  인식: concepts.ts (레벨별로 보이는 개념이 다름)
//  두뇌: 초급~중급 = 감(gutBrain), 상급+ = 레인지 전략(rangeBrain), 고수 리버 = 미니 솔버
//  선택: 감 브레인은 계산(EV)과 섞고 나쁜 행동을 버림 / 레인지·솔버는 그 전략을 그대로(혼합 전략)
import { AI_V3 } from '../../config';
import { COMBOS } from '../../engine/cards';
import { evaluate as evalHand } from '../../engine/evaluator';
import type { PlayerView } from '../../engine/view';
import { buildContext, Ctx } from './context';
import { perceive } from './concepts';
import { rememberShowdown } from './line';
import { preflopPolicy } from './preflop';
import { skillOf, tierName } from './skill';
import { riverSolve } from './solver';
import { BrainOut, evaluate, gutBrain, rangeBrain } from './strategy';
import type { AiDecision, DecideOpts, Intent, Option, V3Memory, V3Profile } from './types';
import { strengthOnBoard } from '../core/equity';
import { comboIndex } from './range';

export * from './types';
export { skillOf, tierName } from './skill';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function makeProfileV3(level: number): V3Profile { return { version: 3, level }; }
export function newMemoryV3(): V3Memory { return { version: 3, plans: [], opp: {}, handsSeen: 0 }; }

function isRiverNuts(view: PlayerView): boolean {
  if (view.board.length < 5) return false;
  const dead = new Set([...view.holeCards, ...view.board]);
  const my = evalHand([...view.holeCards, ...view.board]);
  for (const [a, b] of COMBOS) { if (dead.has(a) || dead.has(b)) continue; if (evalHand([a, b, ...view.board]) > my) return false; }
  return true;
}

function norm(p: number[]) { const s = p.reduce((a, b) => a + b, 0); return s > 0 ? p.map((x) => x / s) : p.map(() => 1 / p.length); }

export function decide(view: PlayerView, prof: V3Profile, mem: V3Memory, opts: DecideOpts): AiDecision {
  const t0 = now();
  const ctx = buildContext(view);
  const skill = skillOf(prof.level);
  const rand = opts.rand;
  const quick = !!opts.quick;
  if (mem.plans.length && mem.plans[mem.plans.length - 1].handNo !== view.handNo) mem.plans = [];
  let options: Option[], probs: number[], intents: Intent[], why: string, brain: string;
  let thoughts: string[] = [];
  let caps: number[] | undefined;
  let brainTop = -1;
  let equity: number | undefined, eqRaw: number | undefined;
  const guards: string[] = [];
  if (view.street === 'preflop') {
    const pre = preflopPolicy(ctx, skill, rand, quick);
    ({ options, probs, intents, why } = pre);
    equity = pre.equity; eqRaw = pre.equity;
    brain = 'pre';
    thoughts.push(why);
  } else {
    const p = perceive(ctx, skill, mem, rand, quick);
    thoughts = p.thoughts;
    equity = p.eq; eqRaw = p.eqRaw;
    let out: BrainOut | null = null;
    if (skill.solver && ctx.street === 'river') out = riverSolve(ctx, skill, skill.lineFull ? p.bluffy / 0.25 : 1);
    if (!out && skill.rangeStrategy && p.myRange) out = rangeBrain(ctx, p, skill);
    if (!out) out = gutBrain(ctx, p, skill);
    ({ options, probs, intents, why } = out);
    caps = out.caps;
    brain = out.source;
    brainTop = probs.indexOf(Math.max(...probs));
    thoughts.push(`판단(${out.source === 'gut' ? '감' : out.source === 'range' ? '레인지' : '솔버'}): ${why}`);
    evaluate(options, ctx, p);
    if (out.source === 'gut') {
      // 감 + 계산: 계산 비중은 레벨 따라, 최선보다 한참 나쁜 행동은 버림
      const evs = options.map((o) => (o.ev ?? 0) / Math.max(1, ctx.pot));
      const mx = Math.max(...evs);
      const ex = norm(evs.map((e) => Math.exp((e - mx) / skill.evTemp)));
      const pr = norm(probs);
      probs = pr.map((x, i) => (1 - skill.evWeight) * x + skill.evWeight * ex[i]);
      const cut = probs.map((x, i) => (evs[i] < mx - skill.evCut && options[i].act !== 'check' ? 0 : x));
      if (cut.some((x) => x > 0) && cut.some((x, i) => x !== probs[i])) { probs = cut; guards.push('계산상 크게 손해인 행동 제외'); }
    }
  }
  probs = norm(probs);
  // 집중력 흐트러짐: 하수는 일부가 체크·콜 쪽으로
  if (skill.slip > 0) {
    const passive: number[] = options.map((o) => (o.act === 'check' || o.act === 'call' ? 1 : 0));
    const ps = passive.reduce((a, b) => a + b, 0);
    if (ps > 0) probs = probs.map((x, i) => (1 - skill.slip) * x + (skill.slip * passive[i]) / ps);
  }
  // 판단 규칙의 상한 (계산·흐트러짐이 되살리지 못하게): 넘친 몫은 폴드/체크로
  if (caps) {
    let extra = 0;
    probs = probs.map((x, i) => { const c = caps![i] ?? 1; if (x > c) { extra += x - c; return c; } return x; });
    const pi = options.findIndex((o) => o.act === 'fold' || o.act === 'check');
    if (pi >= 0) probs[pi] += extra;
  }
  if (brainTop >= 0) {
    const top = probs.indexOf(Math.max(...probs));
    if (top !== brainTop) thoughts.push(`계산(EV)이 판단을 바꿈: ${actName(options[brainTop].act)} → ${actName(options[top].act)} 위주`);
  }
  // 상급+: 승률이 가격보다 확실히 높으면(+10%p) 폴드는 거의 안 함 (레이즈를 받은 경우는 제외)
  if (skill.rangeStrategy && ctx.facingBet && eqRaw !== undefined && view.street !== 'preflop' && eqRaw >= ctx.potOdds + 0.1) {
    const iAggr = view.actionLog.some((a) => a.street === view.street && a.seat === view.mySeat && (a.type === 'bet' || a.type === 'raise'));
    const fi = options.findIndex((o) => o.act === 'fold'), ci = options.findIndex((o) => o.act === 'call');
    if (!iAggr && fi >= 0 && ci >= 0 && probs[fi] > 0.05) { probs[ci] += probs[fi] - 0.05; probs[fi] = 0.05; }
  }
  // 고수의 큰 결정: 스택이 크게 걸린 콜·폴드는 혼합을 날카롭게 (드문 쪽을 굴려 큰 팟을 잃지 않게)
  if (skill.solver && ctx.toCall > 0 && ctx.toCall >= 0.2 * view.legal.stack) probs = norm(probs.map((x) => x * x));
  // 안전장치
  const L = view.legal;
  const riverNuts = view.street === 'river' && !L.canCheck ? isRiverNuts(view) : false;
  probs = probs.map((x, i) => {
    const o = options[i];
    let bad: string | null = null;
    if (o.act === 'fold' && L.canCheck) bad = '체크 가능 상황 폴드 금지';
    else if (o.act === 'fold' && view.street === 'preflop' && ctx.key === 'AA') bad = 'AA 폴드 금지';
    else if (o.act === 'fold' && riverNuts) bad = '넛 폴드 금지';
    else if (o.act === 'fold' && ctx.toCall > 0 && ctx.potOdds < 0.05) bad = '아주 작은 콜 폴드 금지';
    else if (o.act === 'call' && view.street === 'river' && eqRaw !== undefined && eqRaw <= 0.0001) bad = '이길 수 없는 리버 콜 금지';
    else if (o.act === 'raise' && (!L.canRaise || !o.to)) bad = '레이즈 불가';
    else if (o.act === 'check' && !L.canCheck) bad = '체크 불가';
    else if (o.act === 'call' && L.canCheck) bad = '콜할 금액 없음';
    if (bad && x > 0) guards.push(bad);
    return bad ? 0 : x;
  });
  // 콜·체크가 빠졌으면 다시 넣기
  if (L.canCheck && !options.some((o) => o.act === 'check')) { options.push({ key: 'check', act: 'check' }); probs.push(0); intents.push('none'); }
  if (!L.canCheck && !options.some((o) => o.act === 'call')) { options.push({ key: 'call', act: 'call' }); probs.push(0); intents.push('none'); }
  if (!probs.some((x) => x > 0)) probs = options.map((o) => (o.act === (L.canCheck ? 'check' : 'call') ? 1 : 0));
  probs = norm(probs);
  // 감 브레인(하수~중수)은 드문 행동을 더 넓게 자름: 판단과 반대인 6~10%짜리 블러프·플로트가 기계적으로 보임
  const tail = brain === 'gut' || (brain === 'pre' && skill.level <= 6) ? AI_V3.tailCutGut : AI_V3.tailCut;
  const t = probs.map((x) => (x < tail ? 0 : x));
  if (t.some((x) => x > 0)) probs = norm(t);
  // 고르기
  let r = rand(), pick = probs.length - 1;
  for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) { pick = i; break; } }
  const chosen = options[pick];
  let to = chosen.to;
  if (chosen.act === 'raise' && to !== undefined) to = humanizeSize(to, ctx, skill.level, rand);
  const intent = sanitizeIntent(intents[pick] ?? 'none', chosen.act, eqRaw);
  if (view.street !== 'preflop') mem.plans.push({ handNo: view.handNo, street: view.street, intent, note: `${intentName(intent)}(${chosen.act === 'raise' ? (ctx.facingBet ? '레이즈' : '벳') : actName(chosen.act)})` });
  const calcMs = now() - t0;
  return {
    type: chosen.act, to, thinkMs: thinkTime(ctx, probs, chosen, skill.level, rand, opts.speedMult ?? 1),
    memo: {
      street: view.street, persona: `v3 ${tierName(skill.level)}`, level: skill.level,
      equity: eqRaw ?? equity, potOdds: ctx.toCall > 0 ? ctx.potOdds : undefined, handPct: ctx.pct,
      options: options.map((o, i) => ({ key: o.key, p: +probs[i].toFixed(3), ev: o.ev !== undefined ? Math.round(o.ev) : undefined })),
      chosen: chosen.act === 'raise' ? `raise:${to}` : chosen.key,
      guards, calcMs: +calcMs.toFixed(2),
      note: `${thoughts[thoughts.length - 1] ?? ''} → ${intentName(intent)}`,
      thoughts, intent, brain,
    },
  };
}

const actName = (a: string) => ({ fold: '폴드', check: '체크', call: '콜', raise: '레이즈' } as Record<string, string>)[a] ?? a;
export function intentName(i: Intent): string {
  return ({ value: '밸류', thin: '얇은 밸류', protect: '보호', bluff: '블러프', semibluff: '세미블러프', potControl: '팟 조절', bluffCatch: '블러프 캐치', trap: '함정(슬로플레이)', float: '띄워 보기', giveUp: '포기', fold: '폴드', none: '' } as Record<Intent, string>)[i];
}

function humanizeSize(to: number, ctx: Ctx, level: number, rand: () => number): number {
  const L = ctx.view.legal;
  if (to >= L.maxRaiseTo) return L.maxRaiseTo;
  let t = to;
  if (ctx.street !== 'preflop') t = L.committed + (t - L.committed) * (level <= 3 ? 0.75 + rand() * 0.5 : 0.92 + rand() * 0.16);
  const unit = t < 2000 ? 100 : t < 10000 ? 500 : t < 50000 ? 1000 : 5000;
  t = Math.round(t / unit) * unit;
  if (t < L.minRaiseTo) t = L.minRaiseTo;
  if (t > L.maxRaiseTo || L.maxRaiseTo - t < unit) t = L.maxRaiseTo;
  if (ctx.street !== 'preflop' && L.currentBet === 0 && t < L.maxRaiseTo) {
    const floor = Math.ceil((0.22 * ctx.pot) / unit) * unit;
    if (t < floor) t = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, floor));
  }
  return t;
}

/** 고민 시간(연출): 애매할수록·금액이 클수록 길게, 쉬운 폴드는 짧게 */
function thinkTime(ctx: Ctx, probs: number[], chosen: Option, level: number, rand: () => number, speedMult: number): number {
  const ent = -probs.reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0);
  const big = ctx.toCall > 0 ? Math.min(1, ctx.toCall / Math.max(1, ctx.view.legal.stack)) : 0;
  let ms = 600 + 1400 * ent + 1500 * big + (ctx.street === 'river' ? 500 : 0) + 500 * rand();
  if (chosen.act === 'fold' && ctx.street === 'preflop' && ctx.pct > 50) ms = 400 + 300 * rand();
  if (level >= 9) ms *= 0.9;
  return Math.round(ms * speedMult);
}

/** 핸드가 끝난 뒤: 쇼다운에서 공개된 패로 상대 기억 갱신 (공개 정보만) */
export function observeHandV3(mem: V3Memory, mySeat: number, actions: PlayerView['actionLog'], board: number[], shown: { seat: number; hole: [number, number] }[]) {
  mem.handsSeen++;
  mem.plans = [];
  if (board.length < 5 || shown.length < 2) return;
  const str = strengthOnBoard(board);
  rememberShowdown(mem, mySeat, actions, shown.map((s) => ({ seat: s.seat, strength: str[comboIndex(s.hole[0], s.hole[1])] })));
}

/** 표시용 의도를 실제 패 강도에 맞춤 (승률 높은 '블러프', 약한 '밸류', 몬스터 아닌 '함정' 방지) */
function sanitizeIntent(i: Intent, act: string, eq: number | undefined): Intent {
  if (eq === undefined) return i;
  if ((i === 'bluff' || i === 'semibluff') && eq >= 0.55) return eq >= 0.7 ? 'value' : 'thin';
  if ((i === 'value' || i === 'thin') && act === 'raise' && eq < 0.3) return 'bluff';
  if (i === 'trap' && eq < 0.8) return act === 'call' ? 'bluffCatch' : 'potControl';
  if (i === 'giveUp' && eq >= 0.5) return 'potControl';
  return i;
}
