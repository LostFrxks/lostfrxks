const PASSWORD_KEY = 'lostfrxks.analytics.adminPassword';
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
  const passwordInput = root.querySelector('#access-password');
  const error = root.querySelector('[data-error]');
  const privateContent = root.querySelector('[data-private-content]');
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
    privateContent.hidden = true;
    dashboard.hidden = true;
    loginForm.hidden = false;
    if (root.title !== undefined) root.title = 'Access';
  };

  const load = async (password) => {
    clearError();
    try {
      const response = await browserFetch('/api/analytics/stats', {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${password}` },
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (response.status === 401) {
        try { storage.removeItem(PASSWORD_KEY); } catch {}
        showLocked();
        showError('Access denied.');
        return;
      }
      if (!response.ok) throw new Error('Unavailable');
      renderStats(dashboard, await response.json());
      loginForm.hidden = true;
      privateContent.hidden = false;
      dashboard.hidden = false;
      if (root.title !== undefined) root.title = 'Private Analytics — lostfrxks';
    } catch {
      showLocked();
      showError('Temporarily unavailable.');
    }
  };

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = passwordInput.value.trim();
    if (!password) return;
    try { storage.setItem(PASSWORD_KEY, password); } catch {}
    void load(password);
  });
  refresh.addEventListener('click', () => {
    let password = passwordInput.value.trim();
    try { password = storage.getItem(PASSWORD_KEY) || password; } catch {}
    if (password) void load(password);
  });
  lock.addEventListener('click', () => {
    try { storage.removeItem(PASSWORD_KEY); } catch {}
    passwordInput.value = '';
    clearError();
    showLocked();
  });

  let savedPassword = '';
  try { savedPassword = storage.getItem(PASSWORD_KEY) || ''; } catch {}
  if (savedPassword) {
    passwordInput.value = savedPassword;
    void load(savedPassword);
  }
}

if (typeof document !== 'undefined') {
  try { initializeDashboard(); } catch {}
}
