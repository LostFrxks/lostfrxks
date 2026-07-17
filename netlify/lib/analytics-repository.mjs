import { getStore } from '@netlify/blobs';

import {
  MAX_ACTIVE_SECONDS,
  bishkekDateKey,
  isEligibleForCompaction,
  mergeSession,
} from './analytics-core.mjs';

const STRONG_JSON = { consistency: 'strong', type: 'json' };
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class AnalyticsStorageError extends Error {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasUsableETag(value) {
  return typeof value === 'string' && value.length > 0;
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
  if (!isObject(value)) {
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

function publicSession(value) {
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

function isValidClaimedSession(value, expectedDate = value?.compactedFor) {
  return isValidSession(value)
    && isValidDateKey(value.compactedFor)
    && value.compactedFor === expectedDate
    && sessionDateKey(value) === value.compactedFor;
}

function isValidDaily(value, expectedDate) {
  const hasValidShape = isObject(value)
    && isValidDateKey(value.date)
    && (expectedDate === undefined || value.date === expectedDate)
    && Number.isSafeInteger(value.visits)
    && value.visits >= 0
    && Number.isSafeInteger(value.totalActiveSeconds)
    && value.totalActiveSeconds >= 0;
  if (!hasValidShape || (value.visits === 0 && value.totalActiveSeconds !== 0)) {
    return false;
  }

  return BigInt(value.totalActiveSeconds)
    <= BigInt(value.visits) * BigInt(MAX_ACTIVE_SECONDS);
}

function isAsyncIterable(value) {
  return value !== null
    && value !== undefined
    && typeof value[Symbol.asyncIterator] === 'function';
}

function nextCursor(page) {
  return page?.nextCursor ?? page?.next_cursor;
}

function addPageKeys(keys, page, prefix) {
  for (const blob of page?.blobs ?? []) {
    if (typeof blob?.key === 'string' && blob.key.startsWith(prefix)) {
      keys.add(blob.key);
    }
  }
}

async function listKeys(store, prefix) {
  const keys = new Set();
  const listing = store.list({ prefix, paginate: true });

  if (isAsyncIterable(listing)) {
    for await (const page of listing) {
      addPageKeys(keys, page, prefix);
    }
    return [...keys];
  }

  let page = await listing;
  if (isAsyncIterable(page)) {
    for await (const item of page) {
      addPageKeys(keys, item, prefix);
    }
    return [...keys];
  }

  const seenCursors = new Set();
  while (page) {
    addPageKeys(keys, page, prefix);
    const cursor = nextCursor(page);
    if (cursor === undefined || cursor === null) {
      break;
    }
    if (seenCursors.has(cursor)) {
      throw new AnalyticsStorageError('Blob listing pagination conflict');
    }
    seenCursors.add(cursor);
    page = await store.list({ prefix, cursor });
  }

  return [...keys];
}

async function readSessionEntry(store, key) {
  try {
    const current = await store.getWithMetadata(key, STRONG_JSON);
    return current === null ? null : { key, ...current };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function claimSession(store, initial, date) {
  let current = initial;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (
      current === null
      || !hasUsableETag(current.etag)
      || !isValidSession(current.data)
      || sessionDateKey(current.data) !== date
    ) {
      return null;
    }

    if (Object.hasOwn(current.data, 'compactedFor')) {
      return isValidClaimedSession(current.data, date) ? current : null;
    }

    const claimed = { ...publicSession(current.data), compactedFor: date };
    await store.set(
      current.key,
      JSON.stringify(claimed),
      { onlyIfMatch: current.etag },
    );
    current = await readSessionEntry(store, current.key);

    if (current && isValidClaimedSession(current.data, date)) {
      return current;
    }
  }

  return null;
}

export class AnalyticsRepository {
  constructor(store) {
    this.store = store;
  }

  async upsertSession(sessionId, activeSeconds, now) {
    const key = `sessions/${sessionId}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.store.getWithMetadata(key, STRONG_JSON);
      if (current && !hasUsableETag(current.etag)) {
        throw new AnalyticsStorageError('Session record missing ETag');
      }
      if (current && isValidClaimedSession(current.data)) {
        throw new AnalyticsStorageError('Session is being compacted');
      }
      const next = mergeSession(current?.data ?? null, activeSeconds, now);
      const condition = current
        ? { onlyIfMatch: current.etag }
        : { onlyIfNew: true };
      const result = await this.store.set(key, JSON.stringify(next), condition);

      if (result.modified) {
        return next;
      }
    }

    throw new AnalyticsStorageError('Session update conflict');
  }

  async readEntries(prefix) {
    const keys = await listKeys(this.store, prefix);
    const entries = await Promise.all(keys.map(async (key) => {
      try {
        const data = await this.store.get(key, STRONG_JSON);
        return data === null ? null : { key, data };
      } catch (error) {
        if (error instanceof SyntaxError) {
          // Malformed JSON is quarantined by omission. Operational read errors
          // abort the snapshot so compaction cannot establish a partial total.
          return null;
        }
        throw error;
      }
    }));

    return entries.filter((entry) => entry !== null);
  }

  async readDataset() {
    const [dailyEntries, sessionEntries] = await Promise.all([
      this.readEntries('daily/'),
      this.readEntries('sessions/'),
    ]);

    return {
      daily: dailyEntries
        .filter(({ key, data }) => key === `daily/${data?.date}` && isValidDaily(data))
        .map(({ data }) => data),
      sessions: sessionEntries
        .filter(({ data }) => isValidSession(data))
        .map(({ data }) => publicSession(data)),
    };
  }

  async readSessionEntries() {
    const keys = await listKeys(this.store, 'sessions/');
    const entries = await Promise.all(
      keys.map((key) => readSessionEntry(this.store, key)),
    );
    return entries.filter((entry) => entry !== null);
  }

  async compact(now) {
    const [dailyEntries, sessionEntries] = await Promise.all([
      this.readEntries('daily/'),
      this.readSessionEntries(),
    ]);
    const authoritativeDates = new Set(
      dailyEntries
        .filter(({ key, data }) => key === `daily/${data?.date}` && isValidDaily(data))
        .map(({ data }) => data.date),
    );
    const sessionsByDate = new Map();

    for (const entry of sessionEntries) {
      if (!isValidSession(entry.data)) {
        continue;
      }
      const date = sessionDateKey(entry.data);
      if (date === null || !isEligibleForCompaction(date, now)) {
        continue;
      }
      const entries = sessionsByDate.get(date) ?? [];
      entries.push(entry);
      sessionsByDate.set(date, entries);
    }

    let compactedDays = 0;
    let deletedSessions = 0;

    for (const [date, entries] of sessionsByDate) {
      const claimed = [];
      for (const entry of entries) {
        const claim = await claimSession(this.store, entry, date);
        if (claim === null) {
          claimed.length = 0;
          break;
        }
        claimed.push(claim);
      }
      if (claimed.length !== entries.length) {
        continue;
      }

      if (!authoritativeDates.has(date)) {
        const aggregate = {
          date,
          visits: claimed.length,
          totalActiveSeconds: claimed.reduce(
            (total, { data }) => total + data.activeSeconds,
            0,
          ),
        };
        const key = `daily/${date}`;
        const result = await this.store.set(
          key,
          JSON.stringify(aggregate),
          { onlyIfNew: true },
        );

        if (result.modified) {
          compactedDays += 1;
          authoritativeDates.add(date);
        } else {
          const winner = await this.store.get(key, STRONG_JSON);
          if (!isValidDaily(winner, date)) {
            throw new AnalyticsStorageError('Daily aggregate conflict');
          }
          authoritativeDates.add(date);
        }
      }

      for (const claim of claimed) {
        const finalized = await this.store.set(
          claim.key,
          JSON.stringify(claim.data),
          { onlyIfMatch: claim.etag },
        );
        if (!finalized.modified) {
          continue;
        }
        await this.store.delete(claim.key);
        deletedSessions += 1;
      }
    }

    return { compactedDays, deletedSessions };
  }
}

export function createAnalyticsRepository() {
  return new AnalyticsRepository(getStore('anonymous-analytics'));
}
