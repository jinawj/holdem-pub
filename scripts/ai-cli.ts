// AI를 화면 없이 돌리는 CLI (overview 3.13 ④)
// 사용법:
//   npm run ai:cli -- tourney [--seats 6] [--difficulty normal|hard|veryhard] [--verbose]
//   npm run ai:cli -- spot <문항 id> [--persona reg] [--level 9]
//   npm run ai:cli -- report <신고 파일.json>    (복기 화면에서 내보낸 신고를 다시 계산)
import { readFileSync } from 'node:fs';
import { createAiProfiles, decide, makeProfile, newMemory, profileLabel, PERSONA_IDS } from '../src/ai/v2';
import type { PersonaId } from '../src/ai/v2';
import { cardToString } from '../src/engine/cards';
import { actionLabel } from '../src/engine/hand';
import { createTournament } from '../src/engine/tournament';
import { makePlayerView } from '../src/engine/view';
import { newRunStats, runTournament } from '../src/game/headless';
import { buildSpot, SpotDef } from '../src/game/spot';
import nick from '../src/data/nicknames.json';
import { arg, flag, makeRng, mean } from './lib';
import type { Difficulty } from '../src/config';

const mode = process.argv[2] ?? 'tourney';
const R = makeRng(flag('seed') ? +arg('seed', '1') : undefined);

if (mode === 'tourney') {
  const seats = +arg('seats', '6');
  const diff = arg('difficulty', 'normal') as Difficulty;
  const profiles = createAiProfiles(diff, seats, R.rand);
  const names = [...(nick as string[])].sort(() => R.rand() - 0.5).slice(0, seats);
  const t = createTournament(names, null, 40000);
  const rs = newRunStats();
  const { hands } = runTournament(t, profiles, rs, { quick: false, rand: R.rand, handsPerLevel: 12, seedFn: R.seedStr, randInt: R.int });
  console.log(`토너먼트 종료: ${hands}핸드, 레벨 ${t.levelIndex + 1}`);
  const order = [...t.seats].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  for (const s of order) console.log(`${s.place}위  ${s.name.padEnd(6)} ${profileLabel(profiles[s.seat])}`);
  console.log(`결정 ${rs.decisions}회, 평균 계산 ${mean(rs.calcMs).toFixed(2)}ms, 금지 행동 ${Object.keys(rs.forbidden).length}종, 칩 오류 ${rs.chipErrors}`);
} else if (mode === 'spot') {
  const id = process.argv[3];
  const spots: SpotDef[] = JSON.parse(readFileSync(new URL('../tests/ai-spots/spots.json', import.meta.url), 'utf8'));
  const s = spots.find((x) => x.id === id);
  if (!s) { console.log('문항 목록:\n' + spots.map((x) => `  ${x.id}  ${x.desc}`).join('\n')); process.exit(1); }
  const persona = arg('persona', 'reg') as PersonaId;
  const level = +arg('level', '9');
  const h = buildSpot(s, s.heroHand ?? s.heroHands![0]);
  const view = makePlayerView(h, s.hero, h.players.length);
  console.log(`${s.desc}\n내 카드 ${view.holeCards.map(cardToString).join(' ')}  보드 ${view.board.map(cardToString).join(' ')}`);
  console.log('액션: ' + view.actionLog.map((a) => `${a.seat}:${actionLabel(a)}`).join(', '));
  const d = decide(view, makeProfile(persona, level, R.rand), newMemory(), { rand: R.rand });
  console.log(JSON.stringify(d, null, 2));
} else if (mode === 'report') {
  const file = process.argv[3];
  const reports = JSON.parse(readFileSync(file, 'utf8'));
  for (const r of reports.reports ?? reports) {
    console.log(`\n# 핸드 ${r.handNo} 액션 ${r.actionIndex} — "${r.comment}"`);
    console.log('당시 메모:', JSON.stringify(r.memo));
    if (r.view && r.profile) {
      const d = decide(r.view, r.profile, newMemory(), { rand: R.rand });
      console.log('지금 AI 재계산:', d.type, d.to ?? '', JSON.stringify(d.memo.options));
    }
  }
} else {
  console.log('모드: tourney | spot <id> | report <file>. 성향:', PERSONA_IDS.join(', '));
}
