const { test, expect } = require('@playwright/test');

const SESSION_ENDPOINT = '**/api/analytics/session';
const STATS_ENDPOINT = '**/api/analytics/stats';
const dashboardResponse = {
  generatedAt: '2026-07-17T10:05:00.000Z',
  timezone: 'Asia/Bishkek',
  periods: {
    today: { visits: 4, averageActiveSeconds: 65 },
    sevenDays: { visits: 18, averageActiveSeconds: 51 },
    thirtyDays: { visits: 47, averageActiveSeconds: 44 },
    allTime: { visits: 91, averageActiveSeconds: 48 },
  },
};

test('tracker sends only an anonymous tab session and active seconds', async ({ page }) => {
  const requests = [];
  await page.route(SESSION_ENDPOINT, async (route) => {
    requests.push({
      body: route.request().postDataJSON(),
      headers: route.request().headers(),
    });
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);

  for (const request of requests) {
    expect(Object.keys(request.body).sort()).toEqual(['activeSeconds', 'sessionId']);
    expect(request.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(request.headers.referer).toBeUndefined();
    expect(request.headers.cookie).toBeUndefined();
  }
  expect(requests[0].body.activeSeconds).toBe(0);
  expect(new Set(requests.map(({ body }) => body.sessionId)).size).toBe(1);
});

test('tracker excludes hidden time and hidden interval traffic', async ({ page }) => {
  await page.addInitScript(() => {
    let analyticsVisibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => analyticsVisibility,
    });
    window.__setAnalyticsVisibility = (state) => {
      analyticsVisibility = state;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const events = [];
  await page.route(SESSION_ENDPOINT, async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.__setAnalyticsVisibility('hidden'));
  await expect.poll(() => events.length).toBeGreaterThanOrEqual(2);
  const hiddenCount = events.length;
  const secondsBeforeWait = events.at(-1).activeSeconds;
  await page.waitForTimeout(1_100);
  expect(events).toHaveLength(hiddenCount);
  await page.evaluate(() => window.__setAnalyticsVisibility('visible'));
  await expect.poll(() => events.length).toBeGreaterThan(hiddenCount);
  expect(events.at(-1).activeSeconds).toBe(secondsBeforeWait);
});

test('analytics failures never break the public portfolio', async ({ page }) => {
  await page.route(SESSION_ENDPOINT, (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/');
  await expect(page).toHaveTitle('Artur Usenov — Backend / AI Backend Engineer');
  await expect(page.getByRole('button', { name: /enter matrix intro/i })).toBeVisible();
});

test('private dashboard unlocks and renders aggregate-only metrics', async ({ page }) => {
  let authorization = '';
  await page.route(STATS_ENDPOINT, async (route) => {
    authorization = route.request().headers().authorization;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardResponse),
    });
  });

  await page.goto('/analytics.html');
  await expect(page.getByRole('heading', { name: /private analytics/i })).toBeVisible();
  await expect(page.locator('[data-dashboard]')).toBeHidden();
  await page.getByLabel(/admin token/i).fill('correct-secret');
  await page.getByRole('button', { name: /unlock/i }).click();

  await expect(page.locator('[data-period="today"] [data-visits]')).toHaveText('4');
  await expect(page.locator('[data-period="today"] [data-average]')).toHaveText('1m 5s');
  expect(authorization).toBe('Bearer correct-secret');
});

test('private dashboard hides metrics for wrong tokens and retains retry tokens', async ({ page }) => {
  let status = 401;
  await page.route(STATS_ENDPOINT, (route) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: status === 401 ? 'Unauthorized.' : 'Unavailable.' }),
  }));

  await page.goto('/analytics.html');
  const token = page.getByLabel(/admin token/i);
  await token.fill('wrong-secret');
  await page.getByRole('button', { name: /unlock/i }).click();
  await expect(page.locator('[data-error]')).toHaveText('Invalid admin token.');
  await expect(page.locator('[data-dashboard]')).toBeHidden();

  status = 503;
  await token.fill('correct-secret');
  await page.getByRole('button', { name: /unlock/i }).click();
  await expect(page.locator('[data-error]')).toHaveText('Analytics are temporarily unavailable.');
  await expect(token).toHaveValue('correct-secret');
  await expect(page.locator('[data-dashboard]')).toBeHidden();
});
