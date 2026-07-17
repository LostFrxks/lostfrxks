import { createHash, timingSafeEqual } from 'node:crypto';

export const ANALYTICS_TIME_ZONE = 'Asia/Bishkek';
export const MAX_ACTIVE_SECONDS = 43_200;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOT_PATTERN = /bot|crawler|spider|slurp|headless/i;
const BISHKEK_UTC_OFFSET = '+06:00';
const DATE_FORMATTER = new Intl.DateTimeFormat('en', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class AnalyticsInputError extends Error {}

export function parseSessionPayload(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnalyticsInputError('Invalid analytics payload');
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2
    || !keys.includes('activeSeconds')
    || !keys.includes('sessionId')
  ) {
    throw new AnalyticsInputError('Unexpected analytics fields');
  }

  if (typeof value.sessionId !== 'string' || !UUID_V4_PATTERN.test(value.sessionId)) {
    throw new AnalyticsInputError('Invalid session ID');
  }

  if (
    !Number.isInteger(value.activeSeconds)
    || value.activeSeconds < 0
    || value.activeSeconds > MAX_ACTIVE_SECONDS
  ) {
    throw new AnalyticsInputError('Invalid active duration');
  }

  return {
    sessionId: value.sessionId,
    activeSeconds: value.activeSeconds,
  };
}

export function isKnownBot(userAgent = '') {
  return BOT_PATTERN.test(userAgent);
}

export function bishkekDateKey(date) {
  const parts = Object.fromEntries(
    DATE_FORMATTER
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
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
  const endOfLocalDay = new Date(`${nextDay}T00:00:00${BISHKEK_UTC_OFFSET}`);
  const fortyEightHours = 48 * 60 * 60 * 1000;
  return endOfLocalDay.getTime() <= now.getTime() - fortyEightHours;
}

export function mergeSession(existing, activeSeconds, now) {
  const timestamp = now.toISOString();
  if (!existing) {
    return {
      startedAt: timestamp,
      lastSeenAt: timestamp,
      activeSeconds,
    };
  }

  const startedAtTime = typeof existing.startedAt === 'string'
    ? Date.parse(existing.startedAt)
    : Number.NaN;
  const lastSeenAtTime = typeof existing.lastSeenAt === 'string'
    ? Date.parse(existing.lastSeenAt)
    : Number.NaN;
  const timestampTime = now.getTime();

  return {
    startedAt: Number.isFinite(startedAtTime) && startedAtTime <= timestampTime
      ? existing.startedAt
      : timestamp,
    lastSeenAt: Number.isFinite(lastSeenAtTime) && lastSeenAtTime >= timestampTime
      ? existing.lastSeenAt
      : timestamp,
    activeSeconds: Math.max(existing.activeSeconds, activeSeconds),
  };
}

function summarize(items) {
  const visits = items.reduce((sum, item) => sum + item.visits, 0);
  const totalActiveSeconds = items.reduce(
    (sum, item) => sum + item.totalActiveSeconds,
    0,
  );

  return {
    visits,
    averageActiveSeconds: visits === 0
      ? 0
      : Math.round(totalActiveSeconds / visits),
  };
}

export function buildStats({ daily, sessions, now }) {
  const authoritativeDates = new Set(daily.map((record) => record.date));
  const records = daily.map((record) => ({ ...record }));

  for (const session of sessions) {
    const date = bishkekDateKey(new Date(session.startedAt));
    if (!authoritativeDates.has(date)) {
      records.push({
        date,
        visits: 1,
        totalActiveSeconds: session.activeSeconds,
      });
    }
  }

  const today = bishkekDateKey(now);
  const sevenDaysAgo = shiftDateKey(today, -6);
  const thirtyDaysAgo = shiftDateKey(today, -29);
  const recordsWithin = (start) => records.filter(
    (record) => record.date >= start && record.date <= today,
  );

  return {
    generatedAt: now.toISOString(),
    timezone: ANALYTICS_TIME_ZONE,
    periods: {
      today: summarize(recordsWithin(today)),
      sevenDays: summarize(recordsWithin(sevenDaysAgo)),
      thirtyDays: summarize(recordsWithin(thirtyDaysAgo)),
      allTime: summarize(records),
    },
  };
}

export function tokensEqual(provided, expected) {
  if (
    typeof provided !== 'string'
    || typeof expected !== 'string'
    || provided.length === 0
    || expected.length === 0
  ) {
    return false;
  }

  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
