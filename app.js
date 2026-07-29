(() => {
  const APP_VERSION = "0.8.0";
  const CATEGORIES = ["Химия","Хозтовары","Посуда","Инвентарь","Продукты"];
  const UNITS = ["шт.","бут.","упак.","рулон","пачка","кг","г","л","мл","компл."];
  const WRITE_OFF_REASONS = ["Брак","Повреждение","Протечка","Разбилось","Просрочено","Потеряно","Выброшено","Ошибка поставки","Другое"];
  const cfg = window.KAMBUZ_CONFIG || {};
  const hasCloudConfig = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  let cloudEnabled = false;
  let sb = null;
  let cloudInitPromise = null;
  const state = {
    tab:"home", items:[], ops:[], query:"", category:"Все",
    user:localStorage.getItem("kambuz_user") || "Никита",
    sync:hasCloudConfig?(navigator.onLine?"🟡 Подключение…":"🟠 Офлайн") : "Локальный режим",
    basket:{type:"consumption",lines:[]}, syncing:false, subscribed:false, syncError:null, lastSync:localStorage.getItem("kambuz_last_sync")||null
  };
  const STORAGE = {items:"kambuz_items",ops:"kambuz_ops",queue:"kambuz_pending_ops"};
  const ITEM_FIELDS = ["id","name","brand","barcode","category","subcategory","volume","package_unit","unit","qty","min_qty","location","notes","updated_at"];
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const uid = () => crypto.randomUUID?.() || String(Date.now()+Math.random());
  const now = () => new Date().toISOString();
  const fmt = n => Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:3});
  const normalizeBarcode = v => String(v||"").replace(/\D/g,"");
  const seed = [];

  async function load(){
    // Сначала всегда рисуем последнюю локальную копию. Интернет для запуска не нужен.
    loadLocal();
    render();
    if(!hasCloudConfig){updateSyncLabel();return}
    if(!navigator.onLine){updateSyncLabel();return}
    await connectCloudAndSync();
  }
  function loadSupabaseLibrary(){
    if(window.supabase)return Promise.resolve(window.supabase);
    if(cloudInitPromise)return cloudInitPromise;
    cloudInitPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      const timer=setTimeout(()=>{script.remove();cloudInitPromise=null;reject(new Error("Не удалось загрузить модуль облака"))},8000);
      script.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.async=true;
      script.onload=()=>{clearTimeout(timer);window.supabase?resolve(window.supabase):(cloudInitPromise=null,reject(new Error("Модуль облака не запустился")))};
      script.onerror=()=>{clearTimeout(timer);script.remove();cloudInitPromise=null;reject(new Error("Модуль облака недоступен"))};
      document.head.appendChild(script);
    });
    return cloudInitPromise;
  }
  async function ensureCloud(){
    if(cloudEnabled&&sb)return true;
    if(!hasCloudConfig||!navigator.onLine)return false;
    const lib=await loadSupabaseLibrary();
    sb=lib.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    cloudEnabled=true;
    return true;
  }
  async function connectCloudAndSync(){
    try{
      state.sync="🟡 Подключение…";state.syncError=null;render();
      if(!await ensureCloud()){updateSyncLabel();return}
      await syncPending();
      await loadCloudSilent();
      state.lastSync=now(); localStorage.setItem("kambuz_last_sync",state.lastSync);
      const remaining=getQueue();
      if(remaining.some(x=>x.status==="error")){state.sync="🔴 Ошибка синхронизации";state.syncError=remaining.filter(x=>x.status==="error").map(x=>x.error).filter(Boolean).join("; ")}
      else if(remaining.length)state.sync=`🟡 Ожидает (${remaining.length})`;
      else state.sync="🟢 Синхронизировано";
      subscribe();
    }catch(e){console.error(e);state.syncError=e?.message||"Не удалось связаться с облаком";state.sync="🔴 Ошибка синхронизации"}
    render();
  }
  function safeParse(key,fallback){try{return JSON.parse(localStorage.getItem(key)||"null")??fallback}catch{return fallback}}
  function loadLocal(){
    state.items=safeParse(STORAGE.items,seed);
    state.ops=safeParse(STORAGE.ops,[]);
    repairKnownUnits();
  }
  function saveLocal(){
    localStorage.setItem(STORAGE.items,JSON.stringify(state.items));
    localStorage.setItem(STORAGE.ops,JSON.stringify(state.ops));
  }
  function getQueue(){
    const raw=safeParse(STORAGE.queue,[]);
    return raw.map(x=>x.kind?x:{...x,kind:"operation",status:x.status||"pending"});
  }
  function setQueue(q){localStorage.setItem(STORAGE.queue,JSON.stringify(q));updateSyncLabel()}
  function pendingForItem(itemId){return getQueue().filter(x=>x.item_id===itemId&&x.status!=="done").length}
  function queueItemUpsert(item){
    if(!hasCloudConfig)return;
    const q=getQueue();
    const payload=Object.fromEntries(ITEM_FIELDS.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
    const existing=q.find(x=>x.kind==="item_upsert"&&x.item_id===item.id);
    if(existing){existing.item=payload;existing.status="pending";existing.error=null}
    else q.unshift({id:`item:${item.id}`,kind:"item_upsert",item_id:item.id,item_name:itemLabel(item),item:payload,status:"pending",created_at:now()});
    setQueue(q);
  }
  function applyPendingOverlay(cloudItems,queue=getQueue()){
    const localMap=new Map((state.items||[]).map(i=>[i.id,{...i}]));
    const map=new Map((cloudItems||[]).map(i=>[i.id,{...i}]));
    for(const [id,item] of localMap){if(!map.has(id))map.set(id,{...item})}
    for(const task of queue){
      if(task.kind!=="operation")continue;
      const item=map.get(task.item_id);if(!item)continue;
      const cloudItem=(cloudItems||[]).find(i=>i.id===task.item_id);
      if(cloudItem){
        const current=Number(item.qty||0);
        if(task.type==="receipt")item.qty=current+Number(task.quantity||0);
        else if(task.type==="adjustment")item.qty=Number(task.target_qty??task.new_qty??current);
        else item.qty=Math.max(0,current-Number(task.quantity||0));
      }
      item._pending=true;item._pending_count=(item._pending_count||0)+1;
    }
    return [...map.values()];
  }
  function updateSyncLabel(){
    const n=getQueue().length;
    if(!hasCloudConfig)state.sync="Локальный режим";
    else if(state.syncError&&navigator.onLine)state.sync="🔴 Ошибка синхронизации";
    else if(!navigator.onLine)state.sync=n?`🟡 Ожидает (${n})`:"🟠 Офлайн";
    else if(state.syncing)state.sync=n?`🟡 Ожидает (${n})`:"🟡 Синхронизация…";
    else if(n)state.sync=`🟡 Ожидает (${n})`;
    else if(cloudEnabled)state.sync="🟢 Синхронизировано";
    else state.sync="🟡 Подключение…";
    render();
  }
  function subscribe(){
    if(state.subscribed)return;state.subscribed=true;
    sb.channel("kambuz-live-v060")
      .on("postgres_changes",{event:"*",schema:"public",table:"items"},()=>{if(!getQueue().length)loadCloudSilent()})
      .on("postgres_changes",{event:"*",schema:"public",table:"operations"},()=>{if(!getQueue().length)loadCloudSilent()})
      .subscribe();
  }
  async function loadCloudSilent(){
    if(!cloudEnabled||!navigator.onLine)return;
    const [{data:items,error:e1},{data:ops,error:e2}] = await Promise.all([
      sb.from("items").select("*").order("name"),
      sb.from("operations").select("*").order("created_at",{ascending:false}).limit(1000)
    ]);
    if(e1||e2)throw e1||e2;
    const queue=getQueue();
    if(items) state.items=applyPendingOverlay(items,queue);
    repairKnownUnits();
    if(ops){
      const pendingOps=queue.filter(o=>o.kind==="operation").map(o=>({...o,pending:true}));
      const pendingIds=new Set(pendingOps.map(o=>o.id));
      state.ops=[...pendingOps,...ops.filter(o=>!pendingIds.has(o.id))];
    }
    saveLocal();render();
  }
  async function syncPending(){
    if(!cloudEnabled||!navigator.onLine||state.syncing)return;
    let queue=getQueue();
    if(!queue.length){state.syncError=null;state.sync="🟢 Синхронизировано";return}
    state.syncing=true;state.syncError=null;updateSyncLabel();
    const errors=[];
    try{
      // Старые очереди могли содержать операции по локальным товарам без карточки в облаке.
      // Перед каждой такой операцией гарантированно создаём/обновляем карточку товара.
      for(const task of queue){
        if(task.kind!=="operation")continue;
        if(!queue.some(x=>x.kind==="item_upsert"&&x.item_id===task.item_id)){
          const localItem=state.items.find(i=>i.id===task.item_id);
          if(localItem)queue.unshift({id:`item:${localItem.id}`,kind:"item_upsert",item_id:localItem.id,item_name:itemLabel(localItem),item:Object.fromEntries(ITEM_FIELDS.filter(k=>localItem[k]!==undefined).map(k=>[k,localItem[k]])),status:"pending",created_at:now()});
        }
      }
      localStorage.setItem(STORAGE.queue,JSON.stringify(queue));

      for(const task of [...queue]){
        try{
          task.status="sending";task.error=null;localStorage.setItem(STORAGE.queue,JSON.stringify(queue));updateSyncLabel();
          if(task.kind==="item_upsert"){
            const payload={...task.item};
            delete payload.qty;
            // Для новой карточки база сама поставит qty=0; при редактировании существующего товара остаток не перезаписываем.
            const {error}=await sb.from("items").upsert(payload,{onConflict:"id"});
            if(error)throw error;
          }else{
            const {error}=await sb.rpc("kambuz_apply_operation",{
              p_operation_id:task.id,p_item_id:task.item_id,p_type:task.type,
              p_quantity:Number(task.quantity||0),p_target_qty:task.type==="adjustment"?Number(task.target_qty):null,
              p_item_name:task.item_name,p_reason:task.reason,p_comment:task.comment,
              p_user_name:task.user_name,p_unit:task.unit,p_created_at:task.created_at
            });
            if(error)throw error;
            const localOp=state.ops.find(o=>o.id===task.id);if(localOp)localOp.pending=false;
          }
          queue=queue.filter(x=>x.id!==task.id);
          localStorage.setItem(STORAGE.queue,JSON.stringify(queue));
        }catch(e){
          const live=queue.find(x=>x.id===task.id);if(live){live.status="error";live.error=e?.message||"Ошибка синхронизации"}
          errors.push(`${task.item_name||"Товар"}: ${e?.message||"ошибка"}`);
          localStorage.setItem(STORAGE.queue,JSON.stringify(queue));
          // Ошибка одной записи не блокирует остальные.
        }
      }
      if(navigator.onLine)await loadCloudSilent();
      state.lastSync=now();localStorage.setItem("kambuz_last_sync",state.lastSync);
      state.syncError=errors.length?errors.join("; "):null;
      state.sync=errors.length?"🔴 Ошибка синхронизации":"🟢 Синхронизировано";
    }finally{state.syncing=false;updateSyncLabel()}
  }
  function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)}
  function syncClass(){return state.sync.includes("Синхронизировано")?"ok":state.sync.includes("Ошибка")?"bad":state.sync.includes("Ожидает")?"wait":"offline"}
  function syncIcon(){const c=syncClass();return c==="ok"?"✓":c==="wait"?"◷":c==="bad"?"!":"↯"}
  function syncShort(){const c=syncClass(),n=getQueue().length;return c==="ok"?"Онлайн":c==="wait"?`Ожидает${n?` (${n})`:""}`:c==="bad"?"Ошибка":"Офлайн"}
  function itemLabel(i){return [i.brand,i.name].filter(Boolean).join(" ").replace(/\s+/g," ").trim()||"Без названия"}
  function packLabel(i){const v=i.volume??i.weight;return v?`${fmt(v)} ${esc(i.package_unit||i.unit||"")}`:""}
  function normalizedUnit(v){return String(v||"").toLowerCase().trim().replace(/\.$/,"")}
  function packageToBase(i){
    const base=normalizedUnit(i.unit),pack=normalizedUnit(i.package_unit),amount=Number(i.volume??i.weight??0);
    if(!amount||amount<=0)return null;
    if(base==="кг"){if(["г","гр","g"].includes(pack))return amount/1000;if(["кг","kg"].includes(pack))return amount}
    if(base==="л"){if(["мл","ml"].includes(pack))return amount/1000;if(["л","l"].includes(pack))return amount}
    return null;
  }
  function suggestedUnit(i){
    const sub=String(i.subcategory||"").toLowerCase(),name=String(i.name||"").toLowerCase();
    const kgSubs=["птица","субпродукты","свинина","говядина","колбасы","мясная гастрономия","мясные полуфабрикаты","замороженные полуфабрикаты","сыры","сухофрукты","овощи","зелень","фрукты","яблоки","цитрусовые","тропические фрукты","корнеплоды","капуста","томат","перец","салаты","крупы","рис","мука","сахар","кондитерские изделия","сухие завтраки","макаронные изделия","бобовые и крупы"];
    const lNames=["молоко","кефир","сливки","сок","соевый соус","уксус","масло растительное","йогурт питьевой","безалкогольные напитки"];
    if(lNames.some(x=>name.includes(x)))return "л";
    if(kgSubs.some(x=>sub.includes(x)))return "кг";
    return null;
  }
  function repairKnownUnits(){
    let changed=false;
    for(const i of state.items){
      const wanted=suggestedUnit(i);
      if(wanted&&normalizedUnit(i.unit)!==wanted){i.unit=wanted;i.updated_at=now();changed=true;queueItemUpsert(i)}
    }
    if(changed)saveLocal();
    return changed;
  }

  function shell(content){
    return `<div class="app-shell">
      <header class="topbar"><div class="brand"><div class="logo">⚓</div><div><div class="brand-title-row"><h1>Камбуз</h1><span class="app-version">v${APP_VERSION}</span></div><div class="subtitle">${esc(cfg.PROJECT_NAME||"Основной камбуз")}</div></div></div><div class="top-actions"><button class="sync-indicator ${syncClass()}" data-action="sync-panel" aria-label="${esc(state.sync)}" title="${esc(state.sync)}"><span class="sync-glyph">${syncIcon()}</span><span class="sync-mini-label">${esc(syncShort())}</span></button><button class="icon-btn" data-action="profile">👤</button></div></header>
      <button class="sync ${syncClass()}" data-action="sync-panel">${esc(state.sync)} · ${esc(state.user)}</button>
      ${content}
      ${state.tab==="stock"?'<button class="fab" data-action="add-item">＋</button>':''}
    </div>
    <nav class="bottom-nav">${navBtn("home","🏠","Главная")}${navBtn("stock","📦","Склад")}${navBtn("history","🧾","История")}${navBtn("more","•••","Ещё")}</nav>`;
  }
  function navBtn(tab,icon,label){return `<button class="nav-btn ${state.tab===tab?"active":""}" data-tab="${tab}"><span>${icon}</span>${label}</button>`}
  function render(){
    const root=$("#app");
    const views={home,stock,history,more};
    root.innerHTML=shell((views[state.tab]||home)()); bind();
  }

  function home(){
    const low=state.items.filter(i=>Number(i.qty)<=Number(i.min_qty||0)).length;
    const today=new Date().toISOString().slice(0,10);
    const used=state.ops.filter(o=>o.type==="consumption"&&String(o.created_at).slice(0,10)===today).reduce((s,o)=>s+Number(o.quantity),0);
    return `<div class="hero">
      <div><div class="eyebrow">Быстрый учёт</div><h2>Что делаем сейчас?</h2></div>
      <button class="scan-round" data-action="scan">▣</button>
    </div>
    <div class="main-actions">
      ${mainAction("consumption","−","Расход","Взял несколько товаров","green")}
      ${mainAction("receipt","+","Поступление","Принял и разложил","blue")}
    </div>
    <div class="grid stats">${stat(state.items.length,"Позиций")}${stat(low,"Заканчивается")}${stat(fmt(used),"Расход сегодня")}${stat(state.ops.length,"Операций")}</div>
    <div class="section-title"><h2>Рабочие действия</h2></div>
    <div class="grid quick-actions">
      ${quick("🧾","Инвентаризация","Сверить остатки","inventory","a-amber")}
      ${quick("📦","Открыть склад","Поиск и карточки","stock","a-gray")}
      ${quick("📥","Импорт JSON","Добавить каталог","import-json","a-blue")}
      ${quick("📊","Аналитика","Расход и прогноз","analytics","a-green")}
      ${quick("🧮","Сводный отчёт","Молоко · консервация · бакалея","summary-report","a-amber")}
    </div>
    ${low?`<div class="section-title"><h2>Заканчивается</h2><button class="link-btn" data-tab="stock">Все</button></div><div class="card">${state.items.filter(i=>Number(i.qty)<=Number(i.min_qty||0)).slice(0,5).map(itemRow).join("")}</div>`:""}`;
  }
  function mainAction(action,icon,title,sub,cls){return `<button class="main-action ${cls}" data-action="${action}"><span>${icon}</span><div><b>${title}</b><small>${sub}</small></div><i>›</i></button>`}
  function stat(v,l){return `<div class="card stat"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`}
  function quick(icon,title,sub,action,cls){return `<button class="action ${cls}" data-action="${action}"><span class="action-icon">${icon}</span><b>${title}</b><small>${sub}</small></button>`}

  function filteredStockItems(){
    const q=state.query.trim().toLowerCase();
    return state.items.filter(i=>(state.category==="Все"||i.category===state.category)&&`${itemLabel(i)} ${i.barcode||""} ${i.subcategory||""} ${i.notes||""}`.toLowerCase().includes(q));
  }
  function stockListHtml(){
    const filtered=filteredStockItems();
    return filtered.map(itemRow).join("")||'<div class="empty">Ничего не найдено</div>';
  }
  function bindStockItems(scope=document){
    scope.querySelectorAll("[data-item]").forEach(b=>b.onclick=()=>openItem(b.dataset.item));
  }
  function stock(){
    return `<div class="page-head"><div><div class="eyebrow">Каталог</div><h2>Склад</h2></div><button class="secondary compact" data-action="add-item">＋ Товар</button></div>
      <div class="search"><input id="search" placeholder="Название или штрихкод" value="${esc(state.query)}" autocomplete="off"><button class="filter-btn" data-action="scan-search">▣</button></div>
      <div class="chips">${["Все",...CATEGORIES].map(c=>`<button class="chip ${state.category===c?"active":""}" data-category="${c}">${c}</button>`).join("")}</div>
      <div id="stock-list" class="card list-card">${stockListHtml()}</div>`;
  }
  function itemRow(i){
    const low=Number(i.qty)<=Number(i.min_qty||0);
    const pending=pendingForItem(i.id);
    return `<button class="item" data-item="${i.id}"><div class="item-avatar">${esc((i.brand||i.name||"?").slice(0,1).toUpperCase())}</div><div class="item-main"><div class="item-title">${esc(itemLabel(i))}</div><div class="item-meta">${esc(i.subcategory||i.category)}${packLabel(i)?` · ${packLabel(i)}`:""}</div></div><div class="qty-wrap"><div class="qty ${pending?"pending-qty":low?"low":""}">${fmt(i.qty)} ${esc(i.unit)}${pending?'<span class="pending-clock" aria-label="Ожидает синхронизации">◷</span>':""}</div><div class="item-meta ${pending?"pending-text":""}">${pending?`ожидает · ${pending}`:`мин. ${fmt(i.min_qty||0)}`}</div></div></button>`;
  }

  function history(){
    const rows=state.ops.map(o=>{const i=state.items.find(x=>x.id===o.item_id);return `<div class="history-entry ${o.pending?"history-pending":""}"><div class="history-top"><div><span class="badge b-${o.type}">${labelType(o.type)}</span> <b>${esc(i?itemLabel(i):(o.item_name||"Товар"))}</b>${o.pending?'<span class="pending-pill">◷ Ожидает</span>':""}</div><b>${sign(o.type)}${fmt(o.quantity)} ${esc(i?.unit||o.unit||"")}</b></div><div class="item-meta">${new Date(o.created_at).toLocaleString("ru-RU")} · ${esc(o.user_name||"Пользователь")}${o.reason?` · ${esc(o.reason)}`:""}${o.comment?` · ${esc(o.comment)}`:""}</div></div>`}).join("");
    return `<div class="page-head"><div><div class="eyebrow">Журнал</div><h2>История операций</h2></div></div><div class="card">${rows||'<div class="empty">Операций пока нет</div>'}</div>`;
  }
  function more(){return `<div class="page-head"><div><div class="eyebrow">Настройки и отчёты</div><h2>Ещё</h2></div></div>
    <div class="menu-list">
      <button data-action="export"><span>⬇️</span><div><b>Экспорт остатков</b><small>PDF и Word</small></div><i>›</i></button>
      <button data-action="import-json"><span>📥</span><div><b>Импорт каталога</b><small>JSON без дублей</small></div><i>›</i></button>
      <button data-action="analytics"><span>📊</span><div><b>Аналитика</b><small>Расход за период</small></div><i>›</i></button>
      <button data-action="profile"><span>👤</span><div><b>Пользователь</b><small>${esc(state.user)}</small></div><i>›</i></button>
    </div>`}

  function bind(){
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render()});
    document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>handle(b.dataset.action));
    document.querySelectorAll("[data-category]").forEach(b=>b.onclick=()=>{state.category=b.dataset.category;render()});
    bindStockItems(document);
    const s=$("#search");if(s)s.oninput=e=>{
      state.query=e.target.value;
      const list=$("#stock-list");
      if(list){
        list.innerHTML=stockListHtml();
        bindStockItems(list);
      }
    };
  }
  function handle(a){
    if(a==="add-item") itemForm();
    else if(a==="profile") profile();
    else if(a==="inventory") inventory();
    else if(a==="export") exportModal();
    else if(a==="stock"){state.tab="stock";render()}
    else if(a==="consumption"||a==="receipt") openBasket(a);
    else if(a==="import-json") importJson();
    else if(a==="scan"||a==="scan-search") scanBarcode(a==="scan-search"?"search":"quick");
    else if(a==="analytics") analytics();
    else if(a==="summary-report") summaryReport();
    else if(a==="sync-panel") syncPanel();
  }

  function syncPanel(){
    const queue=getQueue();
    const last=state.lastSync?new Date(state.lastSync).toLocaleString("ru-RU"):"ещё не выполнялась";
    const rows=queue.map(o=>{const isItem=o.kind==="item_upsert";const bad=o.status==="error";return `<div class="sync-queue-row ${bad?"queue-error":""}"><div><b>${esc(o.item_name||"Товар")}</b><small>${isItem?"Создание/обновление товара":`${esc(labelType(o.type))} · ${fmt(o.quantity)} ${esc(o.unit||"")}`}${bad?` · ${esc(o.error||"Ошибка")}`:""}</small></div><span>${bad?"!":"◷"}</span></div>`}).join("");
    const el=modal("Синхронизация",`<div class="sync-panel-state ${syncClass()}"><b>${esc(state.sync)}</b><small>${state.syncError?esc(state.syncError):`Последняя синхронизация: ${esc(last)}`}</small></div><div class="compact-title"><b>В очереди: ${queue.length}</b></div><div class="sync-queue">${rows||'<div class="empty small">Очередь пуста</div>'}</div><button class="primary full" id="sync-now" ${!navigator.onLine?'disabled':''}>Синхронизировать сейчас</button>`);
    el.querySelector("#sync-now").onclick=async()=>{state.syncError=null;updateSyncLabel();try{await ensureCloud();await syncPending();await loadCloudSilent();el.remove();toast("Синхронизация завершена")}catch(e){console.error(e);render();el.remove();syncPanel()}};
  }

  function modal(title,body,wide=false){
    const el=document.createElement("div");el.className="modal-backdrop";el.innerHTML=`<div class="modal ${wide?"wide":""}"><div class="modal-head"><h3>${esc(title)}</h3><button class="close">✕</button></div>${body}</div>`;document.body.appendChild(el);el.querySelector(".close").onclick=()=>el.remove();el.onclick=e=>{if(e.target===el)el.remove()};return el;
  }

  function itemForm(item){
    const isEdit=Boolean(item?.id);
    const el=modal(isEdit?"Изменить товар":"Новый товар",`<form class="form" id="item-form">
      <div class="field"><label>Название</label><input name="name" required value="${esc(item?.name||"")}"></div>
      <div class="row"><div class="field"><label>Бренд</label><input name="brand" value="${esc(item?.brand||"")}"></div><div class="field"><label>Штрихкод</label><input name="barcode" inputmode="numeric" value="${esc(item?.barcode||"")}"></div></div>
      <div class="row"><div class="field"><label>Категория</label><select name="category">${CATEGORIES.map(c=>`<option ${item?.category===c?"selected":""}>${c}</option>`).join("")}</select></div><div class="field"><label>Подкатегория</label><input name="subcategory" value="${esc(item?.subcategory||"")}"></div></div>
      <div class="row"><div class="field"><label>Фасовка</label><input name="volume" type="number" step="0.001" value="${esc(item?.volume??item?.weight??"")}"></div><div class="field"><label>Ед. фасовки</label><input name="package_unit" placeholder="мл, г, шт." value="${esc(item?.package_unit||"")}"></div></div>
      <div class="row"><div class="field"><label>Учитывать в</label><select name="unit">${UNITS.map(u=>`<option ${item?.unit===u?"selected":""}>${u}</option>`).join("")}</select></div><div class="field"><label>Минимум</label><input name="min_qty" type="number" step="0.001" value="${esc(item?.min_qty??0)}"></div></div>
      <div class="field"><label>Место хранения</label><input name="location" value="${esc(item?.location||"Основной склад")}"></div>
      <div class="field"><label>Примечание</label><textarea name="notes">${esc(item?.notes||"")}</textarea></div>
      <button class="primary" type="submit">Сохранить</button>
    </form>`);
    el.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const payload={name:f.name.trim(),brand:f.brand.trim()||null,barcode:normalizeBarcode(f.barcode)||null,category:f.category,subcategory:f.subcategory.trim()||null,volume:f.volume?Number(f.volume):null,package_unit:f.package_unit.trim()||null,unit:f.unit,min_qty:Number(f.min_qty||0),location:f.location.trim()||"Основной склад",notes:f.notes.trim()||null,updated_at:now()};
      if(payload.barcode){const dup=state.items.find(x=>x.barcode===payload.barcode&&x.id!==(isEdit?item.id:null));if(dup){toast("Такой штрихкод уже есть");return}}
      try{
        let saved;
        if(isEdit){Object.assign(item,payload);saved=item}else{saved={id:uid(),qty:0,...payload};state.items.push(saved)}
        saveLocal();queueItemUpsert(saved);el.remove();render();toast(navigator.onLine?"Товар сохранён — синхронизирую":"Товар сохранён офлайн — ожидает синхронизации");
        if(navigator.onLine){try{await ensureCloud();await syncPending()}catch(err){console.error(err)}}
      }catch(err){console.error(err);toast("Не удалось сохранить товар")}
    };
  }

  function openItem(id){
    const i=state.items.find(x=>x.id===id);if(!i)return;
    const itemOps=state.ops.filter(o=>o.item_id===i.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const monthAgo=Date.now()-30*86400000;
    const used30=itemOps.filter(o=>o.type==="consumption"&&new Date(o.created_at).getTime()>=monthAgo).reduce((sum,o)=>sum+Number(o.quantity||0),0);
    const lastReceipt=itemOps.find(o=>o.type==="receipt");
    const lastUse=itemOps.find(o=>o.type==="consumption");
    const history=itemOps.slice(0,8).map(o=>`<div class="mini-history"><span><b>${labelType(o.type)}</b><small>${new Date(o.created_at).toLocaleString("ru-RU")} · ${esc(o.user_name||"Пользователь")}</small></span><strong>${sign(o.type)}${fmt(o.quantity)} ${esc(o.unit||i.unit)}</strong></div>`).join("")||'<div class="empty small">По товару ещё нет операций</div>';
    const pending=pendingForItem(i.id);
    const el=modal(itemLabel(i),`<div class="detail-card"><div class="big-qty ${pending?"pending-qty":""}">${fmt(i.qty)} <span>${esc(i.unit)}</span>${pending?'<span class="pending-clock big">◷</span>':""}</div>${pending?`<div class="detail-pending">◷ Изменение сохранено на телефоне и ожидает синхронизации</div>`:""}<div class="detail-grid"><div><small>Расход за 30 дней</small><b>${fmt(used30)} ${esc(i.unit)}</b></div><div><small>Минимальный остаток</small><b>${fmt(i.min_qty||0)} ${esc(i.unit)}</b></div><div><small>Последний расход</small><b>${lastUse?new Date(lastUse.created_at).toLocaleDateString("ru-RU"):"—"}</b></div><div><small>Последнее поступление</small><b>${lastReceipt?new Date(lastReceipt.created_at).toLocaleDateString("ru-RU"):"—"}</b></div><div><small>Фасовка</small><b>${packLabel(i)||"—"}</b></div><div><small>Штрихкод</small><b>${esc(i.barcode||"—")}</b></div></div></div>
      <div class="detail-actions"><button class="consumption" data-op="consumption">− Расход</button><button class="receipt" data-op="receipt">＋ Поступление</button><button class="writeoff" data-op="writeoff">Списание</button><button class="edit" data-edit>Изменить</button><button class="adjustment" data-op="adjustment">Исправить остаток</button></div>
      <div class="section-title compact-title"><h2>Последние операции</h2></div><div class="mini-history-list">${history}</div>`);
    el.querySelectorAll("[data-op]").forEach(b=>b.onclick=()=>{el.remove();singleOperation(i,b.dataset.op)});
    el.querySelector("[data-edit]").onclick=()=>{el.remove();itemForm(i)};
  }

  function openBasket(type){
    state.basket={type,lines:[]};
    const title=type==="consumption"?"Быстрый расход":"Массовое поступление";
    const el=modal(title,`<div class="basket-tools"><div class="search basket-search"><input id="basket-search" placeholder="Название или штрихкод"><button type="button" id="basket-scan" class="filter-btn">▣</button></div><div id="basket-results" class="search-results"></div></div><div id="basket-lines"></div><div class="basket-footer"><div><small>Позиций</small><b id="basket-count">0</b></div><button class="primary" id="basket-save" disabled>${type==="consumption"?"Списать всё":"Принять всё"}</button></div>`,true);
    const input=el.querySelector("#basket-search"),results=el.querySelector("#basket-results");
    const drawResults=()=>{const q=input.value.trim().toLowerCase();if(!q){results.innerHTML="";return}const list=state.items.filter(i=>`${itemLabel(i)} ${i.barcode||""}`.toLowerCase().includes(q)).slice(0,8);results.innerHTML=list.map(i=>`<button data-add="${i.id}"><span>${esc(itemLabel(i))}</span><b>${fmt(i.qty)} ${esc(i.unit)}</b></button>`).join("")||'<div class="empty small">Не найдено</div>';results.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{addBasketLine(b.dataset.add);input.value="";results.innerHTML="";drawBasket(el)})};
    input.oninput=drawResults;el.querySelector("#basket-scan").onclick=()=>scanBarcodeToBasket(el);
    el.querySelector("#basket-save").onclick=()=>commitBasket(el);
    setTimeout(()=>input.focus(),100);
  }
  function addBasketLine(id){const found=state.basket.lines.find(x=>x.item_id===id);if(found)found.quantity+=1;else state.basket.lines.push({item_id:id,quantity:1})}
  function drawBasket(el){
    const box=el.querySelector("#basket-lines");box.innerHTML=state.basket.lines.length?`<div class="basket-list">${state.basket.lines.map((l,n)=>{const i=state.items.find(x=>x.id===l.item_id);return `<div class="basket-line"><div><b>${esc(itemLabel(i))}</b><small>Остаток: ${fmt(i.qty)} ${esc(i.unit)}</small></div><div class="stepper"><button data-minus="${n}">−</button><input data-qty="${n}" type="number" min="0.001" step="0.001" value="${l.quantity}"><button data-plus="${n}">＋</button></div><button class="remove" data-remove="${n}">✕</button></div>`}).join("")}</div>`:'<div class="empty">Добавь товары через поиск или сканер</div>';
    box.querySelectorAll("[data-minus]").forEach(b=>b.onclick=()=>{const l=state.basket.lines[+b.dataset.minus];l.quantity=Math.max(.001,Number(l.quantity)-1);drawBasket(el)});
    box.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>{state.basket.lines[+b.dataset.plus].quantity=Number(state.basket.lines[+b.dataset.plus].quantity)+1;drawBasket(el)});
    box.querySelectorAll("[data-qty]").forEach(inp=>inp.onchange=()=>{state.basket.lines[+inp.dataset.qty].quantity=Math.max(.001,Number(inp.value)||1);drawBasket(el)});
    box.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{state.basket.lines.splice(+b.dataset.remove,1);drawBasket(el)});
    el.querySelector("#basket-count").textContent=state.basket.lines.length;el.querySelector("#basket-save").disabled=!state.basket.lines.length;
  }
  async function commitBasket(el){
    const type=state.basket.type;const lines=state.basket.lines;
    for(const line of lines){const i=state.items.find(x=>x.id===line.item_id);if(type==="consumption"&&Number(line.quantity)>Number(i.qty)){toast(`Недостаточно: ${itemLabel(i)}`);return}}
    try{for(const line of lines){const i=state.items.find(x=>x.id===line.item_id);const prev=Number(i.qty),delta=Number(line.quantity),next=type==="receipt"?prev+delta:prev-delta;await persistOperation(i,type,delta,prev,next)}el.remove();await reload();toast(type==="receipt"?"Поступление сохранено":"Расход сохранён")}catch(err){console.error(err);toast("Не удалось сохранить операцию")}
  }

  function singleOperation(i,type){
    const isAdjustment=type==="adjustment";
    const factor=packageToBase(i);
    const canUsePieces=!isAdjustment&&factor&&["кг","л"].includes(normalizedUnit(i.unit));
    const operationWord=type==="receipt"?"поступит":"спишется";
    const el=modal(isAdjustment?"Исправить остаток":labelType(type),`<form class="form smart-operation"><div class="field"><label>Товар</label><input disabled value="${esc(itemLabel(i))}"></div>
      <div class="field"><label>${isAdjustment?"Фактическое количество":`Количество в ${esc(i.unit)}`}</label><input name="quantity" data-base-qty type="number" inputmode="decimal" min="0" step="0.001" value="${isAdjustment?esc(i.qty):""}" ${canUsePieces?"":"required"}></div>
      ${canUsePieces?`<div class="smart-or"><span>или</span></div><div class="field"><label>Количество упаковок / штук</label><input name="pieces" data-piece-qty type="number" inputmode="decimal" min="0" step="0.001" placeholder="Например, 2"><small>Фасовка одной штуки: ${packLabel(i)}</small></div><div class="conversion-preview" data-conversion-preview>Введи вес/объём или количество штук</div>`:""}
      ${type==="writeoff"?`<div class="field"><label>Причина</label><select name="reason">${WRITE_OFF_REASONS.map(r=>`<option>${r}</option>`).join("")}</select></div>`:""}${isAdjustment?"":`<div class="field"><label>Комментарий</label><input name="comment"></div>`}<button class="primary" type="submit">Сохранить количество</button></form>`);
    const baseInput=el.querySelector('[data-base-qty]'),pieceInput=el.querySelector('[data-piece-qty]'),preview=el.querySelector('[data-conversion-preview]');
    if(isAdjustment){setTimeout(()=>{baseInput.focus();baseInput.select()},80)}
    if(canUsePieces){
      const updatePreview=()=>{
        const pieces=Number(pieceInput.value||0),base=Number(baseInput.value||0);
        if(pieces>0){preview.textContent=`${fmt(pieces)} шт. × ${packLabel(i)} → ${operationWord} ${fmt(pieces*factor)} ${i.unit}`;preview.classList.add("active")}
        else if(base>0){preview.textContent=`${operationWord[0].toUpperCase()+operationWord.slice(1)} ${fmt(base)} ${i.unit}`;preview.classList.add("active")}
        else{preview.textContent="Введи вес/объём или количество штук";preview.classList.remove("active")}
      };
      pieceInput.oninput=()=>{if(pieceInput.value)baseInput.value="";updatePreview()};
      baseInput.oninput=()=>{if(baseInput.value)pieceInput.value="";updatePreview()};
    }
    el.querySelector("form").onsubmit=async e=>{
      e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
      let q=Number(f.quantity||0);if(canUsePieces&&Number(f.pieces)>0)q=Number(f.pieces)*factor;
      if(!Number.isFinite(q)||q<=0){toast("Укажи количество");return}
      const prev=Number(i.qty);let next=prev;if(type==="receipt")next=prev+q;else if(type==="adjustment")next=q;else next=prev-q;
      if(next<0){toast(`Недостаточный остаток: доступно ${fmt(prev)} ${i.unit}`);return}
      try{await persistOperation(i,type,type==="adjustment"?Math.abs(next-prev):q,prev,next,f.reason||null,f.comment||null);el.remove();await reload();toast("Операция сохранена")}catch(err){console.error(err);toast("Ошибка операции")}
    };
  }
  async function persistOperation(i,type,quantity,previous_qty,new_qty,reason=null,comment=null){
    const op={id:uid(),item_id:i.id,item_name:itemLabel(i),type,quantity,reason,comment,user_name:state.user,unit:i.unit,previous_qty,new_qty,target_qty:type==="adjustment"?new_qty:null,created_at:now(),pending:hasCloudConfig};
    i.qty=new_qty;state.ops.unshift(op);
    if(!hasCloudConfig){saveLocal();render();return {queued:false}}
    const queue=getQueue();queue.push({...op,kind:"operation",status:"pending"});
    localStorage.setItem(STORAGE.queue,JSON.stringify(queue));
    saveLocal();render();updateSyncLabel();
    if(!navigator.onLine){toast("Сохранено без интернета — отправлю позже");return {queued:true}}
    try{await ensureCloud();await syncPending();return {queued:false}}catch(e){console.error(e);updateSyncLabel();toast("Сохранено на телефоне — синхронизирую позже");return {queued:true}}
  }

  function inventory(){
    const el=modal("Инвентаризация",`<div class="inventory-list">${state.items.map(i=>`<div class="inventory-row"><div><b>${esc(itemLabel(i))}</b><small>${fmt(i.qty)} ${esc(i.unit)} по базе</small></div><input data-inv="${i.id}" type="number" step="0.001" value="${i.qty}"></div>`).join("")||'<div class="empty">Каталог пуст</div>'}</div><button class="primary full" id="save-inventory">Сохранить расхождения</button>`,true);
    el.querySelector("#save-inventory").onclick=async()=>{const changes=[...el.querySelectorAll("[data-inv]")].map(inp=>({i:state.items.find(x=>x.id===inp.dataset.inv),next:Number(inp.value)})).filter(x=>x.next!==Number(x.i.qty));try{for(const x of changes)await persistOperation(x.i,"adjustment",Math.abs(x.next-Number(x.i.qty)),Number(x.i.qty),x.next,null,"Инвентаризация");el.remove();await reload();toast(`Сохранено изменений: ${changes.length}`)}catch(e){console.error(e);toast("Ошибка инвентаризации")}};
  }

  function profile(){const el=modal("Пользователь",`<form class="form"><div class="field"><label>Имя в истории</label><input name="user" value="${esc(state.user)}"></div><button class="primary">Сохранить</button></form>`);el.querySelector("form").onsubmit=e=>{e.preventDefault();state.user=new FormData(e.target).get("user").trim()||"Пользователь";localStorage.setItem("kambuz_user",state.user);el.remove();render();toast("Пользователь изменён")}}

  function importJson(){
    const el=modal("Импорт каталога",`<div class="import-box"><div class="drop-zone"><div class="drop-icon">📥</div><b>Выбери JSON-файл</b><small>Поддерживаются файлы каталога «Камбуз» и обычные массивы товаров. Совпадения по штрихкоду обновятся, новые позиции добавятся с нулевым остатком.</small><input id="json-file" type="file" accept="application/json,.json"></div><div id="import-preview"></div></div>`);
    const inp=el.querySelector("#json-file"),preview=el.querySelector("#import-preview");
    inp.onchange=async()=>{
      const file=inp.files?.[0];if(!file)return;
      try{
        const raw=JSON.parse(await file.text());
        const products = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.products)
            ? raw.products
            : Array.isArray(raw?.items)
              ? raw.items
              : null;
        if(!products)throw new Error("Не найден массив products/items или корневой массив");
        const normalized=products.map(normalizeImport).filter(x=>x.name);
        if(!normalized.length)throw new Error("В файле нет подходящих товаров");
        const seen=new Set();
        const duplicateInFile=normalized.filter(x=>x.barcode&&(seen.has(x.barcode)||!seen.add(x.barcode))).length;
        const updates=normalized.filter(x=>x.barcode&&state.items.some(i=>i.barcode===x.barcode)).length;
        const withoutBarcode=normalized.filter(x=>!x.barcode).length;
        preview.innerHTML=`<div class="import-summary"><div><b>${normalized.length}</b><small>товаров</small></div><div><b>${updates}</b><small>обновятся</small></div><div><b>${normalized.length-updates}</b><small>добавятся</small></div></div>${withoutBarcode?`<div class="import-note">Без штрихкода: ${withoutBarcode}. Такие позиции будут сопоставляться по названию и бренду.</div>`:""}${duplicateInFile?`<div class="error-box">Внутри файла повторяются штрихкоды: ${duplicateInFile}</div>`:""}<button class="primary full" id="confirm-import">Импортировать ${normalized.length} товаров</button>`;
        preview.querySelector("#confirm-import").onclick=()=>runImport(normalized,el);
      }catch(e){preview.innerHTML=`<div class="error-box">Не удалось прочитать файл: ${esc(e.message)}</div>`}
    }
  }
  function normalizeImport(x){
    const cat=x.category==="Бытовая химия"?"Химия":["Бумажная продукция","Гигиена"].includes(x.category)?"Хозтовары":(CATEGORIES.includes(x.category)?x.category:"Хозтовары");
    const volume=x.packageQuantity??x.volume??x.weight??null;
    const packageUnit=x.packageUnit??x.package_unit??(x.volume!=null?"мл":x.weight!=null?"г":null);
    const noteParts=[x.notes,x.status&&x.status!=="confirmed"?`Статус каталога: ${x.status}`:null,x.originalName?`Оригинальное название: ${x.originalName}`:null].filter(Boolean);
    return {barcode:normalizeBarcode(x.barcode)||null,brand:String(x.brand||"").trim()||null,name:String(x.name||"").trim(),category:cat,subcategory:String(x.subcategory||"").trim()||null,volume:volume!=null&&volume!==""?Number(volume):null,package_unit:String(packageUnit||"").trim()||null,unit:String(x.unit||x.stockUnit||x.stock_unit||guessStockUnit(x,cat)),min_qty:Number(x.minQty??x.min_qty??0),location:String(x.location||"Основной склад"),notes:noteParts.join(" · ")||null,updated_at:now()};
  }
  function guessStockUnit(x,cat){if(cat==="Химия")return "бут.";if(String(x.subcategory||"").toLowerCase().includes("бумаг"))return "рулон";return "шт."}
  async function runImport(rows,el){
    try{let added=0,updated=0,skipped=0;const processed=new Set();for(const row of rows){const key=row.barcode?`b:${row.barcode}`:`n:${(row.brand||"").toLowerCase()}|${row.name.toLowerCase()}`;if(processed.has(key)){skipped++;continue}processed.add(key);const existing=row.barcode?state.items.find(i=>i.barcode===row.barcode):state.items.find(i=>(i.brand||"").toLowerCase()===(row.brand||"").toLowerCase()&&String(i.name||"").toLowerCase()===row.name.toLowerCase());if(cloudEnabled){if(existing){const {error}=await sb.from("items").update(row).eq("id",existing.id);if(error)throw error;updated++}else{const {error}=await sb.from("items").insert({...row,qty:0});if(error)throw error;added++}}else{if(existing){Object.assign(existing,row);updated++}else{state.items.push({id:uid(),qty:0,...row});added++}}}if(!cloudEnabled)saveLocal();el.remove();await reload();toast(`Добавлено ${added}, обновлено ${updated}${skipped?`, пропущено дублей ${skipped}`:""}`)}catch(e){console.error(e);toast(`Ошибка импорта: ${e.message||"проверь структуру базы"}`)}
  }

  async function scanBarcode(mode="quick"){
    const el=modal("Сканировать штрихкод",`<div class="scanner"><video id="scanner-video" playsinline muted></video><div class="scan-frame"></div><p id="scan-status">Наведи камеру на штрихкод</p><div class="field"><label>Или введи вручную</label><div class="manual-barcode"><input id="manual-code" inputmode="numeric"><button class="primary" id="manual-find">Найти</button></div></div></div>`);
    const finish=code=>{const normalized=normalizeBarcode(code);if(!normalized){toast("Введи штрихкод");return}stopScanner(el);el.remove();const item=state.items.find(i=>i.barcode===normalized);if(!item){unknownBarcode(normalized,mode);return}if(mode==="search"){state.tab="stock";state.query=item.barcode;render()}else quickScannedItem(item)};
    el.querySelector("#manual-find").onclick=()=>finish(el.querySelector("#manual-code").value);
    await startCameraScanner(el,finish);
  }
  async function scanBarcodeToBasket(parent){
    const el=modal("Добавить сканированием",`<div class="scanner"><video id="scanner-video" playsinline muted></video><div class="scan-frame"></div><p id="scan-status">Сканируй товары подряд — каждый скан добавит 1</p><div class="scan-basket-count">Добавлено: <b id="scan-added">0</b></div><div class="field"><label>Или введи штрихкод</label><div class="manual-barcode"><input id="manual-code" inputmode="numeric"><button class="primary" id="manual-find">Добавить</button></div></div><button class="secondary full" id="scan-done">Готово</button></div>`);
    let added=0,lastCode="",lastAt=0;
    const add=code=>{const normalized=normalizeBarcode(code);if(!normalized)return;const t=Date.now();if(normalized===lastCode&&t-lastAt<1500)return;lastCode=normalized;lastAt=t;const item=state.items.find(i=>i.barcode===normalized);if(!item){toast("Неизвестный штрихкод");return}addBasketLine(item.id);drawBasket(parent);added++;el.querySelector("#scan-added").textContent=added;toast(`${itemLabel(item)} добавлен`)};
    el.querySelector("#manual-find").onclick=()=>{add(el.querySelector("#manual-code").value);el.querySelector("#manual-code").value=""};
    el.querySelector("#scan-done").onclick=()=>{stopScanner(el);el.remove()};
    await startCameraScanner(el,add,true);
  }
  async function startCameraScanner(el,onCode,continuous=false){
    try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}});const video=el.querySelector("#scanner-video");video.srcObject=stream;await video.play();el._stream=stream;if("BarcodeDetector" in window){const detector=new BarcodeDetector({formats:["ean_13","ean_8","code_128","upc_a","upc_e"]});let active=true;el._stop=()=>active=false;const tick=async()=>{if(!active||!document.body.contains(el))return;try{const codes=await detector.detect(video);if(codes[0]?.rawValue){onCode(codes[0].rawValue);if(!continuous)return}}catch{}setTimeout(tick,180)};tick()}else el.querySelector("#scan-status").textContent="Автосканер не поддерживается — введи код вручную"}catch(e){el.querySelector("#scan-status").textContent="Камера недоступна — введи код вручную"}
  }
  function quickScannedItem(item){
    const el=modal("Товар найден",`<div class="scan-found"><div class="item-avatar large">${esc((item.brand||item.name||"?").slice(0,1).toUpperCase())}</div><h3>${esc(itemLabel(item))}</h3><p>${esc(item.subcategory||item.category)}${packLabel(item)?` · ${packLabel(item)}`:""}</p><div class="big-qty">${fmt(item.qty)} <span>${esc(item.unit)}</span></div></div><div class="detail-actions"><button class="consumption" data-quick="consumption">− Расход</button><button class="receipt" data-quick="receipt">+ Поступление</button><button class="edit" data-card>Карточка</button><button class="secondary" data-scan-again>Сканировать ещё</button></div>`);
    el.querySelectorAll("[data-quick]").forEach(b=>b.onclick=()=>{const type=b.dataset.quick;el.remove();singleOperation(item,type)});
    el.querySelector("[data-card]").onclick=()=>{el.remove();openItem(item.id)};
    el.querySelector("[data-scan-again]").onclick=()=>{el.remove();scanBarcode("quick")};
  }
  function unknownBarcode(code,mode){
    const el=modal("Товар не найден",`<div class="unknown-code"><div>Штрихкод</div><b>${esc(code)}</b><p>Такого товара ещё нет в каталоге.</p></div><button class="primary full" id="create-unknown">Создать товар</button><button class="secondary full" id="cancel-unknown">Отмена</button>`);
    el.querySelector("#create-unknown").onclick=()=>{el.remove();itemForm({barcode:code,category:"Хозтовары",unit:"шт.",min_qty:0,location:"Основной склад",name:""})};
    el.querySelector("#cancel-unknown").onclick=()=>el.remove();
  }
  function stopScanner(el){el._stop?.();el._stream?.getTracks().forEach(t=>t.stop())}

  function analytics(){
    const days=30,from=Date.now()-days*86400000;const rows=state.ops.filter(o=>o.type==="consumption"&&new Date(o.created_at).getTime()>=from);const map={};for(const o of rows){const i=state.items.find(x=>x.id===o.item_id);const key=o.item_id||o.item_name;(map[key]??={name:i?itemLabel(i):o.item_name||"Товар",unit:i?.unit||o.unit||"",qty:0}).qty+=Number(o.quantity)}const top=Object.values(map).sort((a,b)=>b.qty-a.qty).slice(0,20);
    modal("Аналитика за 30 дней",`<div class="analytics-summary"><div><b>${rows.length}</b><small>операций расхода</small></div><div><b>${top.length}</b><small>товаров использовали</small></div></div><div class="analytics-list">${top.map((x,n)=>`<div><span>${n+1}. ${esc(x.name)}</span><b>${fmt(x.qty)} ${esc(x.unit)}</b></div>`).join("")||'<div class="empty">Пока нет расхода за период</div>'}</div>`);
  }

  const REPORT_GROUPS = [
    {id:"milk",name:"Молоко",unit:"л"},
    {id:"preserves",name:"Консервация",unit:"кг"},
    {id:"grocery",name:"Бакалея",unit:"кг"}
  ];
  function reportText(i){return `${i.name||""} ${i.brand||""} ${i.subcategory||""} ${i.notes||""}`.toLowerCase().replace(/ё/g,"е")}
  function reportGroup(i){
    const t=reportText(i);
    if(/молоко/.test(t)&&!/сгущ|сухое|кокос|миндал|соев/.test(t))return "milk";
    if(/консерв|консерва|лечо|икра кабач|икра из баклаж|шпрот|паштет|оливк|маслин|корнишон|горошек|кукуруз|сайра|горбуш|тунец|фасоль/.test(t))return "preserves";
    if(/круп|греч|рис|булгур|перлов|манн|пшенич|горох колот|макарон|мук|сахар|овсян|мюсли|хлоп|масло раст/.test(t))return "grocery";
    return null;
  }
  function normalizedPackage(i){
    const v=Number(i.volume??i.weight??0);
    const u=String(i.package_unit||"").toLowerCase().trim().replace(".","");
    if(!v)return null;
    if(["кг","kg"].includes(u))return {kg:v};
    if(["г","гр","g"].includes(u))return {kg:v/1000};
    if(["л","l"].includes(u))return {l:v};
    if(["мл","ml"].includes(u))return {l:v/1000};
    return null;
  }
  function itemReportAmount(i,group){
    const qty=Number(i.qty||0),unit=String(i.unit||"").toLowerCase().trim().replace(".","");
    const pack=normalizedPackage(i);
    if(group==="milk"){
      if(["л","l"].includes(unit))return qty;
      if(["мл","ml"].includes(unit))return qty/1000;
      if(pack?.l)return qty*pack.l;
      return null;
    }
    if(["кг","kg"].includes(unit))return qty;
    if(["г","гр","g"].includes(unit))return qty/1000;
    if(pack?.kg)return qty*pack.kg;
    if(group==="grocery"&&/масло раст/.test(reportText(i))){
      const liters=["л","l"].includes(unit)?qty:["мл","ml"].includes(unit)?qty/1000:pack?.l?qty*pack.l:null;
      return liters==null?null:liters*0.92;
    }
    return null;
  }
  function unresolvedReportReason(i,group){
    const qty=Number(i.qty||0),unit=String(i.unit||"").trim().toLowerCase().replace(/\.$/,"");
    const volume=Number(i.volume??i.weight??0),packageUnit=String(i.package_unit||"").trim().toLowerCase().replace(/\.$/,"");
    if(!Number.isFinite(qty))return "Некорректный остаток";
    if(["шт","штук","бут","бан","уп","упак","пач","кор","рулон"].includes(unit)){
      if(!volume||volume<=0)return "Не указана фасовка";
      if(!packageUnit)return "Не указана единица фасовки";
      const allowed=group==="milk"?["мл","ml","л","l"]:["г","гр","g","кг","kg","мл","ml","л","l"];
      if(!allowed.includes(packageUnit))return `Неподходящая единица фасовки: ${i.package_unit}`;
      return "Фасовка не распознана";
    }
    if(group==="milk"&&!(["л","l","мл","ml"].includes(unit)))return `Нужны литры или миллилитры, сейчас: ${i.unit||"не указано"}`;
    if(group!=="milk"&&!(["кг","kg","г","гр","g","л","l","мл","ml"].includes(unit)))return `Неподходящая единица учёта: ${i.unit||"не указано"}`;
    return "Не удалось определить способ пересчёта";
  }
  function buildSummaryReport(){
    const totals=Object.fromEntries(REPORT_GROUPS.map(g=>[g.id,0]));
    const details=Object.fromEntries(REPORT_GROUPS.map(g=>[g.id,[]]));
    const unresolved=[];
    for(const i of state.items){
      const group=reportGroup(i);if(!group)continue;
      const amount=itemReportAmount(i,group);
      if(amount==null){unresolved.push({item:i,group,reason:unresolvedReportReason(i,group)});continue}
      totals[group]+=amount;details[group].push({item:i,amount});
    }
    return {totals,details,unresolved};
  }
  function showUnresolvedReportItems(rows){
    const body=rows.map(x=>{const g=REPORT_GROUPS.find(y=>y.id===x.group);return `<div class="report-problem-row"><div><b>${esc(itemLabel(x.item))}</b><small>${esc(g?.name||"")} · Остаток: ${fmt(x.item.qty)} ${esc(x.item.unit||"")}${packLabel(x.item)?` · Фасовка: ${esc(packLabel(x.item))}`:""}</small><em>${esc(x.reason)}</em></div><button class="secondary report-fix-btn" data-fix-report-item="${x.item.id}">Исправить</button></div>`}).join("");
    const problemModal=modal("Что нужно исправить",`<div class="report-problem-hint">Нажми «Исправить» у товара, укажи фасовку и её единицу, затем снова открой отчёт.</div><div class="report-problem-list">${body}</div>`);
    problemModal.querySelectorAll("[data-fix-report-item]").forEach(b=>b.onclick=()=>{const item=state.items.find(i=>i.id===b.dataset.fixReportItem);if(!item)return;problemModal.remove();itemForm(item)});
  }
  function summaryReport(){
    const r=buildSummaryReport();
    const rows=REPORT_GROUPS.map(g=>`<button class="report-row" data-report-group="${g.id}"><span><b>${esc(g.name)}</b><small>${r.details[g.id].length} позиций</small></span><strong>${fmt(r.totals[g.id])} ${g.unit}</strong><i>›</i></button>`).join("");
    const warning=r.unresolved.length?`<button class="report-warning" id="show-unresolved-report"><span><b>⚠️ Не удалось пересчитать: ${r.unresolved.length}</b><small>Нажми, чтобы увидеть товары и исправить фасовку.</small></span><i>›</i></button>`:"";
    const el=modal("Пробный сводный отчёт",`<div class="report-date">Остатки на ${new Date().toLocaleString("ru-RU")}</div><div class="report-list">${rows}</div>${warning}<div class="report-note">Растительное масло временно пересчитывается по коэффициенту <b>0,92 кг/л</b>.</div><button class="primary full" id="copy-summary-report">Скопировать отчёт</button>`);
    el.querySelectorAll("[data-report-group]").forEach(b=>b.onclick=()=>{const id=b.dataset.reportGroup,g=REPORT_GROUPS.find(x=>x.id===id);modal(g.name,`<div class="analytics-list">${r.details[id].map(x=>`<div><span>${esc(itemLabel(x.item))}<small>${fmt(x.item.qty)} ${esc(x.item.unit)}${packLabel(x.item)?` · ${packLabel(x.item)}`:""}</small></span><b>${fmt(x.amount)} ${g.unit}</b></div>`).join("")||'<div class="empty">Подходящих товаров пока нет</div>'}</div>`)});
    el.querySelector("#show-unresolved-report")?.addEventListener("click",()=>showUnresolvedReportItems(r.unresolved));
    el.querySelector("#copy-summary-report").onclick=async()=>{const text=[`Сводный остаток на ${new Date().toLocaleDateString("ru-RU")}`,...REPORT_GROUPS.map(g=>`${g.name} — ${fmt(r.totals[g.id])} ${g.unit}`)].join("\n");try{await navigator.clipboard.writeText(text);toast("Отчёт скопирован")}catch{toast("Не удалось скопировать")}};
  }

  function exportModal(){const el=modal("Экспорт остатков",`<div class="form"><div class="field"><label>Категория</label><select id="export-category"><option>Все</option>${CATEGORIES.map(c=>`<option>${c}</option>`).join("")}</select></div><button class="primary" id="export-pdf">PDF / печать</button><button class="secondary" id="export-doc">Word (.doc)</button></div>`);el.querySelector("#export-pdf").onclick=()=>exportPdf(el.querySelector("#export-category").value);el.querySelector("#export-doc").onclick=()=>exportDoc(el.querySelector("#export-category").value)}
  function exportItems(cat){return state.items.filter(i=>cat==="Все"||i.category===cat)}
  function exportPdf(cat){const items=exportItems(cat);const w=window.open("","_blank");w.document.write(`<html><head><meta charset="utf-8"><title>Остатки Камбуз</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #aaa;padding:7px}h1{margin-bottom:4px}.muted{color:#666}</style></head><body><h1>Инвентаризационная ведомость</h1><p class="muted">${new Date().toLocaleDateString("ru-RU")} · ${esc(cat)}</p><table><tr><th>№</th><th>Наименование</th><th>По базе</th><th>Ед.</th><th>Факт</th><th>Разница</th></tr>${items.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(itemLabel(i))}</td><td>${fmt(i.qty)}</td><td>${esc(i.unit)}</td><td></td><td></td></tr>`).join("")}</table><p>Подпись: __________________</p><script>print()</script></body></html>`);w.document.close()}
  function exportDoc(cat){const items=exportItems(cat);const html=`<html><meta charset="utf-8"><body><h1>Инвентаризационная ведомость</h1><p>${new Date().toLocaleDateString("ru-RU")} · ${esc(cat)}</p><table border="1" cellspacing="0" cellpadding="6"><tr><th>№</th><th>Наименование</th><th>Остаток</th><th>Ед.</th><th>Факт</th></tr>${items.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(itemLabel(i))}</td><td>${fmt(i.qty)}</td><td>${esc(i.unit)}</td><td></td></tr>`).join("")}</table><p>Подпись: __________________</p></body></html>`;download(new Blob(["\ufeff",html],{type:"application/msword"}),`kambuz-${new Date().toISOString().slice(0,10)}.doc`)}
  function download(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function labelType(t){return ({consumption:"Расход",receipt:"Поступление",writeoff:"Списание",adjustment:"Корректировка"})[t]||t}
  function sign(t){return t==="receipt"?"+":t==="adjustment"?"±":"−"}
  async function reload(){
    if(cloudEnabled&&navigator.onLine&&!getQueue().length){try{await loadCloudSilent()}catch(e){console.error(e);updateSyncLabel()}}
    else render();
  }
  window.addEventListener("online",async()=>{state.syncError=null;state.sync="🟡 Синхронизация…";render();try{await connectCloudAndSync();toast(getQueue().length?"Связь есть, операции ещё ожидают отправки":"Связь появилась — данные синхронизированы")}catch(e){console.error(e);updateSyncLabel();toast("Данные ждут отправки — повторю при следующем подключении")}});
  window.addEventListener("offline",()=>{state.syncError=null;updateSyncLabel();toast("Нет интернета — работаем офлайн")});
  if("serviceWorker" in navigator)navigator.serviceWorker.register("service-worker.js?v=0.7.1", {scope:"./"})
    .then(reg=>reg.update().catch(()=>{}))
    .catch(console.error);
  load();
})();
