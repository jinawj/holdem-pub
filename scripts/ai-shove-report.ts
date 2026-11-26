// 숏스택 올인(셔브)·올인 콜 점검: AI 범위를 직접 계산한 내시 표(src/data/pushfold.json)와 비교
//  - 푸시: 자리별(뒤 인원) 올인 비율 vs 표의 올인 이득>0 비율, '명확한 실수'(이득 −1BB 이하 올인 / +1BB 이상 폴드)
//  - 콜: BB가 올인을 받았을 때 콜 비율 vs 정답(상대 표 범위 상대 에퀴티로 계산한 콜 이득>0), 명확한 실수(±1BB)
//  - 리셔브: 15·20BB에서 오픈을 받았을 때 올인 비율 (참고)
// 실행: npx tsx scripts/ai-shove-report.ts [--v 1] [--ante 0|0.5] [--trials 4]
import rank169 from '../src/data/hand_rank_169.json';
import * as V2 from '../src/ai/v2';
import { equityVsRanges } from '../src/ai/v2/equity';
import { pushMargin } from '../src/ai/v2/pushfold';
import { COMBO_KEYS, parseCards } from '../src/engine/cards';
import { makePlayerView } from '../src/engine/view';
import { buildSpot, SpotDef } from '../src/game/spot';
import { arg, makeRng, table } from './lib';

const ver = arg('v', '2');
const AI: any = V2;
const anteBB = +arg('ante', '0');
const trials = +arg('trials', '4');
const R = makeRng(9);
const BB = 200;
const H = rank169 as { key: string; combos: number }[];
const handStr = (k: string) => (k.length === 2 ? `${k[0]}s${k[1]}h` : k[2] === 's' ? `${k[0]}s${k[1]}s` : `${k[0]}s${k[1]}h`);
const WHO: [string, number][] = [['solver', 10], ['reg', 8], ['lag', 8], ['nit', 6], ['maniac', 4], ['station', 3], ['beginner', 2]];
const STACKS = [5, 8, 10, 13];
// 6인: 버튼 0, SB 1, BB 2, UTG 3, HJ 4, CO 5
const PUSH = [
  { name: 'UTG', hero: 3, moves: [] as string[], behind: 5 },
  { name: 'CO', hero: 5, moves: ['f', 'f'], behind: 3 },
  { name: 'BTN', hero: 0, moves: ['f', 'f', 'f'], behind: 2 },
  { name: 'SB', hero: 1, moves: ['f', 'f', 'f', 'f'], behind: 1 },
];
const CALL = [
  { name: 'BB vs SB 올인', moves: ['f', 'f', 'f', 'f', 'a'], pusherBehind: 1 },
  { name: 'BB vs BTN 올인', moves: ['f', 'f', 'f', 'a', 'f'], pusherBehind: 2 },
  { name: 'BB vs UTG 올인', moves: ['a', 'f', 'f', 'f', 'f'], pusherBehind: 5 },
];

function decideRate(def: Omit<SpotDef, 'heroHand'>, id: string, lv: number, k: string): number {
  const h = buildSpot({ ...def, heroHand: handStr(k) } as SpotDef, handStr(k));
  const view = makePlayerView(h, def.hero, h.players.length);
  let n = 0;
  for (let t = 0; t < trials; t++) {
    const d = AI.decide(view, AI.makeProfile(id, lv, R.rand), AI.newMemory(), { rand: R.rand, quick: true });
    if (d.type === 'raise' || d.type === 'call') n++;
  }
  return n / trials;
}

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
console.log(`숏스택 점검 (${ver === '1' ? 'v1' : 'v2'}, 6인, 앤티 ${anteBB}BB, 핸드당 ${trials}회)\n`);

// ---- 1) 오픈 올인 ----
for (const S of STACKS) {
  const rows: string[][] = [];
  const ref: string[] = ['내시 표'];
  for (const p of PUSH) {
    let w = 0, tot = 0;
    for (const x of H) { const m = pushMargin(x.key, p.behind, S, anteBB); if (m !== null && m > 0) w += x.combos; tot += x.combos; }
    ref.push(pct(w / tot));
  }
  rows.push(ref);
  for (const [id, lv] of WHO) {
    const row = [`${AI.PERSONAS[id].name} Lv${lv}`];
    for (const p of PUSH) {
      let w = 0, tot = 0, bad = 0, badTot = 0;
      for (const x of H) {
        const r = decideRate({ id: 'p', desc: '', hero: p.hero, moves: p.moves, stacksBB: S, ante: anteBB * BB, expect: {} }, id, lv, x.key);
        w += r * x.combos; tot += x.combos;
        const m = pushMargin(x.key, p.behind, S, anteBB) ?? 0;
        if (m <= -1) { bad += r * x.combos; badTot += x.combos; }
        if (m >= 1) { bad += (1 - r) * x.combos; badTot += x.combos; }
      }
      row.push(`${pct(w / tot)} (실수 ${pct(badTot ? bad / badTot : 0)})`);
    }
    rows.push(row);
  }
  console.log(`[오픈 올인 ${S}BB]  괄호 = 명확한 실수율(표 이득 ±1BB 넘는 핸드에서 반대로 한 비율)`);
  console.log(table(rows, ['', ...PUSH.map((p) => `${p.name}(뒤 ${p.behind})`)]) + '\n');
}

// ---- 2) 올인 콜 (BB) ----
function pushRange(behind: number, S: number) {
  const r = new Float64Array(1326);
  COMBO_KEYS.forEach((k, i) => { const m = pushMargin(k, behind, S, anteBB); r[i] = m !== null && m > 0 ? 1 : 0; });
  return r;
}
for (const S of STACKS) {
  const rows: string[][] = [];
  const correct: Record<string, Record<string, number>> = {};
  const ref: string[] = ['정답(표 범위 상대 콜 이득>0)'];
  for (const c of CALL) {
    const range = pushRange(c.pusherBehind, S);
    const ev: Record<string, number> = {};
    let w = 0, tot = 0;
    // 팟: 올인 S + 내 BB 1 + SB 0.5(SB가 올인이면 포함) + 앤티. 콜 금액 S−1
    const pot = S + 1 + (c.pusherBehind === 1 ? 0 : 0.5) + anteBB;
    const toCall = S - 1;
    for (const x of H) {
      const eq = equityVsRanges(parseCards(handStr(x.key)) as [number, number], [], [range], 1500, R.rand).eq;
      ev[x.key] = eq * (pot + toCall) - toCall; // 콜 이득(BB), 폴드 = 0
      if (ev[x.key] > 0) w += x.combos;
      tot += x.combos;
    }
    correct[c.name] = ev;
    ref.push(pct(w / tot));
  }
  rows.push(ref);
  for (const [id, lv] of WHO) {
    const row = [`${AI.PERSONAS[id].name} Lv${lv}`];
    for (const c of CALL) {
      let w = 0, tot = 0, bad = 0, badTot = 0;
      for (const x of H) {
        const r = decideRate({ id: 'c', desc: '', hero: 2, moves: c.moves, stacksBB: S, ante: anteBB * BB, expect: {} }, id, lv, x.key);
        w += r * x.combos; tot += x.combos;
        const e = correct[c.name][x.key];
        if (e <= -1) { bad += r * x.combos; badTot += x.combos; }
        if (e >= 1) { bad += (1 - r) * x.combos; badTot += x.combos; }
      }
      row.push(`${pct(w / tot)} (실수 ${pct(badTot ? bad / badTot : 0)})`);
    }
    rows.push(row);
  }
  console.log(`[올인 콜 ${S}BB]  괄호 = 명확한 실수율(콜 이득 ±1BB 넘는 핸드에서 반대로 한 비율)`);
  console.log(table(rows, ['', ...CALL.map((c) => c.name)]) + '\n');
}

// ---- 3) 리셔브 (참고): 오픈 2.2x를 받았을 때 올인 비율 ----
for (const S of [15, 20]) {
  const rows: string[][] = [];
  for (const [id, lv] of WHO) {
    const row = [`${AI.PERSONAS[id].name} Lv${lv}`];
    for (const sp of [{ name: 'BTN vs CO 오픈', hero: 0, moves: ['f', 'f', 'r:2.2'] }, { name: 'BB vs BTN 오픈', hero: 2, moves: ['f', 'f', 'f', 'r:2.2', 'f'] }]) {
      let shove = 0, call = 0, tot = 0;
      for (const x of H) {
        const h = buildSpot({ id: 'r', desc: '', hero: sp.hero, moves: sp.moves, stacksBB: S, ante: anteBB * BB, expect: {}, heroHand: handStr(x.key) } as SpotDef, handStr(x.key));
        const view = makePlayerView(h, sp.hero, h.players.length);
        for (let t = 0; t < trials; t++) {
          const d = AI.decide(view, AI.makeProfile(id, lv, R.rand), AI.newMemory(), { rand: R.rand, quick: true });
          if (d.type === 'raise' && d.to >= view.legal.maxRaiseTo) shove += x.combos;
          else if (d.type === 'raise' || d.type === 'call') call += x.combos;
          tot += x.combos;
        }
      }
      row.push(`올인 ${pct(shove / tot)} · 콜·작은 레이즈 ${pct(call / tot)}`);
    }
    rows.push(row);
  }
  console.log(`[리셔브 ${S}BB] (참고: 15BB BTN vs CO 리셔브 대략 12~16%, BB vs BTN 대략 14~20%)`);
  console.log(table(rows, ['', 'BTN vs CO 오픈', 'BB vs BTN 오픈']) + '\n');
}
