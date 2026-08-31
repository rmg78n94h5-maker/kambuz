(() => {
  'use strict';

  const VERSION = '1.2.2';
  const QUEUE_KEY = 'kambuz_pending_ops';
  const NETWORK_FAIL_KEY = 'kambuz_last_network_fail_at';
  const NETWORK_ERROR_RE = /(load failed|failed to fetch|network\s*error|networkerror|network request failed|internet connection appears to be offline|the internet connection appears to be offline|соединен|сеть недоступ|network connection)/i;
  const PROBE_INTERVAL = 45000;
  const NETWORK_FAIL_TTL = 120000;
  let lastProbeAt = 0;
  let probing = false;
  let dispatchingRecovery = false;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      return await nativeFetch(...args);
    } catch (e) {
      if (NETWORK_ERROR_RE.test(String(e?.message || e || ''))) {
        sessionStorage.setItem(NETWORK_FAIL_KEY, String(Date.now()));
      }
      throw e;
    }
  };

  const queueCount = () => {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(q) ? q.length : 0;
    } catch { return 0; }
  };

  function recentNetworkFailure() {
    const at = Number(sessionStorage.getItem(NETWORK_FAIL_KEY) || 0);
    return at > 0 && Date.now() - at < NETWORK_FAIL_TTL;
  }

  function isTransientNetworkError(text) {
    return NETWORK_ERROR_RE.test(String(text || ''));
  }

  function softenSyncError() {
    const queue = queueCount();
    const transient = recentNetworkFailure();

    document.querySelectorAll('.sync.bad').forEach(el => {
      if (!transient) return;
      el.classList.remove('bad');
      el.classList.add(queue ? 'wait' : 'offline');
      el.textContent = `${queue ? `🟡 Ожидает (${queue})` : '🟠 Сервер недоступен'} · ${localStorage.getItem('kambuz_user') || 'Пользователь'}`;
      el.title = queue ? 'Изменения сохранены на устройстве и ждут связи с сервером' : 'Локальные данные доступны. Связь с сервером временно недоступна.';
    });

    document.querySelectorAll('.sync-indicator.bad').forEach(el => {
      if (!transient) return;
      el.classList.remove('bad');
      el.classList.add(queue ? 'wait' : 'offline');
      const glyph = el.querySelector('.sync-glyph');
      const label = el.querySelector('.sync-mini-label');
      if (glyph) glyph.textContent = queue ? '◷' : '↯';
      if (label) label.textContent = queue ? `Ожидает (${queue})` : 'Офлайн';
      const message = queue ? 'Изменения ждут синхронизации' : 'Сервер временно недоступен';
      el.title = message;
      el.setAttribute('aria-label', message);
    });

    document.querySelectorAll('.sync-panel-state.bad').forEach(box => {
      const detail = box.textContent || '';
      if (!isTransientNetworkError(detail) && !transient) return;
      box.classList.remove('bad');
      box.classList.add(queue ? 'wait' : 'offline');
      const b = box.querySelector('b');
      const small = box.querySelector('small');
      if (b) b.textContent = queue ? `🟡 Ожидает синхронизации (${queue})` : '🟠 Сервер временно недоступен';
      if (small) small.textContent = queue
        ? 'Изменения сохранены на этом устройстве. Отправим их автоматически, когда сервер станет доступен.'
        : 'Очередь пуста. Локальные данные в порядке; повторим подключение позже.';
    });
  }

  async function probeServer(force = false) {
    if (probing) return;
    const current = Date.now();
    if (!force && current - lastProbeAt < PROBE_INTERVAL) return;
    if (!navigator.onLine) return;
    const cfg = window.KAMBUZ_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;

    probing = true;
    lastProbeAt = current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await nativeFetch(`${cfg.SUPABASE_URL}/rest/v1/items?select=id&limit=1`, {
        method: 'GET',
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`
        },
        cache: 'no-store',
        signal: controller.signal
      });
      if (res.ok) {
        sessionStorage.removeItem(NETWORK_FAIL_KEY);
        dispatchingRecovery = true;
        window.dispatchEvent(new Event('online'));
        setTimeout(() => { dispatchingRecovery = false; }, 0);
      }
    } catch (e) {
      sessionStorage.setItem(NETWORK_FAIL_KEY, String(Date.now()));
    } finally {
      clearTimeout(timer);
      probing = false;
      softenSyncError();
    }
  }

  function start() {
    softenSyncError();
    const root = document.documentElement;
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        softenSyncError();
        const panelHasNetworkError = [...document.querySelectorAll('.sync-panel-state.bad small')]
          .some(el => isTransientNetworkError(el.textContent));
        if (recentNetworkFailure() || panelHasNetworkError) probeServer(false);
      }, 60);
    }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'title', 'aria-label'] });

    window.addEventListener('online', () => {
      if (dispatchingRecovery) return;
      setTimeout(() => probeServer(true), 1200);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && recentNetworkFailure()) setTimeout(() => probeServer(false), 800);
    });
    if (recentNetworkFailure()) setTimeout(() => probeServer(false), 1500);
  }

  window.KAMBUZ_SYNC_RESILIENCE = { version: VERSION, probeServer, softenSyncError };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
