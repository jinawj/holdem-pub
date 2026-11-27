// 상황별 시험장 공용 부분 (scripts/ai-situations.ts, scripts/ai-tune.ts가 같이 씀)
//  - 상황·고정 상대(v2)·한 핸드 진행
//  - 주인공 통계: 자리별 첫 진입·BB 수비·플랫·3벳·3벳에 폴드, 보드 유형별 C벳, C벳에 폴드·체크레이즈·동크·턴 배럴, AF·WTSD
//  - 목표 범위(레귤러 통계, 일반적으로 알려진 수준의 근사값)와 벗어난 정도
//  - 사고 과정 모순 검출: 생각/계산과 실제 행동이 어긋나는 결정 수 (1000결정당)
import * as V2 from '../src/ai/v2';
import * as V3 from '../src/ai/v3';
import { startHand } from '../src/engine/hand';
import type { HandState, PublicAction } from '../src/engine/types';
import { makePlayerView } from '../src/engine/view';
import { newRunStats, runHand, RunStats } from '../src/game/headless';
import { makeRng } from './lib';

export const BB = 200;

export interface Bot { name: string; decide: (view: any, rand: () => number) => any; endHand?: (h: HandState, seat: number) => void }
export function v3Bot(level: number, style?: string): Bot {
  const prof = V3.makeProfileV3(level, style);
  const mem = V3.newMemoryV3();
  return { name: `v3 Lv${level}${style ? ' ' + style : ''}`, decide: (view, rand) => V3.decide(view, prof, mem, { rand, quick: true }), endHand: () => V3.endHandV3(mem) };
}
export function v2Bot(id: V2.PersonaId, level: number, seed: number): Bot {
  const r = makeRng(seed);
  const prof = V2.makeProfile(id, level, r.rand);
  const mem = V2.newMemory();
  return { name: `v2 ${V2.PERSONAS[id].name} Lv${level}`, decide: (view, rand) => V2.decide(view, prof, mem, { rand, quick: true }) };
}
export function shown(h: HandState) {
  if (!h.result || h.result.uncontested) return [];
  return h.players.filter((p) => !p.folded).map((p) => ({ seat: p.seat, hole: [p.hole[0], p.hole[1]] as [number, number] }));
}

// ---------- 상황 ----------
export interface Scenario { id: string; name: string; n: number; ante: number; stacks: (hero: number, r: () => number) => number[] }
const U = (r: () => number, a: number, b: number) => Math.round(a + r() * (b - a));
function shuffle<T>(a: T[], r: () => number) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
export const SCENARIOS: Scenario[] = [
  { id: 'deep', name: '딥스택 (전원 120~180BB, 앤티 없음)', n: 6, ante: 0, stacks: (_h, r) => Array.from({ length: 6 }, () => U(r, 120, 180)) },
  { id: 'mid', name: '중간 스택 (전원 40~70BB)', n: 6, ante: 1, stacks: (_h, r) => Array.from({ length: 6 }, () => U(r, 40, 70)) },
  { id: 'short', name: '모두 숏스택 (전원 10~25BB)', n: 6, ante: 1, stacks: (_h, r) => Array.from({ length: 6 }, () => U(r, 10, 25)) },
  { id: 'heroShort', name: '나만 숏스택 (나 8~16BB, 상대 35~80BB)', n: 6, ante: 1, stacks: (h, r) => Array.from({ length: 6 }, (_, s) => (s === h ? U(r, 8, 16) : U(r, 35, 80))) },
  { id: 'heroBig', name: '나만 빅스택 (나 90~130BB, 상대 15~35BB)', n: 6, ante: 1, stacks: (h, r) => Array.from({ length: 6 }, (_, s) => (s === h ? U(r, 90, 130) : U(r, 15, 35))) },
  { id: 'mixed', name: '스택 섞임 (8·15·25·40·60·100BB 무작위 배치)', n: 6, ante: 1, stacks: (_h, r) => shuffle([8, 15, 25, 40, 60, 100], r) },
  { id: 'hu', name: '헤즈업 (각 15~45BB)', n: 2, ante: 1, stacks: (_h, r) => [U(r, 15, 45), U(r, 15, 45)] },
];

/** 고정 상대들 (v2, 바뀌지 않음): 레귤러·솔버·공격수·콜스테이션·바위·막 지르는 */
const FIELD: [V2.PersonaId, number][] = [['reg', 8], ['solver', 9], ['lag', 7], ['station', 5], ['nit', 6], ['maniac', 5]];
export function makeField(sc: Scenario, k: number, seedBase: number): Bot[] {
  if (sc.n === 2) return [k % 2 === 0 ? v2Bot('reg', 8, seedBase) : v2Bot('solver', 9, seedBase)];
  return Array.from({ length: sc.n - 1 }, (_, i) => { const [id, l] = FIELD[(i + k) % FIELD.length]; return v2Bot(id, l, seedBase + i); });
}

export function posName(seat: number, btn: number, n: number): string {
  const off = (seat - btn + n) % n;
  if (n === 2) return off === 0 ? 'BTN/SB' : 'BB';
  return ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'][off] ?? `+${off}`;
}
/** 주인공 자리는 k % n, 버튼은 floor(k / n) % n → n×n 핸드마다 주인공이 모든 포지션을 고르게 돈다 */
export const btnOf = (k: number, n: number) => Math.floor(k / n) % n;

export const rs: RunStats = newRunStats();

/** 한 핸드 진행. hero 자리에 heroBot, 나머지는 field (순서대로) */
export function play(sc: Scenario, k: number, seed: string, stacks: number[], heroSeat: number, heroBot: Bot, field: Bot[], decRand: () => number, onDecide?: (hs: HandState, seat: number, view: any, d: any) => void) {
  const n = sc.n;
  const btn = btnOf(k, n);
  const bots: Bot[] = [];
  let fi = 0;
  for (let s = 0; s < n; s++) bots.push(s === heroSeat ? heroBot : field[fi++]);
  const h = startHand({
    handNo: k + 1, seed, level: { level: 1, sb: BB / 2, bb: BB, ante: sc.ante * BB }, numSeats: n,
    buttonSeat: btn, sbSeat: n === 2 ? btn : (btn + 1) % n, bbSeat: n === 2 ? 1 - btn : (btn + 2) % n,
    players: stacks.map((st, s) => ({ seat: s, name: bots[s].name, stack: st * BB })),
  });
  runHand(h, (hs, seat) => {
    const view = makePlayerView(hs, seat, n);
    const d = bots[seat].decide(view, decRand);
    onDecide?.(hs, seat, view, d);
    return d;
  }, rs, n);
  bots.forEach((b, s) => b.endHand?.(h, s));
  return { h, btn };
}

// ---------- 보드 유형 ----------
export type Texture = 'dryHigh' | 'dryLow' | 'paired' | 'mono' | 'wet';
export const TEXTURE_NAME: Record<Texture, string> = { dryHigh: '드라이 높은', dryLow: '드라이 낮은', paired: '페어', mono: '한 무늬', wet: '웻(연결·투톤)' };
export function texture(flop: number[]): Texture {
  const r = flop.map((c) => c >> 2).sort((a, b) => b - a), s = flop.map((c) => c & 3);
  if (r[0] === r[1] || r[1] === r[2]) return 'paired';
  if (s[0] === s[1] && s[1] === s[2]) return 'mono';
  const twoTone = s[0] === s[1] || s[1] === s[2] || s[0] === s[2];
  const span = r[0] - r[2];
  const connected = span <= 4 || (r[0] === 12 && r[1] <= 3); // 휠 포함
  if (connected && (twoTone || span <= 3) && r[0] < 12) return 'wet';
  if (connected && twoTone) return 'wet';
  return r[0] >= 10 ? 'dryHigh' : 'dryLow'; // Q 이상
}

// ---------- 주인공 통계 ----------
export type St = Record<string, number>;
export const inc = (s: St, k: string, by = 1) => { s[k] = (s[k] ?? 0) + by; };
export function heroStats(s: St, h: HandState, hero: number, btn: number, n: number) {
  inc(s, 'hands');
  const acts = h.actions as PublicAction[];
  const vol = (a: PublicAction) => !['ante', 'sb', 'bb'].includes(a.type);
  const pos = posName(hero, btn, n);
  let raises = 0, heroOpened = false, faced3 = false, lastAggr = -1, opener = -1, limpers = 0;
  let vpip = false, pfr = false;
  for (const a of acts.filter((x) => x.street === 'preflop' && vol(x))) {
    if (a.seat === hero) {
      // 첫 진입: 아무도 들어오지 않은(모두 폴드) 팟만
      if (raises === 0 && limpers === 0) { inc(s, 'rfiOpp'); inc(s, `rfiOpp:${pos}`); if (a.type === 'raise') { inc(s, 'rfi'); inc(s, `rfi:${pos}`); } if (a.type === 'call') inc(s, 'limp'); }
      if (raises === 1 && !heroOpened) {
        inc(s, '3bOpp'); if (a.type === 'raise') { inc(s, '3b'); if (a.allIn) inc(s, '3bJam'); } if (a.type === 'call') inc(s, 'flat');
        const isBB = h.bbSeat === hero;
        inc(s, isBB ? 'bbOpp' : 'nbOpp'); if (a.type !== 'fold') inc(s, isBB ? 'bbDef' : 'nbIn'); if (a.type === 'call') inc(s, isBB ? 'bbCall' : 'nbFlat'); if (a.type === 'raise') inc(s, isBB ? 'bb3b' : 'nb3b');
      }
      if (raises === 2 && heroOpened && !faced3) { faced3 = true; inc(s, 'f3Opp'); if (a.type === 'fold') inc(s, 'f3'); if (a.type === 'raise') inc(s, '4b'); }
      if (a.type === 'call' || a.type === 'raise') vpip = true;
      if (a.type === 'raise') { pfr = true; if (raises === 0) heroOpened = true; }
      if (a.allIn && (a.type === 'raise' || a.type === 'call')) inc(s, 'preAllIn');
    }
    if (a.type === 'raise' || a.type === 'bet') { raises++; lastAggr = a.seat; if (raises === 1) opener = a.seat; }
    else if (a.type === 'call' && raises === 0) limpers++;
  }
  void opener;
  if (vpip) inc(s, 'vpip');
  if (pfr) inc(s, 'pfr');
  const heroFoldedPre = acts.some((a) => a.street === 'preflop' && a.seat === hero && a.type === 'fold');
  if (heroFoldedPre || h.board.length < 3) return;
  const flop = acts.filter((a) => a.street === 'flop');
  if (!flop.length && h.players.filter((p) => !p.folded).length < 2) return;
  inc(s, 'sawFlop');
  const preIn = new Set(acts.filter((a) => a.street === 'preflop' && (a.type === 'call' || a.type === 'raise' || a.type === 'bb' || a.type === 'sb')).map((a) => a.seat));
  const flopPlayers = new Set(flop.map((a) => a.seat));
  const hu = flopPlayers.size === 2 || (flopPlayers.size === 0 && preIn.size === 2);
  const tex = texture(h.board.slice(0, 3));
  const firstBetIdx = flop.findIndex((a) => a.type === 'bet' || a.type === 'raise');
  const heroFirst = flop.findIndex((a) => a.seat === hero);
  if (hu && heroFirst >= 0) {
    if (lastAggr === hero && (firstBetIdx < 0 || firstBetIdx >= heroFirst)) {
      inc(s, 'cbOpp'); inc(s, `cbOpp:${tex}`);
      if (flop[heroFirst].type === 'bet') { inc(s, 'cb'); inc(s, `cb:${tex}`); }
      // 턴 배럴: 플랍 C벳이 콜받고 턴에서 먼저 벳할 기회
      const turn = acts.filter((a) => a.street === 'turn');
      const fCalled = flop[heroFirst].type === 'bet' && flop.slice(heroFirst + 1).some((a) => a.type === 'call') && !flop.slice(heroFirst + 1).some((a) => a.type === 'raise');
      const tHero = turn.findIndex((a) => a.seat === hero), tBet = turn.findIndex((a) => a.type === 'bet');
      if (fCalled && tHero >= 0 && (tBet < 0 || tBet >= tHero)) { inc(s, 'barrelOpp'); if (turn[tHero].type === 'bet') inc(s, 'barrel'); }
    }
    if (lastAggr !== hero && lastAggr >= 0) {
      // 동크: 레이저 앞(먼저 행동)에서 먼저 벳
      const aggrIdx = flop.findIndex((a) => a.seat === lastAggr);
      if (heroFirst < aggrIdx || aggrIdx < 0) { inc(s, 'donkOpp'); if (flop[heroFirst].type === 'bet') inc(s, 'donk'); }
      if (firstBetIdx >= 0 && flop[firstBetIdx].seat === lastAggr) {
        const resp = flop.slice(firstBetIdx + 1).find((a) => a.seat === hero);
        if (resp) {
          inc(s, 'vsCbOpp'); if (resp.type === 'fold') inc(s, 'foldCb'); if (resp.type === 'raise') inc(s, 'raiseCb');
          if (heroFirst < firstBetIdx && flop[heroFirst].type === 'check') { inc(s, 'xrOpp'); if (resp.type === 'raise') inc(s, 'xr'); }
        }
      }
    }
  }
  for (const a of acts.filter((x) => x.street !== 'preflop' && x.seat === hero)) {
    if (a.type === 'bet' || a.type === 'raise') inc(s, 'aggr');
    if (a.type === 'call') inc(s, 'calls');
  }
  const atSD = !!h.result && !h.result.uncontested && !h.players[hero].folded;
  if (atSD) { inc(s, 'wtsd'); if (h.players[hero].stack > h.players[hero].startStack) inc(s, 'wsd'); }
}

/** 통계 이름 → [분자, 분모] (AF는 특수) */
const RATIO: Record<string, [string, string]> = {
  VPIP: ['vpip', 'hands'], PFR: ['pfr', 'hands'],
  'RFI UTG': ['rfi:UTG', 'rfiOpp:UTG'], 'RFI HJ': ['rfi:HJ', 'rfiOpp:HJ'], 'RFI CO': ['rfi:CO', 'rfiOpp:CO'], 'RFI BTN': ['rfi:BTN', 'rfiOpp:BTN'], 'RFI SB': ['rfi:SB', 'rfiOpp:SB'], 'RFI HU SB': ['rfi:BTN/SB', 'rfiOpp:BTN/SB'],
  림프: ['limp', 'rfiOpp'],
  'BB 수비': ['bbDef', 'bbOpp'], 'BB 3벳': ['bb3b', 'bbOpp'], 'BB 외 플랫': ['nbFlat', 'nbOpp'], 'BB 외 3벳': ['nb3b', 'nbOpp'],
  '3벳에 폴드': ['f3', 'f3Opp'], '4벳': ['4b', 'f3Opp'],
  C벳: ['cb', 'cbOpp'], 'C벳 드라이 높은': ['cb:dryHigh', 'cbOpp:dryHigh'], 'C벳 드라이 낮은': ['cb:dryLow', 'cbOpp:dryLow'], 'C벳 페어': ['cb:paired', 'cbOpp:paired'], 'C벳 한 무늬': ['cb:mono', 'cbOpp:mono'], 'C벳 웻': ['cb:wet', 'cbOpp:wet'],
  '턴 배럴': ['barrel', 'barrelOpp'], 'C벳에 폴드': ['foldCb', 'vsCbOpp'], 체크레이즈: ['xr', 'xrOpp'], 동크: ['donk', 'donkOpp'],
  WTSD: ['wtsd', 'sawFlop'], 'W$SD': ['wsd', 'wtsd'],
};
export function statValue(s: St, name: string): { v: number; n: number } | null {
  if (name === 'AF') return s.calls ? { v: (s.aggr ?? 0) / s.calls, n: s.calls + (s.aggr ?? 0) } : null;
  const r = RATIO[name];
  if (!r || !s[r[1]]) return null;
  return { v: (100 * (s[r[0]] ?? 0)) / s[r[1]], n: s[r[1]] };
}

/**
 * 목표 범위 (레귤러 통계의 일반적인 근사 — 정답이 아니라 '여기서 크게 벗어나면 이상하다'는 울타리).
 *  딥·중간은 6인 캐시/토너 초반 레귤러, 숏은 토너 후반, 헤즈업은 결승 헤즈업 기준
 */
export const BANDS: Record<string, Record<string, [number, number]>> = {
  deep: {
    'RFI UTG': [13, 20], 'RFI HJ': [17, 25], 'RFI CO': [24, 34], 'RFI BTN': [38, 52], 'RFI SB': [30, 48], 림프: [0, 5],
    'BB 수비': [45, 65], 'BB 3벳': [7, 14], 'BB 외 플랫': [3, 11], 'BB 외 3벳': [5, 12], '3벳에 폴드': [38, 55],
    C벳: [50, 72], 'C벳 드라이 높은': [60, 90], 'C벳 드라이 낮은': [42, 72], 'C벳 페어': [55, 88], 'C벳 한 무늬': [28, 58], 'C벳 웻': [32, 62],
    '턴 배럴': [45, 68], 'C벳에 폴드': [33, 50], 체크레이즈: [7, 16], 동크: [2, 12], AF: [1.8, 3.5], WTSD: [24, 33], 'W$SD': [49, 58],
  },
  short: {
    'RFI UTG': [14, 23], 'RFI HJ': [17, 26], 'RFI CO': [22, 34], 'RFI BTN': [35, 55], 'RFI SB': [35, 62], 림프: [0, 8],
    'BB 수비': [50, 75], 'BB 외 플랫': [0, 6], 'BB 외 3벳': [5, 13], '3벳에 폴드': [30, 55],
    C벳: [55, 82], 'C벳에 폴드': [30, 50], AF: [1.5, 4],
  },
  heroShort: { 'RFI UTG': [11, 21], 'RFI BTN': [33, 56], 'RFI SB': [38, 66], 'BB 외 플랫': [0, 3], 'BB 수비': [50, 75] },
  heroBig: { 'RFI UTG': [15, 25], 'RFI CO': [26, 38], 'RFI BTN': [42, 62], 'BB 외 3벳': [7, 15], 'BB 수비': [50, 72], C벳: [55, 82], 'C벳에 폴드': [30, 50], AF: [1.6, 3.5] },
  hu: { 'RFI HU SB': [70, 92], 'BB 수비': [60, 80], 'BB 3벳': [14, 28], '3벳에 폴드': [33, 55], C벳: [55, 82], 'C벳에 폴드': [28, 45], AF: [1.6, 4] },
};
BANDS.mid = { ...BANDS.deep, 'RFI UTG': [14, 21], 'RFI BTN': [40, 55], 'BB 수비': [50, 70], 'BB 외 플랫': [2, 9], 'W$SD': [48, 58] };
BANDS.mixed = { 'BB 외 플랫': [0, 9], 'BB 수비': [50, 72], '3벳에 폴드': [30, 55], C벳: [50, 80], AF: [1.6, 3.8] };

// ---------- 사고 과정 모순 검출 ----------
export const CONTRA: Record<string, string> = {
  foldAbovePrice: '승률이 가격보다 확실히 높은데 폴드(리버 +5%p·그 전 +10%p, 레이즈를 받은 경우·올인급 제외)',
  valueButCheck: "생각이 '밸류 영역'인데 체크",
  rareAction: '확률 15% 미만 행동을 고름(판단과 반대)',
  riverStrongCheck: '리버 승률 85%+인데 먼저 체크',
  callNoEquity: '승률이 가격의 70% 미만인데 콜',
  wetSlowplay: '웻·한 무늬 보드에서 승률 85%+ 패를 먼저 체크(플랍·턴)',
  jamCallBelowPrice: '프리플랍 올인급 콜인데 승률이 가격보다 5%p+ 낮음',
  raiseFoldCheap: '내가 벳·레이즈한 뒤 가격 25% 이하·승률 충분한데 폴드',
  bluffNoBudget: "'벳 영역 밖'이라 해 놓고 벳(블러프 선택 표시 없음)",
  highFreqCheckGood: '레인지 벳 60%+ 판단인데 승률 50%+ 패로 체크 (사용자 신고: K-A-9 KQ C벳 안 함)',
};
export function detect(c: St, view: any, d: any) {
  inc(c, 'decisions');
  const m = d.memo ?? {};
  const eq: number | undefined = m.equity;
  const po: number | undefined = m.potOdds;
  const L = view.legal;
  const street = view.street;
  const th: string[] = m.thoughts ?? [];
  const thought = th.join(' | ');
  // 고른 행동 종류(폴드/체크/콜/레이즈 — 레이즈는 크기 합)의 확률
  const actOf = (key: string) => (key.startsWith('raise') ? 'raise' : key);
  const chosenP = (m.options ?? []).filter((o: any) => actOf(o.key) === d.type).reduce((a: number, o: any) => a + o.p, 0);
  if ((m.options ?? []).length > 1 && chosenP < 0.15) inc(c, 'rareAction');
  const myBetThisStreet = view.actionLog.some((a: any) => a.street === street && a.seat === view.mySeat && (a.type === 'bet' || a.type === 'raise'));
  if (street === 'preflop') {
    if (d.type === 'call' && L.callAmount >= 0.9 * L.stack && eq !== undefined && po !== undefined && eq < po - 0.05) inc(c, 'jamCallBelowPrice');
    return;
  }
  const facing = L.callAmount > 0;
  if (facing && eq !== undefined && po !== undefined) {
    // 리버 전은 실현율 때문에 조금 앞서는 정도는 섞어 접을 수 있음 → +10%p, 리버는 +5%p
    if (d.type === 'fold' && !myBetThisStreet && eq >= po + (street === 'river' ? 0.05 : 0.1) && L.callAmount < 0.5 * L.stack) inc(c, 'foldAbovePrice');
    if (d.type === 'fold' && myBetThisStreet && po <= 0.25 && eq >= po) inc(c, 'raiseFoldCheap');
    if (d.type === 'call' && eq < po * 0.7) inc(c, 'callNoEquity');
  }
  if (!facing) {
    if (d.type === 'check' && /→ 밸류 영역/.test(thought)) inc(c, 'valueButCheck');
    if (d.type === 'raise' && /벳 영역 밖/.test(thought) && !/블러프로 선택/.test(thought)) inc(c, 'bluffNoBudget');
    if (d.type === 'check' && eq !== undefined && eq >= 0.85 && street === 'river') inc(c, 'riverStrongCheck');
    const rb = /레인지 벳 (\d+)%/.exec(thought);
    if (d.type === 'check' && rb && +rb[1] >= 60 && eq !== undefined && eq >= 0.5) inc(c, 'highFreqCheckGood');
    if (d.type === 'check' && eq !== undefined && eq >= 0.85 && street !== 'river') {
      const t = texture(view.board.slice(0, 3));
      if (t === 'wet' || t === 'mono') inc(c, 'wetSlowplay');
    }
  }
}

// ---------- 한 번에 재기 ----------
export interface AuditOut {
  stats: Record<string, St>;
  contra: St; // 전체
  bands: { sc: string; name: string; v: number; lo: number; hi: number; n: number; off: number }[];
  loss: number;
  bb100?: Record<string, number>;
}
/** 상황별로 주인공만 쳐서 통계·모순을 잰다 (같은 시드라 설정만 바꿔 비교 가능) */
export function audit(opts: { scenarios: Scenario[]; hands: number; level?: number; style?: string; seed?: number }): AuditOut {
  const stats: Record<string, St> = {};
  const contra: St = {};
  const lv = opts.level ?? 10;
  for (const sc of opts.scenarios) {
    const si = SCENARIOS.indexOf(sc);
    const R = makeRng((opts.seed ?? 9000) + si * 31);
    const st: St = {};
    let hero = v3Bot(lv, opts.style), field = makeField(sc, 0, 500);
    for (let k = 0; k < opts.hands; k++) {
      if (k > 0 && k % 300 === 0) { hero = v3Bot(lv, opts.style); field = makeField(sc, k / 300, 500 + k); }
      const heroSeat = k % sc.n;
      const seed = R.seedStr();
      const stacks = sc.stacks(heroSeat, R.rand);
      const ds = Math.floor(R.rand() * 1e9);
      const { h, btn } = play(sc, k, seed, stacks, heroSeat, hero, field, makeRng(ds).rand, (_hs, seat, view, d) => { if (seat === heroSeat) detect(contra, view, d); });
      heroStats(st, h, heroSeat, btn, sc.n);
    }
    stats[sc.id] = st;
  }
  // 목표 범위와의 차이: 범위 밖이면 (벗어난 양 / 범위 폭)², 표본이 적으면 가중치를 줄임
  const bands: AuditOut['bands'] = [];
  let loss = 0;
  for (const [sid, st] of Object.entries(stats)) {
    for (const [name, [lo, hi]] of Object.entries(BANDS[sid] ?? {})) {
      const x = statValue(st, name);
      if (!x) continue;
      const w = Math.max(1, hi - lo);
      const off = x.v < lo ? (lo - x.v) / w : x.v > hi ? (x.v - hi) / w : 0;
      const conf = Math.min(1, x.n / 150);
      loss += conf * off * off;
      bands.push({ sc: sid, name, v: x.v, lo, hi, n: x.n, off });
    }
  }
  // 모순은 1000결정당 개수 × 0.05
  const dec = Math.max(1, contra.decisions ?? 1);
  for (const k of Object.keys(CONTRA)) loss += 0.05 * (1000 * (contra[k] ?? 0)) / dec;
  return { stats, contra, bands, loss };
}

export function fmtAudit(a: AuditOut): string {
  const out: string[] = [];
  const dec = Math.max(1, a.contra.decisions ?? 1);
  out.push(`손실 ${a.loss.toFixed(2)}  (범위 밖 통계 + 모순 1000결정당×0.05)`);
  out.push('', '범위 밖 통계:');
  const bad = a.bands.filter((b) => b.off > 0).sort((x, y) => y.off - x.off);
  for (const b of bad) out.push(`  ${b.sc.padEnd(9)} ${b.name.padEnd(12)} ${b.name === 'AF' ? b.v.toFixed(2) : b.v.toFixed(0) + '%'}  (목표 ${b.lo}~${b.hi}, 표본 ${b.n})`);
  if (!bad.length) out.push('  없음');
  out.push('', `사고 과정 모순 (주인공 결정 ${dec}개 중):`);
  for (const [k, desc] of Object.entries(CONTRA)) out.push(`  ${String(a.contra[k] ?? 0).padStart(5)}건 (${((1000 * (a.contra[k] ?? 0)) / dec).toFixed(1)}/1000)  ${desc}`);
  return out.join('\n');
}
