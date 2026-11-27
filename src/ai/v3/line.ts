// 라인 읽기 모듈: 한 핸드 동안 각 플레이어가 걸어온 길을 사람 말로 정리하고,
//  그 라인이 말해 주는 '강함'과 '블러프 섞였을 가능성'을 숫자로 만든다.
import type { PlayerView } from '../../engine/view';

export const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
type St = (typeof STREETS)[number];
export type Act = 'x' | 'b' | 'c' | 'r' | 'f';

export interface StreetActs { acts: Act[]; fracs: number[] }
export interface SeatLine {
  seat: number;
  preRole: 'opener' | '3bettor' | '4bettor' | 'caller' | 'limper' | 'blind' | 'none';
  streets: Partial<Record<St, StreetActs>>;
  tags: string[];
  /** -1(약해 보임) .. +1(아주 강해 보임) */
  strength: number;
  /** 이 라인의 큰 벳·레이즈에 블러프가 섞였을 비율 감 (0..1, 평균 0.25) */
  bluffy: number;
  /** 강한 패가 빠져 있을 가능성(캡) 0..1 */
  capped: number;
  story: string;
}

const NAME: Record<Act, string> = { x: '체크', b: '벳', c: '콜', r: '레이즈', f: '폴드' };
const ROLE: Record<SeatLine['preRole'], string> = { opener: '오픈', '3bettor': '3벳', '4bettor': '4벳+', caller: '콜', limper: '림프', blind: '블라인드', none: '-' };

function fracName(f: number) {
  if (f <= 0.4) return '작게';
  if (f < 0.8) return '';
  if (f <= 1.1) return '팟';
  return '오버벳';
}

/** 액션 로그 → 좌석별 라인 */
export function readLines(view: PlayerView, upToStreet?: St): Record<number, SeatLine> {
  const out: Record<number, SeatLine> = {};
  const get = (seat: number) => (out[seat] ??= { seat, preRole: 'none', streets: {}, tags: [], strength: 0, bluffy: 0.25, capped: 0, story: '' });
  for (const s of view.seats) get(s.seat);
  let pot = 0, raisesPre = 0;
  const stopAt = upToStreet ? STREETS.indexOf(upToStreet) : 99;
  for (const a of view.actionLog) {
    const potBefore = pot;
    pot += a.amount;
    if (a.type === 'ante' || a.type === 'sb' || a.type === 'bb') { if (a.type !== 'ante') get(a.seat).preRole = 'blind'; continue; }
    if (STREETS.indexOf(a.street as St) >= stopAt) continue;
    const L = get(a.seat);
    const act: Act = a.type === 'check' ? 'x' : a.type === 'call' ? 'c' : a.type === 'fold' ? 'f' : a.type === 'bet' ? 'b' : 'r';
    const st = (L.streets[a.street as St] ??= { acts: [], fracs: [] });
    st.acts.push(act);
    st.fracs.push(potBefore > 0 ? a.amount / potBefore : 0);
    if (a.street === 'preflop') {
      if (act === 'r' || act === 'b') { raisesPre++; L.preRole = raisesPre === 1 ? 'opener' : raisesPre === 2 ? '3bettor' : '4bettor'; }
      else if (act === 'c') L.preRole = raisesPre === 0 ? 'limper' : L.preRole === 'opener' || L.preRole === '3bettor' ? L.preRole : 'caller';
    }
  }
  // 해석
  const pfa = lastAggressorOn(view, 'preflop');
  for (const L of Object.values(out)) interpret(L, view, pfa);
  return out;
}

function lastAggressorOn(view: PlayerView, street: St): number | null {
  let s: number | null = null;
  for (const a of view.actionLog) if (a.street === street && (a.type === 'bet' || a.type === 'raise')) s = a.seat;
  return s;
}

function interpret(L: SeatLine, view: PlayerView, pfa: number | null) {
  const parts: string[] = [ROLE[L.preRole]];
  let strength = L.preRole === '4bettor' ? 0.5 : L.preRole === '3bettor' ? 0.3 : L.preRole === 'opener' ? 0.1 : L.preRole === 'limper' ? -0.2 : L.preRole === 'caller' ? -0.05 : 0;
  let bluffy = 0.25, capped = L.preRole === 'caller' || L.preRole === 'limper' || L.preRole === 'blind' ? 0.35 : 0;
  let barrels = 0, prevAggr = L.seat === pfa;
  let passiveSoFar = true;
  for (const st of ['flop', 'turn', 'river'] as const) {
    const s = L.streets[st];
    const aggrSeat = lastAggressorOn(view, st);
    if (!s) { if (aggrSeat !== null && aggrSeat !== L.seat) prevAggr = false; continue; }
    const acts = s.acts.join('');
    const bigF = Math.max(0, ...s.fracs);
    const words = s.acts.map((a, i) => (a === 'b' || a === 'r' ? `${fracName(s.fracs[i])}${NAME[a]}` : NAME[a])).join('-');
    parts.push(`${st === 'flop' ? '플랍' : st === 'turn' ? '턴' : '리버'} ${words}`);
    const aggressive = acts.includes('b') || acts.includes('r');
    if (acts.includes('x') && acts.includes('r')) { L.tags.push(`${st}:체크레이즈`); strength += st === 'river' ? 0.6 : 0.45; bluffy = st === 'river' ? 0.08 : 0.15; capped = 0; }
    else if (acts.includes('r')) { L.tags.push(`${st}:레이즈`); strength += st === 'river' ? 0.55 : 0.35; bluffy = st === 'river' ? 0.1 : 0.17; capped = 0; }
    else if (acts.includes('b')) {
      if (prevAggr) { barrels++; L.tags.push(barrels === 1 ? `${st}:C벳` : `${st}:${barrels}배럴`); strength += 0.12 + 0.05 * barrels; }
      else if (passiveSoFar && st === 'river') { L.tags.push('river:수동적이다가 리드'); strength += 0.3; bluffy = 0.22; }
      else { L.tags.push(`${st}:${st === 'flop' ? '동크' : '프로브/지연 벳'}`); strength += 0.15; bluffy = 0.33; }
      if (bigF >= 1.1) { L.tags.push(`${st}:오버벳`); strength += 0.15; bluffy = Math.max(bluffy, 0.3); }
      else if (bigF >= 0.75) { strength += 0.08; if (st !== 'flop') bluffy = Math.min(bluffy, 0.22); }
      else if (bigF <= 0.4) { strength -= 0.05; bluffy = Math.max(bluffy, 0.35); }
      capped = Math.max(0, capped - 0.25);
    } else if (acts.includes('c')) {
      strength += 0.05; capped = Math.min(1, capped + 0.15);
      if (acts.startsWith('x')) L.tags.push(`${st}:체크콜`);
      else L.tags.push(`${st}:콜`);
    } else if (acts === 'x') {
      strength -= 0.12;
      // 마지막 행동자가 체크로 넘김(체크백) → 강한 패 빠짐
      if (aggrSeat === null && view.street !== st) { capped = Math.min(1, capped + 0.3); if (prevAggr) L.tags.push(`${st}:체크백(포기?)`); }
    }
    if (aggressive) passiveSoFar = false;
    prevAggr = aggrSeat === L.seat;
  }
  // 배럴을 계속 치는 라인: 밸류가 늘지만, 놓친 드로우도 섞인다 (리버 양극화)
  // 배럴이 거듭되고 크기가 클수록 밸류 쪽 (사람들은 늦은 스트리트 큰 벳에 블러프를 덜 섞음). 3배럴은 놓친 드로우가 조금 섞임
  if (barrels >= 2) bluffy = Math.min(bluffy, 0.3 - 0.04 * barrels + (barrels >= 3 ? 0.04 : 0));
  L.strength = Math.max(-1, Math.min(1, strength));
  L.bluffy = bluffy;
  L.capped = capped;
  L.story = parts.join(' → ');
}
