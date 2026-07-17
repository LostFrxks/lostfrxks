# Anonymous Portfolio Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free, first-party anonymous visit counting and active-time measurement with a token-protected private dashboard.

**Architecture:** A browser module sends a tab-scoped UUID and cumulative visible seconds to a Netlify Function. Netlify Blobs stores one live record per session, a scheduled function compacts old records into daily aggregates, and a protected stats function feeds an unlinked static dashboard.

**Tech Stack:** Vanilla HTML/CSS/ES modules, Netlify Functions, Netlify Blobs, Node.js built-in test runner, Playwright.

---

## File Map

- Modify `package.json` and `package-lock.json`: add Netlify runtime/dev dependencies and split unit/browser test commands.
- Create `netlify.toml`: declare the static publish directory, Functions directory, and local Netlify Dev proxy.
- Create `netlify/lib/analytics-core.mjs`: validation, bot detection, Bishkek date math, session merging, token comparison, and aggregate calculation.
- Create `netlify/lib/analytics-repository.mjs`: the only module that knows the Netlify Blobs key layout and ETag update protocol.
- Create `netlify/functions/analytics-session.mjs`: public heartbeat HTTP handler.
- Create `netlify/functions/analytics-stats.mjs`: protected aggregate HTTP handler.
- Create `netlify/functions/analytics-compact.mjs`: daily session-to-aggregate compaction job.
- Create `analytics.mjs`: isolated public browser tracker and visible-time accumulator.
- Modify `index.html:577-579`: load the tracker without coupling it to portfolio animation code.
- Create `analytics.html`, `analytics.css`, and `analytics-dashboard.mjs`: private token form and four-card dashboard.
- Create `tests/analytics-core.test.mjs`: pure validation, date, merge, authentication, and aggregation tests.
- Create `tests/analytics-repository.test.mjs`: in-memory Blob adapter tests for conditional writes and compaction.
- Create `tests/analytics-functions.test.mjs`: HTTP handler and scheduled-function tests using injected repositories.
- Create `tests/analytics-tracker.test.mjs`: deterministic active-time and session-storage tests.
- Create `tests/analytics.spec.js`: browser request privacy and dashboard behavior tests.
- Modify `README.md`: document local development, private-token setup, stored fields, and deployment checks.

### Task 1: Netlify and test plumbing

**Files:**
- Modify: `package.json:6-13`
- Modify: `package-lock.json`
- Create: `netlify.toml`

- [ ] **Step 1: Install the required packages**

Run:

```bash
npm install @netlify/blobs @netlify/functions
npm install --save-dev netlify-cli
```

Expected: both commands exit `0`; `package-lock.json` records the exact resolved versions.

- [ ] **Step 2: Add focused scripts to `package.json`**

Replace the `scripts` object with:

```json
"scripts": {
  "start": "serve --listen tcp://127.0.0.1:4173 .",
  "dev": "netlify dev",
  "test:unit": "node --test tests/*.test.mjs",
  "test:browser": "playwright test",
  "test": "npm run test:unit && npm run test:browser"
}
```

Keep `@netlify/blobs` and `@netlify/functions` in `dependencies`; keep `@playwright/test`, `netlify-cli`, and `serve` in `devDependencies`.

- [ ] **Step 3: Create `netlify.toml`**

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[dev]
  command = "npm run start"
  targetPort = 4173
  port = 8888
  autoLaunch = false
```

- [ ] **Step 4: Verify the plumbing**

Run:

```bash
npm exec netlify -- --version
npm run test:browser -- --list
```

Expected: Netlify CLI prints its installed version; Playwright lists the existing portfolio tests without running them.

- [ ] **Step 5: Commit the plumbing**

```bash
git add package.json package-lock.json netlify.toml
git commit -m "build: add Netlify analytics plumbing"
```

### Task 2: Pure analytics rules

**Files:**
- Create: `tests/analytics-core.test.mjs`
- Create: `netlify/lib/analytics-core.mjs`

- [ ] **Step 1: Write failing core tests**

Create `tests/analytics-core.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AnalyticsInputError,
  bishkekDateKey,
  buildStats,
  isEligibleForCompaction,
  isKnownBot,
  mergeSession,
  parseSessionPayload,
  tokensEqual,
} from '../netlify/lib/analytics-core.mjs';

test('parseSessionPayload accepts only a UUID v4 and bounded integer seconds', () => {
  const parsed = parseSessionPayload({
    sessionId: '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd',
    activeSeconds: 42,
  });

  assert.deepEqual(parsed, {
    sessionId: '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd',
    activeSeconds: 42,
  });
  assert.throws(
    () => parseSessionPayload({ sessionId: parsed.sessionId, activeSeconds: 42, referrer: 'x' }),
    AnalyticsInputError
  );
  assert.throws(
    () => parseSessionPayload({ sessionId: parsed.sessionId, activeSeconds: 43_201 }),
    AnalyticsInputError
  );
});

test('bot matching is conservative and case insensitive', () => {
  assert.equal(isKnownBot('Mozilla/5.0 Chrome/140 Safari/537.36'), false);
  assert.equal(isKnownBot('Googlebot/2.1'), true);
  assert.equal(isKnownBot('HeadlessChrome/140'), true);
});

test('Bishkek dates cross midnight at UTC+06:00', () => {
  assert.equal(bishkekDateKey(new Date('2026-07-16T17:59:59.000Z')), '2026-07-16');
  assert.equal(bishkekDateKey(new Date('2026-07-16T18:00:00.000Z')), '2026-07-17');
});

test('compaction waits until the local day ended at least 48 hours ago', () => {
  const now = new Date('2026-07-17T00:00:00.000Z');
  assert.equal(isEligibleForCompaction('2026-07-14', now), true);
  assert.equal(isEligibleForCompaction('2026-07-15', now), false);
});

test('mergeSession keeps the earliest start and greatest duration', () => {
  const existing = {
    startedAt: '2026-07-17T01:00:00.000Z',
    lastSeenAt: '2026-07-17T01:01:00.000Z',
    activeSeconds: 50,
  };
  const merged = mergeSession(existing, 30, new Date('2026-07-17T01:02:00.000Z'));

  assert.deepEqual(merged, {
    startedAt: existing.startedAt,
    lastSeenAt: '2026-07-17T01:02:00.000Z',
    activeSeconds: 50,
  });
});

test('buildStats combines daily and live data without double counting compacted days', () => {
  const stats = buildStats({
    now: new Date('2026-07-17T06:00:00.000Z'),
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

  assert.deepEqual(stats.periods.today, { visits: 1, averageActiveSeconds: 40 });
  assert.deepEqual(stats.periods.sevenDays, { visits: 4, averageActiveSeconds: 33 });
  assert.deepEqual(stats.periods.thirtyDays, { visits: 4, averageActiveSeconds: 33 });
  assert.deepEqual(stats.periods.allTime, { visits: 6, averageActiveSeconds: 38 });
});

test('tokensEqual compares hashed values and rejects empty configuration', () => {
  assert.equal(tokensEqual('secret', 'secret'), true);
  assert.equal(tokensEqual('secret', 'different'), false);
  assert.equal(tokensEqual('', ''), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/analytics-core.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `netlify/lib/analytics-core.mjs`.

- [ ] **Step 3: Implement the pure analytics module**

Create `netlify/lib/analytics-core.mjs`:

```js
import { createHash, timingSafeEqual } from 'node:crypto';

export const ANALYTICS_TIME_ZONE = 'Asia/Bishkek';
export const MAX_ACTIVE_SECONDS = 43_200;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOT_PATTERN = /bot|crawler|spider|slurp|headless/i;
const dateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class AnalyticsInputError extends Error {}

export function parseSessionPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnalyticsInputError('Invalid analytics payload');
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'activeSeconds' || keys[1] !== 'sessionId') {
    throw new AnalyticsInputError('Unexpected analytics fields');
  }
  if (!UUID_V4.test(value.sessionId)) {
    throw new AnalyticsInputError('Invalid session ID');
  }
  if (!Number.isInteger(value.activeSeconds) || value.activeSeconds < 0 || value.activeSeconds > MAX_ACTIVE_SECONDS) {
    throw new AnalyticsInputError('Invalid active duration');
  }
  return { sessionId: value.sessionId, activeSeconds: value.activeSeconds };
}

export function isKnownBot(userAgent = '') {
  return BOT_PATTERN.test(userAgent);
}

export function bishkekDateKey(date) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isEligibleForCompaction(dateKey, now) {
  const nextDay = shiftDateKey(dateKey, 1);
  const localDayEnd = new Date(`${nextDay}T00:00:00+06:00`);
  return localDayEnd.getTime() <= now.getTime() - 48 * 60 * 60 * 1000;
}

export function mergeSession(existing, activeSeconds, now) {
  const timestamp = now.toISOString();
  if (!existing) {
    return { startedAt: timestamp, lastSeenAt: timestamp, activeSeconds };
  }
  return {
    startedAt: existing.startedAt,
    lastSeenAt: timestamp,
    activeSeconds: Math.max(existing.activeSeconds, activeSeconds),
  };
}

function summarize(items) {
  const visits = items.reduce((sum, item) => sum + item.visits, 0);
  const totalActiveSeconds = items.reduce((sum, item) => sum + item.totalActiveSeconds, 0);
  return {
    visits,
    averageActiveSeconds: visits === 0 ? 0 : Math.round(totalActiveSeconds / visits),
  };
}

export function buildStats({ daily, sessions, now }) {
  const authoritativeDates = new Set(daily.map((item) => item.date));
  const items = daily.map((item) => ({ ...item }));
  for (const session of sessions) {
    const date = bishkekDateKey(new Date(session.startedAt));
    if (!authoritativeDates.has(date)) {
      items.push({ date, visits: 1, totalActiveSeconds: session.activeSeconds });
    }
  }

  const today = bishkekDateKey(now);
  const sevenStart = shiftDateKey(today, -6);
  const thirtyStart = shiftDateKey(today, -29);
  const within = (start) => items.filter((item) => item.date >= start && item.date <= today);

  return {
    generatedAt: now.toISOString(),
    timezone: ANALYTICS_TIME_ZONE,
    periods: {
      today: summarize(within(today)),
      sevenDays: summarize(within(sevenStart)),
      thirtyDays: summarize(within(thirtyStart)),
      allTime: summarize(items),
    },
  };
}

export function tokensEqual(provided, expected) {
  if (!provided || !expected) return false;
  const left = createHash('sha256').update(provided).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}
```

- [ ] **Step 4: Run the core tests**

Run:

```bash
node --test tests/analytics-core.test.mjs
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit the pure rules**

```bash
git add netlify/lib/analytics-core.mjs tests/analytics-core.test.mjs
git commit -m "feat: define anonymous analytics rules"
```

### Task 3: Atomic Blob repository and compaction

**Files:**
- Create: `tests/analytics-repository.test.mjs`
- Create: `netlify/lib/analytics-repository.mjs`

- [ ] **Step 1: Write an in-memory Blob fake and failing repository tests**

Create `tests/analytics-repository.test.mjs` with a `FakeStore` that implements `getWithMetadata`, `get`, `setJSON`, `list`, and `delete`, then add these tests:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { AnalyticsRepository } from '../netlify/lib/analytics-repository.mjs';

class FakeStore {
  constructor() {
    this.values = new Map();
    this.version = 0;
    this.forceConflict = false;
  }
  async getWithMetadata(key) {
    const entry = this.values.get(key);
    return entry ? { data: structuredClone(entry.data), etag: entry.etag, metadata: {} } : null;
  }
  async get(key) {
    return structuredClone(this.values.get(key)?.data ?? null);
  }
  async setJSON(key, data, options = {}) {
    const current = this.values.get(key);
    if (this.forceConflict) {
      this.forceConflict = false;
      return { modified: false };
    }
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    const etag = `"${++this.version}"`;
    this.values.set(key, { data: structuredClone(data), etag });
    return { modified: true, etag };
  }
  async list({ prefix }) {
    return {
      blobs: [...this.values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, etag: value.etag })),
      directories: [],
    };
  }
  async delete(key) {
    this.values.delete(key);
  }
}

test('upsertSession creates once and never lowers active time', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);
  const id = '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd';

  await repository.upsertSession(id, 50, new Date('2026-07-17T01:00:00.000Z'));
  await repository.upsertSession(id, 30, new Date('2026-07-17T01:01:00.000Z'));

  assert.deepEqual(await store.get(`sessions/${id}`), {
    startedAt: '2026-07-17T01:00:00.000Z',
    lastSeenAt: '2026-07-17T01:01:00.000Z',
    activeSeconds: 50,
  });
});

test('upsertSession retries an ETag conflict', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);
  store.forceConflict = true;

  await repository.upsertSession(
    '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd',
    12,
    new Date('2026-07-17T01:00:00.000Z')
  );

  assert.equal(store.values.size, 1);
});

test('compact writes one authoritative daily aggregate before deleting sessions', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);
  await store.setJSON('sessions/a', {
    startedAt: '2026-07-13T01:00:00.000Z',
    lastSeenAt: '2026-07-13T01:01:00.000Z',
    activeSeconds: 40,
  });
  await store.setJSON('sessions/b', {
    startedAt: '2026-07-13T02:00:00.000Z',
    lastSeenAt: '2026-07-13T02:01:00.000Z',
    activeSeconds: 20,
  });

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(await store.get('daily/2026-07-13'), {
    date: '2026-07-13',
    visits: 2,
    totalActiveSeconds: 60,
  });
  assert.equal((await store.list({ prefix: 'sessions/' })).blobs.length, 0);
  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 2 });
});

test('readDataset leaves duplicate cleanup to authoritative daily dates', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);
  await store.setJSON('daily/2026-07-13', { date: '2026-07-13', visits: 2, totalActiveSeconds: 60 });
  await store.setJSON('sessions/a', {
    startedAt: '2026-07-13T01:00:00.000Z',
    lastSeenAt: '2026-07-13T01:01:00.000Z',
    activeSeconds: 40,
  });

  const dataset = await repository.readDataset();
  assert.equal(dataset.daily.length, 1);
  assert.equal(dataset.sessions.length, 1);
});
```

- [ ] **Step 2: Run the repository test to verify it fails**

Run:

```bash
node --test tests/analytics-repository.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `analytics-repository.mjs`.

- [ ] **Step 3: Implement `AnalyticsRepository`**

Create `netlify/lib/analytics-repository.mjs` with:

```js
import { getStore } from '@netlify/blobs';
import { bishkekDateKey, isEligibleForCompaction, mergeSession } from './analytics-core.mjs';

export class AnalyticsStorageError extends Error {}

export class AnalyticsRepository {
  constructor(store) {
    this.store = store;
  }

  async upsertSession(sessionId, activeSeconds, now) {
    const key = `sessions/${sessionId}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.store.getWithMetadata(key, { consistency: 'strong', type: 'json' });
      const next = mergeSession(current?.data ?? null, activeSeconds, now);
      const options = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
      const result = await this.store.setJSON(key, next, options);
      if (result.modified) return next;
    }
    throw new AnalyticsStorageError('Session update conflict');
  }

  async readEntries(prefix) {
    const { blobs } = await this.store.list({ prefix });
    const entries = await Promise.all(
      blobs.map(async ({ key }) => ({
        key,
        data: await this.store.get(key, { consistency: 'strong', type: 'json' }),
      }))
    );
    return entries.filter((entry) => entry.data !== null);
  }

  async readDataset() {
    const [dailyEntries, sessionEntries] = await Promise.all([
      this.readEntries('daily/'),
      this.readEntries('sessions/'),
    ]);
    return {
      daily: dailyEntries.map((entry) => entry.data),
      sessions: sessionEntries.map((entry) => entry.data),
    };
  }

  async compact(now) {
    const [dailyEntries, sessionEntries] = await Promise.all([
      this.readEntries('daily/'),
      this.readEntries('sessions/'),
    ]);
    const existingDates = new Set(dailyEntries.map((entry) => entry.data.date));
    const groups = new Map();

    for (const entry of sessionEntries) {
      const date = bishkekDateKey(new Date(entry.data.startedAt));
      if (!isEligibleForCompaction(date, now)) continue;
      const group = groups.get(date) ?? [];
      group.push(entry);
      groups.set(date, group);
    }

    let compactedDays = 0;
    let deletedSessions = 0;
    for (const [date, entries] of groups) {
      if (!existingDates.has(date)) {
        const aggregate = {
          date,
          visits: entries.length,
          totalActiveSeconds: entries.reduce((sum, entry) => sum + entry.data.activeSeconds, 0),
        };
        const result = await this.store.setJSON(`daily/${date}`, aggregate, { onlyIfNew: true });
        if (!result.modified && !(await this.store.get(`daily/${date}`, { consistency: 'strong', type: 'json' }))) {
          throw new AnalyticsStorageError('Daily aggregate conflict');
        }
        existingDates.add(date);
        compactedDays += 1;
      }
      for (const entry of entries) {
        await this.store.delete(entry.key);
        deletedSessions += 1;
      }
    }
    return { compactedDays, deletedSessions };
  }
}

export function createAnalyticsRepository() {
  return new AnalyticsRepository(getStore('anonymous-analytics'));
}
```

- [ ] **Step 4: Run repository and core tests**

Run:

```bash
npm run test:unit
```

Expected: 11 tests PASS.

- [ ] **Step 5: Commit storage behavior**

```bash
git add netlify/lib/analytics-repository.mjs tests/analytics-repository.test.mjs
git commit -m "feat: persist anonymous analytics atomically"
```

### Task 4: Session, stats, and scheduled HTTP functions

**Files:**
- Create: `tests/analytics-functions.test.mjs`
- Create: `netlify/functions/analytics-session.mjs`
- Create: `netlify/functions/analytics-stats.mjs`
- Create: `netlify/functions/analytics-compact.mjs`

- [ ] **Step 1: Write failing handler tests**

Create `tests/analytics-functions.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionHandler } from '../netlify/functions/analytics-session.mjs';
import { createStatsHandler } from '../netlify/functions/analytics-stats.mjs';
import { createCompactHandler } from '../netlify/functions/analytics-compact.mjs';

const id = '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd';

test('session handler accepts only same-origin minimal events', async () => {
  const writes = [];
  const handler = createSessionHandler({
    repository: { upsertSession: async (...args) => writes.push(args) },
    now: () => new Date('2026-07-17T01:00:00.000Z'),
  });
  const response = await handler(new Request('https://lostfrxks.com/api/analytics/session', {
    method: 'POST',
    headers: { origin: 'https://lostfrxks.com', 'content-type': 'application/json', 'user-agent': 'Chrome' },
    body: JSON.stringify({ sessionId: id, activeSeconds: 10 }),
  }));

  assert.equal(response.status, 204);
  assert.deepEqual(writes[0], [id, 10, new Date('2026-07-17T01:00:00.000Z')]);
});

test('session handler rejects cross-origin, extra fields, and oversized input', async () => {
  const handler = createSessionHandler({ repository: { upsertSession: async () => assert.fail('must not write') } });
  const crossOrigin = await handler(new Request('https://lostfrxks.com/api/analytics/session', {
    method: 'POST',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: id, activeSeconds: 1 }),
  }));
  const extra = await handler(new Request('https://lostfrxks.com/api/analytics/session', {
    method: 'POST',
    headers: { origin: 'https://lostfrxks.com', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: id, activeSeconds: 1, referrer: 'secret' }),
  }));
  const oversized = await handler(new Request('https://lostfrxks.com/api/analytics/session', {
    method: 'POST',
    headers: { origin: 'https://lostfrxks.com', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: id, activeSeconds: 1, padding: 'x'.repeat(600) }),
  }));

  assert.equal(crossOrigin.status, 403);
  assert.equal(extra.status, 400);
  assert.equal(oversized.status, 413);
});

test('session handler silently ignores known bots', async () => {
  const handler = createSessionHandler({ repository: { upsertSession: async () => assert.fail('must not write') } });
  const response = await handler(new Request('https://lostfrxks.com/api/analytics/session', {
    method: 'POST',
    headers: { origin: 'https://lostfrxks.com', 'content-type': 'application/json', 'user-agent': 'Googlebot' },
    body: JSON.stringify({ sessionId: id, activeSeconds: 1 }),
  }));
  assert.equal(response.status, 204);
});

test('stats handler protects and returns aggregate-only data', async () => {
  const repository = {
    readDataset: async () => ({
      daily: [],
      sessions: [{ startedAt: '2026-07-17T01:00:00.000Z', lastSeenAt: '2026-07-17T01:00:10.000Z', activeSeconds: 10 }],
    }),
  };
  const handler = createStatsHandler({
    repository,
    adminToken: 'correct-secret',
    now: () => new Date('2026-07-17T06:00:00.000Z'),
  });
  const denied = await handler(new Request('https://lostfrxks.com/api/analytics/stats'));
  const allowed = await handler(new Request('https://lostfrxks.com/api/analytics/stats', {
    headers: { authorization: 'Bearer correct-secret' },
  }));
  const body = await allowed.json();

  assert.equal(denied.status, 401);
  assert.equal(allowed.status, 200);
  assert.deepEqual(body.periods.today, { visits: 1, averageActiveSeconds: 10 });
  assert.equal(JSON.stringify(body).includes('startedAt'), false);
});

test('compact handler delegates to the repository', async () => {
  const calls = [];
  const handler = createCompactHandler({
    repository: { compact: async (now) => { calls.push(now); return { compactedDays: 1, deletedSessions: 2 }; } },
    now: () => new Date('2026-07-17T00:00:00.000Z'),
  });
  await handler(new Request('https://example.invalid'));
  assert.deepEqual(calls, [new Date('2026-07-17T00:00:00.000Z')]);
});
```

- [ ] **Step 2: Run the handler tests to verify they fail**

Run:

```bash
node --test tests/analytics-functions.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the first function module.

- [ ] **Step 3: Implement the session function**

Create `netlify/functions/analytics-session.mjs`:

```js
import { AnalyticsInputError, isKnownBot, parseSessionPayload } from '../lib/analytics-core.mjs';
import { createAnalyticsRepository } from '../lib/analytics-repository.mjs';

const NO_STORE = { 'cache-control': 'no-store' };

function emptyResponse(status, extraHeaders = {}) {
  return new Response(null, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

export function createSessionHandler({
  repository = createAnalyticsRepository(),
  now = () => new Date(),
} = {}) {
  return async function analyticsSession(request) {
    if (request.method !== 'POST') {
      return emptyResponse(405, { allow: 'POST' });
    }
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      return emptyResponse(403);
    }
    if ((request.headers.get('content-type') ?? '').split(';', 1)[0].trim() !== 'application/json') {
      return emptyResponse(415);
    }
    if (isKnownBot(request.headers.get('user-agent') ?? '')) {
      return emptyResponse(204);
    }

    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 512) {
      return emptyResponse(413);
    }

    let payload;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 512) return emptyResponse(413);
      payload = parseSessionPayload(JSON.parse(text));
    } catch (error) {
      if (error instanceof AnalyticsInputError || error instanceof SyntaxError) {
        return emptyResponse(400);
      }
      return emptyResponse(400);
    }

    try {
      await repository.upsertSession(payload.sessionId, payload.activeSeconds, now());
      return emptyResponse(204);
    } catch (error) {
      console.error('Anonymous analytics session write failed', error?.message ?? 'unknown error');
      return emptyResponse(503);
    }
  };
}

export default createSessionHandler();

export const config = {
  path: '/api/analytics/session',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowLimit: 60,
    windowSize: 60,
  },
};
```

- [ ] **Step 4: Implement the stats function**

Create `netlify/functions/analytics-stats.mjs`:

```js
import { buildStats, tokensEqual } from '../lib/analytics-core.mjs';
import { createAnalyticsRepository } from '../lib/analytics-repository.mjs';

const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function bearerToken(request) {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? '';
}

export function createStatsHandler({
  repository = createAnalyticsRepository(),
  adminToken = process.env.ANALYTICS_ADMIN_TOKEN ?? '',
  now = () => new Date(),
} = {}) {
  return async function analyticsStats(request) {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET' } });
    }
    if (!adminToken) return json(503, { error: 'Analytics are not configured.' });
    if (!tokensEqual(bearerToken(request), adminToken)) {
      return json(401, { error: 'Unauthorized.' });
    }
    try {
      const dataset = await repository.readDataset();
      return json(200, buildStats({ ...dataset, now: now() }));
    } catch (error) {
      console.error('Anonymous analytics stats read failed', error?.message ?? 'unknown error');
      return json(503, { error: 'Analytics are temporarily unavailable.' });
    }
  };
}

export default createStatsHandler();

export const config = {
  path: '/api/analytics/stats',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowLimit: 20,
    windowSize: 60,
  },
};
```

- [ ] **Step 5: Implement the scheduled compactor**

Create `netlify/functions/analytics-compact.mjs`:

```js
import { createAnalyticsRepository } from '../lib/analytics-repository.mjs';

export function createCompactHandler({
  repository = createAnalyticsRepository(),
  now = () => new Date(),
} = {}) {
  return async function compactAnalytics() {
    const result = await repository.compact(now());
    console.info('Anonymous analytics compaction complete', result);
  };
}

export default createCompactHandler();

export const config = {
  schedule: '@daily',
};
```

- [ ] **Step 6: Run handler and build verification**

Run:

```bash
npm run test:unit
npx netlify functions:build
```

Expected: all unit tests PASS; Netlify builds three functions without an import/config error.

- [ ] **Step 7: Commit the functions**

```bash
git add netlify/functions tests/analytics-functions.test.mjs
git commit -m "feat: expose anonymous analytics functions"
```

### Task 5: Public visible-time tracker

**Files:**
- Create: `tests/analytics-tracker.test.mjs`
- Create: `analytics.mjs`
- Modify: `index.html:577-579`

- [ ] **Step 1: Write failing deterministic tracker tests**

Create `tests/analytics-tracker.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createActiveTimer, getOrCreateSessionId } from '../analytics.mjs';

test('active timer excludes time sampled while hidden', () => {
  let now = 0;
  let visible = true;
  const timer = createActiveTimer({ now: () => now, isVisible: () => visible });

  now = 1_500;
  assert.equal(timer.sample(), 1);
  visible = false;
  timer.sample();
  now = 9_500;
  assert.equal(timer.sample(), 1);
  visible = true;
  timer.sample();
  now = 11_500;
  assert.equal(timer.sample(), 3);
});

test('getOrCreateSessionId reuses sessionStorage across reloads', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const crypto = { randomUUID: () => '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd' };

  assert.equal(getOrCreateSessionId(storage, crypto), crypto.randomUUID());
  assert.equal(getOrCreateSessionId(storage, { randomUUID: () => 'different' }), crypto.randomUUID());
});
```

- [ ] **Step 2: Run the tracker tests to verify they fail**

Run:

```bash
node --test tests/analytics-tracker.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `analytics.mjs`.

- [ ] **Step 3: Implement `analytics.mjs`**

Create `analytics.mjs`:

```js
const SESSION_KEY = 'lostfrxks.analytics.session';
const ENDPOINT = '/api/analytics/session';
const HEARTBEAT_MS = 20_000;
const MAX_ACTIVE_MS = 43_200_000;

export function createActiveTimer({ now, isVisible }) {
  let lastSample = now();
  let wasVisible = isVisible();
  let activeMilliseconds = 0;

  return {
    sample() {
      const current = now();
      if (wasVisible) {
        activeMilliseconds = Math.min(
          MAX_ACTIVE_MS,
          activeMilliseconds + Math.max(0, current - lastSample)
        );
      }
      lastSample = current;
      wasVisible = isVisible();
      return Math.floor(activeMilliseconds / 1000);
    },
  };
}

export function getOrCreateSessionId(storage, cryptoImpl) {
  try {
    const existing = storage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = cryptoImpl.randomUUID();
    storage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return cryptoImpl.randomUUID();
  }
}

export function startAnalytics({
  browserWindow = window,
  browserDocument = document,
  endpoint = ENDPOINT,
} = {}) {
  const sessionId = getOrCreateSessionId(browserWindow.sessionStorage, browserWindow.crypto);
  const timer = createActiveTimer({
    now: () => browserWindow.performance.now(),
    isVisible: () => browserDocument.visibilityState === 'visible',
  });

  const body = () => JSON.stringify({ sessionId, activeSeconds: timer.sample() });
  const send = () => {
    try {
      void browserWindow.fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body(),
        cache: 'no-store',
        credentials: 'omit',
        keepalive: true,
        referrerPolicy: 'no-referrer',
      }).catch(() => {});
    } catch {}
  };
  const flush = () => send();

  send();
  const intervalId = browserWindow.setInterval(send, HEARTBEAT_MS);
  browserDocument.addEventListener('visibilitychange', send);
  browserWindow.addEventListener('pagehide', flush);

  return () => {
    browserWindow.clearInterval(intervalId);
    browserDocument.removeEventListener('visibilitychange', send);
    browserWindow.removeEventListener('pagehide', flush);
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    startAnalytics();
  } catch {}
}
```

- [ ] **Step 4: Load the isolated module in `index.html`**

Immediately before `</body>`, after the existing classic scripts, add:

```html
<script type="module" src="analytics.mjs?v=anonymous-analytics-20260717"></script>
```

- [ ] **Step 5: Run tracker and existing browser tests**

Run:

```bash
npm run test:unit
npm run test:browser
```

Expected: all unit tests and all existing portfolio Playwright tests PASS; failed local `/api/analytics/session` responses do not break any page assertion.

- [ ] **Step 6: Commit the tracker**

```bash
git add analytics.mjs index.html tests/analytics-tracker.test.mjs
git commit -m "feat: track anonymous active sessions"
```

### Task 6: Tracker privacy browser coverage

**Files:**
- Create: `tests/analytics.spec.js`

- [ ] **Step 1: Add browser tests for minimal payload and reload identity**

Create `tests/analytics.spec.js`:

```js
const { test, expect } = require('@playwright/test');

test('tracker sends only an anonymous session ID and active seconds across reloads', async ({ page }) => {
  const events = [];
  const referrers = [];
  await page.route('**/api/analytics/session', async (route) => {
    events.push(route.request().postDataJSON());
    referrers.push(route.request().headers().referer);
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  await expect.poll(() => events.length).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect.poll(() => events.length).toBeGreaterThanOrEqual(2);

  expect(Object.keys(events[0]).sort()).toEqual(['activeSeconds', 'sessionId']);
  expect(events[0].sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(events[0].activeSeconds).toBe(0);
  expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
  expect(referrers.every((value) => value === undefined)).toBe(true);
});

test('analytics failures never break the public portfolio', async ({ page }) => {
  await page.route('**/api/analytics/session', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/');

  await expect(page).toHaveTitle('Artur Usenov — Backend / AI Backend Engineer');
  await expect(page.getByRole('button', { name: /enter matrix intro/i })).toBeVisible();
});
```

- [ ] **Step 2: Add a visibility-state browser test**

Append this exact test to `tests/analytics.spec.js`:

```js
test('tracker excludes time spent while the document is hidden', async ({ page }) => {
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
  await page.route('**/api/analytics/session', async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.__setAnalyticsVisibility('hidden'));
  await expect.poll(() => events.length).toBeGreaterThanOrEqual(2);
  const secondsBeforeHiddenWait = events.at(-1).activeSeconds;
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.__setAnalyticsVisibility('visible'));
  await expect.poll(() => events.length).toBeGreaterThanOrEqual(3);

  expect(events.at(-1).activeSeconds).toBe(secondsBeforeHiddenWait);
});
```

- [ ] **Step 3: Run the focused browser file**

Run:

```bash
npx playwright test tests/analytics.spec.js
```

Expected: all tracker privacy tests PASS.

- [ ] **Step 4: Commit the browser coverage**

```bash
git add tests/analytics.spec.js
git commit -m "test: cover anonymous tracker privacy"
```

### Task 7: Private dashboard

**Files:**
- Modify: `tests/analytics.spec.js`
- Create: `analytics.html`
- Create: `analytics.css`
- Create: `analytics-dashboard.mjs`

- [ ] **Step 1: Write failing dashboard browser tests**

Append these tests to `tests/analytics.spec.js`:

```js
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

test('private dashboard unlocks with a bearer token and renders aggregates', async ({ page }) => {
  let observedAuthorization = '';
  await page.route('**/api/analytics/stats', async (route) => {
    observedAuthorization = route.request().headers().authorization;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboardResponse) });
  });

  await page.goto('/analytics.html');
  await expect(page.getByRole('heading', { name: /private analytics/i })).toBeVisible();
  await expect(page.locator('[data-dashboard]')).toBeHidden();
  await page.getByLabel(/admin token/i).fill('correct-secret');
  await page.getByRole('button', { name: /unlock/i }).click();

  expect(observedAuthorization).toBe('Bearer correct-secret');
  await expect(page.locator('[data-period="today"] [data-visits]')).toHaveText('4');
  await expect(page.locator('[data-period="today"] [data-average]')).toHaveText('1m 5s');
});

test('private dashboard exposes no metrics for a wrong token', async ({ page }) => {
  await page.route('**/api/analytics/stats', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Unauthorized.' }),
  }));
  await page.goto('/analytics.html');
  await page.getByLabel(/admin token/i).fill('wrong-secret');
  await page.getByRole('button', { name: /unlock/i }).click();

  await expect(page.locator('[data-error]')).toHaveText('Invalid admin token.');
  await expect(page.locator('[data-dashboard]')).toBeHidden();
});

test('private dashboard keeps the tab token across a temporary server failure', async ({ page }) => {
  await page.route('**/api/analytics/stats', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Unavailable.' }),
  }));
  await page.goto('/analytics.html');
  await page.getByLabel(/admin token/i).fill('correct-secret');
  await page.getByRole('button', { name: /unlock/i }).click();

  await expect(page.locator('[data-error]')).toHaveText('Analytics are temporarily unavailable.');
  await expect(page.getByLabel(/admin token/i)).toHaveValue('correct-secret');
  await expect(page.locator('[data-dashboard]')).toBeHidden();
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
npx playwright test tests/analytics.spec.js
```

Expected: tracker tests PASS and dashboard tests FAIL because `/analytics.html` does not exist.

- [ ] **Step 3: Create semantic dashboard markup**

Create `analytics.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Private Analytics — lostfrxks</title>
    <link rel="icon" type="image/svg+xml" href="favicon.svg">
    <link rel="stylesheet" href="analytics.css?v=anonymous-analytics-20260717">
  </head>
  <body>
    <main class="analytics-shell">
      <header class="analytics-header">
        <p class="prompt">lostfrxks@portfolio:~$ analytics --private</p>
        <h1>Private analytics</h1>
        <p>Anonymous visits and active viewing time.</p>
      </header>

      <p class="analytics-error" data-error role="alert" hidden></p>

      <form class="analytics-login" data-login-form>
        <label for="admin-token">Admin token</label>
        <div class="analytics-login__controls">
          <input id="admin-token" name="token" type="password" autocomplete="current-password" required>
          <button type="submit">Unlock</button>
        </div>
      </form>

      <section data-dashboard hidden aria-label="Anonymous analytics summary">
        <div class="analytics-toolbar">
          <p>Timezone: <span data-timezone>—</span> · Updated: <span data-updated>—</span></p>
          <div>
            <button type="button" data-refresh>Refresh</button>
            <button type="button" data-lock>Lock</button>
          </div>
        </div>
        <div class="analytics-grid">
          <article class="analytics-card" data-period="today">
            <h2>Today</h2><strong data-visits>0</strong><span>anonymous visits</span>
            <p>Average active time: <b data-average>0s</b></p>
          </article>
          <article class="analytics-card" data-period="sevenDays">
            <h2>Last 7 days</h2><strong data-visits>0</strong><span>anonymous visits</span>
            <p>Average active time: <b data-average>0s</b></p>
          </article>
          <article class="analytics-card" data-period="thirtyDays">
            <h2>Last 30 days</h2><strong data-visits>0</strong><span>anonymous visits</span>
            <p>Average active time: <b data-average>0s</b></p>
          </article>
          <article class="analytics-card" data-period="allTime">
            <h2>All time</h2><strong data-visits>0</strong><span>anonymous visits</span>
            <p>Average active time: <b data-average>0s</b></p>
          </article>
        </div>
      </section>
    </main>
    <script type="module" src="analytics-dashboard.mjs?v=anonymous-analytics-20260717"></script>
  </body>
</html>
```

Do not add a link to this page from `index.html`.

- [ ] **Step 4: Implement dashboard behavior**

Create `analytics-dashboard.mjs`:

```js
const TOKEN_KEY = 'lostfrxks.analytics.adminToken';
const PERIOD_KEYS = ['today', 'sevenDays', 'thirtyDays', 'allTime'];

export function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes}m ${safe % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function renderStats(root, stats) {
  for (const key of PERIOD_KEYS) {
    const card = root.querySelector(`[data-period="${key}"]`);
    card.querySelector('[data-visits]').textContent = String(stats.periods[key].visits);
    card.querySelector('[data-average]').textContent = formatDuration(stats.periods[key].averageActiveSeconds);
  }
  root.querySelector('[data-timezone]').textContent = stats.timezone;
  root.querySelector('[data-updated]').textContent = new Date(stats.generatedAt).toLocaleString(undefined, {
    timeZone: stats.timezone,
  });
}

function initializeDashboard() {
  const loginForm = document.querySelector('[data-login-form]');
  const tokenInput = document.querySelector('#admin-token');
  const error = document.querySelector('[data-error]');
  const dashboard = document.querySelector('[data-dashboard]');
  const refresh = document.querySelector('[data-refresh]');
  const lock = document.querySelector('[data-lock]');

  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  const clearError = () => {
    error.textContent = '';
    error.hidden = true;
  };
  const showLocked = () => {
    dashboard.hidden = true;
    loginForm.hidden = false;
  };

  const load = async (token) => {
    clearError();
    try {
      const response = await fetch('/api/analytics/stats', {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        showLocked();
        showError('Invalid admin token.');
        return;
      }
      if (!response.ok) throw new Error('stats unavailable');
      renderStats(dashboard, await response.json());
      loginForm.hidden = true;
      dashboard.hidden = false;
    } catch {
      showLocked();
      showError('Analytics are temporarily unavailable.');
    }
  };

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return;
    sessionStorage.setItem(TOKEN_KEY, token);
    void load(token);
  });
  refresh.addEventListener('click', () => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) void load(token);
  });
  lock.addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    tokenInput.value = '';
    clearError();
    showLocked();
  });

  const savedToken = sessionStorage.getItem(TOKEN_KEY);
  if (savedToken) {
    tokenInput.value = savedToken;
    void load(savedToken);
  }
}

if (typeof document !== 'undefined') initializeDashboard();
```

- [ ] **Step 5: Style the private page**

Create `analytics.css`:

```css
:root {
  color-scheme: dark;
  --background: #020403;
  --panel: #07100c;
  --line: rgba(92, 255, 177, 0.3);
  --text: #d8ffe9;
  --muted: #86aa96;
  --green: #5cffb1;
  --error: #ff7b8b;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  min-height: 100vh;
  margin: 0;
  color: var(--text);
  background: radial-gradient(circle at top, #0a2117 0, var(--background) 45%);
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
}
button, input { font: inherit; }
button {
  border: 1px solid var(--green);
  border-radius: 4px;
  padding: 0.72rem 1rem;
  color: var(--background);
  background: var(--green);
  cursor: pointer;
}
button:hover { filter: brightness(1.08); }
button:focus-visible, input:focus-visible { outline: 3px solid rgba(101, 231, 255, 0.55); outline-offset: 2px; }
.analytics-shell { width: min(1080px, calc(100% - 2rem)); margin: 0 auto; padding: 8vh 0 4rem; }
.analytics-header { margin-bottom: 2rem; }
.analytics-header h1 { margin: 0.35rem 0; color: var(--green); font-size: clamp(2rem, 6vw, 4rem); }
.analytics-header p { color: var(--muted); }
.analytics-header .prompt { color: var(--green); }
.analytics-login, .analytics-toolbar, .analytics-card {
  border: 1px solid var(--line);
  background: rgba(7, 16, 12, 0.9);
  box-shadow: 0 18px 70px rgba(0, 0, 0, 0.35);
}
.analytics-login { max-width: 620px; padding: 1.25rem; }
.analytics-login label { display: block; margin-bottom: 0.7rem; color: var(--green); }
.analytics-login__controls { display: flex; gap: 0.75rem; }
.analytics-login input {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.72rem;
  color: var(--text);
  background: #010201;
}
.analytics-error { max-width: 620px; color: var(--error); }
.analytics-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem; }
.analytics-toolbar p { margin: 0; color: var(--muted); }
.analytics-toolbar div { display: flex; gap: 0.5rem; }
.analytics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
.analytics-card { min-height: 220px; padding: 1.25rem; }
.analytics-card h2 { margin-top: 0; color: var(--muted); font-size: 0.95rem; }
.analytics-card > strong { display: block; margin-top: 1.75rem; color: var(--green); font-size: clamp(2.5rem, 6vw, 4.5rem); }
.analytics-card > span, .analytics-card p { color: var(--muted); }
.analytics-card b { color: var(--text); }
@media (max-width: 820px) {
  .analytics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .analytics-login__controls, .analytics-toolbar { align-items: stretch; flex-direction: column; }
  .analytics-grid { grid-template-columns: 1fr; }
  .analytics-toolbar div { width: 100%; }
  .analytics-toolbar button { flex: 1; }
}
```

- [ ] **Step 6: Run dashboard and accessibility-facing tests**

Run:

```bash
npx playwright test tests/analytics.spec.js
```

Expected: tracker and dashboard tests PASS.

- [ ] **Step 7: Commit the dashboard**

```bash
git add analytics.html analytics.css analytics-dashboard.mjs tests/analytics.spec.js
git commit -m "feat: add private analytics dashboard"
```

### Task 8: Documentation and configuration handoff

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an analytics section to `README.md`**

Append this section after the existing deployment section:

````markdown
## private analytics

The portfolio includes first-party anonymous analytics backed by Netlify Functions and Netlify Blobs. The browser sends only:

```json
{
  "sessionId": "random tab-scoped UUID",
  "activeSeconds": 42
}
```

The session ID is the Blob key. A live Blob value contains only `startedAt`, `lastSeenAt`, and `activeSeconds`. Application code does not store IP addresses, user agents, referrers, URL parameters, location, or device information. Netlify may retain ordinary infrastructure logs independently of this dataset.

`/analytics.html` is intentionally unlinked. Its data API requires the `ANALYTICS_ADMIN_TOKEN` Netlify environment variable. Generate at least 32 random bytes:

```bash
openssl rand -hex 32
```

Copy the result to **Netlify → Project configuration → Environment variables → `ANALYTICS_ADMIN_TOKEN`**. Never place the value in this repository or a tracked `.env` file.

For the static site only:

```bash
npm run start
```

For Functions and sandboxed local Blobs, open `http://localhost:8888` after running:

```bash
ANALYTICS_ADMIN_TOKEN=local-development-secret npm run dev
```

Netlify's Free plan has a finite monthly allowance. Check project usage after deployment, especially if traffic or heartbeat volume increases.
````

- [ ] **Step 2: Verify documentation commands**

Run:

```bash
npm run test:unit
npx netlify functions:build
git diff --check
```

Expected: tests PASS, Functions build exits `0`, and `git diff --check` prints nothing.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain private analytics operation"
```

### Task 9: Full verification

**Files:**
- Verify all files from Tasks 1-8; no new implementation files expected.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: all Node unit tests and the complete Playwright suite PASS.

- [ ] **Step 2: Build every Netlify Function**

Run:

```bash
npx netlify functions:build
```

Expected: session, stats, and compact functions all build successfully.

- [ ] **Step 3: Exercise the local Netlify flow**

Start:

```bash
ANALYTICS_ADMIN_TOKEN=local-development-secret npm run dev
```

At `http://localhost:8888`, open the portfolio, wait at least 20 seconds, reload, then open `/analytics.html` and unlock with `local-development-secret`.

Expected: reload keeps one visit, active time is non-zero, a fresh tab creates another visit, a wrong token returns no data, and the portfolio works if the session endpoint is blocked.

- [ ] **Step 4: Inspect the privacy boundary**

In browser DevTools, inspect `/api/analytics/session` and confirm the JSON has exactly `sessionId` and `activeSeconds`. In Netlify Dev's sandbox Blob store, confirm the session value has exactly `startedAt`, `lastSeenAt`, and `activeSeconds`.

Expected: no IP, user agent, referrer, URL, query string, geography, language, or device fields exist in application storage or responses.

- [ ] **Step 5: Check repository cleanliness**

Run:

```bash
git status --short
git log --oneline -10
```

Expected: no uncommitted analytics files; the user's pre-existing `.serena/` directory remains untouched; the task commits are visible in order.
