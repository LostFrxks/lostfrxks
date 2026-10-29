import {createAdminAuth} from '../lib/analytics-auth.mjs';
import {
  buildStats,
} from '../lib/analytics-core.mjs';
import { createCombinedAnalyticsRepository } from '../lib/analytics-visits.mjs';

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };
const JSON_HEADERS = {
  ...NO_STORE_HEADERS,
  'content-type': 'application/json; charset=utf-8',
};

function emptyResponse(status, headers = {}) {
  return new Response(null, {
    status,
    headers: { ...headers, ...NO_STORE_HEADERS },
  });
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: JSON_HEADERS,
  });
}

export function createStatsHandler(dependencies = {}) {
  const repositoryFactory = dependencies.repositoryFactory
    ?? createCombinedAnalyticsRepository;
  const clock = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  const statsBuilder = dependencies.buildStats ?? buildStats;
  const auth = dependencies.auth ?? createAdminAuth();
  let repository = dependencies.repository;

  const resolveRepository = () => {
    if (repository === undefined) {
      repository = repositoryFactory();
    }
    return repository;
  };
  return async function analyticsStats(request) {
    if (request.method !== 'GET') {
      return emptyResponse(405, {
        allow: 'GET',
        'content-type': 'application/json; charset=utf-8',
      });
    }

    try {
      if (!await auth.authenticate(request)) {
        return jsonResponse(401, { error: 'Unauthorized' });
      }
      const offsetValue = new URL(request.url).searchParams.get('offset') ?? '0';
      if (!/^\d{1,9}$/.test(offsetValue)) return jsonResponse(400, { error: 'Invalid history offset' });
      const offset = Number(offsetValue);
      const dataset = await resolveRepository().readDataset();
      const stats = statsBuilder({ ...dataset, now: clock() });
      if (Array.isArray(stats.visits)) {
        const total = stats.visits.length;
        stats.visits = stats.visits.slice(offset, offset + 50);
        stats.visitTimes = stats.visits.map(visit => visit.startedAt);
        stats.history = { offset, nextOffset: offset + 50 < total ? offset + 50 : null, total };
      }
      return jsonResponse(200, stats);
    } catch {
      logger.error('analytics stats unavailable');
      return jsonResponse(503, { error: 'Analytics stats unavailable' });
    }
  };
}

export const config = {
  path: '/api/analytics/stats',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowLimit: 20,
    windowSize: 60,
  },
};

export default createStatsHandler();
