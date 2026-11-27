// AI 전용 대결장 (화면 없음). v3 개발용.
//  --mode vs      : v3 LvX vs v2 레귤러 LvX (Lv10은 v2 솔버) 헤즈업 듀플리케이트 — 퇴보 확인
//  --mode ladder  : v3 레벨끼리 (실력 차이가 드러나는지)
//  --mode ring    : 6인 링 v3×3 vs v2×3 (--opp v3:N 이면 v3 레벨끼리, --style ID 이면 v3 쪽 스타일)
//  --mode log     : 6인 테이블, v3 여러 레벨이 치는 핸드를 생각 과정과 함께 기록 (리뷰어용)
// 예) npx tsx scripts/ai-arena.ts --mode vs --pairs 1500 --levels 3,6,8,10
//     npx tsx scripts/ai-arena.ts --mode ladder --pairs 1500
//     npx tsx scripts/ai-arena.ts --mode log --hands 40 --levels 3,5,7,8,9,10 --out reports/v3-log.md
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as V2 from '../src/ai/v2';
import * as V3 from '../src/ai/v3';
import { cardToString } from '../src/engine/cards';
import { startHand } from '../src/engine/hand';
import { seedFromNumber, seedToString } from '../src/engine/rng';
import type { HandState } from '../src/engine/types';
import { makePlayerView } from '../src/engine/view';
import { newRunStats, runHand, RunStats } from '../src/game/headless';
import { arg, makeRng, mean, pctile, sd, table } from './lib';

const mode = arg('mode', 'vs');
const pairs = +arg('pairs', '1000');
const stackBB = +arg('stack', '100');
/** BB 앤티 (BB 단위, 예: 1 = 빅블라인드가 1BB 앤티) */
const anteBB = +arg('ante', '0');
const BB = 200;
const t0 = Date.now();

/** 한 좌석의 AI: 결정 함수 + 핸드 끝 처리 */
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
function v2Bot(level: number, seedRand: () => number): Bot {
  const id: V2.PersonaId = level >= 10 ? 'solver' : level >= 4 ? 'reg' : 'beginner';
  const prof = V2.makeProfile(id, level, seedRand);
  const mem = V2.newMemory();
  return { name: `v2 ${V2.PERSONAS[id].name} Lv${level}`, decide: (view, rand) => V2.decide(view, prof, mem, { rand, quick: true }) };
}
function shownCards(h: HandState) {
  if (!h.result || h.result.uncontested) return [];
  return h.players.filter((p) => !p.folded).map((p) => ({ seat: p.seat, hole: [p.hole[0], p.hole[1]] as [number, number] }));
}

/** 헤즈업 듀플리케이트: 같은 카드로 자리 바꿔 두 번. A 기준 bb/핸드 */
function duel(mkA: () => Bot, mkB: () => Bot, seedBase: number, rs: RunStats): number[] {
  const out: number[] = [];
  let A = mkA(), B = mkB();
  for (let i = 0; i < pairs; i++) {
    if (i > 0 && i % 500 === 0) { A = mkA(); B = mkB(); }
    const seed = seedToString(seedFromNumber(seedBase * 100000 + i));
    let sum = 0;
    for (const swap of [false, true]) {
      const bots = swap ? [B, A] : [A, B];
      const aSeat = swap ? 1 : 0;
      const ra = makeRng(seedBase * 7919 + i * 2), rb = makeRng(seedBase * 7919 + i * 2 + 1);
      const rands = swap ? [rb.rand, ra.rand] : [ra.rand, rb.rand];
      const h = startHand({
        handNo: i * 2 + (swap ? 1 : 0) + 1, seed, level: { level: 1, sb: BB / 2, bb: BB, ante: anteBB * BB }, numSeats: 2,
        buttonSeat: 0, sbSeat: 0, bbSeat: 1,
        players: [0, 1].map((s) => ({ seat: s, name: 'P' + s, stack: stackBB * BB })),
      });
      runHand(h, (hs, seat) => bots[seat].decide(makePlayerView(hs, seat, 2), rands[seat]), rs, 2);
      bots.forEach((b, s) => b.endHand?.(h, s));
      const p = h.players.find((x) => x.seat === aSeat)!;
      sum += (p.stack - p.startStack) / BB;
    }
    out.push(sum / 2);
  }
  return out;
}

function summarize(res: number[]) {
  const m = mean(res) * 100, se = (sd(res) / Math.sqrt(res.length)) * 100;
  return { bb100: m, ci: `[${(m - 1.96 * se).toFixed(1)}, ${(m + 1.96 * se).toFixed(1)}]`, sig: m - 1.96 * se > 0 ? '우세(유의)' : m + 1.96 * se < 0 ? '열세(유의)' : '차이 불확실' };
}

function timing(rs: RunStats) {
  const all = rs.calcMs;
  const by = Object.entries(rs.calcMsByStreet).map(([k, v]) => `${k} 평균 ${mean(v).toFixed(1)}ms/p95 ${pctile(v, 0.95).toFixed(1)}ms`).join(', ');
  return `판단 시간 평균 ${mean(all).toFixed(1)}ms, p95 ${pctile(all, 0.95).toFixed(1)}ms, 최대 ${all.reduce((a, b) => Math.max(a, b), 0).toFixed(0)}ms (${by})`;
}
function problems(rs: RunStats) {
  const f = Object.entries(rs.forbidden);
  return rs.illegal || rs.chipErrors || f.length ? `⚠ 규칙 위반 ${rs.illegal}, 칩 오류 ${rs.chipErrors}, 금지 행동 ${JSON.stringify(rs.forbidden)}` : '규칙 위반·칩 오류·금지 행동 0건';
}

if (mode === 'vs') {
  const levels = arg('levels', '3,6,8,10').split(',').map(Number);
  const rs = newRunStats();
  const R = makeRng(5);
  const rows = levels.map((lv, i) => {
    const s = summarize(duel(() => v3Bot(lv), () => v2Bot(lv, R.rand), 300 + i, rs));
    return [`v3 Lv${lv} vs ${v2Bot(lv, R.rand).name}`, s.bb100, s.ci, s.sig.replace('우세', 'v3 우세').replace('열세', 'v3 열세')];
  });
  console.log(`=== v3 vs v2 (헤즈업 ${stackBB}BB, 매치당 ${pairs}쌍) — v3 기준 bb/100 ===`);
  console.log(table(rows, ['대결', 'bb/100', '95% 신뢰구간', '판정']));
  console.log(problems(rs));
  console.log(timing(rs));
} else if (mode === 'ladder') {
  const matchups = (arg('pairsOf', '2-5,5-8,8-10,4-10,7-9')).split(',').map((x) => x.split('-').map(Number));
  const rs = newRunStats();
  const rows = matchups.map(([a, b], i) => {
    const s = summarize(duel(() => v3Bot(b), () => v3Bot(a), 600 + i, rs));
    return [`v3 Lv${b} vs Lv${a}`, s.bb100, s.ci, s.sig.replace('우세', `Lv${b} 우세`).replace('열세', `Lv${b} 열세`)];
  });
  console.log(`=== v3 레벨 서열 (헤즈업 ${stackBB}BB, 매치당 ${pairs}쌍) — 높은 레벨 기준 bb/100 ===`);
  console.log(table(rows, ['대결', 'bb/100', '95% 신뢰구간', '판정']));
  console.log(problems(rs));
  console.log(timing(rs));
} else if (mode === 'ring') {
  // 6인 링: v3와 v2가 번갈아 앉고, 좌석별 스택은 --stackRange 안에서 무작위(토너먼트처럼 깊이가 섞임).
  //  같은 카드·같은 스택으로 v3/v2 자리를 바꿔 한 번 더 (듀플리케이트). v3 쪽 합계 BB/100핸드
  const lvl = +arg('level', '10');
  const [lo, hi] = arg('stackRange', '8-40').split('-').map(Number);
  const hands = +arg('hands', '3000');
  const R = makeRng(41);
  const rs = newRunStats();
  const res: number[] = [];
  const n = 6;
  const oppArg = arg('opp', 'v2');
  const oppBot = () => (oppArg.startsWith('v3:') ? v3Bot(+oppArg.split(':')[1]) : v2Bot(lvl, R.rand));
  const styleArg = arg('style', '') || undefined;
  let v3s = [0, 2, 4].map(() => v3Bot(lvl, styleArg)), v2s = [1, 3, 5].map(oppBot);
  for (let k = 0; k < hands; k++) {
    if (k > 0 && k % 400 === 0) { v3s = [0, 2, 4].map(() => v3Bot(lvl, styleArg)); v2s = [1, 3, 5].map(oppBot); }
    const seed = R.seedStr();
    const sts = Array.from({ length: n }, () => Math.round(lo + R.rand() * (hi - lo)));
    const btn = k % n;
    let sum = 0;
    for (const swap of [false, true]) {
      const bots = Array.from({ length: n }, (_, s) => ((s % 2 === 0) !== swap ? v3s[Math.floor(s / 2)] : v2s[Math.floor(s / 2)]));
      const isV3 = (s: number) => (s % 2 === 0) !== swap;
      const ra = makeRng(k * 13 + 1);
      const h = startHand({
        handNo: k * 2 + (swap ? 1 : 0) + 1, seed, level: { level: 1, sb: BB / 2, bb: BB, ante: anteBB * BB }, numSeats: n,
        buttonSeat: btn, sbSeat: (btn + 1) % n, bbSeat: (btn + 2) % n,
        players: sts.map((st, s) => ({ seat: s, name: 'P' + s, stack: st * BB })),
      });
      runHand(h, (hs, seat) => bots[seat].decide(makePlayerView(hs, seat, n), ra.rand), rs, n);
      bots.forEach((b, s) => b.endHand?.(h, s));
      for (const p of h.players) if (isV3(p.seat)) sum += (p.stack - p.startStack) / BB;
    }
    res.push(sum / 2);
  }
  const s = summarize(res);
  console.log(`=== 6인 링 v3 Lv${lvl}${styleArg ? ' ' + styleArg : ''} ×3 vs ${oppArg === "v2" ? "v2 Lv" + lvl : oppArg} ×3 (스택 ${lo}~${hi}BB 무작위${anteBB ? ', BB 앤티 ' + anteBB + 'BB' : ''}, ${hands}핸드×2) — v3 3명 합계 BB/100핸드 ===`);
  console.log(`${s.bb100.toFixed(1)} ${s.ci} ${s.sig.replace('우세', 'v3 우세').replace('열세', 'v3 열세')}`);
  console.log(problems(rs));
  console.log(timing(rs));
} else if (mode === 'log') {
  // 6인 테이블 핸드 기록 (생각 과정 포함). 리뷰어가 읽기 좋게 마크다운
  const hands = +arg('hands', '40');
  const levels = arg('levels', '3,5,7,8,9,10').split(',').map(Number);
  const out = arg('out', 'reports/v3-log.md');
  const seedN = +arg('seed', '1');
  const R = makeRng(seedN);
  const bots = levels.map((lv) => v3Bot(lv));
  const n = bots.length;
  const lines: string[] = [`# v3 핸드 기록 (${n}인, 시작 ${arg('stacks', '') ? '좌석별 ' + arg('stacks', '') + 'BB(핸드마다 한 칸씩 회전)' : stackBB + 'BB'}${anteBB ? `, BB 앤티 ${anteBB}BB` : ''}, seed ${seedN})`, '', `좌석: ${bots.map((b, i) => `${i}번=${b.name}`).join(', ')}`, ''];
  const rs = newRunStats();
  const stacks = bots.map(() => 0);
  // --stacks 8,15,25,40,60,100 : 좌석별 시작 스택(BB). 핸드마다 한 칸씩 돌려 여러 스택 상황이 나오게
  const seatStacks = arg('stacks', '') ? arg('stacks', '').split(',').map(Number) : null;
  const cs = (c: number) => cardToString(c);
  for (let k = 0; k < hands; k++) {
    const btn = k % n;
    const h = startHand({
      handNo: k + 1, seed: R.seedStr(), level: { level: 1, sb: BB / 2, bb: BB, ante: anteBB * BB }, numSeats: n,
      buttonSeat: btn, sbSeat: (btn + 1) % n, bbSeat: (btn + 2) % n,
      players: bots.map((b, s) => ({ seat: s, name: b.name, stack: (seatStacks ? seatStacks[(s + k) % seatStacks.length] : stackBB) * BB })),
    });
    const log: string[] = [];
    runHand(h, (hs, seat) => {
      const view = makePlayerView(hs, seat, n);
      const d = bots[seat].decide(view, R.rand);
      if (hs.street !== 'preflop' || d.type !== 'fold') {
        const board = view.board.map(cs).join(' ');
        const act = d.type === 'raise' ? `${view.legal.currentBet > 0 ? '레이즈' : '벳'} ${(d.to / BB).toFixed(1)}BB` : ({ fold: '폴드', check: '체크', call: `콜 ${(view.legal.callAmount / BB).toFixed(1)}BB` } as any)[d.type];
        log.push(`- **${hs.street}** ${board ? `[${board}] ` : ''}${seat}번 ${bots[seat].name} (${view.holeCards.map(cs).join('')}, 팟 ${(view.potTotal / BB).toFixed(1)}BB) → **${act}**${d.memo.intent && d.memo.intent !== 'none' ? ` _(${V3.intentName(d.memo.intent)})_` : ''}`);
        for (const t of d.memo.thoughts ?? []) log.push(`  - ${t}`);
        const opts = d.memo.options.filter((o: any) => o.p > 0).map((o: any) => `${o.key} ${(o.p * 100).toFixed(0)}%`).join(', ');
        log.push(`  - 확률: ${opts}`);
      }
      return d;
    }, rs, n);
    bots.forEach((b, s) => b.endHand?.(h, s));
    const res = h.players.map((p) => `${p.seat}번 ${p.stack - p.startStack >= 0 ? '+' : ''}${((p.stack - p.startStack) / BB).toFixed(1)}`).filter((_, i) => h.players[i].stack !== h.players[i].startStack);
    if (log.length === 0) continue; // 모두 프리플랍 폴드(블라인드만)는 생략
    const shown = shownCards(h).map((s) => `${s.seat}번 ${s.hole.map(cs).join('')}`).join(', ');
    lines.push(`## 핸드 ${k + 1} (버튼 ${btn}번)`, ...log, `- 결과: ${res.join(', ')}${shown ? ` · 쇼다운 ${shown}` : ''} · 보드 ${h.board.map(cs).join(' ')}`, '');
    h.players.forEach((p, s) => (stacks[s] += p.stack - p.startStack));
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n'));
  console.log(`기록 저장: ${out} (${hands}핸드)`);
  console.log('누적 결과(BB): ' + bots.map((b, s) => `${b.name} ${(stacks[s] / BB).toFixed(0)}`).join(', '));
  console.log(problems(rs));
  console.log(timing(rs));
}
console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(0)}초`);
