// 자동 튜닝: config AI_V3의 숫자를 하나씩 위아래로 움직여 '상황별 점검 손실'이 줄어드는 쪽만 남긴다 (좌표 하강)
//  손실 = 레귤러 목표 범위를 벗어난 통계 + 사고 과정 모순 (scripts/sit-core.ts audit) — 토큰 0, 성적(bb/100)이 아니라 '레귤러다움'
//  같은 시드로 재므로 숫자 차이만 비교된다. 결과는 reports/tune-result.json + 화면 — config에 옮기는 건 사람이(또는 Claude가) 검토 후
// 예) npx tsx scripts/ai-tune.ts --hands 1000 --passes 3
//     npx tsx scripts/ai-tune.ts --only hu --params hu.bb3bet,huJamPct,jamCallLoose
import { mkdirSync, writeFileSync } from 'node:fs';
import { AI_V3 } from '../src/config';
import { arg } from './lib';
import { audit, SCENARIOS } from './sit-core';

/** 튜닝할 숫자: 경로(AI_V3 안), 최소, 최대 */
const ALL: [string, number, number][] = [
  ['rangeBet.flop', 0.35, 0.8], ['rangeBet.turn', 0.25, 0.7], ['rangeBet.river', 0.2, 0.65], ['rangeBet.checkedFlop', 0.2, 0.6], ['rangeBet.checkedTurn', 0.2, 0.6],
  ['bluffMult.flop', 0.9, 2.4], ['bluffMult.turn', 0.8, 2], ['xrMult', 1.2, 4], ['donkBase', 0.02, 0.15],
  ['defend.base', 0.45, 0.85], ['contFloorAtPrice', 0.4, 0.9], ['callRealize.oop', 0.75, 1], ['callRealize.ip', 0.85, 1], ['solverCallScale', 0.55, 1.05],
  ['vs3bet.ip', 0.35, 0.8], ['vs3bet.oop', 0.3, 0.7], ['coldCall.late', 0.8, 2], ['coldCall.mid', 0.6, 1.6], ['bbDefend.base', 12, 38],
  ['openScale.0', 0.7, 1.4], ['openScale.1', 0.7, 1.4], ['openScale.2', 0.7, 1.4], ['openScale.3', 0.7, 1.4], ['openScale.4', 0.7, 1.4],
  ['hu.bb3bet', 6, 22], ['hu.bbDefend', 55, 85], ['huJamPct', 35, 100], ['jamCallLoose', 1, 2],
];
const pick = arg('params', '');
const PARAMS = pick ? ALL.filter(([p]) => pick.split(',').includes(p)) : ALL;
const only = arg('only', '') ? arg('only', '').split(',') : null;
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));
const hands = +arg('hands', '1000');
const passes = +arg('passes', '3');
const minGain = +arg('minGain', '0.02');

function ref(path: string): [any, string] {
  const parts = path.split('.');
  let o: any = AI_V3;
  for (const p of parts.slice(0, -1)) o = o[p];
  return [o, parts[parts.length - 1]];
}
const get = (p: string) => { const [o, k] = ref(p); return o[k] as number; };
const set = (p: string, v: number) => { const [o, k] = ref(p); o[k] = v; };
const evalLoss = () => audit({ scenarios, hands }).loss;

const t0 = Date.now();
const start: Record<string, number> = Object.fromEntries(PARAMS.map(([p]) => [p, get(p)]));
let best = evalLoss();
console.log(`시작 손실 ${best.toFixed(3)} (상황 ${scenarios.map((s) => s.id).join(',')}, 상황당 ${hands}핸드)`);
const steps = [0.25, 0.12, 0.06].slice(0, passes);
for (const [pi, step] of steps.entries()) {
  console.log(`\n--- ${pi + 1}회차 (±${Math.round(step * 100)}%) ---`);
  for (const [p, lo, hi] of PARAMS) {
    const cur = get(p);
    let bestV = cur, bestL = best;
    for (const dir of [1, -1]) {
      const v = +Math.max(lo, Math.min(hi, cur * (1 + dir * step))).toFixed(4);
      if (v === cur) continue;
      set(p, v);
      const l = evalLoss();
      if (l < bestL - minGain) { bestL = l; bestV = v; }
    }
    set(p, bestV);
    if (bestV !== cur) { best = bestL; console.log(`  ${p}: ${cur} → ${bestV}  손실 ${best.toFixed(3)}  (${((Date.now() - t0) / 60000).toFixed(1)}분)`); }
  }
}
const final: Record<string, number> = Object.fromEntries(PARAMS.map(([p]) => [p, get(p)]));
const changed = Object.entries(final).filter(([p, v]) => v !== start[p]);
console.log(`\n최종 손실 ${best.toFixed(3)} · 바뀐 숫자 ${changed.length}개 (${((Date.now() - t0) / 60000).toFixed(1)}분)`);
for (const [p, v] of changed) console.log(`  ${p}: ${start[p]} → ${v}`);
mkdirSync('reports', { recursive: true });
writeFileSync('reports/tune-result.json', JSON.stringify({ start, final, loss: best }, null, 2));
