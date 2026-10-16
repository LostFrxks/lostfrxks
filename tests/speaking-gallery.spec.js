const { test, expect } = require('@playwright/test');

async function openTalk(page) {
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204 }));
  await page.goto('/');
  await page.locator('#intro-screen').click();
  await expect(page.locator('#intro-screen')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('#talks').scrollIntoView(); });
  await expect(page.locator('#talks')).toHaveClass(/matrix-reveal-settled/);
}

test('photo gallery wraps in both directions and remains usable from the keyboard', async ({ page }) => {
  await openTalk(page);
  const gallery = page.getByRole('region', { name: 'MD CONF stage photos' });
  await expect(gallery).toBeVisible();
  const status = gallery.locator('[data-photo-status]');
  await expect(status).toContainText('01 / 03');
  await expect(gallery.locator('[aria-hidden="false"] img')).toHaveAttribute('src', /stage-wide\.webp$/);
  const firstImage = await gallery.locator('[aria-hidden="false"] img').getAttribute('src');
  await gallery.getByRole('button', { name: 'Previous photo' }).click();
  await expect(status).toContainText('03 / 03');
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('02 / 03');
  await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('03 / 03');
  await gallery.getByRole('button', { name: 'Next photo' }).click();
  await expect(status).toContainText('01 / 03');
  expect(await gallery.locator('[aria-hidden="false"] img').getAttribute('src')).toBe(firstImage);
  await page.keyboard.press('Home');
  await expect(status).toContainText('01 / 03');
  await page.keyboard.press('End');
  await expect(status).toContainText('03 / 03');
  await expect(gallery.locator('[data-photo-slide][aria-hidden="false"]')).toHaveCount(1);
});

test('stage intro downloads only after play and pauses when the visitor leaves it', async ({ page }) => {
  const videoRequests = [];
  page.on('request', request => { if (request.url().includes('stage-intro.mp4')) videoRequests.push(request.url()); });
  await openTalk(page);
  expect(videoRequests).toEqual([]);
  const video = page.locator('[data-stage-video]');
  await expect(video).toBeVisible();
  await page.getByRole('button', { name: 'Play stage intro' }).click();
  await expect.poll(() => videoRequests.length).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate(el => !el.paused && el.currentTime > 0)).toBe(true);
  await expect.poll(() => video.evaluate(el => el.videoWidth)).toBe(1920);
  expect(await video.evaluate(el => el.muted)).toBe(false);
  await expect(page.getByRole('button', { name: 'Play stage intro' })).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => video.evaluate(el => el.paused)).toBe(true);
});

test('narrow screen supports touch swipes without overflow or motion when reduced', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTalk(page);
  const gallery = page.getByRole('region', { name: 'MD CONF stage photos' });
  await expect(gallery).toBeVisible();
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * .8, y: box.y + 100 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * .5, y: box.y + 102 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * .2, y: box.y + 105 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(gallery.locator('[data-photo-status]')).toContainText('02 / 03');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const duration = await gallery.locator('[aria-hidden="false"]').evaluate(el => getComputedStyle(el).transitionDuration);
  expect(duration.split(',').every(value => Number.parseFloat(value) <= 0.001)).toBe(true);
});

test('failed intro loading leaves a working retry and a direct video link', async ({ page }) => {
  let requests = 0;
  await page.route('**/stage-intro.mp4', route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 404 }) : route.continue();
  });
  await openTalk(page);
  const play = page.getByRole('button', { name: 'Play stage intro' });
  await play.click();
  await expect(page.locator('[data-stage-video-error]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the video' })).toHaveAttribute('href', /stage-intro\.mp4$/);
  await play.click();
  await expect.poll(() => page.locator('[data-stage-video]').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true);
  await expect(page.locator('[data-stage-video-error]')).not.toBeVisible();
});


test('photos follow a held mouse drag and settle after release outside the stage', async ({ page }) => {
  await openTalk(page);
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  const photo = stage.locator('[data-position="active"]');
  const box = await photo.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + 120 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 100, start.y + 3, { steps: 8 });
  expect((await photo.boundingBox()).x).toBeLessThan(box.x - 20);
  await expect(page.locator('[data-photo-status]')).toContainText('01 / 03');
  const bounds = await stage.boundingBox();
  await page.mouse.move(bounds.x - 20, start.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-photo-status]')).toContainText('02 / 03');
  await expect(stage).toHaveCSS('cursor', 'grab');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test('an interrupted or tiny drag returns the photos without changing the selection', async ({ page }) => {
  await openTalk(page);
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  const photo = stage.locator('[data-position="active"]');
  const box = await photo.boundingBox();
  const x = box.x + box.width / 2, y = box.y + 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(page.locator('[data-photo-status]')).toContainText('01 / 03');
  await expect(stage).toHaveCSS('cursor', 'grab');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 12, y, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('[data-photo-status]')).toContainText('01 / 03');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 110, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-photo-status]')).toContainText('03 / 03');
});

test('the front photo tilts toward the mouse and settles when the mouse leaves', async ({ page }) => {
  await openTalk(page);
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);
  const photo = stage.locator('[data-position="active"]');
  const rest = await photo.evaluate(el => getComputedStyle(el).transform);
  const box = await photo.boundingBox();
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .25);
  await expect.poll(() => photo.evaluate(el => getComputedStyle(el).transform)).not.toBe(rest);
  await page.mouse.move(10, 10);
  await expect.poll(() => photo.evaluate(el => getComputedStyle(el).transform)).toBe(rest);
  await expect(page.locator('[data-photo-status]')).toContainText('01 / 03');
});
