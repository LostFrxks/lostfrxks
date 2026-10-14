// Paint cadence and motion integration are separate: skipped paints lose no time.
export function createFrameClock({ intervalMs, maxDeltaMs = 100 }) {
  let previousTime = null;
  let nextPaintTime = null;
  return {
    sample(timestamp) {
      if (previousTime === null) {
        previousTime = timestamp;
        nextPaintTime = timestamp + intervalMs;
        return 0;
      }
      if (timestamp + 0.000001 < nextPaintTime) return null;
      const delta = Math.min(maxDeltaMs, Math.max(0, timestamp - previousTime));
      previousTime = timestamp;
      nextPaintTime += (Math.floor(Math.max(0, timestamp - nextPaintTime) / intervalMs) + 1) * intervalMs;
      return delta / 1000;
    },
    reset() { previousTime = null; nextPaintTime = null; },
  };
}
