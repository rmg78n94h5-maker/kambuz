(() => {
  'use strict';

  const VERSION = '1.4.0';
  const KEYS = {
    items: 'kambuz_items',
    ops: 'kambuz_ops',
    queue: 'kambuz_pending_ops',
    inventories: 'kambuz_inventories',
    active: 'kambuz_active_inventory_id'
  };

  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = () => new Date().toISOString();
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const clean = value => String(value ?? '').trim();
  const num = value => {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const fmt = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 });

  const SCOPE_LABELS = {
    all: 'Весь склад',
    products: 'Продукты',
    chem: 'Химия',
    household: 'Хозтовары / посуда / инвентарь'
  };

  function inventories() {
    const value = read(KEYS.inventories, []);
    return Array.isArray(value) ? value : [];
  }

  function saveInventory(session) {
    const list = inventories();
    const index = list.findIndex(x => x.id === session.id);
    session.updated_at = now();
    if (index >= 0) list[index] = session;
    else list.unshift(session);
    write(KEYS.inventories, list.slice(0, 40));
    if (['in_progress', 'ready'].includes(session.status)) localStorage.setItem(KEYS.active, session.id);
    else if (localStorage.getItem(KEYS.active) === session.id) localStorage.removeItem(KEYS.active);
  }

  function activeInventory() {
    const id = localStorage.getItem(KEYS.active);
    if (!id) return null;
    return inventories().find(x => x.id === id && ['in_progress', 'ready'].includes(x.status)) || null;
  }

  function getInventory(id) {
    return inventories().find(x => x.id === id) || null;
  }

  function scopeMatches(item, scope) {
    if (scope === 'all') return true;
    const cat = clean(item.category).toLowerCase();
    if (scope === 'chem') return cat === 'химия';
    if (scope === 'household') return ['хозтовары', 'посуда', 'инвентарь'].includes(cat);
    if (scope === 'products') return cat === 'продукты' || !['химия', 'хозтовары', 'посуда', 'инвентарь'].includes(cat);
    return true;
  }

  function packLabel(item) {
    const value = Number(item.volume ?? item.weight ?? 0);
    const unit = clean(item.package_unit);
    return value > 0 && unit ? `${fmt(value)} ${unit}` : '';
  }

  function makeEntry(item, index) {
    return {
      item_id: item.id,
      name: clean(item.name) || 'Без названия',
      category: clean(item.category),
      subcategory: clean(item.subcategory),
      unit: clean(item.unit) || 'шт.',
      package_label: packLabel(item),
      system_qty: Number(item.qty || 0),
      fact: null,
      counted_at: null,
      skip_count: 0,
      order: index
    };
  }

  function startInventory(scope, blind) {
    const items = read(KEYS.items, []).filter(item => item?.id && scopeMatches(item, scope));
    items.sort((a, b) => {
      const ak = `${clean(a.category)}\u0000${clean(a.subcategory)}\u0000${clean(a.name)}`;
      const bk = `${clean(b.category)}\u0000${clean(b.subcategory)}\u0000${clean(b.name)}`;
      return ak.localeCompare(bk, 'ru');
    });
    if (!items.length) throw new Error('В выбранном разделе нет товаров.');

    const existing = activeInventory();
    if (existing) {
      const ok = confirm('Есть незавершённая инвентаризация. Начать новую и оставить старую в истории как незавершённую?');
      if (!ok) return existing;
      existing.status = 'abandoned';
      existing.abandoned_at = now();
      saveInventory(existing);
    }

    const entries = items.map(makeEntry);
    const session = {
      id: uid(),
      status: 'in_progress',
      scope,
      scope_label: SCOPE_LABELS[scope] || SCOPE_LABELS.all,
      blind: Boolean(blind),
      user_name: localStorage.getItem('kambuz_user') || 'Пользователь',
      started_at: now(),
      updated_at: now(),
      completed_at: null,
      applied_at: null,
      entries,
      remaining: entries.map(x => x.item_id),
      counted_order: [],
      note: ''
    };
    saveInventory(session);
    return session;
  }

  function progress(session) {
    const counted = session.entries.filter(x => x.fact !== null && Number.isFinite(Number(x.fact))).length;
    return { counted, total: session.entries.length, remaining: session.entries.length - counted };
  }

  function currentEntry(session) {
    if (!Array.isArray(session.remaining)) session.remaining = [];
    session.remaining = session.remaining.filter(id => session.entries.some(e => e.item_id === id && e.fact === null));
    if (!session.remaining.length) {
      const missed = session.entries.filter(e => e.fact === null).map(e => e.item_id);
      session.remaining = missed;
    }
    return session.entries.find(e => e.item_id === session.remaining[0]) || null;
  }

  function countCurrent(session, value) {
    const fact = num(value);
    if (fact === null || fact < 0) throw new Error('Введите фактическое количество: 0 или больше.');
    const entry = currentEntry(session);
    if (!entry) return;
    entry.fact = fact;
    entry.counted_at = now();
    session.remaining = session.remaining.filter(id => id !== entry.item_id);
    session.counted_order = (session.counted_order || []).filter(id => id !== entry.item_id);
    session.counted_order.push(entry.item_id);
    if (!session.remaining.length && !session.entries.some(e => e.fact === null)) session.status = 'ready';
    saveInventory(session);
  }

  function skipCurrent(session) {
    const entry = currentEntry(session);
    if (!entry) return;
    entry.skip_count = Number(entry.skip_count || 0) + 1;
    const rest = session.remaining.filter(id => id !== entry.item_id);
    rest.push(entry.item_id);
    session.remaining = rest;
    saveInventory(session);
  }

  function previousEntry(session) {
    const history = session.counted_order || [];
    const id = history.pop();
    if (!id) return false;
    const entry = session.entries.find(e => e.item_id === id);
    if (!entry) return false;
    entry.fact = null;
    entry.counted_at = null;
    session.remaining = [id, ...session.remaining.filter(x => x !== id)];
    session.status = 'in_progress';
    saveInventory(session);
    return true;
  }

  function reopenEntry(session, itemId) {
    const entry = session.entries.find(e => e.item_id === itemId);
    if (!entry) return;
    entry.fact = null;
    entry.counted_at = null;
    session.remaining = [itemId, ...session.remaining.filter(x => x !== itemId)];
    session.counted_order = (session.counted_order || []).filter(x => x !== itemId);
    session.status = 'in_progress';
    saveInventory(session);
  }

  function differences(session) {
    return session.entries.filter(entry => entry.fact !== null && Number(entry.fact) !== Number(entry.system_qty));
  }

  function applyInventory(session) {
    if (session.status !== 'ready') throw new Error('Сначала посчитайте все позиции.');
    const items = read(KEYS.items, []);
    const byId = new Map(items.map(item => [item.id, item]));

    const conflicts = [];
    for (const entry of session.entries) {
      const item = byId.get(entry.item_id);
      if (!item || Number(item.qty || 0) !== Number(entry.system_qty || 0)) conflicts.push({ entry, item });
    }
    if (conflicts.length) {
      for (const { entry, item } of conflicts) {
        entry.system_qty = item ? Number(item.qty || 0) : entry.system_qty;
        entry.fact = null;
        entry.counted_at = null;
      }
      const ids = conflicts.map(x => x.entry.item_id);
      session.remaining = [...ids, ...session.remaining.filter(id => !ids.includes(id))];
      session.status = 'in_progress';
      saveInventory(session);
      return { conflicts: conflicts.length, adjustments: 0 };
    }

    const ops = read(KEYS.ops, []);
    const queue = read(KEYS.queue, []);
    const stamp = now();
    let adjustments = 0;

    for (const entry of session.entries) {
      const item = byId.get(entry.item_id);
      if (!item) continue;
      const previous = Number(item.qty || 0);
      const target = Number(entry.fact);
      if (previous === target) continue;

      item.qty = target;
      item.updated_at = stamp;
      const op = {
        id: uid(),
        item_id: item.id,
        item_name: clean(item.name) || entry.name,
        type: 'adjustment',
        quantity: Math.abs(target - previous),
        target_qty: target,
        reason: 'Инвентаризация',
        comment: `Инвентаризация · ${session.scope_label}`,
        user_name: session.user_name,
        unit: clean(item.unit) || entry.unit,
        previous_qty: previous,
        new_qty: target,
        created_at: stamp
      };
      ops.unshift({ ...op, pending: true });
      queue.unshift({ ...op, kind: 'operation', status: 'pending', pending: true });
      adjustments++;
    }

    write(KEYS.items, items);
    write(KEYS.ops, ops);
    write(KEYS.queue, queue);
    session.status = 'applied';
    session.completed_at = session.completed_at || stamp;
    session.applied_at = stamp;
    session.adjustments_count = adjustments;
    saveInventory(session);
    return { conflicts: 0, adjustments };
  }

  function ensureStyles() {
    if (document.getElementById('kambuz-inventory-styles')) return;
    const style = document.createElement('style');
    style.id = 'kambuz-inventory-styles';
    style.textContent = `
      .ki-overlay{position:fixed;inset:0;z-index:200000;background:#f6f7f5;color:#18322c;font-family:system-ui,-apple-system,sans-serif;overflow:auto;-webkit-overflow-scrolling:touch}
      .ki-wrap{max-width:720px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 14px) 16px calc(env(safe-area-inset-bottom) + 28px)}
      .ki-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.ki-head h2{font-size:25px;margin:0}.ki-x{border:0;background:#e7ece9;width:42px;height:42px;border-radius:14px;font-size:22px}
      .ki-card{background:white;border-radius:22px;padding:18px;box-shadow:0 4px 18px rgba(20,56,47,.06);margin:12px 0}.ki-muted{color:#6b7b75;font-size:13px}.ki-title{font-size:24px;font-weight:800;line-height:1.15;margin:8px 0}.ki-pack{font-size:14px;color:#66766f;margin-bottom:12px}
      .ki-btn{width:100%;border:0;border-radius:17px;padding:15px 16px;font:700 16px system-ui;background:#0b755f;color:white}.ki-btn.secondary{background:#e3f1ec;color:#0b755f}.ki-btn.ghost{background:#eef1ef;color:#41524c}.ki-btn.warn{background:#fff0df;color:#9b5c00}.ki-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ki-stack{display:grid;gap:10px}
      .ki-progress{height:8px;background:#e3e8e5;border-radius:999px;overflow:hidden;margin:8px 0 5px}.ki-progress>i{display:block;height:100%;background:#0b755f;border-radius:999px}
      .ki-count{display:flex;align-items:center;gap:8px;margin:16px 0}.ki-count input{min-width:0;flex:1;border:2px solid #cdd9d4;border-radius:18px;padding:16px;text-align:center;font:800 30px system-ui;background:#fff;color:#18322c}.ki-mini{width:52px;height:58px;border:0;border-radius:17px;background:#e5efeb;color:#0b755f;font-size:25px;font-weight:800}
      .ki-chip{display:inline-flex;padding:7px 10px;border-radius:999px;background:#edf3f0;font-size:12px;color:#52645d;margin:2px 3px 2px 0}.ki-diff{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px 0;border-bottom:1px solid #edf0ee}.ki-diff:last-child{border-bottom:0}.ki-diff b{display:block}.ki-neg{color:#b6423c}.ki-pos{color:#08745d}
      .ki-option{display:flex;align-items:center;gap:12px;padding:13px;border:1px solid #dde5e1;border-radius:16px;margin:8px 0}.ki-option input{width:20px;height:20px}.ki-note{background:#fff7e9;border-radius:16px;padding:13px;color:#7b591c;font-size:13px;line-height:1.4}.ki-success{text-align:center;padding:34px 18px}.ki-success .emoji{font-size:58px}.ki-success h3{font-size:25px;margin:10px 0}
    `;
    document.head.appendChild(style);
  }

  function overlay() {
    ensureStyles();
    let root = document.getElementById('kambuz-inventory-overlay');
    if (!root) {
      root = document.createElement('div');
      root.id = 'kambuz-inventory-overlay';
      root.className = 'ki-overlay';
      document.body.appendChild(root);
    }
    return root;
  }

  function closeOverlay(reload = false) {
    document.getElementById('kambuz-inventory-overlay')?.remove();
    if (reload) location.reload();
  }

  function head(title) {
    return `<div class="ki-head"><h2>${esc(title)}</h2><button class="ki-x" data-ki="close" aria-label="Закрыть">×</button></div>`;
  }

  function renderLauncher() {
    const root = overlay();
    const active = activeInventory();
    const last = inventories().find(x => x.status === 'applied');
    const p = active ? progress(active) : null;
    root.innerHTML = `<div class="ki-wrap">
      ${head('Инвентаризация')}
      ${active ? `<div class="ki-card"><div class="ki-muted">Незавершённая</div><div class="ki-title">${esc(active.scope_label)}</div><div>${p.counted} из ${p.total} посчитано</div><div class="ki-progress"><i style="width:${p.total ? (p.counted / p.total * 100) : 0}%"></i></div><div class="ki-muted">${active.status === 'ready' ? 'Подсчёт закончен — осталось проверить и применить результат.' : `Осталось ${p.remaining}`}</div><div style="height:12px"></div><button class="ki-btn" data-ki="continue">${active.status === 'ready' ? 'Посмотреть результаты' : 'Продолжить'}</button></div>` : ''}
      <div class="ki-card"><div class="ki-title" style="font-size:20px">Новая инвентаризация</div>
        <div class="ki-muted">Что считаем</div>
        ${Object.entries(SCOPE_LABELS).map(([value, label], i) => `<label class="ki-option"><input type="radio" name="ki-scope" value="${value}" ${i === 0 ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
        <label class="ki-option"><input type="checkbox" id="ki-blind" checked><span><b>Слепой подсчёт</b><br><span class="ki-muted">Не показывать остаток из Камбуза во время подсчёта</span></span></label>
        <button class="ki-btn" data-ki="start">Начать</button>
      </div>
      ${last ? `<div class="ki-card"><div class="ki-muted">Последняя завершённая</div><b>${esc(last.scope_label)}</b><div class="ki-muted">${new Date(last.applied_at || last.updated_at).toLocaleString('ru-RU')} · корректировок ${Number(last.adjustments_count || 0)}</div></div>` : ''}
    </div>`;
  }

  function renderCounter(session, note = '') {
    const entry = currentEntry(session);
    if (!entry) {
      session.status = 'ready';
      session.completed_at = session.completed_at || now();
      saveInventory(session);
      renderReview(session);
      return;
    }
    const p = progress(session);
    const root = overlay();
    const percent = p.total ? p.counted / p.total * 100 : 0;
    const preset = entry.fact === null ? '' : String(entry.fact).replace('.', ',');
    root.innerHTML = `<div class="ki-wrap">
      ${head('Инвентаризация')}
      <div class="ki-muted">${p.counted} из ${p.total} · осталось ${p.remaining}</div>
      <div class="ki-progress"><i style="width:${percent}%"></i></div>
      ${note ? `<div class="ki-note" style="margin-top:12px">${esc(note)}</div>` : ''}
      <div class="ki-card">
        <div>${entry.category ? `<span class="ki-chip">${esc(entry.category)}</span>` : ''}${entry.subcategory ? `<span class="ki-chip">${esc(entry.subcategory)}</span>` : ''}</div>
        <div class="ki-title">${esc(entry.name)}</div>
        <div class="ki-pack">${entry.package_label ? `Фасовка: ${esc(entry.package_label)} · ` : ''}Ед. учёта: ${esc(entry.unit)}</div>
        ${session.blind ? `<div class="ki-muted">Остаток в системе скрыт до завершения.</div>` : `<div class="ki-muted">В Камбузе сейчас: <b>${fmt(entry.system_qty)} ${esc(entry.unit)}</b></div>`}
        <div class="ki-count"><button class="ki-mini" data-ki="minus">−</button><input id="ki-fact" type="text" inputmode="decimal" autocomplete="off" placeholder="Факт" value="${esc(preset)}"><button class="ki-mini" data-ki="plus">+</button></div>
        <div class="ki-grid"><button class="ki-btn secondary" data-ki="zero">0 — нет</button><button class="ki-btn" data-ki="count">✓ Посчитано</button></div>
        <div style="height:10px"></div>
        <div class="ki-grid"><button class="ki-btn ghost" data-ki="previous" ${!(session.counted_order || []).length ? 'disabled style="opacity:.45"' : ''}>← Предыдущая</button><button class="ki-btn warn" data-ki="skip">Пропустить →</button></div>
      </div>
      <button class="ki-btn ghost" data-ki="close">Сохранить и продолжить позже</button>
    </div>`;
    setTimeout(() => document.getElementById('ki-fact')?.focus(), 70);
  }

  function renderReview(session, showAll = false) {
    const root = overlay();
    const diffs = differences(session);
    const equal = session.entries.length - diffs.length;
    const shortage = diffs.filter(x => Number(x.fact) < Number(x.system_qty)).length;
    const surplus = diffs.filter(x => Number(x.fact) > Number(x.system_qty)).length;
    const rows = showAll ? session.entries : diffs;
    root.innerHTML = `<div class="ki-wrap">
      ${head('Результат инвентаризации')}
      <div class="ki-card">
        <div class="ki-title" style="font-size:20px">${esc(session.scope_label)}</div>
        <span class="ki-chip">Всего ${session.entries.length}</span><span class="ki-chip">Совпало ${equal}</span><span class="ki-chip">Недостача ${shortage}</span><span class="ki-chip">Излишек ${surplus}</span>
      </div>
      <div class="ki-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b>${showAll ? 'Все позиции' : 'Расхождения'}</b><button class="ki-btn ghost" style="width:auto;padding:9px 12px;font-size:13px" data-ki="toggle-all">${showAll ? 'Только расхождения' : 'Показать все'}</button></div>
        <div style="margin-top:8px">${rows.length ? rows.map(entry => {
          const delta = Number(entry.fact) - Number(entry.system_qty);
          return `<div class="ki-diff"><div><b>${esc(entry.name)}</b><span class="ki-muted">Было ${fmt(entry.system_qty)} → факт ${fmt(entry.fact)} ${esc(entry.unit)}</span></div><div style="text-align:right"><b class="${delta < 0 ? 'ki-neg' : delta > 0 ? 'ki-pos' : ''}">${delta > 0 ? '+' : ''}${fmt(delta)}</b><button data-ki="edit" data-id="${esc(entry.item_id)}" style="border:0;background:none;color:#08745d;padding:5px 0;font-weight:700">Исправить</button></div></div>`;
        }).join('') : '<div class="ki-muted" style="padding:12px 0">Расхождений нет 🎯</div>'}</div>
      </div>
      <div class="ki-note">Остатки пока не изменены. Корректировки появятся только после кнопки «Применить результаты».</div>
      <div style="height:12px"></div><button class="ki-btn" data-ki="apply">✓ Применить результаты${diffs.length ? ` (${diffs.length})` : ''}</button>
      <div style="height:10px"></div><button class="ki-btn ghost" data-ki="review-back">Вернуться к подсчёту</button>
    </div>`;
    root.dataset.showAll = showAll ? '1' : '0';
  }

  function renderSuccess(session, adjustments) {
    const root = overlay();
    root.innerHTML = `<div class="ki-wrap"><div class="ki-card ki-success"><div class="emoji">✅</div><h3>Инвентаризация применена</h3><p>${adjustments ? `Создано корректировок: <b>${adjustments}</b>. Они сохранены локально и попадут в обычную очередь синхронизации.` : 'Расхождений не было — корректировки не нужны.'}</p><button class="ki-btn" data-ki="finish">Вернуться в Камбуз</button></div></div>`;
  }

  function adjustInput(delta) {
    const input = document.getElementById('ki-fact');
    if (!input) return;
    const current = num(input.value);
    input.value = String(Math.max(0, (current ?? 0) + delta)).replace('.', ',');
    input.focus();
  }

  function handleAction(event) {
    const button = event.target.closest('[data-ki]');
    if (!button) return;
    const action = button.dataset.ki;
    if (action === 'close') return closeOverlay();
    if (action === 'start') {
      try {
        const scope = document.querySelector('input[name="ki-scope"]:checked')?.value || 'all';
        const blind = Boolean(document.getElementById('ki-blind')?.checked);
        const session = startInventory(scope, blind);
        renderCounter(session);
      } catch (e) { alert(e?.message || e); }
      return;
    }
    if (action === 'continue') {
      const session = activeInventory();
      if (!session) return renderLauncher();
      return session.status === 'ready' ? renderReview(session) : renderCounter(session);
    }

    const active = activeInventory();
    const session = active || getInventory(localStorage.getItem(KEYS.active));
    if (!session) return renderLauncher();

    if (action === 'minus') return adjustInput(-1);
    if (action === 'plus') return adjustInput(1);
    if (action === 'zero') {
      const input = document.getElementById('ki-fact');
      if (input) input.value = '0';
      return;
    }
    if (action === 'count') {
      try {
        countCurrent(session, document.getElementById('ki-fact')?.value);
        return session.status === 'ready' ? renderReview(session) : renderCounter(session);
      } catch (e) { alert(e?.message || e); }
      return;
    }
    if (action === 'skip') {
      const p = progress(session);
      skipCurrent(session);
      const note = p.remaining === 1 ? 'Это последняя непосчитанная позиция. Она останется здесь, пока вы не введёте количество.' : 'Позиция перенесена в конец. Камбуз обязательно вернёт её позже.';
      return renderCounter(session, note);
    }
    if (action === 'previous') {
      if (previousEntry(session)) return renderCounter(session, 'Предыдущая позиция открыта заново.');
      return;
    }
    if (action === 'edit') {
      reopenEntry(session, button.dataset.id);
      return renderCounter(session, 'Исправьте количество и снова отметьте позицию как посчитанную.');
    }
    if (action === 'toggle-all') return renderReview(session, overlay().dataset.showAll !== '1');
    if (action === 'review-back') {
      const lastId = (session.counted_order || []).at(-1) || session.entries[0]?.item_id;
      if (lastId) reopenEntry(session, lastId);
      return renderCounter(session, 'Последняя позиция открыта для проверки.');
    }
    if (action === 'apply') {
      const diffs = differences(session);
      const ok = confirm(diffs.length ? `Применить ${diffs.length} корректировок к складу?` : 'Расхождений нет. Завершить инвентаризацию?');
      if (!ok) return;
      try {
        const result = applyInventory(session);
        if (result.conflicts) return renderCounter(session, `Во время инвентаризации изменились остатки у ${result.conflicts} поз. Я вернул их на пересчёт, чтобы не затереть более свежие операции.`);
        return renderSuccess(session, result.adjustments);
      } catch (e) { alert(e?.message || e); }
      return;
    }
    if (action === 'finish') return closeOverlay(true);
  }

  function openInventory() {
    renderLauncher();
  }

  function findWorkHeading() {
    return [...document.querySelectorAll('#app h1,#app h2,#app h3,#app h4,#app div,#app span')]
      .find(el => clean(el.textContent) === 'Рабочие действия');
  }

  function installButton() {
    if (document.getElementById('inventory-button')) return;
    const heading = findWorkHeading();
    if (!heading || !heading.parentElement) return;
    const active = activeInventory();
    const p = active ? progress(active) : null;
    const btn = document.createElement('button');
    btn.id = 'inventory-button';
    btn.type = 'button';
    btn.innerHTML = `<span style="font-size:24px;line-height:1">📋</span><span><b style="display:block;font-size:18px">Инвентаризация</b><small style="display:block;margin-top:3px;opacity:.7;font-size:13px">${active ? `${p.counted}/${p.total} · ${active.status === 'ready' ? 'проверить результаты' : 'продолжить подсчёт'}` : 'Пошаговый пересчёт склада'}</small></span>`;
    Object.assign(btn.style, {
      width: '100%', margin: '0 0 16px', border: '0', borderRadius: '22px', padding: '18px 20px',
      background: '#e9f0ff', color: '#305b9a', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '14px',
      font: 'inherit', boxSizing: 'border-box', boxShadow: 'none'
    });
    btn.addEventListener('click', openInventory);
    const receipt = document.getElementById('receipt-json-import-button');
    if (receipt?.parentElement === heading.parentElement) receipt.insertAdjacentElement('afterend', btn);
    else heading.insertAdjacentElement('afterend', btn);
  }

  function refreshButton() {
    const old = document.getElementById('inventory-button');
    if (old) old.remove();
    installButton();
  }

  function start() {
    ensureStyles();
    document.addEventListener('click', handleAction);
    installButton();
    const app = document.getElementById('app');
    if (app) {
      let timer = null;
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(installButton, 50);
      }).observe(app, { childList: true, subtree: true });
    }
    window.addEventListener('storage', refreshButton);
  }

  window.KAMBUZ_INVENTORY = { version: VERSION, open: openInventory, active: activeInventory };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();