(() => {
  'use strict';

  const VERSION = '1.2.4';
  const QUEUE_KEY = 'kambuz_pending_ops';
  const NET_RE = /(load failed|failed to fetch|network\s*error|networkerror|network request failed|offline|сеть|соединен)/i;

  function readQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(q) ? q : [];
    } catch { return []; }
  }

  function writeQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  function normalizeTransientQueue() {
    const q = readQueue();
    let changed = false;
    for (const task of q) {
      if (task?.status === 'error' && NET_RE.test(String(task.error || ''))) {
        task.status = 'pending';
        task.error = null;
        changed = true;
      }
    }
    if (changed) writeQueue(q);
    return q;
  }

  function uniquePositionCount(q) {
    const ids = new Set();
    for (const task of q) ids.add(task.item_id || task.item_name || task.id);
    return ids.size;
  }

  function patchSyncPanel() {
    const panel = document.querySelector('.sync-panel-state')?.closest('.modal');
    if (!panel) return;

    const q = normalizeTransientQueue();
    const positions = uniquePositionCount(q);
    const tasks = q.length;

    const stateBox = panel.querySelector('.sync-panel-state');
    if (stateBox && positions) {
      const title = stateBox.querySelector('b');
      if (title && /ожидает/i.test(title.textContent || '')) {
        title.textContent = `🟡 Ожидает синхронизации (${positions} поз.)`;
      }
    }

    const compactTitle = [...panel.querySelectorAll('.compact-title b')]
      .find(el => /в очереди/i.test(el.textContent || ''));
    if (compactTitle) {
      compactTitle.textContent = positions
        ? `В очереди: ${positions} позиций`
        : 'В очереди: 0';
      if (tasks > positions) compactTitle.title = `Технических задач синхронизации: ${tasks}`;
    }

    const rows = [...panel.querySelectorAll('.sync-queue-row')];
    const byName = new Map();
    for (const row of rows) {
      const name = row.querySelector('b')?.textContent?.trim() || '';
      const small = row.querySelector('small');
      const text = small?.textContent || '';
      const isMeta = /создание\/обновление товара/i.test(text);
      const isNet = NET_RE.test(text);

      if (isNet || row.classList.contains('queue-error')) {
        if (isNet) {
          row.classList.remove('queue-error');
          if (small) small.textContent = isMeta
            ? 'Карточка товара · ждёт связи с сервером'
            : text.replace(/\s*·\s*TypeError:\s*Load failed.*$/i, ' · ждёт связи с сервером')
                  .replace(/TypeError:\s*Load failed/ig, 'ждёт связи с сервером');
          const icon = row.querySelector(':scope > span');
          if (icon) icon.textContent = '◷';
        }
      }

      if (!name) continue;
      const previous = byName.get(name);
      if (!previous) {
        byName.set(name, { row, isMeta });
        continue;
      }

      // В интерфейсе показываем одну позицию, а не две внутренние задачи
      // (upsert карточки + операция поступления).
      if (previous.isMeta && !isMeta) {
        previous.row.style.display = 'none';
        byName.set(name, { row, isMeta });
      } else {
        row.style.display = 'none';
      }
    }

    const list = panel.querySelector('.sync-queue');
    if (list && positions && !list.querySelector('.sync-tech-note')) {
      const note = document.createElement('div');
      note.className = 'sync-tech-note';
      note.style.cssText = 'padding:10px 2px 2px;color:#718078;font-size:12px;line-height:1.35';
      note.textContent = tasks > positions
        ? `${positions} позиций. Внутри приложение хранит ${tasks} технических задач: карточка товара + само поступление.`
        : `${positions} позиций ждут отправки.`;
      list.appendChild(note);
    }
  }

  function patchHeaderCounts() {
    const q = normalizeTransientQueue();
    const positions = uniquePositionCount(q);
    if (!positions) return;

    document.querySelectorAll('.sync-indicator .sync-mini-label').forEach(el => {
      if (/ожидает/i.test(el.textContent || '')) el.textContent = `Ожидает (${positions})`;
    });
    document.querySelectorAll('.sync').forEach(el => {
      const text = el.textContent || '';
      if (/ожидает\s*\(\d+\)/i.test(text)) {
        el.textContent = text.replace(/Ожидает\s*\(\d+\)/i, `Ожидает (${positions})`);
      }
    });
  }

  function refresh() {
    patchHeaderCounts();
    patchSyncPanel();
  }

  function start() {
    refresh();
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 50);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') setTimeout(refresh, 100);
    });
  }

  window.KAMBUZ_SYNC_QUEUE_UI = { version: VERSION, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
