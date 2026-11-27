// 상황별 시험장 (최고 레벨 봇 성능 끌어올리기용, 화면 없음)
//  흔한 토너먼트 상황(딥스택·중간·숏스택·나만 숏스택·나만 빅스택·스택 섞임·헤즈업)을 만들고
//  주인공(v3 최고 레벨)을 한 자리에 앉혀 고정된 상대들(v2 여러 성향 — 코드가 바뀌어도 그대로)과 친다.
//
//  --mode score : 같은 카드·같은 스택·같은 자리를 '주인공'과 '기준 봇(v2 솔버 Lv10)'이 각각 한 번씩 친다 (듀플리케이트).
//                 주인공 − 기준 = 그 자리에서 기준보다 몇 BB 더 벌었나. 상황별 bb/100 + 주인공 통계(VPIP·PFR·3벳·C벳 …)
//  --mode log   : 상황별로 주인공이 참여한 핸드를 생각 과정과 함께 기록 (리뷰어용, 토큰 아끼려고 주인공 결정만 자세히)
//
// 예) npx tsx scripts/ai-situations.ts --mode score --hands 1500
//     npx tsx scripts/ai-situations.ts --mode score --hands 1500 --only short,heroShort
//     npx tsx scripts/ai-situations.ts --mode log --hands 14 --out reports/sit-log.md
//     (--level 10 --style lag : 주인공 레벨·스타일)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as V2 from '../src/ai/v2';
import * as V3 from '../src/ai/v3';
import { cardToString } from '../src/engine/cards';
import { startHand } from '../src/engine/hand';
import type { HandState, PublicAction } from '../src/engine/types';
import { makePlayerView } from '../src/engine/view';
import { newRunStats, runHand } from '../src/game/headless';
import { arg, makeRng, mean, sd, table } from './lib';

const BB = 200;
const mode = arg('mode', 'score');
const heroLevel = +arg('level', '10');
const heroStyle = arg('style', '') || undefined;
const t0 = Date.now();

interface Bot { name: string; decide: (view: any, rand: () => number) => any; endHand?: (h: HandState, seat: number) => void }
function v3Bot(level: number, style?: string): Bot {
  const prof = V3.makeProfileV3(level, style);
  const mem = V3.newMemoryV3();
  return {
    name: `v3 Lv${level}${style ? ' ' + style : ''}`,
    decide: (view, rand) => V3.decide(view, prof, mem, { rand, quick: true }),
    endHand: () => V3.endHandV3(mem),
  };
}
function v2Bot(id: V2.PersonaId, level: number, seed: number): Bot {
  const r = makeRng(seed);
  const prof = V2.makeProfile(id, level, r.rand);
  const mem = V2.newMemory();
  return { name: `v2 ${V2.PERSONAS[id].name} Lv${level}`, decide: (view, rand) => V2.decide(view, prof, mem, { rand, quick: true }) };
}
function shown(h: HandState) {
  if (!h.result || h.result.uncontested) return [];
  return h.players.filter((p) => !p.folded).map((p) => ({ seat: p.seat, hole: [p.hole[0], p.hole[1]] as [number, number] }));
}

// ---------- 상황 ----------
interface Scenario { id: string; name: string; n: number; ante: number; stacks: (hero: number, r: () => number) => number[] }
const U = (r: () => number, a: number, b: number) => Math.round(a + r() * (b - a));
const SCENARIOS: Scenario[] = [
  { id: 'deep', name: '딥스택 (전원 120~180BB, 앤티 없음)', n: 6, ante: 0, stacks: (_h, r) => Array.from({ length: 6 }, () => U(r, 120, 180)) },
  { id: 'mid', name: '중간 스택 (전원 40~70BB)', n: 6, ante: 1, stacks: (_h, r) => Array.from({ length: 6 }, () => U(r, 40, 70)) },
  { id: 'short', name: '모두 숏스택 (전원 10~25BB)', n: 6, ante: 1, stacks: (_h, r) => Array.from({ length: 6 }, () => U(r, 10, 25)) },
  { id: 'heroShort', name: '나만 숏스택 (나 8~16BB, 상대 35~80BB)', n: 6, ante: 1, stacks: (h, r) => Array.from({ length: 6 }, (_, s) => (s === h ? U(r, 8, 16) : U(r, 35, 80))) },
  { id: 'heroBig', name: '나만 빅스택 (나 90~130BB, 상대 15~35BB)', n: 6, ante: 1, stacks: (h, r) => Array.from({ length: 6 }, (_, s) => (s === h ? U(r, 90, 130) : U(r, 15, 35))) },
  { id: 'mixed', name: '스택 섞임 (8·15·25·40·60·100BB 무작위 배치)', n: 6, ante: 1, stacks: (_h, r) => shuffle([8, 15, 25, 40, 60, 100], r) },
  { id: 'hu', name: '헤즈업 (각 15~45BB)', n: 2, ante: 1, stacks: (_h, r) => [U(r, 15, 45), U(r, 15, 45)] },
];
function shuffle<T>(a: T[], r: () => number) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** 고정 상대들 (v2, 바뀌지 않음): 레귤러·솔버·공격수·콜스테이션·바위·막 지르는 */
const FIELD: [V2.PersonaId, number][] = [['reg', 8], ['solver', 9], ['lag', 7], ['station', 5], ['nit', 6], ['maniac', 5]];
function makeField(sc: Scenario, k: number, seedBase: number): Bot[] {
  if (sc.n === 2) return [k % 2 === 0 ? v2Bot('reg', 8, seedBase) : v2Bot('solver', 9, seedBase)];
  return Array.from({ length: sc.n - 1 }, (_, i) => { const [id, l] = FIELD[(i + k) % FIELD.length]; return v2Bot(id, l, seedBase + i); });
}

function posName(seat: number, btn: number, n: number): string {
  const off = (seat - btn + n) % n;
  if (n === 2) return off === 0 ? 'BTN/SB' : 'BB';
  return ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'][off] ?? `+${off}`;
}

/** 한 핸드 진행. hero 자리에 heroBot, 나머지는 field (순서대로) */
function play(sc: Scenario, k: number, seed: string, stacks: number[], heroSeat: number, heroBot: Bot, field: Bot[], decRand: () => number, onDecide?: (hs: HandState, seat: number, view: any, d: any) => void) {
  const n = sc.n;
  // 주인공 자리는 k % n, 버튼은 floor(k / n) % n → n×n 핸드마다 주인공이 모든 포지션을 고르게 돈다
  const btn = Math.floor(k / n) % n;
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
const rs = newRunStats();

// ---------- 주인공 통계 ----------
interface St { [k: string]: number }
function newSt(): St { return {}; }
function inc(s: St, k: string, by = 1) { s[k] = (s[k] ?? 0) + by; }
function heroStats(s: St, h: HandState, hero: number) {
  inc(s, 'hands');
  const acts = h.actions as PublicAction[];
  const vol = (a: PublicAction) => !['ante', 'sb', 'bb'].includes(a.type);
  // 프리플랍
  let raises = 0, heroOpened = false, faced3 = false, lastAggr = -1;
  let vpip = false, pfr = false;
  for (const a of acts.filter((x) => x.street === 'preflop' && vol(x))) {
    if (a.seat === hero) {
      if (raises === 0) { inc(s, 'rfiOpp'); if (a.type === 'raise') inc(s, 'rfi'); if (a.type === 'call') inc(s, 'limp'); }
      if (raises === 1 && !heroOpened) {
        inc(s, '3bOpp'); if (a.type === 'raise') { inc(s, '3b'); if (a.allIn) inc(s, '3bJam'); } if (a.type === 'call') inc(s, 'flat');
        const isBB = h.bbSeat === hero;
        inc(s, isBB ? 'bbOpp' : 'nbOpp'); if (a.type !== 'fold') inc(s, isBB ? 'bbDef' : 'nbIn'); if (a.type === 'call') inc(s, isBB ? 'bbCall' : 'nbFlat');
      }
      if (raises === 2 && heroOpened && !faced3) { faced3 = true; inc(s, 'f3Opp'); if (a.type === 'fold') inc(s, 'f3'); if (a.type === 'raise') inc(s, '4b'); }
      if (a.type === 'call' || a.type === 'raise') vpip = true;
      if (a.type === 'raise') { pfr = true; if (raises === 0) heroOpened = true; }
      if (a.allIn && (a.type === 'raise' || a.type === 'call')) inc(s, 'preAllIn');
    }
    if (a.type === 'raise' || a.type === 'bet') { raises++; lastAggr = a.seat; }
  }
  if (vpip) inc(s, 'vpip');
  if (pfr) inc(s, 'pfr');
  // 플랍 이후
  const sawFlop = acts.some((a) => a.street === 'flop') || (h.board.length >= 3 && !h.players[hero].folded && h.players.filter((p) => !p.folded).length > 1);
  const heroFoldedPre = acts.some((a) => a.street === 'preflop' && a.seat === hero && a.type === 'fold');
  if (sawFlop && !heroFoldedPre && h.board.length >= 3) {
    inc(s, 'sawFlop');
    const flop = acts.filter((a) => a.street === 'flop');
    const firstBetIdx = flop.findIndex((a) => a.type === 'bet' || a.type === 'raise');
    const heroFirst = flop.findIndex((a) => a.seat === hero);
    if (lastAggr === hero && heroFirst >= 0 && (firstBetIdx < 0 || firstBetIdx >= heroFirst)) { inc(s, 'cbOpp'); if (flop[heroFirst].type === 'bet') inc(s, 'cb'); }
    if (lastAggr !== hero && lastAggr >= 0 && firstBetIdx >= 0 && flop[firstBetIdx].seat === lastAggr) {
      const resp = flop.slice(firstBetIdx + 1).find((a) => a.seat === hero);
      if (resp) { inc(s, 'vsCbOpp'); if (resp.type === 'fold') inc(s, 'foldCb'); if (resp.type === 'raise') inc(s, 'raiseCb'); }
    }
    for (const a of acts.filter((x) => x.street !== 'preflop' && x.seat === hero)) {
      if (a.type === 'bet' || a.type === 'raise') inc(s, 'aggr');
      if (a.type === 'call') inc(s, 'calls');
      if (a.type === 'check') inc(s, 'checks');
      if (a.type === 'fold') inc(s, 'postFolds');
    }
    const atSD = !!h.result && !h.result.uncontested && !h.players[hero].folded;
    if (atSD) { inc(s, 'wtsd'); if (h.players[hero].stack > h.players[hero].startStack) inc(s, 'wsd'); }
  }
}
function fmtStats(s: St) {
  const p = (a: string, b: string) => (s[b] ? `${((100 * (s[a] ?? 0)) / s[b]).toFixed(0)}%` : '-');
  const af = s.calls ? ((s.aggr ?? 0) / s.calls).toFixed(1) : '-';
  return `VPIP ${p('vpip', 'hands')} · PFR ${p('pfr', 'hands')} · 첫 진입 레이즈 ${p('rfi', 'rfiOpp')} (림프 ${p('limp', 'rfiOpp')}) · 3벳 ${p('3b', '3bOpp')}(올인 ${p('3bJam', '3bOpp')}) / 콜 ${p('flat', '3bOpp')} [BB 수비 ${p('bbDef', 'bbOpp')}·콜 ${p('bbCall', 'bbOpp')} / BB 외 참여 ${p('nbIn', 'nbOpp')}·플랫 ${p('nbFlat', 'nbOpp')}] ·3벳에 폴드 ${p('f3', 'f3Opp')} / 4벳 ${p('4b', 'f3Opp')} · 프리플랍 올인 ${p('preAllIn', 'hands')} · C벳 ${p('cb', 'cbOpp')} · C벳에 폴드 ${p('foldCb', 'vsCbOpp')} / 레이즈 ${p('raiseCb', 'vsCbOpp')} · AF ${af} · WTSD ${p('wtsd', 'sawFlop')} · W$SD ${p('wsd', 'wtsd')}`;
}

const only = arg('only', '') ? arg('only', '').split(',') : null;
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));

if (mode === 'score') {
  const hands = +arg('hands', '1500');
  const rows: (string | number)[][] = [];
  const statLines: string[] = [];
  const allDiff: number[] = [];
  for (const sc of scenarios) {
    const si = SCENARIOS.indexOf(sc); // --only 를 써도 같은 상황은 같은 시드
    const R = makeRng(9000 + si * 31);
    const diff: number[] = [], heroRes: number[] = [], refRes: number[] = [];
    const st = newSt();
    let hero = v3Bot(heroLevel, heroStyle), ref = v2Bot('solver', 10, 77);
    let fieldA = makeField(sc, 0, 500), fieldB = makeField(sc, 0, 500);
    for (let k = 0; k < hands; k++) {
      if (k > 0 && k % 300 === 0) { hero = v3Bot(heroLevel, heroStyle); ref = v2Bot('solver', 10, 77 + k); fieldA = makeField(sc, k / 300, 500 + k); fieldB = makeField(sc, k / 300, 500 + k); }
      const heroSeat = k % sc.n;
      const seed = R.seedStr();
      const stacks = sc.stacks(heroSeat, R.rand);
      const ds = Math.floor(R.rand() * 1e9);
      const a = play(sc, k, seed, stacks, heroSeat, hero, fieldA, makeRng(ds).rand);
      const b = play(sc, k, seed, stacks, heroSeat, ref, fieldB, makeRng(ds).rand);
      const ra = (a.h.players[heroSeat].stack - a.h.players[heroSeat].startStack) / BB;
      const rb = (b.h.players[heroSeat].stack - b.h.players[heroSeat].startStack) / BB;
      heroRes.push(ra); refRes.push(rb); diff.push(ra - rb);
      heroStats(st, a.h, heroSeat);
    }
    const m = mean(diff) * 100, se = (sd(diff) / Math.sqrt(diff.length)) * 100;
    allDiff.push(...diff);
    rows.push([sc.name, +(mean(heroRes) * 100).toFixed(1), +(mean(refRes) * 100).toFixed(1), +m.toFixed(1), `[${(m - 1.96 * se).toFixed(1)}, ${(m + 1.96 * se).toFixed(1)}]`]);
    statLines.push(`- ${sc.id}: ${fmtStats(st)}`);
  }
  const m = mean(allDiff) * 100, se = (sd(allDiff) / Math.sqrt(allDiff.length)) * 100;
  console.log(`=== 상황별 시험: 주인공 v3 Lv${heroLevel}${heroStyle ? ' ' + heroStyle : ''} vs 기준 v2 솔버 Lv10 (같은 카드·자리, 상황당 ${hands}핸드) — bb/100 ===`);
  console.log(table(rows, ['상황', '주인공', '기준', '차이', '95% 신뢰구간']));
  console.log(`전체 차이 ${m.toFixed(1)} bb/100 [${(m - 1.96 * se).toFixed(1)}, ${(m + 1.96 * se).toFixed(1)}]`);
  console.log('\n주인공 통계:');
  console.log(statLines.join('\n'));
  const f = Object.entries(rs.forbidden);
  console.log(rs.illegal || rs.chipErrors || f.length ? `⚠ 규칙 위반 ${rs.illegal}, 칩 오류 ${rs.chipErrors}, 금지 행동 ${JSON.stringify(rs.forbidden)}` : '규칙 위반·칩 오류·금지 행동 0건');
} else if (mode === 'log') {
  // 주인공이 자발적으로 참여한 핸드만 (상황당 --hands 개까지), 상대 행동은 한 줄씩, 주인공 결정은 생각 과정까지
  const want = +arg('hands', '14');
  const out = arg('out', 'reports/sit-log.md');
  const seedN = +arg('seed', '1');
  const cs = (c: number) => cardToString(c);
  const lines: string[] = [`# 상황별 핸드 기록 — 주인공 v3 Lv${heroLevel}${heroStyle ? ' ' + heroStyle : ''} (seed ${seedN})`, '',
    '상대는 고정된 v2 봇들(레귤러 Lv8·솔버 Lv9·공격수 Lv7·끝까지 간다(콜스테이션) Lv5·바위 Lv6·올인맨(매니악) Lv5, 헤즈업은 레귤러/솔버). 스택은 핸드 시작 기준 BB. 주인공(★) 결정 아래 줄이 생각 과정.', ''];
  const statLines: string[] = [];
  for (const sc of scenarios) {
    const si = SCENARIOS.indexOf(sc);
    const R = makeRng(seedN * 1000 + si * 17);
    const hero = v3Bot(heroLevel, heroStyle);
    const st = newSt();
    lines.push(`# 상황: ${sc.name}`, '');
    let got = 0;
    for (let k = 0; k < 400 && got < want; k++) {
      const heroSeat = k % sc.n;
      const seed = R.seedStr();
      const stacks = sc.stacks(heroSeat, R.rand);
      const field = makeField(sc, k, 700 + k);
      const log: string[] = [];
      let lastStreet = '';
      let heroActed = false;
      const btn = Math.floor(k / sc.n) % sc.n;
      const { h } = play(sc, k, seed, stacks, heroSeat, hero, field, makeRng(seedN * 7 + k).rand, (hs, seat, view, d) => {
        const street = hs.street;
        if (street !== lastStreet) { lastStreet = street; log.push(`- **${street}**${view.board.length ? ` [${view.board.map(cs).join(' ')}]` : ''} 팟 ${(view.potTotal / BB).toFixed(1)}BB`); }
        const act = d.type === 'raise' ? `${view.legal.currentBet > 0 ? '레이즈' : '벳'} ${(d.to / BB).toFixed(1)}BB${d.to >= view.legal.maxRaiseTo ? '(올인)' : ''}` : ({ fold: '폴드', check: '체크', call: `콜 ${(view.legal.callAmount / BB).toFixed(1)}BB` } as any)[d.type];
        const who = `${posName(seat, btn, sc.n)}`;
        if (seat === heroSeat) {
          // 기록할 핸드: 주인공이 폴드 말고 다른 걸 했거나, 폴드했어도 다른 행동 확률이 15% 이상이었던(고민한) 경우
          if (d.type !== 'fold' || d.memo.options.some((o: any) => o.key !== 'fold' && o.p >= 0.15)) heroActed = true;
          log.push(`  - ★ ${who} (${view.holeCards.map(cs).join('')}) → **${act}**${d.memo.intent && d.memo.intent !== 'none' ? ` _(${V3.intentName(d.memo.intent)})_` : ''}`);
          for (const t of d.memo.thoughts ?? []) log.push(`    - ${t}`);
          log.push(`    - 확률: ${d.memo.options.filter((o: any) => o.p > 0).map((o: any) => `${o.key.startsWith('raise:') ? 'R' + (+o.key.slice(6) / BB).toFixed(1) : o.key} ${(o.p * 100).toFixed(0)}%`).join(', ')}`);
        } else if (!(street === 'preflop' && d.type === 'fold') && !hs.players[heroSeat].folded) {
          log.push(`  - ${who} ${bots(field, seat, heroSeat).name}: ${act}`);
        }
      });
      heroStats(st, h, heroSeat);
      if (!heroActed) continue;
      got++;
      const hp = h.players[heroSeat];
      const shownStr = shown(h).filter((x) => x.seat !== heroSeat).map((x) => `${posName(x.seat, btn, sc.n)} ${x.hole.map(cs).join('')}`).join(', ');
      lines.push(`## ${sc.id}-${got} · 주인공 ${posName(heroSeat, btn, sc.n)} ${stacks[heroSeat]}BB · 스택 ${stacks.map((x, s) => `${posName(s, btn, sc.n)} ${x}`).join(' / ')}`, ...log,
        `- 결과: 주인공 ${hp.stack >= hp.startStack ? '+' : ''}${((hp.stack - hp.startStack) / BB).toFixed(1)}BB${shownStr ? ` · 상대 공개 ${shownStr}` : ''} · 보드 ${h.board.map(cs).join(' ') || '-'}`, '');
    }
    statLines.push(`- ${sc.id}: ${fmtStats(st)}`);
  }
  lines.push('# 참고: 기록 구간 주인공 통계 (표본 작음)', ...statLines);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n'));
  console.log(`기록 저장: ${out}`);
}
console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(0)}초`);

function bots(field: Bot[], seat: number, heroSeat: number): Bot { return field[seat < heroSeat ? seat : seat - 1]; }
