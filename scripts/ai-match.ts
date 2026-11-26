// 듀플리케이트 대결 (overview 3.14 ②). 같은 카드 배열로 좌석만 바꿔 두 번 → 패 운 상쇄
// 실행: npm run ai:match [-- --pairs 1500 --stack 100]
import { writeFileSync, mkdirSync } from 'node:fs';
import { decide, makeProfile, newMemory, PERSONAS } from '../src/ai/v2';
import type { AiProfile, PersonaId } from '../src/ai/v2';

import { startHand } from '../src/engine/hand';
import { seedToString, seedFromNumber } from '../src/engine/rng';
import { makePlayerView } from '../src/engine/view';
import { newRunStats, runHand } from '../src/game/headless';
import { arg, flag, makeRng, mean, sd, table } from './lib';

const pairs = +arg('pairs', '1500');
const stackBB = +arg('stack', '100');
const BB = 200;

/** A 기준 bb/핸드 결과 (듀플리케이트 쌍 합) */
type Prof = AiProfile | (() => AiProfile);
const get = (p: Prof) => (typeof p === 'function' ? p() : p);
type Decider = (view: any, prof: any, mem: any, opts: any) => any;
function duel(pa: Prof, pb: Prof, seedBase: number, da: Decider = decide, db: Decider = decide): number[] {
  let a = get(pa), b = get(pb);
  const out: number[] = [];
  const rs = newRunStats();
  for (let i = 0; i < pairs; i++) {
    // 1000쌍마다 같은 성향·레벨의 새 개인(습관·실수 뽑기가 다름)으로 교체 → 한 번의 뽑기 운에 좌우되지 않게
    if (i > 0 && i % 1000 === 0) { a = get(pa); b = get(pb); }
    const seed = seedToString(seedFromNumber(seedBase * 100000 + i));
    let pairSum = 0;
    for (const swap of [false, true]) {
      const profs = swap ? [b, a] : [a, b];
      const decs = swap ? [db, da] : [da, db];
      const aSeat = swap ? 1 : 0;
      // 각 AI의 난수 흐름을 좌석과 무관하게 같게 → 같은 상황이면 같은 선택 (운 추가 상쇄)
      const ra = makeRng(seedBase * 7919 + i * 2), rb = makeRng(seedBase * 7919 + i * 2 + 1);
      const rands = swap ? [rb.rand, ra.rand] : [ra.rand, rb.rand];
      const h = startHand({
        handNo: i + 1, seed, level: { level: 1, sb: BB / 2, bb: BB, ante: 0 }, numSeats: 2,
        buttonSeat: 0, sbSeat: 0, bbSeat: 1,
        players: [0, 1].map((s) => ({ seat: s, name: 'P' + s, stack: stackBB * BB })),
      });
      const mems = [newMemory(), newMemory()];
      runHand(h, (hs, seat) => decs[seat](makePlayerView(hs, seat, 2), profs[seat], mems[seat], { rand: rands[seat], quick: true, recallEnabled: false }), rs, 2);
      const p = h.players.find((x) => x.seat === aSeat)!;
      pairSum += (p.stack - p.startStack) / BB;
    }
    out.push(pairSum / 2);
  }
  if (rs.illegal || rs.chipErrors || Object.keys(rs.forbidden).length) console.log('  ⚠ 규칙/금지 행동 이상:', rs.illegal, rs.chipErrors, rs.forbidden);
  return out;
}

function summarize(res: number[]) {
  const m = mean(res) * 100; // bb/100
  const se = (sd(res) / Math.sqrt(res.length)) * 100;
  return { bb100: m, lo: m - 1.96 * se, hi: m + 1.96 * se, sig: m - 1.96 * se > 0 ? '우세(유의)' : m + 1.96 * se < 0 ? '열세(유의)' : '차이 불확실' };
}

const t0 = Date.now();
const R0 = makeRng(99);
const mk = (id: PersonaId, lv: number) => () => makeProfile(id, lv, R0.rand);
console.log(`=== 듀플리케이트 대결: 매치당 ${pairs}쌍(${pairs * 2}핸드), 헤즈업 ${stackBB}BB ===\n`);

// v2 vs v3 비교는 scripts/ai-arena.ts

// 1) 성향 서열: 기준 상대(레귤러 Lv6) 대비
const baseline = mk('reg', 6);
const lineup: [PersonaId, number][] = [['solver', 10], ['reg', 8], ['lag', 8], ['nit', 6], ['maniac', 4], ['station', 3], ['beginner', 2]];
const rows: any[] = [];
const rank: any[] = [];
lineup.forEach(([id, lv], i) => {
  const s = summarize(duel(mk(id, lv), baseline, 10 + i));
  rows.push([`${PERSONAS[id].name} Lv${lv}`, s.bb100, `[${s.lo.toFixed(1)}, ${s.hi.toFixed(1)}]`, s.sig]);
  rank.push({ id, lv, ...s });
});
rows.sort((a, b) => b[1] - a[1]);
console.log('1) 성향 서열 (기준 상대: 레귤러 Lv6, bb/100, 95% 신뢰구간)');
console.log(table(rows, ['AI', 'bb/100', '신뢰구간', '판정']));

// 2) 레벨 서열: 같은 성향에서 레벨만 다르게
const levelPairs: [PersonaId, number, number][] = [['reg', 4, 6], ['reg', 6, 8], ['reg', 8, 10], ['reg', 4, 8], ['lag', 4, 6], ['lag', 6, 8], ['nit', 3, 5], ['station', 1, 3]];
const lrows: any[] = [];
const levelChecks: any[] = [];
levelPairs.forEach(([id, lo, hi], i) => {
  const s = summarize(duel(mk(id, hi), mk(id, lo), 100 + i));
  const ok = s.lo > 0;
  lrows.push([`${PERSONAS[id].name} Lv${hi} vs Lv${lo}`, s.bb100, `[${s.lo.toFixed(1)}, ${s.hi.toFixed(1)}]`, ok ? '✅ 높은 레벨 유의하게 우세' : s.bb100 > 0 ? '△ 우세하나 유의하지 않음' : '❌ 뒤집힘']);
  levelChecks.push({ id, lowLevel: lo, highLevel: hi, ...s, ok });
});
console.log('\n2) 레벨 서열 (높은 레벨 기준 bb/100)');
console.log(table(lrows, ['대결', 'bb/100', '신뢰구간', '판정']));

// 3) 공통 상대 기준 레벨 비교: 같은 상대(레귤러 Lv6)를 상대로 레벨이 높을수록 더 잘 이기는지
//    (피쉬끼리 맞붙이면 "상대가 블러프를 안 하니 접는 게 이득" 같은 특수 상황이 생겨서 함께 봄)
const vsBase: [PersonaId, number, number][] = [['station', 1, 3], ['beginner', 1, 3], ['nit', 3, 5], ['maniac', 2, 4]];
const brows: any[] = [];
const baseChecks: any[] = [];
vsBase.forEach(([id, lo, hi], i) => {
  const a = summarize(duel(mk(id, lo), baseline, 300 + i));
  const b = summarize(duel(mk(id, hi), baseline, 300 + i));
  const ok = b.bb100 > a.bb100;
  brows.push([`${PERSONAS[id].name} Lv${lo} → Lv${hi}`, `${a.bb100.toFixed(1)} → ${b.bb100.toFixed(1)}`, ok ? '✅ 높은 레벨이 더 잘함' : '❌ 낮은 레벨이 더 잘함']);
  baseChecks.push({ id, lo, hi, loBB: a.bb100, hiBB: b.bb100, ok });
});
console.log('\n3) 공통 상대(레귤러 Lv6) 기준 bb/100');
console.log(table(brows, ['성향·레벨', 'bb/100 (낮은 → 높은)', '판정']));

const okLv = levelChecks.filter((c) => c.ok).length;
console.log(`\n레벨 2 이상 차이에서 높은 쪽이 유의하게 우세: ${okLv}/${levelChecks.length}`);
console.log(`소요 ${(Date.now() - t0) / 1000}초`);
mkdirSync('reports', { recursive: true });
writeFileSync('reports/ai-match-latest.json', JSON.stringify({ pairs, stackBB, personas: rank, levels: levelChecks }, null, 2));
