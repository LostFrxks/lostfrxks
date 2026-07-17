export const ANALYTICS_SESSION_KEY = 'lostfrxks.analytics.session';
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const MAX_ACTIVE_SECONDS = 43_200;

const DEFAULT_ENDPOINT = '/api/analytics/session';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readNow(now, fallback) {
  try {
    const value = now();
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readVisibility(isVisible, fallback = false) {
  try {
    return isVisible() === true;
  } catch {
    return fallback;
  }
}

export function createActiveTimer({ now, isVisible }) {
  let previousTime = readNow(now, 0);
  let previousVisibility = readVisibility(isVisible);
  let activeMilliseconds = 0;

  return {
    sample() {
      const currentTime = readNow(now, previousTime);
      const elapsedMilliseconds = Math.max(0, currentTime - previousTime);

      if (previousVisibility) {
        activeMilliseconds = Math.min(
          MAX_ACTIVE_SECONDS * 1_000,
          activeMilliseconds + elapsedMilliseconds,
        );
      }

      previousTime = currentTime;
      previousVisibility = readVisibility(isVisible);
      return Math.min(
        MAX_ACTIVE_SECONDS,
        Math.floor(activeMilliseconds / 1_000),
      );
    },
  };
}

export function getOrCreateSessionId(storage, cryptoImpl) {
  let storedSessionId = null;

  try {
    storedSessionId = storage?.getItem(ANALYTICS_SESSION_KEY);
  } catch {
    storedSessionId = null;
  }

  if (typeof storedSessionId === 'string' && UUID_V4_PATTERN.test(storedSessionId)) {
    return storedSessionId;
  }

  let sessionId;
  try {
    sessionId = cryptoImpl?.randomUUID();
  } catch {
    return null;
  }

  if (typeof sessionId !== 'string' || !UUID_V4_PATTERN.test(sessionId)) {
    return null;
  }

  try {
    storage?.setItem(ANALYTICS_SESSION_KEY, sessionId);
  } catch {
    // A memory-only session is still useful when sessionStorage is unavailable.
  }

  return sessionId;
}

function noOp() {}

export function startAnalytics({
  browserWindow = typeof window === 'undefined' ? undefined : window,
  browserDocument = typeof document === 'undefined' ? undefined : document,
  endpoint = DEFAULT_ENDPOINT,
} = {}) {
  try {
    let storage;
    let cryptoImpl;
    try {
      storage = browserWindow?.sessionStorage;
    } catch {
      storage = undefined;
    }
    try {
      cryptoImpl = browserWindow?.crypto;
    } catch {
      cryptoImpl = undefined;
    }

    const sessionId = getOrCreateSessionId(storage, cryptoImpl);
    if (!sessionId) {
      return noOp;
    }

    const isVisible = () => browserDocument?.visibilityState === 'visible';
    const now = () => browserWindow.performance.now();
    const timer = createActiveTimer({ isVisible, now });

    let stopped = false;
    let capSent = false;
    let pagehideSent = false;
    let observedVisibility = readVisibility(isVisible);
    let intervalId;
    let intervalRegistered = false;
    let pagehideRegistered = false;
    let visibilityRegistered = false;

    function send(activeSeconds) {
      if (stopped) {
        return;
      }

      try {
        const request = browserWindow.fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, activeSeconds }),
          cache: 'no-store',
          credentials: 'omit',
          keepalive: true,
          referrerPolicy: 'no-referrer',
        });
        Promise.resolve(request).catch(noOp);
      } catch {
        // Analytics delivery must never affect the page.
      }
    }

    function cleanup() {
      if (stopped) {
        return;
      }
      stopped = true;

      if (intervalRegistered) {
        try {
          browserWindow.clearInterval(intervalId);
        } catch {
          // Cleanup remains best-effort in restricted browser environments.
        }
      }
      if (visibilityRegistered) {
        try {
          browserDocument.removeEventListener('visibilitychange', handleVisibilityChange);
        } catch {
          // Cleanup remains best-effort in restricted browser environments.
        }
      }
      if (pagehideRegistered) {
        try {
          browserWindow.removeEventListener('pagehide', handlePagehide);
        } catch {
          // Cleanup remains best-effort in restricted browser environments.
        }
      }
    }

    function sampleAndSend() {
      if (stopped || capSent) {
        return;
      }

      let activeSeconds;
      try {
        activeSeconds = timer.sample();
      } catch {
        return;
      }

      if (activeSeconds >= MAX_ACTIVE_SECONDS) {
        capSent = true;
        send(MAX_ACTIVE_SECONDS);
        cleanup();
        return;
      }

      send(activeSeconds);
    }

    function handleVisibilityChange() {
      if (stopped) {
        return;
      }

      const nextVisibility = readVisibility(isVisible);
      if (nextVisibility === observedVisibility) {
        return;
      }
      observedVisibility = nextVisibility;
      sampleAndSend();
    }

    function handlePagehide() {
      if (stopped || pagehideSent) {
        return;
      }
      pagehideSent = true;
      sampleAndSend();
    }

    function handleInterval() {
      if (stopped || !readVisibility(isVisible)) {
        return;
      }
      sampleAndSend();
    }

    send(0);

    try {
      browserDocument.addEventListener('visibilitychange', handleVisibilityChange);
      visibilityRegistered = true;
    } catch {
      visibilityRegistered = false;
    }
    try {
      browserWindow.addEventListener('pagehide', handlePagehide);
      pagehideRegistered = true;
    } catch {
      pagehideRegistered = false;
    }
    try {
      intervalId = browserWindow.setInterval(handleInterval, HEARTBEAT_INTERVAL_MS);
      intervalRegistered = true;
    } catch {
      intervalRegistered = false;
    }

    return cleanup;
  } catch {
    return noOp;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    startAnalytics();
  } catch {
    // Auto-start is intentionally fail-safe.
  }
}
