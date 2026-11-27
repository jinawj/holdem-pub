// AI v1 진입점: decide(PlayerView만 받음) → 행동 + 고민 시간 + 판단 메모 (overview 3.3)
import { AI } from '../../config';
import { COMBOS } from '../../engine/cards';
import { evaluate } from '../../engine/evaluator';
import type { PlayerView } from '../../engine/view';
import { buildContext, Ctx } from './context';
import { judgeClear, judgeLean, leanTo, lockToClear } from './clarity';
import { applyGuards } from './guards';
import { applyHabits } from './habits';
import { applyTemperature, humanizeSize, sizeTell, thinkTime } from './human';
import { levelFx, PERSONAS } from './persona';
import { postflopPolicy } from './postflop';
import { preflopPolicy } from './preflop';
import type { AiDecision, AiMemory, AiProfile, DecideOpts, Option } from './types';

export * from './types';
export { createAiProfiles, makeProfile, newMemory, profileLabel, PERSONAS, PERSONA_IDS, assignLevels, isFish, levelFx } from './persona';
export { updateMemory, wantsToShow } from './human';
export type { HandSummaryForAi } from './human';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 리버에서 어떤 핸드에도 지지 않는지 (넛) */
function isRiverNuts(view: PlayerView): boolean {
  if (view.board.length < 5) return false;
  const dead = new Set([...view.holeCards, ...view.board]);
  const my = evaluate([...view.holeCards, ...view.board]);
  for (const [a, b] of COMBOS) {
    if (dead.has(a) || dead.has(b)) continue;
    if (evaluate([a, b, ...view.board]) > my) return false;
  }
  return true;
}

export function decide(view: PlayerView, prof: AiProfile, mem: AiMemory, opts: DecideOpts): AiDecision {
  const t0 = now();
  const ctx = buildContext(view);
  const fx = levelFx(prof.level);
  const rand = opts.rand;
  const quick = !!opts.quick;

  const pol = view.street === 'preflop'
    ? preflopPolicy(ctx, prof, mem, rand, quick)
    : postflopPolicy(ctx, prof, mem, rand, quick);

  // 정리: 불가능한 옵션 제거, 같은 키 합치기
  let options: Option[] = [];
  let probs: number[] = [];
  pol.options.forEach((o, i) => {
    let oo = o;
    if (o.act === 'call' && view.legal.canCheck) oo = { key: 'check', act: 'check', ev: o.ev };
    if (o.act === 'raise' && (!view.legal.canRaise || !o.to)) return;
    const k = options.findIndex((x) => x.key === oo.key);
    if (k >= 0) probs[k] += pol.probs[i];
    else { options.push(oo); probs.push(pol.probs[i]); }
  });
  if (!options.some((o) => o.act === 'fold') && !view.legal.canCheck) { options.push({ key: 'fold', act: 'fold', ev: 0 }); probs.push(0); }
  if (!options.some((o) => o.act === 'check') && view.legal.canCheck) { options.push({ key: 'check', act: 'check' }); probs.push(0); }
  if (!options.some((o) => o.act === 'call') && !view.legal.canCheck) { options.push({ key: 'call', act: 'call' }); probs.push(0); }
  const sum0 = probs.reduce((a, b) => a + b, 0) || 1;
  probs = probs.map((p) => p / sum0);

  const eq = pol.equity ?? (view.street === 'preflop' ? undefined : 0.5);
  // 1) 습관 (솔버 제외) + 릭
  const habitList = [...prof.habits, ...prof.leaks];
  const h = applyHabits({ ctx, eq: eq ?? estimatePreflopEq(ctx), options, probs, mem }, habitList);
  probs = h.probs;
  // 역할 지키기: 레이저 앞(동크 자리)에서는 계획한 벳 비율 이상으로 벳하지 않음 (계산·습관이 끌어올린 벳을 체크로)
  //  단, 피쉬 성향은 동크가 실제 하수의 특징이라 그대로 둠
  const post = pol as { read?: { facingAggressorFirst: boolean }; planBetP?: number };
  if (view.street !== 'preflop' && post.read?.facingAggressorFirst && post.planBetP !== undefined && !PERSONAS[prof.personaId].fish) {
    const ci = options.findIndex((o) => o.act === 'check');
    const betMass = probs.reduce((a, p, i) => a + (options[i].act === 'raise' ? p : 0), 0);
    const cap = Math.min(1, post.planBetP * 1.3);
    if (ci >= 0 && betMass > cap && betMass > 0) {
      const k = cap / betMass;
      probs = probs.map((p, i) => (options[i].act === 'raise' ? p * k : p));
      probs[ci] += betMass - cap;
    }
  }
  // 2) 실력 온도 (실수)
  probs = applyTemperature(probs, prof, options);
  // 2-1) 고수의 일관성: 레벨이 높을수록 확률을 날카롭게 (우세한 행동을 꾸준히, 계획과 반대인 드문 행동은 사라짐)
  //  하수는 그대로 흐트러져 있어 짧게 쳐 봐도 레벨 차이가 보인다. 명확한 자리·압박 자리 보정보다 먼저 (보정값이 지워지지 않게)
  const k = prof.level >= AI.sharpenV2.from ? 1 + AI.sharpenV2.perLevel * (prof.level - AI.sharpenV2.from + 1) : 1;
  if (k > 1) {
    const q = probs.map((x) => Math.pow(x, k));
    const s = q.reduce((a, b) => a + b, 0);
    if (s > 0) probs = q.map((x) => x / s);
  }
  // 2-2) 명확한 자리: 레벨·성향과 상관없이 정답 행동만 (실력 차이는 이름 붙은 구멍=릭으로만 남김)
  //  릭이 이 자리에서 발동했으면 그 구멍은 일부러 남긴다
  const acts = options.map((o) => o.act);
  const clear = judgeClear(ctx);
  const notes: string[] = [];
  const leakIds = prof.leaks.map((l) => l.id);
  const leakFired = h.used.some((u) => leakIds.includes(u));
  if (clear) {
    if (leakFired) notes.push(`명확:${clear.id}(릭 허용)`);
    else { probs = lockToClear(acts, probs, clear); notes.push(`명확:${clear.id}`); }
  }
  // 2-3) 압박 자리: 강하게 쳐야 할 때 최소 비율 보장 (명확한 자리여도 그 행동이 허용되면 함께 적용)
  const lean = judgeLean(ctx, PERSONAS[prof.personaId].fish, prof.level);
  if (lean && !leakFired && (!clear || clear.ok.includes(lean.act))) { probs = leanTo(acts, probs, lean); notes.push(`압박:${lean.id}`); }
  const clearNote = notes.length ? notes.join(' ') : undefined;
  // 3) 안전장치
  const riverNuts = view.street === 'river' && !view.legal.canCheck ? isRiverNuts(view) : false;
  const g = applyGuards(options, probs, ctx, { eq: view.street === 'river' ? eq : undefined, riverNuts, evCut: Math.max(fx.evCut, AI.evCutMinV2) });
  probs = g.probs;
  // 4) 샘플링
  let r = rand(), pick = probs.length - 1;
  for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) { pick = i; break; } }
  const eqNow = eq ?? estimatePreflopEq(ctx);
  // 금액 텔(낮은 레벨): 패 강도에 따라 크기가 일정하게 달라짐
  const chosen = sizeTell(options, options[pick], eqNow, prof, ctx);
  let to = chosen.to;
  if (chosen.act === 'raise' && to !== undefined) to = humanizeSize(to, ctx, prof, rand);
  const calcMs = now() - t0;
  const thinkMs = thinkTime(ctx, chosen, probs, prof, rand, opts.speedMult ?? 1, eqNow);
  return {
    type: chosen.act, to, thinkMs,
    memo: {
      street: view.street,
      persona: PERSONAS[prof.personaId].name,
      level: prof.level,
      equity: eq,
      potOdds: ctx.toCall > 0 ? ctx.potOdds : undefined,
      handPct: ctx.pct,
      options: options.map((o, i) => ({ key: o.key, p: +probs[i].toFixed(3), ev: o.ev !== undefined ? Math.round(o.ev) : undefined })),
      chosen: chosen.act === 'raise' ? `raise:${to}` : chosen.key,
      habit: h.used.length ? h.used.join(',') : undefined,
      guards: g.applied,
      clear: clearNote,
      calcMs: +calcMs.toFixed(2),
      note: pol.note,
    },
  };
}

function estimatePreflopEq(ctx: Ctx): number {
  return Math.max(0.3, 0.85 - ctx.pct / 100 * 0.55);
}
