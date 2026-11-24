import { test } from '@playwright/test';

// 검토용: 플랍 연출 프레임 캡처 (뒤집힌 3장 따다닥 → 촤라락 펼침)
test('flop animation frames', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('holdem-pub'));
  await page.goto('/?demo=allin&n=2');
  await page.waitForFunction(() => (window as any).__store.getState().phase === 'human', null, { timeout: 60_000 });
  await page.locator('.btn.allin').click();
  await page.locator('.btn.allin').click();
  await page.waitForFunction(() => (window as any).__store.getState().game.t.hand?.street === 'done', null, { timeout: 60_000 });
  const t0 = Date.now();
  for (const ms of [900, 1600, 1850, 2300, 2800]) {
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
    await page.locator('.center').screenshot({ path: `reports/screens/flop-${ms}ms.png` });
  }
});
