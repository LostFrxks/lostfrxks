import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStats } from '../netlify/lib/analytics-core.mjs';
import { AnalyticsRepository } from '../netlify/lib/analytics-repository.mjs';

const A = '2fa03426-bb1f-4b9c-a7ce-0e760552ad57';
const B = '73d9e264-7ca6-4714-9868-1f4029b8214f';
const C = 'fd570f92-da7a-4c91-a725-927aac196729';
const NOW = new Date('2026-10-14T14:00:00.000Z');
const context = { ip: '192.0.2.7', geo: { country: { name: 'Kyrgyzstan', code: 'KG' }, subdivision: { name: 'Chuy' }, city: 'Bishkek' }, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile Safari/537.36' };

export class MemoryBlobs {
  entries = new Map();
  revision = 0;
  failWrites = false;
  async get(key) { return structuredClone(this.entries.get(key)?.data ?? null); }
  async getWithMetadata(key) { const entry = this.entries.get(key); return entry ? structuredClone(entry) : null; }
  async set(key, text, options = {}) {
    await Promise.resolve();
    const existing = this.entries.get(key);
    if (this.failWrites || (options.onlyIfNew && existing) || (options.onlyIfMatch && existing?.etag !== options.onlyIfMatch)) return { modified: false };
    const etag = 'revision-' + (++this.revision);
    this.entries.set(key, { data: JSON.parse(text), etag });
    return { modified: true, etag };
  }
  async *list({ prefix }) {
    const blobs = [...this.entries.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key }));
    // Multiple pages exercise the real repository's complete listing.
    yield { blobs: blobs.slice(0, 1) };
    yield { blobs: blobs.slice(1) };
  }
}

export function visitPayload(overrides = {}) {
  return { sessionId: A, browserId: B, activeSeconds: 20, pagePath: '/', referrer: 'https://google.com', utm: { source: 'portfolio' }, deviceHints: { model: '', platform: 'Android', mobile: true }, scrollPercent: 30, sections: [{ id: 'projects', seconds: 10 }], clicks: [{ target: '/assets/artur-usenov-resume.pdf', label: 'Resume', count: 1 }], ...overrides };
}

test('owner browser stays in history but is excluded even when a guest shares its IP', async () => {
  const { VisitRepository } = await import('../netlify/lib/analytics-visits.mjs');
  const repository = new VisitRepository(new MemoryBlobs());
  await repository.upsertVisit(visitPayload(), context, NOW);
  await repository.upsertVisit(visitPayload({ sessionId: C, browserId: A, activeSeconds: 60 }), context, NOW);
  await repository.markOwner(B, NOW);
  const visits = await repository.readVisits();
  assert.equal(visits.length, 2);
  assert.equal(visits.find(v => v.id === A).isOwner, true);
  assert.equal(visits.find(v => v.id === C).isOwner, false);
  assert.equal(visits.find(v => v.id === A).ip, '192.0.2.7');
  assert.deepEqual(visits.find(v => v.id === A).location, { country: 'Kyrgyzstan', countryCode: 'KG', region: 'Chuy', city: 'Bishkek' });
  assert.equal(visits.find(v => v.id === A).device.type, 'Phone');
  const stats = buildStats({ daily: [], sessions: [], visitTimes: [], visits, now: NOW });
  assert.deepEqual(stats.periods.today, { visits: 1, averageActiveSeconds: 60 });
  assert.equal(stats.visits.length, 2);
  assert.ok(stats.visits.every(v => !Object.hasOwn(v, 'browserId')));
});

test('reordered and simultaneous heartbeats preserve cumulative activity and first metadata', async () => {
  const { VisitRepository } = await import('../netlify/lib/analytics-visits.mjs');
  const repository = new VisitRepository(new MemoryBlobs());
  await repository.upsertVisit(visitPayload(), context, NOW);
  await Promise.all([
    repository.upsertVisit(visitPayload({ activeSeconds: 50, scrollPercent: 95, sections: [{ id: 'projects', seconds: 35 }], clicks: [{ target: '/assets/artur-usenov-resume.pdf', label: 'Resume', count: 3 }] }), context, new Date('2026-10-14T14:01:00.000Z')),
    repository.upsertVisit(visitPayload({ activeSeconds: 5, scrollPercent: 5, sections: [], clicks: [] }), { ip: '198.51.100.4' }, new Date('2026-10-14T14:00:30.000Z')),
  ]);
  const [visit] = await repository.readVisits();
  assert.equal(visit.activeSeconds, 50);
  assert.equal(visit.scrollPercent, 95);
  assert.deepEqual(visit.sections, [{ id: 'projects', seconds: 35 }]);
  assert.equal(visit.clicks[0].count, 3);
  assert.equal(visit.ip, '192.0.2.7');
  assert.equal(visit.startedAt, '2026-10-14T14:00:00.000Z');
  assert.equal(visit.lastSeenAt, '2026-10-14T14:01:00.000Z');
});

test('parallel independent visits survive and failed conditional writes report failure', async () => {
  const { VisitRepository } = await import('../netlify/lib/analytics-visits.mjs');
  const store = new MemoryBlobs();
  const repository = new VisitRepository(store);
  await Promise.all([repository.upsertVisit(visitPayload(), context, NOW), repository.upsertVisit(visitPayload({ sessionId: C }), context, NOW)]);
  assert.equal((await repository.readVisits()).length, 2);
  store.failWrites = true;
  await assert.rejects(repository.upsertVisit(visitPayload({ activeSeconds: 90 }), context, NOW));
  assert.equal((await repository.readVisits())[0].activeSeconds, 20);
});

test('a visit cannot change browser identity and public payloads cannot forge owner/IP fields', async () => {
  const { VisitRepository } = await import('../netlify/lib/analytics-visits.mjs');
  const repository = new VisitRepository(new MemoryBlobs());
  await repository.upsertVisit(visitPayload(), context, NOW);
  await assert.rejects(repository.upsertVisit(visitPayload({ browserId: C }), context, NOW));
  for (const forged of [{ isOwner: true }, { ip: '192.0.2.1' }, { location: { city: 'Fake' } }, { screenWidth: 100 }]) {
    await assert.rejects(repository.upsertVisit(visitPayload(forged), context, NOW));
  }
  assert.equal((await repository.readVisits())[0].isOwner, false);
});

test('legacy counts and date-only history survive alongside permanent detailed records', async () => {
  const { VisitRepository, CombinedAnalyticsRepository } = await import('../netlify/lib/analytics-visits.mjs');
  const store = new MemoryBlobs();
  const legacy = { version: 2, daily: { '2026-10-01': { date: '2026-10-01', visits: 2, totalActiveSeconds: 100 } }, sessions: {}, visitTimes: ['2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z'] };
  await store.set('analytics/state-v1', JSON.stringify(legacy));
  const details = new VisitRepository(store);
  await details.upsertVisit(visitPayload(), context, NOW);
  await new AnalyticsRepository(store).compact(new Date('2027-10-14T14:00:00.000Z'));
  assert.deepEqual(await store.get('analytics/state-v1'), legacy);
  assert.equal((await details.readVisits()).length, 1);
  const combined = new CombinedAnalyticsRepository(new AnalyticsRepository(store), details);
  const stats = buildStats({ ...await combined.readDataset(), now: NOW });
  assert.deepEqual(stats.periods.allTime, { visits: 3, averageActiveSeconds: 40 });
  assert.equal(stats.visits.length, 3);
  assert.equal(stats.visits.filter(v => v.legacy).length, 2);
});

test('invalid IDs, activity and geographic strings do not compromise stored records', async () => {
  const { VisitRepository } = await import('../netlify/lib/analytics-visits.mjs');
  const repository = new VisitRepository(new MemoryBlobs());
  for (const invalid of [{ browserId: 'not-a-uuid' }, { activeSeconds: -1 }, { scrollPercent: 101 }, { sections: [{ id: '__proto__', seconds: 3 }] }, { clicks: [{ target: 'javascript:alert(1)', label: 'bad', count: 1 }] }]) {
    await assert.rejects(repository.upsertVisit(visitPayload(invalid), context, NOW));
  }
  await repository.upsertVisit(visitPayload(), { ip: 'spoofed-IP', geo: null }, NOW);
  const [visit] = await repository.readVisits();
  assert.equal(visit.ip, null);
  assert.equal(visit.location.city, null);
});
