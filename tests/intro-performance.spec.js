const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/analytics/session', route => route.fulfill({ status: 204 }));
});

test('keyboard entry opens the page within two seconds', async ({ page }) => {
  await page.goto('/');
  const intro = page.locator('#intro-screen');
  await expect(intro).toHaveAttribute('data-intro-phase', 'idle');
  await intro.focus();
  const started = Date.now();
  await page.keyboard.press('Enter');
  await expect(intro).toHaveCount(0, { timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/intro-active/);
});

test('rain limits paint work and pauses while the page is hidden', async ({ page }) => {
  await page.addInitScript(() => {
    let visible = true;
    Object.defineProperty(document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
    window.__setPageVisible = value => { visible = value; document.dispatchEvent(new Event('visibilitychange')); };
    window.__rainPaints = [];
    const original = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.canvas.id === 'matrix-canvas') window.__rainPaints.push(performance.now());
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  const canvas = page.locator('#matrix-canvas');
  await expect(canvas).toHaveAttribute('data-animation-state', 'running');
  const before = await page.evaluate(() => window.__rainPaints.length);
  await page.waitForTimeout(600);
  const painted = await page.evaluate(() => window.__rainPaints.length);
  expect(painted - before).toBeGreaterThan(2);
  expect(painted - before).toBeLessThanOrEqual(23);
  await page.evaluate(() => window.__setPageVisible(false));
  await expect(canvas).toHaveAttribute('data-animation-state', 'paused');
  const paused = await page.evaluate(() => window.__rainPaints.length);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__rainPaints.length)).toBe(paused);
  await page.evaluate(() => window.__setPageVisible(true));
  await expect.poll(() => page.evaluate(() => window.__rainPaints.length)).toBeGreaterThan(paused);
});

test('torus starts only when revealed in the viewport and stops offscreen', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('#ascii-torus');
  const output = page.locator('[data-ascii-torus-output]');
  await expect(output).toBeEmpty();
  await page.locator('#intro-screen').click();
  await expect(page.locator('#intro-screen')).toHaveCount(0);
  await expect(output).toBeEmpty();
  await root.scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute('data-torus-animation-state', 'running');
  await expect(root).toHaveAttribute('data-torus-reveal', 'complete');
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
  await expect(root).toHaveAttribute('data-torus-animation-state', 'paused');
  const orientation = await root.getAttribute('data-torus-rotation');
  expect(orientation).toMatch(/^-?\d/);
  await page.waitForTimeout(250);
  expect(await root.getAttribute('data-torus-rotation')).toBe(orientation);
});

test('retina mobile keeps the intro in bounds and reduced motion opens immediately', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });
  await context.route('**/api/analytics/session', route => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('[data-intro-name]')).toHaveText('Artur Usenov');
  const geometry = await page.evaluate(() => {
    const rect = document.querySelector('[data-intro-name]').getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, canvasWidth: document.querySelector('#matrix-canvas').width };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.scrollWidth).toBe(geometry.width);
  expect(geometry.canvasWidth).toBeLessThanOrEqual(geometry.width * 1.5);
  await page.locator('#intro-screen').click();
  await expect(page.locator('#intro-screen')).toHaveCount(0, { timeout: 500 });
  await expect(page.locator('main')).toBeVisible();
  await context.close();
});

test('opening content never restarts its animation when the intro phase ends', async ({ page }) => {
  await page.goto('/');
  await page.locator('#intro-screen').click();
  await page.waitForFunction(() => !document.querySelector('#intro-screen'));
  await page.waitForTimeout(200);
  const contact = page.locator('#contact');
  await contact.evaluate(element => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, element.offsetTop); });
  await page.waitForFunction(() => document.querySelector('#contact').classList.contains('matrix-revealed'));
  const names = await contact.evaluate(element => new Promise(resolve => {
    const samples = new Set();
    const started = performance.now();
    function sample() {
      samples.add(getComputedStyle(element).animationName);
      if (performance.now() - started > 1400) resolve([...samples]);
      else requestAnimationFrame(sample);
    }
    sample();
  }));
  expect(names).not.toContain('matrixMaterialize');
});
