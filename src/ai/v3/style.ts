// 플레이 스타일 (docs/v3-styles.md): 실력(레벨)과 따로, '같은 판단에서 어느 쪽으로 기우느냐'만 민다.
//  - 개념을 끄지 않는다: 두뇌가 낸 확률을 축(숫자)만큼 옮길 뿐. 판단 규칙의 상한(caps)·명확한 자리·안전장치는 그 뒤에 그대로 걸린다
//  - 레벨이 높을수록 같은 스타일도 덜 극단적 (AI_V3.styleScale)
//  - 축 값과 스타일 목록은 config AI_V3.styles 한 곳
import { AI_V3 } from '../../config';
import type { Ctx } from './context';
import type { Intent, Option } from './types';

export type StyleId = keyof typeof AI_V3.styles;
/**
 * 축 (−1..1, 0 = 표준)
 *  tight 참여 범위 · aggro 공격성 · bluff 블러프 빈도 · sticky 끝까지 따라감 · trap 강한 패 숨기기 · limp 림프 버릇
 *  고수 성격 축 (무엇을 더 중시하나 — 2026-11-27 상황별 리뷰):
 *  xr     레인지 균형: 체크한 뒤 벳을 받으면 강한 패·드로우를 체크레이즈로 (체크 레인지가 약해 보이지 않게)
 *  barrel 폴드 에퀴티: 주도권이 있는 턴·리버에 블러프 배럴을 이어감, 오픈에 3벳(블러프) 더
 *  potCtl 쇼다운 가치: 중간 패(승률 40~70%)는 벳 대신 체크로 팟을 작게, 큰 팟(레이즈·스택 걸림)에서 원페어급은 덜 버팀
 */
export interface Axes { tight: number; aggro: number; bluff: number; sticky: number; trap: number; limp: number; xr: number; barrel: number; potCtl: number }

const ZERO: Axes = { tight: 0, aggro: 0, bluff: 0, sticky: 0, trap: 0, limp: 0, xr: 0, barrel: 0, potCtl: 0 };

export function styleAxes(style: string | undefined, level: number): Axes {
  const s = style && (AI_V3.styles as Record<string, { axes: Partial<Axes> }>)[style];
  if (!s) return ZERO;
  const k = level >= 7 ? AI_V3.styleScale.high : level >= 4 ? AI_V3.styleScale.mid : AI_V3.styleScale.low;
  const a = { ...ZERO, ...s.axes };
  return { tight: a.tight * k, aggro: a.aggro * k, bluff: a.bluff * k, sticky: a.sticky * k, trap: a.trap * k, limp: a.limp * k, xr: a.xr * k, barrel: a.barrel * k, potCtl: a.potCtl * k };
}

export function styleName(style: string | undefined): string {
  const s = style && (AI_V3.styles as Record<string, { name: string }>)[style];
  return s ? s.name : '';
}

/** 레벨 구간에 맞는 스타일 목록 */
export function stylesFor(level: number): StyleId[] {
  const tier = level >= 7 ? 'high' : level >= 4 ? 'mid' : 'low';
  return (Object.keys(AI_V3.styles) as StyleId[]).filter((id) => (AI_V3.styles[id].tiers as readonly string[]).includes(tier));
}

/** 직전 스트리트의 마지막 공격자가 나인가 (턴·리버 배럴 판단용) */
function iHadInitiative(ctx: Ctx): boolean {
  const v = ctx.view;
  if (!v) return false;
  const order = ['preflop', 'flop', 'turn', 'river'];
  for (let k = order.indexOf(ctx.street) - 1; k >= 0; k--) {
    const ag = v.actionLog.filter((a) => a.street === order[k] && (a.type === 'bet' || a.type === 'raise'));
    if (ag.length) return ag[ag.length - 1].seat === v.mySeat;
  }
  return false;
}

/** 확률 일부를 from 쪽에서 to 쪽으로 옮김 (to 안에서는 기존 비율대로, 없으면 고르게) */
function move(probs: number[], from: number[], to: number[], frac: number) {
  if (frac <= 0 || !from.length || !to.length) return;
  let moved = 0;
  for (const i of from) { const m = probs[i] * frac; probs[i] -= m; moved += m; }
  const s = to.reduce((a, i) => a + probs[i], 0);
  for (const i of to) probs[i] += s > 0 ? (moved * probs[i]) / s : moved / to.length;
}

/**
 * 스타일 적용. 돌려주는 문장은 생각 줄에 붙인다 (적용이 없으면 null)
 *  eq: 실제 승률(있으면) — 스타일로도 '이길 수 없는 콜'은 만들지 않기 위해
 */
export function applyStyle(options: Option[], probs: number[], intents: Intent[], ctx: Ctx, ax: Axes, eq: number | undefined): string | null {
  if (options.length < 2 || Object.values(ax).every((x) => x === 0)) return null;
  const before = probs.slice();
  const idx = (f: (o: Option, i: number) => boolean) => options.map((o, i) => (f(o, i) ? i : -1)).filter((i) => i >= 0);
  const fold = idx((o) => o.act === 'fold'), call = idx((o) => o.act === 'call'), check = idx((o) => o.act === 'check'), raise = idx((o) => o.act === 'raise');
  const isBluff = (i: number) => intents[i] === 'bluff' || intents[i] === 'semibluff';
  const E = AI_V3.styleEffect;
  if (ctx.street === 'preflop') {
    const premium = ctx.pct < 4;
    // 참여 범위: 타이트하면 들어갈 몫 일부를 폴드로, 루즈하면 폴드 몫 일부를 들어가는 쪽으로 (쓰레기 패는 제외)
    if (ax.tight > 0 && !premium) move(probs, [...call, ...raise], fold, ax.tight * E.tight);
    if (ax.tight < 0 && ctx.pct < E.looseMaxPct) move(probs, fold, call.length && ax.aggro <= 0 ? call : raise.length ? raise : call, -ax.tight * E.tight);
    // 림프 버릇: 아무도 안 들어온 팟에서 폴드 몫을 콜(림프)로
    if (ax.limp > 0 && ctx.raisesPre === 0 && ctx.pct < 70) move(probs, fold, call, ax.limp * E.limp);
    // 공격성: 콜 ↔ 레이즈
    if (ax.aggro > 0) move(probs, call, raise, ax.aggro * E.aggroPre);
    if (ax.aggro < 0 && !premium) move(probs, raise, call, -ax.aggro * E.aggroPre);
    // 블러프 3벳 빈도
    const b3 = raise.filter(isBluff);
    if (ax.bluff > 0 && ctx.raisesPre >= 1 && b3.length) move(probs, fold, b3, ax.bluff * E.bluff * Math.min(1, b3.reduce((a, i) => a + probs[i], 0) * 4));
    if (ax.bluff < 0 && b3.length) move(probs, b3, fold, -ax.bluff * E.bluff);
    // 폴드 에퀴티 중시: 오픈 하나만 있는 팟에서 블러프 3벳 후보를 더 자주 (폴드 몫에서)
    if (ax.barrel > 0 && ctx.raisesPre === 1 && b3.length) move(probs, fold, b3, ax.barrel * E.barrel3b * Math.min(1, b3.reduce((a, i) => a + probs[i], 0) * 4));
  } else if (ctx.facingBet) {
    const log = ctx.view?.actionLog ?? [];
    const me = ctx.view?.mySeat;
    const iChecked = log.some((a) => a.street === ctx.street && a.seat === me && a.type === 'check');
    const iBet = log.some((a) => a.street === ctx.street && a.seat === me && (a.type === 'bet' || a.type === 'raise'));
    // 레인지 균형: 체크 뒤 벳을 받으면 강한 패(승률 60%+)·세미블러프는 일부 체크레이즈로 (리버 제외)
    if (ax.xr > 0 && iChecked && ctx.street !== 'river' && eq !== undefined && (eq >= 0.6 || raise.some((i) => intents[i] === 'semibluff'))) move(probs, call, raise, ax.xr * E.xr);
    // 쇼다운 가치 중시: 큰 팟(내 벳에 레이즈를 받았거나 스택의 1/3 이상이 걸림)에서 승률이 가격+15%p 미만이면 콜 몫 일부를 폴드로
    const big = iBet || (ctx.view ? ctx.toCall >= ctx.view.legal.stack / 3 : false);
    if (ax.potCtl > 0 && big && !(eq !== undefined && eq >= ctx.potOdds + 0.15)) move(probs, call, fold, ax.potCtl * E.potCtlFold);
    // 끈질김: 폴드 몫 일부를 콜로 (승률이 아주 낮으면 안 함) / 반대면 콜 몫 일부를 폴드로 (가격보다 확실히 좋으면 안 함)
    const hopeless = eq !== undefined && eq < E.stickyMinEq;
    if (ax.sticky > 0 && !hopeless) move(probs, fold, call, ax.sticky * E.sticky);
    if (ax.sticky < 0 && !(eq !== undefined && eq >= ctx.potOdds + 0.15)) move(probs, call, fold, -ax.sticky * E.sticky);
    if (ax.aggro > 0) move(probs, call, raise.filter((i) => !isBluff(i) || ax.bluff > 0), ax.aggro * E.aggroPost * 0.5);
    if (ax.aggro < 0) move(probs, raise, call, -ax.aggro * E.aggroPost);
  } else {
    const valueBets = raise.filter((i) => !isBluff(i)), bluffs = raise.filter(isBluff);
    // 공격성: 체크 몫 일부를 벳으로 / 블러프: 블러프 벳 비율
    if (ax.aggro > 0) move(probs, check, raise, ax.aggro * E.aggroPost);
    if (ax.aggro < 0) move(probs, raise, check, -ax.aggro * E.aggroPost);
    if (ax.bluff > 0 && bluffs.length) move(probs, check, bluffs, ax.bluff * E.bluffPost * Math.min(1, bluffs.reduce((a, i) => a + probs[i], 0) * 4));
    if (ax.bluff < 0 && bluffs.length) move(probs, bluffs, check, -ax.bluff * E.bluff);
    // 함정: 플랍·턴의 아주 강한 패는 일부 체크 (리버는 안 함 — 리버 넛 체크 금지 유지)
    if (ax.trap > 0 && ctx.street !== 'river' && eq !== undefined && eq >= 0.8) move(probs, valueBets, check, ax.trap * E.trap);
    // 폴드 에퀴티 중시: 주도권(지난 스트리트 마지막 공격자)이 있는 턴·리버에서 블러프 배럴을 이어감
    if (ax.barrel > 0 && ctx.street !== 'flop' && bluffs.length && iHadInitiative(ctx)) move(probs, check, bluffs, ax.barrel * E.barrel * (0.3 + 0.7 * Math.min(1, bluffs.reduce((a, i) => a + probs[i], 0) * 4)));
    // 쇼다운 가치 중시: 중간 패(승률 40~70%)는 벳 몫 일부를 체크로 (팟을 작게, 쇼다운으로)
    if (ax.potCtl > 0 && eq !== undefined && eq >= 0.4 && eq < 0.7) move(probs, valueBets, check, ax.potCtl * E.potCtl);
    if (ax.potCtl > 0 && bluffs.length) move(probs, bluffs, check, ax.potCtl * E.potCtl * 0.6);
  }
  for (let i = 0; i < probs.length; i++) probs[i] = Math.max(0, probs[i]);
  const d = (sel: number[]) => sel.reduce((a, i) => a + probs[i] - before[i], 0);
  const parts: string[] = [];
  for (const [n, sel] of [['폴드', fold], ['체크', check], ['콜', call], ['벳·레이즈', raise]] as [string, number[]][]) {
    const x = d(sel);
    if (Math.abs(x) >= 0.02) parts.push(`${n} ${x > 0 ? '+' : ''}${Math.round(x * 100)}%p`);
  }
  return parts.length ? parts.join(', ') : null;
}
