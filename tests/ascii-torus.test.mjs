import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../ascii-torus.js', import.meta.url), 'utf8');
function createRenderer({ reducedMotion = false } = {}) {
  let now = 0;
  let frameSequence = 0;
  const frames = new Map();
  const shellListeners = new Map();
  const documentListeners = new Map();
  const captures = new Set();
  const classes = new Set();
  const output = { textContent: '' };
  const shell = {
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    addEventListener: (name, handler) => shellListeners.set(name, handler),
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  };
  const root = { hidden: false, dataset: {}, classList: { contains: () => true }, querySelector: selector => selector.includes('output') ? output : selector.includes('shell') ? shell : { textContent: '' } };
  const document = { visibilityState: 'visible', getElementById: () => root, addEventListener: (name, handler) => documentListeners.set(name, handler) };
  const window = {
    matchMedia: query => ({ matches: reducedMotion && query.includes('prefers-reduced-motion') }),
    addEventListener() {},
    requestAnimationFrame: callback => { const id = ++frameSequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  runInNewContext(source, { window, document, performance: { now: () => now }, MutationObserver: class { observe() {} disconnect() {} } });
  return {
    output, root, window,
    step(timestamp) { now = timestamp; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(timestamp); },
    pointer(type, overrides = {}) { shellListeners.get(type)?.({ pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100, timeStamp: now, ...overrides }); },
    visibility(value) { document.visibilityState = value; documentListeners.get('visibilitychange')?.(); },
    get dragging() { return classes.has('is-dragging'); },
    get pendingFrames() { return frames.size; },
  };
}

// A frame-by-frame bounding-box recenter causes a whole-grid jump on tiny rotations.
test('tiny rotations never shift the entire ASCII surface by a grid cell', () => {
  const renderer = createRenderer({ reducedMotion: true });
  renderer.window.__asciiTorusDebug.startReveal();
  for (let step = 0; step < 600; step++) {
    const before = renderer.output.textContent;
    renderer.window.__asciiTorusDebug.applyScreenRoll(0.0005);
    const after = renderer.output.textContent;
    let changed = 0;
    let occupied = 0;
    for (let index = 0; index < after.length; index++) {
      if (before[index] !== after[index]) changed++;
      if (after[index] !== ' ' && after[index] !== '\n') occupied++;
    }
    assert.ok(occupied > 100, 'surface remains visible');
    assert.ok(changed / occupied < 0.1, `surface jumped at step ${step}: ${changed}/${occupied}`);
  }
});

test('equal elapsed time produces equal rotation on 30, 60 and 144 Hz displays', () => {
  const rotations = [30, 60, 144].map(hz => {
    const renderer = createRenderer();
    renderer.step(0);
    for (let frame = 1; frame <= hz; frame++) renderer.step(frame * 1000 / hz);
    return renderer.root.dataset.torusRotation.split(',').map(Number);
  });
  for (const rotation of rotations.slice(1)) for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(rotation[axis] - rotations[0][axis]) <= 0.003);
});

test('another pointer cannot rotate or release an active drag', () => {
  const renderer = createRenderer();
  renderer.pointer('pointerdown');
  const before = renderer.root.dataset.torusRotation;
  renderer.pointer('pointermove', { pointerId: 2, clientX: 160 });
  assert.equal(renderer.root.dataset.torusRotation, before);
  renderer.pointer('pointerup', { pointerId: 2 });
  assert.equal(renderer.dragging, true);
  renderer.pointer('pointermove', { clientX: 140, timeStamp: 20 });
  assert.notEqual(renderer.root.dataset.torusRotation, before);
  renderer.pointer('pointerup');
  assert.equal(renderer.dragging, false);
});

test('losing pointer capture ends dragging and resumes automatic motion', () => {
  const renderer = createRenderer();
  renderer.step(0);
  renderer.pointer('pointerdown');
  renderer.pointer('lostpointercapture');
  assert.equal(renderer.dragging, false);
  const before = renderer.root.dataset.torusRotation;
  for (let timestamp = 20; timestamp <= 240; timestamp += 20) renderer.step(timestamp);
  assert.notEqual(renderer.root.dataset.torusRotation, before);
});

test('hidden tabs pause rendering and return without a catch-up jump', () => {
  const renderer = createRenderer();
  renderer.step(0); renderer.step(20);
  const before = renderer.root.dataset.torusRotation;
  renderer.visibility('hidden');
  assert.equal(renderer.pendingFrames, 0);
  renderer.step(60_000);
  assert.equal(renderer.root.dataset.torusRotation, before);
  renderer.visibility('visible');
  assert.equal(renderer.pendingFrames, 1);
  renderer.step(60_000);
  assert.equal(renderer.root.dataset.torusRotation, before);
  renderer.step(60_020);
  assert.notEqual(renderer.root.dataset.torusRotation, before);
});
