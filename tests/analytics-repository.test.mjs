import assert from 'node:assert/strict';
import test from 'node:test';
import { getStore as getNetlifyStore } from '@netlify/blobs';

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
    this.afterSet = null;
    this.beforeDelete = null;
    this.beforeGetWithMetadata = null;
    this.beforeSet = null;
    this.forceConflicts = new Set();
    this.getErrors = new Map();
    this.calls = {
      delete: [],
      get: [],
      getWithMetadata: [],
      list: [],
      set: [],
    };
  }

  put(key, data) {
    const etag = `etag-${++this.revision}`;
    this.entries.set(key, { data: clone(data), etag });
    return etag;
  }

  async getWithMetadata(key, options) {
    this.calls.getWithMetadata.push({ key, options: clone(options) });
    if (this.beforeGetWithMetadata) {
      await this.beforeGetWithMetadata({ key, store: this });
    }
    if (this.getErrors.has(key)) {
      throw this.getErrors.get(key);
    }
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

  async set(key, value, options = {}) {
    const data = JSON.parse(value);
    this.calls.set.push({ key, data: clone(data), options: clone(options), value });
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
    if (this.afterSet) {
      await this.afterSet({ data: clone(data), etag, key, options: clone(options), store: this });
    }
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createNetlifyTransportStore() {
  const requests = [];
  let current = null;
  let revision = 0;
  const fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers);
    const method = init.method?.toLowerCase();
    requests.push({ headers, method, url: String(input) });

    if (method === 'get') {
      return current
        ? new Response(JSON.stringify(current.data), {
            status: 200,
            headers: { etag: current.etag },
          })
        : new Response(null, { status: 404 });
    }

    if (method === 'put') {
      if (headers.get('if-none-match') === '*' && current) {
        return new Response(null, { status: 412 });
      }
      if (headers.has('if-match') && headers.get('if-match') !== current?.etag) {
        return new Response(null, { status: 412 });
      }
      const etag = `transport-etag-${++revision}`;
      current = { data: JSON.parse(init.body), etag };
      return new Response(null, { status: 200, headers: { etag } });
    }

    throw new Error(`Unexpected transport method: ${method}`);
  };
  const store = getNetlifyStore({
    name: 'conditional-write-probe',
    siteID: 'test-site',
    token: 'test-token',
    edgeURL: 'https://eventual.example',
    uncachedEdgeURL: 'https://strong.example',
    fetch,
  });
  return { requests, store };
}

test('exports a factory without requiring a live Netlify context at import time', () => {
  assert.equal(typeof createAnalyticsRepository, 'function');
});

test('repository writes emit conditional headers through the installed Netlify SDK', async () => {
  const { requests, store } = createNetlifyTransportStore();
  const repository = new AnalyticsRepository(store);
  const sessionId = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';

  await repository.upsertSession(sessionId, 10, new Date('2026-07-13T08:00:00.000Z'));
  await repository.upsertSession(sessionId, 20, new Date('2026-07-13T08:01:00.000Z'));

  const writes = requests.filter(({ method }) => method === 'put');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].headers.get('if-none-match'), '*');
  assert.equal(writes[0].headers.get('if-match'), null);
  assert.equal(writes[1].headers.get('if-none-match'), null);
  assert.equal(writes[1].headers.get('if-match'), 'transport-etag-1');
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
  assert.deepEqual(store.calls.set.map(({ options }) => options), [
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
  assert.equal(store.calls.set.length, 3);
});

test('upsertSession fails closed when an existing record has no usable ETag', async () => {
  const sessionId = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
  const key = `sessions/${sessionId}`;

  for (const etag of [undefined, '', 42]) {
    const store = new FakeStore();
    store.entries.set(key, {
      data: session('2026-07-13T08:00:00.000Z', 10),
      etag,
    });
    const repository = new AnalyticsRepository(store);

    await assert.rejects(
      repository.upsertSession(sessionId, 20, new Date('2026-07-13T08:01:00.000Z')),
      (error) => error instanceof AnalyticsStorageError
        && error.message === 'Session record missing ETag',
    );
    assert.equal(store.calls.set.length, 0);
  }
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
    store.calls.set.find(({ key }) => key === 'daily/2026-07-13').options,
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
  assert.equal(store.calls.set.length, 0);
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
  assert.equal(store.calls.set.some(({ key }) => key === 'daily/2026-07-13'), false);
  assert.deepEqual(
    store.calls.set.find(({ key }) => key === 'sessions/duplicate').options,
    { onlyIfMatch: 'etag-2' },
  );
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
    store.calls.set.filter(({ key }) => key === 'daily/2026-07-13').length,
    1,
  );
});

test('heartbeat winning the claim race is reread and included in the aggregate', async () => {
  const store = new FakeStore();
  const sessionId = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
  const key = `sessions/${sessionId}`;
  store.put(key, session('2026-07-13T08:00:00.000Z', 40));
  const repository = new AnalyticsRepository(store);
  let heartbeatRan = false;
  store.beforeSet = async ({ data, key: writeKey }) => {
    if (!heartbeatRan && writeKey === key && data.compactedFor === '2026-07-13') {
      heartbeatRan = true;
      await repository.upsertSession(
        sessionId,
        90,
        new Date('2026-07-13T08:05:00.000Z'),
      );
    }
  };

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.equal(heartbeatRan, true);
  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 1 });
  assert.deepEqual(store.entries.get('daily/2026-07-13').data, {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 90,
  });
});

test('claim winning the heartbeat race prevents mutation and surfaces an explicit error', async () => {
  const store = new FakeStore();
  const sessionId = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
  const key = `sessions/${sessionId}`;
  store.put(key, session('2026-07-13T08:00:00.000Z', 40));
  const repository = new AnalyticsRepository(store);
  let heartbeatError;
  store.afterSet = async ({ data, key: writeKey }) => {
    if (heartbeatError === undefined && writeKey === key && data.compactedFor === '2026-07-13') {
      try {
        await repository.upsertSession(
          sessionId,
          90,
          new Date('2026-07-13T08:05:00.000Z'),
        );
      } catch (error) {
        heartbeatError = error;
      }
    }
  };

  await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.ok(heartbeatError instanceof AnalyticsStorageError);
  assert.equal(heartbeatError.message, 'Session is being compacted');
  assert.deepEqual(store.entries.get('daily/2026-07-13').data, {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 40,
  });
});

test('concurrent compactors converge on one claimed session snapshot', async () => {
  const store = new FakeStore();
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  const repositoryA = new AnalyticsRepository(store);
  const repositoryB = new AnalyticsRepository(store);
  const claimsArrived = deferred();
  let claimAttempts = 0;
  store.beforeSet = async ({ data, key }) => {
    if (key === 'sessions/a' && data.compactedFor === '2026-07-13') {
      claimAttempts += 1;
      if (claimAttempts === 2) {
        claimsArrived.resolve();
      }
      await claimsArrived.promise;
    }
  };
  const now = new Date('2026-07-17T00:00:00.000Z');

  const results = await Promise.all([
    repositoryA.compact(now),
    repositoryB.compact(now),
  ]);

  assert.deepEqual(store.entries.get('daily/2026-07-13').data, {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 40,
  });
  assert.equal(store.entries.has('sessions/a'), false);
  assert.equal(results.reduce((sum, result) => sum + result.compactedDays, 0), 1);
  assert.ok(
    store.calls.set
      .filter(({ key }) => key === 'sessions/a')
      .every(({ data }) => data.compactedFor === '2026-07-13'),
  );
  assert.ok(claimAttempts >= 2);
});

test('a crash after claiming leaves a readable snapshot that a retry compacts', async () => {
  const store = new FakeStore();
  const raw = session('2026-07-13T08:00:00.000Z', 40);
  store.put('sessions/a', raw);
  const repository = new AnalyticsRepository(store);
  const crash = new Error('daily write crashed');
  let shouldCrash = true;
  store.beforeSet = ({ key }) => {
    if (shouldCrash && key === 'daily/2026-07-13') {
      shouldCrash = false;
      throw crash;
    }
  };
  const now = new Date('2026-07-17T00:00:00.000Z');

  await assert.rejects(repository.compact(now), (error) => error === crash);
  assert.deepEqual(store.entries.get('sessions/a').data, {
    ...raw,
    compactedFor: '2026-07-13',
  });
  assert.deepEqual(await repository.readDataset(), { daily: [], sessions: [raw] });

  const retry = await repository.compact(now);
  assert.deepEqual(retry, { compactedDays: 1, deletedSessions: 1 });
  assert.equal(store.entries.has('sessions/a'), false);
  assert.deepEqual(store.entries.get('daily/2026-07-13').data, {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 40,
  });
});

test('compaction does not delete a claimed record whose provenance changed', async () => {
  const store = new FakeStore();
  store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
  const repository = new AnalyticsRepository(store);
  const changed = session('2026-07-13T08:00:00.000Z', 90, '2026-07-13T08:05:00.000Z');
  let changedBeforeDelete = false;
  store.beforeSet = ({ data, key, store: fake }) => {
    if (
      !changedBeforeDelete
      && key === 'sessions/a'
      && fake.entries.has('daily/2026-07-13')
      && data.compactedFor === '2026-07-13'
    ) {
      changedBeforeDelete = true;
      fake.put(key, changed);
    }
  };

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.equal(changedBeforeDelete, true);
  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 0 });
  assert.deepEqual(store.entries.get('sessions/a').data, changed);
  assert.deepEqual(store.entries.get('daily/2026-07-13').data, {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 40,
  });
});

test('noncanonical or unsupported timestamps are omitted without aborting compaction', async () => {
  const store = new FakeStore();
  const unsupported = session('+275760-09-12T00:00:00.000Z', 20);
  const noncanonical = session('2026-07-13T08:00:00Z', 30);
  store.put('sessions/extreme', unsupported);
  store.put('sessions/noncanonical', noncanonical);
  const repository = new AnalyticsRepository(store);

  const dataset = await repository.readDataset();
  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(dataset.sessions, []);
  assert.deepEqual(result, { compactedDays: 0, deletedSessions: 0 });
  assert.deepEqual(store.entries.get('sessions/extreme').data, unsupported);
  assert.deepEqual(store.entries.get('sessions/noncanonical').data, noncanonical);
});

test('impossible daily totals are not authoritative and never authorize raw deletion', async () => {
  const corruptRecords = [
    { date: '2026-07-13', visits: 0, totalActiveSeconds: 1 },
    { date: '2026-07-13', visits: 1, totalActiveSeconds: 43_201 },
  ];

  for (const corrupt of corruptRecords) {
    const store = new FakeStore();
    store.put('daily/2026-07-13', corrupt);
    store.put('sessions/a', session('2026-07-13T08:00:00.000Z', 40));
    const repository = new AnalyticsRepository(store);

    await assert.rejects(
      repository.compact(new Date('2026-07-17T00:00:00.000Z')),
      (error) => error instanceof AnalyticsStorageError
        && error.message === 'Daily aggregate conflict',
    );
    assert.equal(store.entries.has('sessions/a'), true);
    assert.deepEqual(store.calls.delete, []);
  }
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
