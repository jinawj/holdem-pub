import { test } from '@playwright/test';
for (const s of [{ w: 360, h: 640 }, { w: 390, h: 844 }]) for (const n of [6, 8, 10]) {
  test(`sb-left ${s.w}x${s.h} ${n}p`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto('/');
    await page.evaluate(() => indexedDB.deleteDatabase('holdem-pub'));
    await page.goto('/');
    await page.getByRole('button', { name: `${n}명`, exact: true }).click();
    await page.getByRole('button', { name: '빠름', exact: true }).click();
    await page.getByRole('button', { name: /토너먼트 시작/ }).click();
    for (let k = 0; k < 15; k++) {
      await page.waitForFunction(() => (window as any).__store.getState().phase === 'human', null, { timeout: 60_000 });
      await page.waitForTimeout(400);
      const sb = await page.evaluate(() => { const h = (window as any).__store.getState().game.t.hand; return h ? JSON.stringify({ b: h.button, sb: h.sbSeat ?? h.sb }) : ''; });
      const lbl = await page.locator('.seat').nth(1).locator('.act-label').textContent().catch(() => null);
      if (lbl && /SB/.test(lbl)) { await page.screenshot({ path: `reports/screens/sbleft-${s.w}x${s.h}-${n}p.png` }); console.log('found', sb, lbl); return; }
      await page.getByRole('button', { name: /폴드|체크/ }).first().click();
    }
    console.log('not found');
  });
}
