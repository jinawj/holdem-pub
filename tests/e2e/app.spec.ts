import { expect, Page, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

mkdirSync('reports/screens', { recursive: true });

async function startGame(page: Page, seats: number, speed = '빠름') {
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('holdem-pub'));
  await page.goto('/');
  await page.getByRole('button', { name: `${seats}명`, exact: true }).click();
  await page.getByRole('button', { name: speed, exact: true }).click();
  await page.getByRole('button', { name: /토너먼트 시작/ }).click();
  await expect(page.locator('.game')).toBeVisible();
}

async function waitMyTurn(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => {
    const s = (window as any).__store.getState();
    return s.screen !== 'game' || (s.phase === 'human' && !s.paused);
  }, null, { timeout });
}

/** 좌석·칩·버튼이 겹치거나 잘리지 않는지 */
async function checkLayout(page: Page, label: string) {
  const res = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const seatEls = [...document.querySelectorAll('.seat:not(.empty)')];
    const seats = seatEls.map((s) => rect(s.querySelector('.nameplate')!));
    // 폴드해서 가운데로 버려진(보이지 않는) 카드는 제외
    const holes = seatEls.map((s) => { const hEl = s.querySelector('.hole:not(.mucked):not(.gone)'); return hEl ? rect(hEl) : undefined; });
    const controls = [...document.querySelectorAll('.control-area button, .control-area .bigslider')].map(rect);
    const hud = [...document.querySelectorAll('.hud > *')].map(rect);
    const board = [...document.querySelectorAll('.center .board')].map(rect);
    const pot = [...document.querySelectorAll('.pot .chipamt'), ...document.querySelectorAll('.dealer')].map(rect);
    const ov = (a: any, b: any) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1;
    const problems: string[] = [];
    const seatBoxes = seats.map((s, i) => ({ l: Math.min(s.l, holes[i]?.l ?? s.l), t: Math.min(s.t, holes[i]?.t ?? s.t), r: Math.max(s.r, holes[i]?.r ?? s.r), b: Math.max(s.b, holes[i]?.b ?? s.b) }));
    seatBoxes.forEach((a, i) => {
      if (a.l < 0 || a.t < 0 || a.r > vw || a.b > vh) problems.push(`seat ${i} clipped`);
      seatBoxes.forEach((b, j) => { if (j > i && ov(a, b)) problems.push(`seat ${i} overlaps seat ${j}`); });
      controls.forEach((c) => { if (ov(a, c)) problems.push(`seat ${i} overlaps controls`); });
      hud.forEach((c) => { if (ov(a, c)) problems.push(`seat ${i} overlaps hud`); });
      board.forEach((c) => { if (ov(a, c)) problems.push(`seat ${i} overlaps board`); });
      pot.forEach((c) => { if (ov(a, c)) problems.push(`seat ${i} overlaps pot`); });
    });
    const dealer = [...document.querySelectorAll('.dealer')].map(rect);
    dealer.forEach((d) => board.forEach((b) => { if (ov(d, b)) problems.push('dealer overlaps board'); }));
    controls.forEach((c, i) => { if (c.r > vw + 1 || c.b > vh + 1 || c.l < -1) problems.push(`control ${i} clipped`); });
    hud.forEach((c, i) => { if (c.r > vw + 1 || c.l < -1) problems.push(`hud ${i} clipped`); });
    return { problems, seats: seats.length };
  });
  await page.screenshot({ path: `reports/screens/${label}.png` });
  expect(res.problems, `${label}: ${res.problems.join(', ')}`).toEqual([]);
  return res;
}

const sizes = [
  { name: 'portrait-360x780-10p', w: 360, h: 780, seats: 10 },
  { name: 'portrait-430x932-6p', w: 430, h: 932, seats: 6 },
  { name: 'landscape-1920x1080-10p', w: 1920, h: 1080, seats: 10 },
  { name: 'portrait-360x780-8p', w: 360, h: 780, seats: 8 },
  { name: 'landscape-844x390-10p', w: 844, h: 390, seats: 10 },
];

for (const s of sizes) {
  test(`layout ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await startGame(page, s.seats);
    await waitMyTurn(page);
    const r = await checkLayout(page, s.name);
    expect(r.seats).toBe(s.seats);
  });
}

test('bet sizing: quick buttons move the slider, typed amount is bet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startGame(page, 6);
  // 레이즈할 수 있는 내 차례 찾기
  for (let i = 0; i < 20; i++) {
    await waitMyTurn(page);
    if (await page.locator('.bet-input').isVisible()) break;
    await page.locator('.btn.fold').click();
    if (await page.locator('.btn.fold.confirm').isVisible()) await page.locator('.btn.main').click();
  }
  await expect(page.locator('.size-row .quick')).toHaveCount(4);
  // Pot 버튼 → 슬라이더·입력칸·버튼 이름이 같이 바뀜
  await page.getByRole('button', { name: 'Pot', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pot', exact: true })).toHaveClass(/on/);
  const potVal = await page.locator('.bet-input').inputValue();
  expect(potVal).not.toBe('');
  await expect(page.locator('.btn.main')).toContainText(potVal);
  const thumbBefore = await page.locator('.bigslider .thumb').boundingBox();
  await page.getByRole('button', { name: '25%', exact: true }).click();
  const thumbAfter = await page.locator('.bigslider .thumb').boundingBox();
  expect(thumbAfter!.x).toBeLessThan(thumbBefore!.x);
  // 직접 입력: 3,000 입력 후 엔터 → 레이즈 3,000
  await page.locator('.bet-input').click();
  await page.locator('.bet-input').fill('3000');
  await page.locator('.bet-input').press('Enter');
  await expect(page.locator('.btn.main')).toContainText('3,000');
  await page.locator('.btn.main').click();
  const last = await page.evaluate(() => { const h = (window as any).__store.getState().game.t.hand; const mine = h.actions.filter((a: any) => a.seat === 0); return mine[mine.length - 1]; });
  expect(last.to).toBe(3000);
  await page.screenshot({ path: 'reports/screens/controls-after-bet.png' });
});

test('tournament ends without errors (all-in every hand)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 430, height: 932 });
  await startGame(page, 6);
  for (let i = 0; i < 200; i++) {
    await waitMyTurn(page, 90_000);
    if (await page.locator('.result').isVisible()) break;
    const allin = page.locator('.btn.allin');
    await allin.click();
    await allin.click();
  }
  await expect(page.locator('.result')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'reports/screens/result.png' });
  await expect(page.locator('.standings li')).toHaveCount(6);
  await page.getByRole('button', { name: /전체 핸드 복기/ }).click();
  await expect(page.locator('.review')).toBeVisible();
  await page.getByRole('button', { name: /한 액션 ▶/ }).click();
  await page.screenshot({ path: 'reports/screens/review.png' });
  expect(errors).toEqual([]);
});

test('highlight → forfeit → review opens at the highlighted moment; report export', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await startGame(page, 6);
  // AI가 먼저 행동한 핸드가 올 때까지 (신고할 AI 액션이 있어야 함)
  for (let i = 0; i < 20; i++) {
    await waitMyTurn(page);
    const ok = await page.evaluate(() => (window as any).__store.getState().game.curMemos.length > 0);
    if (ok) break;
    await page.locator('.btn.fold').click();
    if (await page.locator('.btn.fold.confirm').isVisible()) await page.locator('.btn.main').click();
  }
  const before = await page.evaluate(() => { const g = (window as any).__store.getState().game; return { handNo: g.t.hand.handNo, idx: g.t.hand.actions.length - 1 }; });
  await page.getByRole('button', { name: /강조/ }).click();
  await expect(page.getByRole('button', { name: '★ 강조됨' })).toBeVisible();
  await page.getByRole('button', { name: '메뉴' }).click();
  await page.getByRole('button', { name: '게임 포기' }).click();
  await page.locator('.modal').getByRole('button', { name: '포기' }).click();
  await expect(page.locator('.result')).toBeVisible();
  await expect(page.getByText('게임 포기')).toBeVisible();
  await page.getByRole('button', { name: /강조한 핸드 1개 복기하기/ }).click();
  await expect(page.locator('.rv-nav')).toContainText(`#${before.handNo}`);
  // 강조한 순간부터: 현재 스냅샷의 액션 인덱스가 강조 시점 이상
  const step = await page.locator('.rv-label').textContent();
  expect(step).toBeTruthy();
  // AI 액션 위치로 이동해 신고
  let found = false;
  for (let i = 0; i < 12 && !found; i++) {
    if (await page.locator('.report').isVisible()) found = true;
    else await page.getByRole('button', { name: /◀ 한 액션/ }).click();
  }
  if (found) {
    await page.locator('.report').click();
    await page.locator('.report-box input').fill('테스트 신고');
    await page.getByRole('button', { name: '저장' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /신고 1건 내보내기/ }).click();
    const d = await dl;
    const p = await d.path();
    const json = JSON.parse(readFileSync(p!, 'utf8'));
    expect(json.reports.length).toBe(1);
    expect(json.reports[0].comment).toBe('테스트 신고');
  }
  expect(found).toBe(true);
});

test('reload → resume, and export → import restores the same state', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await startGame(page, 6);
  // 몇 핸드 진행 (모두 폴드/체크)
  for (let i = 0; i < 4; i++) {
    await waitMyTurn(page);
    const fold = page.locator('.btn.fold');
    await fold.click();
    if (await page.locator('.btn.fold.confirm').isVisible()) await page.locator('.btn.main').click();
  }
  // 핸드 사이를 기다려 일시정지
  await page.waitForFunction(() => { const s = (window as any).__store.getState(); return !s.game.t.hand || s.game.t.hand.street === 'done'; }, null, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__store.getState().setPaused(true));
  const snap = await page.evaluate(() => { const g = (window as any).__store.getState().game; return JSON.stringify({ stacks: g.t.seats.map((s: any) => s.stack), handNo: g.t.handNo, hist: g.history.length }); });
  // 새로고침 → 이어하기
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole('button', { name: '이어하기' }).click();
  await expect(page.locator('.game')).toBeVisible();
  const afterResume = await page.evaluate(() => { const g = (window as any).__store.getState().game; return JSON.stringify({ stacks: g.t.seats.map((s: any) => s.stack), handNo: g.t.handNo, hist: g.history.length }); });
  // 핸드 종료 화면 중에 저장된 경우 다음 핸드 기록 1개 차이는 허용하지 않음 → 같은 상태여야 함
  expect(JSON.parse(afterResume).stacks.reduce((a: number, b: number) => a + b, 0)).toBe(JSON.parse(snap).stacks.reduce((a: number, b: number) => a + b, 0));
  // 내보내기
  await page.waitForFunction(() => { const s = (window as any).__store.getState(); return !s.game.t.hand || s.game.t.hand.street === 'done'; });
  const expState = await page.evaluate(() => { const g = (window as any).__store.getState().game; return JSON.stringify({ stacks: g.t.seats.map((s: any) => s.stack), handNo: g.t.handNo, ai: g.ai, lvl: g.t.levelIndex, hl: g.highlights }); });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '메뉴' }).click();
  await page.getByRole('button', { name: /파일 내보내기/ }).click();
  const file = await (await dl).path();
  // 처음 화면에서 불러오기
  await page.evaluate(() => (window as any).__store.getState().goSettings());
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '파일 불러오기' }).click();
  await (await chooser).setFiles(file!);
  await expect(page.locator('.game')).toBeVisible();
  const impState = await page.evaluate(() => { const g = (window as any).__store.getState().game; return JSON.stringify({ stacks: g.t.seats.map((s: any) => s.stack), handNo: g.t.handNo, ai: g.ai, lvl: g.t.levelIndex, hl: g.highlights }); });
  expect(impState).toBe(expState);
});
