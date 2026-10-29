import { getBrowserId } from './analytics-visit.mjs';

const PASSWORD_KEY = 'lostfrxks.analytics.adminPassword';
const PERIOD_KEYS = ['today', 'sevenDays', 'thirtyDays', 'allTime'];
const SECTION_NAMES = { hero: 'Profile', whoami: 'About', experience: 'Experience', projects: 'Selected Work', stack: 'Working Stack', achievements: 'Signals', timeline: 'Timeline', contact: 'Contact' };

export function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  if (safe < 60) return safe + 's';
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return minutes + 'm ' + safe % 60 + 's';
  return Math.floor(minutes / 60) + 'h ' + minutes % 60 + 'm';
}

export function formatVisitTime(timestamp, timeZone) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid analytics response');
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
}

function node(doc, tag, text, className) {
  const element = doc.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function field(doc, grid, label, value) {
  const wrapper = node(doc, 'div', undefined, 'analytics-visit__field');
  wrapper.append(node(doc, 'dt', label), node(doc, 'dd', value || 'Недоступно'));
  grid.append(wrapper);
}
function visitCard(doc, visit, timezone) {
  const item = node(doc, 'li');
  item.dataset.visitId = visit.id;
  const card = node(doc, 'details', undefined, 'analytics-visit' + (visit.isOwner ? ' analytics-visit--owner' : ''));
  const summary = node(doc, 'summary');
  summary.append(node(doc, 'time', formatVisitTime(visit.startedAt, timezone)));
  if (visit.isOwner) summary.append(node(doc, 'span', 'Ты', 'analytics-visit__badge'));
  if (visit.legacy) summary.append(node(doc, 'span', 'Legacy', 'analytics-visit__badge analytics-visit__badge--legacy'));
  else summary.append(node(doc, 'span', formatDuration(visit.activeSeconds) + ' · ' + (visit.device?.type || 'Unknown'), 'analytics-visit__preview'));
  card.append(summary);
  const content = node(doc, 'div', undefined, 'analytics-visit__content');
  if (visit.legacy) {
    content.append(node(doc, 'p', 'Подробности не собирались: сохранилась только дата этого захода.', 'analytics-visit__note'));
  } else {
    if (visit.isOwner) content.append(node(doc, 'p', 'Твой браузер. Этот заход исключён из счётчика и средней длительности.', 'analytics-visit__note'));
    const grid = node(doc, 'dl', undefined, 'analytics-visit__grid');
    field(doc, grid, 'Устройство', [visit.device?.type, visit.device?.model].filter(Boolean).join(' · '));
    field(doc, grid, 'ОС', visit.device?.os);
    field(doc, grid, 'Браузер', [visit.device?.browser, visit.device?.version].filter(Boolean).join(' '));
    field(doc, grid, 'IP', visit.ip);
    field(doc, grid, 'Страна', visit.location?.country);
    field(doc, grid, 'Регион', visit.location?.region);
    field(doc, grid, 'Город', visit.location?.city);
    field(doc, grid, 'Страница входа', visit.pagePath);
    field(doc, grid, 'Источник', visit.referrer || 'Прямой заход / источник скрыт');
    field(doc, grid, 'Метки перехода', Object.entries(visit.utm ?? {}).map(([key, value]) => key + ': ' + value).join(' · ') || 'Нет');
    field(doc, grid, 'Видимое время', formatDuration(visit.activeSeconds));
    field(doc, grid, 'Прокрутка', (visit.scrollPercent ?? 0) + '%');
    content.append(grid);
    const sectionList = node(doc, 'ul', undefined, 'analytics-visit__list');
    for (const section of visit.sections ?? []) sectionList.append(node(doc, 'li', (SECTION_NAMES[section.id] || section.id) + ' · ' + formatDuration(section.seconds)));
    content.append(node(doc, 'h3', 'Разделы в поле зрения'), sectionList.childElementCount ? sectionList : node(doc, 'p', 'Пока нет данных', 'analytics-visit__note'));
    const clickList = node(doc, 'ul', undefined, 'analytics-visit__list');
    for (const click of visit.clicks ?? []) {
      const row = node(doc, 'li');
      row.append(node(doc, 'strong', (click.label || 'Link') + ' · ' + click.count + '×'), node(doc, 'span', click.target, 'analytics-visit__destination'));
      clickList.append(row);
    }
    content.append(node(doc, 'h3', 'Переходы и клики'), clickList.childElementCount ? clickList : node(doc, 'p', 'Пока нет кликов', 'analytics-visit__note'));
  }
  card.append(content); item.append(card);
  return item;
}

export function renderStats(root, stats, { append = false } = {}) {
  for (const key of PERIOD_KEYS) {
    const period = stats?.periods?.[key];
    const card = root.querySelector('[data-period="' + key + '"]');
    if (!card || !period) throw new Error('Invalid analytics response');
    card.querySelector('[data-visits]').textContent = String(period.visits);
    card.querySelector('[data-average]').textContent = formatDuration(period.averageActiveSeconds);
  }
  root.querySelector('[data-timezone]').textContent = stats.timezone;
  root.querySelector('[data-updated]').textContent = new Date(stats.generatedAt).toLocaleString(undefined, { timeZone: stats.timezone });
  const history = root.querySelector('[data-visit-history]');
  if (!history) throw new Error('Invalid analytics response');
  if (!append) history.replaceChildren();
  const doc = root.ownerDocument;
  if (Array.isArray(stats.visits)) {
    const existing = new Set([...history.children].map(child => child.dataset.visitId));
    for (const visit of stats.visits) if (!existing.has(visit.id)) history.append(visitCard(doc, visit, stats.timezone));
  } else if (Array.isArray(stats.visitTimes)) {
    for (const timestamp of stats.visitTimes) history.append(node(doc, 'li', formatVisitTime(timestamp, stats.timezone)));
  } else throw new Error('Invalid analytics response');
  if (!history.children.length) history.append(node(doc, 'li', 'No visits recorded yet.', 'analytics-history__empty'));
  const more = root.querySelector('[data-load-more]');
  if (more) more.hidden = stats.history?.nextOffset === null || stats.history?.nextOffset === undefined;
  const total = root.querySelector('[data-history-total]');
  if (total) total.textContent = stats.history ? 'Всего в истории: ' + stats.history.total + ' · твои заходы помечены «Ты»' : '';
}

export function initializeDashboard({ root = document, browserFetch = fetch, storage, browserWindow = window } = {}) {
  const loginForm = root.querySelector('[data-login-form]');
  const passwordInput = root.querySelector('#access-password');
  const submit = loginForm.querySelector('[type="submit"]');
  const error = root.querySelector('[data-error]');
  const privateContent = root.querySelector('[data-private-content]');
  const dashboard = root.querySelector('[data-dashboard]');
  const refresh = root.querySelector('[data-refresh]');
  const lock = root.querySelector('[data-lock]');
  const more = root.querySelector('[data-load-more]');
  // Remove passwords left by the previous dashboard without reading or reusing them.
  for (const getStorage of [() => storage ?? browserWindow.sessionStorage, () => browserWindow.localStorage]) {
    try { getStorage()?.removeItem(PASSWORD_KEY); } catch {}
  }
  let requestEpoch = 0;
  let busy = false;
  let registered = false;
  let nextOffset = null;
  let expirationTimer;
  const clearError = () => { error.textContent = ''; error.hidden = true; };
  const showError = message => { error.textContent = message; error.hidden = false; };
  const controls = value => {
    busy = value;
    passwordInput.disabled = value; submit.disabled = value;
    refresh.disabled = value; if (more) more.disabled = value;
  };
  const showLocked = () => {
    requestEpoch++;
    clearTimeout(expirationTimer);
    registered = false;
    passwordInput.value = '';
    privateContent.hidden = true; dashboard.hidden = true; loginForm.hidden = false;
    root.querySelector('[data-visit-history]').replaceChildren();
    for (const element of root.querySelectorAll('[data-visits], [data-average]')) element.textContent = '—';
    for (const selector of ['[data-timezone]', '[data-updated]', '[data-history-total]']) { const element = root.querySelector(selector); if (element) element.textContent = ''; }
    nextOffset = null;
    if (root.title !== undefined) root.title = 'Access';
  };
  const request = async (path, options = {}) => {
    const response = await browserFetch('/api/analytics/' + path, {
      ...options, cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer',
    });
    if (response.status === 401) { const denied = new Error('Denied'); denied.denied = true; throw denied; }
    if (!response.ok) throw new Error('Unavailable');
    return response;
  };
  const load = async (epoch, offset = 0) => {
    if (!registered) {
      const browserId = getBrowserId(browserWindow);
      if (!browserId) throw new Error('Unavailable');
      await request('owner', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({browserId}) });
      if (epoch !== requestEpoch) return;
      registered = true;
    }
    const response = await request('stats' + (offset ? '?offset=' + offset : ''), {headers: {accept: 'application/json'}});
    const stats = await response.json();
    if (epoch !== requestEpoch) return;
    renderStats(dashboard, stats, {append: offset > 0});
    nextOffset = stats.history?.nextOffset ?? null;
    loginForm.hidden = true; privateContent.hidden = false; dashboard.hidden = false;
    if (root.title !== undefined) root.title = 'Private Analytics — lostfrxks';
  };
  const operation = async action => {
    if (busy) return;
    const epoch = ++requestEpoch;
    controls(true); clearError();
    try { await action(epoch); }
    catch (err) {
      if (epoch !== requestEpoch) return;
      showLocked(); controls(false); showError(err.denied ? 'Access denied.' : 'Temporarily unavailable.');
    } finally { if (epoch === requestEpoch) controls(false); }
  };
  const rememberExpiry = expiresAt => {
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Invalid session');
    clearTimeout(expirationTimer);
    expirationTimer = setTimeout(() => { showLocked(); controls(false); showError('Session expired. Sign in again.'); }, Math.min(expiresAt - Date.now(), 2147483647));
  };
  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !passwordInput.value) return;
    const body = JSON.stringify({password: passwordInput.value});
    passwordInput.value = '';
    void operation(async epoch => {
      const response = await request('auth', {method: 'POST', headers: {'content-type': 'application/json'}, body});
      const session = await response.json();
      if (epoch !== requestEpoch) return;
      rememberExpiry(session.expiresAt);
      registered = false;
      await load(epoch);
    });
  });
  refresh.addEventListener('click', () => { void operation(epoch => load(epoch)); });
  more?.addEventListener('click', () => { if (nextOffset !== null) void operation(epoch => load(epoch, nextOffset)); });
  lock.addEventListener('click', () => {
    showLocked(); controls(true); lock.disabled = true; clearError();
    const epoch = requestEpoch;
    void request('auth', {method: 'DELETE'}).catch(() => {
      if (epoch === requestEpoch) showError('Sign-out unavailable. Reload and try Lock again.');
    }).finally(() => { if (epoch === requestEpoch) controls(false); lock.disabled = false; });
  });
  // A page restored from browser history must recheck the server session.
  browserWindow.addEventListener('pageshow', event => { if (event.persisted) browserWindow.location.reload(); });
  void operation(async epoch => {
    const response = await request('auth');
    const session = await response.json();
    if (epoch !== requestEpoch || !session.authenticated) return;
    rememberExpiry(session.expiresAt);
    await load(epoch);
  });
}

if (typeof document !== 'undefined') { try { initializeDashboard(); } catch {} }
