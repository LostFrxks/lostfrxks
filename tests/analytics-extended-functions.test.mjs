import {signedIn,authFixture} from './helpers/admin-auth.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionHandler } from '../netlify/functions/analytics-session.mjs';
import { createStatsHandler } from '../netlify/functions/analytics-stats.mjs';

const ORIGIN = 'https://portfolio.example';
const ID = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
const BROWSER = '73d9e264-7ca6-4714-9868-1f4029b8214f';
const NOW = new Date('2026-10-14T14:00:00.000Z');
const PAYLOAD = { sessionId: ID, browserId: BROWSER, activeSeconds: 12, pagePath: '/', referrer: '', utm: {}, deviceHints: {}, scrollPercent: 20, sections: [], clicks: [] };
function post(path, body, extra = {}) {
  return new Request(ORIGIN + path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
}

test('rich collection receives server-authoritative network metadata and no public history', async () => {
  let persisted;
  const handler = createSessionHandler({ visitRepository: { upsertVisit: (payload, context, now) => { persisted = { payload, context, now }; } }, now: () => NOW });
  const response = await handler(post('/api/analytics/session', PAYLOAD, { 'x-analytics-version': '2', 'user-agent': 'Browser from HTTP', 'x-forwarded-for': '203.0.113.99' }), { ip: '192.0.2.1', geo: { city: 'Bishkek' } });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(persisted.payload.browserId, BROWSER);
  assert.equal(persisted.context.ip, '192.0.2.1');
  assert.equal(persisted.context.userAgent, 'Browser from HTTP');
  assert.deepEqual(persisted.context.geo, { city: 'Bishkek' });
  assert.equal(persisted.now, NOW);
});

test('rich collection rejects forged owner and network fields before writing', async () => {
  let writes = 0;
  const handler = createSessionHandler({ visitRepository: { upsertVisit: () => { writes++; } } });
  for (const extra of [{ isOwner: true }, { ip: '203.0.113.1' }, { screenHeight: 900 }]) {
    const response = await handler(post('/api/analytics/session', { ...PAYLOAD, ...extra }, { 'x-analytics-version': '2' }));
    assert.equal(response.status, 400);
  }
  assert.equal(writes, 0);
});

test('owner registration requires a session and same-origin POST before any storage access', async () => {
  const f = await signedIn();
  const { createOwnerHandler } = await import('../netlify/functions/analytics-owner.mjs');
  let writes = 0;
  const handler = createOwnerHandler({ auth: f.auth, repository: { markOwner: () => { writes++; } } });
  for (const authorization of [undefined, 'Bearer wrong', 'Basic test-password']) {
    const response = await handler(post('/api/analytics/owner', { browserId: BROWSER }, authorization ? { authorization } : {}));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const crossOrigin = await handler(post('/api/analytics/owner', { browserId: BROWSER }, { authorization: 'Bearer test-password', origin: 'https://attacker.example' }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(writes, 0);
});

test('correct password registers only the supplied browser and malformed registrations fail', async () => {
  const { createOwnerHandler } = await import('../netlify/functions/analytics-owner.mjs');
  const f = await signedIn();
  const registrations = [];
  const handler = createOwnerHandler({ auth: f.auth, repository: { markOwner: (...args) => registrations.push(args) }, now: () => NOW });
  const response = await handler(post('/api/analytics/owner', { browserId: BROWSER }, { cookie: f.cookie }));
  assert.equal(response.status, 204);
  assert.deepEqual(registrations, [[BROWSER, NOW]]);
  for (const body of [{ browserId: 'bad' }, { browserId: BROWSER, ip: '192.0.2.1' }, {}]) {
    assert.equal((await handler(post('/api/analytics/owner', body, { cookie: f.cookie }))).status, 400);
  }
  assert.equal(registrations.length, 1);
});

test('owner registration fails closed when password is unconfigured and sanitizes storage errors', async () => {
  const { createOwnerHandler } = await import('../netlify/functions/analytics-owner.mjs');
  const f = await signedIn();
  let writes = 0;
  const missing = createOwnerHandler({ auth: { authenticate() { throw Error('unconfigured'); } }, repository: { markOwner: () => { writes++; } } });
  assert.equal((await missing(post('/api/analytics/owner', { browserId: BROWSER }))).status, 503);
  assert.equal(writes, 0);
  const failing = createOwnerHandler({ auth: f.auth, repository: { markOwner: () => { throw Error('private-IP'); } }, logger: { error() {} } });
  const response = await failing(post('/api/analytics/owner', { browserId: BROWSER }, { cookie: f.cookie }));
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('private-IP'), false);
});

test('authenticated history paginates while all-time visitor counts exclude owners', async () => {
  const f = await signedIn();
  const visits = Array.from({ length: 55 }, (_, index) => ({ id: 'visit-' + index, startedAt: new Date(NOW.getTime() - index * 1000).toISOString(), activeSeconds: 10, isOwner: index === 0, legacy: false }));
  const handler = createStatsHandler({ auth: f.auth, repository: { readDataset: () => ({ daily: [], sessions: [], visitTimes: [], visits }) }, now: () => NOW });
  const first = await handler(new Request(ORIGIN + '/api/analytics/stats', { headers: { cookie: f.cookie } }));
  const data = await first.json();
  assert.equal(first.status, 200);
  assert.equal(data.visits.length, 50);
  assert.equal(data.visits[0].isOwner, true);
  assert.equal(data.periods.allTime.visits, 54);
  assert.deepEqual(data.history, { offset: 0, nextOffset: 50, total: 55 });
  const next = await handler(new Request(ORIGIN + '/api/analytics/stats?offset=50', { headers: { cookie: f.cookie } }));
  const last = await next.json();
  assert.equal(last.visits.length, 5);
  assert.equal(last.history.nextOffset, null);
  assert.equal(last.visits[0].id, 'visit-50');
});

test('pagination cannot bypass authentication or trigger reads for invalid offsets', async () => {
  const f = await signedIn();
  let reads = 0;
  const handler = createStatsHandler({ auth: f.auth, repository: { readDataset: () => { reads++; return {}; } } });
  assert.equal((await handler(new Request(ORIGIN + '/api/analytics/stats?offset=50'))).status, 401);
  for (const offset of ['-1', 'NaN', '1.5', '999999999999999999999']) {
    assert.equal((await handler(new Request(ORIGIN + '/api/analytics/stats?offset=' + offset, { headers: { cookie: f.cookie } }))).status, 400);
  }
  assert.equal(reads, 0);
});
