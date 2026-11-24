// 숏스택 푸시/폴드 표 직접 계산 (AI v2, overview 3.4 ④). 칩 기준(chipEV), ICM 없음.
//  1) 169×169 프리플랍 올인 에퀴티 표 (몬테카를로)
//  2) 내 뒤 N명(1~9)·유효 스택 S(1~20BB)·앤티(0 / 0.5BB) 별로
//     "푸시하는 사람 vs 뒤에서 최선으로 대응하는 콜러들"을 가상 플레이(fictitious play)로 반복해 균형 근사.
//     헤즈업(N=1, SB vs BB)은 정확한 내시 균형에 수렴. 멀티웨이는 "콜러는 최대 한 명" 근사.
//  3) 핸드별 "푸시 이득(EV(푸시) − EV(폴드), BB)"을 저장 → AI가 레벨에 따라 경계 근처에서만 흔들리게 사용.
// 실행: npm run gen:pushfold   (에퀴티 표는 scripts/.cache 에 저장해 재사용)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { makeCard, RANKS } from '../src/engine/cards';
import { evaluate } from '../src/engine/evaluator';
import { Rng, seedFromNumber } from '../src/engine/rng';
import rank169 from '../src/data/hand_rank_169.json';

const KEYS = (rank169 as { key: string; combos: number }[]).map((x) => x.key);
const COMBOS = (rank169 as { key: string; combos: number }[]).map((x) => x.combos);
const N = KEYS.length; // 169
const rng = new Rng(seedFromNumber(20261125));

function combosOf(key: string): [number, number][] {
  const r1 = RANKS.indexOf(key[0]), r2 = RANKS.indexOf(key[1]);
  const out: [number, number][] = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    if (key.length === 2) { if (a < b) out.push([makeCard(r1, a), makeCard(r2, b)]); }
    else if (key[2] === 's') { if (a === b) out.push([makeCard(r1, a), makeCard(r2, b)]); }
    else if (a !== b) out.push([makeCard(r1, a), makeCard(r2, b)]);
  }
  return out;
}

// ---------- 1) 에퀴티 표 ----------
const CACHE = new URL('./.cache/eq169.json', import.meta.url);
const SAMPLES = +(process.argv.find((a) => a.startsWith('--samples='))?.split('=')[1] ?? 1500);
let EQ: number[][];
if (existsSync(CACHE)) {
  EQ = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.log('에퀴티 표 캐시 사용');
} else {
  const t0 = Date.now();
  const cl = KEYS.map(combosOf);
  EQ = Array.from({ length: N }, () => new Array(N).fill(0.5));
  const h1 = new Int32Array(7), h2 = new Int32Array(7);
  const used = new Uint8Array(52);
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      let win = 0, n = 0;
      for (let s = 0; s < SAMPLES; s++) {
        const a = cl[i][rng.int(cl[i].length)];
        const b = cl[j][rng.int(cl[j].length)];
        if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
        used.fill(0); used[a[0]] = used[a[1]] = used[b[0]] = used[b[1]] = 1;
        h1[0] = a[0]; h1[1] = a[1]; h2[0] = b[0]; h2[1] = b[1];
        for (let k = 2; k < 7;) { const c = rng.int(52); if (!used[c]) { used[c] = 1; h1[k] = c; h2[k] = c; k++; } }
        const x = evaluate(h1, 7), y = evaluate(h2, 7);
        win += x > y ? 1 : x === y ? 0.5 : 0; n++;
      }
      const e = n > 0 ? win / n : 0.5;
      EQ[i][j] = e; EQ[j][i] = 1 - e;
    }
    if (i % 20 === 0) process.stdout.write(`\r에퀴티 표 ${i}/${N} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  }
  mkdirSync(new URL('./.cache/', import.meta.url), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(EQ.map((r) => r.map((v) => +v.toFixed(4)))));
  console.log(`\n에퀴티 표 완료 ${((Date.now() - t0) / 1000).toFixed(0)}초`);
}

// ---------- 2) 균형 근사 ----------
const TOTAL_COMBOS = 1326;
/** 범위(핸드별 참여 확률) 상대 에퀴티 */
function eqVsRange(h: number, range: Float64Array): number {
  let num = 0, den = 0;
  const row = EQ[h];
  for (let j = 0; j < N; j++) {
    const w = range[j] * COMBOS[j] * (j === h ? (KEYS[h].length === 2 ? 1 / 6 : KEYS[h][2] === 's' ? 3 / 4 : 7 / 12) : 1);
    num += w * row[j]; den += w;
  }
  return den > 0 ? num / den : 0.5;
}
const freq = (r: Float64Array) => { let s = 0; for (let j = 0; j < N; j++) s += r[j] * COMBOS[j]; return s / TOTAL_COMBOS; };
/** 모든 핸드의 범위 상대 에퀴티를 한 번에 */
function eqVecVsRange(range: Float64Array): Float64Array {
  const out = new Float64Array(N);
  for (let h = 0; h < N; h++) out[h] = eqVsRange(h, range);
  return out;
}

interface Solved { pushMargin: Float64Array; push: Float64Array; calls: Float64Array[] }

function solve(nBehind: number, S: number, A: number, iters = 400): Solved {
  // 뒤에 있는 사람들: 마지막이 BB, 그 앞이 SB (N>=2). N=1 이면 푸시하는 사람이 SB
  const posted = Array.from({ length: nBehind }, (_, k) => (k === nBehind - 1 ? 1 : k === nBehind - 2 ? 0.5 : 0));
  const p0 = nBehind === 1 ? 0.5 : 0;
  const dead = 1.5 + A;
  const push = new Float64Array(N).fill(0);
  for (let j = 0; j < N; j++) push[j] = j < N * 0.3 ? 1 : 0;
  const calls = posted.map(() => { const r = new Float64Array(N); for (let j = 0; j < N; j++) r[j] = j < N * 0.15 ? 1 : 0; return r; });
  const margin = new Float64Array(N);
  for (let t = 1; t <= iters; t++) {
    const lr = 1 / (t + 1);
    // 콜러 최선 대응 (푸시 범위 상대): 콜 = eq*pot − S, 폴드 = −posted
    const eqVsPush = eqVecVsRange(push);
    for (let k = 0; k < nBehind; k++) {
      const pot = 2 * S + (dead - p0 - posted[k]);
      for (let h = 0; h < N; h++) {
        const br = eqVsPush[h] * pot - S > -posted[k] ? 1 : 0;
        calls[k][h] += (br - calls[k][h]) * lr;
      }
    }
    // 푸시 최선 대응 (콜러 범위 상대)
    const q = calls.map(freq);
    const eqVsCall = calls.map(eqVecVsRange);
    for (let h = 0; h < N; h++) {
      let ev = 0, pNone = 1;
      for (let k = 0; k < nBehind; k++) {
        const pot = 2 * S + (dead - p0 - posted[k]);
        const pFirst = pNone * q[k];
        ev += pFirst * (eqVsCall[k][h] * pot - S + p0);
        pNone *= 1 - q[k];
      }
      ev += pNone * dead;
      margin[h] = ev; // 폴드 대비 이득(BB)
      const br = ev > 0 ? 1 : 0;
      push[h] += (br - push[h]) * lr;
    }
  }
  return { pushMargin: margin, push, calls };
}

// ---------- 3) 저장 ----------
const STACKS = Array.from({ length: 20 }, (_, i) => i + 1);
const ANTES = [0, 0.5];
const out: { keys: string[]; stacks: number[]; antes: number[]; scale: number; data: Record<string, string> } = { keys: KEYS, stacks: STACKS, antes: ANTES, scale: 20, data: {} };
const report: string[] = [];
const t1 = Date.now();
for (const A of ANTES) {
  for (let n = 1; n <= 9; n++) {
    for (const S of STACKS) {
      const r = solve(n, S, A);
      const bytes = new Int8Array(N);
      for (let h = 0; h < N; h++) bytes[h] = Math.max(-127, Math.min(127, Math.round(r.pushMargin[h] * out.scale)));
      out.data[`${A}|${n}|${S}`] = Buffer.from(bytes.buffer).toString('base64');
      if ((S === 5 || S === 10 || S === 15 || S === 20) && (n === 1 || n === 2 || n === 3 || n === 5 || n === 8)) {
        const pushPct = (freq(r.push) * 100).toFixed(1);
        const callPct = (freq(r.calls[n - 1]) * 100).toFixed(1);
        report.push(`앤티 ${A}  뒤 ${n}명  ${String(S).padStart(2)}BB: 푸시 ${pushPct}%  (BB 콜 ${callPct}%)`);
      }
    }
  }
  process.stdout.write(`\r균형 계산 앤티 ${A} 완료 (${((Date.now() - t1) / 1000).toFixed(0)}초)   `);
}
writeFileSync(new URL('../src/data/pushfold.json', import.meta.url), JSON.stringify(out));
console.log('\n\n' + report.join('\n'));
// 헤즈업 10BB 경계 예시
const hu = solve(1, 10, 0);
const edge = KEYS.map((k, i) => [k, hu.pushMargin[i]] as const).filter(([, m]) => Math.abs(m) < 0.15).map(([k]) => k);
console.log('\n헤즈업 10BB 무앤티 경계 근처 핸드:', edge.slice(0, 20).join(' '));
console.log('저장: src/data/pushfold.json');
