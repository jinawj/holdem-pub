// 인식(생각 모듈 모음): 사람이 포커 칠 때 떠올리는 개념들을 하나씩 계산해 Percept로 묶는다.
//  레벨이 낮으면 일부 개념은 아예 안 보이거나(skill 플래그) 흐릿하게(오차) 보인다.
//  ① 내 패(족보·키커·드로우·블로커)  ② 보드(텍스처·무서운 카드)  ③ 승률(상대 레인지 상대)
//  ④ 가격(팟 오즈·MDF·SPR·커밋)  ⑤ 포지션·주도권·멀티웨이  ⑥ 라인 읽기(상대 라인)
//  ⑦ 레인지 우위·넛 우위·내 레인지 속 내 패 위치  ⑧ 이전 스트리트의 내 계획
import { rankOf, suitOf } from '../../engine/cards';
import { equityVsRanges, EquityResult, Range } from '../core/equity';
import { AI_V3 } from '../../config';
import type { Ctx } from './context';
import { readLines, SeatLine } from './line';
import { buildRange, comboIndex, massAbove, rangeSummary } from './range';
import type { Skill } from './skill';
import type { Plan, V3Memory } from './types';

export type HandClass = 'monster' | 'strong' | 'medium' | 'weak' | 'draw' | 'air';
export const CLASS_ORDER: HandClass[] = ['air', 'weak', 'draw', 'medium', 'strong', 'monster'];
export const classRank = (c: HandClass) => CLASS_ORDER.indexOf(c);

export interface HandRead {
  cls: HandClass; desc: string; strongDraw: boolean; comboDraw: boolean; backdoor: boolean;
  blocker: boolean; nutBlocker: boolean; showdown: boolean;
}

export interface Percept {
  hand: HandRead;
  eq: number; // 내가 느끼는 승률 (오차 포함)
  eqRaw: number; // 오차 없는 계산값 (안전장치용)
  eqRes: EquityResult;
  oppRanges: Range[];
  villain: number; // 주 상대 (마지막 공격자 또는 첫 상대)
  vLine: SeatLine;
  bluffy: number; // 상대 큰 벳의 블러프 가능성 (라인)
  initiative: boolean;
  facingAggressorFirst: boolean;
  scareCard: boolean;
  dryBoard: boolean;
  wetBoard: boolean;
  mdf: number; // 최소 수비 빈도 (벳을 받았을 때)
  alpha: number; // 블러프 손익분기 (상대가 폴드해야 할 비율)
  commit: number; // 콜 금액 / 내 남은 스택
  // 레인지 단위 (상급 이상)
  myRange?: Range;
  myEff?: Float32Array; // 콤보별 실효 강도
  myRank?: number; // 내 레인지에서 나보다 강한 콤보 비율 (0 = 최상위)
  rangeAdv?: number; // 내 레인지 평균 강도 − 상대
  nutAdv?: number; // 내 넛 비중 − 상대
  plan?: Plan;
  thoughts: string[];
}

function gauss(rand: () => number) { return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand()); }

export function readHand(ctx: Ctx, eq: number, noticeDanger: boolean): HandRead {
  const v = ctx.view;
  const [h1, h2] = v.holeCards;
  const board = v.board;
  const br = board.map(rankOf).sort((a, b) => b - a);
  const hr = [rankOf(h1), rankOf(h2)].sort((a, b) => b - a);
  const top = br[0] ?? -1, second = br[1] ?? -1;
  const pp = hr[0] === hr[1];
  let cls: HandClass = 'air', desc = '';
  if (ctx.madeCat >= 4) { cls = 'monster'; desc = ctx.madeCat >= 6 ? '풀하우스 이상' : ctx.madeCat === 5 ? '플러시' : '스트레이트'; }
  else if (ctx.madeCat === 3) { cls = 'monster'; desc = pp ? '셋' : '트립스'; }
  else if (ctx.madeCat === 2) {
    const both = br.includes(hr[0]) && br.includes(hr[1]) && !pp;
    if (both) { cls = ctx.wet > 0.55 ? 'strong' : 'monster'; desc = '투페어'; }
    else if (pp && hr[0] > top) { cls = 'strong'; desc = '오버페어(보드 페어)'; }
    // 보드 페어 + 내 페어: 내 페어가 몇 번째인지로 (예: T-4-4 보드에 33은 사실상 언더페어 → 약함)
    else if (pp) { cls = hr[0] > second ? 'medium' : 'weak'; desc = hr[0] > second ? '포켓 페어(보드 페어, 중간)' : '낮은 포켓 페어(보드 페어)'; }
    else if (hr.includes(top)) { cls = 'strong'; desc = '탑페어 + 보드 페어'; }
    else { cls = hr.includes(second) ? 'medium' : 'weak'; desc = hr.includes(second) ? '세컨드 페어 + 보드 페어' : '낮은 페어 + 보드 페어'; }
  } else if (ctx.madeCat === 1) {
    if (pp && hr[0] > top) { cls = 'strong'; desc = '오버페어'; }
    else if (hr.includes(top)) {
      const kicker = hr[0] === top ? hr[1] : hr[0];
      const good = kicker >= 10 || top === 12;
      cls = good ? 'strong' : 'medium'; desc = good ? '탑페어 좋은 키커' : '탑페어 약한 키커';
    } else if (hr.includes(second) || (pp && hr[0] > second)) { cls = 'medium'; desc = '세컨드 페어'; }
    else { cls = 'weak'; desc = '약한 페어'; }
  } else { cls = hr[0] === 12 ? 'weak' : 'air'; desc = hr[0] === 12 ? 'A하이' : '노페어'; }

  const river = v.street === 'river';
  const strongDraw = !river && (ctx.flushDraw || ctx.oesd);
  const comboDraw = !river && ctx.flushDraw && (ctx.oesd || ctx.gutshot);
  if ((cls === 'air' || cls === 'weak') && strongDraw) { cls = 'draw'; desc += comboDraw ? ' + 콤보 드로우' : ctx.flushDraw ? ' + 플러시 드로우' : ' + 양방향 드로우'; }
  else if (cls !== 'monster' && strongDraw) desc += ' + 드로우';
  // 보드 위험 알아채기 (레벨이 낮으면 놓침)
  if (noticeDanger && cls !== 'draw') {
    const i = classRank(cls);
    if (eq < 0.22 && i >= 3) { cls = CLASS_ORDER[i - 1]; desc += ' (보드가 위험)'; }
    else if (eq > 0.88 && i >= 3 && i < 5) { cls = CLASS_ORDER[i + 1]; desc += ' (거의 확실)'; }
  }
  let backdoor = false;
  if (board.length === 3) {
    const s = suitOf(h1) === suitOf(h2) ? suitOf(h1) : -1;
    if (s >= 0 && board.filter((c) => suitOf(c) === s).length === 1) backdoor = true;
    if (Math.abs(hr[0] - hr[1]) <= 2 && hr[1] >= 3) backdoor = true;
  }
  const suitCnt = [0, 0, 0, 0];
  board.forEach((c) => suitCnt[suitOf(c)]++);
  const fs = suitCnt.findIndex((n) => n >= 3);
  const blocker = fs >= 0 && [h1, h2].some((c) => suitOf(c) === fs && rankOf(c) >= 11) && ctx.madeCat < 5;
  const nutBlocker = fs >= 0 && [h1, h2].some((c) => suitOf(c) === fs && rankOf(c) === 12) && ctx.madeCat < 5;
  return { cls, desc, strongDraw, comboDraw, backdoor, blocker, nutBlocker, showdown: cls !== 'air' && cls !== 'draw' };
}

/** 주도권: 직전 스트리트까지의 마지막 공격자 */
function initiativeSeat(ctx: Ctx): number | null {
  const order = ['preflop', 'flop', 'turn', 'river'];
  const si = order.indexOf(ctx.street);
  for (let k = si - 1; k >= 0; k--) {
    const acts = ctx.view.actionLog.filter((a) => a.street === order[k] && (a.type === 'bet' || a.type === 'raise'));
    if (acts.length) return acts[acts.length - 1].seat;
  }
  return null;
}

export function perceive(ctx: Ctx, skill: Skill, mem: V3Memory, rand: () => number, quick: boolean): Percept {
  const v = ctx.view;
  const thoughts: string[] = [];
  // ⑥ 라인 읽기
  const lines = readLines(v);
  let villain = ctx.oppSeats[0];
  for (const a of v.actionLog) if ((a.type === 'bet' || a.type === 'raise') && a.seat !== v.mySeat && ctx.oppSeats.includes(a.seat)) villain = a.seat;
  const vLine = lines[villain];
  const bluffy = vLine.bluffy;
  if (skill.lineBasic) thoughts.push(`상대 라인: ${vLine.story}${skill.lineFull && vLine.capped > 0.4 ? ' (강한 패 빠졌을 수도)' : ''}`);
  // 상대 레인지: 라인 반영 정도는 실력
  const bluffMult = skill.lineFull ? bluffy / 0.25 : 1;
  // 레이즈가 쌓이면 중급도 "이건 진짜다"를 느낀다: 포스트플랍 레이즈 1번당 라인 반영 +35%p (라인 읽기 기본 이상)
  const postRaises = v.actionLog.filter((a) => a.street !== 'preflop' && a.type === 'raise' && a.seat !== v.mySeat).length;
  let read = skill.lineBasic ? Math.min(1, skill.rangeRead + (1 - skill.rangeRead) * Math.min(1, 0.35 * postRaises)) : skill.rangeRead;
  // 누구나 아는 감: 3벳·4벳 팟이면 상대가 세다, 상대가 계속 벳하면 뭔가 있다 (초급 포함 최소 반영)
  const preRaises = v.actionLog.filter((x) => x.street === 'preflop' && x.type === 'raise').length;
  const oppBets = v.actionLog.filter((x) => x.street !== 'preflop' && (x.type === 'bet' || x.type === 'raise') && x.seat !== v.mySeat).length;
  read = Math.max(read, preRaises >= 3 ? 0.6 : preRaises === 2 ? 0.4 : 0, Math.min(0.45, 0.15 * oppBets));
  const oppRanges = ctx.oppSeats.map((s) => buildRange(v, s, { read, bluffMult: s === villain ? bluffMult : 1 }));
  // ③ 승률
  const samples = quick ? AI_V3.mc.quick : AI_V3.mc.normal;
  const eqRes = equityVsRanges(v.holeCards, v.board, oppRanges, samples, rand);
  const eqRaw = eqRes.eq;
  // 감각 오차는 확신이 클수록 작게 (하수도 넛을 0%로 느끼진 않음), 0%·100%는 피함
  const eq = Math.max(0.03, Math.min(0.97, eqRaw + gauss(rand) * skill.eqNoise * 4 * eqRaw * (1 - eqRaw)));
  // ① 내 패
  const hand = readHand(ctx, eqRaw, rand() < skill.boardDanger);
  thoughts.push(`내 패: ${hand.desc}${hand.nutBlocker ? ' · 넛 플러시 블로커' : hand.blocker ? ' · 플러시 블로커' : ''}`);
  // ⑤ 포지션·주도권
  const ini = initiativeSeat(ctx);
  const initiative = ini === v.mySeat;
  const acted = new Set(v.actionLog.filter((a) => a.street === v.street).map((a) => a.seat));
  const aggressorAlive = ini !== null && v.seats.some((s) => s.seat === ini && s.status === 'active');
  const facingAggressorFirst = !initiative && aggressorAlive && !acted.has(ini!) && !ctx.facingBet;
  // ② 보드
  let scareCard = false;
  if (v.board.length >= 4) {
    const last = v.board[v.board.length - 1];
    const prev = v.board.slice(0, -1);
    scareCard = rankOf(last) > Math.max(...prev.map(rankOf)) || prev.filter((c) => suitOf(c) === suitOf(last)).length === 2;
  }
  const dryBoard = ctx.wet < 0.3, wetBoard = ctx.wet > 0.55;
  if (skill.position) thoughts.push(`${ctx.ip ? '인포지션' : '아웃오브포지션'} · ${initiative ? '주도권 내가' : '주도권 없음'} · ${dryBoard ? '드라이 보드' : wetBoard ? '웻 보드' : '보통 보드'}${scareCard ? ' · 무서운 카드' : ''}${ctx.numOpp > 1 ? ` · ${ctx.numOpp + 1}명 팟` : ''}`);
  // ④ 가격
  const f = ctx.betFrac;
  const mdf = ctx.facingBet ? 1 / (1 + f) : 0;
  const alpha = ctx.facingBet ? f / (1 + f) : 0;
  const commit = ctx.toCall / Math.max(1, v.legal.stack);
  thoughts.push(`승률 ${(eq * 100).toFixed(0)}%${skill.potOdds && ctx.facingBet ? ` · 필요 ${(ctx.potOdds * 100).toFixed(0)}%` : ''}${skill.rangeStrategy && ctx.facingBet ? ` · MDF ${(mdf * 100).toFixed(0)}%` : ''} · SPR ${ctx.spr.toFixed(1)}`);
  const p: Percept = { hand, eq, eqRaw, eqRes, oppRanges, villain, vLine, bluffy, initiative, facingAggressorFirst, scareCard, dryBoard, wetBoard, mdf, alpha, commit, thoughts };
  // ⑦ 레인지 단위
  if (skill.rangeStrategy) {
    const myRange = buildRange(v, v.mySeat, { read: 1, dead: v.board });
    const my = rangeSummary(myRange, v.board);
    const vr = buildRange(v, villain, { read: 1, dead: v.board, bluffMult });
    const op = rangeSummary(vr, v.board);
    const me = comboIndex(v.holeCards[0], v.holeCards[1]);
    if (myRange[me] <= 0) myRange[me] = 0.01;
    p.myRange = myRange;
    p.myEff = my.eff;
    p.myRank = massAbove(myRange, my.eff, my.eff[me]);
    p.rangeAdv = my.avg - op.avg;
    p.nutAdv = my.nuts - op.nuts;
    thoughts.push(`레인지: 내 패는 내 레인지 상위 ${(p.myRank * 100).toFixed(0)}% · 레인지 우위 ${signed(p.rangeAdv)} · 넛 우위 ${signed(p.nutAdv)}`);
  }
  // ⑧ 이전 계획
  if (skill.plan) {
    const prev = mem.plans.filter((x) => x.handNo === v.handNo && x.street !== v.street);
    if (prev.length) { p.plan = prev[prev.length - 1]; thoughts.push(`이전 계획: ${p.plan.street} ${p.plan.note}`); }
  }
  return p;
}

function signed(x: number) { const v = Math.round(x * 100); return `${v >= 0 ? '+' : ''}${v}%p`; }
