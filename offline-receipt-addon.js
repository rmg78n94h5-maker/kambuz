(() => {
  'use strict';

  const VERSION = '1.3.0';
  const STORAGE = {
    items: 'kambuz_items',
    ops: 'kambuz_ops',
    queue: 'kambuz_pending_ops',
    imports: 'kambuz_receipt_import_history'
  };

  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = () => new Date().toISOString();
  const read = (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,;:()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

  function extractSize(name) {
    const m = clean(name).match(/(\d+(?:[.,]\d+)?\s*[×xх]\s*\d+(?:[.,]\d+)?\s*(?:мм|см|м)?)/i);
    return m ? m[1].replace(/[xх]/gi, '×').replace(/\s+/g, ' ').trim() : '';
  }

  function extractDiameter(name) {
    const text = clean(name);
    const m = text.match(/(?:ø|⌀|d|диаметр)?\s*(\d{2,3})\s*мм/i);
    return m ? m[1] : '';
  }

  function canonicalDisplayName(value) {
    const raw = clean(value).replace(/\s+/g, ' ');
    const n = norm(raw);
    if (!n) return '';

    // Текстиль: цвет и размер не создают новую складскую позицию.
    if (/наволоч/.test(n)) return 'Наволочка';
    if (/пододеяль/.test(n)) return 'Пододеяльник';
    if (/простын/.test(n)) return 'Простыня';
    if (/^подуш/.test(n)) return 'Подушка';
    if (/^одеял/.test(n)) return 'Одеяло';
    if (/камбузн.*полотен|полотен.*камбуз/.test(n)) return 'Камбузное полотенце';
    if (/банн.*полотен|полотен.*банн/.test(n)) return 'Полотенце банное';
    if (/полотен.*для лица|лицев.*полотен/.test(n)) return 'Полотенце для лица';
    if (/штор.*душ/.test(n)) return 'Шторка для душа';
    if (/коврик.*душ/.test(n)) return 'Коврик для душа';

    // Посуда/инвентарь: технические хвосты убираем, но значимый размер сохраняем.
    if (/сковород/.test(n)) {
      const d = extractDiameter(raw);
      return d ? `Сковорода Ø${d} мм` : 'Сковорода';
    }
    if (/нож.*обвал|обвал.*нож/.test(n)) return 'Нож обвалочный';
    if (/нож.*мясник|мясник.*нож/.test(n)) return 'Нож мясника';
    if (/нож.*рыб|рыб.*нож/.test(n)) return 'Нож для рыбы';
    if (/мусат/.test(n)) return 'Мусат';
    if (/салатник/.test(n)) return 'Салатник';
    if (/солонк/.test(n)) return 'Солонка';
    if (/мельниц.*перц|перц.*мельниц/.test(n)) return 'Мельница для перца';
    if (/турк/.test(n)) return 'Турка';
    if (/соковыжим.*цитрус/.test(n)) return 'Соковыжималка для цитрусовых';
    if (/кофемол/.test(n)) return 'Кофемолка электрическая';
    if (/утюг/.test(n)) return 'Утюг';
    if (/грил/.test(n)) return 'Гриль настольный электрический';
    if (/стакан.*однораз.*пласт|пласт.*однораз.*стакан/.test(n)) return 'Стакан одноразовый пластиковый';
    if (/стакан.*стекл|столов.*стакан/.test(n)) return 'Стакан стеклянный';
    if (/тележк.*мусор|подставк.*мусор/.test(n)) return 'Тележка под мусорный бак';
    if (/губк.*уборк/.test(n)) return 'Губка для уборки';

    // Пакеты: размер различает товар и поэтому сохраняется.
    if (/пакет/.test(n)) {
      const size = extractSize(raw);
      if (/мусор/.test(n)) return 'Пакеты мусорные';
      if (/прозрач/.test(n)) return `Пакеты прозрачные${size ? ` ${size}` : ''}`;
      if (/упаков/.test(n)) return `Пакеты упаковочные${size ? ` ${size}` : ''}`;
    }

    // Химия: фасовка хранится отдельно, а не в названии.
    if (/стиральн.*порош/.test(n)) return 'Стиральный порошок';
    if (/мягк.*мыл/.test(n)) return 'Мягкое мыло';
    if (/моющ.*посуд/.test(n)) return 'Моющее средство для посуды';
    if (/туал.*средств|средств.*туал|чистк.*туал/.test(n)) return 'Средство для туалета';
    if (/средств.*кухн|кухн.*средств/.test(n)) return 'Средство для кухни';
    if (/освеж.*воздух/.test(n)) return 'Освежитель воздуха';
    if (/нержав/.test(n)) return 'Средство для нержавеющей стали';
    if (/полир.*дерев/.test(n)) return 'Полироль для дерева';
    if (/кондиционер.*бель/.test(n)) return 'Кондиционер для белья';
    if (/туалет.*бумаг/.test(n)) return 'Туалетная бумага';
    if (/бумажн.*салфет|tissue.*economy/.test(n)) return 'Бумажные салфетки';

    return raw;
  }

  function inferCategory(name, supplied) {
    if (clean(supplied)) return clean(supplied);
    const n = norm(name);
    if (/(моющ|порош|мыло|чист|полир|освеж|кондиционер для белья|средство для кухни|средство для туалета|нержав)/.test(n)) return 'Химия';
    if (/(сковород|нож|мусат|турк|гриль|кофемол|соковыжим|стакан|салатник|солонк|мельниц)/.test(n)) return 'Посуда';
    if (/(простын|подуш|наволоч|одеял|пододеяль|полотен|шторк|коврик|пакет|губк|тележк|подставк)/.test(n)) return 'Хозтовары';
    return 'Хозтовары';
  }

  function normalizeReceiptPayload(data) {
    if (Array.isArray(data)) return { type: 'receipt', title: 'Поступление JSON', items: data, discrepancies: [] };
    if (!data || typeof data !== 'object') throw new Error('В JSON должен быть объект или массив позиций.');
    const items = Array.isArray(data.items) ? data.items : Array.isArray(data.products) ? data.products : null;
    if (!items) throw new Error('Не найден массив items (или products).');
    const type = clean(data.type || 'receipt').toLowerCase();
    if (!['receipt', 'поступление', 'supply', 'delivery'].includes(type)) throw new Error('Этот файл не помечен как поставка (type: "receipt").');
    return {
      type: 'receipt',
      title: clean(data.title) || 'Поступление JSON',
      items,
      discrepancies: Array.isArray(data.discrepancies) ? data.discrepancies : []
    };
  }

  function parseLine(raw) {
    const sourceName = clean(raw.name || raw.title || raw.product);
    const name = canonicalDisplayName(sourceName);
    const quantity = Number(raw.quantity ?? raw.qty ?? raw.fact ?? raw.actualQuantity ?? 0);
    if (!name) throw new Error('Есть позиция без названия.');
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Некорректное количество: ${name}`);
    return {
      source_name: sourceName,
      name,
      quantity,
      unit: normalizeUnit(raw.unit || raw.stockUnit),
      category: inferCategory(name, raw.category),
      subcategory: clean(raw.subcategory),
      brand: clean(raw.brand),
      barcode: clean(raw.barcode) || null,
      volume: Number(raw.packageQuantity ?? raw.volume ?? raw.packSize ?? 0) || 0,
      package_unit: normalizePackageUnit(raw.packageUnit ?? raw.package_unit),
      location: clean(raw.location),
      notes: clean(raw.notes)
    };
  }

  function basePackage(volume, unit) {
    const v = Number(volume || 0);
    const u = norm(unit);
    if (!v || !u) return null;
    if (u === 'кг') return { kind: 'mass', value: v * 1000 };
    if (u === 'г' || u === 'гр') return { kind: 'mass', value: v };
    if (u === 'л') return { kind: 'volume', value: v * 1000 };
    if (u === 'мл') return { kind: 'volume', value: v };
    return null;
  }

  function compatiblePackage(item, line) {
    const a = basePackage(item.volume ?? item.weight, item.package_unit);
    const b = basePackage(line.volume, line.package_unit);
    if (!a || !b) return true;
    if (a.kind !== b.kind) return false;
    return Math.abs(a.value - b.value) < 0.001;
  }

  function canonicalKey(value) {
    return norm(canonicalDisplayName(value));
  }

  function findExisting(items, line) {
    const barcode = clean(line.barcode).replace(/\D/g, '');
    if (barcode) {
      const byBarcode = items.find(i => clean(i.barcode).replace(/\D/g, '') === barcode);
      if (byBarcode) return byBarcode;
    }

    const exact = items.find(i => norm(i.name) === norm(line.name) && compatiblePackage(i, line));
    if (exact) return exact;

    const key = canonicalKey(line.name);
    const candidates = items.filter(i => canonicalKey(i.name) === key && compatiblePackage(i, line));
    if (candidates.length === 1) return candidates[0];

    // Если несколько вариантов одного товара, выбираем только при однозначной фасовке.
    if (candidates.length > 1) {
      const packaged = candidates.filter(i => {
        const a = basePackage(i.volume ?? i.weight, i.package_unit);
        const b = basePackage(line.volume, line.package_unit);
        return a && b && a.kind === b.kind && Math.abs(a.value - b.value) < 0.001;
      });
      if (packaged.length === 1) return packaged[0];
    }
    return null;
  }

  function itemPayload(item) {
    return {
      id: item.id,
      name: item.name,
      brand: item.brand || '',
      barcode: clean(item.barcode) || null,
      category: item.category || '',
      subcategory: item.subcategory || '',
      volume: Number(item.volume || 0),
      package_unit: item.package_unit || '',
      unit: item.unit || 'шт.',
      min_qty: Number(item.min_qty || 0),
      location: item.location || '',
      notes: item.notes || '',
      updated_at: item.updated_at || now()
    };
  }

  function queueItemUpsert(queue, item) {
    const id = `item:${item.id}`;
    const existing = queue.find(x => x.kind === 'item_upsert' && x.item_id === item.id);
    const task = {
      id,
      kind: 'item_upsert',
      item_id: item.id,
      item_name: item.name,
      item: itemPayload(item),
      status: 'pending',
      error: null,
      created_at: now()
    };
    if (existing) Object.assign(existing, task);
    else queue.push(task);
  }

  function stableFingerprint(receipt, lines) {
    const text = JSON.stringify({
      title: receipt.title,
      items: lines.map(x => [x.name, x.quantity, x.unit, x.volume, x.package_unit, x.barcode || null])
    });
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `r${(hash >>> 0).toString(16)}`;
  }

  function analyzeReceipt(data) {
    const receipt = normalizeReceiptPayload(data);
    const lines = receipt.items.map(parseLine);
    const positive = lines.filter(x => x.quantity > 0);
    const items = read(STORAGE.items, []);
    let matched = 0;
    for (const line of positive) if (findExisting(items, line)) matched++;
    return {
      receipt,
      lines,
      positive,
      zero: lines.length - positive.length,
      matched,
      created: positive.length - matched,
      fingerprint: stableFingerprint(receipt, lines)
    };
  }

  function importReceipt(data) {
    const analysis = analyzeReceipt(data);
    const { receipt, positive } = analysis;
    if (!positive.length) throw new Error('В поставке нет позиций с фактическим количеством больше нуля.');

    const items = read(STORAGE.items, []);
    const ops = read(STORAGE.ops, []);
    const queue = read(STORAGE.queue, []);
    const user = localStorage.getItem('kambuz_user') || 'Пользователь';
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
          barcode: line.barcode || null,
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
        let changed = false;
        const canonical = canonicalDisplayName(item.name);
        if (canonical && item.name !== canonical) { item.name = canonical; changed = true; }
        if (clean(item.barcode) === '') { item.barcode = null; changed = true; }
        if (line.volume && !Number(item.volume)) { item.volume = line.volume; changed = true; }
        if (line.package_unit && !clean(item.package_unit)) { item.package_unit = line.package_unit; changed = true; }
        if (line.barcode && !clean(item.barcode)) { item.barcode = line.barcode; changed = true; }
        if (line.subcategory && !clean(item.subcategory)) { item.subcategory = line.subcategory; changed = true; }
        if (line.brand && !clean(item.brand)) { item.brand = line.brand; changed = true; }
        if (line.location && !clean(item.location)) { item.location = line.location; changed = true; }
        if (changed) item.updated_at = stamp;
        updated++;
      }

      const previous = Number(item.qty || 0);
      const next = previous + line.quantity;
      item.qty = next;
      item.updated_at = stamp;

      // Карточка всегда идёт в очередь до операции — так новый товар гарантированно существует в облаке.
      queueItemUpsert(queue, item);

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
      queue.push({ ...op, kind: 'operation', status: 'pending', pending: true, error: null });
    }

    write(STORAGE.items, items);
    write(STORAGE.ops, ops);
    write(STORAGE.queue, queue);

    const importedAt = now();
    const history = read(STORAGE.imports, []);
    history.unshift({ fingerprint: analysis.fingerprint, title: receipt.title, imported_at: importedAt, lines: positive.length });
    write(STORAGE.imports, history.slice(0, 50));
    localStorage.setItem('kambuz_last_receipt_import', JSON.stringify({
      title: receipt.title,
      fingerprint: analysis.fingerprint,
      imported_at: importedAt,
      lines: positive.length,
      created,
      updated,
      zero_skipped: analysis.zero,
      discrepancies: receipt.discrepancies.length
    }));

    return {
      title: receipt.title,
      lines: positive.length,
      created,
      updated,
      zero: analysis.zero,
      discrepancies: receipt.discrepancies.length,
      fingerprint: analysis.fingerprint
    };
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
        const data = JSON.parse(await file.text());
        const preview = analyzeReceipt(data);
        const history = read(STORAGE.imports, []);
        const duplicate = history.find(x => x.fingerprint === preview.fingerprint);
        if (duplicate) {
          const again = confirm(`Похоже, этот же файл уже импортировали ${new Date(duplicate.imported_at).toLocaleString('ru-RU')}.\n\nПовторный импорт ещё раз увеличит остатки. Импортировать всё равно?`);
          if (!again) return;
        }

        const ok = confirm(
          `${preview.receipt.title}\n\n` +
          `Провести поступление: ${preview.positive.length} поз.\n` +
          `Совпало со складом: ${preview.matched}\n` +
          `Новых карточек: ${preview.created}\n` +
          `Нулевые позиции пропустить: ${preview.zero}\n\n` +
          `Названия будут нормализованы автоматически. Размер сохраняется там, где он различает товар.`
        );
        if (!ok) return;

        const result = importReceipt(data);
        toast(`Готово: ${result.lines} поз. · новых ${result.created} · найдено ${result.updated} · ждёт синхронизации`);
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
    document.querySelectorAll('.app-version').forEach(el => { el.textContent = `v${VERSION}`; });
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

  window.KAMBUZ_RECEIPT_IMPORT = {
    version: VERSION,
    importReceipt,
    chooseReceiptFile,
    analyzeReceipt,
    canonicalDisplayName
  };

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
