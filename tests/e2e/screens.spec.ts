import { test } from '@playwright/test';

// 검토용 화면 캡처 (설정 화면)
for (const vp of [{ name: 'phone', w: 390, h: 844 }, { name: 'pc', w: 1440, h: 900 }]) {
  test(`settings screen ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/');
    await page.evaluate(() => indexedDB.deleteDatabase('holdem-pub'));
    await page.goto('/');
    await page.getByRole('button', { name: /토너먼트 시작/ }).waitFor();
    await page.screenshot({ path: `reports/screens/settings-${vp.name}.png` });
  });
}
