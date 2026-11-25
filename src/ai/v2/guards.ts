// 말도 안 되는 플레이 방지 (overview 3.12)
import { AI } from '../../config';
import type { Ctx } from './context';
import type { Option } from './types';

export interface GuardInfo {
  eq?: number; // 추정 레인지 상대 에퀴티
  riverNuts?: boolean; // 리버에서 질 수 없는 패
  evCut: number; // 팟 대비
}

/** 하드 가드: 절대 금지 행동인지 */
export function forbidden(o: Option, ctx: Ctx, g: GuardInfo): string | null {
  const L = ctx.view.legal;
  if (o.act === 'fold') {
    if (L.canCheck) return '체크 가능 상황 폴드 금지';
    if (ctx.street === 'preflop' && ctx.key === 'AA') return '프리플랍 AA 폴드 금지';
    if (g.riverNuts) return '넛 폴드 금지';
    if (ctx.toCall > 0 && ctx.potOdds < AI.guards.tinyCallNeedEq) return '아주 작은 콜 금액 폴드 금지';
  }
  if (o.act === 'call' && ctx.street === 'river' && g.eq !== undefined && g.eq <= 0.0001) {
    return '리버에서 이길 수 있는 핸드가 없는 콜 금지';
  }
  if (o.act === 'raise' && !L.canRaise) return '레이즈 불가';
  if (o.act === 'check' && !L.canCheck) return '체크 불가';
  if (o.act === 'call' && L.canCheck) return '콜할 금액 없음';
  return null;
}

export function applyGuards(options: Option[], probs: number[], ctx: Ctx, g: GuardInfo): { probs: number[]; applied: string[] } {
  const applied: string[] = [];
  let p = [...probs];
  const hard = options.map((o) => forbidden(o, ctx, g));
  hard.forEach((r, i) => { if (r) { if (p[i] > 0) applied.push(r); p[i] = 0; } });
  p = norm(p);
  // 기대값이 최선보다 팟의 일정 비율 이상 나쁜 행동 제거
  const evs = options.map((o, i) => (hard[i] ? -Infinity : o.ev));
  if (evs.every((e) => e !== undefined)) {
    const best = Math.max(...(evs as number[]));
    const cut = best - g.evCut * Math.max(ctx.pot, 1);
    // v2: 체크는 절대 '말도 안 되는' 행동이 아니므로 기대값 컷에서 빼지 않음 (강한 패 동크 강제 방지)
    const q = p.map((x, i) => ((evs[i] as number) < cut && options[i].act !== 'check' ? 0 : x));
    if (q.some((x) => x > 0)) {
      if (q.some((x, i) => x !== p[i])) applied.push('기대값 손실 큰 행동 제거');
      p = norm(q);
    }
  }
  // 꼬리 자르기
  // v2: 아주 드문 행동(꼬리)은 사람 눈에 '이상한 플레이'로 보여 더 넓게 자름 (AI.tailCutV2)
  const t = p.map((x) => (x < AI.tailCutV2 ? 0 : x));
  if (t.some((x) => x > 0)) {
    if (t.some((x, i) => x !== p[i] && p[i] > 0)) applied.push('작은 확률 잘라냄');
    p = norm(t);
  }
  if (!p.some((x) => x > 0)) {
    // 모두 사라지면 허용된 것 중 원래 확률이 가장 큰 것
    let bi = -1;
    options.forEach((_, i) => { if (!hard[i] && (bi < 0 || probs[i] > probs[bi])) bi = i; });
    if (bi < 0) bi = options.findIndex((o) => o.act === (ctx.view.legal.canCheck ? 'check' : 'call'));
    p = options.map((_, i) => (i === bi ? 1 : 0));
  }
  return { probs: p, applied };
}

function norm(p: number[]) {
  const s = p.reduce((a, b) => a + b, 0);
  return s > 0 ? p.map((x) => x / s) : p;
}
