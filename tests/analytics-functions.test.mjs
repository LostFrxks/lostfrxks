import assert from 'node:assert/strict';
import test from 'node:test';

import {
  config as sessionConfig,
  createSessionHandler,
  default as defaultSessionHandler,
} from '../netlify/functions/analytics-session.mjs';
import {
  config as statsConfig,
  createStatsHandler,
  default as defaultStatsHandler,
} from '../netlify/functions/analytics-stats.mjs';
import {
  config as compactConfig,
  createCompactHandler,
  default as defaultCompactHandler,
} from '../netlify/functions/analytics-compact.mjs';
import { AnalyticsStorageError } from '../netlify/lib/analytics-repository.mjs';

const ORIGIN = 'https://portfolio.example';
const SESSION_URL = `${ORIGIN}/api/analytics/session`;
const STATS_URL = `${ORIGIN}/api/analytics/stats`;
const SESSION_ID = '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd';
const NOW = new Date('2026-07-17T06:00:00.000Z');
const VALID_PAYLOAD = { sessionId: SESSION_ID, activeSeconds: 42 };

function sessionRequest({
  body = JSON.stringify(VALID_PAYLOAD),
  contentType = 'application/json',
  headers = {},
  method = 'POST',
  origin = ORIGIN,
  url = SESSION_URL,
} = {}) {
  const requestHeaders = new Headers(headers);
  if (origin !== null) {
    requestHeaders.set('origin', origin);
  }
  if (contentType !== null) {
    requestHeaders.set('content-type', contentType);
  }

  return new Request(url, {
    method,
    headers: requestHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

function statsRequest({ authorization, method = 'GET', headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (authorization !== undefined) {
    requestHeaders.set('authorization', authorization);
  }
  return new Request(STATS_URL, { method, headers: requestHeaders });
}

function recordingLogger() {
  const calls = [];
  return {
    calls,
    error: (...args) => calls.push(['error', ...args]),
    info: (...args) => calls.push(['info', ...args]),
  };
}

async function assertNoStore(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response;
}

test('function modules export lazy-safe defaults and exact Netlify configs', () => {
  assert.equal(typeof defaultSessionHandler, 'function');
  assert.equal(typeof defaultStatsHandler, 'function');
  assert.equal(typeof defaultCompactHandler, 'function');
  assert.deepEqual(sessionConfig, {
    path: '/api/analytics/session',
    rateLimit: {
      action: 'rate_limit',
      aggregateBy: ['ip', 'domain'],
      windowLimit: 60,
      windowSize: 60,
    },
  });
  assert.deepEqual(statsConfig, {
    path: '/api/analytics/stats',
    rateLimit: {
      action: 'rate_limit',
      aggregateBy: ['ip', 'domain'],
      windowLimit: 20,
      windowSize: 60,
    },
  });
  assert.deepEqual(compactConfig, { schedule: '@daily' });
});

test('session writes only the parsed fields with the exact server Date', async () => {
  const calls = [];
  const repository = {
    upsertSession: (...args) => {
      calls.push(args);
    },
  };
  const handler = createSessionHandler({ repository, now: () => NOW });
  const response = await handler(sessionRequest({
    contentType: '  Application/JSON ; charset=utf-8  ',
    headers: {
      'user-agent': 'Private Browser/1.0',
      referer: 'https://private.example/account?token=secret',
      'x-private-metadata': 'must-not-be-stored',
    },
    url: `${SESSION_URL}?private=secret`,
  }));

  assert.equal(response.status, 204);
  await assertNoStore(response);
  assert.deepEqual(calls, [[SESSION_ID, 42, NOW]]);
});

test('session rejects non-POST methods without reading the repository', async () => {
  let writes = 0;
  const handler = createSessionHandler({
    repository: { upsertSession: () => { writes += 1; } },
  });
  const response = await handler(sessionRequest({ method: 'GET' }));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  await assertNoStore(response);
  assert.equal(writes, 0);
});

test('session requires an exact same-origin Origin header', async () => {
  let writes = 0;
  const handler = createSessionHandler({
    repository: { upsertSession: () => { writes += 1; } },
  });

  for (const origin of [null, 'https://cross-origin.example', `${ORIGIN}/`]) {
    const response = await handler(sessionRequest({ origin }));
    assert.equal(response.status, 403);
    await assertNoStore(response);
  }
  assert.equal(writes, 0);
});

test('session requires an application/json media type', async () => {
  let writes = 0;
  const handler = createSessionHandler({
    repository: { upsertSession: () => { writes += 1; } },
  });

  for (const contentType of [null, '', 'text/plain', 'application/jsonp']) {
    const response = await handler(sessionRequest({ contentType }));
    assert.equal(response.status, 415);
    await assertNoStore(response);
  }
  assert.equal(writes, 0);
});

test('session rejects malformed and non-exact payloads', async () => {
  let writes = 0;
  const handler = createSessionHandler({
    repository: { upsertSession: () => { writes += 1; } },
  });
  const invalidBodies = [
    '{malformed',
    JSON.stringify({ sessionId: SESSION_ID }),
    JSON.stringify({ activeSeconds: 1 }),
    JSON.stringify({ sessionId: 'not-a-uuid', activeSeconds: 1 }),
    JSON.stringify({ sessionId: SESSION_ID, activeSeconds: -1 }),
    JSON.stringify({ sessionId: SESSION_ID, activeSeconds: 1.5 }),
    JSON.stringify({ sessionId: SESSION_ID, activeSeconds: 43_201 }),
    JSON.stringify({ sessionId: SESSION_ID, activeSeconds: 1, extra: 'private' }),
  ];

  for (const body of invalidBodies) {
    const response = await handler(sessionRequest({ body }));
    assert.equal(response.status, 400);
    await assertNoStore(response);
  }
  assert.equal(writes, 0);
});

test('session rejects a valid oversized Content-Length before reading the body', async () => {
  let writes = 0;
  const handler = createSessionHandler({
    repository: { upsertSession: () => { writes += 1; } },
  });
  const request = sessionRequest({ headers: { 'content-length': '513' } });
  Object.defineProperty(request, 'arrayBuffer', {
    value: () => {
      throw new Error('body must not be read after an early rejection');
    },
  });

  const response = await handler(request);
  assert.equal(response.status, 413);
  await assertNoStore(response);
  assert.equal(writes, 0);
});

test('session measures actual UTF-8 bytes despite missing, small, or malformed lengths', async () => {
  let writes = 0;
  const handler = createSessionHandler({
    repository: { upsertSession: () => { writes += 1; } },
  });
  const oversizedMultibyteBody = JSON.stringify({
    sessionId: SESSION_ID,
    activeSeconds: 1,
    padding: 'é'.repeat(300),
  });

  for (const contentLength of [undefined, '1', 'not-a-number', '-1']) {
    const headers = contentLength === undefined
      ? {}
      : { 'content-length': contentLength };
    const response = await handler(sessionRequest({
      body: oversizedMultibyteBody,
      headers,
    }));
    assert.equal(response.status, 413);
    await assertNoStore(response);
  }
  assert.equal(writes, 0);
});

test('session discards known bots without parsing or writing', async () => {
  let writes = 0;
  const handler = createSessionHandler({
    repository: { upsertSession: () => { writes += 1; } },
  });
  const response = await handler(sessionRequest({
    body: '{definitely-not-json',
    headers: { 'user-agent': 'ExampleSpider/1.0' },
  }));

  assert.equal(response.status, 204);
  await assertNoStore(response);
  assert.equal(writes, 0);
});

test('every session response is no-store', async () => {
  const success = createSessionHandler({
    repository: { upsertSession: () => {} },
  });
  const failure = createSessionHandler({
    repository: { upsertSession: () => { throw new Error('failed'); } },
    logger: recordingLogger(),
  });
  const responses = [
    await success(sessionRequest()),
    await success(sessionRequest({ method: 'GET' })),
    await success(sessionRequest({ origin: null })),
    await success(sessionRequest({ contentType: null })),
    await success(sessionRequest({ body: '{' })),
    await success(sessionRequest({ headers: { 'content-length': '513' } })),
    await failure(sessionRequest()),
  ];

  for (const response of responses) {
    await assertNoStore(response);
  }
});

test('session sanitizes storage and unexpected failures without leaking payloads', async () => {
  for (const error of [
    new AnalyticsStorageError(`stored ${SESSION_ID} secret`),
    new Error(`payload ${JSON.stringify(VALID_PAYLOAD)} token=secret`),
  ]) {
    const logger = recordingLogger();
    const handler = createSessionHandler({
      logger,
      repository: { upsertSession: () => { throw error; } },
    });
    const response = await handler(sessionRequest());
    const observable = `${await response.text()} ${JSON.stringify(logger.calls)}`;

    assert.equal(response.status, 503);
    await assertNoStore(response);
    assert.deepEqual(logger.calls, [['error', 'analytics session unavailable']]);
    assert.equal(observable.includes(SESSION_ID), false);
    assert.equal(observable.includes('secret'), false);
    assert.equal(observable.includes(error.message), false);
  }
});

test('stats rejects non-GET methods before resolving configuration or repository', async () => {
  let reads = 0;
  const handler = createStatsHandler({
    env: {},
    repository: { readDataset: () => { reads += 1; } },
  });
  const response = await handler(statsRequest({ method: 'POST' }));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  await assertNoStore(response);
  assert.equal(reads, 0);
});

test('stats fails closed when the admin token is missing or empty', async () => {
  let reads = 0;
  const repository = { readDataset: () => { reads += 1; } };

  for (const deps of [
    { env: {}, repository },
    { adminToken: '', env: { ANALYTICS_ADMIN_PASSWORD: 'fallback' }, repository },
  ]) {
    const response = await createStatsHandler(deps)(statsRequest({
      authorization: 'Bearer anything',
    }));
    assert.equal(response.status, 503);
    await assertNoStore(response);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), { error: 'Analytics stats unavailable' });
  }
  assert.equal(reads, 0);
});

test('stats accepts only an exact Bearer token form and denies wrong tokens', async () => {
  let reads = 0;
  const handler = createStatsHandler({
    adminToken: 'correct-token',
    repository: { readDataset: () => { reads += 1; } },
  });
  const invalid = [
    undefined,
    '',
    'Bearer',
    'bearer correct-token',
    'Basic correct-token',
    'Bearer  correct-token',
    'Bearer correct token',
    'Bearer wrong-token',
    'Bearer correct-token extra',
  ];

  for (const authorization of invalid) {
    const response = await handler(statsRequest({ authorization }));
    assert.equal(response.status, 401);
    await assertNoStore(response);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  }
  assert.equal(reads, 0);
});

test('stats reads only after authorization and returns aggregate-only JSON', async () => {
  let reads = 0;
  const privateStartedAt = '2026-07-17T01:23:45.000Z';
  const dataset = {
    daily: [{ date: '2026-07-16', visits: 2, totalActiveSeconds: 60 }],
    sessions: [{
      startedAt: privateStartedAt,
      lastSeenAt: '2026-07-17T01:24:45.000Z',
      activeSeconds: 30,
    }],
  };
  const handler = createStatsHandler({
    adminToken: 'correct-token',
    now: () => NOW,
    repository: {
      readDataset: () => {
        reads += 1;
        return dataset;
      },
    },
  });
  const response = await handler(statsRequest({
    authorization: 'Bearer correct-token',
  }));
  const body = await response.text();

  assert.equal(response.status, 200);
  await assertNoStore(response);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(body), {
    generatedAt: NOW.toISOString(),
    timezone: 'Asia/Bishkek',
    periods: {
      today: { visits: 1, averageActiveSeconds: 30 },
      sevenDays: { visits: 3, averageActiveSeconds: 30 },
      thirtyDays: { visits: 3, averageActiveSeconds: 30 },
      allTime: { visits: 3, averageActiveSeconds: 30 },
    },
  });
  assert.equal(reads, 1);
  assert.equal(body.includes(SESSION_ID), false);
  assert.equal(body.includes(privateStartedAt), false);
  assert.equal(body.includes('startedAt'), false);
  assert.equal(body.includes('lastSeenAt'), false);
  assert.equal(body.includes('activeSeconds'), false);
});

test('stats returns zero aggregates for an empty dataset', async () => {
  const handler = createStatsHandler({
    adminToken: 'correct-token',
    now: () => NOW,
    repository: { readDataset: () => ({ daily: [], sessions: [] }) },
  });
  const response = await handler(statsRequest({
    authorization: 'Bearer correct-token',
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  await assertNoStore(response);
  for (const period of Object.values(body.periods)) {
    assert.deepEqual(period, { visits: 0, averageActiveSeconds: 0 });
  }
});

test('stats uses the environment token at invocation time', async () => {
  const env = {};
  let reads = 0;
  const handler = createStatsHandler({
    env,
    now: () => NOW,
    repository: {
      readDataset: () => {
        reads += 1;
        return { daily: [], sessions: [] };
      },
    },
  });
  env.ANALYTICS_ADMIN_PASSWORD = 'late-token';

  const response = await handler(statsRequest({ authorization: 'Bearer late-token' }));
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
});

test('stats sanitizes repository and aggregation failures', async () => {
  const sensitive = `${SESSION_ID} stored-secret`;
  const cases = [
    {
      repository: { readDataset: () => { throw new AnalyticsStorageError(sensitive); } },
    },
    {
      buildStats: () => { throw new Error(sensitive); },
      repository: { readDataset: () => ({ daily: [], sessions: [] }) },
    },
  ];

  for (const dependencies of cases) {
    const logger = recordingLogger();
    const handler = createStatsHandler({
      ...dependencies,
      adminToken: 'correct-token',
      logger,
      now: () => NOW,
    });
    const response = await handler(statsRequest({
      authorization: 'Bearer correct-token',
    }));
    const observable = `${await response.text()} ${JSON.stringify(logger.calls)}`;

    assert.equal(response.status, 503);
    await assertNoStore(response);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(logger.calls, [['error', 'analytics stats unavailable']]);
    assert.equal(observable.includes(SESSION_ID), false);
    assert.equal(observable.includes('stored-secret'), false);
    assert.equal(observable.includes(sensitive), false);
  }
});

test('compact passes the exact server Date and logs only fixed numeric results', async () => {
  const logger = recordingLogger();
  const calls = [];
  const sensitiveResult = {
    compactedDays: 2,
    deletedSessions: 3,
    sessions: [SESSION_ID],
  };
  const handler = createCompactHandler({
    logger,
    now: () => NOW,
    repository: {
      compact: (...args) => {
        calls.push(args);
        return sensitiveResult;
      },
    },
  });

  const result = await handler();
  assert.equal(result, undefined);
  assert.deepEqual(calls, [[NOW]]);
  assert.deepEqual(logger.calls, [[
    'info',
    'analytics compaction complete',
    2,
    3,
  ]]);
  assert.equal(JSON.stringify(logger.calls).includes(SESSION_ID), false);
  assert.equal(JSON.stringify(logger.calls).includes('sessions'), false);
});

test('compact propagates storage failures without logging fabricated success', async () => {
  const logger = recordingLogger();
  const error = new AnalyticsStorageError('stored-secret');
  const handler = createCompactHandler({
    logger,
    repository: { compact: () => { throw error; } },
  });

  await assert.rejects(handler(), (caught) => caught === error);
  assert.deepEqual(logger.calls, []);
});
