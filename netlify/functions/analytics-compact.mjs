import { createAnalyticsRepository } from '../lib/analytics-repository.mjs';

export function createCompactHandler(dependencies = {}) {
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

  return async function analyticsCompact() {
    const result = await resolveRepository().compact(clock());
    const compactedDays = Number.isFinite(result?.compactedDays)
      ? result.compactedDays
      : 0;
    const deletedSessions = Number.isFinite(result?.deletedSessions)
      ? result.deletedSessions
      : 0;
    logger.info(
      'analytics compaction complete',
      compactedDays,
      deletedSessions,
    );
  };
}

export const config = { schedule: '@daily' };

export default createCompactHandler();
