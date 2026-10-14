import { isIP } from 'node:net';
import { getStore } from '@netlify/blobs';
import { AnalyticsInputError, MAX_ACTIVE_SECONDS, mergeSession, parseSessionPayload } from './analytics-core.mjs';
import { AnalyticsRepository, AnalyticsStorageError } from './analytics-repository.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISIT_PREFIX = 'analytics/visits/';
const OWNER_PREFIX = 'analytics/owners/';
const STRONG_JSON = { consistency: 'strong', type: 'json' };
const SECTION_IDS = new Set(['hero', 'whoami', 'experience', 'projects', 'talks', 'stack', 'achievements', 'timeline', 'contact']);
const FIELDS = ['sessionId', 'browserId', 'activeSeconds', 'pagePath', 'referrer', 'utm', 'deviceHints', 'scrollPercent', 'sections', 'clicks'];

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function reject() { throw new AnalyticsInputError('Invalid visit data'); }
function text(value, max = 160) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}
export function validateBrowserId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) reject();
  return value.toLowerCase();
}
function integer(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) reject();
  return value;
}
function httpOrigin(value) {
  if (!value) return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.origin : ''; } catch { return ''; }
}
function safeTarget(value) {
  if (typeof value !== 'string' || !value || value.length > 512) reject();
  if (value.startsWith('#')) return text(value, 120);
  try {
    const url = new URL(value, 'https://portfolio.invalid');
    if (url.username || url.password) reject();
    if (['mailto:', 'tel:'].includes(url.protocol)) return url.protocol + text(url.pathname, 160);
    if (!['http:', 'https:'].includes(url.protocol)) reject();
    return text((url.origin === 'https://portfolio.invalid' ? '' : url.origin) + url.pathname + url.hash, 300);
  } catch { reject(); }
}

export function parseVisitPayload(value) {
  if (!object(value) || Object.keys(value).some(key => !FIELDS.includes(key))) reject();
  const basic = parseSessionPayload({ sessionId: value.sessionId, activeSeconds: value.activeSeconds });
  const browserId = validateBrowserId(value.browserId);
  if (typeof value.pagePath !== 'string' || !value.pagePath.startsWith('/') || value.pagePath.startsWith('//') || /[?#]/.test(value.pagePath)) reject();
  const utm = {};
  if (!object(value.utm)) reject();
  for (const [key, val] of Object.entries(value.utm)) {
    if (!['source', 'medium', 'campaign', 'term', 'content'].includes(key) || typeof val !== 'string') reject();
    utm[key] = text(val, 120);
  }
  const hints = value.deviceHints;
  if (!object(hints) || Object.keys(hints).some(key => !['model', 'platform', 'mobile'].includes(key))) reject();
  if (hints.mobile !== undefined && typeof hints.mobile !== 'boolean') reject();
  if (!Array.isArray(value.sections) || value.sections.length > SECTION_IDS.size || !Array.isArray(value.clicks) || value.clicks.length > 64) reject();
  const seenSections = new Set();
  const sections = value.sections.map(item => {
    if (!object(item) || Object.keys(item).some(key => !['id', 'seconds'].includes(key)) || !SECTION_IDS.has(item.id) || seenSections.has(item.id)) reject();
    seenSections.add(item.id);
    return { id: item.id, seconds: integer(item.seconds, basic.activeSeconds) };
  });
  const seenTargets = new Set();
  const clicks = value.clicks.map(item => {
    if (!object(item) || Object.keys(item).some(key => !['target', 'label', 'count'].includes(key))) reject();
    const target = safeTarget(item.target);
    if (seenTargets.has(target) || typeof item.label !== 'string') reject();
    seenTargets.add(target);
    return { target, label: text(item.label, 100), count: integer(item.count, 100_000) };
  });
  return { ...basic, sessionId: basic.sessionId.toLowerCase(), browserId, pagePath: text(value.pagePath, 160), referrer: httpOrigin(value.referrer), utm, deviceHints: { model: text(hints.model, 100), platform: text(hints.platform, 60), mobile: hints.mobile }, scrollPercent: integer(value.scrollPercent, 100), sections, clicks };
}

function deviceInfo(userAgent, hints) {
  const ua = text(userAgent, 512);
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : text(hints.platform, 60) || 'Unknown';
  const type = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua) && !hints.mobile) ? 'Tablet' : /iPhone|iPod|Mobile/i.test(ua) || hints.mobile ? 'Phone' : ua ? 'Computer' : 'Unknown';
  const patterns = [['Edge', /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/], ['Opera', /(?:OPR|Opera)\/([\d.]+)/], ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/], ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/], ['Safari', /Version\/([\d.]+).*Safari/]];
  const match = patterns.map(([name, pattern]) => [name, pattern.exec(ua)]).find(([, result]) => result);
  return { type, os, browser: match ? match[0] : 'Unknown', version: match ? match[1][1] : null, model: hints.model || null };
}
function locationInfo(geo) {
  return { country: text(geo?.country?.name, 100) || null, countryCode: text(geo?.country?.code, 2) || null, region: text(geo?.subdivision?.name, 100) || null, city: text(geo?.city, 100) || null };
}
function validTime(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) reject();
  return now.toISOString();
}
function mergeActivity(previous = [], next = [], key, amount) {
  const merged = new Map(previous.map(item => [item[key], item]));
  for (const item of next) {
    const old = merged.get(item[key]);
    merged.set(item[key], { ...item, [amount]: Math.max(old?.[amount] ?? 0, item[amount]) });
  }
  return [...merged.values()];
}
function validRecord(value) {
  if (!object(value) || value.version !== 1 || !object(value.device) || !object(value.location) || typeof value.startedAt !== 'string' || typeof value.lastSeenAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.lastSeenAt))) return false;
  try {
    parseVisitPayload({ sessionId: value.id, browserId: value.browserId, activeSeconds: value.activeSeconds, pagePath: value.pagePath, referrer: value.referrer, utm: value.utm, deviceHints: { model: value.device.model ?? '', platform: value.device.os ?? '' }, scrollPercent: value.scrollPercent, sections: value.sections, clicks: value.clicks });
    return Date.parse(value.startedAt) <= Date.parse(value.lastSeenAt);
  } catch { return false; }
}
async function concurrentMap(items, callback) {
  const result = [];
  for (let index = 0; index < items.length; index += 12) result.push(...await Promise.all(items.slice(index, index + 12).map(callback)));
  return result;
}

export class VisitRepository {
  constructor(store) { this.store = store; }

  async upsertVisit(payload, context, now) {
    const input = parseVisitPayload(payload);
    validTime(now);
    const key = VISIT_PREFIX + input.sessionId;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.store.getWithMetadata(key, STRONG_JSON);
      const old = current?.data;
      if (current && (!validRecord(old) || !current.etag || old.id !== input.sessionId || old.browserId !== input.browserId)) throw new AnalyticsStorageError('Visit identity or storage invalid');
      const timing = mergeSession(old ?? null, input.activeSeconds, now);
      const record = { version: 1, id: input.sessionId, browserId: input.browserId, ...timing, pagePath: old?.pagePath ?? input.pagePath, referrer: old?.referrer ?? input.referrer, utm: old?.utm ?? input.utm, device: old?.device ?? deviceInfo(context?.userAgent, input.deviceHints), ip: old ? old.ip : typeof context?.ip === 'string' && isIP(context.ip) ? context.ip : null, location: old?.location ?? locationInfo(context?.geo), scrollPercent: Math.max(old?.scrollPercent ?? 0, input.scrollPercent), sections: mergeActivity(old?.sections, input.sections, 'id', 'seconds'), clicks: mergeActivity(old?.clicks, input.clicks, 'target', 'count') };
      if (!record.device.model && input.deviceHints.model) record.device = { ...record.device, model: input.deviceHints.model };
      // The union also remains bounded across repeated, different payloads.
      record.clicks = record.clicks.slice(0, 64);
      const result = await this.store.set(key, JSON.stringify(record), current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
      if (result?.modified && typeof result.etag === 'string' && result.etag) return record;
    }
    throw new AnalyticsStorageError('Visit update conflict');
  }

  async markOwner(browserId, now) {
    const id = validateBrowserId(browserId);
    const markedAt = validTime(now);
    const key = OWNER_PREFIX + id;
    const existing = await this.store.get(key, STRONG_JSON);
    if (existing?.browserId === id && typeof existing.markedAt === 'string') return;
    if (existing) throw new AnalyticsStorageError('Owner record invalid');
    const result = await this.store.set(key, JSON.stringify({ browserId: id, markedAt }), { onlyIfNew: true });
    if (result?.modified && result.etag) return;
    const concurrent = await this.store.get(key, STRONG_JSON);
    if (concurrent?.browserId === id && typeof concurrent.markedAt === 'string') return;
    throw new AnalyticsStorageError('Owner registration failed');
  }

  async readVisits() {
    const keys = [];
    for await (const page of this.store.list({ prefix: VISIT_PREFIX, paginate: true })) keys.push(...page.blobs.map(blob => blob.key));
    const records = (await concurrentMap(keys, key => this.store.get(key, STRONG_JSON))).filter(validRecord);
    const browserIds = [...new Set(records.map(record => record.browserId))];
    const markers = await concurrentMap(browserIds, async id => [id, await this.store.get(OWNER_PREFIX + id, STRONG_JSON)]);
    const owners = new Set(markers.filter(([id, marker]) => marker?.browserId === id && typeof marker.markedAt === 'string').map(([id]) => id));
    return records.map(({ browserId, version, ...record }) => ({ ...record, isOwner: owners.has(browserId), legacy: false }));
  }
}

export class CombinedAnalyticsRepository {
  constructor(legacy, visits) { this.legacy = legacy; this.visits = visits; }
  async readDataset() {
    const [legacy, visits] = await Promise.all([this.legacy.readDataset(), this.visits.readVisits()]);
    return { ...legacy, visits };
  }
}
export function createVisitRepository() { return new VisitRepository(getStore({ name: 'anonymous-analytics', consistency: 'strong' })); }
export function createCombinedAnalyticsRepository() {
  const store = getStore({ name: 'anonymous-analytics', consistency: 'strong' });
  return new CombinedAnalyticsRepository(new AnalyticsRepository(store), new VisitRepository(store));
}
