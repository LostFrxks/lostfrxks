import { AnalyticsInputError, tokensEqual } from '../lib/analytics-core.mjs';
import { createVisitRepository, validateBrowserId } from '../lib/analytics-visits.mjs';

function response(status) { return new Response(null, { status, headers: { 'cache-control': 'no-store' } }); }

export function createOwnerHandler(dependencies = {}) {
  let repository = dependencies.repository;
  const clock = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  return async function analyticsOwner(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
    const environment = Object.hasOwn(dependencies, 'env') ? dependencies.env : process.env;
    const password = Object.hasOwn(dependencies, 'adminToken') ? dependencies.adminToken : environment?.ANALYTICS_ADMIN_PASSWORD;
    if (typeof password !== 'string' || !password) return response(503);
    const token = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!tokensEqual(token, password)) return response(401);
    if (request.headers.get('origin') !== new URL(request.url).origin) return response(403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response(415);
    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && BigInt(declaredLength) > 256n) return response(413);
    let browserId;
    try {
      const body = await request.arrayBuffer();
      if (body.byteLength > 256) return response(413);
      const value = JSON.parse(new TextDecoder().decode(body));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'browserId')) return response(400);
      browserId = validateBrowserId(value.browserId);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof AnalyticsInputError) return response(400);
      return response(400);
    }
    try {
      repository ??= (dependencies.repositoryFactory ?? createVisitRepository)();
      await repository.markOwner(browserId, clock());
      return response(204);
    } catch {
      logger.error('analytics owner registration unavailable');
      return response(503);
    }
  };
}

export const config = { path: '/api/analytics/owner', rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowLimit: 20, windowSize: 60 } };
export default createOwnerHandler();
