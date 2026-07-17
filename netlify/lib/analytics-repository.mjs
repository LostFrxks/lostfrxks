import { getStore } from '@netlify/blobs';

import {
  MAX_ACTIVE_SECONDS,
  bishkekDateKey,
  isEligibleForCompaction,
  mergeSession,
} from './analytics-core.mjs';

const STRONG_JSON = { consistency: 'strong', type: 'json' };
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsStorageError extends Error {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidSession(value) {
  return isObject(value)
    && typeof value.startedAt === 'string'
    && Number.isFinite(Date.parse(value.startedAt))
    && typeof value.lastSeenAt === 'string'
    && Number.isFinite(Date.parse(value.lastSeenAt))
    && Number.isSafeInteger(value.activeSeconds)
    && value.activeSeconds >= 0
    && value.activeSeconds <= MAX_ACTIVE_SECONDS;
}

function isValidDaily(value, expectedDate) {
  return isObject(value)
    && isValidDateKey(value.date)
    && (expectedDate === undefined || value.date === expectedDate)
    && Number.isSafeInteger(value.visits)
    && value.visits >= 0
    && Number.isSafeInteger(value.totalActiveSeconds)
    && value.totalActiveSeconds >= 0;
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

export class AnalyticsRepository {
  constructor(store) {
    this.store = store;
  }

  async upsertSession(sessionId, activeSeconds, now) {
    const key = `sessions/${sessionId}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.store.getWithMetadata(key, STRONG_JSON);
      const next = mergeSession(current?.data ?? null, activeSeconds, now);
      const condition = current
        ? { onlyIfMatch: current.etag }
        : { onlyIfNew: true };
      const result = await this.store.setJSON(key, next, condition);

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
        .map(({ data }) => data),
    };
  }

  async compact(now) {
    const [dailyEntries, sessionEntries] = await Promise.all([
      this.readEntries('daily/'),
      this.readEntries('sessions/'),
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
      const date = bishkekDateKey(new Date(entry.data.startedAt));
      if (!isEligibleForCompaction(date, now)) {
        continue;
      }
      const entries = sessionsByDate.get(date) ?? [];
      entries.push(entry);
      sessionsByDate.set(date, entries);
    }

    let compactedDays = 0;
    let deletedSessions = 0;

    for (const [date, entries] of sessionsByDate) {
      if (!authoritativeDates.has(date)) {
        const aggregate = {
          date,
          visits: entries.length,
          totalActiveSeconds: entries.reduce(
            (total, { data }) => total + data.activeSeconds,
            0,
          ),
        };
        const key = `daily/${date}`;
        const result = await this.store.setJSON(key, aggregate, { onlyIfNew: true });

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

      for (const { key } of entries) {
        await this.store.delete(key);
        deletedSessions += 1;
      }
    }

    return { compactedDays, deletedSessions };
  }
}

export function createAnalyticsRepository() {
  return new AnalyticsRepository(getStore('anonymous-analytics'));
}
