# 다음 세션 인수인계 (먼저 읽을 것)

> 마지막 갱신 2026-11-25. 자세한 설계는 `docs/overview.md`, 진행 기록은 `docs/PROGRESS.md`, 결정 기록은 `docs/DECISIONS.md`.

## 1. 지금 상태 한눈에
- 싱글 테이블 NLH 토너먼트 vs AI. React + Vite + TS, 서버 없음(정적 사이트), 기록은 각자 브라우저(IndexedDB).
- 배포: GitHub Pages 자동 배포. `main`에 push → Actions가 `npm test` + `npm run build` 후 배포. 링크 `https://<아이디>.github.io/holdem-pub/`
- **대상 기기: 모바일 세로·가로만** (PC는 안 씀). UI 수정 시 모바일 점검 테스트 기준.

## 2. 사용자(성진 님) 작업 방식
- 한국어로 소통. 짧고 단계별 설명 선호.
- **UI 수정 → 스크린샷으로 먼저 검토받기 → 승인 후 배포.** 커밋은 Claude가, `git push`는 사용자가 직접.
- 자료조사는 Sonnet 서브에이전트로 (`.claude/agents/researcher.md`, 노력도는 Claude가 조절).
- 세션이 길어지면 커밋 먼저, 핵심만 문서화.

## 3. 실행·확인 명령
| 목적 | 명령 |
|---|---|
| PC에서 실행 | `npm run dev` |
| 같은 와이파이 폰에서 | `npm run dev:phone` → 출력된 Network 주소 |
| 단위 테스트(엔진·AI) | `npm test` (39개) |
| 모바일 화면 점검 | `npx playwright test mobile-audit` (12크기×6/8/10인 + 올인 쇼다운, 약 5분) |
| 전체 화면 테스트 | `npm run e2e` |
| AI 시험지 | `npm run ai:spots` (35문항 142건, 현재 100%) |
| 셀프플레이 | `npm run sim` (5000핸드: 칩 보존·규칙 위반·금지 행동 0건 확인) |
| 듀플리케이트 대결 | `npx tsx scripts/ai-match.ts --pairs 6000` (약 3분, 레벨 서열) |
| 올인 연출 데모 | 개발 서버에서 `?demo=allin&n=2~4` |
| 푸시/폴드 표 재계산 | `npm run gen:pushfold` (약 1분, 캐시 `scripts/.cache`) |
- Windows PowerShell에서는 `npm run x -- --옵션`의 `--`가 사라짐 → `npx tsx scripts/... --옵션`으로 직접 실행.
- 반영(사용자): `git add .` → `git commit -m "..."` → `git push`

## 4. 파일 지도 (고칠 때 어디를 보나)
```
src/config.ts            튜닝 숫자 모음 (AI 속도·최소 고민 시간·액션 간격·연출 기준·난이도·AI 공통값)
src/data/*.json          블라인드 표, 칩 색, 닉네임, 성향(personas), 169핸드 순위, 푸시/폴드 표
src/engine/              규칙 엔진 (순수 TS, UI 의존 금지). hand.ts=핸드 진행, positions.ts=데드 버튼, tournament.ts
src/ai/v1/               AI. index.ts=decide() 흐름, preflop.ts(푸시/폴드·기어 변화 gear()), postflop.ts,
                         range.ts(상대 레인지), equity.ts, habits.ts(습관·릭), human.ts(실수 방향·텔·고민 시간·기억),
                         persona.ts(레벨 효과 levelFx·프로필 생성·난이도 배정), guards.ts(금지 행동), pushfold.ts(표 조회)
src/ai/worker.ts,client.ts  Web Worker 실행
src/game/                headless.ts(화면 없는 진행·시뮬), spot.ts(시험지 재현), summary.ts(핸드 기록), stats.ts
src/ui/store.ts          게임 상태·저장·액션 (zustand)
src/ui/Game.tsx          게임 화면 + 진행 드라이버(AI 차례·대기·핸드 종료) + buildTableModel
src/ui/Table.tsx         테이블 렌더링 + 모든 연출(딜링·플랍·칩 이동·승자). 연출 시간표 = timings()
src/ui/layout.ts         좌석·보드·내 카드 크기·베팅칩 위치 계산 (화면 크기 기반). 딜러 버튼·올인 토큰은 사용자 결정으로 삭제됨
src/ui/Controls.tsx      베팅 조작부(25%/50%/Pot/2x, 직접 입력, 슬라이더)
src/ui/styles.css        전체 스타일. 모바일 가로 낮은 화면은 @media (orientation: landscape) and (max-height: 500px)
tests/                   engine/positions/ai 단위 테스트, tests/e2e(화면), tests/ai-spots/spots.json(AI 시험지)
scripts/                 sim, ai-spots, ai-match, ai-cli, generate-hand-rank, generate-pushfold
```

## 5. 지켜야 할 것 (깨지기 쉬운 곳)
- 엔진 규칙 변경 시 `tests/engine.test.ts`·`positions.test.ts` 먼저. AI는 `PlayerView`만 받음(공정성).
- UI 위치는 전부 `layout.ts`의 `computeGeometry()` 기준. 보드·내 카드 크기도 여기서 계산 → `Table.tsx`의 `cardVars`가 CSS 변수로 전달.
- 연출 대기: Table이 `onHold(until)`로 진행을 멈추고, Game 드라이버가 `holdUntil`·`ACTION_GAP_MS`·`MIN_THINK_MS`를 지킴. 연출 시간 바꿀 땐 `timings()`와 config 값만.
- 저장 형식: `GameSave`(store.ts) 필드 추가 시 optional로, 예전 저장도 열리게. 버전 변환은 `persist/file.ts migrateSave`.
- GitHub Actions가 `npm test`와 `tsc`를 돌림 → 타입 에러나 단위 테스트 실패면 배포 안 됨.

## 6. AI 현황 (2026-11-25)
- 성향 7종(솔버·레귤러·공격수·끝까지 간다·바위·올인맨·입문자) × Lv1~10, 난이도 3단계(보통 Lv3–7·어려움 Lv5–8·매우 어려움 Lv7–10).
- 이번 개선: 직접 계산한 푸시/폴드 표(헤즈업 10BB SB 58.2%/BB 37.1%, 참고값 56.6/38.5), 무작위 실수 → 수동적·과다 콜 방향 실수, 레벨별 텔(Lv5 이하, 솔버·레귤러 없음), 기어 변화(초반 피쉬 느슨·칩리더 압박·숏스택 조급).
- 측정: 시험지 100%, 성향 통계 대부분 목표 안, 듀플리케이트 레벨 서열 6/8.
- **남은 AI 문제**: 피쉬 구간(Lv1–3)에서 끝까지 간다 Lv1이 Lv3보다 덜 짐(역전). 바위 Lv3→5 차이 유의하지 않음. 멀티웨이 푸시 범위는 근사(콜러 1명 가정).
- 상대 착취(사람 분석)는 **하지 않기로 결정**. 쇼다운 기억 반응만 있음(설정에서 끌 수 있음).

## 7. 다음 할 일 후보
1. 피쉬 레벨 역전 원인 분석(끝까지 간다 Lv1 vs Lv3) — 습관·릭 조합별로 공통 상대 대결
2. 난이도 체감 측정: "적당히 잘 치는 봇"을 내 자리에 앉혀 난이도별 우승률 측정 → 필요하면 '쉬움' 추가
3. AI "사람 같았음" 평가(토너먼트 후 1~5점) — overview 3.7 ⑨
4. 파일 구조 정리(보류 중): Game.tsx의 드라이버·모델 분리, Table.tsx 연출 분리, 빈 `src/history` 폴더 정리
5. 복기 화면에 "AI 기준" 비교 표시(지금은 기록만)
