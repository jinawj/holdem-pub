// 169 시작 핸드 강도 순위 생성 (오프라인). 기준: 0.5 × 랜덤 핸드 상대 에퀴티 + 0.5 × 상위 25% 레인지 상대 에퀴티
// 실행: npm run gen:handrank
import { writeFileSync } from 'node:fs';
import { COMBOS, COMBO_KEYS, RANKS, makeCard } from '../src/engine/cards';
import { evaluate } from '../src/engine/evaluator';
import { Rng, seedFromNumber } from '../src/engine/rng';

const rng = new Rng(seedFromNumber(169));
const keys: string[] = [];
for (let i = 12; i >= 0; i--) for (let j = 12; j >= 0; j--) {
  if (i === j) keys.push(RANKS[i] + RANKS[j]);
  else if (i > j) keys.push(RANKS[i] + RANKS[j] + 's');
  else keys.push(RANKS[j] + RANKS[i] + 'o');
}
const comboCount = (k: string) => (k.length === 2 ? 6 : k[2] === 's' ? 4 : 12);
const repr = (k: string): [number, number] => {
  const r1 = RANKS.indexOf(k[0]), r2 = RANKS.indexOf(k[1]);
  if (k.length === 2) return [makeCard(r1, 3), makeCard(r2, 2)];
  return k[2] === 's' ? [makeCard(r1, 3), makeCard(r2, 3)] : [makeCard(r1, 3), makeCard(r2, 2)];
};

function equity(hero: [number, number], oppCombos: number[], trials: number): number {
  let win = 0;
  const cards = new Int32Array(7), opp = new Int32Array(7);
  for (let t = 0; t < trials; t++) {
    let oc: [number, number];
    do oc = COMBOS[oppCombos[rng.int(oppCombos.length)]]; while (oc[0] === hero[0] || oc[0] === hero[1] || oc[1] === hero[0] || oc[1] === hero[1]);
    const used = new Set([hero[0], hero[1], oc[0], oc[1]]);
    const board: number[] = [];
    while (board.length < 5) { const c = rng.int(52); if (!used.has(c)) { used.add(c); board.push(c); } }
    cards[0] = hero[0]; cards[1] = hero[1]; opp[0] = oc[0]; opp[1] = oc[1];
    for (let i = 0; i < 5; i++) { cards[i + 2] = board[i]; opp[i + 2] = board[i]; }
    const a = evaluate(cards), b = evaluate(opp);
    win += a > b ? 1 : a === b ? 0.5 : 0;
  }
  return win / trials;
}

const all = COMBOS.map((_, i) => i);
const eqRandom: Record<string, number> = {};
for (const k of keys) eqRandom[k] = equity(repr(k), all, 6000);
const byRandom = [...keys].sort((a, b) => eqRandom[b] - eqRandom[a]);
// 상위 25% 콤보
const topSet = new Set<string>();
let acc = 0;
for (const k of byRandom) { if (acc >= 1326 * 0.25) break; topSet.add(k); acc += comboCount(k); }
const topCombos = all.filter((i) => topSet.has(COMBO_KEYS[i]));
const eqTop: Record<string, number> = {};
for (const k of keys) eqTop[k] = equity(repr(k), topCombos, 4000);

const score = (k: string) => 0.5 * eqRandom[k] + 0.5 * eqTop[k];
const sorted = [...keys].sort((a, b) => score(b) - score(a));
let cum = 0;
const out = sorted.map((k, rank) => {
  const c = comboCount(k);
  const pct = ((cum + c / 2) / 1326) * 100;
  cum += c;
  return { key: k, rank: rank + 1, combos: c, eqRandom: +eqRandom[k].toFixed(4), eqTop25: +eqTop[k].toFixed(4), pct: +pct.toFixed(2) };
});
writeFileSync(new URL('../src/data/hand_rank_169.json', import.meta.url), JSON.stringify(out, null, 0));
console.log('top 20:', out.slice(0, 20).map((x) => x.key).join(' '));
console.log('written', out.length);
