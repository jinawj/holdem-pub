// 모바일 화면 점검: 흔한 폰 크기(세로·가로) × 6/8/10인에서 안 보이거나 잘리거나 겹치는 곳 찾기
// 실행: npx playwright test mobile-audit   → 결과 reports/mobile-audit.json, 스크린샷 reports/screens/mobile/
import { expect, Page, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('reports/screens/mobile', { recursive: true });

const PORTRAIT = [
  { name: 'SE', w: 375, h: 667 },
  { name: 'small-android', w: 360, h: 640 },
  { name: 'android', w: 360, h: 780 },
  { name: 'iphone', w: 390, h: 844 },
  { name: 'pixel', w: 412, h: 915 },
  { name: 'promax', w: 430, h: 932 },
];
const SIZES = [
  ...PORTRAIT.map((p) => ({ ...p, name: p.name + '-P' })),
  ...PORTRAIT.map((p) => ({ name: p.name + '-L', w: p.h, h: p.w })),
];

type R = { l: number; t: number; r: number; b: number };

async function audit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const rect = (el: Element): R => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const ov = (a: R, b: R) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1;
    const inside = (a: R, b: R) => a.l >= b.l - 1 && a.t >= b.t - 1 && a.r <= b.r + 1 && a.b <= b.b + 1;
    const p: string[] = [];
    const screen = { l: 0, t: 0, r: vw, b: vh };
    const area = rect(document.querySelector('.table-area')!);
    const seats = [...document.querySelectorAll('.seat:not(.empty)')].map((s) => {
      const np = rect(s.querySelector('.nameplate')!);
      const hEl = s.querySelector('.hole:not(.mucked):not(.gone)');
      const h = hEl ? rect(hEl) : np;
      return { el: s, box: { l: Math.min(np.l, h.l), t: Math.min(np.t, h.t), r: Math.max(np.r, h.r), b: Math.max(np.b, h.b) } };
    });
    const board = rect(document.querySelector('.center .board')!);
    const controls = [...document.querySelectorAll('.control-area button, .control-area input, .control-area .bigslider')].map(rect);
    const hud = [...document.querySelectorAll('.hud > :not(.info)')].map(rect);
    const pot = [...document.querySelectorAll('.pot .chipamt')].map(rect);
    seats.forEach((s, i) => {
      if (!inside(s.box, area)) p.push(`자리${i} 테이블 영역 밖으로 잘림`);
      seats.forEach((o, j) => { if (j > i && ov(s.box, o.box)) p.push(`자리${i}·자리${j} 겹침`); });
      if (ov(s.box, board)) p.push(`자리${i}가 보드를 가림`);
      pot.forEach((c) => { if (ov(s.box, c)) p.push(`자리${i}가 팟 금액을 가림`); });
      controls.forEach((c) => { if (ov(s.box, c)) p.push(`자리${i}·조작부 겹침`); });
      const nm = s.el.querySelector('.nm') as HTMLElement;
      if (nm && nm.scrollWidth > nm.clientWidth + 1) p.push(`자리${i} 이름 잘림`);
    });
    if (!inside(board, area)) p.push('보드가 테이블 영역 밖');
    document.querySelectorAll('.act-label').forEach((el, i) => {
      const r = rect(el);
      if (r.r - r.l === 0) return; // 숨긴 말풍선
      if (!inside(r, area)) p.push(`액션 말풍선${i} 잘림`);
      // 다른 자리(특히 내 카드)를 가리면 안 됨
      const own = el.closest('.seat');
      seats.forEach((s, j) => { if (s.el !== own && ov(r, s.box)) p.push(`액션 말풍선${i}이 자리${j}를 가림`); });
      if (ov(r, board)) p.push(`액션 말풍선${i}이 보드를 가림`);
    });
    pot.forEach((c) => { if (!inside(c, area)) p.push('팟 금액 잘림'); });
    controls.forEach((c, i) => {
      if (!inside(c, screen)) p.push(`조작부${i} 화면 밖`);
      if (c.b - c.t < 34) p.push(`조작부${i} 너무 작음(${Math.round(c.b - c.t)}px)`);
    });
    hud.forEach((c, i) => { if (!inside(c, screen)) p.push(`상단${i} 화면 밖`); hud.forEach((o, j) => { if (j > i && ov(c, o)) p.push(`상단${i}·${j} 겹침`); }); });
    const lvl = document.querySelector('.hud .lvl') as HTMLElement;
    if (lvl && lvl.scrollWidth > lvl.clientWidth + 1) p.push('상단 블라인드·시간 글자 잘림');
    if (document.documentElement.scrollWidth > vw + 1) p.push('가로 스크롤 생김');
    return p;
  });
}

const all: Record<string, string[]> = {};

for (const s of SIZES) {
  for (const n of [6, 8, 10]) {
    test(`audit ${s.name} ${s.w}x${s.h} ${n}p`, async ({ page }) => {
      await page.setViewportSize({ width: s.w, height: s.h });
      await page.goto('/');
      await page.evaluate(() => indexedDB.deleteDatabase('holdem-pub'));
      await page.goto('/');
      await page.getByRole('button', { name: `${n}명`, exact: true }).click();
      await page.getByRole('button', { name: '빠름', exact: true }).click();
      await page.getByRole('button', { name: /토너먼트 시작/ }).click();
      await page.waitForFunction(() => (window as any).__store.getState().phase === 'human', null, { timeout: 60_000 });
      await page.waitForTimeout(400);
      const probs = await audit(page);
      all[`${s.name} ${s.w}x${s.h} ${n}p`] = probs;
      if (n === 10 || probs.length) await page.screenshot({ path: `reports/screens/mobile/${s.name}-${n}p.png` });
      writeFileSync('reports/mobile-audit.json', JSON.stringify(all, null, 1));
      expect(probs, probs.join(', ')).toEqual([]);
    });
  }
}

// 올인 쇼다운 화면 (WIN 배너·토큰·빨간 테두리)
for (const s of [SIZES[0], SIZES[3], SIZES[6], SIZES[9]]) {
  test(`audit showdown ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto('/');
    await page.evaluate(() => indexedDB.deleteDatabase('holdem-pub'));
    await page.goto('/?demo=allin&n=4');
    await page.waitForFunction(() => (window as any).__store.getState().phase === 'human', null, { timeout: 60_000 });
    await page.locator('.btn.allin').click();
    await page.locator('.btn.allin').click();
    await page.waitForFunction(() => (window as any).__store.getState().game.t.hand?.street === 'done', null, { timeout: 60_000 });
    await page.waitForTimeout(7800);
    const probs = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const p: string[] = [];
      document.querySelectorAll('.win-banner').forEach((el) => { const r = el.getBoundingClientRect(); if (r.left < -1 || r.right > vw + 1 || r.top < -1) p.push('WIN 배너 잘림'); });
      document.querySelectorAll('.hand-name').forEach((el, i) => { const r = el.getBoundingClientRect(); if (r.left < 0 || r.right > vw || r.bottom > vh) p.push(`족보 이름${i} 잘림`); });
      return p;
    });
    all[`showdown ${s.name}`] = probs;
    await page.screenshot({ path: `reports/screens/mobile/showdown-${s.name}.png` });
    writeFileSync('reports/mobile-audit.json', JSON.stringify(all, null, 1));
    expect(probs, probs.join(', ')).toEqual([]);
  });
}
