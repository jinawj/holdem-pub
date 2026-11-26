// 판단 모듈(두뇌). 인식(Percept)을 받아 행동별 확률을 낸다.
//  gutBrain   : 초급~중급. "내 패 등급 + 보이는 개념"으로 판단하는 사람식 감
//  rangeBrain : 상급 이상. "내 레인지 전체가 여기서 어떻게 하나 → 내 패는 그 중 어디인가"
//               (벳 빈도·사이즈는 레인지/넛 우위·텍스처·포지션, 밸류:블러프 비율 b/(P+2b), 수비는 MDF와 라인 읽기)
//  evaluate   : 행동별 기대값(평균적인 상대 모델) — 감 브레인의 보조 계산, 안전장치
import { AI_V3 } from '../../config';
import { COMBOS } from '../../engine/cards';
import { eqVsTop, strengthOnBoard } from '../core/equity';
import type { Ctx } from './context';
import { classRank, Percept } from './concepts';
import { comboIndex, drawFlags, massAbove } from './range';
import type { Skill } from './skill';
import type { Intent, Option } from './types';

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export interface BrainOut {
  options: Option[]; probs: number[]; intents: Intent[]; why: string; source: 'gut' | 'range' | 'solver';
  /** 판단 규칙이 정한 행동별 최대 확률: 계산(EV) 혼합 뒤에도 지킨다 */
  caps?: number[];
}

export function legalTo(ctx: Ctx, to: number): number {
  const L = ctx.view.legal;
  let t = Math.round(to / 100) * 100;
  if (t < L.minRaiseTo) t = L.minRaiseTo;
  if (t > L.maxRaiseTo) t = L.maxRaiseTo;
  if (L.maxRaiseTo - t < Math.max(ctx.bb, 0.15 * L.maxRaiseTo)) t = L.maxRaiseTo;
  // 유효 스택 넘게 걸 필요 없음: 가장 큰 상대가 맞출 수 있는 만큼까지만 (7BB 상대에게 55BB 올인 표시 방지)
  const cap = usefulMax(ctx);
  if (t > cap) t = Math.max(L.minRaiseTo, cap);
  return t;
}

/** 살아 있는 상대 중 가장 큰 스택이 맞출 수 있는 최대 금액(이번 스트리트 총액 기준) */
export function usefulMax(ctx: Ctx): number {
  const v = ctx.view, L = v.legal;
  const mx = Math.max(0, ...v.seats.filter((s) => s.seat !== v.mySeat && s.status !== 'folded').map((s) => s.stack + s.committed));
  return Math.min(L.maxRaiseTo, Math.max(mx, L.minRaiseTo));
}

const betTo = (ctx: Ctx, frac: number) => legalTo(ctx, ctx.view.legal.committed + Math.max(ctx.bb, ctx.pot * frac));
function raiseTo(ctx: Ctx): number {
  const L = ctx.view.legal;
  const cur = L.currentBet;
  let to = legalTo(ctx, cur * 2.8 + (ctx.pot - cur - L.committed) * 0.3);
  if (ctx.spr < 2 || to > 0.45 * (L.stack + L.committed)) to = L.maxRaiseTo;
  return to;
}

/** 남은 스트리트에 걸쳐 같은 비율로 벳하면 리버에 올인이 되는 크기 */
export function geometricFrac(ctx: Ctx): number {
  const n = ctx.street === 'flop' ? 3 : ctx.street === 'turn' ? 2 : 1;
  return (Math.pow(1 + 2 * ctx.spr, 1 / n) - 1) / 2;
}

// ---------------- 기대값 (평균적인 상대 모델) ----------------
export function evaluate(options: Option[], ctx: Ctx, p: Percept): void {
  const pot = ctx.pot, n = Math.max(1, ctx.numOpp);
  const river = ctx.street === 'river';
  const real = river ? 1 : ctx.ip ? 0.95 : 0.85;
  const L = ctx.view.legal;
  const contFrac = (b: number, P: number) => clamp((P / (P + b)) * 0.95, 0.08, 0.95);
  const eqWhenCalled = (c: number) => (n === 1 ? eqVsTop(p.eqRes, c) : p.eq * 0.85);
  for (const o of options) {
    if (o.act === 'fold') o.ev = 0;
    else if (o.act === 'check') o.ev = p.eq * pot * real;
    else if (o.act === 'call') o.ev = p.eq * real * (pot + ctx.toCall) - ctx.toCall;
    else if (o.to !== undefined) {
      const add = o.to - L.committed;
      if (!ctx.facingBet) {
        const c = contFrac(add, pot);
        const f = Math.pow(1 - c, n);
        o.ev = f * pot + (1 - f) * (eqWhenCalled(c) * (pot + 2 * add) - add);
      } else {
        const extra = o.to - L.currentBet;
        const potAfter = pot + add;
        const c = clamp((potAfter / (potAfter + extra)) * 0.85, 0.08, 0.95);
        o.ev = (1 - c) * pot + c * (eqWhenCalled(c) * (pot + add + extra) - add);
      }
    }
  }
}

// ---------------- 감 브레인 (초급~중급) ----------------
export function gutBrain(ctx: Ctx, p: Percept, skill: Skill): BrainOut {
  const L = ctx.view.legal;
  const h = p.hand, c = h.cls, S = ctx.street, lvl = skill.level;
  const HU = ctx.numOpp === 1;
  const river = S === 'river';
  if (!ctx.facingBet) {
    let pb: number, why: string;
    if (p.facingAggressorFirst && skill.lineBasic) {
      pb = c === 'monster' ? (river ? 0.6 : 0.15) : c === 'strong' && p.wetBoard ? 0.1 : 0.03;
      why = '레이저 앞이라 체크 위주';
    } else if (p.initiative) {
      if (S === 'flop') {
        const ipF = skill.position ? (ctx.ip ? 1 : 0.85) : 1;
        const cb = (p.dryBoard ? 0.75 : p.wetBoard ? 0.5 : 0.62) * ipF * (HU ? 1 : 0.6);
        pb = ({ monster: 0.85, strong: 0.85, medium: HU ? cb : 0.35, weak: cb * 0.8, draw: 0.7, air: cb * (h.backdoor ? 0.95 : 0.75) } as const)[c];
        why = 'C벳 자리';
      } else if (S === 'turn') {
        const scare = skill.betSize ? p.scareCard : false;
        pb = ({ monster: 0.85, strong: 0.72, medium: 0.33, weak: scare ? 0.35 : 0.18, draw: 0.6, air: scare ? 0.42 : 0.2 } as const)[c];
        why = '턴 배럴 판단';
      } else {
        pb = ({ monster: 0.92, strong: 0.68, medium: 0.12 + 0.03 * lvl, weak: 0.06, draw: 0.28, air: 0.26 } as const)[c];
        why = '리버: 밸류는 벳, 쇼다운 가치 있으면 체크';
      }
    } else {
      const stab = HU && ctx.view.actionLog.some((a) => a.street === S && a.type === 'check');
      pb = ({ monster: river ? 0.88 : 0.7, strong: 0.66, medium: stab ? 0.3 : 0.12, weak: stab ? 0.25 : 0.05, draw: 0.45, air: stab ? 0.28 : 0.04 } as const)[c];
      why = stab ? '체크로 넘어옴: 찔러보기 가능' : '주도권 없음';
    }
    // 이전 계획 이어가기 (중급+)
    if (p.plan && p.initiative) {
      const it = p.plan.intent;
      if ((it === 'bluff' || it === 'semibluff') && (c === 'air' || c === 'weak')) { pb = p.scareCard ? Math.max(pb, 0.45) : Math.min(pb, 0.18); why += p.scareCard ? ' · 블러프 이어감(무서운 카드)' : ' · 블러프 포기'; }
      if (it === 'potControl' && c === 'medium') { pb = Math.min(pb, 0.2); why += ' · 팟 조절 유지'; }
    }
    // 초급: "맞으면 벳" — 페어 이상이면 먼저 벳하는 일이 잦음
    if (lvl <= 3 && classRank(c) >= 3) pb = Math.max(pb, 0.4);
    if (!HU && (c === 'air' || c === 'weak' || c === 'draw')) pb *= 0.5;
    pb = clamp(pb, 0, 0.97);
    const opts: Option[] = [{ key: 'check', act: 'check' }];
    const intents: Intent[] = [c === 'monster' ? 'trap' : classRank(c) >= 3 || p.eq >= 0.5 ? 'potControl' : 'giveUp'];
    const probs = [1 - pb];
    if (L.canRaise) {
      // 크기: 중급은 보드 따라, 초급은 대충 (강하면 크게 — 사람다운 버릇)
      let fr = skill.betSize ? (p.wetBoard ? 0.7 : 0.45) : classRank(c) >= 4 ? 0.75 : 0.5;
      if (river && c === 'monster') fr = 0.85;
      if (ctx.spr < 1.3) fr = 9;
      const to = betTo(ctx, fr);
      opts.push({ key: 'raise:' + to, act: 'raise', to });
      probs.push(pb);
      intents.push(c === 'monster' || c === 'strong' ? 'value' : c === 'medium' || p.eq >= 0.5 ? 'thin' : c === 'draw' ? 'semibluff' : 'bluff');
    }
    return { options: opts, probs, intents, why, source: 'gut' };
  }
  // 벳을 받음
  const small = skill.betSize && ctx.betFrac <= 0.4;
  const polar = skill.betSize && ctx.betFrac >= 0.75;
  let cont: number, raise = 0, why: string;
  switch (c) {
    case 'monster': cont = 1; raise = river || p.wetBoard ? 0.55 : 0.35; why = '강해서 레이즈 또는 슬로플레이'; break;
    case 'strong': cont = polar && river ? 0.8 : 0.95; raise = p.wetBoard ? 0.18 : 0.08; why = '좋은 패라 콜'; break;
    case 'medium': cont = small ? 0.9 : polar ? (river ? 0.42 : 0.58) : 0.72; raise = 0.03; why = '중간 패: 크기 보고 판단'; break;
    case 'weak': cont = small ? 0.5 : polar ? 0.1 : 0.28; why = '약한 패'; break;
    case 'draw': cont = !skill.potOdds ? 0.9 : ctx.potOdds <= 0.35 || ctx.effBB > 60 ? 0.88 : 0.5; raise = skill.level >= 5 ? 0.15 : 0.05; why = skill.potOdds ? '드로우: 가격 보고' : '드로우는 따라가 봄'; break;
    default: cont = small && !river ? (h.backdoor ? 0.35 : 0.12) : 0.03; raise = 0.03; why = '에어: 대부분 폴드';
  }
  // 초급의 '페어면 좋은 패' 과신
  if ((c === 'medium' || (c === 'weak' && ctx.madeCat >= 1)) && skill.pairPride > cont) { cont = skill.pairPride; why = '페어니까 따라감'; }
  // 레이즈를 받음(내가 이번 스트리트에 벳·레이즈함) → 상대가 강해 보임 (라인 읽기 기본)
  const iBet = ctx.view.actionLog.some((a) => a.street === S && a.seat === ctx.view.mySeat && (a.type === 'bet' || a.type === 'raise'));
  if (iBet && c !== 'monster' && skill.lineBasic) {
    raise = 0;
    if (c === 'strong') cont = Math.min(cont, 0.75);
    if (c === 'medium') cont = Math.min(cont, 0.3);
    if (c === 'weak' || c === 'air') cont = Math.min(cont, 0.08);
    why = '레이즈를 받음: 강해 보여 신중하게';
  }
  // 레이즈 전쟁(이번 스트리트 벳·레이즈 2번 이상): 중급부터는 원페어로 버티지 않음
  let warCap: number | undefined;
  const aggrCount = ctx.view.actionLog.filter((a) => a.street === S && (a.type === 'bet' || a.type === 'raise')).length;
  if (aggrCount >= 2 && c !== 'monster' && skill.lineBasic) {
    raise = 0;
    cont = Math.min(cont, c === 'strong' ? (skill.level >= 5 ? 0.35 : 0.55) : c === 'draw' ? 0.35 : 0.08);
    warCap = cont;
    why = '레이즈가 오가는 팟: 원페어로는 버티지 않음';
  }
  if (!HU && c === 'air') { cont = Math.min(cont, 0.03); raise = 0.01; }
  if (c === 'monster' && p.eqRaw < 0.5 && skill.level >= 4) { raise = 0; why = '강하지만 보드가 위험해 콜'; }
  // 보드가 페어·같은 무늬 3장인데 스트레이트·플러시(풀하우스 미만): 큰 레이즈 대신 콜 위주 (보드를 보는 중급부터)
  if (c === 'monster' && ctx.madeCat <= 5 && (ctx.paired || p.wetBoard) && skill.betSize) raise = Math.min(raise, 0.15);
  // 사람 하수는 블러프 레이즈를 거의 안 함 (실수는 과다 콜·수동 쪽): 에어·약한 패 레이즈는 없앰
  if (c === 'air' || c === 'weak' || (c === 'medium' && skill.level <= 3)) raise = 0;
  if (skill.potOdds) {
    if (c !== 'monster' && ctx.toCall >= 0.6 * L.stack && p.eq < ctx.potOdds + 0.05) { cont *= 0.5; why = '올인급 콜이라 확실할 때만'; }
    // 가격이 아주 좋으면 콜 — 단 승률이 가격 근처는 돼야
    if (ctx.potOdds < 0.2 && c !== 'air' && p.eq >= ctx.potOdds - 0.05) cont = Math.max(cont, 0.8);
    // 승률이 가격보다 확실히 높으면(오버카드+거트샷 등) 에어라도 따라감
    if (p.eq >= ctx.potOdds + 0.08 && aggrCount < 2) { cont = Math.max(cont, 0.75); if (c === 'air') why = '패는 없지만 승률이 가격보다 높음'; }
  }
  if (p.eq < 0.08 && c !== 'monster') cont *= 0.4;
  // 초급의 '이미 많이 넣었으니' 심리 (매몰 비용): 스택의 40% 이상 들어갔으면 더 따라감
  if (skill.level <= 3) {
    const me = ctx.view.seats.find((s) => s.seat === ctx.view.mySeat)!;
    if (me.startStack > 0 && (me.startStack - me.stack) / me.startStack >= 0.4) { cont = Math.min(1, cont + 0.15); why += ' · 이미 많이 넣어서 따라감'; }
  }
  raise = Math.min(raise, cont);
  const opts: Option[] = [{ key: 'fold', act: 'fold' }, { key: 'call', act: 'call' }];
  const probs = [1 - cont, cont - raise];
  const intents: Intent[] = ['fold', c === 'air' ? 'float' : c === 'monster' ? 'trap' : 'bluffCatch'];
  if (L.canRaise) {
    const to = raiseTo(ctx);
    opts.push({ key: 'raise:' + to, act: 'raise', to });
    probs.push(raise);
    intents.push(c === 'draw' ? 'semibluff' : classRank(c) >= 4 ? 'value' : c === 'medium' ? 'protect' : 'bluff');
  } else probs[1] = cont;
  const caps = warCap !== undefined ? opts.map((o) => (o.act === 'fold' ? 1 : o.act === 'raise' ? 0 : warCap!)) : undefined;
  return { options: opts, probs, intents, why, source: 'gut', caps };
}

// ---------------- 레인지 브레인 (상급 이상) ----------------
/** 레인지 전체의 벳 사이즈: 텍스처·레인지 우위·넛 우위·SPR */
export function chooseSize(ctx: Ctx, p: Percept, skill: Skill): { frac: number; why: string } {
  const ra = p.rangeAdv ?? 0, na = p.nutAdv ?? 0;
  const HU = ctx.numOpp === 1;
  let frac: number, why: string;
  if (ctx.street === 'flop') {
    if (p.dryBoard && ra > 0.01) { frac = 0.33; why = '드라이 보드 + 레인지 우위 → 작게 자주'; }
    else if (p.wetBoard || na > 0.04) { frac = 0.7; why = '웻 보드/넛 우위 → 크게'; }
    else { frac = 0.5; why = '보통 크기'; }
  } else if (ctx.street === 'turn') {
    if (skill.overbet && HU && na > 0.06) { frac = 1.25; why = '넛 우위 → 턴 오버벳'; }
    else if (p.dryBoard && na <= 0.02) { frac = 0.5; why = '턴 보통'; }
    else { frac = 0.7; why = '턴 크게(보호·양극화)'; }
  } else {
    if (skill.overbet && HU && na > 0.08) { frac = 1.4; why = '넛 우위 → 리버 오버벳'; }
    else if (na > 0.03) { frac = 1.0; why = '양극화 → 팟 벳'; }
    else if (ra < -0.02) { frac = 0.5; why = '레인지 불리 → 작게'; }
    else { frac = 0.7; why = '리버 보통'; }
  }
  const g = geometricFrac(ctx);
  if (g <= frac * 1.2) { frac = Math.max(0.25, g); why += ' · 남은 스택에 맞춘 크기(지오메트릭)'; }
  return { frac, why };
}

function bluffScores(board: number[], str: Float32Array, nutSuit: number): Float32Array {
  const dr = drawFlags(board);
  const out = new Float32Array(1326);
  const river = board.length === 5;
  for (let i = 0; i < 1326; i++) {
    const [a, b] = COMBOS[i];
    let s = (1 - str[i]) * (river ? 1 : 0.5);
    if (!river) s += dr[i] === 2 ? 0.8 : dr[i] === 1 ? 0.35 : 0;
    if (nutSuit >= 0 && ((a >> 2 === 12 && (a & 3) === nutSuit) || (b >> 2 === 12 && (b & 3) === nutSuit))) s += 0.3;
    out[i] = s;
  }
  return out;
}

export function rangeBrain(ctx: Ctx, p: Percept, skill: Skill): BrainOut {
  const v = ctx.view, L = v.legal;
  const R = p.myRange!, board = v.board;
  const str = strengthOnBoard(board);
  const me = comboIndex(v.holeCards[0], v.holeCards[1]);
  const myStr = str[me];
  const HU = ctx.numOpp === 1;
  const ra = p.rangeAdv ?? 0, na = p.nutAdv ?? 0;
  const suitCnt = [0, 0, 0, 0];
  board.forEach((c) => suitCnt[c & 3]++);
  const nutSuit = suitCnt.findIndex((n) => n >= 3);
  const draw = p.hand.strongDraw;

  if (!ctx.facingBet) {
    const S = ctx.street;
    let B: number, role: string;
    if (p.facingAggressorFirst) { B = 0.05 + Math.max(0, na) * 2 + Math.max(0, ra); role = '레이저 앞(동크 자리)'; }
    else if (p.initiative) { B = S === 'flop' ? 0.55 + (p.dryBoard ? 0.15 : p.wetBoard ? -0.12 : 0) : S === 'turn' ? 0.45 + (p.scareCard ? 0.05 : 0) : 0.4; role = '주도권 있음'; }
    else { B = S === 'flop' ? 0.38 : S === 'turn' ? 0.42 : 0.36; role = '체크로 넘어옴'; }
    B += clamp(ra * 0.8 + na * 0.8, -0.2, 0.15);
    if (!ctx.ip) B *= 0.85;
    B *= Math.pow(0.6, Math.max(0, ctx.numOpp - 1));
    B = clamp(B, 0.03, S === 'flop' ? 0.72 : S === 'turn' ? 0.6 : 0.55);
    const sz = chooseSize(ctx, p, skill);
    const frac0 = sz.frac;
    // 블러프 비율 = b/(P+2b). 플랍·턴은 드로우가 섞여 조금 더, 리버는 사람들이 잘 안 접어서 조금 덜 (config)
    const bm = AI_V3.bluffMult;
    const bf = clamp((frac0 / (1 + 2 * frac0)) * (S === 'flop' ? bm.flop : S === 'turn' ? bm.turn : bm.river) * (HU ? 1 : 0.5), 0, 0.45);
    const V = B * (1 - bf), Bb = B * bf;
    // 밸류: 만들어진 패 강도로 상위 V
    const rv = massAbove(R, str, myStr);
    let pValue = sig((V - rv) / 0.025);
    // 블러프: 밸류 아닌 패 중 블러프 점수 상위 Bb (드로우·블로커·쇼다운 가치 없음)
    const bs = bluffScores(board, str, nutSuit);
    const valueCut = valueThreshold(R, str, V);
    let w = 0, above = 0;
    for (let i = 0; i < 1326; i++) {
      if (R[i] <= 0) continue;
      w += R[i];
      if (str[i] < valueCut && bs[i] > bs[me]) above += R[i];
    }
    const bluffRank = w > 0 ? above / w : 1;
    // 블러프 몫이 아주 작으면 그만큼만 (경계 흐림 때문에 1% 몫이 60% 블러프가 되지 않게)
    let pBluff = myStr < valueCut ? clamp((Bb + 0.01 - bluffRank) / 0.02, 0, 1) * Math.min(1, Bb / 0.03) : 0;
    // 쇼다운 가치가 충분한 중간 패는 블러프로 쓰지 않음
    if (p.hand.showdown && classRank(p.hand.cls) >= 3) pBluff *= 0.3;
    // 리버: 쇼다운 가치가 조금이라도 있는 패(A하이·약한 페어)는 블러프 대신 체크
    if (S === 'river' && p.hand.cls === 'weak') pBluff *= 0.25;
    // 고수: 넛급 일부는 체크해 체크 레인지를 보호 (드라이 플랍만. 드로우 보드·낮은 SPR에선 슬로플레이 안 함)
    if (skill.solver && myStr >= 0.97 && S === 'flop' && p.dryBoard && HU && ctx.spr > 4) pValue *= 0.7;
    // 강한 패(레인지 상위권 + 실제 강함)는 웻 보드·낮은 SPR에서 보호·밸류 벳 (레이저 앞이 아니면)
    if (myStr >= 0.9 && (p.wetBoard || ctx.spr < 4) && !p.facingAggressorFirst) pValue = Math.max(pValue, 0.85);
    // 리버의 넛급(레인지 상위 7% 이내 + 실제 승률 90%+): 다음 스트리트가 없으니 함정은 의미 없음 → 벳
    if (S === 'river' && p.eqRaw >= 0.9 && myStr >= 0.93) pValue = Math.max(pValue, 0.95);
    // 3명 이상 팟의 블러프는 크게 줄이고, 리버엔 블로커 없으면 안 함
    if (ctx.numOpp >= 2) pBluff *= S === 'river' && !p.hand.blocker ? 0 : 0.3;
    // 3명 이상 팟: 얇은 밸류(밸류 영역 아래쪽)는 체크 쪽으로 — 여러 명이 콜하면 더 좋은 패가 있기 쉬움
    if (ctx.numOpp >= 2 && (rv > Math.max(0.1, V * 0.5) || myStr < 0.85)) pValue *= 0.5;
    const pBet = clamp(Math.max(pValue, pBluff), 0, 0.97);
    const opts: Option[] = [{ key: 'check', act: 'check' }];
    const probs = [1 - pBet];
    const isValue = pValue >= pBluff;
    const intents: Intent[] = [classRank(p.hand.cls) >= 3 ? (myStr >= 0.9 ? 'trap' : 'potControl') : p.hand.showdown ? 'bluffCatch' : 'giveUp'];
    // 사이즈는 '레인지 크기'를 기본으로, 밸류 영역 아래쪽(얇은 밸류)은 작게: 큰 벳·오버벳은 넛급과 블러프만
    let frac = sz.frac, sizeWhy = '';
    if (isValue && (rv > Math.max(0.1, V * 0.5) || myStr < 0.85) && frac > 0.5) { frac = S === 'flop' ? 0.33 : 0.5; sizeWhy = ' · 얇은 밸류라 작게'; }
    if (L.canRaise) {
      const to = betTo(ctx, frac);
      opts.push({ key: 'raise:' + to, act: 'raise', to });
      probs.push(pBet);
      intents.push(isValue ? (myStr >= 0.8 ? 'value' : 'thin') : draw ? 'semibluff' : 'bluff');
    }
    const why = `${role} · 레인지 벳 ${(B * 100).toFixed(0)}% (밸류 ${(V * 100).toFixed(0)}% + 블러프 ${(Bb * 100).toFixed(0)}%) · ${sz.why}${sizeWhy} → 내 패 상위 ${(rv * 100).toFixed(0)}%${pBet < 0.3 ? ` → 벳 영역 밖(블러프 후보 순위 ${(bluffRank * 100).toFixed(0)}%)` : isValue ? ` → 밸류 영역` : ` → 블러프로 선택(후보 순위 ${(bluffRank * 100).toFixed(0)}%)`}`;
    return { options: opts, probs, intents, why, source: 'range' };
  }

  // 벳을 받음: ① 이론(MDF: 블러프가 이득 못 보게 레인지의 이만큼은 지킨다) ② 읽기(상대 라인 레인지 상대 내 승률 vs 가격)
  //  레이즈를 받았거나 스택이 걸린 결정이면 읽기(승률)를 더 믿는다 — 사람들의 레이즈·큰 올인은 밸류 쪽으로 치우침
  const eff = p.myEff!;
  const vsRaise = v.actionLog.some((a) => a.street === ctx.street && a.seat === v.mySeat && (a.type === 'bet' || a.type === 'raise'));
  let defend = p.mdf * clamp(0.62 + 1.1 * p.bluffy, 0.55, 1.05);
  defend /= 1 + 0.5 * (ctx.numOpp - 1);
  defend = clamp(defend, 0.1, 0.95);
  const rr = massAbove(R, eff, eff[me]);
  const pTheory = sig((defend - rr) / 0.03);
  const margin = p.eq - ctx.potOdds;
  const pRead = sig((margin - (draw ? -0.03 : 0.01)) / 0.035);
  const bigDecision = vsRaise || p.commit >= 0.45;
  const wRead = bigDecision ? 0.8 : 0.5;
  let pCont = (1 - wRead) * pTheory + wRead * pRead;
  let why = `MDF ${(p.mdf * 100).toFixed(0)}% × 라인(블러프 가능성 ${(p.bluffy * 100).toFixed(0)}%) → 레인지 ${(defend * 100).toFixed(0)}% 수비, 내 패 상위 ${(rr * 100).toFixed(0)}% · 라인 상대 승률 ${(p.eq * 100).toFixed(0)}% vs 필요 ${(ctx.potOdds * 100).toFixed(0)}%${bigDecision ? ' (큰 결정: 읽기 위주)' : ''}`;
  // 승률이 가격보다 확실히 높으면(작은 벳에 오버카드 등) 랭크와 상관없이 계속
  if (margin >= 0.08 && !vsRaise) pCont = Math.max(pCont, 0.95);
  if (draw && ctx.spr > 3 && margin >= -0.08 && !vsRaise) { pCont = Math.max(pCont, 0.8); why += ' · 드로우 + 깊은 스택(임플라이드)'; }
  // 레이즈: 밸류는 상대 계속 범위보다 앞설 때만, 블러프 레이즈는 강한 드로우·블로커
  const river = ctx.street === 'river';
  const rvStr = massAbove(R, str, myStr);
  // 체크레이즈: 내가 이번 스트리트에 체크했고 헤즈업이면 레이즈 영역을 넓힘 (OOP가 체크-콜만 하면 읽히기 쉬움)
  const iChecked = v.actionLog.some((x) => x.street === ctx.street && x.seat === v.mySeat && x.type === 'check');
  const xr = iChecked && HU && !river;
  const vr = defend * (river ? 0.12 : p.wetBoard ? 0.24 : 0.18) * (xr ? 1.6 : 1);
  let pRaise = sig((vr - rvStr) / 0.02);
  const aheadOfCallers = ctx.numOpp === 1 ? eqVsTop(p.eqRes, 0.4) : p.eq * 0.85;
  if (aheadOfCallers < (xr ? 0.5 : 0.55)) pRaise *= 0.15;
  // 드로우 보드에서 TPTK 이상은 체크레이즈를 섞는다 (보호 + 체크-콜 레인지가 읽히지 않게)
  if (xr && myStr >= 0.85 && p.wetBoard && p.eqRaw >= 0.5) pRaise = Math.max(pRaise, 0.2); // 레이즈에 콜할 패들한테 밀리면 밸류 레이즈가 아님
  if (vsRaise && myStr < 0.97) pRaise *= 0.2; // 리레이즈는 넛급만
  if (p.eqRaw < 0.5) pRaise *= 0.2; // 보드가 위험하면 밸류 레이즈 안 함
  if (!river && draw) pRaise = Math.max(pRaise, (p.hand.comboDraw ? 0.45 : 0.2) * (ctx.spr > 2 ? 1 : 0.5) * (HU ? 1 : 0.3));
  if (river && skill.solver && p.hand.nutBlocker && p.hand.cls === 'air' && HU) pRaise = Math.max(pRaise, 0.1);
  // 이번 스트리트에 이미 레이즈가 두 번 이상 → 넛급만
  const raises = v.actionLog.filter((a) => a.street === ctx.street && (a.type === 'raise' || a.type === 'bet')).length;
  if (raises >= 2 && myStr < 0.95) pRaise = 0;
  // 스택이 아직 깊은데(SPR 1.5+) 올인 레이즈가 되는 경우: 넛급이나 강한 드로우가 아니면 거의 안 함
  if (raiseTo(ctx) >= v.legal.maxRaiseTo && ctx.spr > 1.5 && myStr < 0.9 && !p.hand.comboDraw) pRaise *= 0.3;
  pRaise = Math.min(pRaise, pCont);
  const opts: Option[] = [{ key: 'fold', act: 'fold' }, { key: 'call', act: 'call' }];
  const probs = [1 - pCont, pCont - pRaise];
  const c = p.hand.cls;
  const intents: Intent[] = ['fold', c === 'air' ? 'float' : classRank(c) >= 4 ? 'trap' : 'bluffCatch'];
  if (L.canRaise) {
    const to = raiseTo(ctx);
    opts.push({ key: 'raise:' + to, act: 'raise', to });
    probs.push(pRaise);
    intents.push(rvStr < vr ? 'value' : draw ? 'semibluff' : 'bluff');
  } else probs[1] = pCont;
  return { options: opts, probs, intents, why, source: 'range' };
}

/** 레인지 상위 V 비율의 강도 경계값 */
function valueThreshold(R: Float64Array, str: Float32Array, V: number): number {
  const items: { s: number; w: number }[] = [];
  let tot = 0;
  for (let i = 0; i < 1326; i++) if (R[i] > 0) { items.push({ s: str[i], w: R[i] }); tot += R[i]; }
  items.sort((a, b) => b.s - a.s);
  let acc = 0;
  for (const it of items) { acc += it.w; if (acc >= V * tot) return it.s; }
  return 0;
}
