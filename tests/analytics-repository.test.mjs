import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalyticsRepository,
  AnalyticsStorageError,
  createAnalyticsRepository,
} from '../netlify/lib/analytics-repository.mjs';

const STRONG_JSON = { consistency: 'strong', type: 'json' };

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeStore {
  constructor({ includeCrossPrefix = false, pageSize = Number.POSITIVE_INFINITY } = {}) {
    this.entries = new Map();
    this.includeCrossPrefix = includeCrossPrefix;
    this.pageSize = pageSize;
    this.revision = 0;
    this.beforeDelete = null;
    this.beforeSet = null;
    this.forceConflicts = new Set();
    this.getErrors = new Map();
    this.calls = {
      delete: [],
      get: [],
      getWithMetadata: [],
      list: [],
      setJSON: [],
    };
  }

  put(key, data) {
    const etag = `etag-${++this.revision}`;
    this.entries.set(key, { data: clone(data), etag });
    return etag;
  }

  async getWithMetadata(key, options) {
    this.calls.getWithMetadata.push({ key, options: clone(options) });
    const entry = this.entries.get(key);
    return entry
      ? { data: clone(entry.data), etag: entry.etag, metadata: {} }
      : null;
  }

  async get(key, options) {
    this.calls.get.push({ key, options: clone(options) });
    if (this.getErrors.has(key)) {
      throw this.getErrors.get(key);
    }
    return clone(this.entries.get(key)?.data ?? null);
  }

  async setJSON(key, data, options = {}) {
    this.calls.setJSON.push({ key, data: clone(data), options: clone(options) });
    if (this.beforeSet) {
      await this.beforeSet({ data: clone(data), key, options: clone(options), store: this });
    }

    if (this.forceConflicts.has(key)) {
      return { modified: false };
    }

    const current = this.entries.get(key);
    if (options.onlyIfNew && current) {
      return { modified: false };
    }
    if (Object.hasOwn(options, 'onlyIfMatch') && current?.etag !== options.onlyIfMatch) {
      return { modified: false };
    }

    const etag = this.put(key, data);
    return { etag, modified: true };
  }

  async list(options = {}) {
    this.calls.list.push(clone(options));
    const prefix = options.prefix ?? '';
    const keys = [...this.entries.keys()]
      .filter((key) => this.includeCrossPrefix || key.startsWith(prefix))
      .sort();
    const start = Number(options.cursor ?? 0);
    const end = Math.min(start + this.pageSize, keys.length);
    const result = {
      blobs: keys.slice(start, end).map((key) => ({
        etag: this.entries.get(key).etag,
        key,
      })),
      directories: [],
    };
    if (end < keys.length) {
      result.nextCursor = String(end);
    }
    return result;
  }

  async delete(key) {
    this.calls.delete.push(key);
    if (this.beforeDelete) {
      await this.beforeDelete({ key, store: this });
    }
    this.entries.delete(key);
  }
}

function session(startedAt, activeSeconds, lastSeenAt = startedAt) {
  return { startedAt, lastSeenAt, activeSeconds };
}

test('exports a factory without requiring a live Netlify context at import time', () => {
  assert.equal(typeof createAnalyticsRepository, 'function');
});

test('upsertSession creates once and forward updates never lower active time', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);
  const sessionId = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';

  const created = await repository.upsertSession(
    sessionId,
    40,
    new Date('2026-07-13T08:00:00.000Z'),
  );
  const updated = await repository.upsertSession(
    sessionId,
    20,
    new Date('2026-07-13T08:05:00.000Z'),
  );

  assert.deepEqual(created, session('2026-07-13T08:00:00.000Z', 40));
  assert.deepEqual(updated, {
    startedAt: '2026-07-13T08:00:00.000Z',
    lastSeenAt: '2026-07-13T08:05:00.000Z',
    activeSeconds: 40,
  });
  assert.deepEqual(store.calls.getWithMetadata.map(({ options }) => options), [
    STRONG_JSON,
    STRONG_JSON,
  ]);
  assert.deepEqual(store.calls.setJSON.map(({ options }) => options), [
    { onlyIfNew: true },
    { onlyIfMatch: 'etag-1' },
  ]);
});

test('upsertSession retries an ETag conflict and remerges a competing value', async () => {
  const store = new FakeStore();
  const sessionId = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
  const key = `sessions/${sessionId}`;
  store.put(key, session('2026-07-13T08:00:00.000Z', 10));
  let competed = false;
  store.beforeSet = ({ options }) => {
    if (!competed && Object.hasOwn(options, 'onlyIfMatch')) {
      competed = true;
      store.put(
        key,
        session(
          '2026-07-13T07:55:00.000Z',
          90,
          '2026-07-13T08:06:00.000Z',
        ),
      );
    }
  };
  const repository = new AnalyticsRepository(store);

  const result = await repository.upsertSession(
    sessionId,
    30,
    new Date('2026-07-13T08:05:00.000Z'),
  );

  assert.deepEqual(result, {
    startedAt: '2026-07-13T07:55:00.000Z',
    lastSeenAt: '2026-07-13T08:06:00.000Z',
    activeSeconds: 90,
  });
  assert.equal(store.calls.getWithMetadata.length, 2);
  assert.deepEqual(store.entries.get(key).data, result);
});

test('upsertSession stops after three conflicts with a storage error', async () => {
  const store = new FakeStore();
  const sessionId = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
  const key = `sessions/${sessionId}`;
  store.put(key, session('2026-07-13T08:00:00.000Z', 10));
  store.beforeSet = () => {
    store.put(key, session('2026-07-13T08:00:00.000Z', 50));
  };
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.upsertSession(sessionId, 30, new Date('2026-07-13T08:05:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Session update conflict',
  );
  assert.equal(store.calls.getWithMetadata.length, 3);
  assert.equal(store.calls.setJSON.length, 3);
});

test('readDataset reads all pages, excludes cross-prefix keys, and preserves authoritative duplicates', async () => {
  const store = new FakeStore({ includeCrossPrefix: true, pageSize: 1 });
  const daily = { date: '2026-07-13', visits: 2, totalActiveSeconds: 60 };
  const rawDuplicate = session('2026-07-13T08:00:00.000Z', 40);
  const rawCurrent = session('2026-07-16T08:00:00.000Z', 15);
  store.put('daily/2026-07-13', daily);
  store.put('sessions/a', rawDuplicate);
  store.put('sessions/b', rawCurrent);
  store.put('sessions-archive/not-current', session('2026-07-12T08:00:00.000Z', 999));
  const repository = new AnalyticsRepository(store);

  const dataset = await repository.readDataset();

  assert.deepEqual(dataset, {
    daily: [daily],
    sessions: [rawDuplicate, rawCurrent],
  });
  assert.ok(store.calls.get.every(({ options }) => (
    options.consistency === 'strong' && options.type === 'json'
  )));
  assert.ok(store.calls.list.some(({ cursor }) => cursor !== undefined));
});

test('compact creates one exact daily aggregate and deletes its eligible sessions', async () => {
  const store = new FakeStore();
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  store.put('sessions/b', session('2026-07-13T09:00:00.000Z', 20));
  const repository = new AnalyticsRepository(store);

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(store.entries.get('daily/2026-07-13').data, {
    date: '2026-07-13',
    visits: 2,
    totalActiveSeconds: 60,
  });
  assert.equal(store.entries.has('sessions/a'), false);
  assert.equal(store.entries.has('sessions/b'), false);
  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 2 });
  assert.deepEqual(
    store.calls.setJSON.find(({ key }) => key === 'daily/2026-07-13').options,
    { onlyIfNew: true },
  );
});

test('compact leaves recent ineligible sessions untouched', async () => {
  const store = new FakeStore();
  const recent = session('2026-07-15T08:00:00.000Z', 25);
  store.put('sessions/recent', recent);
  const repository = new AnalyticsRepository(store);

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(result, { compactedDays: 0, deletedSessions: 0 });
  assert.deepEqual(store.entries.get('sessions/recent').data, recent);
  assert.equal(store.calls.setJSON.length, 0);
});

test('compact treats an existing daily aggregate as authoritative and cleans duplicate raw sessions', async () => {
  const store = new FakeStore();
  const authoritative = { date: '2026-07-13', visits: 7, totalActiveSeconds: 999 };
  store.put('daily/2026-07-13', authoritative);
  store.put('sessions/duplicate', session('2026-07-13T08:00:00.000Z', 40));
  const repository = new AnalyticsRepository(store);

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(result, { compactedDays: 0, deletedSessions: 1 });
  assert.deepEqual(store.entries.get('daily/2026-07-13').data, authoritative);
  assert.equal(store.entries.has('sessions/duplicate'), false);
  assert.equal(store.calls.setJSON.length, 0);
});

test('compact race loser deletes only after strongly reading the winning daily aggregate', async () => {
  const store = new FakeStore();
  const winner = { date: '2026-07-13', visits: 8, totalActiveSeconds: 400 };
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  let raced = false;
  store.beforeSet = ({ key, options }) => {
    if (!raced && key === 'daily/2026-07-13' && options.onlyIfNew) {
      raced = true;
      store.put(key, winner);
    }
  };
  const repository = new AnalyticsRepository(store);

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(result, { compactedDays: 0, deletedSessions: 1 });
  assert.equal(store.entries.has('sessions/a'), false);
  assert.deepEqual(store.entries.get('daily/2026-07-13').data, winner);
  assert.deepEqual(
    store.calls.get.find(({ key }) => key === 'daily/2026-07-13').options,
    STRONG_JSON,
  );
});

test('compact conflict without a readable authoritative daily throws and keeps raw sessions', async () => {
  const store = new FakeStore();
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  store.forceConflicts.add('daily/2026-07-13');
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.compact(new Date('2026-07-17T00:00:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Daily aggregate conflict',
  );
  assert.equal(store.entries.has('sessions/a'), true);
  assert.deepEqual(store.calls.delete, []);
});

test('compact propagates a confirmation read failure and keeps raw sessions', async () => {
  const store = new FakeStore();
  const storageFailure = new Error('daily read unavailable');
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  store.forceConflicts.add('daily/2026-07-13');
  store.getErrors.set('daily/2026-07-13', storageFailure);
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.compact(new Date('2026-07-17T00:00:00.000Z')),
    (error) => error === storageFailure,
  );
  assert.equal(store.entries.has('sessions/a'), true);
  assert.deepEqual(store.calls.delete, []);
});

test('compact aborts before writing when a session read has an operational failure', async () => {
  const store = new FakeStore();
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  store.put('sessions/b', session('2026-07-13T09:00:00.000Z', 20));
  const storageFailure = new Error('storage unavailable');
  store.getErrors.set('sessions/b', storageFailure);
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.compact(new Date('2026-07-17T00:00:00.000Z')),
    storageFailure,
  );
  assert.equal(store.entries.has('daily/2026-07-13'), false);
  assert.equal(store.entries.has('sessions/a'), true);
  assert.equal(store.entries.has('sessions/b'), true);
  assert.deepEqual(store.calls.delete, []);
});

test('compact is idempotent after a partial deletion failure', async () => {
  const store = new FakeStore();
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  store.put('sessions/b', session('2026-07-13T09:00:00.000Z', 20));
  let deletes = 0;
  store.beforeDelete = () => {
    deletes += 1;
    if (deletes === 2) {
      throw new Error('transient delete failure');
    }
  };
  const repository = new AnalyticsRepository(store);
  const now = new Date('2026-07-17T00:00:00.000Z');

  await assert.rejects(repository.compact(now), /transient delete failure/);
  store.beforeDelete = null;
  const retry = await repository.compact(now);

  assert.deepEqual(store.entries.get('daily/2026-07-13').data, {
    date: '2026-07-13',
    visits: 2,
    totalActiveSeconds: 60,
  });
  assert.equal(store.entries.has('sessions/a'), false);
  assert.equal(store.entries.has('sessions/b'), false);
  assert.deepEqual(retry, { compactedDays: 0, deletedSessions: 1 });
  assert.equal(
    store.calls.setJSON.filter(({ key }) => key === 'daily/2026-07-13').length,
    1,
  );
});

test('malformed sessions are excluded from datasets and left untouched by compaction', async () => {
  const store = new FakeStore();
  const malformed = { startedAt: 'not-a-date', activeSeconds: 'many' };
  const outOfRange = session('2026-07-13T09:00:00.000Z', 43_201);
  store.put('sessions/bad', malformed);
  store.put('sessions/good', session('2026-07-13T08:00:00.000Z', 40));
  store.put('sessions/out-of-range', outOfRange);
  const repository = new AnalyticsRepository(store);

  const dataset = await repository.readDataset();
  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(dataset.sessions, [session('2026-07-13T08:00:00.000Z', 40)]);
  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 1 });
  assert.deepEqual(store.entries.get('sessions/bad').data, malformed);
  assert.deepEqual(store.entries.get('sessions/out-of-range').data, outOfRange);
  assert.equal(store.entries.has('sessions/good'), false);
});
