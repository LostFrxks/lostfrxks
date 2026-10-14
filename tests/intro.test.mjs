import assert from 'node:assert/strict';
import test from 'node:test';

async function harness({ reduced = false } = {}) {
  const { createIntroController } = await import('../intro.mjs');
  let now = 0;
  let sequence = 0;
  const frames = new Map(), listeners = new Map(), docListeners = new Map(), classes = new Set();
  let reveals = 0, completions = 0;
  const name = { textContent: '', getAttribute: () => 'Artur Usenov' };
  const screen = { dataset: {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c) }, style: { setProperty() {} }, addEventListener: (e, h) => listeners.set(e, h), removeEventListener: e => listeners.delete(e) };
  const doc = { visibilityState: 'visible', addEventListener: (e, h) => docListeners.set(e, h), removeEventListener: e => docListeners.delete(e) };
  const win = { performance: { now: () => now }, matchMedia: () => ({ matches: reduced }), requestAnimationFrame: cb => { const id = ++sequence; frames.set(id, cb); return id; }, cancelAnimationFrame: id => frames.delete(id) };
  const controller = createIntroController({ screen, name, browserWindow: win, browserDocument: doc, onReveal: () => reveals++, onComplete: () => completions++ });
  return { name, screen, controller, classes, click() { listeners.get('click')?.(); }, step(t) { now = t; const callbacks = [...frames.values()]; frames.clear(); for (const cb of callbacks) cb(t); }, visibility(state) { doc.visibilityState = state; docListeners.get('visibilitychange')?.(); }, get pending() { return frames.size; }, get reveals() { return reveals; }, get completions() { return completions; } };
}

test('intro resolves identity, reveals once and holds the resolved name before completing within two seconds', async () => {
  const h = await harness();
  h.step(0); h.click(); h.click();
  h.step(400); assert.notEqual(h.name.textContent, 'Artur Usenov');
  h.step(760); assert.equal(h.name.textContent, 'Artur Usenov');
  assert.equal(h.reveals, 0);
  h.step(1300); assert.equal(h.name.textContent, 'Artur Usenov'); assert.equal(h.reveals, 0);
  assert.equal(h.screen.dataset.introPhase, 'resolved');
  h.step(1460); assert.equal(h.reveals, 1);
  h.step(1900); assert.equal(h.completions, 1); assert.equal(h.pending, 0);
  h.click(); h.step(2000); assert.equal(h.completions, 1);
});

test('slow frames cross all intro phases without extending chained delays', async () => {
  const h = await harness();h.click();h.step(2200);
  assert.equal(h.name.textContent, 'Artur Usenov');
  assert.equal(h.reveals, 1);assert.equal(h.completions, 1);
});

test('reduced motion presents readable identity and opens without animation', async () => {
  const h = await harness({ reduced: true });
  assert.equal(h.name.textContent, 'Artur Usenov');assert.equal(h.pending, 0);
  h.click();assert.equal(h.reveals, 1);assert.equal(h.completions, 1);assert.equal(h.pending, 0);
});

test('hidden intro pauses and resumes without double callbacks', async () => {
  const h = await harness();h.click();h.step(300);h.visibility('hidden');
  assert.equal(h.pending, 0);h.step(10_000);assert.equal(h.completions, 0);
  h.visibility('visible');h.step(10_300);assert.notEqual(h.name.textContent, 'Artur Usenov');
  h.step(11_700);assert.equal(h.completions, 1);assert.equal(h.reveals, 1);
});

test('destroy cancels pending intro updates and releases event listeners', async () => {
  const h = await harness();h.click();h.controller.destroy();
  assert.equal(h.pending, 0);h.step(2000);h.click();
  assert.equal(h.reveals, 0);assert.equal(h.completions, 0);
});
