import {
  buildStats,
  tokensEqual,
} from '../lib/analytics-core.mjs';
import { createAnalyticsRepository } from '../lib/analytics-repository.mjs';

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

function bearerToken(value) {
  if (typeof value !== 'string') {
    return null;
  }
  return /^Bearer ([^\s]+)$/.exec(value)?.[1] ?? null;
}

export function createStatsHandler(dependencies = {}) {
  const repositoryFactory = dependencies.repositoryFactory
    ?? createAnalyticsRepository;
  const clock = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  const statsBuilder = dependencies.buildStats ?? buildStats;
  const hasInjectedToken = Object.hasOwn(dependencies, 'adminToken');
  const hasInjectedEnvironment = Object.hasOwn(dependencies, 'env');
  let repository = dependencies.repository;

  const resolveRepository = () => {
    if (repository === undefined) {
      repository = repositoryFactory();
    }
    return repository;
  };
  const resolveAdminToken = () => {
    if (hasInjectedToken) {
      return dependencies.adminToken;
    }
    const environment = hasInjectedEnvironment ? dependencies.env : process.env;
    return environment?.ANALYTICS_ADMIN_TOKEN;
  };

  return async function analyticsStats(request) {
    if (request.method !== 'GET') {
      return emptyResponse(405, {
        allow: 'GET',
        'content-type': 'application/json; charset=utf-8',
      });
    }

    const adminToken = resolveAdminToken();
    if (typeof adminToken !== 'string' || adminToken.length === 0) {
      return jsonResponse(503, { error: 'Analytics stats unavailable' });
    }

    const providedToken = bearerToken(request.headers.get('authorization'));
    if (providedToken === null || !tokensEqual(providedToken, adminToken)) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    try {
      const dataset = await resolveRepository().readDataset();
      const stats = statsBuilder({ ...dataset, now: clock() });
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
