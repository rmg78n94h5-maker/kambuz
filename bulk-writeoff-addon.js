(() => {
  'use strict';

  const VERSION = '1.6.0';
  const KEYS = {
    items: 'kambuz_items',
    ops: 'kambuz_ops',
    queue: 'kambuz_pending_ops',
    draft: 'kambuz_bulk_writeoff_draft'
  };
  const REASONS = ['Брак','Повреждение','Протечка','Разбилось','Просрочено','Потеряно','Выброшено','Ошибка поставки','Другое'];

  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = () => new Date().toISOString();
  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const fmt = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const num = value => {
    if (value === '' || value == null) return 0;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };

  let draft = null;

  function defaultDraft() {
    return { mode: 'consumption', filter: 'all', query: '', reason: REASONS[0], comment: '', amounts: {} };
  }

  function loadDraft() {
    const saved = read(KEYS.draft, null);
    draft = saved && typeof saved === 'object' ? { ...defaultDraft(), ...saved, amounts: saved.amounts || {} } : defaultDraft();
    return draft;
  }

  function saveDraft() {
    if (draft) write(KEYS.draft, draft);
  }

  function clearDraft() {
    localStorage.removeItem(KEYS.draft);
    draft = defaultDraft();
  }

  function items() {
    const value = read(KEYS.items, []);
    return Array.isArray(value) ? value : [];
  }

  function categoryFamily(item) {
    const c = norm(item.category);
    if (c === 'химия') return 'chem';
    if (['хозтовары','посуда','инвентарь'].includes(c)) return 'household';
    return 'products';
  }

  function visibleItems() {
    const q = norm(draft.query);
    return items()
      .filter(item => Number(item.qty || 0) > 0)
      .filter(item => draft.filter === 'all' || categoryFamily(item) === draft.filter)
      .filter(item => !q || norm(`${item.name} ${item.brand || ''} ${item.subcategory || ''}`).includes(q))
      .sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
  }

  function selectedLines() {
    const map = new Map(items().map(item => [item.id, item]));
    return Object.entries(draft.amounts || {})
      .map(([id, raw]) => ({ item: map.get(id), qty: num(raw) }))
      .filter(line => line.item && Number.isFinite(line.qty) && line.qty > 0);
  }

  function validateLines() {
    const lines = selectedLines();
    if (!lines.length) throw new Error('Не указано количество ни у одной позиции.');
    for (const line of lines) {
      const stock = Number(line.item.qty || 0);
      if (line.qty > stock) throw new Error(`«${line.item.name}»: нельзя списать ${fmt(line.qty)}, на складе ${fmt(stock)} ${line.item.unit || ''}.`);
    }
    if (draft.mode === 'writeoff' && !clean(draft.reason)) throw new Error('Выбери причину списания.');
    return lines;
  }

  function ensureStyles() {
    if (document.getElementById('bulk-writeoff-styles')) return;
    const style = document.createElement('style');
    style.id = 'bulk-writeoff-styles';
    style.textContent = `
      .bw-overlay{position:fixed;inset:0;z-index:150000;background:#f6f8f7;color:#17352e;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column}
      .bw-head{padding:calc(env(safe-area-inset-top) + 12px) 16px 10px;background:#fff;border-bottom:1px solid #e5ece9;flex:0 0 auto}
      .bw-top{display:flex;align-items:center;gap:10px}.bw-title{font-size:22px;font-weight:800;flex:1}.bw-close{border:0;background:#eef3f1;border-radius:12px;width:42px;height:42px;font-size:20px;color:#24483f}
      .bw-seg{display:grid;grid-template-columns:1fr 1fr;background:#edf2f0;border-radius:14px;padding:3px;margin-top:12px}.bw-seg button{border:0;background:transparent;padding:10px 8px;border-radius:11px;font:700 14px system-ui;color:#5b716b}.bw-seg button.on{background:#fff;color:#0b725d;box-shadow:0 1px 4px rgba(0,0,0,.08)}
      .bw-tools{padding:12px 16px 8px;background:#f6f8f7;flex:0 0 auto}.bw-search{width:100%;border:1px solid #d9e3df;background:#fff;border-radius:15px;padding:13px 14px;font:16px system-ui;box-sizing:border-box;outline:none}.bw-chips{display:flex;gap:7px;overflow:auto;padding-top:9px;scrollbar-width:none}.bw-chips::-webkit-scrollbar{display:none}.bw-chip{white-space:nowrap;border:1px solid #d9e3df;background:#fff;border-radius:999px;padding:8px 11px;font:650 13px system-ui;color:#506961}.bw-chip.on{background:#dff4ec;border-color:#bfe7d8;color:#08745d}
      .bw-list{flex:1 1 auto;overflow:auto;padding:4px 16px 180px}.bw-row{background:#fff;border:1px solid #e1e9e6;border-radius:17px;padding:13px 13px;margin:8px 0}.bw-row.selected{border-color:#9ddac7;background:#fbfffd}.bw-row.bad{border-color:#e8a7a7;background:#fffafa}.bw-row-top{display:flex;gap:10px;align-items:flex-start}.bw-name{font-weight:750;font-size:15px;line-height:1.25;flex:1}.bw-stock{font-size:12px;color:#71827d;margin-top:4px}.bw-controls{display:grid;grid-template-columns:42px minmax(72px,100px) 42px;gap:7px;justify-content:end;align-items:center;margin-top:10px}.bw-step{height:40px;border:0;border-radius:12px;background:#edf3f0;font-size:22px;color:#245a4c}.bw-qty{height:40px;border:1px solid #cfddd8;border-radius:12px;text-align:center;font:750 16px system-ui;width:100%;box-sizing:border-box}.bw-unit{font-size:12px;color:#71827d;text-align:right;margin-top:4px}.bw-empty{text-align:center;color:#71827d;padding:40px 15px}
      .bw-extra{padding:0 16px 10px;flex:0 0 auto}.bw-extra-card{background:#fff;border:1px solid #e1e9e6;border-radius:16px;padding:12px}.bw-label{font-size:12px;color:#71827d;margin:0 0 6px}.bw-select,.bw-comment{width:100%;box-sizing:border-box;border:1px solid #d5e0dc;border-radius:12px;background:#fff;padding:11px 12px;font:15px system-ui}.bw-comment{margin-top:8px;resize:none;min-height:44px}
      .bw-foot{position:absolute;left:0;right:0;bottom:0;padding:10px 16px calc(env(safe-area-inset-bottom) + 12px);background:rgba(255,255,255,.96);border-top:1px solid #e1e9e6;backdrop-filter:blur(12px)}.bw-summary{font-size:13px;color:#647a73;margin-bottom:8px;display:flex;justify-content:space-between;gap:10px}.bw-submit{width:100%;border:0;border-radius:16px;padding:15px 16px;background:#0b7a62;color:#fff;font:800 16px system-ui}.bw-submit:disabled{opacity:.45}.bw-clear{width:100%;border:0;background:transparent;color:#7a8d87;font:650 13px system-ui;padding:9px 0 0}.bw-toast{position:fixed;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom) + 92px);z-index:160000;padding:14px 16px;border-radius:16px;background:#173d34;color:#fff;font:650 14px system-ui;box-shadow:0 10px 30px rgba(0,0,0,.25)}
      @media(min-width:700px){.bw-overlay{left:50%;transform:translateX(-50%);max-width:720px;box-shadow:0 0 60px rgba(0,0,0,.15)}}
    `;
    document.head.appendChild(style);
  }

  function renderRows() {
    const list = document.querySelector('.bw-list');
    if (!list) return;
    const rows = visibleItems();
    if (!rows.length) {
      list.innerHTML = '<div class="bw-empty">Ничего не найдено</div>';
      return;
    }
    list.innerHTML = rows.map(item => {
      const raw = draft.amounts[item.id] ?? '';
      const q = num(raw);
      const stock = Number(item.qty || 0);
      const selected = Number.isFinite(q) && q > 0;
      const bad = selected && q > stock;
      return `<div class="bw-row${selected ? ' selected' : ''}${bad ? ' bad' : ''}" data-row-id="${esc(item.id)}">
        <div class="bw-row-top">
          <div style="flex:1;min-width:0">
            <div class="bw-name">${esc(item.name)}</div>
            <div class="bw-stock">Остаток: <b>${fmt(stock)} ${esc(item.unit || '')}</b>${item.volume && item.package_unit ? ` · фасовка ${fmt(item.volume)} ${esc(item.package_unit)}` : ''}</div>
          </div>
        </div>
        <div class="bw-controls">
          <button class="bw-step" type="button" data-bw-step="-1" data-id="${esc(item.id)}">−</button>
          <input class="bw-qty" inputmode="decimal" type="text" placeholder="0" value="${esc(raw)}" data-bw-qty="${esc(item.id)}" aria-label="Количество ${esc(item.name)}">
          <button class="bw-step" type="button" data-bw-step="1" data-id="${esc(item.id)}">+</button>
        </div>
        <div class="bw-unit">списать ${esc(item.unit || '')}</div>
      </div>`;
    }).join('');
  }

  function updateSummary() {
    const lines = selectedLines();
    const count = lines.length;
    const sum = lines.reduce((acc, x) => acc + x.qty, 0);
    const countEl = document.querySelector('.bw-summary-count');
    const sumEl = document.querySelector('.bw-summary-sum');
    const submit = document.querySelector('.bw-submit');
    if (countEl) countEl.textContent = `${count} поз.`;
    if (sumEl) sumEl.textContent = count ? `введено ${fmt(sum)}` : 'ничего не выбрано';
    if (submit) {
      submit.disabled = !count;
      submit.textContent = draft.mode === 'writeoff' ? `Списать ${count || ''} ${count ? 'поз.' : ''}`.trim() : `Провести расход ${count || ''} ${count ? 'поз.' : ''}`.trim();
    }
  }

  function renderModeExtras() {
    const box = document.querySelector('.bw-extra');
    if (!box) return;
    box.innerHTML = `<div class="bw-extra-card">
      ${draft.mode === 'writeoff' ? `<div class="bw-label">Причина списания</div><select class="bw-select" data-bw-reason>${REASONS.map(r => `<option${r === draft.reason ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>` : ''}
      <textarea class="bw-comment" data-bw-comment placeholder="Комментарий (необязательно)">${esc(draft.comment || '')}</textarea>
    </div>`;
  }

  function renderModeButtons() {
    document.querySelectorAll('[data-bw-mode]').forEach(btn => btn.classList.toggle('on', btn.dataset.bwMode === draft.mode));
    renderModeExtras();
    updateSummary();
  }

  function renderFilters() {
    document.querySelectorAll('[data-bw-filter]').forEach(btn => btn.classList.toggle('on', btn.dataset.bwFilter === draft.filter));
  }

  function openBulk() {
    if (document.getElementById('bulk-writeoff-overlay')) return;
    ensureStyles();
    loadDraft();
    const overlay = document.createElement('div');
    overlay.id = 'bulk-writeoff-overlay';
    overlay.className = 'bw-overlay';
    overlay.innerHTML = `
      <div class="bw-head">
        <div class="bw-top"><div class="bw-title">Массовое списание</div><button class="bw-close" type="button" data-bw-close>×</button></div>
        <div class="bw-seg">
          <button type="button" data-bw-mode="consumption">Обычный расход</button>
          <button type="button" data-bw-mode="writeoff">Списание / брак</button>
        </div>
      </div>
      <div class="bw-tools">
        <input class="bw-search" type="search" placeholder="Найти товар…" value="${esc(draft.query || '')}" data-bw-search>
        <div class="bw-chips">
          <button class="bw-chip" type="button" data-bw-filter="all">Всё</button>
          <button class="bw-chip" type="button" data-bw-filter="products">Продукты</button>
          <button class="bw-chip" type="button" data-bw-filter="chem">Химия</button>
          <button class="bw-chip" type="button" data-bw-filter="household">Хозтовары</button>
        </div>
      </div>
      <div class="bw-extra"></div>
      <div class="bw-list"></div>
      <div class="bw-foot">
        <div class="bw-summary"><span class="bw-summary-count">0 поз.</span><span class="bw-summary-sum">ничего не выбрано</span></div>
        <button class="bw-submit" type="button" data-bw-submit disabled>Провести расход</button>
        <button class="bw-clear" type="button" data-bw-clear>Очистить введённые количества</button>
      </div>`;
    document.body.appendChild(overlay);
    renderModeButtons();
    renderFilters();
    renderRows();
    updateSummary();
    setTimeout(() => overlay.querySelector('[data-bw-search]')?.focus(), 50);
  }

  function closeBulk() {
    saveDraft();
    document.getElementById('bulk-writeoff-overlay')?.remove();
  }

  function changeAmount(id, delta) {
    const current = num(draft.amounts[id] ?? 0);
    const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
    draft.amounts[id] = next === 0 ? '' : String(next);
    saveDraft();
    renderRows();
    updateSummary();
  }

  function toast(message) {
    document.querySelector('.bw-toast')?.remove();
    const el = document.createElement('div');
    el.className = 'bw-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function commitBulk() {
    let lines;
    try { lines = validateLines(); }
    catch (e) { return alert(e.message || String(e)); }

    const modeLabel = draft.mode === 'writeoff' ? 'списание' : 'расход';
    const preview = lines.slice(0, 6).map(x => `• ${x.item.name}: ${fmt(x.qty)} ${x.item.unit || ''}`).join('\n');
    const more = lines.length > 6 ? `\n…и ещё ${lines.length - 6}` : '';
    const ok = confirm(`Провести ${modeLabel} по ${lines.length} позициям?\n\n${preview}${more}\n\nОстатки изменятся сразу на этом устройстве и синхронизируются с облаком позже.`);
    if (!ok) return;

    const allItems = items();
    const ops = read(KEYS.ops, []);
    const queue = read(KEYS.queue, []);
    const itemMap = new Map(allItems.map(item => [item.id, item]));
    const user = localStorage.getItem('kambuz_user') || 'Пользователь';
    const batchId = uid();
    const stamp = now();

    for (const line of lines) {
      const item = itemMap.get(line.item.id);
      if (!item) continue;
      const previous = Number(item.qty || 0);
      const next = previous - line.qty;
      if (next < 0) return alert(`Остаток «${item.name}» изменился. Открой массовое списание заново.`);

      item.qty = next;
      item.updated_at = stamp;
      const op = {
        id: uid(),
        item_id: item.id,
        item_name: item.name,
        type: draft.mode,
        quantity: line.qty,
        reason: draft.mode === 'writeoff' ? draft.reason : null,
        comment: clean(draft.comment) || (draft.mode === 'writeoff' ? 'Массовое списание' : 'Массовый расход'),
        user_name: user,
        unit: item.unit || '',
        previous_qty: previous,
        new_qty: next,
        created_at: now(),
        batch_id: batchId,
        pending: true
      };
      ops.unshift(op);
      queue.push({ ...op, kind: 'operation', status: 'pending', error: null });
    }

    write(KEYS.items, allItems);
    write(KEYS.ops, ops);
    write(KEYS.queue, queue);
    clearDraft();
    document.getElementById('bulk-writeoff-overlay')?.remove();
    toast(`Готово: ${lines.length} поз. · ${draft.mode === 'writeoff' ? 'списание' : 'расход'} сохранён${draft.mode === 'writeoff' ? 'о' : ''} · ждёт синхронизации`);
    setTimeout(() => location.reload(), 700);
  }

  function handleClick(event) {
    const close = event.target.closest('[data-bw-close]');
    if (close) return closeBulk();

    const mode = event.target.closest('[data-bw-mode]');
    if (mode) {
      draft.mode = mode.dataset.bwMode;
      saveDraft();
      renderModeButtons();
      return;
    }

    const filter = event.target.closest('[data-bw-filter]');
    if (filter) {
      draft.filter = filter.dataset.bwFilter;
      saveDraft();
      renderFilters();
      renderRows();
      return;
    }

    const step = event.target.closest('[data-bw-step]');
    if (step) return changeAmount(step.dataset.id, Number(step.dataset.bwStep || 0));

    if (event.target.closest('[data-bw-clear]')) {
      if (!selectedLines().length || confirm('Очистить все введённые количества?')) {
        draft.amounts = {};
        saveDraft();
        renderRows();
        updateSummary();
      }
      return;
    }

    if (event.target.closest('[data-bw-submit]')) return commitBulk();
  }

  function handleInput(event) {
    if (event.target.matches('[data-bw-search]')) {
      draft.query = event.target.value;
      saveDraft();
      renderRows();
      return;
    }
    if (event.target.matches('[data-bw-qty]')) {
      draft.amounts[event.target.dataset.bwQty] = event.target.value;
      saveDraft();
      const row = event.target.closest('.bw-row');
      const item = items().find(x => x.id === event.target.dataset.bwQty);
      const q = num(event.target.value);
      if (row && item) {
        row.classList.toggle('selected', Number.isFinite(q) && q > 0);
        row.classList.toggle('bad', Number.isFinite(q) && q > Number(item.qty || 0));
      }
      updateSummary();
      return;
    }
    if (event.target.matches('[data-bw-comment]')) {
      draft.comment = event.target.value;
      saveDraft();
    }
  }

  function handleChange(event) {
    if (event.target.matches('[data-bw-reason]')) {
      draft.reason = event.target.value;
      saveDraft();
    }
  }

  function findWorkHeading() {
    return [...document.querySelectorAll('#app h1,#app h2,#app h3,#app h4,#app div,#app span')]
      .find(el => (el.textContent || '').trim() === 'Рабочие действия');
  }

  function installButton() {
    if (document.getElementById('bulk-writeoff-button')) return;
    const heading = findWorkHeading();
    if (!heading?.parentElement) return;
    const btn = document.createElement('button');
    btn.id = 'bulk-writeoff-button';
    btn.type = 'button';
    btn.innerHTML = '<span style="font-size:24px;line-height:1">⚡</span><span><b style="display:block;font-size:18px">Массовое списание</b><small style="display:block;margin-top:3px;opacity:.7;font-size:13px">Несколько товаров за один проход</small></span>';
    Object.assign(btn.style, {
      width:'100%',margin:'12px 0 16px',border:'0',borderRadius:'22px',padding:'18px 20px',
      background:'#fff0dd',color:'#915509',textAlign:'left',display:'flex',alignItems:'center',gap:'14px',
      font:'inherit',boxSizing:'border-box',boxShadow:'none'
    });
    btn.addEventListener('click', openBulk);
    heading.insertAdjacentElement('afterend', btn);
  }

  function start() {
    ensureStyles();
    document.addEventListener('click', handleClick);
    document.addEventListener('input', handleInput);
    document.addEventListener('change', handleChange);
    installButton();
    const app = document.getElementById('app');
    if (app) {
      let timer = null;
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(installButton, 70);
      }).observe(app, { childList:true, subtree:true });
    }
  }

  window.KAMBUZ_BULK_WRITEOFF = { version: VERSION, open: openBulk };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
