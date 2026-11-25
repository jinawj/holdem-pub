// 사람의 포커적 사고 (v2): 짧은 3단계로 상황을 읽는다
//  ① 내 패는 뭔가? (몬스터 / 강함 / 중간 / 약함 / 드로우 / 에어) — 족보·키커·보드 위험도로 사람처럼 분류
//  ② 주도권은 누구에게? (프리플랍 레이저·직전 스트리트 공격자) / 나는 레이저 앞에서 먼저 행동하나?
//  ③ 상대 벳 크기가 말하는 것 (작으면 넓게, 크면 강하거나 블러프 = 양극화)
// 에퀴티 계산은 '보드가 무서워졌는지' 확인하는 보조로만 쓴다 (수학적 편향 줄이기)
import { rankOf, suitOf } from '../../engine/cards';
import type { Ctx } from './context';

export type HandClass = 'monster' | 'strong' | 'medium' | 'weak' | 'draw' | 'air';
const ORDER: HandClass[] = ['air', 'weak', 'draw', 'medium', 'strong', 'monster'];

export interface Read {
  cls: HandClass;
  desc: string; // 사람이 머릿속으로 말하듯 짧게
  strongDraw: boolean; // 플러시 드로우 / 양방향 / 콤보
  backdoor: boolean; // 플랍 백도어 드로우
  blocker: boolean; // 상대 넛을 막는 카드 (플러시 A·K)
  showdown: boolean; // 쇼다운 가치가 조금이라도 있음 (A하이·작은 페어 등)
  initiative: boolean; // 내가 주도권(직전 공격자)
  facingAggressorFirst: boolean; // 주도권 가진 상대보다 먼저 행동 (여기서 벳하면 동크)
  scareCard: boolean; // 이번 스트리트에 들어온 무서운 카드 (오버카드·플러시·스트레이트 완성)
  polarBet: boolean; // 받은 벳이 큼 (팟의 75% 이상) → 강하거나 블러프
}

export function readHand(ctx: Ctx, eq: number | undefined, level = 6): Read {
  const v = ctx.view;
  const [h1, h2] = v.holeCards;
  const board = v.board;
  const br = board.map(rankOf).sort((a, b) => b - a);
  const hr = [rankOf(h1), rankOf(h2)].sort((a, b) => b - a);
  const top = br[0] ?? -1;
  const second = br[1] ?? -1;
  const pocketPair = hr[0] === hr[1];
  let cls: HandClass = 'air';
  let desc = '';

  if (ctx.madeCat >= 4) { cls = 'monster'; desc = ctx.madeCat >= 6 ? '풀하우스 이상' : ctx.madeCat === 5 ? '플러시' : '스트레이트'; }
  else if (ctx.madeCat === 3) { cls = 'monster'; desc = pocketPair ? '셋' : '트립스'; }
  else if (ctx.madeCat === 2) {
    const bothUsed = br.includes(hr[0]) && br.includes(hr[1]) && !pocketPair;
    if (bothUsed) { cls = ctx.wet > 0.55 ? 'strong' : 'monster'; desc = '투페어(둘 다 사용)'; }
    else if (pocketPair && hr[0] > top) { cls = 'strong'; desc = '오버페어(보드 페어)'; }
    else { cls = hr.includes(top) ? 'strong' : 'medium'; desc = '투페어(보드 페어)'; }
  } else if (ctx.madeCat === 1) {
    if (pocketPair && hr[0] > top) { cls = 'strong'; desc = '오버페어'; }
    else if (hr.includes(top)) {
      const kicker = hr[0] === top ? hr[1] : hr[0];
      const good = kicker >= 10 || top === 12; // 키커 Q 이상 또는 A 탑페어
      cls = good ? 'strong' : 'medium';
      desc = good ? '탑페어 좋은 키커' : '탑페어 약한 키커';
    } else if (hr.includes(second) || (pocketPair && hr[0] > second)) { cls = 'medium'; desc = '세컨드 페어'; }
    else { cls = 'weak'; desc = '약한 페어'; }
  } else {
    const aceHigh = hr[0] === 12;
    cls = aceHigh ? 'weak' : 'air';
    desc = aceHigh ? 'A하이' : '노페어';
  }

  // 드로우 (메이드가 약하면 드로우로 본다)
  const strongDraw = v.street !== 'river' && ((ctx.flushDraw && ctx.oesd) || ctx.flushDraw || ctx.oesd);
  if ((cls === 'air' || cls === 'weak') && strongDraw) { cls = 'draw'; desc += ctx.flushDraw ? ' + 플러시 드로우' : ' + 양방향 드로우'; }

  // 보드가 무서워졌는지: 에퀴티로 한 단계 보정 (사람이 "플러시 완성됐네" 하고 패를 낮춰 보는 것)
  // 보드가 무서워진 걸 알아채는 건 실력: Lv1–3은 탑페어를 과대평가(사람다운 실수), Lv4 이상만 패를 낮춰 봄
  if (eq !== undefined && cls !== 'draw' && level >= 4) {
    const i = ORDER.indexOf(cls);
    if (eq < 0.22 && i >= 3) { cls = ORDER[i - 1]; desc += ' (보드 위험)'; }
    else if (eq > 0.88 && i < 5 && i >= 3) { cls = ORDER[i + 1]; desc += ' (거의 확실)'; }
  }

  // 백도어 (플랍): 수딧 + 같은 무늬 보드 1장, 또는 연결된 카드
  let backdoor = false;
  if (board.length === 3) {
    const s = suitOf(h1) === suitOf(h2) ? suitOf(h1) : -1;
    if (s >= 0 && board.filter((c) => suitOf(c) === s).length === 1) backdoor = true;
    if (Math.abs(hr[0] - hr[1]) <= 2 && hr[1] >= 3) backdoor = true;
  }
  // 블로커: 보드에 같은 무늬 3장 이상일 때 그 무늬 A나 K를 가짐
  const suitCnt = [0, 0, 0, 0];
  board.forEach((c) => suitCnt[suitOf(c)]++);
  const flushSuit = suitCnt.findIndex((n) => n >= 3);
  const blocker = flushSuit >= 0 && [h1, h2].some((c) => suitOf(c) === flushSuit && rankOf(c) >= 11 && ctx.madeCat < 5);

  // 주도권: 직전 스트리트(프리플랍 포함)의 마지막 공격자
  const order = ['preflop', 'flop', 'turn', 'river'];
  const si = order.indexOf(v.street);
  let initiativeSeat: number | null = null;
  for (let k = si - 1; k >= 0 && initiativeSeat === null; k--) {
    const acts = v.actionLog.filter((a) => a.street === order[k] && (a.type === 'bet' || a.type === 'raise'));
    if (acts.length) initiativeSeat = acts[acts.length - 1].seat;
  }
  const initiative = initiativeSeat === v.mySeat;
  // 주도권 가진 상대가 아직 이번 스트리트에서 행동 안 했고, 나보다 뒤에 행동 → 지금 벳하면 동크
  const actedThisStreet = new Set(v.actionLog.filter((a) => a.street === v.street).map((a) => a.seat));
  const aggressorAlive = initiativeSeat !== null && v.seats.some((s) => s.seat === initiativeSeat && s.status === 'active');
  const facingAggressorFirst = !initiative && aggressorAlive && !actedThisStreet.has(initiativeSeat!) && !ctx.facingBet;

  // 무서운 카드: 이번 스트리트 카드가 이전 보드 최고 카드보다 높음 / 무늬 3장째
  let scareCard = false;
  if (board.length >= 4) {
    const last = board[board.length - 1];
    const prev = board.slice(0, -1);
    const prevTop = Math.max(...prev.map(rankOf));
    const sameSuit = prev.filter((c) => suitOf(c) === suitOf(last)).length;
    scareCard = rankOf(last) > prevTop || sameSuit === 2;
  }

  const showdown = cls !== 'air';
  return {
    cls, desc, strongDraw, backdoor, blocker, showdown, initiative, facingAggressorFirst, scareCard,
    polarBet: ctx.facingBet && ctx.lastBetFrac >= 0.75,
  };
}

export const classRank = (c: HandClass) => ORDER.indexOf(c);
