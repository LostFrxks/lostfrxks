import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createActiveTimer,
  getOrCreateSessionId,
  startAnalytics,
} from '../analytics.mjs';

const SESSION_KEY = 'lostfrxks.analytics.session';
const SESSION_ID = '7b32f2c1-2c12-4d44-93f6-cf05ab5a5ccd';
const NEW_SESSION_ID = 'fd570f92-da7a-4c91-a725-927aac196729';
const ENDPOINT = '/api/analytics/session';

function createStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set(SESSION_KEY, initialValue);
  }
  const calls = { getItem: [], setItem: [] };
  return {
    calls,
    getItem(key) {
      calls.getItem.push(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      calls.setItem.push([key, value]);
      values.set(key, value);
    },
  };
}

function createBrowserHarness({
  fetchImpl,
  sessionId = SESSION_ID,
  visible = true,
} = {}) {
  let currentTime = 0;
  let intervalSequence = 0;
  const activeIntervals = new Map();
  const allIntervals = new Map();
  const listeners = new Map();
  const fetchCalls = [];
  const calls = {
    addEventListener: [],
    clearInterval: [],
    removeEventListener: [],
    setInterval: [],
  };
  const storage = createStorage();

  const browserDocument = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener(type, listener) {
      calls.addEventListener.push([type, listener]);
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      calls.removeEventListener.push([type, listener]);
      listeners.get(type)?.delete(listener);
    },
  };

  const browserWindow = {
    crypto: { randomUUID: () => sessionId },
    fetch: fetchImpl ?? ((...args) => {
      fetchCalls.push(args);
      return Promise.resolve({ ok: true });
    }),
    performance: { now: () => currentTime },
    sessionStorage: storage,
    setInterval(callback, delay) {
      const id = ++intervalSequence;
      calls.setInterval.push([callback, delay, id]);
      activeIntervals.set(id, callback);
      allIntervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      calls.clearInterval.push(id);
      activeIntervals.delete(id);
    },
    addEventListener(type, listener) {
      calls.addEventListener.push([type, listener]);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      calls.removeEventListener.push([type, listener]);
      listeners.get(type)?.delete(listener);
    },
  };

  function emit(type) {
    for (const listener of [...(listeners.get(type) ?? [])]) {
      listener({ type });
    }
  }

  return {
    browserDocument,
    browserWindow,
    calls,
    fetchCalls,
    storage,
    advance(milliseconds) {
      currentTime += milliseconds;
    },
    emit,
    emitVisibility(nextVisible) {
      browserDocument.visibilityState = nextVisible ? 'visible' : 'hidden';
      emit('visibilitychange');
    },
    invokeFirstIntervalEvenIfCleared() {
      allIntervals.values().next().value?.();
    },
    tickIntervals() {
      for (const callback of [...activeIntervals.values()]) {
        callback();
      }
    },
  };
}

function payloadAt(harness, index) {
  return JSON.parse(harness.fetchCalls[index][1].body);
}

test('createActiveTimer accumulates visible time and floors cumulative seconds', () => {
  let currentTime = 1_000;
  const timer = createActiveTimer({
    isVisible: () => true,
    now: () => currentTime,
  });

  currentTime = 2_999;
  assert.equal(timer.sample(), 1);
  currentTime = 3_001;
  assert.equal(timer.sample(), 2);
});

test('createActiveTimer closes a visible interval, ignores hidden time, and resumes', () => {
  let currentTime = 0;
  let visible = true;
  const timer = createActiveTimer({
    isVisible: () => visible,
    now: () => currentTime,
  });

  currentTime = 2_500;
  visible = false;
  assert.equal(timer.sample(), 2);
  currentTime = 52_500;
  assert.equal(timer.sample(), 2);
  visible = true;
  assert.equal(timer.sample(), 2);
  currentTime = 54_750;
  assert.equal(timer.sample(), 4);
});

test('createActiveTimer clamps negative clock deltas to zero', () => {
  let currentTime = 1_000;
  const timer = createActiveTimer({
    isVisible: () => true,
    now: () => currentTime,
  });

  currentTime = 500;
  assert.equal(timer.sample(), 0);
});

test('createActiveTimer does not count time when it starts hidden', () => {
  let currentTime = 0;
  let visible = false;
  const timer = createActiveTimer({
    isVisible: () => visible,
    now: () => currentTime,
  });

  currentTime = 20_000;
  assert.equal(timer.sample(), 0);
  visible = true;
  assert.equal(timer.sample(), 0);
  currentTime = 21_000;
  assert.equal(timer.sample(), 1);
});

test('createActiveTimer caps active time at exactly 43,200 seconds', () => {
  let currentTime = 0;
  const timer = createActiveTimer({
    isVisible: () => true,
    now: () => currentTime,
  });

  currentTime = 43_200_000;
  assert.equal(timer.sample(), 43_200);
  currentTime = 50_000_000;
  assert.equal(timer.sample(), 43_200);
});

test('getOrCreateSessionId reuses canonical UUID v4 values case-insensitively', () => {
  for (const storedId of [SESSION_ID, SESSION_ID.toUpperCase()]) {
    const storage = createStorage(storedId);
    let generated = 0;

    assert.equal(getOrCreateSessionId(storage, {
      randomUUID() {
        generated += 1;
        return NEW_SESSION_ID;
      },
    }), storedId);
    assert.equal(generated, 0);
    assert.deepEqual(storage.calls.setItem, []);
  }
});

test('getOrCreateSessionId replaces and persists invalid or tampered values', () => {
  for (const storedId of [
    undefined,
    'not-a-uuid',
    '7b32f2c1-2c12-3d44-93f6-cf05ab5a5ccd',
    '7b32f2c1-2c12-4d44-73f6-cf05ab5a5ccd',
  ]) {
    const storage = createStorage(storedId);

    assert.equal(
      getOrCreateSessionId(storage, { randomUUID: () => NEW_SESSION_ID }),
      NEW_SESSION_ID,
    );
    assert.deepEqual(storage.calls.setItem, [[SESSION_KEY, NEW_SESSION_ID]]);
  }
});

test('getOrCreateSessionId tolerates storage read and write failures', () => {
  const readFailure = {
    getItem() {
      throw new Error('read failed');
    },
    setItem() {},
  };
  const writeFailure = {
    getItem: () => null,
    setItem() {
      throw new Error('write failed');
    },
  };

  assert.equal(
    getOrCreateSessionId(readFailure, { randomUUID: () => NEW_SESSION_ID }),
    NEW_SESSION_ID,
  );
  assert.equal(
    getOrCreateSessionId(writeFailure, { randomUUID: () => NEW_SESSION_ID }),
    NEW_SESSION_ID,
  );
});

test('getOrCreateSessionId returns null without throwing when UUID generation is unavailable', () => {
  assert.doesNotThrow(() => getOrCreateSessionId(undefined, undefined));
  assert.equal(getOrCreateSessionId(undefined, undefined), null);
  assert.equal(getOrCreateSessionId(createStorage(), {
    randomUUID() {
      throw new Error('generation failed');
    },
  }), null);
});

test('startAnalytics sends an immediate zero-second request with only approved fields', () => {
  const harness = createBrowserHarness();
  const cleanup = startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
  });

  assert.equal(typeof cleanup, 'function');
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0][0], ENDPOINT);
  assert.deepEqual(harness.fetchCalls[0][1], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID, activeSeconds: 0 }),
    cache: 'no-store',
    credentials: 'omit',
    keepalive: true,
    referrerPolicy: 'no-referrer',
  });
  assert.deepEqual(Object.keys(payloadAt(harness, 0)).sort(), [
    'activeSeconds',
    'sessionId',
  ]);
  assert.equal(harness.calls.setInterval.length, 1);
  assert.equal(harness.calls.setInterval[0][1], 20_000);
});

test('startAnalytics sends to an injected endpoint', () => {
  const harness = createBrowserHarness();
  startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
    endpoint: '/custom/analytics-endpoint',
  });

  assert.equal(harness.fetchCalls[0][0], '/custom/analytics-endpoint');
});

test('startAnalytics samples and sends each visible interval', () => {
  const harness = createBrowserHarness();
  startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
  });

  harness.advance(20_000);
  harness.tickIntervals();

  assert.equal(harness.fetchCalls.length, 2);
  assert.deepEqual(payloadAt(harness, 1), {
    sessionId: SESSION_ID,
    activeSeconds: 20,
  });
});

test('startAnalytics does not send unchanged periodic heartbeats while hidden', () => {
  const harness = createBrowserHarness();
  startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
  });

  harness.advance(4_000);
  harness.emitVisibility(false);
  assert.equal(harness.fetchCalls.length, 2);
  assert.equal(payloadAt(harness, 1).activeSeconds, 4);

  harness.advance(60_000);
  harness.tickIntervals();
  harness.tickIntervals();
  assert.equal(harness.fetchCalls.length, 2);
});

test('startAnalytics sends once on hide and resume without counting hidden time', () => {
  const harness = createBrowserHarness();
  startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
  });

  harness.advance(5_000);
  harness.emitVisibility(false);
  harness.emitVisibility(false);
  harness.advance(100_000);
  harness.emitVisibility(true);
  harness.emitVisibility(true);
  harness.advance(20_000);
  harness.tickIntervals();

  assert.deepEqual(
    harness.fetchCalls.map((_, index) => payloadAt(harness, index).activeSeconds),
    [0, 5, 5, 25],
  );
});

test('startAnalytics flushes pagehide once without double-counting', () => {
  const harness = createBrowserHarness();
  startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
  });

  harness.advance(9_500);
  harness.emit('pagehide');
  harness.emit('pagehide');

  assert.equal(harness.fetchCalls.length, 2);
  assert.equal(payloadAt(harness, 1).activeSeconds, 9);
});

test('startAnalytics sends the cap once and stops all later tracker traffic', () => {
  const harness = createBrowserHarness();
  startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
  });

  harness.advance(43_200_000);
  harness.tickIntervals();

  assert.deepEqual(
    harness.fetchCalls.map((_, index) => payloadAt(harness, index).activeSeconds),
    [0, 43_200],
  );
  assert.deepEqual(harness.calls.clearInterval, [1]);
  assert.deepEqual(
    harness.calls.removeEventListener.map(([type]) => type).sort(),
    ['pagehide', 'visibilitychange'],
  );

  harness.invokeFirstIntervalEvenIfCleared();
  harness.emitVisibility(false);
  harness.emit('pagehide');
  assert.equal(harness.fetchCalls.length, 2);
});

test('startAnalytics cleanup is idempotent and prevents callbacks from sending', () => {
  const harness = createBrowserHarness();
  const cleanup = startAnalytics({
    browserDocument: harness.browserDocument,
    browserWindow: harness.browserWindow,
  });

  cleanup();
  cleanup();

  assert.deepEqual(harness.calls.clearInterval, [1]);
  assert.deepEqual(
    harness.calls.removeEventListener.map(([type]) => type).sort(),
    ['pagehide', 'visibilitychange'],
  );
  harness.advance(20_000);
  harness.invokeFirstIntervalEvenIfCleared();
  harness.emitVisibility(false);
  harness.emit('pagehide');
  assert.equal(harness.fetchCalls.length, 1);
});

test('startAnalytics swallows synchronous and asynchronous fetch failures', async () => {
  const syncHarness = createBrowserHarness({
    fetchImpl() {
      throw new Error('sync fetch failure');
    },
  });
  assert.doesNotThrow(() => startAnalytics({
    browserDocument: syncHarness.browserDocument,
    browserWindow: syncHarness.browserWindow,
  }));
  syncHarness.advance(20_000);
  assert.doesNotThrow(() => syncHarness.tickIntervals());

  const asyncHarness = createBrowserHarness({
    fetchImpl: () => Promise.reject(new Error('async fetch failure')),
  });
  assert.doesNotThrow(() => startAnalytics({
    browserDocument: asyncHarness.browserDocument,
    browserWindow: asyncHarness.browserWindow,
  }));
  await new Promise((resolve) => setImmediate(resolve));
});

test('startAnalytics tolerates missing or throwing browser capabilities', () => {
  assert.doesNotThrow(() => {
    const cleanup = startAnalytics({ browserDocument: {}, browserWindow: {} });
    cleanup();
  });

  const hostileDocument = {
    get visibilityState() {
      throw new Error('visibility unavailable');
    },
    addEventListener() {
      throw new Error('events unavailable');
    },
    removeEventListener() {
      throw new Error('events unavailable');
    },
  };
  const hostileWindow = {
    get sessionStorage() {
      throw new Error('storage unavailable');
    },
    crypto: { randomUUID: () => SESSION_ID },
    fetch() {
      throw new Error('fetch unavailable');
    },
    performance: {
      now() {
        throw new Error('timer unavailable');
      },
    },
    setInterval() {
      throw new Error('interval unavailable');
    },
    clearInterval() {
      throw new Error('interval unavailable');
    },
  };
  assert.doesNotThrow(() => {
    const cleanup = startAnalytics({
      browserDocument: hostileDocument,
      browserWindow: hostileWindow,
    });
    cleanup();
  });
});

test('analytics module imports safely without browser globals and auto-starts with both', async () => {
  const harness = createBrowserHarness();
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  try {
    globalThis.window = harness.browserWindow;
    globalThis.document = harness.browserDocument;
    await import(`../analytics.mjs?auto-start=${Date.now()}`);
    assert.equal(harness.fetchCalls.length, 1);
  } finally {
    if (hadWindow) {
      globalThis.window = previousWindow;
    } else {
      delete globalThis.window;
    }
    if (hadDocument) {
      globalThis.document = previousDocument;
    } else {
      delete globalThis.document;
    }
  }
});

test('index loads analytics as the final module script without changing classic scripts', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const analyticsScript = '<script type="module" src="analytics.mjs?v=anonymous-analytics-20260717"></script>';

  assert.equal(html.split(analyticsScript).length - 1, 1);
  assert.match(html, new RegExp([
    '<script src="ascii-torus\\.js\\?v=ascii-torus-20260428"></script>',
    '<script src="app\\.js\\?v=ascii-torus-20260428"></script>',
    '<script type="module" src="analytics\\.mjs\\?v=anonymous-analytics-20260717"></script>',
    '</body>',
  ].join('\\s+')));
});
