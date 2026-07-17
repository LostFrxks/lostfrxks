import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYTICS_TIME_ZONE,
  AnalyticsInputError,
  MAX_ACTIVE_SECONDS,
  bishkekDateKey,
  buildStats,
  isEligibleForCompaction,
  isKnownBot,
  mergeSession,
  parseSessionPayload,
  shiftDateKey,
  tokensEqual,
} from '../netlify/lib/analytics-core.mjs';

const SESSION_ID = '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd';

test('exports the analytics constants and input error type', () => {
  assert.equal(ANALYTICS_TIME_ZONE, 'Asia/Bishkek');
  assert.equal(MAX_ACTIVE_SECONDS, 43_200);
  assert.equal(new AnalyticsInputError('invalid') instanceof Error, true);
});

test('parseSessionPayload accepts only the two approved fields', () => {
  assert.deepEqual(
    parseSessionPayload({ sessionId: SESSION_ID, activeSeconds: 0 }),
    { sessionId: SESSION_ID, activeSeconds: 0 },
  );
  assert.deepEqual(
    parseSessionPayload({
      activeSeconds: MAX_ACTIVE_SECONDS,
      sessionId: SESSION_ID.toUpperCase(),
    }),
    { sessionId: SESSION_ID.toUpperCase(), activeSeconds: MAX_ACTIVE_SECONDS },
  );

  for (const value of [null, undefined, 'payload', 42, [], [SESSION_ID, 1]]) {
    assert.throws(() => parseSessionPayload(value), AnalyticsInputError);
  }

  assert.throws(
    () => parseSessionPayload({ sessionId: SESSION_ID }),
    AnalyticsInputError,
  );
  assert.throws(
    () => parseSessionPayload({ activeSeconds: 1 }),
    AnalyticsInputError,
  );
  assert.throws(
    () => parseSessionPayload({
      sessionId: SESSION_ID,
      activeSeconds: 1,
      referrer: 'https://private.example/',
    }),
    AnalyticsInputError,
  );

  const payloadWithSymbolField = {
    sessionId: SESSION_ID,
    activeSeconds: 1,
    [Symbol('private-field')]: 'not allowed',
  };
  assert.throws(
    () => parseSessionPayload(payloadWithSymbolField),
    AnalyticsInputError,
  );
});

test('parseSessionPayload requires a canonical UUID v4', () => {
  for (const sessionId of [
    '',
    '7b32f2c12c124d4493f6cf05ab5a5ccd',
    '{7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd}',
    '7b32f2c1-2c12-3d44-93f6-cf05ab5a5ccd',
    '7b32f2c1-2c12-4d44-73f6-cf05ab5a5ccd',
    'not-a-uuid',
    123,
  ]) {
    assert.throws(
      () => parseSessionPayload({ sessionId, activeSeconds: 1 }),
      AnalyticsInputError,
    );
  }
});

test('parseSessionPayload requires bounded integer active seconds', () => {
  for (const activeSeconds of [-1, 0.5, MAX_ACTIVE_SECONDS + 1, '1', NaN, Infinity]) {
    assert.throws(
      () => parseSessionPayload({ sessionId: SESSION_ID, activeSeconds }),
      AnalyticsInputError,
    );
  }
});

test('isKnownBot conservatively matches known automation terms case-insensitively', () => {
  assert.equal(isKnownBot(), false);
  assert.equal(isKnownBot('Mozilla/5.0 Chrome/140 Safari/537.36'), false);

  for (const userAgent of [
    'GoogleBOT/2.1',
    'Example-Crawler',
    'friendly-SPIDER',
    'Yahoo! Slurp',
    'HeadlessChrome/140',
  ]) {
    assert.equal(isKnownBot(userAgent), true);
  }
});

test('bishkekDateKey crosses midnight at UTC+06:00', () => {
  assert.equal(
    bishkekDateKey(new Date('2026-07-16T17:59:59.000Z')),
    '2026-07-16',
  );
  assert.equal(
    bishkekDateKey(new Date('2026-07-16T18:00:00.000Z')),
    '2026-07-17',
  );
});

test('shiftDateKey shifts calendar dates across month and year boundaries', () => {
  assert.equal(shiftDateKey('2026-07-01', -1), '2026-06-30');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateKey('2028-02-28', 1), '2028-02-29');
});

test('isEligibleForCompaction waits 48 hours after the Bishkek day ends', () => {
  const now = new Date('2026-07-17T00:00:00.000Z');
  assert.equal(isEligibleForCompaction('2026-07-14', now), true);
  assert.equal(isEligibleForCompaction('2026-07-15', now), false);

  assert.equal(
    isEligibleForCompaction('2026-07-14', new Date('2026-07-16T17:59:59.999Z')),
    false,
  );
  assert.equal(
    isEligibleForCompaction('2026-07-14', new Date('2026-07-16T18:00:00.000Z')),
    true,
  );
});

test('mergeSession creates a new record at the server timestamp', () => {
  const now = new Date('2026-07-17T01:00:00.000Z');
  assert.deepEqual(mergeSession(undefined, 12, now), {
    startedAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    activeSeconds: 12,
  });
});

test('mergeSession preserves the start and never lowers active seconds', () => {
  const existing = {
    startedAt: '2026-07-17T01:00:00.000Z',
    lastSeenAt: '2026-07-17T01:01:00.000Z',
    activeSeconds: 50,
  };
  const now = new Date('2026-07-17T01:02:00.000Z');

  assert.deepEqual(mergeSession(existing, 30, now), {
    startedAt: existing.startedAt,
    lastSeenAt: now.toISOString(),
    activeSeconds: 50,
  });
  assert.equal(mergeSession(existing, 70, now).activeSeconds, 70);
});

test('buildStats combines daily and live data without double counting authoritative days', () => {
  const now = new Date('2026-07-17T06:00:00.000Z');
  const stats = buildStats({
    now,
    daily: [
      { date: '2026-06-01', visits: 2, totalActiveSeconds: 100 },
      { date: '2026-07-16', visits: 3, totalActiveSeconds: 90 },
    ],
    sessions: [
      {
        startedAt: '2026-07-16T04:00:00.000Z',
        lastSeenAt: '2026-07-16T04:00:20.000Z',
        activeSeconds: 20,
      },
      {
        startedAt: '2026-07-17T01:00:00.000Z',
        lastSeenAt: '2026-07-17T01:00:40.000Z',
        activeSeconds: 40,
      },
    ],
  });

  assert.equal(stats.generatedAt, now.toISOString());
  assert.equal(stats.timezone, ANALYTICS_TIME_ZONE);
  assert.deepEqual(stats.periods, {
    today: { visits: 1, averageActiveSeconds: 40 },
    sevenDays: { visits: 4, averageActiveSeconds: 33 },
    thirtyDays: { visits: 4, averageActiveSeconds: 33 },
    allTime: { visits: 6, averageActiveSeconds: 38 },
  });
});

test('buildStats returns zeroed periods for empty data and counts zero-duration visits', () => {
  const now = new Date('2026-07-17T06:00:00.000Z');
  const empty = buildStats({ daily: [], sessions: [], now });
  const zeroPeriod = { visits: 0, averageActiveSeconds: 0 };

  assert.deepEqual(empty.periods, {
    today: zeroPeriod,
    sevenDays: zeroPeriod,
    thirtyDays: zeroPeriod,
    allTime: zeroPeriod,
  });

  const withZeroDuration = buildStats({
    daily: [],
    sessions: [{
      startedAt: '2026-07-17T01:00:00.000Z',
      lastSeenAt: '2026-07-17T01:00:00.000Z',
      activeSeconds: 0,
    }],
    now,
  });
  assert.deepEqual(withZeroDuration.periods.today, {
    visits: 1,
    averageActiveSeconds: 0,
  });
});

test('tokensEqual compares non-empty tokens and rejects empty inputs', () => {
  assert.equal(tokensEqual('secret', 'secret'), true);
  assert.equal(tokensEqual('secret', 'different'), false);
  assert.equal(tokensEqual('', 'secret'), false);
  assert.equal(tokensEqual('secret', ''), false);
  assert.equal(tokensEqual('', ''), false);
});
