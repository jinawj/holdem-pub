// 상황별 시험장 (최고 레벨 봇 성능 끌어올리기용, 화면 없음) — 공용 부분은 scripts/sit-core.ts
//  흔한 토너먼트 상황(딥스택·중간·숏스택·나만 숏스택·나만 빅스택·스택 섞임·헤즈업)을 만들고
//  주인공(v3 최고 레벨)을 한 자리에 앉혀 고정된 상대들(v2 여러 성향 — 코드가 바뀌어도 그대로)과 친다.
//
//  --mode audit : 주인공 통계를 레귤러 목표 범위와 비교 + 사고 과정 모순(생각과 행동이 어긋난 결정) 개수 — 튜닝의 기준 (빠름, 토큰 0)
//  --mode score : 같은 카드·같은 스택·같은 자리를 '주인공'과 '기준 봇(v2 솔버 Lv10)'이 각각 한 번씩 친다 (듀플리케이트).
//                 주인공 − 기준 = 그 자리에서 기준보다 몇 BB 더 벌었나. 상황별 bb/100
//  --mode log   : 상황별로 주인공이 참여한 핸드를 생각 과정과 함께 기록 (리뷰어용)
//
// 예) npx tsx scripts/ai-situations.ts --mode audit --hands 3000
//     npx tsx scripts/ai-situations.ts --mode score --hands 6000 [--only short,heroShort] [--style pressure]
//     npx tsx scripts/ai-situations.ts --mode log --hands 12 --seed 2 --out reports/sit-log.md
//     npx tsx scripts/ai-situations.ts --mode log --contra foldAbovePrice --hands 10 : 그 모순이 나온 결정만 기록
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as V3 from '../src/ai/v3';
import { cardToString } from '../src/engine/cards';
import { arg, makeRng, mean, sd, table } from './lib';
import { audit, BB, Bot, btnOf, detect, fmtAudit, heroStats, makeField, play, posName, rs, SCENARIOS, shown, St, statValue, v2Bot, v3Bot } from './sit-core';

const mode = arg('mode', 'audit');
const heroLevel = +arg('level', '10');
const heroStyle = arg('style', '') || undefined;
const t0 = Date.now();
const only = arg('only', '') ? arg('only', '').split(',') : null;
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));

const SHOW = ['VPIP', 'PFR', 'RFI UTG', 'RFI BTN', 'RFI SB', 'RFI HU SB', 'BB 수비', 'BB 3벳', 'BB 외 플랫', 'BB 외 3벳', '3벳에 폴드', 'C벳', '턴 배럴', 'C벳에 폴드', '체크레이즈', '동크', 'AF', 'WTSD', 'W$SD'];
function fmtStats(s: St) {
  return SHOW.map((k) => { const x = statValue(s, k); return x ? `${k} ${k === 'AF' ? x.v.toFixed(1) : x.v.toFixed(0) + '%'}` : null; }).filter(Boolean).join(' · ');
}

if (mode === 'audit') {
  const a = audit({ scenarios, hands: +arg('hands', '3000'), level: heroLevel, style: heroStyle });
  console.log(`=== 상황별 점검: 주인공 v3 Lv${heroLevel}${heroStyle ? ' ' + heroStyle : ''} (상황당 ${arg('hands', '3000')}핸드) ===`);
  console.log(fmtAudit(a));
  console.log('\n주인공 통계:');
  for (const [k, st] of Object.entries(a.stats)) console.log(`- ${k}: ${fmtStats(st)}`);
} else if (mode === 'score') {
  const hands = +arg('hands', '1500');
  const rows: (string | number)[][] = [];
  const statLines: string[] = [];
  const allDiff: number[] = [];
  for (const sc of scenarios) {
    const si = SCENARIOS.indexOf(sc); // --only 를 써도 같은 상황은 같은 시드
    const R = makeRng(9000 + si * 31);
    const diff: number[] = [], heroRes: number[] = [], refRes: number[] = [];
    const st: St = {};
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
      heroStats(st, a.h, heroSeat, a.btn, sc.n);
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
  // 주인공이 자발적으로 참여한 핸드만 (상황당 --hands 개까지). --contra 이름 이면 그 모순이 나온 핸드만
  const want = +arg('hands', '14');
  const out = arg('out', 'reports/sit-log.md');
  const seedN = +arg('seed', '1');
  const contraOnly = arg('contra', '') || null;
  const cs = (c: number) => cardToString(c);
  const lines: string[] = [`# 상황별 핸드 기록 — 주인공 v3 Lv${heroLevel}${heroStyle ? ' ' + heroStyle : ''} (seed ${seedN}${contraOnly ? ', 모순 ' + contraOnly + '만' : ''})`, '',
    '상대는 고정된 v2 봇들(레귤러 Lv8·솔버 Lv9·공격수 Lv7·끝까지 간다(콜스테이션) Lv5·바위 Lv6·올인맨(매니악) Lv5, 헤즈업은 레귤러/솔버). 스택은 핸드 시작 기준 BB. 주인공(★) 결정 아래 줄이 생각 과정.', ''];
  for (const sc of scenarios) {
    const si = SCENARIOS.indexOf(sc);
    const R = makeRng(seedN * 1000 + si * 17);
    const hero = v3Bot(heroLevel, heroStyle);
    lines.push(`# 상황: ${sc.name}`, '');
    let got = 0;
    for (let k = 0; k < (contraOnly ? 20000 : 400) && got < want; k++) {
      const heroSeat = k % sc.n;
      const seed = R.seedStr();
      const stacks = sc.stacks(heroSeat, R.rand);
      const field = makeField(sc, k, 700 + k);
      const log: string[] = [];
      let lastStreet = '';
      let keep = false;
      const btn = btnOf(k, sc.n);
      const { h } = play(sc, k, seed, stacks, heroSeat, hero, field, makeRng(seedN * 7 + k).rand, (hs, seat, view, d) => {
        const street = hs.street;
        if (street !== lastStreet) { lastStreet = street; log.push(`- **${street}**${view.board.length ? ` [${view.board.map(cs).join(' ')}]` : ''} 팟 ${(view.potTotal / BB).toFixed(1)}BB`); }
        const act = d.type === 'raise' ? `${view.legal.currentBet > 0 ? '레이즈' : '벳'} ${(d.to / BB).toFixed(1)}BB${d.to >= view.legal.maxRaiseTo ? '(올인)' : ''}` : ({ fold: '폴드', check: '체크', call: `콜 ${(view.legal.callAmount / BB).toFixed(1)}BB` } as any)[d.type];
        const who = `${posName(seat, btn, sc.n)}`;
        if (seat === heroSeat) {
          let flag = '';
          if (contraOnly) { const c: St = {}; detect(c, view, d); if (c[contraOnly]) { keep = true; flag = ' ⚠'; } }
          else if (d.type !== 'fold' || d.memo.options.some((o: any) => o.key !== 'fold' && o.p >= 0.15)) keep = true;
          log.push(`  - ★ ${who} (${view.holeCards.map(cs).join('')}) → **${act}**${d.memo.intent && d.memo.intent !== 'none' ? ` _(${V3.intentName(d.memo.intent)})_` : ''}${flag}`);
          for (const t of d.memo.thoughts ?? []) log.push(`    - ${t}`);
          log.push(`    - 확률: ${d.memo.options.filter((o: any) => o.p > 0).map((o: any) => `${o.key.startsWith('raise:') ? 'R' + (+o.key.slice(6) / BB).toFixed(1) : o.key} ${(o.p * 100).toFixed(0)}%`).join(', ')}`);
        } else if (!(street === 'preflop' && d.type === 'fold') && !hs.players[heroSeat].folded) {
          log.push(`  - ${who} ${fieldBot(field, seat, heroSeat).name}: ${act}`);
        }
      });
      if (!keep) continue;
      got++;
      const hp = h.players[heroSeat];
      const shownStr = shown(h).filter((x) => x.seat !== heroSeat).map((x) => `${posName(x.seat, btn, sc.n)} ${x.hole.map(cs).join('')}`).join(', ');
      lines.push(`## ${sc.id}-${got} · 주인공 ${posName(heroSeat, btn, sc.n)} ${stacks[heroSeat]}BB · 스택 ${stacks.map((x, s) => `${posName(s, btn, sc.n)} ${x}`).join(' / ')}`, ...log,
        `- 결과: 주인공 ${hp.stack >= hp.startStack ? '+' : ''}${((hp.stack - hp.startStack) / BB).toFixed(1)}BB${shownStr ? ` · 상대 공개 ${shownStr}` : ''} · 보드 ${h.board.map(cs).join(' ') || '-'}`, '');
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n'));
  console.log(`기록 저장: ${out}`);
}
console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(0)}초`);

function fieldBot(field: Bot[], seat: number, heroSeat: number): Bot { return field[seat < heroSeat ? seat : seat - 1]; }
