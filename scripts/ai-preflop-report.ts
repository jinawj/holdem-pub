// 프리플랍 범위 점검: 169핸드 전부(콤보 가중)로 상황별 참여율을 잰다
// 실행: npx tsx scripts/ai-preflop-report.ts [--stack 200] [--v 1]  (v1과 비교하려면 --v 1)
import rank169 from '../src/data/hand_rank_169.json';
import * as V2 from '../src/ai/v2';
import * as V1 from '../src/ai/v1';
import { makePlayerView } from '../src/engine/view';
import { buildSpot, SpotDef } from '../src/game/spot';
import { arg, makeRng, table } from './lib';

const stack = +arg('stack', '200');
const useV1 = arg('v', '2') === '1';
const AI = useV1 ? V1 : V2;
const R = makeRng(5);
const SUITS = 'shdc';
const handStr = (key: string) => key.length === 2 ? `${key[0]}s${key[1]}h` : key[2] === 's' ? `${key[0]}s${key[1]}s` : `${key[0]}s${key[1]}h`;

const spots: { name: string; def: Omit<SpotDef, 'heroHand'> }[] = [
  { name: 'UTG 오픈', def: { id: 'a', desc: '', hero: 3, moves: [], stacksBB: stack, expect: {} } },
  { name: 'BTN 오픈 (앞 폴드)', def: { id: 'b', desc: '', hero: 0, moves: ['f', 'f', 'f'], stacksBB: stack, expect: {} } },
  { name: 'BB 방어 vs BTN 2.5x', def: { id: 'c', desc: '', hero: 2, moves: ['f', 'f', 'f', 'r:2.5', 'f'], stacksBB: stack, expect: {} } },
  { name: 'BB 방어 vs UTG 2.5x', def: { id: 'd', desc: '', hero: 2, moves: ['r:2.5', 'f', 'f', 'f', 'f'], stacksBB: stack, expect: {} } },
  { name: 'BTN 콜드 vs CO 2.5x', def: { id: 'e', desc: '', hero: 0, moves: ['f', 'f', 'r:2.5'], stacksBB: stack, expect: {} } },
];
void SUITS;
const who: [string, number][] = [['solver', 10], ['reg', 8], ['lag', 8], ['nit', 6], ['station', 3], ['beginner', 2]];
const rows: (string | number)[][] = [];
for (const [id, lv] of who) {
  const row: (string | number)[] = [`${(AI.PERSONAS as any)[id].name} Lv${lv}`];
  for (const s of spots) {
    let play = 0, raise = 0, tot = 0;
    for (const h of rank169 as { key: string; combos: number }[]) {
      const hand = buildSpot({ ...s.def, heroHand: handStr(h.key) } as SpotDef, handStr(h.key));
      const view = makePlayerView(hand, s.def.hero, hand.players.length);
      for (let t = 0; t < 6; t++) {
        const d = (AI as any).decide(view, (AI as any).makeProfile(id, lv, R.rand), (AI as any).newMemory(), { rand: R.rand, quick: true });
        if (d.type !== 'fold' && d.type !== 'check') play += h.combos;
        if (d.type === 'raise') raise += h.combos;
        tot += h.combos;
      }
    }
    row.push(`${((100 * play) / tot).toFixed(0)}% (레이즈 ${((100 * raise) / tot).toFixed(0)})`);
  }
  rows.push(row);
}
console.log(`프리플랍 참여율 (${useV1 ? 'v1' : 'v2'}, ${stack}BB, 6인)`);
console.log(table(rows, ['AI', ...spots.map((s) => s.name)]));
