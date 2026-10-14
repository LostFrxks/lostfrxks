const { test, expect } = require('@playwright/test');
const deck = 'https://docs.google.com/presentation/d/1Yz8wQllowqjtcKnuLS4HyaBj7IaRF8S-tE8SXgpzGqo/edit';
async function openTalk(page) {
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204 }));
  await page.goto('/');
  await page.locator('#intro-screen').click();
  await expect(page.locator('#intro-screen')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('#talks')?.scrollIntoView(); });
  await expect(page.locator('#talks')).toHaveClass(/matrix-revealed/);
}

test('speaking block uses the final deck and loads the viewer only on request', async ({ page, request }) => {
  const slideRequests = [];
  page.on('request', req => { if (/slide-\d+\.png/.test(req.url())) slideRequests.push(req.url()); });
  await openTalk(page);
  const section = page.locator('#talks');
  await expect(section).toContainText('250,000');
  await expect(section).toContainText('19 Sep 2026');
  await expect(section).toContainText('2,159,215');
  await expect(section.locator('a', { hasText: 'Google Slides' })).toHaveAttribute('href', deck);
  await expect(page.locator('#talk-deck')).not.toBeVisible();
  expect(slideRequests.every(url => url.endsWith('slide-01.png'))).toBe(true);
  const response = await request.get(await section.locator('a[download]').getAttribute('href'));
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const trigger = section.getByRole('button', { name: 'View the 15-slide presentation' });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-talk-counter]')).toHaveText('01 / 15');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-talk-counter]')).toHaveText('02 / 15');
  await page.keyboard.press('End');
  await expect(page.locator('[data-talk-counter]')).toHaveText('15 / 15');
  await expect(page.getByRole('button', { name: 'Next slide' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('mobile speaking block and slide viewer fit narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openTalk(page);
  await expect(page.locator('#talks')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.locator('#talks').getByRole('button', { name: 'View the 15-slide presentation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const image = page.locator('[data-talk-slide]');
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  const box = await image.boundingBox();
  await expect(image).toHaveCSS('touch-action', 'pan-y pinch-zoom');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(page.locator('[data-talk-counter]')).toHaveText('02 / 15');
  await page.getByRole('button', { name: 'Close presentation' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('slide navigation keeps keyboard focus inside the viewer at both boundaries', async ({ page }) => {
  await openTalk(page);
  await page.locator('#talks').getByRole('button', { name: 'View the 15-slide presentation' }).click();
  const next = page.getByRole('button', { name: 'Next slide' });
  for (let index = 0; index < 14; index++) await next.click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-talk-counter]')).toHaveText('14 / 15');
  await page.keyboard.press('Home');
  await next.click();
  await page.getByRole('button', { name: 'Previous slide' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-talk-counter]')).toHaveText('02 / 15');
  expect(await page.evaluate(() => document.querySelector('#talk-deck').contains(document.activeElement))).toBe(true);
});

test('speaking effects pause offscreen and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTalk(page);
  await expect(page.locator('#talks')).toHaveAttribute('data-talk-motion', 'paused');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#talks')).toHaveAttribute('data-talk-motion', 'running');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('#talks')).toHaveAttribute('data-talk-motion', 'paused');
});
