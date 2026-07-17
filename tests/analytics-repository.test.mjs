import assert from 'node:assert/strict';
import test from 'node:test';
import { getStore as getNetlifyStore } from '@netlify/blobs';

import {
  AnalyticsInputError,
  buildStats,
} from '../netlify/lib/analytics-core.mjs';
import {
  AnalyticsRepository,
  AnalyticsStorageError,
  createAnalyticsRepository,
} from '../netlify/lib/analytics-repository.mjs';

const STATE_KEY = 'analytics/state-v1';
const SESSION_A = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
const SESSION_B = '73d9e264-7ca6-4714-9868-1f4029b8214f';
const STRONG_JSON = { consistency: 'strong', type: 'json' };

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function emptyState() {
  return { version: 2, daily: {}, sessions: {}, visitTimes: [] };
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

class FakeStore {
  constructor() {
    this.entries = new Map();
    this.revision = 0;
    this.beforeSet = null;
    this.afterSet = null;
    this.forceConflicts = false;
    this.writeResult = null;
    this.calls = {
      get: [],
      getWithMetadata: [],
      set: [],
    };
  }

  put(key, data, etag) {
    const nextETag = arguments.length < 3 ? `etag-${++this.revision}` : etag;
    this.entries.set(key, { data: clone(data), etag: nextETag });
    return nextETag;
  }

  state() {
    return clone(this.entries.get(STATE_KEY)?.data ?? null);
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
    return clone(this.entries.get(key)?.data ?? null);
  }

  async set(key, value, options = {}) {
    const data = JSON.parse(value);
    this.calls.set.push({ key, data: clone(data), options: clone(options), value });
    if (this.beforeSet) {
      await this.beforeSet({ data: clone(data), key, options: clone(options), store: this });
    }
    if (this.forceConflicts) {
      return { modified: false };
    }
    if (this.writeResult) {
      return clone(this.writeResult);
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

  async list() {
    throw new Error('Atomic repository must not list blobs');
  }

  async delete() {
    throw new Error('Atomic repository must not delete blobs');
  }

  async setJSON() {
    throw new Error('Atomic repository must not use setJSON');
  }
}

function createNetlifyTransportStore({ writeStatus = 200 } = {}) {
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
      if (writeStatus !== 200) {
        return new Response(null, { status: writeStatus });
      }
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
    name: 'atomic-state-probe',
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

  await repository.upsertSession(SESSION_A, 10, new Date('2026-07-13T08:00:00.000Z'));
  await repository.upsertSession(SESSION_A, 20, new Date('2026-07-13T08:01:00.000Z'));

  const writes = requests.filter(({ method }) => method === 'put');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].headers.get('if-none-match'), '*');
  assert.equal(writes[0].headers.get('if-match'), null);
  assert.equal(writes[1].headers.get('if-none-match'), null);
  assert.equal(writes[1].headers.get('if-match'), 'transport-etag-1');
});

test('upsertSession rejects Netlify SDK false-success results for HTTP 400 and 500', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(
    callback,
    Math.min(delay, 1),
    ...args,
  );

  try {
    for (const writeStatus of [400, 500]) {
      const { store } = createNetlifyTransportStore({ writeStatus });
      const repository = new AnalyticsRepository(store);

      await assert.rejects(
        repository.upsertSession(
          SESSION_A,
          10,
          new Date('2026-07-13T08:00:00.000Z'),
        ),
        (error) => error instanceof AnalyticsStorageError
          && error.message === 'Analytics state write failed',
      );
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('upsertSession rejects invalid direct inputs before reading or writing state', async () => {
  const invalidInputs = [
    ['not-a-uuid', 10, new Date('2026-07-13T08:00:00.000Z')],
    [SESSION_A, -1, new Date('2026-07-13T08:00:00.000Z')],
    [SESSION_A, 1.5, new Date('2026-07-13T08:00:00.000Z')],
    [SESSION_A, 43_201, new Date('2026-07-13T08:00:00.000Z')],
    [SESSION_A, 10, new Date(Number.NaN)],
    [SESSION_A, 10, '2026-07-13T08:00:00.000Z'],
  ];

  for (const [sessionId, activeSeconds, now] of invalidInputs) {
    const store = new FakeStore();
    const repository = new AnalyticsRepository(store);

    await assert.rejects(
      repository.upsertSession(sessionId, activeSeconds, now),
      (error) => error instanceof AnalyticsInputError,
    );
    assert.equal(store.calls.getWithMetadata.length, 0);
    assert.equal(store.calls.set.length, 0);
    assert.equal(store.state(), null);
  }
});

test('upsertSession rejects an extreme finite Date before reading or writing state', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.upsertSession(SESSION_A, 10, new Date(8_640_000_000_000_000)),
    (error) => error instanceof AnalyticsInputError,
  );
  assert.equal(store.calls.getWithMetadata.length, 0);
  assert.equal(store.calls.set.length, 0);
  assert.equal(store.state(), null);
});

test('upsertSession creates atomic state and a forward update preserves the maximum', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);

  const created = await repository.upsertSession(
    SESSION_A,
    40,
    new Date('2026-07-13T08:00:00.000Z'),
  );
  const updated = await repository.upsertSession(
    SESSION_A,
    20,
    new Date('2026-07-13T08:05:00.000Z'),
  );

  assert.deepEqual(created, session('2026-07-13T08:00:00.000Z', 40));
  assert.deepEqual(updated, session(
    '2026-07-13T08:00:00.000Z',
    40,
    '2026-07-13T08:05:00.000Z',
  ));
  assert.deepEqual(store.state(), {
    version: 2,
    daily: {},
    sessions: { [SESSION_A]: updated },
    visitTimes: ['2026-07-13T08:00:00.000Z'],
  });
  assert.deepEqual(store.calls.set.map(({ key, options }) => ({ key, options })), [
    { key: STATE_KEY, options: { onlyIfNew: true } },
    { key: STATE_KEY, options: { onlyIfMatch: 'etag-1' } },
  ]);
});

test('upsertSession records one timestamp per new visit and none for heartbeats', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);

  await repository.upsertSession(
    SESSION_A,
    0,
    new Date('2026-07-17T01:00:00.000Z'),
  );
  await repository.upsertSession(
    SESSION_A,
    20,
    new Date('2026-07-17T01:01:00.000Z'),
  );
  await repository.upsertSession(
    SESSION_B,
    0,
    new Date('2026-07-17T02:00:00.000Z'),
  );

  assert.deepEqual(store.state().visitTimes, [
    '2026-07-17T01:00:00.000Z',
    '2026-07-17T02:00:00.000Z',
  ]);
});

test('readDataset migrates legacy live-session starts into visit history', async () => {
  const store = new FakeStore();
  const legacy = { version: 1, daily: {}, sessions: {} };
  legacy.sessions[SESSION_A] = session('2026-07-17T02:00:00.000Z', 10);
  legacy.sessions[SESSION_B] = session('2026-07-17T01:00:00.000Z', 20);
  store.put(STATE_KEY, legacy);
  const repository = new AnalyticsRepository(store);

  const dataset = await repository.readDataset();

  assert.deepEqual(dataset.visitTimes, [
    '2026-07-17T01:00:00.000Z',
    '2026-07-17T02:00:00.000Z',
  ]);
});

test('upsertSession CAS retry does not duplicate a visit timestamp', async () => {
  const store = new FakeStore();
  let competed = false;
  store.beforeSet = ({ store: fake }) => {
    if (!competed) {
      competed = true;
      fake.put(STATE_KEY, emptyState());
    }
  };
  const repository = new AnalyticsRepository(store);

  await repository.upsertSession(
    SESSION_A,
    0,
    new Date('2026-07-17T01:00:00.000Z'),
  );

  assert.deepEqual(store.state().visitTimes, ['2026-07-17T01:00:00.000Z']);
  assert.equal(store.calls.set.length, 2);
});

test('compact preserves the complete timestamp history', async () => {
  const store = new FakeStore();
  store.put(STATE_KEY, {
    version: 2,
    daily: {},
    sessions: {
      [SESSION_A]: session('2026-07-13T08:00:00.000Z', 40),
    },
    visitTimes: [
      '2026-07-12T08:00:00.000Z',
      '2026-07-13T08:00:00.000Z',
    ],
  });
  const repository = new AnalyticsRepository(store);

  await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(store.state().visitTimes, [
    '2026-07-12T08:00:00.000Z',
    '2026-07-13T08:00:00.000Z',
  ]);
});

test('upsertSession rereads and remerges a real competing whole-state update', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 10);
  store.put(STATE_KEY, state);
  let competed = false;
  store.beforeSet = ({ store: fake }) => {
    if (!competed) {
      competed = true;
      const competing = fake.state();
      competing.sessions[SESSION_A] = session(
        '2026-07-13T07:55:00.000Z',
        90,
        '2026-07-13T08:06:00.000Z',
      );
      fake.put(STATE_KEY, competing);
    }
  };
  const repository = new AnalyticsRepository(store);

  const result = await repository.upsertSession(
    SESSION_A,
    30,
    new Date('2026-07-13T08:05:00.000Z'),
  );

  assert.deepEqual(result, session(
    '2026-07-13T07:55:00.000Z',
    90,
    '2026-07-13T08:06:00.000Z',
  ));
  assert.equal(store.calls.getWithMetadata.length, 2);
  assert.deepEqual(store.state().sessions[SESSION_A], result);
});

test('upsertSession stops after three whole-state conflicts', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 10);
  store.put(STATE_KEY, state);
  store.beforeSet = ({ store: fake }) => fake.put(STATE_KEY, fake.state());
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.upsertSession(SESSION_A, 30, new Date('2026-07-13T08:05:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Session update conflict',
  );
  assert.equal(store.calls.getWithMetadata.length, 3);
  assert.equal(store.calls.set.length, 3);
});

test('mutations fail closed when existing atomic state has no usable ETag', async () => {
  for (const etag of [undefined, '', 42]) {
    const store = new FakeStore();
    store.put(STATE_KEY, emptyState(), etag);
    const repository = new AnalyticsRepository(store);

    await assert.rejects(
      repository.upsertSession(SESSION_A, 10, new Date('2026-07-13T08:00:00.000Z')),
      (error) => error instanceof AnalyticsStorageError
        && error.message === 'Analytics state missing ETag',
    );
    assert.equal(store.calls.set.length, 0);
  }
});

test('readDataset returns an empty absent state and canonical buildStats-compatible arrays', async () => {
  const store = new FakeStore();
  const repository = new AnalyticsRepository(store);

  assert.deepEqual(await repository.readDataset(), {
    daily: [],
    sessions: [],
    visitTimes: [],
  });

  const state = emptyState();
  state.daily['2026-07-13'] = {
    date: '2026-07-13',
    visits: 2,
    totalActiveSeconds: 60,
  };
  state.sessions[SESSION_A] = session('2026-07-16T08:00:00.000Z', 15);
  store.put(STATE_KEY, state);
  const dataset = await repository.readDataset();

  assert.deepEqual(dataset, {
    daily: [state.daily['2026-07-13']],
    sessions: [state.sessions[SESSION_A]],
    visitTimes: [],
  });
  assert.equal(store.calls.get.at(-1).key, STATE_KEY);
  assert.deepEqual(store.calls.get.at(-1).options, STRONG_JSON);
  assert.equal(buildStats({ ...dataset, now: new Date('2026-07-17T00:00:00.000Z') })
    .periods.allTime.visits, 3);
});

test('readDataset quarantines corrupt children but rejects a malformed state root', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.daily['2026-07-13'] = {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 40,
  };
  state.daily['2026-07-12'] = {
    date: '2026-07-12',
    visits: 0,
    totalActiveSeconds: 1,
  };
  state.sessions[SESSION_A] = session('2026-07-16T08:00:00.000Z', 15);
  state.sessions[SESSION_B] = session('+275760-09-12T00:00:00.000Z', 20);
  store.put(STATE_KEY, state);
  const repository = new AnalyticsRepository(store);

  assert.deepEqual(await repository.readDataset(), {
    daily: [state.daily['2026-07-13']],
    sessions: [state.sessions[SESSION_A]],
    visitTimes: [],
  });

  store.put(STATE_KEY, { version: 2, daily: {}, sessions: {} });
  await assert.rejects(
    repository.readDataset(),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Invalid analytics state',
  );
});

test('compact atomically moves the exact Jul13 fixture into one daily aggregate', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  state.sessions[SESSION_B] = session('2026-07-13T09:00:00.000Z', 20);
  store.put(STATE_KEY, state);
  const repository = new AnalyticsRepository(store);

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 2 });
  assert.deepEqual(store.state(), {
    version: 2,
    daily: {
      '2026-07-13': { date: '2026-07-13', visits: 2, totalActiveSeconds: 60 },
    },
    sessions: {},
    visitTimes: [],
  });
  assert.equal(store.calls.set.length, 1);
});

test('compact rejects a false-success write without mutating persisted state', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  store.put(STATE_KEY, state);
  store.writeResult = { modified: true, etag: '   ' };
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.compact(new Date('2026-07-17T00:00:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Analytics state write failed',
  );
  assert.equal(store.calls.set.length, 1);
  assert.deepEqual(store.state(), state);
});

test('compact rejects invalid now before reading or writing state', async () => {
  for (const now of [new Date(Number.NaN), '2026-07-17T00:00:00.000Z']) {
    const store = new FakeStore();
    const state = emptyState();
    state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
    store.put(STATE_KEY, state);
    const repository = new AnalyticsRepository(store);

    await assert.rejects(
      repository.compact(now),
      (error) => error instanceof AnalyticsInputError,
    );
    assert.equal(store.calls.getWithMetadata.length, 0);
    assert.equal(store.calls.set.length, 0);
    assert.deepEqual(store.state(), state);
  }
});

test('compact rejects an extreme finite Date before reading or writing state', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  store.put(STATE_KEY, state);
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.compact(new Date(8_640_000_000_000_000)),
    (error) => error instanceof AnalyticsInputError,
  );
  assert.equal(store.calls.getWithMetadata.length, 0);
  assert.equal(store.calls.set.length, 0);
  assert.deepEqual(store.state(), state);
});

test('compact retains recent starts and old sessions with recent lastSeenAt without writing', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-15T08:00:00.000Z', 25);
  state.sessions[SESSION_B] = session(
    '2026-07-13T08:00:00.000Z',
    40,
    '2026-07-16T12:00:00.000Z',
  );
  store.put(STATE_KEY, state);
  const repository = new AnalyticsRepository(store);

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(result, { compactedDays: 0, deletedSessions: 0 });
  assert.deepEqual(store.state(), state);
  assert.equal(store.calls.set.length, 0);
});

test('compact safely increments an existing daily aggregate in the same CAS write', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.daily['2026-07-13'] = {
    date: '2026-07-13',
    visits: 3,
    totalActiveSeconds: 100,
  };
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  state.sessions[SESSION_B] = session('2026-07-13T09:00:00.000Z', 20);
  store.put(STATE_KEY, state);
  const repository = new AnalyticsRepository(store);

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 2 });
  assert.deepEqual(store.state().daily['2026-07-13'], {
    date: '2026-07-13',
    visits: 5,
    totalActiveSeconds: 160,
  });
  assert.deepEqual(store.state().sessions, {});
});

test('heartbeat winning before compaction CAS is retained and not aggregated', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  store.put(STATE_KEY, state);
  const repository = new AnalyticsRepository(store);
  let heartbeatRan = false;
  store.beforeSet = async ({ data }) => {
    if (!heartbeatRan && data.daily['2026-07-13']) {
      heartbeatRan = true;
      await repository.upsertSession(
        SESSION_A,
        90,
        new Date('2026-07-17T00:00:00.000Z'),
      );
    }
  };

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.equal(heartbeatRan, true);
  assert.deepEqual(result, { compactedDays: 0, deletedSessions: 0 });
  assert.deepEqual(store.state().daily, {});
  assert.deepEqual(store.state().sessions[SESSION_A], session(
    '2026-07-13T08:00:00.000Z',
    90,
    '2026-07-17T00:00:00.000Z',
  ));
});

test('compactor winning first makes a later heartbeat a new current visit', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  store.put(STATE_KEY, state);
  const repository = new AnalyticsRepository(store);
  let heartbeatRan = false;
  store.afterSet = async ({ data }) => {
    if (!heartbeatRan && data.daily['2026-07-13'] && !data.sessions[SESSION_A]) {
      heartbeatRan = true;
      await repository.upsertSession(
        SESSION_A,
        90,
        new Date('2026-07-17T00:00:00.000Z'),
      );
    }
  };

  const result = await repository.compact(new Date('2026-07-17T00:00:00.000Z'));

  assert.equal(heartbeatRan, true);
  assert.deepEqual(result, { compactedDays: 1, deletedSessions: 1 });
  assert.deepEqual(store.state().daily['2026-07-13'], {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 40,
  });
  assert.deepEqual(store.state().sessions[SESSION_A], session(
    '2026-07-17T00:00:00.000Z',
    90,
  ));
});

test('two compactors move each source session exactly once', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  store.put(STATE_KEY, state);
  const repositoryA = new AnalyticsRepository(store);
  const repositoryB = new AnalyticsRepository(store);
  const bothReady = deferred();
  let attempts = 0;
  store.beforeSet = async ({ data }) => {
    if (data.daily['2026-07-13']) {
      attempts += 1;
      if (attempts === 2) {
        bothReady.resolve();
      }
      await bothReady.promise;
    }
  };
  const now = new Date('2026-07-17T00:00:00.000Z');

  const results = await Promise.all([
    repositoryA.compact(now),
    repositoryB.compact(now),
  ]);

  assert.equal(results.reduce((sum, item) => sum + item.compactedDays, 0), 1);
  assert.equal(results.reduce((sum, item) => sum + item.deletedSessions, 0), 1);
  assert.deepEqual(store.state().daily['2026-07-13'], {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 40,
  });
  assert.deepEqual(store.state().sessions, {});
});

test('compact stops after three CAS conflicts with the original state intact', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  store.put(STATE_KEY, state);
  store.forceConflicts = true;
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.compact(new Date('2026-07-17T00:00:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Compaction conflict',
  );
  assert.equal(store.calls.getWithMetadata.length, 3);
  assert.equal(store.calls.set.length, 3);
  assert.deepEqual(store.state(), state);
});

test('a thrown atomic write leaves the original state untouched', async () => {
  const store = new FakeStore();
  const state = emptyState();
  state.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 40);
  store.put(STATE_KEY, state);
  const writeFailure = new Error('write unavailable');
  store.beforeSet = () => {
    throw writeFailure;
  };
  const repository = new AnalyticsRepository(store);

  await assert.rejects(
    repository.compact(new Date('2026-07-17T00:00:00.000Z')),
    (error) => error === writeFailure,
  );
  assert.deepEqual(store.state(), state);
});

test('corrupt children and aggregate overflow fail closed for every mutation', async () => {
  const corruptStore = new FakeStore();
  const corruptState = emptyState();
  corruptState.daily['2026-07-13'] = {
    date: '2026-07-13',
    visits: 1,
    totalActiveSeconds: 43_201,
  };
  corruptState.sessions[SESSION_A] = session('+275760-09-12T00:00:00.000Z', 20);
  corruptState.visitTimes.push('not-a-timestamp');
  corruptStore.put(STATE_KEY, corruptState);
  const corruptRepository = new AnalyticsRepository(corruptStore);

  assert.deepEqual(await corruptRepository.readDataset(), {
    daily: [],
    sessions: [],
    visitTimes: [],
  });
  await assert.rejects(
    corruptRepository.compact(new Date('2026-07-17T00:00:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Invalid analytics state',
  );
  await assert.rejects(
    corruptRepository.upsertSession(SESSION_B, 10, new Date('2026-07-17T00:00:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Invalid analytics state',
  );
  assert.equal(corruptStore.calls.set.length, 0);
  assert.deepEqual(corruptStore.state(), corruptState);

  const overflowStore = new FakeStore();
  const overflowState = emptyState();
  overflowState.daily['2026-07-13'] = {
    date: '2026-07-13',
    visits: Number.MAX_SAFE_INTEGER,
    totalActiveSeconds: 0,
  };
  overflowState.sessions[SESSION_A] = session('2026-07-13T08:00:00.000Z', 1);
  overflowStore.put(STATE_KEY, overflowState);
  const overflowRepository = new AnalyticsRepository(overflowStore);

  await assert.rejects(
    overflowRepository.compact(new Date('2026-07-17T00:00:00.000Z')),
    (error) => error instanceof AnalyticsStorageError
      && error.message === 'Analytics aggregate overflow',
  );
  assert.equal(overflowStore.calls.set.length, 0);
  assert.deepEqual(overflowStore.state(), overflowState);
});
