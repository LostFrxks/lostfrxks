import assert from 'node:assert/strict';
import test from 'node:test';

const IDS = ['2fa03426-bb1f-4b9c-a7ce-0e760552ad57', '73d9e264-7ca6-4714-9868-1f4029b8214f', 'fd570f92-da7a-4c91-a725-927aac196729'];
function storage() { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) }; }
function harness(sectionId = 'projects') {
  let time = 0, sequence = 0, observer;
  const listeners = new Map();
  const section = { id: sectionId };
  const doc = { visibilityState: 'visible', referrer: 'https://google.com/search?private=secret', documentElement: { scrollHeight: 2000 }, querySelectorAll: () => [section], getElementById: () => null,
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const win = { localStorage: storage(), sessionStorage: storage(), crypto: { randomUUID: () => IDS[sequence++] }, performance: { now: () => time }, location: { href: 'https://portfolio.example/?utm_source=linkedin&private=secret', origin: 'https://portfolio.example', pathname: '/', search: '?utm_source=linkedin&private=secret' }, navigator: { userAgentData: { mobile: true, platform: 'Android' } }, scrollY: 500, innerHeight: 1000,
    IntersectionObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() { observer = null; } }, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  return { doc, win, advance: ms => { time += ms; }, observe: visible => observer?.([{ target: section, isIntersecting: visible }]), click: () => listeners.get('click')?.({ target: { closest: () => ({ href: 'https://portfolio.example/assets/artur-usenov-resume.pdf?private=secret', textContent: 'Download Resume', getAttribute: () => null }) } }), listeners };
}

test('same browser retains its ID but every page load creates a fresh visit', async () => {
  const { createVisitCollector, getBrowserId } = await import('../analytics-visit.mjs');
  const h = harness();
  const first = createVisitCollector({ browserWindow: h.win, browserDocument: h.doc });
  const second = createVisitCollector({ browserWindow: h.win, browserDocument: h.doc });
  assert.equal(first.snapshot(0).browserId, second.snapshot(0).browserId);
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(getBrowserId(h.win), first.snapshot(0).browserId);
});

test('collector sends referrer origin and campaign fields without private URLs or screen data', async () => {
  const { createVisitCollector } = await import('../analytics-visit.mjs');
  const h = harness();
  const collector = createVisitCollector({ browserWindow: h.win, browserDocument: h.doc });
  const snapshot = collector.snapshot(0);
  assert.equal(snapshot.referrer, 'https://google.com');
  assert.deepEqual(snapshot.utm, { source: 'linkedin' });
  assert.equal(snapshot.pagePath, '/');
  assert.deepEqual(snapshot.deviceHints, { mobile: true, platform: 'Android', model: '' });
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  assert.equal(JSON.stringify(snapshot).includes('screen'), false);
});

test('section time excludes hidden intervals and clicks/scroll are cumulative', async () => {
  const { createVisitCollector } = await import('../analytics-visit.mjs');
  const h = harness();
  const collector = createVisitCollector({ browserWindow: h.win, browserDocument: h.doc });
  h.observe(true); h.advance(5000); h.doc.visibilityState = 'hidden';
  let snapshot = collector.snapshot(5);
  assert.deepEqual(snapshot.sections, [{ id: 'projects', seconds: 5 }]);
  assert.equal(snapshot.scrollPercent, 50);
  h.advance(60000); h.doc.visibilityState = 'visible'; collector.snapshot(5);
  h.advance(3000); h.click(); h.click();
  snapshot = collector.snapshot(8);
  assert.deepEqual(snapshot.sections, [{ id: 'projects', seconds: 8 }]);
  assert.deepEqual(snapshot.clicks, [{ target: '/assets/artur-usenov-resume.pdf', label: 'Download Resume', count: 2 }]);
  h.win.scrollY = 0;
  assert.equal(collector.snapshot(8).scrollPercent, 50);
});

test('storage restrictions fall back to the tab and cleanup removes observers/listeners', async () => {
  const { createVisitCollector, getBrowserId } = await import('../analytics-visit.mjs');
  const h = harness();
  Object.defineProperty(h.win, 'localStorage', { get() { throw Error('blocked'); } });
  assert.equal(getBrowserId(h.win), IDS[0]);
  assert.equal(getBrowserId(h.win), IDS[0]);
  const collector = createVisitCollector({ browserWindow: h.win, browserDocument: h.doc });
  collector.stop(); collector.stop();
  assert.equal(h.listeners.size, 0);
});

test('sections behind the intro overlay do not count as viewed', async () => {
  const { createVisitCollector } = await import('../analytics-visit.mjs');
  const h = harness();
  let intro = {};
  h.doc.getElementById = () => intro;
  const collector = createVisitCollector({ browserWindow: h.win, browserDocument: h.doc });
  h.observe(true); h.advance(5000);
  assert.deepEqual(collector.snapshot(5).sections, []);
  intro = null; collector.snapshot(5); h.advance(2000);
  assert.deepEqual(collector.snapshot(7).sections, [{ id: 'projects', seconds: 2 }]);
});


test('talks section is observed and included in visit activity', async () => {
  const { createVisitCollector } = await import('../analytics-visit.mjs');
  const h = harness('talks');
  const watched = [];
  h.win.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(section) { watched.push(section); this.callback([{ target: section, isIntersecting: true }]); }
    disconnect() {}
  };
  const collector = createVisitCollector({ browserWindow: h.win, browserDocument: h.doc });
  assert.deepEqual(watched.map(section => section.id), ['talks']);
  h.advance(3000);
  assert.deepEqual(collector.snapshot(3).sections, [{ id: 'talks', seconds: 3 }]);
  collector.stop();
});
