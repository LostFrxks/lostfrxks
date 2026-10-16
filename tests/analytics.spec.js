const { test, expect } = require('@playwright/test');

const SESSION_ENDPOINT = '**/api/analytics/session';
const STATS_ENDPOINT = '**/api/analytics/stats';
const OWNER_ENDPOINT = '**/api/analytics/owner';
test.beforeEach(async ({ page }) => {
  await page.route(OWNER_ENDPOINT, route => route.fulfill({ status: route.request().headers().authorization === 'Bearer correct-secret' ? 204 : 401, body: '' }));
});
const dashboardResponse = {
  generatedAt: '2026-07-17T10:05:00.000Z',
  timezone: 'Asia/Bishkek',
  visitTimes: [
    '2026-07-17T13:42:13.000Z',
    '2026-07-17T12:05:04.000Z',
  ],
  periods: {
    today: { visits: 4, averageActiveSeconds: 65 },
    sevenDays: { visits: 18, averageActiveSeconds: 51 },
    thirtyDays: { visits: 47, averageActiveSeconds: 44 },
    allTime: { visits: 91, averageActiveSeconds: 48 },
  },
};

test('tracker sends approved visit details with a stable browser and fresh visits on reload', async ({ page }) => {
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
    expect(Object.keys(request.body).sort()).toEqual(['activeSeconds', 'browserId', 'clicks', 'deviceHints', 'pagePath', 'referrer', 'scrollPercent', 'sections', 'sessionId', 'utm']);
    expect(request.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(request.headers.referer).toBeUndefined();
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers['x-analytics-version']).toBe('2');
    expect(request.body.browserId).toMatch(/^[0-9a-f-]{36}$/);
  }
  expect(requests[0].body.activeSeconds).toBe(0);
  expect(requests[0].body.sessionId).not.toBe(requests.at(-1).body.sessionId);
  expect(new Set(requests.map(({ body }) => body.browserId)).size).toBe(1);
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
  await expect(page).toHaveTitle('Artur Usenov');
  await expect(page.getByRole('button', { name: /enter matrix intro/i })).toBeVisible();
});

test('private dashboard unlocks and renders metrics with newest visit times first', async ({ page }) => {
  let authorization = '';
  await page.route(STATS_ENDPOINT, async (route) => {
    authorization = route.request().headers().authorization;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardResponse),
    });
  });

  await page.goto('/secret.html');
  const password = page.getByLabel(/access password/i);
  await expect(password).toBeVisible();
  await expect(page.getByRole('heading', { name: /private analytics/i })).toBeHidden();
  await expect(page.locator('[data-dashboard]')).toBeHidden();
  await password.fill('correct-secret');
  await password.press('Enter');

  await expect(page.getByRole('heading', { name: /private analytics/i })).toBeVisible();
  await expect(page.locator('[data-period="today"] [data-visits]')).toHaveText('4');
  await expect(page.locator('[data-period="today"] [data-average]')).toHaveText('1m 5s');
  await expect(page.locator('[data-visit-history] li')).toHaveText([
    '17 Jul 2026, 19:42:13',
    '17 Jul 2026, 18:05:04',
  ]);
  expect(authorization).toBe('Bearer correct-secret');
});

test('private dashboard explains when no visit history exists yet', async ({ page }) => {
  await page.route(STATS_ENDPOINT, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...dashboardResponse, visitTimes: [] }),
  }));

  await page.goto('/secret.html');
  await page.getByLabel(/access password/i).fill('correct-secret');
  await page.getByLabel(/access password/i).press('Enter');

  await expect(page.locator('[data-visit-history]')).toHaveText('No visits recorded yet.');
});

test('secret gate stays anonymous for wrong passwords and retains retry passwords', async ({ page }) => {
  let status = 401;
  await page.route(STATS_ENDPOINT, (route) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: status === 401 ? 'Unauthorized.' : 'Unavailable.' }),
  }));

  await page.goto('/secret.html');
  const password = page.getByLabel(/access password/i);
  await password.fill('wrong-secret');
  await password.press('Enter');
  await expect(page.locator('[data-error]')).toHaveText('Access denied.');
  await expect(page.getByRole('heading', { name: /private analytics/i })).toBeHidden();
  await expect(page.locator('[data-dashboard]')).toBeHidden();

  status = 503;
  await password.fill('correct-secret');
  await password.press('Enter');
  await expect(page.locator('[data-error]')).toHaveText('Temporarily unavailable.');
  await expect(password).toHaveValue('correct-secret');
  await expect(page.locator('[data-dashboard]')).toBeHidden();
});

const detailedVisit = {
  id: '2fa03426-bb1f-4b9c-a7ce-0e760552ad57', startedAt: '2026-10-14T14:00:00.000Z', lastSeenAt: '2026-10-14T14:02:00.000Z', activeSeconds: 120,
  pagePath: '/', ip: '192.0.2.7', location: { country: 'Kyrgyzstan', region: 'Chuy', city: 'Bishkek' },
  device: { type: 'Phone', os: 'Android', browser: 'Chrome', version: '130.0', model: 'Pixel 8' },
  referrer: 'https://google.com', utm: { source: 'linkedin' }, scrollPercent: 83,
  sections: [{ id: 'projects', seconds: 40 }], clicks: [{ target: '/assets/artur-usenov-resume.pdf', label: 'Resume', count: 2 }], isOwner: true, legacy: false,
};
const detailedResponse = { ...dashboardResponse, visits: [detailedVisit, { ...detailedVisit, id: 'guest', isOwner: false, activeSeconds: 30 }, { id: 'legacy', startedAt: '2026-07-17T13:42:13.000Z', isOwner: false, legacy: true, activeSeconds: null }], history: { offset: 0, nextOffset: null, total: 3 } };

async function unlock(page) { await page.goto('/secret.html'); await page.getByLabel(/access password/i).fill('correct-secret'); await page.getByLabel(/access password/i).press('Enter'); await expect(page.locator('[data-dashboard]')).toBeVisible(); }

test('correct login registers this browser and cards show owner and visit activity', async ({ page }) => {
  let marked;
  await page.route(OWNER_ENDPOINT, route => { marked = route.request().postDataJSON(); return route.fulfill({ status: 204, body: '' }); });
  await page.route(STATS_ENDPOINT, route => route.fulfill({ json: detailedResponse }));
  await unlock(page);
  expect(marked.browserId).toBe(await page.evaluate(() => localStorage.getItem('lostfrxks.analytics.browser')));
  const cards = page.locator('[data-visit-history] details');
  await expect(cards).toHaveCount(3);
  await expect(cards.first().locator('summary')).toContainText('Ты');
  await expect(cards.nth(1).locator('summary')).not.toContainText('Ты');
  expect(await cards.first().locator('summary').evaluate(e => getComputedStyle(e).color)).not.toBe(await cards.nth(1).locator('summary').evaluate(e => getComputedStyle(e).color));
  await cards.first().locator('summary').click();
  await expect(cards.first()).toContainText('Pixel 8');
  await expect(cards.first()).toContainText('192.0.2.7');
  await expect(cards.first()).toContainText('Kyrgyzstan');
  await expect(cards.first()).toContainText('Chuy');
  await expect(cards.first()).toContainText('83%');
  await expect(cards.first()).toContainText('Resume');
  await expect(cards.first()).toContainText('Selected Work');
  await cards.nth(2).locator('summary').click();
  await expect(cards.nth(2)).toContainText('Подробности не собирались');
});

test('details require successful password and lock removes private DOM', async ({ page }) => {
  let reads = 0;
  await page.route(STATS_ENDPOINT, route => { reads++; return route.fulfill({ json: detailedResponse }); });
  await page.goto('/secret.html');
  expect(reads).toBe(0);
  await page.getByLabel(/access password/i).fill('wrong-secret'); await page.getByLabel(/access password/i).press('Enter');
  await expect(page.locator('[data-error]')).toHaveText('Access denied.');
  expect(reads).toBe(0);
  await page.getByLabel(/access password/i).fill('correct-secret'); await page.getByLabel(/access password/i).press('Enter');
  await expect(page.locator('[data-visit-history] details')).toHaveCount(3);
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.locator('[data-visit-history]')).toBeEmpty();
  await expect(page.locator('[data-dashboard]')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('lostfrxks.analytics.adminPassword'))).toBeNull();
});

test('authenticated pagination appends cards and refresh returns to newest visits', async ({ page }) => {
  const offsets = [];
  await page.route('**/api/analytics/stats*', route => { const offset = new URL(route.request().url()).searchParams.get('offset') || '0'; offsets.push(offset); return route.fulfill({ json: offset === '0' ? { ...detailedResponse, visits: [detailedVisit], history: { offset: 0, nextOffset: 50, total: 51 } } : { ...detailedResponse, visits: [{ ...detailedVisit, id: 'older', isOwner: false }], history: { offset: 50, nextOffset: null, total: 51 } } }); });
  await unlock(page);
  await page.getByRole('button', { name: 'Ещё заходы' }).click();
  await expect(page.locator('[data-visit-history] details')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Ещё заходы' })).toBeHidden();
  expect(offsets).toEqual(['0', '50']);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('[data-visit-history] details')).toHaveCount(1);
});

test('mobile cards safely display hostile metadata without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const malicious = '<img src=x onerror=window.__injected=true>';
  await page.route(STATS_ENDPOINT, route => route.fulfill({ json: { ...detailedResponse, visits: [{ ...detailedVisit, device: { ...detailedVisit.device, model: malicious }, ip: '2001:db8:1234:5678:1234:5678:1234:5678' }] } }));
  await unlock(page);
  await page.locator('[data-visit-history] summary').click();
  await expect(page.locator('[data-visit-history]')).toContainText(malicious);
  await expect(page.locator('[data-visit-history] img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
