(() => {
  'use strict';

  const VERSION = '1.5.0';
  const KEYS = {
    items: 'kambuz_items',
    ops: 'kambuz_ops',
    queue: 'kambuz_pending_ops',
    ignored: 'kambuz_duplicate_ignored_pairs'
  };

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,;:()\[\]{}]/g, ' ')
    .replace(/[×xх]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
  const fmt = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const read = (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  let sb = null;
  let cloudPromise = null;
  let sessionLater = new Set();
  let busy = false;

  function items() {
    const value = read(KEYS.items, []);
    return Array.isArray(value) ? value : [];
  }

  function queue() {
    const value = read(KEYS.queue, []);
    return Array.isArray(value) ? value : [];
  }

  function ignoredPairs() {
    const value = read(KEYS.ignored, []);
    return new Set(Array.isArray(value) ? value : []);
  }

  function pairKey(a, b) {
    return [String(a), String(b)].sort().join('::');
  }

  function canonicalName(value) {
    const fn = window.KAMBUZ_RECEIPT_IMPORT?.canonicalDisplayName;
    if (typeof fn === 'function') {
      try { return clean(fn(value)) || clean(value); }
      catch (_) {}
    }
    return clean(value);
  }

  function canonicalKey(value) {
    return norm(canonicalName(value));
  }

  function normalizedUnit(value) {
    return norm(value).replace(/\.$/, '');
  }

  function barcode(value) {
    return clean(value).replace(/\D/g, '');
  }

  function categoryFamily(item) {
    const c = norm(item?.category);
    if (c === 'химия') return 'chem';
    if (['хозтовары', 'посуда', 'инвентарь'].includes(c)) return 'household';
    return 'products';
  }

  function packageBase(item) {
    const value = Number(item?.volume ?? item?.weight ?? 0);
    const unit = norm(item?.package_unit);
    if (!(value > 0) || !unit) return null;
    if (['г', 'гр', 'g'].includes(unit)) return { kind: 'mass', value };
    if (['кг', 'kg'].includes(unit)) return { kind: 'mass', value: value * 1000 };
    if (['мл', 'ml'].includes(unit)) return { kind: 'volume', value };
    if (['л', 'l'].includes(unit)) return { kind: 'volume', value: value * 1000 };
    return { kind: `raw:${unit}`, value };
  }

  function packageCompatible(a, b) {
    const pa = packageBase(a);
    const pb = packageBase(b);
    if (!pa || !pb) return true;
    return pa.kind === pb.kind && Math.abs(pa.value - pb.value) < 0.001;
  }

  function barcodeCompatible(a, b) {
    const ba = barcode(a?.barcode);
    const bb = barcode(b?.barcode);
    return !ba || !bb || ba === bb;
  }

  function unitCompatible(a, b) {
    return normalizedUnit(a?.unit) === normalizedUnit(b?.unit);
  }

  function categoryCompatible(a, b) {
    return categoryFamily(a) === categoryFamily(b);
  }

  function tokenSet(value) {
    return new Set(norm(value).split(' ').filter(x => x.length > 1));
  }

  function jaccard(a, b) {
    const A = tokenSet(a), B = tokenSet(b);
    if (!A.size || !B.size) return 0;
    let intersection = 0;
    for (const token of A) if (B.has(token)) intersection++;
    return intersection / (A.size + B.size - intersection);
  }

  function levenshtein(a, b) {
    a = norm(a); b = norm(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    const cur = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          cur[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  function textSimilarity(a, b) {
    const A = norm(a), B = norm(b);
    const max = Math.max(A.length, B.length);
    return max ? 1 - levenshtein(A, B) / max : 1;
  }

  function candidateReason(a, b) {
    const ba = barcode(a.barcode), bb = barcode(b.barcode);
    if (ba && bb && ba === bb) return { score: 130, reason: 'Одинаковый штрихкод' };

    const na = norm(a.name), nb = norm(b.name);
    if (na && na === nb) return { score: 120, reason: 'Одинаковое название' };

    const ca = canonicalKey(a.name), cb = canonicalKey(b.name);
    if (ca && ca === cb) return { score: 110, reason: 'Одна каноническая позиция' };

    const sim = textSimilarity(a.name, b.name);
    if (Math.min(na.length, nb.length) >= 6 && sim >= 0.88) {
      return { score: 80 + Math.round(sim * 10), reason: 'Очень похожие названия' };
    }

    const jac = jaccard(a.name, b.name);
    if (jac >= 0.75) return { score: 70 + Math.round(jac * 10), reason: 'Похожие слова в названии' };
    return null;
  }

  function findCandidates() {
    const list = items();
    const ignored = ignoredPairs();
    const result = [];

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const key = pairKey(a.id, b.id);
        if (ignored.has(key)) continue;
        if (!a?.id || !b?.id) continue;
        if (!unitCompatible(a, b)) continue;
        if (!categoryCompatible(a, b)) continue;
        if (!packageCompatible(a, b)) continue;
        if (!barcodeCompatible(a, b)) continue;
        const reason = candidateReason(a, b);
        if (!reason) continue;
        result.push({ key, a, b, ...reason });
      }
    }

    return result.sort((x, y) => y.score - x.score || clean(x.a.name).localeCompare(clean(y.a.name), 'ru'));
  }

  function preferredItem(a, b) {
    const ca = canonicalName(a.name), cb = canonicalName(b.name);
    const aCanonical = norm(a.name) === norm(ca);
    const bCanonical = norm(b.name) === norm(cb);
    if (aCanonical !== bCanonical) return aCanonical ? a : b;

    const aMeta = [a.barcode, a.brand, a.subcategory, a.volume, a.package_unit].filter(x => clean(x)).length;
    const bMeta = [b.barcode, b.brand, b.subcategory, b.volume, b.package_unit].filter(x => clean(x)).length;
    if (aMeta !== bMeta) return aMeta > bMeta ? a : b;
    return clean(a.name).length <= clean(b.name).length ? a : b;
  }

  function packLabel(item) {
    const value = Number(item.volume ?? item.weight ?? 0);
    return value > 0 && clean(item.package_unit) ? `${fmt(value)} ${clean(item.package_unit)}` : 'не указана';
  }

  function metadataWarnings(a, b) {
    const warnings = [];
    if (clean(a.brand) && clean(b.brand) && norm(a.brand) !== norm(b.brand)) warnings.push('бренды различаются');
    const ba = barcode(a.barcode), bb = barcode(b.barcode);
    if (ba && bb && ba !== bb) warnings.push('штрихкоды различаются');
    return warnings;
  }

  function ensureStyles() {
    if (document.getElementById('duplicate-cleanup-styles')) return;
    const style = document.createElement('style');
    style.id = 'duplicate-cleanup-styles';
    style.textContent = `
      .dup-overlay{position:fixed;inset:0;z-index:120000;background:rgba(10,28,23,.48);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;padding:0}
      .dup-sheet{width:min(680px,100%);max-height:92vh;overflow:auto;background:#f8fbfa;border-radius:26px 26px 0 0;padding:20px 18px calc(22px + env(safe-area-inset-bottom));box-shadow:0 -18px 60px rgba(0,0,0,.2);font-family:system-ui;color:#17352d}
      .dup-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}
      .dup-head h2{font-size:23px;margin:0}.dup-head p{margin:5px 0 0;color:#6d7f79;font-size:13px;line-height:1.35}
      .dup-close{border:0;background:#e7efec;width:38px;height:38px;border-radius:50%;font-size:20px;color:#29483f}
      .dup-reason{display:inline-block;padding:7px 10px;border-radius:999px;background:#e6f3ef;color:#0a735d;font-size:12px;font-weight:700;margin-bottom:12px}
      .dup-card{background:#fff;border:1px solid #e1ebe7;border-radius:20px;padding:15px;margin:10px 0}
      .dup-card.suggested{border-color:#66bca7;box-shadow:0 0 0 2px rgba(102,188,167,.13)}
      .dup-card-title{font-size:18px;font-weight:800;line-height:1.2}.dup-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;margin-top:10px;color:#65766f;font-size:13px}.dup-meta b{color:#233f37}
      .dup-total{background:#edf7f3;border-radius:17px;padding:13px 14px;margin:14px 0;font-size:14px}.dup-total strong{font-size:19px}
      .dup-warning{background:#fff4df;color:#7b5510;border-radius:14px;padding:10px 12px;margin:10px 0;font-size:13px}
      .dup-actions{display:grid;gap:9px;margin-top:14px}.dup-primary{border:0;border-radius:17px;padding:14px 15px;background:#0b7b63;color:white;font:700 15px system-ui;text-align:left}.dup-primary.alt{background:#285c50}.dup-secondary-row{display:grid;grid-template-columns:1fr 1fr;gap:9px}.dup-secondary{border:1px solid #d8e4df;border-radius:15px;padding:12px;background:#fff;color:#315148;font:650 14px system-ui}.dup-empty{text-align:center;padding:30px 8px 20px}.dup-empty .icon{font-size:46px}.dup-empty h3{margin:10px 0 6px;font-size:20px}.dup-empty p{margin:0;color:#6c7c76;line-height:1.45}
      .dup-busy{opacity:.65;pointer-events:none}
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById('duplicate-cleanup-overlay')?.remove();
  }

  function availableCandidates() {
    return findCandidates().filter(x => !sessionLater.has(x.key));
  }

  function renderEmpty(message = 'Явных дублей больше не найдено.') {
    ensureStyles();
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'duplicate-cleanup-overlay';
    overlay.className = 'dup-overlay';
    overlay.innerHTML = `<div class="dup-sheet"><div class="dup-head"><div><h2>Дубли в базе</h2><p>Проверка завершена</p></div><button class="dup-close" data-dup-action="close">×</button></div><div class="dup-empty"><div class="icon">✨</div><h3>Чисто</h3><p>${esc(message)}</p></div></div>`;
    document.body.appendChild(overlay);
  }

  function renderCandidate(candidate) {
    ensureStyles();
    closeModal();
    const all = findCandidates();
    const remaining = availableCandidates();
    const preferred = preferredItem(candidate.a, candidate.b);
    const warnings = metadataWarnings(candidate.a, candidate.b);
    const total = Number(candidate.a.qty || 0) + Number(candidate.b.qty || 0);

    const card = item => `
      <div class="dup-card ${item.id === preferred.id ? 'suggested' : ''}">
        <div class="dup-card-title">${esc(item.name || 'Без названия')}</div>
        ${item.id === preferred.id ? '<div style="font-size:12px;color:#0a765e;font-weight:700;margin-top:5px">Рекомендуется оставить</div>' : ''}
        <div class="dup-meta">
          <div>Остаток<br><b>${fmt(item.qty)} ${esc(item.unit || '')}</b></div>
          <div>Категория<br><b>${esc(item.category || '—')}</b></div>
          <div>Фасовка<br><b>${esc(packLabel(item))}</b></div>
          <div>Бренд<br><b>${esc(item.brand || '—')}</b></div>
        </div>
      </div>`;

    const overlay = document.createElement('div');
    overlay.id = 'duplicate-cleanup-overlay';
    overlay.className = 'dup-overlay';
    overlay.innerHTML = `
      <div class="dup-sheet">
        <div class="dup-head">
          <div><h2>Возможный дубль</h2><p>Осталось проверить: ${remaining.length} · всего найдено: ${all.length}</p></div>
          <button class="dup-close" data-dup-action="close">×</button>
        </div>
        <div class="dup-reason">${esc(candidate.reason)}</div>
        ${card(candidate.a)}
        ${card(candidate.b)}
        <div class="dup-total">После объединения общий остаток: <strong>${fmt(total)} ${esc(candidate.a.unit || '')}</strong><br><span style="color:#697b75">Вся история обеих карточек сохранится у основной позиции.</span></div>
        ${warnings.length ? `<div class="dup-warning">⚠️ ${esc(warnings.join(' · '))}. Проверь перед объединением.</div>` : ''}
        <div class="dup-actions">
          <button class="dup-primary" data-dup-action="merge" data-target="${esc(candidate.a.id)}" data-source="${esc(candidate.b.id)}">Оставить «${esc(candidate.a.name)}» · объединить</button>
          <button class="dup-primary alt" data-dup-action="merge" data-target="${esc(candidate.b.id)}" data-source="${esc(candidate.a.id)}">Оставить «${esc(candidate.b.name)}» · объединить</button>
          <div class="dup-secondary-row">
            <button class="dup-secondary" data-dup-action="ignore" data-key="${esc(candidate.key)}">Не дубль</button>
            <button class="dup-secondary" data-dup-action="later" data-key="${esc(candidate.key)}">Позже</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  function openDuplicates(resetLater = true) {
    if (resetLater) sessionLater = new Set();
    const candidates = availableCandidates();
    if (!candidates.length) {
      const total = findCandidates().length;
      renderEmpty(total ? 'На этот проход все оставшиеся пары отложены. Открой проверку ещё раз, чтобы вернуться к ним.' : 'Явных дублей больше не найдено.');
      return;
    }
    renderCandidate(candidates[0]);
  }

  function markIgnored(key) {
    const ignored = ignoredPairs();
    ignored.add(key);
    write(KEYS.ignored, [...ignored]);
    refreshButton();
    openDuplicates(false);
  }

  function markLater(key) {
    sessionLater.add(key);
    openDuplicates(false);
  }

  function loadSupabaseLibrary() {
    if (window.supabase) return Promise.resolve(window.supabase);
    if (cloudPromise) return cloudPromise;
    cloudPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        cloudPromise = null;
        reject(new Error('Не удалось загрузить модуль облака'));
      }, 8000);
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.onload = () => {
        clearTimeout(timer);
        if (window.supabase) resolve(window.supabase);
        else { cloudPromise = null; reject(new Error('Модуль облака не запустился')); }
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        cloudPromise = null;
        reject(new Error('Модуль облака недоступен'));
      };
      document.head.appendChild(script);
    });
    return cloudPromise;
  }

  async function ensureCloud() {
    if (sb) return sb;
    const cfg = window.KAMBUZ_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error('Облако не настроено');
    if (!navigator.onLine) throw new Error('Для объединения дублей нужен интернет');
    const lib = await loadSupabaseLibrary();
    sb = lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return sb;
  }

  async function refreshLocalFromCloud(client) {
    const [{ data: cloudItems, error: itemError }, { data: cloudOps, error: opError }] = await Promise.all([
      client.from('items').select('*').order('name'),
      client.from('operations').select('*').order('created_at', { ascending: false }).limit(1000)
    ]);
    if (itemError || opError) throw itemError || opError;
    write(KEYS.items, cloudItems || []);
    write(KEYS.ops, cloudOps || []);
  }

  function pruneIgnored(sourceId) {
    const ignored = [...ignoredPairs()].filter(key => !key.split('::').includes(String(sourceId)));
    write(KEYS.ignored, ignored);
  }

  function toast(message) {
    const old = document.getElementById('duplicate-cleanup-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'duplicate-cleanup-toast';
    el.textContent = message;
    Object.assign(el.style, {
      position: 'fixed', left: '16px', right: '16px', bottom: 'calc(env(safe-area-inset-bottom) + 92px)',
      zIndex: '130000', padding: '14px 16px', borderRadius: '16px', background: '#173d34', color: '#fff',
      font: '650 14px system-ui', boxShadow: '0 10px 30px rgba(0,0,0,.25)'
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function mergeItems(targetId, sourceId) {
    if (busy) return;
    const list = items();
    const target = list.find(x => x.id === targetId);
    const source = list.find(x => x.id === sourceId);
    if (!target || !source) return alert('Одна из карточек уже изменилась. Открой проверку заново.');

    const q = queue();
    if (q.length) {
      return alert(`Сначала дождись синхронизации очереди (${q.length}). Объединение дублей выполняется только на полностью синхронизированной базе.`);
    }
    if (!navigator.onLine) return alert('Для объединения дублей нужен интернет. Проверять пары можно офлайн, объединять — только онлайн.');

    const total = Number(target.qty || 0) + Number(source.qty || 0);
    const ok = confirm(
      `Объединить карточки?\n\nОсновная: ${target.name}\nУдалится как дубль: ${source.name}\n\nОстаток станет: ${fmt(total)} ${target.unit || ''}\n\nИстория операций обеих карточек будет сохранена.`
    );
    if (!ok) return;

    busy = true;
    document.getElementById('duplicate-cleanup-overlay')?.classList.add('dup-busy');
    try {
      const client = await ensureCloud();
      const { data, error } = await client.rpc('kambuz_merge_items', {
        p_target_id: targetId,
        p_source_id: sourceId,
        p_user_name: localStorage.getItem('kambuz_user') || 'Пользователь'
      });
      if (error) throw error;

      await refreshLocalFromCloud(client);
      pruneIgnored(sourceId);
      sessionLater = new Set();
      closeModal();
      refreshButton();
      toast(`Объединено: «${source.name}» → «${target.name}». Остаток ${fmt(data?.qty_after ?? total)} ${target.unit || ''}`);
      setTimeout(() => openDuplicates(true), 350);
    } catch (e) {
      alert(`Не удалось объединить карточки:\n${e?.message || e}`);
    } finally {
      busy = false;
      document.getElementById('duplicate-cleanup-overlay')?.classList.remove('dup-busy');
    }
  }

  function handleClick(event) {
    const button = event.target.closest('[data-dup-action]');
    if (!button) return;
    const action = button.dataset.dupAction;
    if (action === 'close') closeModal();
    if (action === 'ignore') markIgnored(button.dataset.key);
    if (action === 'later') markLater(button.dataset.key);
    if (action === 'merge') mergeItems(button.dataset.target, button.dataset.source);
  }

  function findWorkHeading() {
    return [...document.querySelectorAll('#app h1,#app h2,#app h3,#app h4,#app div,#app span')]
      .find(el => (el.textContent || '').trim() === 'Рабочие действия');
  }

  function installButton() {
    const heading = findWorkHeading();
    if (!heading?.parentElement) return;
    const count = findCandidates().length;
    let button = document.getElementById('duplicate-cleanup-button');
    if (!button) {
      button = document.createElement('button');
      button.id = 'duplicate-cleanup-button';
      button.type = 'button';
      button.innerHTML = '<span style="font-size:24px;line-height:1">🧹</span><span><b style="display:block;font-size:18px">Дубли в базе</b><small class="dup-button-sub" style="display:block;margin-top:3px;opacity:.7;font-size:13px"></small></span>';
      Object.assign(button.style, {
        width: '100%', margin: '12px 0 16px', border: '0', borderRadius: '22px', padding: '18px 20px',
        background: '#eef1ff', color: '#4252a5', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '14px',
        font: 'inherit', boxSizing: 'border-box', boxShadow: 'none'
      });
      button.addEventListener('click', () => openDuplicates(true));
      heading.insertAdjacentElement('afterend', button);
    }
    const sub = button.querySelector('.dup-button-sub');
    if (sub) sub.textContent = count ? `Найдено возможных дублей: ${count}` : 'Проверить похожие карточки';
  }

  function refreshButton() {
    installButton();
  }

  function start() {
    ensureStyles();
    document.addEventListener('click', handleClick);
    installButton();
    const app = document.getElementById('app');
    if (app) {
      let timer = null;
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(installButton, 80);
      }).observe(app, { childList: true, subtree: true });
    }
    window.addEventListener('storage', refreshButton);
  }

  window.KAMBUZ_DUPLICATES = {
    version: VERSION,
    scan: findCandidates,
    open: openDuplicates
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();