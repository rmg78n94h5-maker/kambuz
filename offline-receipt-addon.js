(() => {
  'use strict';

  const VERSION = '1.2.1';
  const STORAGE = {
    items: 'kambuz_items',
    ops: 'kambuz_ops',
    queue: 'kambuz_pending_ops'
  };

  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = () => new Date().toISOString();
  const read = (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/ё/g, 'е').replace(/[.,;:()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

  function normalizeUnit(unit) {
    const u = norm(unit);
    if (['шт', 'шт.', 'штука', 'штук'].includes(u)) return 'шт.';
    if (['бут', 'бут.', 'бутылка', 'бутылок'].includes(u)) return 'бут.';
    if (['уп', 'уп.', 'упак', 'упак.', 'упаковка', 'упаковок'].includes(u)) return 'упак.';
    if (['короб', 'короб.', 'коробка', 'коробок'].includes(u)) return 'короб';
    if (['мешок', 'мешка', 'мешков'].includes(u)) return 'мешок';
    if (['канистра', 'канистры', 'канистр'].includes(u)) return 'канистра';
    if (['рулон', 'рулона', 'рулонов'].includes(u)) return 'рулон';
    if (['пачка', 'пачки', 'пачек'].includes(u)) return 'пачка';
    if (['кг', 'kg'].includes(u)) return 'кг';
    if (['г', 'гр', 'g'].includes(u)) return 'г';
    if (['л', 'l'].includes(u)) return 'л';
    if (['мл', 'ml'].includes(u)) return 'мл';
    return clean(unit) || 'шт.';
  }

  function normalizePackageUnit(unit) {
    const u = norm(unit);
    if (['г', 'гр', 'g'].includes(u)) return 'г';
    if (['кг', 'kg'].includes(u)) return 'кг';
    if (['мл', 'ml'].includes(u)) return 'мл';
    if (['л', 'l'].includes(u)) return 'л';
    return clean(unit);
  }

  function inferCategory(name, supplied) {
    if (clean(supplied)) return clean(supplied);
    const n = norm(name);
    if (/(моющ|порош|мыло|чист|полир|освеж|кондиционер для белья|спрей)/.test(n)) return 'Химия';
    if (/(сковород|нож|мусат|турк|гриль|кофемол|соковыжим|стакан|салатник|солонк|мельниц)/.test(n)) return 'Посуда';
    if (/(простын|подуш|наволоч|одеял|пододеяль|полотен|шторк|коврик|пакет|губк|тележк|подставк)/.test(n)) return 'Хозтовары';
    return 'Хозтовары';
  }

  function normalizeReceiptPayload(data) {
    if (Array.isArray(data)) {
      return { type: 'receipt', title: 'Поступление JSON', items: data, discrepancies: [] };
    }
    if (!data || typeof data !== 'object') throw new Error('В JSON должен быть объект или массив позиций.');
    const items = Array.isArray(data.items) ? data.items : Array.isArray(data.products) ? data.products : null;
    if (!items) throw new Error('Не найден массив items (или products).');
    const type = clean(data.type || 'receipt').toLowerCase();
    if (!['receipt', 'поступление', 'supply', 'delivery'].includes(type)) {
      throw new Error('Этот файл не помечен как поставка (type: "receipt").');
    }
    return {
      type: 'receipt',
      title: clean(data.title) || 'Поступление JSON',
      items,
      discrepancies: Array.isArray(data.discrepancies) ? data.discrepancies : []
    };
  }

  function parseLine(raw) {
    const name = clean(raw.name || raw.title || raw.product);
    const quantity = Number(raw.quantity ?? raw.qty ?? raw.fact ?? raw.actualQuantity ?? 0);
    if (!name) throw new Error('Есть позиция без названия.');
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Некорректное количество: ${name}`);
    return {
      name,
      quantity,
      unit: normalizeUnit(raw.unit || raw.stockUnit),
      category: inferCategory(name, raw.category),
      subcategory: clean(raw.subcategory),
      brand: clean(raw.brand),
      barcode: clean(raw.barcode),
      volume: Number(raw.packageQuantity ?? raw.volume ?? raw.packSize ?? 0) || 0,
      package_unit: normalizePackageUnit(raw.packageUnit ?? raw.package_unit),
      location: clean(raw.location),
      notes: clean(raw.notes)
    };
  }

  function findExisting(items, line) {
    const barcode = clean(line.barcode).replace(/\D/g, '');
    if (barcode) {
      const byBarcode = items.find(i => clean(i.barcode).replace(/\D/g, '') === barcode);
      if (byBarcode) return byBarcode;
    }
    const exact = items.find(i => norm(i.name) === norm(line.name));
    if (exact) return exact;
    return null;
  }

  function importReceipt(data) {
    const receipt = normalizeReceiptPayload(data);
    const lines = receipt.items.map(parseLine);
    const positive = lines.filter(x => x.quantity > 0);
    const zero = lines.filter(x => x.quantity === 0);
    if (!positive.length) throw new Error('В поставке нет позиций с фактическим количеством больше нуля.');

    const items = read(STORAGE.items, []);
    const ops = read(STORAGE.ops, []);
    const queue = read(STORAGE.queue, []);
    const user = localStorage.getItem('kambuz_user') || 'Никита';
    const stamp = now();
    let created = 0;
    let updated = 0;

    for (const line of positive) {
      let item = findExisting(items, line);
      if (!item) {
        item = {
          id: uid(),
          name: line.name,
          brand: line.brand,
          barcode: line.barcode,
          category: line.category,
          subcategory: line.subcategory,
          volume: line.volume,
          package_unit: line.package_unit,
          unit: line.unit,
          qty: 0,
          min_qty: 0,
          location: line.location,
          notes: line.notes,
          updated_at: stamp
        };
        items.push(item);
        created++;
      } else {
        if (line.volume && !Number(item.volume)) item.volume = line.volume;
        if (line.package_unit && !clean(item.package_unit)) item.package_unit = line.package_unit;
        if (line.barcode && !clean(item.barcode)) item.barcode = line.barcode;
        if (line.subcategory && !clean(item.subcategory)) item.subcategory = line.subcategory;
        if (line.brand && !clean(item.brand)) item.brand = line.brand;
        if (line.location && !clean(item.location)) item.location = line.location;
        updated++;
      }

      const previous = Number(item.qty || 0);
      const next = previous + line.quantity;
      item.qty = next;
      item.updated_at = stamp;

      const op = {
        id: uid(),
        item_id: item.id,
        item_name: item.name,
        type: 'receipt',
        quantity: line.quantity,
        reason: null,
        comment: receipt.title,
        user_name: user,
        unit: item.unit || line.unit,
        previous_qty: previous,
        new_qty: next,
        created_at: now()
      };
      ops.unshift(op);
      queue.unshift({ ...op, kind: 'operation', status: 'pending', pending: true });
    }

    write(STORAGE.items, items);
    write(STORAGE.ops, ops);
    write(STORAGE.queue, queue);
    localStorage.setItem('kambuz_last_receipt_import', JSON.stringify({
      title: receipt.title,
      imported_at: stamp,
      lines: positive.length,
      created,
      updated,
      zero_skipped: zero.length,
      discrepancies: receipt.discrepancies.length
    }));

    return { title: receipt.title, lines: positive.length, created, updated, zero: zero.length, discrepancies: receipt.discrepancies.length };
  }

  function toast(message) {
    const old = document.getElementById('receipt-addon-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'receipt-addon-toast';
    el.textContent = message;
    Object.assign(el.style, {
      position: 'fixed', left: '16px', right: '16px', bottom: 'calc(env(safe-area-inset-bottom) + 92px)',
      zIndex: '100000', padding: '14px 16px', borderRadius: '16px', background: '#173d34', color: '#fff',
      font: '600 15px system-ui', boxShadow: '0 10px 30px rgba(0,0,0,.25)'
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  async function chooseReceiptFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        const data = JSON.parse(text);
        const preview = normalizeReceiptPayload(data);
        const positive = preview.items.map(parseLine).filter(x => x.quantity > 0);
        const zero = preview.items.length - positive.length;
        const ok = confirm(`${preview.title}\n\nПровести поступление: ${positive.length} поз.\nНулевые позиции пропустить: ${zero}\n\nОперация сначала сохранится на этом устройстве и синхронизируется с облаком позже.`);
        if (!ok) return;
        const result = importReceipt(data);
        toast(`Готово: ${result.lines} поз. · новых ${result.created} · обновлено ${result.updated} · ждёт синхронизации`);
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        alert(`Импорт поставки не выполнен:\n${e?.message || e}`);
      } finally {
        input.remove();
      }
    };
    input.click();
  }

  function setVisibleVersion() {
    document.querySelectorAll('#app *').forEach(el => {
      if (el.children.length === 0 && /^v1\.(1\.1|2\.0)$/.test((el.textContent || '').trim())) {
        el.textContent = `v${VERSION}`;
      }
    });
  }

  function findWorkHeading() {
    return [...document.querySelectorAll('#app h1,#app h2,#app h3,#app h4,#app div,#app span')]
      .find(el => (el.textContent || '').trim() === 'Рабочие действия');
  }

  function installButton() {
    setVisibleVersion();
    if (document.getElementById('receipt-json-import-button')) return;
    const heading = findWorkHeading();
    if (!heading || !heading.parentElement) return;

    const btn = document.createElement('button');
    btn.id = 'receipt-json-import-button';
    btn.type = 'button';
    btn.innerHTML = '<span style="font-size:24px;line-height:1">＋</span><span><b style="display:block;font-size:18px">Поставка JSON</b><small style="display:block;margin-top:3px;opacity:.7;font-size:13px">Принять поставку из файла</small></span>';
    btn.title = 'Импортировать фактическое поступление из JSON (работает офлайн)';
    Object.assign(btn.style, {
      width: '100%', margin: '12px 0 16px', border: '0', borderRadius: '22px', padding: '18px 20px',
      background: '#dff4ec', color: '#08745d', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '14px',
      font: 'inherit', boxSizing: 'border-box', boxShadow: 'none'
    });
    btn.addEventListener('click', chooseReceiptFile);
    heading.insertAdjacentElement('afterend', btn);
  }

  function refreshUi() {
    setVisibleVersion();
    installButton();
  }

  window.KAMBUZ_RECEIPT_IMPORT = { version: VERSION, importReceipt, chooseReceiptFile };
  const start = () => {
    refreshUi();
    const root = document.getElementById('app');
    if (root) {
      let timer = null;
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(refreshUi, 40);
      }).observe(root, { childList: true, subtree: true });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
