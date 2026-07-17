import {
  AnalyticsInputError,
  isKnownBot,
  parseSessionPayload,
} from '../lib/analytics-core.mjs';
import { createAnalyticsRepository } from '../lib/analytics-repository.mjs';

const MAX_BODY_BYTES = 512;
const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

function emptyResponse(status, headers = {}) {
  return new Response(null, {
    status,
    headers: { ...headers, ...NO_STORE_HEADERS },
  });
}

function hasJsonMediaType(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const [mediaType] = value.split(';', 1);
  return mediaType.replace(/^[\t ]+|[\t ]+$/g, '').toLowerCase()
    === 'application/json';
}

function declaredBodyIsOversized(value) {
  return typeof value === 'string'
    && /^\d+$/.test(value)
    && BigInt(value) > BigInt(MAX_BODY_BYTES);
}

export function createSessionHandler(dependencies = {}) {
  const repositoryFactory = dependencies.repositoryFactory
    ?? createAnalyticsRepository;
  const clock = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  let repository = dependencies.repository;

  const resolveRepository = () => {
    if (repository === undefined) {
      repository = repositoryFactory();
    }
    return repository;
  };

  return async function analyticsSession(request) {
    if (request.method !== 'POST') {
      return emptyResponse(405, { allow: 'POST' });
    }

    if (request.headers.get('origin') !== new URL(request.url).origin) {
      return emptyResponse(403);
    }

    if (!hasJsonMediaType(request.headers.get('content-type'))) {
      return emptyResponse(415);
    }

    if (isKnownBot(request.headers.get('user-agent') ?? '')) {
      return emptyResponse(204);
    }

    if (declaredBodyIsOversized(request.headers.get('content-length'))) {
      return emptyResponse(413);
    }

    try {
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY_BYTES) {
        return emptyResponse(413);
      }

      let session;
      try {
        session = parseSessionPayload(
          JSON.parse(new TextDecoder().decode(body)),
        );
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof AnalyticsInputError) {
          return emptyResponse(400);
        }
        throw error;
      }

      await resolveRepository().upsertSession(
        session.sessionId,
        session.activeSeconds,
        clock(),
      );
      return emptyResponse(204);
    } catch {
      logger.error('analytics session unavailable');
      return emptyResponse(503);
    }
  };
}

export const config = {
  path: '/api/analytics/session',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowLimit: 60,
    windowSize: 60,
  },
};

export default createSessionHandler();
