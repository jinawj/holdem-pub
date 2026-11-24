// 셀프플레이 시뮬레이터 (overview 3.11). 실행: npm run sim -- --hands 5000 [--full] [--seats 6]
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile, PERSONAS, PERSONA_IDS } from '../src/ai/v1';
import { handKey, shuffledDeck } from '../src/engine/cards';
import { seedFromNumber } from '../src/engine/rng';
import { createTournament } from '../src/engine/tournament';
import { newRunStats, runTournament } from '../src/game/headless';
import { statSummary } from '../src/game/stats';
import { arg, flag, makeRng, mean, pctile, table } from './lib';
import keys169 from '../src/data/hand_rank_169.json';

const targetHands = +arg('hands', '5000');
const seats = +arg('seats', '6');
const quick = !flag('full');
const R = makeRng(flag('seed') ? +arg('seed', '1') : undefined);
const rs = newRunStats();
const t0 = Date.now();
let tourneys = 0;
while (rs.hands < targetHands) {
  const profiles = Array.from({ length: seats }, () => {
    const id = PERSONA_IDS[R.int(PERSONA_IDS.length)];
    const [lo, hi] = PERSONAS[id].lv;
    return makeProfile(id, lo + R.int(hi - lo + 1), R.rand);
  });
  const t = createTournament(profiles.map((_, i) => 'AI' + i), null, 40000);
  runTournament(t, profiles, rs, { quick, rand: R.rand, handsPerLevel: 12, seedFn: R.seedStr, randInt: R.int, maxHands: 400 });
  tourneys++;
  if (tourneys % 5 === 0) process.stdout.write(`\r토너먼트 ${tourneys}, 핸드 ${rs.hands}...`);
}
const secs = (Date.now() - t0) / 1000;
console.log(`\n\n=== 셀프플레이 결과: ${tourneys} 토너먼트, ${rs.hands} 핸드, ${rs.decisions} 결정, ${secs.toFixed(0)}초 (${quick ? '빠른 모드' : '정상 모드'}, ${seats}인) ===\n`);

console.log(`칩 총합 보존 오류: ${rs.chipErrors}건`);
if ((rs as any).chipErrorSamples) writeFileSync('reports/chip-errors.json', JSON.stringify((rs as any).chipErrorSamples, null, 1));
console.log(`규칙 위반(엔진이 거부한 액션): ${rs.illegal}건`);
const fb = Object.entries(rs.forbidden);
console.log(`3.12 금지 행동: ${fb.reduce((a, [, n]) => a + n, 0)}건 ${fb.map(([k, n]) => `${k}:${n}`).join(', ')}`);

// 성향별 통계 vs 목표
const rows: (string | number)[][] = [];
for (const id of PERSONA_IDS) {
  const st = rs.stats[id];
  if (!st) continue;
  const s = statSummary(st);
  const tg = PERSONAS[id].targets;
  const diff = (v: number, [lo, hi]: [number, number]) => (v < lo ? `${(v - lo).toFixed(1)}` : v > hi ? `+${(v - hi).toFixed(1)}` : 'OK');
  rows.push([PERSONAS[id].name, s.hands, s.vpip, `${tg.vpip[0]}–${tg.vpip[1]}`, diff(s.vpip, tg.vpip), s.pfr, `${tg.pfr[0]}–${tg.pfr[1]}`, diff(s.pfr, tg.pfr), +s.af.toFixed(2), `${tg.af[0]}–${tg.af[1]}`, diff(s.af, tg.af), s.threeBet, s.cbet, s.wtsd]);
}
console.log('\n성향별 VPIP / PFR / AF (목표는 6인 기준 초기값)');
console.log(table(rows, ['성향', '핸드', 'VPIP', '목표', '차이', 'PFR', '목표', '차이', 'AF', '목표', '차이', '3벳%', 'C벳%', 'WTSD%']));

// 계산 시간
console.log('\nAI 계산 시간 (ms, 연출용 고민 시간 제외)');
const trow = Object.entries(rs.calcMsByStreet).map(([k, a]) => [k, a.length, mean(a), pctile(a, 0.95), Math.max(...a)]);
console.log(table(trow as any, ['스트리트', '결정 수', '평균', 'p95', '최대']));

// 시작 핸드 분포 검사 (카이제곱, 좌석 0)
const N = 100000;
const counts: Record<string, number> = {};
for (let i = 0; i < N; i++) { const d = shuffledDeck(seedFromNumber(1_000_000 + i)); const k = handKey(d[0], d[seats]); counts[k] = (counts[k] ?? 0) + 1; }
let chi = 0;
for (const k of keys169 as { key: string; combos: number }[]) { const e = (N * k.combos) / 1326; chi += ((counts[k.key] ?? 0) - e) ** 2 / e; }
console.log(`\n시작 핸드 분포 카이제곱 (자유도 168, ${N}딜): ${chi.toFixed(1)}  (95% 임계값 ≈ 199.2 → ${chi < 199.2 ? '정상' : '의심'})`);

rs.worst.sort((a, b) => b.evLoss - a.evLoss);
console.log('\nEV 손실이 큰 행동 상위 10 (사람이 훑어볼 목록):');
for (const w of rs.worst.slice(0, 10)) console.log(' - ' + w.desc);

mkdirSync('reports', { recursive: true });
writeFileSync('reports/sim-latest.json', JSON.stringify({ hands: rs.hands, chipErrors: rs.chipErrors, illegal: rs.illegal, forbidden: rs.forbidden, stats: Object.fromEntries(Object.entries(rs.stats).map(([k, v]) => [k, statSummary(v)])), calcMs: Object.fromEntries(Object.entries(rs.calcMsByStreet).map(([k, a]) => [k, { mean: mean(a), p95: pctile(a, 0.95) }])), chi, worst: rs.worst.slice(0, 30) }, null, 2));
const ok = rs.chipErrors === 0 && rs.illegal === 0 && fb.length === 0;
console.log(`\n${ok ? '✅ 칩 보존·규칙 위반·금지 행동 모두 0건' : '❌ 문제 있음'}`);
process.exit(ok ? 0 : 1);
