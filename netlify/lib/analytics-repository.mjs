import { getStore } from '@netlify/blobs';

import {
  AnalyticsInputError,
  MAX_ACTIVE_SECONDS,
  bishkekDateKey,
  isEligibleForCompaction,
  mergeSession,
  parseSessionPayload,
} from './analytics-core.mjs';

const STATE_KEY = 'analytics/state-v1';
const STATE_VERSION = 1;
const STRONG_JSON = { consistency: 'strong', type: 'json' };
const QUIESCENT_MILLISECONDS = 48 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AnalyticsStorageError extends Error {}

function emptyState() {
  return { version: STATE_VERSION, daily: {}, sessions: {} };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

function hasUsableETag(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireValidDate(value) {
  if (value instanceof Date) {
    try {
      if (canonicalTimestampTime(value.toISOString()) !== null) {
        return value;
      }
    } catch {
      // Invalid dates throw while serializing.
    }
  }
  throw new AnalyticsInputError('Invalid analytics timestamp');
}

function writeSucceeded(result) {
  if (!result?.modified) {
    return false;
  }
  if (!hasUsableETag(result.etag)) {
    throw new AnalyticsStorageError('Analytics state write failed');
  }
  return true;
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function canonicalTimestampTime(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    return null;
  }

  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    return null;
  }

  try {
    return isValidDateKey(bishkekDateKey(new Date(time))) ? time : null;
  } catch {
    return null;
  }
}

function isValidSession(value) {
  if (!isObject(value) || !hasOnlyKeys(value, ['activeSeconds', 'lastSeenAt', 'startedAt'])) {
    return false;
  }

  const startedAt = canonicalTimestampTime(value.startedAt);
  const lastSeenAt = canonicalTimestampTime(value.lastSeenAt);
  return startedAt !== null
    && lastSeenAt !== null
    && startedAt <= lastSeenAt
    && Number.isSafeInteger(value.activeSeconds)
    && value.activeSeconds >= 0
    && value.activeSeconds <= MAX_ACTIVE_SECONDS;
}

function canonicalSession(value) {
  return {
    startedAt: value.startedAt,
    lastSeenAt: value.lastSeenAt,
    activeSeconds: value.activeSeconds,
  };
}

function sessionDateKey(value) {
  try {
    const date = bishkekDateKey(new Date(value.startedAt));
    return isValidDateKey(date) ? date : null;
  } catch {
    return null;
  }
}

function isValidDaily(value, expectedDate) {
  if (
    !isObject(value)
    || !hasOnlyKeys(value, ['date', 'totalActiveSeconds', 'visits'])
    || !isValidDateKey(value.date)
    || value.date !== expectedDate
    || !Number.isSafeInteger(value.visits)
    || value.visits <= 0
    || !Number.isSafeInteger(value.totalActiveSeconds)
    || value.totalActiveSeconds < 0
  ) {
    return false;
  }

  return BigInt(value.totalActiveSeconds)
    <= BigInt(value.visits) * BigInt(MAX_ACTIVE_SECONDS);
}

function canonicalDaily(value) {
  return {
    date: value.date,
    visits: value.visits,
    totalActiveSeconds: value.totalActiveSeconds,
  };
}

function hasValidRoot(value) {
  return isObject(value)
    && hasOnlyKeys(value, ['daily', 'sessions', 'version'])
    && value.version === STATE_VERSION
    && isObject(value.daily)
    && isObject(value.sessions);
}

function decodeState(value, { strict }) {
  if (!hasValidRoot(value)) {
    throw new AnalyticsStorageError('Invalid analytics state');
  }

  const state = emptyState();
  let hasCorruptChild = false;

  for (const [date, record] of Object.entries(value.daily)) {
    if (!isValidDaily(record, date)) {
      hasCorruptChild = true;
      continue;
    }
    state.daily[date] = canonicalDaily(record);
  }

  for (const [sessionId, record] of Object.entries(value.sessions)) {
    if (!UUID_V4_PATTERN.test(sessionId) || !isValidSession(record)) {
      hasCorruptChild = true;
      continue;
    }
    state.sessions[sessionId] = canonicalSession(record);
  }

  if (strict && hasCorruptChild) {
    throw new AnalyticsStorageError('Invalid analytics state');
  }

  return state;
}

async function readForMutation(store) {
  const current = await store.getWithMetadata(STATE_KEY, STRONG_JSON);
  if (current === null) {
    return { state: emptyState(), etag: null };
  }
  if (!hasUsableETag(current.etag)) {
    throw new AnalyticsStorageError('Analytics state missing ETag');
  }
  return { state: decodeState(current.data, { strict: true }), etag: current.etag };
}

function writeCondition(etag) {
  return etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag };
}

function safeAdd(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new AnalyticsStorageError('Analytics aggregate overflow');
  }
  return result;
}

export class AnalyticsRepository {
  constructor(store) {
    this.store = store;
  }

  async upsertSession(sessionId, activeSeconds, now) {
    const input = parseSessionPayload({ sessionId, activeSeconds });
    const timestamp = requireValidDate(now);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { state, etag } = await readForMutation(this.store);
      const nextSession = mergeSession(
        state.sessions[input.sessionId] ?? null,
        input.activeSeconds,
        timestamp,
      );
      const nextState = {
        version: STATE_VERSION,
        daily: { ...state.daily },
        sessions: { ...state.sessions, [input.sessionId]: nextSession },
      };
      const result = await this.store.set(
        STATE_KEY,
        JSON.stringify(nextState),
        writeCondition(etag),
      );

      if (writeSucceeded(result)) {
        return nextSession;
      }
    }

    throw new AnalyticsStorageError('Session update conflict');
  }

  async readDataset() {
    const value = await this.store.get(STATE_KEY, STRONG_JSON);
    if (value === null) {
      return { daily: [], sessions: [] };
    }

    const state = decodeState(value, { strict: false });
    return {
      daily: Object.values(state.daily),
      sessions: Object.values(state.sessions),
    };
  }

  async compact(now) {
    const timestamp = requireValidDate(now);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { state, etag } = await readForMutation(this.store);
      const sessionsByDate = new Map();

      for (const [sessionId, record] of Object.entries(state.sessions)) {
        const date = sessionDateKey(record);
        const lastSeenAt = Date.parse(record.lastSeenAt);
        if (
          date === null
          || !isEligibleForCompaction(date, timestamp)
          || timestamp.getTime() - lastSeenAt < QUIESCENT_MILLISECONDS
        ) {
          continue;
        }
        const sessions = sessionsByDate.get(date) ?? [];
        sessions.push({ sessionId, record });
        sessionsByDate.set(date, sessions);
      }

      if (sessionsByDate.size === 0) {
        return { compactedDays: 0, deletedSessions: 0 };
      }

      const nextState = {
        version: STATE_VERSION,
        daily: { ...state.daily },
        sessions: { ...state.sessions },
      };
      let deletedSessions = 0;

      for (const [date, sessions] of sessionsByDate) {
        const current = nextState.daily[date] ?? {
          date,
          visits: 0,
          totalActiveSeconds: 0,
        };
        const activeSeconds = sessions.reduce(
          (total, { record }) => safeAdd(total, record.activeSeconds),
          0,
        );
        nextState.daily[date] = {
          date,
          visits: safeAdd(current.visits, sessions.length),
          totalActiveSeconds: safeAdd(current.totalActiveSeconds, activeSeconds),
        };
        for (const { sessionId } of sessions) {
          delete nextState.sessions[sessionId];
          deletedSessions += 1;
        }
      }

      const result = await this.store.set(
        STATE_KEY,
        JSON.stringify(nextState),
        writeCondition(etag),
      );
      if (writeSucceeded(result)) {
        return { compactedDays: sessionsByDate.size, deletedSessions };
      }
    }

    throw new AnalyticsStorageError('Compaction conflict');
  }
}

export function createAnalyticsRepository() {
  return new AnalyticsRepository(getStore('anonymous-analytics'));
}
