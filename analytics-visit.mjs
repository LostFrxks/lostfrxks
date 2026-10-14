export const BROWSER_KEY = 'lostfrxks.analytics.browser';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECTIONS = new Set(['hero', 'whoami', 'experience', 'projects', 'stack', 'achievements', 'timeline', 'contact']);
const memoryIds = new WeakMap();
function clean(value, max = 120) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''; }

export function getBrowserId(browserWindow) {
  if (!browserWindow) return null;
  const stores = [];
  for (const name of ['localStorage', 'sessionStorage']) { try { if (browserWindow[name]) stores.push(browserWindow[name]); } catch {} }
  for (const store of stores) { try { const id = store.getItem(BROWSER_KEY); if (typeof id === 'string' && UUID.test(id)) return id.toLowerCase(); } catch {} }
  let id = memoryIds.get(browserWindow);
  try { id ??= browserWindow.crypto?.randomUUID(); } catch { return null; }
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  id = id.toLowerCase();
  memoryIds.set(browserWindow, id);
  for (const store of stores) { try { store.setItem(BROWSER_KEY, id); } catch {} }
  return id;
}

function destination(href, origin) {
  try {
    const url = new URL(href);
    if (url.username || url.password) return null;
    if (['mailto:', 'tel:'].includes(url.protocol)) return url.protocol + clean(url.pathname, 160);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return clean((url.origin === origin ? '' : url.origin) + url.pathname + url.hash, 300);
  } catch { return null; }
}

export function createVisitCollector({ browserWindow: win, browserDocument: doc }) {
  try {
    if (!win?.location || typeof doc?.querySelectorAll !== 'function') return null;
    const browserId = getBrowserId(win);
    const sessionId = win.crypto?.randomUUID();
    if (!browserId || !UUID.test(sessionId ?? '')) return null;
    const origin = win.location.origin;
    const pagePath = clean(win.location.pathname || '/', 160);
    let referrer = '';
    try { const url = new URL(doc.referrer); if (['http:', 'https:'].includes(url.protocol)) referrer = url.origin; } catch {}
    const utm = {};
    const query = new URLSearchParams(win.location.search);
    for (const key of ['source', 'medium', 'campaign', 'term', 'content']) { const val = query.get('utm_' + key); if (val) utm[key] = clean(val); }
    const uaData = win.navigator?.userAgentData;
    const deviceHints = { model: '', platform: clean(uaData?.platform, 60) };
    if (typeof uaData?.mobile === 'boolean') deviceHints.mobile = uaData.mobile;
    try {
      Promise.resolve(uaData?.getHighEntropyValues?.(['model'])).then(result => { deviceHints.model = clean(result?.model, 100); }).catch(() => {});
    } catch {}

    let stopped = false;
    let previousTime = win.performance.now();
    const isViewingPage = () => doc.visibilityState === 'visible' && !doc.getElementById?.('intro-screen');
    let previousVisibility = isViewingPage();
    let scrollPercent = 0;
    const visibleSections = new Set();
    const sectionMilliseconds = new Map();
    const clicks = new Map();
    function sampleSections() {
      const current = win.performance.now();
      const elapsed = Math.max(0, current - previousTime);
      if (previousVisibility && !stopped) {
        for (const id of visibleSections) sectionMilliseconds.set(id, Math.min(43_200_000, (sectionMilliseconds.get(id) ?? 0) + elapsed));
      }
      previousTime = current;
      previousVisibility = isViewingPage();
    }
    function sampleScroll() {
      const scrollable = Number(doc.documentElement?.scrollHeight) - Number(win.innerHeight);
      const amount = scrollable > 0 ? Math.round(Math.max(0, Number(win.scrollY) || 0) / scrollable * 100) : 0;
      scrollPercent = Math.max(scrollPercent, Math.min(100, amount));
    }
    function handleClick(event) {
      if (stopped) return;
      const link = event.target?.closest?.('a[href]');
      if (!link) return;
      const target = destination(link.href, origin);
      if (!target || (!clicks.has(target) && clicks.size >= 64)) return;
      const old = clicks.get(target);
      clicks.set(target, { target, label: clean(link.getAttribute('aria-label') || link.textContent || target, 100), count: Math.min(100_000, (old?.count ?? 0) + 1) });
    }
    let observer;
    let introObserver;
    const intro = doc.getElementById?.('intro-screen');
    if (intro?.parentElement && typeof win.MutationObserver === 'function') {
      introObserver = new win.MutationObserver(() => { sampleSections(); if (!doc.getElementById('intro-screen')) introObserver.disconnect(); });
      introObserver.observe(intro.parentElement, { childList: true });
    }
    if (typeof win.IntersectionObserver === 'function') {
      observer = new win.IntersectionObserver(entries => {
        sampleSections();
        for (const entry of entries) { if (entry.isIntersecting) visibleSections.add(entry.target.id); else visibleSections.delete(entry.target.id); }
      }, { threshold: 0 });
      for (const section of doc.querySelectorAll('section[id]')) if (SECTIONS.has(section.id)) observer.observe(section);
    }
    doc.addEventListener('click', handleClick);
    win.addEventListener('scroll', sampleScroll, { passive: true });
    sampleScroll();
    return {
      sessionId,
      snapshot(activeSeconds) {
        sampleSections(); sampleScroll();
        return { browserId, pagePath, referrer, utm: { ...utm }, deviceHints: { ...deviceHints }, scrollPercent, sections: [...sectionMilliseconds].map(([id, ms]) => ({ id, seconds: Math.min(activeSeconds, Math.floor(ms / 1000)) })), clicks: [...clicks.values()].map(item => ({ ...item })) };
      },
      stop() {
        if (stopped) return;
        sampleSections(); stopped = true;
        observer?.disconnect();
        introObserver?.disconnect();
        doc.removeEventListener('click', handleClick);
        win.removeEventListener('scroll', sampleScroll);
      },
    };
  } catch { return null; }
}
