(() => {
  'use strict';

  const VERSION = '1.7.0';
  const KEYS = {
    items: 'kambuz_items',
    queue: 'kambuz_pending_ops'
  };
  const ITEM_FIELDS = ['id','name','brand','barcode','category','subcategory','volume','package_unit','unit','min_qty','location','notes','updated_at'];

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const now = () => new Date().toISOString();
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  function normalizedPackageUnit(value) {
    const u = norm(value);
    if (!u) return null;
    if (['г','гр'].includes(u)) return 'г';
    if (u === 'кг') return 'кг';
    if (u === 'мл') return 'мл';
    if (u === 'л') return 'л';
    if (['шт','шт.'].includes(u)) return null;
    return clean(value) || null;
  }

  function normalizeProductSubcategory(subcategory) {
    const s = clean(subcategory);
    if (['Груши','Яблоки','Цитрусовые','Тропические фрукты'].includes(s)) return 'Фрукты';
    if (['Капуста','Корнеплоды','Лук','Овощи','Перец сладкий','Салаты','Томаты'].includes(s)) return 'Овощи';
    if (s === 'Рис') return 'Крупы';
    if (s === 'Молоко') return 'Молочная продукция';
    if (['Кетчупы','Соусы'].includes(s)) return 'Соусы и приправы';
    if (s === 'Бобовые и крупы') return 'Бобовые';
    return s || null;
  }

  function productSubcategoryByName(name) {
    const n = norm(name);
    if (/(говяж|говядин|рибай|кулак говяж|глазной мускул)/.test(n)) return 'Говядина';
    if (/(свин|рульк)/.test(n)) return 'Свинина';
    if (/(курин|куриц|индейк)/.test(n)) return /печен/.test(n) ? 'Субпродукты' : 'Птица';
    if (/(ветчин|колбас|грудинк.*копчен|сало|сардель|сосиск|шпикач)/.test(n)) return 'Колбасы и мясная гастрономия';
    if (/купат/.test(n)) return 'Мясные полуфабрикаты';
    if (/пельмен/.test(n)) return 'Замороженные полуфабрикаты';
    if (/(молоко$|кефир|йогурт|сливк|творог|масло сливоч)/.test(n)) return 'Молочная продукция';
    if (/сыр/.test(n)) return 'Сыры';
    if (/яйц/.test(n)) return 'Яйца';
    if (/(греч|булгур|манн|перлов|пшеничн.*круп|рис)/.test(n)) return 'Крупы';
    if (/горох колот|чечев|нут\b/.test(n)) return 'Бобовые';
    if (/макарон|спагет|вермиш/.test(n)) return 'Макаронные изделия';
    if (/^мука/.test(n)) return 'Мука';
    if (/^сахар/.test(n)) return 'Сахар';
    if (/масло раститель/.test(n)) return 'Масла';
    if (/(соль|специ|перец молот|приправа)/.test(n)) return 'Соль и специи';
    if (/кофе/.test(n)) return 'Кофе';
    if (/^чай/.test(n)) return 'Чай';
    if (/(мюсли|хлопья)/.test(n)) return 'Сухие завтраки';
    if (/(сухофрукт|смесь компот)/.test(n)) return 'Сухофрукты';
    if (/(конфет|печень|шоколад|вафл)/.test(n)) return 'Кондитерские изделия';
    if (/(баклажан|кабач|цукини|огур|броккол|капуст|картоф|лук бел|лук крас|перец крас|перец жел|перец зелен|томат|салат айсберг)/.test(n)) return 'Овощи';
    if (/(укроп|петруш|кинз|лук зелен)/.test(n)) return 'Свежая зелень';
    if (/(яблок|груш|банан|ананас|киви|манго|грейпфрут|лимон|мандарин|апельсин)/.test(n)) return 'Фрукты';
    if (/(фасоль|горошек|кукуруз|гриб|икра из баклаж|икра кабач|корнишон|лечо|маслин|оливк|томат.*консерв)/.test(n) && /консерв|икра|лечо|маслин|оливк/.test(n)) return /фасоль/.test(n) ? 'Бобовые консервы' : 'Овощные консервы';
    if (/(горбуш|сайр|тунец|шпрот)/.test(n) && /консерв|шпрот/.test(n)) return 'Рыбные консервы';
    if (/паштет/.test(n)) return 'Мясные консервы';
    if (/сгущ/.test(n)) return 'Молочные консервы';
    if (/(абрикос|персик).*консерв/.test(n)) return 'Фруктовые консервы';
    if (/(майонез|аджик|кетчуп|соев.*соус|остр.*соус|томатн.*паст|уксус)/.test(n)) return 'Соусы и приправы';
    if (/(джем|варенье)/.test(n)) return 'Джемы и варенье';
    if (/(хлеб|батон)/.test(n)) return 'Хлеб';
    if (/(сок|безалкогольн.*напит)/.test(n)) return 'Напитки';
    return null;
  }

  function classify(item) {
    const name = clean(item?.name);
    const n = norm(name);
    const currentCategory = clean(item?.category) || 'Продукты';
    let category = currentCategory;
    let subcategory = clean(item?.subcategory) || null;
    let unit = clean(item?.unit) || 'шт.';
    const package_unit = normalizedPackageUnit(item?.package_unit);

    // Хозтовары — расходники и бытовые принадлежности, но не химические составы.
    if (/(губк|мет\.губ|пленк|плёнк|фольг|пакет|наволоч|пододеяль|простын|подушк|одеял|полотен|шторк.*душ|бумажн.*салфет|туалетн.*бумаг|лента от мух|ловушк.*таракан|тележк.*мусор)/.test(n)) {
      category = 'Хозтовары';
      if (/губк/.test(n)) subcategory = 'Губки и принадлежности для уборки';
      else if (/пленк|плёнк|фольг/.test(n)) subcategory = 'Плёнка и фольга';
      else if (/пакет/.test(n)) subcategory = 'Пакеты';
      else if (/наволоч|пододеяль|простын|подушк|одеял/.test(n)) subcategory = 'Постельное бельё';
      else if (/полотен/.test(n)) subcategory = 'Полотенца';
      else if (/шторк.*душ/.test(n)) subcategory = 'Ванная и санузел';
      else if (/бумажн.*салфет|туалетн.*бумаг/.test(n)) subcategory = 'Бумажная продукция';
      else if (/лента от мух|ловушк.*таракан/.test(n)) subcategory = 'Борьба с насекомыми';
      else if (/тележк.*мусор/.test(n)) subcategory = 'Уборочный инвентарь';
    }
    // Настоящая химия.
    else if (/(моющ|чистящ|антижир|белизн|кондиционер для белья|стиральн.*порош|мягк.*мыл|освежител.*воздух|крот$|clean glass|floor wash|для пола$|средство для кухни|средство для туалета|средство для нержав|gloss|pure & clean|универсальн.*моющ)/.test(n)) {
      category = 'Химия';
      if (/посуд|pure & clean/.test(n)) subcategory = 'Средства для мытья посуды';
      else if (/floor wash|для пола$/.test(n)) subcategory = 'Средства для пола';
      else if (/стиральн.*порош|кондиционер для белья/.test(n)) subcategory = 'Стирка и уход за бельём';
      else if (/мягк.*мыл/.test(n)) subcategory = 'Мыло и гигиена';
      else if (/освежител.*воздух/.test(n)) subcategory = 'Освежители воздуха';
      else if (/clean glass|стекл|зеркал/.test(n)) subcategory = 'Средства для стекол и зеркал';
      else if (/антижир|средство для кухни|нержав/.test(n)) subcategory = 'Средства для кухни';
      else if (/туалет|унитаз/.test(n)) subcategory = 'Средства для унитаза';
      else if (/крот$|прочист/.test(n)) subcategory = 'Средства для прочистки труб';
      else if (/белизн|дезинфиц/.test(n)) subcategory = 'Отбеливатели и дезинфицирующие средства';
      else if (/gloss|акрил|антиналет|антиналёт/.test(n)) subcategory = 'Средства для ванной и сантехники';
      else if (/порош/.test(n) && !/стиральн/.test(n)) subcategory = 'Чистящие порошки';
      else if (/универсальн.*моющ/.test(n)) subcategory = 'Универсальные моющие средства';
    }
    // Посуда и кухонные принадлежности.
    else if (/(сковород|нож |мусат|салатник|солонк|стакан стекл|стакан однораз|мельниц.*перц|турка$|соковыжимал|удалитель сердцевины)/.test(n)) {
      category = 'Посуда';
      if (/нож |мусат/.test(n)) subcategory = 'Ножи и заточка';
      else if (/сковород/.test(n)) subcategory = 'Сковороды';
      else if (/стакан однораз/.test(n)) subcategory = 'Одноразовая посуда';
      else if (/салатник|солонк|стакан стекл/.test(n)) subcategory = 'Столовая посуда';
      else subcategory = 'Кухонные принадлежности';
      if (/соковыжимал|удалитель сердцевины/.test(n) && unit === 'кг') unit = 'шт.';
    }
    else if (/(гриль настольн|кофемолк|^утюг$)/.test(n)) {
      category = 'Инвентарь';
      subcategory = 'Электроприборы';
    }
    else if (currentCategory === 'Продукты' || productSubcategoryByName(name)) {
      category = 'Продукты';
      subcategory = productSubcategoryByName(name) || normalizeProductSubcategory(subcategory);
    }

    if (category === 'Продукты') subcategory = productSubcategoryByName(name) || normalizeProductSubcategory(subcategory);

    return { category, subcategory: subcategory || null, unit, package_unit };
  }

  function differences(item) {
    const next = classify(item);
    const changes = [];
    if (clean(item.category) !== clean(next.category)) changes.push(['Категория', clean(item.category) || '—', next.category || '—']);
    if (clean(item.subcategory) !== clean(next.subcategory)) changes.push(['Подкатегория', clean(item.subcategory) || '—', next.subcategory || '—']);
    if (clean(item.unit) !== clean(next.unit)) changes.push(['Единица', clean(item.unit) || '—', next.unit || '—']);
    if (clean(item.package_unit) !== clean(next.package_unit)) changes.push(['Ед. фасовки', clean(item.package_unit) || '—', next.package_unit || '—']);
    return changes.length ? { item, next, changes } : null;
  }

  function scan() {
    const items = read(KEYS.items, []);
    return (Array.isArray(items) ? items : []).map(differences).filter(Boolean);
  }

  function itemPayload(item) {
    return Object.fromEntries(ITEM_FIELDS.filter(k => item[k] !== undefined).map(k => [k, item[k]]));
  }

  function queueUpsert(queue, item) {
    const existing = queue.find(x => x.kind === 'item_upsert' && x.item_id === item.id);
    const task = {
      id: `item:${item.id}`,
      kind: 'item_upsert',
      item_id: item.id,
      item_name: item.name,
      item: itemPayload(item),
      status: 'pending',
      error: null,
      created_at: now()
    };
    if (existing) Object.assign(existing, task);
    else queue.unshift(task);
  }

  function applySuggestions(suggestions, reload = true) {
    if (!suggestions.length) return 0;
    const items = read(KEYS.items, []);
    const queue = read(KEYS.queue, []);
    const byId = new Map(items.map(x => [x.id, x]));
    let changed = 0;
    for (const suggestion of suggestions) {
      const item = byId.get(suggestion.item.id);
      if (!item) continue;
      Object.assign(item, suggestion.next, { updated_at: now() });
      queueUpsert(queue, item);
      changed++;
    }
    write(KEYS.items, items);
    write(KEYS.queue, queue);
    if (reload && changed) setTimeout(() => location.reload(), 250);
    return changed;
  }

  // Важный путь для новых импортов: при следующем открытии нормализуем очевидные категории
  // ещё до запуска основного app.js, а затем обычная очередь синхронизации отправит метаданные в облако.
  function autoNormalizeLocal() {
    const suggestions = scan();
    if (suggestions.length) applySuggestions(suggestions, false);
    return suggestions.length;
  }

  function ensureStyles() {
    if (document.getElementById('classification-styles')) return;
    const style = document.createElement('style');
    style.id = 'classification-styles';
    style.textContent = `
      .cl-overlay{position:fixed;inset:0;z-index:170000;background:rgba(10,26,22,.45);display:flex;align-items:flex-end;font-family:system-ui,-apple-system,sans-serif}.cl-sheet{width:100%;max-height:88vh;background:#f7f9f8;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden}.cl-head{padding:18px 18px 12px;background:#fff;border-bottom:1px solid #e4ebe8;display:flex;gap:12px;align-items:center}.cl-head h2{margin:0;font-size:21px;flex:1}.cl-close{border:0;background:#edf2f0;border-radius:12px;width:40px;height:40px;font-size:20px}.cl-intro{padding:12px 18px;color:#60746e;font-size:13px}.cl-list{overflow:auto;padding:0 14px 120px}.cl-card{background:#fff;border:1px solid #e2e9e6;border-radius:17px;padding:13px;margin:8px 0}.cl-top{display:flex;gap:10px}.cl-top input{margin-top:4px;width:20px;height:20px}.cl-name{font-weight:800;font-size:15px}.cl-change{font-size:12px;color:#657a73;margin-top:6px}.cl-change b{color:#0b725d}.cl-foot{position:absolute;left:0;right:0;bottom:0;background:rgba(255,255,255,.97);border-top:1px solid #e1e8e5;padding:11px 16px calc(env(safe-area-inset-bottom) + 12px)}.cl-apply{width:100%;border:0;border-radius:15px;padding:14px;background:#0b7a62;color:#fff;font:800 16px system-ui}.cl-empty{text-align:center;padding:42px 20px;color:#657a73}.cl-summary{font-size:13px;color:#657a73;margin-bottom:8px}@media(min-width:720px){.cl-overlay{align-items:center;justify-content:center}.cl-sheet{max-width:680px;border-radius:24px;max-height:82vh;position:relative}}
    `;
    document.head.appendChild(style);
  }

  function closeModal() { document.getElementById('classification-overlay')?.remove(); }

  function openCleanup() {
    closeModal();
    ensureStyles();
    const suggestions = scan();
    const overlay = document.createElement('div');
    overlay.id = 'classification-overlay';
    overlay.className = 'cl-overlay';
    overlay.innerHTML = `<div class="cl-sheet" style="position:relative">
      <div class="cl-head"><h2>🗂 Порядок в базе</h2><button class="cl-close" type="button" data-cl-close>×</button></div>
      <div class="cl-intro">Камбуз предлагает только очевидные исправления категорий, подкатегорий и единиц. Сними галочку, если конкретную карточку трогать не надо.</div>
      ${suggestions.length ? `<div class="cl-list">${suggestions.map((s,i)=>`<div class="cl-card"><div class="cl-top"><input type="checkbox" checked data-cl-check="${i}"><div><div class="cl-name">${esc(s.item.name)}</div>${s.changes.map(c=>`<div class="cl-change">${esc(c[0])}: ${esc(c[1])} → <b>${esc(c[2])}</b></div>`).join('')}</div></div></div>`).join('')}</div><div class="cl-foot"><div class="cl-summary">Найдено очевидных исправлений: <b>${suggestions.length}</b></div><button class="cl-apply" type="button" data-cl-apply>Применить выбранные</button></div>` : '<div class="cl-empty">Всё чисто 👍<br>Очевидных ошибок классификации не найдено.</div>'}
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-cl-close]')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('[data-cl-apply]')?.addEventListener('click', () => {
      const chosen = suggestions.filter((_,i) => overlay.querySelector(`[data-cl-check="${i}"]`)?.checked);
      if (!chosen.length) return alert('Не выбрано ни одного исправления.');
      const ok = confirm(`Применить исправления к ${chosen.length} карточкам? Остатки и история операций не изменятся.`);
      if (!ok) return;
      applySuggestions(chosen, true);
    });
  }

  function findWorkHeading() {
    return [...document.querySelectorAll('#app h1,#app h2,#app h3,#app h4,#app div,#app span')]
      .find(el => (el.textContent || '').trim() === 'Рабочие действия');
  }

  function installButton() {
    const heading = findWorkHeading();
    if (!heading?.parentElement) return;
    const count = scan().length;
    let btn = document.getElementById('classification-cleanup-button');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'classification-cleanup-button';
      btn.type = 'button';
      btn.innerHTML = '<span style="font-size:24px;line-height:1">🗂</span><span><b style="display:block;font-size:18px">Порядок в базе</b><small class="cl-btn-sub" style="display:block;margin-top:3px;opacity:.7;font-size:13px"></small></span>';
      Object.assign(btn.style,{width:'100%',margin:'12px 0 16px',border:'0',borderRadius:'22px',padding:'18px 20px',background:'#e8f3ff',color:'#285f91',textAlign:'left',display:'flex',alignItems:'center',gap:'14px',font:'inherit',boxSizing:'border-box'});
      btn.addEventListener('click', openCleanup);
      heading.insertAdjacentElement('afterend', btn);
    }
    const sub = btn.querySelector('.cl-btn-sub');
    if (sub) sub.textContent = count ? `Найдено очевидных исправлений: ${count}` : 'Категории и подкатегории в порядке';
  }

  const autoFixed = autoNormalizeLocal();

  function startUi() {
    ensureStyles();
    installButton();
    const app = document.getElementById('app');
    if (app) {
      let timer = null;
      new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(installButton,80); }).observe(app,{childList:true,subtree:true});
    }
  }

  window.KAMBUZ_CLASSIFIER = { version: VERSION, classify, scan, open: openCleanup, auto_fixed: autoFixed };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startUi, {once:true});
  else startUi();
})();