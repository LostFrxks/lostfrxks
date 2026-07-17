const TOKEN_KEY = 'lostfrxks.analytics.adminToken';
const PERIOD_KEYS = ['today', 'sevenDays', 'thirtyDays', 'allTime'];

export function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes}m ${safe % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function renderStats(root, stats) {
  for (const key of PERIOD_KEYS) {
    const period = stats?.periods?.[key];
    const card = root.querySelector(`[data-period="${key}"]`);
    if (!card || !period) throw new Error('Invalid analytics response');
    card.querySelector('[data-visits]').textContent = String(period.visits);
    card.querySelector('[data-average]').textContent = formatDuration(period.averageActiveSeconds);
  }
  root.querySelector('[data-timezone]').textContent = stats.timezone;
  root.querySelector('[data-updated]').textContent = new Date(stats.generatedAt).toLocaleString(undefined, {
    timeZone: stats.timezone,
  });
}

export function initializeDashboard({
  root = document,
  browserFetch = fetch,
  storage = sessionStorage,
} = {}) {
  const loginForm = root.querySelector('[data-login-form]');
  const tokenInput = root.querySelector('#admin-token');
  const error = root.querySelector('[data-error]');
  const dashboard = root.querySelector('[data-dashboard]');
  const refresh = root.querySelector('[data-refresh]');
  const lock = root.querySelector('[data-lock]');

  const clearError = () => {
    error.textContent = '';
    error.hidden = true;
  };
  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  const showLocked = () => {
    dashboard.hidden = true;
    loginForm.hidden = false;
  };

  const load = async (token) => {
    clearError();
    try {
      const response = await browserFetch('/api/analytics/stats', {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (response.status === 401) {
        try { storage.removeItem(TOKEN_KEY); } catch {}
        showLocked();
        showError('Invalid admin token.');
        return;
      }
      if (!response.ok) throw new Error('Unavailable');
      renderStats(dashboard, await response.json());
      loginForm.hidden = true;
      dashboard.hidden = false;
    } catch {
      showLocked();
      showError('Analytics are temporarily unavailable.');
    }
  };

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return;
    try { storage.setItem(TOKEN_KEY, token); } catch {}
    void load(token);
  });
  refresh.addEventListener('click', () => {
    let token = tokenInput.value.trim();
    try { token = storage.getItem(TOKEN_KEY) || token; } catch {}
    if (token) void load(token);
  });
  lock.addEventListener('click', () => {
    try { storage.removeItem(TOKEN_KEY); } catch {}
    tokenInput.value = '';
    clearError();
    showLocked();
  });

  let savedToken = '';
  try { savedToken = storage.getItem(TOKEN_KEY) || ''; } catch {}
  if (savedToken) {
    tokenInput.value = savedToken;
    void load(savedToken);
  }
}

if (typeof document !== 'undefined') {
  try { initializeDashboard(); } catch {}
}
