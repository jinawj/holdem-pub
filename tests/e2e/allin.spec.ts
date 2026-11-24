import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('reports/screens', { recursive: true });

// 올인 연출 점검: 헤즈업 / 3인 / 4인이 모두 올인 → 쇼다운 핸드 빨간 테두리 + 올인 토큰
for (const n of [2, 3, 4]) {
  for (const vp of [{ name: 'pc', w: 1440, h: 900 }, { name: 'phone', w: 390, h: 844 }]) {
    test(`all-in showdown ${n}p ${vp.name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto('/');
      await page.evaluate(() => indexedDB.deleteDatabase('holdem-pub'));
      await page.goto(`/?demo=allin&n=${n}`);
      await expect(page.locator('.game')).toBeVisible();
      // 내 차례까지 (앞의 AI들은 올인)
      await page.waitForFunction(() => { const s = (window as any).__store.getState(); return s.phase === 'human'; }, null, { timeout: 60_000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `reports/screens/allin-${n}p-${vp.name}-tokens.png` });
      const allin = page.locator('.btn.allin');
      await allin.click();
      await allin.click();
      // 나머지 AI 콜/올인 → 런아웃 → 쇼다운
      await page.waitForFunction(() => { const s = (window as any).__store.getState(); return s.game.t.hand?.street === 'done' || s.screen !== 'game'; }, null, { timeout: 60_000 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `reports/screens/allin-${n}p-${vp.name}-runout.png` });
      await page.waitForTimeout(4900);
      await page.screenshot({ path: `reports/screens/allin-${n}p-${vp.name}-showdown.png` });
      // D 버튼이 보드 카드를 가리지 않음
      const ov = await page.evaluate(() => {
        const d = document.querySelector('.dealer')!.getBoundingClientRect();
        const b = document.querySelector('.center .board')!.getBoundingClientRect();
        return Math.min(d.right, b.right) - Math.max(d.left, b.left) > 1 && Math.min(d.bottom, b.bottom) - Math.max(d.top, b.top) > 1;
      });
      expect(ov).toBe(false);
      const shown = await page.locator('.seat.allin-show').count();
      expect(shown).toBe(n);
      expect(errors).toEqual([]);
    });
  }
}
