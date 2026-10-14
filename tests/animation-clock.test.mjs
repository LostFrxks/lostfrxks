import assert from 'node:assert/strict';
import test from 'node:test';

test('rain clock limits paints while preserving motion across 30, 60 and 144 Hz', async () => {
  const { createFrameClock } = await import('../animation-clock.mjs');
  for (const hz of [30, 60, 144]) {
    const clock = createFrameClock({ intervalMs: 1000 / 30 });
    let seconds = 0, paints = 0;
    for (let frame = 0; frame <= hz; frame++) {
      const dt = clock.sample(frame * 1000 / hz);
      if (dt !== null) { seconds += dt; paints++; }
    }
    assert.ok(Math.abs(seconds - 1) < 0.001, 'motion uses elapsed seconds');
    assert.ok(paints <= 31 && paints >= 29, 'paint budget remains about 30 FPS');
  }
});

test('rain clock reset prevents background-tab catch-up and caps long frame gaps', async () => {
  const { createFrameClock } = await import('../animation-clock.mjs');
  const clock = createFrameClock({ intervalMs: 1000 / 30 });
  clock.sample(0);clock.sample(40);clock.reset();
  assert.equal(clock.sample(60_000), 0);
  assert.ok(clock.sample(60_040) < 0.05);
  assert.ok(clock.sample(80_000) <= 0.1);
});
