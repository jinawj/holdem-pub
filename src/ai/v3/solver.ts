// 리버 미니 솔버 (고수 전용): 리버 시작 시점의 두 레인지(라인으로 추정)를 강도 버킷으로 묶고,
//  체크/벳 2가지/레이즈 1번짜리 작은 게임 트리를 CFR+로 풀어 '내 버킷'의 균형 전략을 쓴다.
//  솔버의 사고: "상대가 최선으로 대응해도 손해가 없도록, 레인지 전체의 밸류·블러프·콜 비율을 맞춘다"
import { COMBOS } from '../../engine/cards';
import { evaluate } from '../../engine/evaluator';
import { AI_V3 } from '../../config';
import type { Range } from '../core/equity';
import type { Ctx } from './context';
import { buildRange } from './range';
import type { Skill } from './skill';
import type { Intent, Option } from './types';
import type { BrainOut } from './strategy';

interface Node {
  t: 'act' | 'fold' | 'show';
  p: 0 | 1; // 행동할 사람 (0 = OOP)
  c: [number, number]; // 리버에서 낸 금액
  acts: string[];
  amts: number[]; // 행동 후 내 리버 총 투입액 (벳/레이즈/콜)
  kids: Node[];
  reg?: Float64Array;
  sum?: Float64Array;
}

interface Buckets { n: number; of: Int16Array; prob: Float64Array; lo: number[]; hi: number[] }

function bucketize(r: Range, scores: Int32Array, nB: number): Buckets {
  const idx: number[] = [];
  let tot = 0;
  for (let i = 0; i < 1326; i++) if (r[i] > 0 && scores[i] >= 0) { idx.push(i); tot += r[i]; }
  idx.sort((a, b) => scores[a] - scores[b]);
  const of = new Int16Array(1326).fill(-1);
  const prob: number[] = [], lo: number[] = [], hi: number[] = [];
  let b = 0, acc = 0, k = 0;
  while (k < idx.length) {
    // 같은 점수는 같은 버킷
    let j = k;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[k]]) j++;
    let w = 0;
    for (let m = k; m <= j; m++) { of[idx[m]] = b; w += r[idx[m]]; }
    if (prob[b] === undefined) { prob[b] = 0; lo[b] = scores[idx[k]]; }
    prob[b] += w; hi[b] = scores[idx[j]]; acc += w;
    k = j + 1;
    if (acc >= ((b + 1) * tot) / nB && k < idx.length) b++;
  }
  const n = prob.length;
  return { n, of, prob: Float64Array.from(prob.map((x) => x / tot)), lo, hi };
}

export function riverSolve(ctx: Ctx, skill: Skill, bluffMult: number): BrainOut | null {
  const v = ctx.view;
  if (ctx.street !== 'river' || ctx.numOpp !== 1 || ctx.activeOpp.length !== 1) return null;
  const t0 = Date.now();
  const opp = ctx.oppSeats[0];
  const meOOP = ctx.postOrder[0] === v.mySeat;
  const seatOf = (pl: 0 | 1) => (pl === 0) === meOOP ? v.mySeat : opp;
  // 리버 시작 팟·스택
  const riverActs = v.actionLog.filter((a) => a.street === 'river');
  const contrib: Record<number, number> = {};
  for (const a of riverActs) contrib[a.seat] = (contrib[a.seat] ?? 0) + a.amount;
  const riverTotal = riverActs.reduce((s, a) => s + a.amount, 0);
  const P = v.potTotal - riverTotal;
  const stackAt = (seat: number) => { const s = v.seats.find((x) => x.seat === seat)!; return s.stack + (contrib[seat] ?? 0); };
  const S = Math.min(stackAt(v.mySeat), stackAt(opp));
  if (S <= 0 || P <= 0) return null;
  // 레인지 (리버 시작 시점)
  const board = v.board;
  const myR = buildRange(v, v.mySeat, { read: 1, dead: board, until: 'river' });
  const opR = buildRange(v, opp, { read: 1, dead: board, until: 'river', bluffMult });
  const scores = new Int32Array(1326).fill(-1);
  const bset = new Set(board);
  const buf = new Int32Array(7);
  for (let k = 0; k < 5; k++) buf[k + 2] = board[k];
  for (let i = 0; i < 1326; i++) {
    const [a, b] = COMBOS[i];
    if (bset.has(a) || bset.has(b)) continue;
    buf[0] = a; buf[1] = b;
    scores[i] = evaluate(buf, 7);
  }
  // 내 실제 패가 레인지에 꼭 들어가게
  const meIdx = COMBOS.findIndex(([a, b]) => (a === v.holeCards[0] && b === v.holeCards[1]) || (a === v.holeCards[1] && b === v.holeCards[0]));
  if (myR[meIdx] <= 0.002) myR[meIdx] = 0.002;
  const nB = AI_V3.solver.buckets;
  const ranges: [Range, Range] = meOOP ? [myR, opR] : [opR, myR];
  const B: [Buckets, Buckets] = [bucketize(ranges[0], scores, nB), bucketize(ranges[1], scores, nB)];
  // 승률 행렬 W[i][j] = OOP 버킷 i가 IP 버킷 j를 이길 확률 (카드 겹침 제외)
  const n0 = B[0].n, n1 = B[1].n;
  const W = new Float64Array(n0 * n1), Wn = new Float64Array(n0 * n1);
  const l0: number[] = [], l1: number[] = [];
  for (let i = 0; i < 1326; i++) { if (B[0].of[i] >= 0) l0.push(i); if (B[1].of[i] >= 0) l1.push(i); }
  for (const a of l0) {
    const [a1, a2] = COMBOS[a];
    const ba = B[0].of[a], wa = ranges[0][a], sa = scores[a];
    for (const b of l1) {
      const [b1, b2] = COMBOS[b];
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      const w = wa * ranges[1][b];
      const k = ba * n1 + B[1].of[b];
      W[k] += w * (sa > scores[b] ? 1 : sa === scores[b] ? 0.5 : 0);
      Wn[k] += w;
    }
  }
  for (let k = 0; k < W.length; k++) W[k] = Wn[k] > 0 ? W[k] / Wn[k] : 0.5;

  // 게임 트리
  const sizes = skill.overbet ? [0.55, 1.25] : [0.55, 1.0];
  // 이미 나온 리버 벳 크기를 트리에 넣는다
  const firstBet = riverActs.find((a) => a.type === 'bet');
  if (firstBet) {
    const f = firstBet.amount / P;
    let ni = 0;
    sizes.forEach((s, i) => { if (Math.abs(s - f) < Math.abs(sizes[ni] - f)) ni = i; });
    sizes[ni] = f;
  }
  const mk = (t: Node['t'], p: 0 | 1, c: [number, number]): Node => ({ t, p, c, acts: [], amts: [], kids: [] });
  const build = (p: 0 | 1, c: [number, number], raised: boolean, checked: boolean): Node => {
    const o = (1 - p) as 0 | 1;
    const nd = mk('act', p, c);
    const facing = c[o] - c[p];
    if (facing <= 0) {
      nd.acts.push('x'); nd.amts.push(c[p]);
      nd.kids.push(p === 0 && !checked ? build(1, c, false, true) : mk('show', p, c));
      const seen = new Set<number>();
      for (const s of sizes) {
        const amt = Math.min(S, Math.round(s * P));
        if (seen.has(amt) || amt <= 0) continue;
        seen.add(amt);
        const nc: [number, number] = [...c] as [number, number];
        nc[p] = amt;
        nd.acts.push('b' + s.toFixed(2)); nd.amts.push(amt);
        nd.kids.push(build(o, nc, false, checked));
      }
    } else {
      nd.acts.push('f'); nd.amts.push(c[p]); nd.kids.push(mk('fold', p, c));
      const cc: [number, number] = [...c] as [number, number]; cc[p] = c[o];
      nd.acts.push('c'); nd.amts.push(c[o]); nd.kids.push(mk('show', p, cc));
      if (!raised && c[o] < S) {
        let to = Math.min(S, c[o] * 3);
        if (S - to < 0.3 * to) to = S;
        const rc: [number, number] = [...c] as [number, number]; rc[p] = to;
        nd.acts.push('r'); nd.amts.push(to); nd.kids.push(build(o, rc, true, checked));
      }
    }
    nd.reg = new Float64Array(B[p].n * nd.acts.length);
    nd.sum = new Float64Array(B[p].n * nd.acts.length);
    return nd;
  };
  const root = build(0, [0, 0], false, false);

  const walk = (nd: Node, r0: Float64Array, r1: Float64Array, it: number): [Float64Array, Float64Array] => {
    const v0 = new Float64Array(n0), v1 = new Float64Array(n1);
    if (nd.t === 'fold') {
      const s0 = r0.reduce((a, b) => a + b, 0), s1 = r1.reduce((a, b) => a + b, 0);
      const u0 = nd.p === 1 ? P + nd.c[1] : -nd.c[0];
      const u1 = nd.p === 0 ? P + nd.c[0] : -nd.c[1];
      v0.fill(u0 * s1); v1.fill(u1 * s0);
      return [v0, v1];
    }
    if (nd.t === 'show') {
      const T = P + nd.c[0] + nd.c[1];
      for (let i = 0; i < n0; i++) for (let j = 0; j < n1; j++) {
        const w = W[i * n1 + j];
        v0[i] += r1[j] * (w * T - nd.c[0]);
        v1[j] += r0[i] * ((1 - w) * T - nd.c[1]);
      }
      return [v0, v1];
    }
    const p = nd.p, nA = nd.acts.length, nb = B[p].n;
    const sig = new Float64Array(nb * nA);
    for (let b = 0; b < nb; b++) {
      let s = 0;
      for (let a = 0; a < nA; a++) s += nd.reg![b * nA + a];
      for (let a = 0; a < nA; a++) sig[b * nA + a] = s > 0 ? nd.reg![b * nA + a] / s : 1 / nA;
    }
    const kidV: Float64Array[] = [];
    const vp = p === 0 ? v0 : v1, vo = p === 0 ? v1 : v0;
    const rp = p === 0 ? r0 : r1;
    for (let a = 0; a < nA; a++) {
      const nr = new Float64Array(nb);
      for (let b = 0; b < nb; b++) nr[b] = rp[b] * sig[b * nA + a];
      const [c0, c1] = p === 0 ? walk(nd.kids[a], nr, r1, it) : walk(nd.kids[a], r0, nr, it);
      const cp = p === 0 ? c0 : c1, co = p === 0 ? c1 : c0;
      kidV.push(cp);
      for (let b = 0; b < nb; b++) vp[b] += sig[b * nA + a] * cp[b];
      for (let k = 0; k < co.length; k++) vo[k] += co[k];
    }
    for (let b = 0; b < nb; b++) for (let a = 0; a < nA; a++) {
      const k = b * nA + a;
      nd.reg![k] = Math.max(0, nd.reg![k] + kidV[a][b] - vp[b]);
      nd.sum![k] += it * rp[b] * sig[k];
    }
    return [v0, v1];
  };
  let it = 0;
  for (; it < AI_V3.solver.iters; it++) {
    walk(root, B[0].prob, B[1].prob, it + 1);
    if (it % 20 === 19 && Date.now() - t0 > AI_V3.solver.maxMs) break;
  }
  // 현재 위치 찾기
  let nd = root;
  for (const a of riverActs) {
    if (nd.t !== 'act') return null;
    let k = -1;
    if (a.type === 'check') k = nd.acts.indexOf('x');
    else if (a.type === 'call') k = nd.acts.indexOf('c');
    else if (a.type === 'fold') return null;
    else if (a.type === 'raise' && nd.acts.includes('r')) k = nd.acts.indexOf('r');
    else {
      // 벳: 가장 가까운 크기
      const amt = contribUpTo(riverActs, a);
      let best = Infinity;
      nd.acts.forEach((x, i) => { if (x.startsWith('b') && Math.abs(nd.amts[i] - amt) < best) { best = Math.abs(nd.amts[i] - amt); k = i; } });
    }
    if (k < 0) return null;
    nd = nd.kids[k];
  }
  if (nd.t !== 'act' || seatOf(nd.p) !== v.mySeat) return null;
  const pm = nd.p, nA = nd.acts.length;
  // 내 버킷
  let myB = B[pm].of[meIdx];
  if (myB < 0) myB = 0;
  const raw = nd.acts.map((_, a) => nd.sum![myB * nA + a]);
  const s = raw.reduce((x, y) => x + y, 0);
  const probs = raw.map((x) => (s > 0 ? x / s : 1 / nA));
  // 사람 상대 보정: 리버에서 사람들은 균형보다 덜 접는다 → 약한 버킷의 벳·레이즈(블러프)를 조금 줄임
  if ((myB + 0.5) / B[pm].n < 0.4) {
    const passive = nd.acts.findIndex((a) => a === 'x' || a === 'f');
    let moved = 0;
    nd.acts.forEach((a, i) => { if (a.startsWith('b') || a === 'r') { const k = probs[i] * (1 - AI_V3.solverBluffScale); probs[i] -= k; moved += k; } });
    if (passive >= 0) probs[passive] += moved;
  }
  // 읽기 보정: 벳을 받은 블러프 캐처는 라인·기억이 말하는 블러프 가능성만큼 콜을 늘리거나 줄인다
  //  (기본은 사람들이 리버 큰 벳에 블러프를 덜 섞는 것 반영: 0.85배)
  const fi = nd.acts.indexOf('f'), ci = nd.acts.indexOf('c');
  if (fi >= 0 && ci >= 0 && (myB + 0.5) / B[pm].n < 0.8) {
    const k = Math.max(0.5, Math.min(1.3, AI_V3.solverCallScale * (bluffMult)));
    if (k < 1) { const m = probs[ci] * (1 - k); probs[ci] -= m; probs[fi] += m; }
    else { const m = Math.min(probs[fi], probs[ci] * (k - 1)); probs[fi] -= m; probs[ci] += m; }
  }
  // 옵션으로 변환
  const L = v.legal;
  const myRiver = contrib[v.mySeat] ?? 0;
  const options: Option[] = [], intents: Intent[] = [];
  const pct = (myB + 0.5) / B[pm].n; // 내 버킷 위치 (1에 가까울수록 강함)
  nd.acts.forEach((a, i) => {
    if (a === 'x') { options.push({ key: 'check', act: 'check' }); intents.push(pct > 0.55 ? 'potControl' : pct > 0.3 ? 'bluffCatch' : 'giveUp'); }
    else if (a === 'f') { options.push({ key: 'fold', act: 'fold' }); intents.push('fold'); }
    else if (a === 'c') { options.push({ key: 'call', act: 'call' }); intents.push(pct > 0.8 ? 'value' : 'bluffCatch'); }
    else {
      let to = L.committed + (nd.amts[i] - myRiver);
      to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.round(to / 100) * 100));
      options.push({ key: 'raise:' + to, act: 'raise', to });
      intents.push(pct > 0.6 ? 'value' : 'bluff');
    }
  });
  const desc = nd.acts.map((a, i) => `${a === 'x' ? '체크' : a === 'f' ? '폴드' : a === 'c' ? '콜' : a === 'r' ? '레이즈' : `벳${Math.round((nd.amts[i] / P) * 100)}%`} ${Math.round(probs[i] * 100)}%`).join(' / ');
  const why = `리버 솔버(${it}회, ${Date.now() - t0}ms): 내 패는 내 레인지 ${B[pm].n}묶음 중 아래에서 ${myB + 1}번째 → ${desc}`;
  return { options, probs, intents, why, source: 'solver' };
}

function contribUpTo(acts: { seat: number; amount: number }[], target: { seat: number; amount: number }): number {
  let s = 0;
  for (const a of acts) { if (a.seat === target.seat) s += a.amount; if (a === target) break; }
  return s;
}
