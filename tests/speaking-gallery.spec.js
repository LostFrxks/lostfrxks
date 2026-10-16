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
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * .6, y: box.y + 102 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * .4, y: box.y + 105 }] });
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


test('one held mouse drag switches photos repeatedly and reverses before release', async ({ page }) => {
  await openTalk(page);
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  const photo = stage.locator('[data-position="active"]');
  const box = await photo.boundingBox();
  const x = box.x + box.width / 2, y = box.y + 120;
  const status = page.locator('[data-photo-status]');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y + 3, { steps: 4 });
  expect((await photo.boundingBox()).x).toBeLessThan(box.x - 10);
  await expect(status).toContainText('01 / 03');
  await page.mouse.move(x - 200, y + 3, { steps: 8 });
  await expect(status).toContainText('02 / 03');
  await expect(stage).toHaveCSS('cursor', 'grabbing');
  const duration = await photo.evaluate(el => getComputedStyle(el).transitionDuration);
  expect(duration.split(',').some(value => Number.parseFloat(value) > 0)).toBe(true);
  await page.waitForTimeout(400);
  await expect(status).toContainText('02 / 03');
  await page.mouse.move(x - 400, y + 3, { steps: 8 });
  await expect(status).toContainText('03 / 03');
  await page.mouse.move(x - 100, y + 3, { steps: 8 });
  await expect(status).toContainText('02 / 03');
  await page.mouse.move(x + 650, y + 3);
  await expect(status).toContainText('03 / 03');
  await page.mouse.up();
  await expect(status).toContainText('03 / 03');
  await expect(stage).toHaveCSS('cursor', 'grab');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test('crossing a photo boundary keeps the held cards moving smoothly', async ({ page }) => {
  await openTalk(page);
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  const photo = stage.locator('[data-photo-slide]').first();
  const box = await photo.boundingBox();
  const x = box.x + box.width / 2, y = box.y + 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 149, y, { steps: 10 });
  await page.waitForTimeout(250);
  const before = await photo.boundingBox();
  await page.mouse.move(x - 151, y);
  const after = await photo.boundingBox();
  await expect(page.locator('[data-photo-status]')).toContainText('02 / 03');
  expect(Math.abs(after.x - before.x)).toBeLessThan(40);
  await page.mouse.up();
});

test('one held touch gesture switches photos before the finger is lifted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTalk(page);
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const status = page.locator('[data-photo-status]');
  const touch = (type, fraction) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + box.width * fraction, y: box.y + 100 }]
  });
  await touch('touchStart', .8);
  await touch('touchMove', .6);
  await touch('touchMove', .45);
  await expect(status).toContainText('02 / 03');
  await touch('touchMove', .2);
  await touch('touchMove', .05);
  await expect(status).toContainText('03 / 03');
  await touch('touchEnd');
  await expect(status).toContainText('03 / 03');
  await expect(stage).toHaveCSS('cursor', 'grab');
  await cdp.detach();
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
  await page.mouse.move(x + 40, y, { steps: 5 });
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
  await page.mouse.move(x + 180, y, { steps: 5 });
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

test('every card stays inside the gallery at every resting position', async ({ page }) => {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await openTalk(page);
    const stage = page.locator('[data-photo-stage]');
    for (let position = 0; position < 3; position++) {
      if (position) await page.getByRole('button', { name: 'Next photo' }).click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(750);
      const bounds = await stage.boundingBox();
      for (const card of await stage.locator('[data-photo-slide]').all()) {
        const box = await card.boundingBox();
        expect(box.x, `left edge at ${width}px, position ${position + 1}`).toBeGreaterThanOrEqual(bounds.x + 4);
        expect(box.x + box.width, `right edge at ${width}px, position ${position + 1}`).toBeLessThanOrEqual(bounds.x + bounds.width - 4);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
});

test('the light returns gradually after the pointer leaves the gallery', async ({ page }) => {
  await openTalk(page);
  const stage = page.locator('[data-photo-stage]');
  await stage.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);
  const face = stage.locator('[data-position="active"] .photo-face');
  const lightTransform = () => face.evaluate(el => getComputedStyle(el, '::before').transform);
  const rest = await lightTransform();
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .3);
  await expect.poll(lightTransform).not.toBe(rest);
  await page.waitForTimeout(700);
  const held = await lightTransform();
  await page.mouse.move(10, 10);
  let returning;
  await expect.poll(async () => {
    returning = await lightTransform();
    return returning;
  }, { intervals: [16, 32, 50] }).not.toBe(held);
  expect(returning).not.toBe(rest);
  await expect.poll(lightTransform).toBe(rest);
});
