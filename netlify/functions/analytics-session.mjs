import {
  AnalyticsInputError,
  isKnownBot,
  parseSessionPayload,
} from '../lib/analytics-core.mjs';
import { createAnalyticsRepository } from '../lib/analytics-repository.mjs';
import { createVisitRepository, parseVisitPayload } from '../lib/analytics-visits.mjs';

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

function declaredBodyIsOversized(value, maximum) {
  return typeof value === 'string'
    && /^\d+$/.test(value)
    && BigInt(value) > BigInt(maximum);
}

export function createSessionHandler(dependencies = {}) {
  const repositoryFactory = dependencies.repositoryFactory
    ?? createAnalyticsRepository;
  const clock = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  let repository = dependencies.repository;
  let visitRepository = dependencies.visitRepository;

  const resolveRepository = () => {
    if (repository === undefined) {
      repository = repositoryFactory();
    }
    return repository;
  };

  return async function analyticsSession(request, context = {}) {
    const rich = request.headers.get('x-analytics-version') === '2';
    const maximum = rich ? 32_768 : MAX_BODY_BYTES;
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

    if (declaredBodyIsOversized(request.headers.get('content-length'), maximum)) {
      return emptyResponse(413);
    }

    try {
      const body = await request.arrayBuffer();
      if (body.byteLength > maximum) {
        return emptyResponse(413);
      }

      let session;
      try {
        session = (rich ? parseVisitPayload : parseSessionPayload)(
          JSON.parse(new TextDecoder().decode(body)),
        );
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof AnalyticsInputError) {
          return emptyResponse(400);
        }
        throw error;
      }

      if (rich) {
        visitRepository ??= (dependencies.visitRepositoryFactory ?? createVisitRepository)();
        await visitRepository.upsertVisit(session, { ip: context.ip, geo: context.geo, userAgent: request.headers.get('user-agent') ?? '' }, clock());
      } else {
        await resolveRepository().upsertSession(session.sessionId, session.activeSeconds, clock());
      }
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
