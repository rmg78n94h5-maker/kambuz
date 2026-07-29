(() => {
  const CATEGORIES = ["Химия","Хозтовары","Посуда","Инвентарь","Продукты"];
  const UNITS = ["шт.","бут.","упак.","рулон","пачка","кг","г","л","мл","компл."];
  const WRITE_OFF_REASONS = ["Брак","Повреждение","Протечка","Разбилось","Просрочено","Потеряно","Выброшено","Ошибка поставки","Другое"];
  const cfg = window.KAMBUZ_CONFIG || {};
  const cloudEnabled = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = cloudEnabled ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const state = {
    tab:"home", items:[], ops:[], query:"", category:"Все",
    user:localStorage.getItem("kambuz_user") || "Никита",
    sync:cloudEnabled?(navigator.onLine?"Подключение…":"Офлайн") : "Локальный режим",
    basket:{type:"consumption",lines:[]}, syncing:false, subscribed:false
  };
  const STORAGE = {items:"kambuz_items",ops:"kambuz_ops",queue:"kambuz_pending_ops"};
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const uid = () => crypto.randomUUID?.() || String(Date.now()+Math.random());
  const now = () => new Date().toISOString();
  const fmt = n => Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:3});
  const normalizeBarcode = v => String(v||"").replace(/\D/g,"");
  const seed = [];

  async function load(){
    loadLocal();
    render();
    if(!cloudEnabled) return;
    if(!navigator.onLine){updateSyncLabel();return}
    try{
      await syncPending();
      await loadCloudSilent();
      state.sync="Облако подключено";
      subscribe();
    }catch(e){console.error(e);updateSyncLabel()}
    render();
  }
  function safeParse(key,fallback){try{return JSON.parse(localStorage.getItem(key)||"null")??fallback}catch{return fallback}}
  function loadLocal(){
    state.items=safeParse(STORAGE.items,seed);
    state.ops=safeParse(STORAGE.ops,[]);
  }
  function saveLocal(){
    localStorage.setItem(STORAGE.items,JSON.stringify(state.items));
    localStorage.setItem(STORAGE.ops,JSON.stringify(state.ops));
  }
  function getQueue(){return safeParse(STORAGE.queue,[])}
  function setQueue(q){localStorage.setItem(STORAGE.queue,JSON.stringify(q));updateSyncLabel()}
  function updateSyncLabel(){
    const n=getQueue().length;
    if(!cloudEnabled)state.sync="Локальный режим";
    else if(!navigator.onLine)state.sync=n?`Офлайн · в очереди ${n}`:"Офлайн · данные сохранены";
    else if(state.syncing)state.sync=n?`Синхронизация · ${n}`:"Синхронизация…";
    else state.sync=n?`Ожидает отправки · ${n}`:"Облако подключено";
    render();
  }
  function subscribe(){
    if(state.subscribed)return;state.subscribed=true;
    sb.channel("kambuz-live-v041")
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
    if(items) state.items=items; if(ops) state.ops=ops;
    saveLocal();render();
  }
  async function syncPending(){
    if(!cloudEnabled||!navigator.onLine||state.syncing)return;
    let queue=getQueue();if(!queue.length){state.sync="Облако подключено";return}
    state.syncing=true;updateSyncLabel();
    try{
      while(queue.length){
        const pending=queue[0];
        const {data:cloudItem,error:readError}=await sb.from("items").select("*").eq("id",pending.item_id).single();
        if(readError)throw readError;
        const previous=Number(cloudItem.qty||0);
        let next;
        if(pending.type==="receipt")next=previous+Number(pending.quantity);
        else if(pending.type==="adjustment")next=Number(pending.target_qty);
        else next=previous-Number(pending.quantity);
        if(next<0)throw new Error(`Недостаточный остаток для ${pending.item_name}`);
        const syncedAt=pending.created_at||now();
        const {error:e1}=await sb.from("items").update({qty:next,updated_at:now()}).eq("id",pending.item_id);if(e1)throw e1;
        const cloudOp={item_id:pending.item_id,item_name:pending.item_name,type:pending.type,quantity:pending.quantity,reason:pending.reason,comment:pending.comment,user_name:pending.user_name,unit:pending.unit,previous_qty:previous,new_qty:next,created_at:syncedAt};
        const {error:e2}=await sb.from("operations").insert(cloudOp);if(e2)throw e2;
        queue.shift();setQueue(queue);
      }
      await loadCloudSilent();
      state.sync="Облако подключено";
    }finally{state.syncing=false;updateSyncLabel()}
  }
  function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)}
  function syncClass(){return state.sync.includes("подключено")?"ok":state.sync.includes("Ошибка")?"bad":""}
  function itemLabel(i){return [i.brand,i.name].filter(Boolean).join(" ").replace(/\s+/g," ").trim()||"Без названия"}
  function packLabel(i){const v=i.volume??i.weight;return v?`${fmt(v)} ${esc(i.package_unit||i.unit||"")}`:""}

  function shell(content){
    return `<div class="app-shell">
      <header class="topbar"><div class="brand"><div class="logo">⚓</div><div><h1>Камбуз</h1><div class="subtitle">${esc(cfg.PROJECT_NAME||"Основной камбуз")}</div></div></div><button class="icon-btn" data-action="profile">👤</button></header>
      <div class="sync ${syncClass()}">${esc(state.sync)} · ${esc(state.user)}</div>
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
    </div>
    ${low?`<div class="section-title"><h2>Заканчивается</h2><button class="link-btn" data-tab="stock">Все</button></div><div class="card">${state.items.filter(i=>Number(i.qty)<=Number(i.min_qty||0)).slice(0,5).map(itemRow).join("")}</div>`:""}`;
  }
  function mainAction(action,icon,title,sub,cls){return `<button class="main-action ${cls}" data-action="${action}"><span>${icon}</span><div><b>${title}</b><small>${sub}</small></div><i>›</i></button>`}
  function stat(v,l){return `<div class="card stat"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`}
  function quick(icon,title,sub,action,cls){return `<button class="action ${cls}" data-action="${action}"><span class="action-icon">${icon}</span><b>${title}</b><small>${sub}</small></button>`}

  function stock(){
    const q=state.query.toLowerCase();
    const filtered=state.items.filter(i=>(state.category==="Все"||i.category===state.category)&&`${itemLabel(i)} ${i.barcode||""} ${i.subcategory||""} ${i.notes||""}`.toLowerCase().includes(q));
    return `<div class="page-head"><div><div class="eyebrow">Каталог</div><h2>Склад</h2></div><button class="secondary compact" data-action="add-item">＋ Товар</button></div>
      <div class="search"><input id="search" placeholder="Название или штрихкод" value="${esc(state.query)}"><button class="filter-btn" data-action="scan-search">▣</button></div>
      <div class="chips">${["Все",...CATEGORIES].map(c=>`<button class="chip ${state.category===c?"active":""}" data-category="${c}">${c}</button>`).join("")}</div>
      <div class="card list-card">${filtered.map(itemRow).join("")||'<div class="empty">Ничего не найдено</div>'}</div>`;
  }
  function itemRow(i){
    const low=Number(i.qty)<=Number(i.min_qty||0);
    return `<button class="item" data-item="${i.id}"><div class="item-avatar">${esc((i.brand||i.name||"?").slice(0,1).toUpperCase())}</div><div class="item-main"><div class="item-title">${esc(itemLabel(i))}</div><div class="item-meta">${esc(i.subcategory||i.category)}${packLabel(i)?` · ${packLabel(i)}`:""}</div></div><div><div class="qty ${low?"low":""}">${fmt(i.qty)} ${esc(i.unit)}</div><div class="item-meta">мин. ${fmt(i.min_qty||0)}</div></div></button>`;
  }

  function history(){
    const rows=state.ops.map(o=>{const i=state.items.find(x=>x.id===o.item_id);return `<div class="history-entry"><div class="history-top"><div><span class="badge b-${o.type}">${labelType(o.type)}</span> <b>${esc(i?itemLabel(i):(o.item_name||"Товар"))}</b></div><b>${sign(o.type)}${fmt(o.quantity)} ${esc(i?.unit||o.unit||"")}</b></div><div class="item-meta">${new Date(o.created_at).toLocaleString("ru-RU")} · ${esc(o.user_name||"Пользователь")}${o.reason?` · ${esc(o.reason)}`:""}${o.comment?` · ${esc(o.comment)}`:""}</div></div>`}).join("");
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
    document.querySelectorAll("[data-item]").forEach(b=>b.onclick=()=>openItem(b.dataset.item));
    const s=$("#search");if(s)s.oninput=e=>{state.query=e.target.value;render()};
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
      try{if(cloudEnabled){const q=isEdit?sb.from("items").update(payload).eq("id",item.id):sb.from("items").insert({...payload,qty:0});const {error}=await q;if(error)throw error}else{if(isEdit)Object.assign(item,payload);else state.items.push({id:uid(),qty:0,...payload});saveLocal()}el.remove();await reload();toast("Товар сохранён")}catch(err){console.error(err);toast("Ошибка сохранения. Выполни kambuz-migration-v0.2.1.sql")}
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
    const el=modal(itemLabel(i),`<div class="detail-card"><div class="big-qty">${fmt(i.qty)} <span>${esc(i.unit)}</span></div><div class="detail-grid"><div><small>Расход за 30 дней</small><b>${fmt(used30)} ${esc(i.unit)}</b></div><div><small>Минимальный остаток</small><b>${fmt(i.min_qty||0)} ${esc(i.unit)}</b></div><div><small>Последний расход</small><b>${lastUse?new Date(lastUse.created_at).toLocaleDateString("ru-RU"):"—"}</b></div><div><small>Последнее поступление</small><b>${lastReceipt?new Date(lastReceipt.created_at).toLocaleDateString("ru-RU"):"—"}</b></div><div><small>Фасовка</small><b>${packLabel(i)||"—"}</b></div><div><small>Штрихкод</small><b>${esc(i.barcode||"—")}</b></div></div></div>
      <div class="detail-actions"><button class="consumption" data-op="consumption">− Расход</button><button class="receipt" data-op="receipt">＋ Поступление</button><button class="writeoff" data-op="writeoff">Списание</button><button class="edit" data-edit>Изменить</button></div>
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
    const el=modal(labelType(type),`<form class="form"><div class="field"><label>Товар</label><input disabled value="${esc(itemLabel(i))}"></div><div class="field"><label>${type==="adjustment"?"Фактический остаток":"Количество"}</label><input name="quantity" type="number" min="0" step="0.001" value="1" required></div>${type==="writeoff"?`<div class="field"><label>Причина</label><select name="reason">${WRITE_OFF_REASONS.map(r=>`<option>${r}</option>`).join("")}</select></div>`:""}<div class="field"><label>Комментарий</label><input name="comment"></div><button class="primary" type="submit">Сохранить</button></form>`);
    el.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const q=Number(f.quantity);const prev=Number(i.qty);let next=prev;if(type==="receipt")next=prev+q;else if(type==="adjustment")next=q;else next=prev-q;if(next<0){toast("Недостаточный остаток");return}try{await persistOperation(i,type,type==="adjustment"?Math.abs(next-prev):q,prev,next,f.reason||null,f.comment||null);el.remove();await reload();toast("Операция сохранена")}catch(err){console.error(err);toast("Ошибка операции")}};
  }
  async function persistOperation(i,type,quantity,previous_qty,new_qty,reason=null,comment=null){
    const op={id:uid(),item_id:i.id,item_name:itemLabel(i),type,quantity,reason,comment,user_name:state.user,unit:i.unit,previous_qty,new_qty,target_qty:type==="adjustment"?new_qty:null,created_at:now(),pending:cloudEnabled};
    i.qty=new_qty;state.ops.unshift(op);saveLocal();render();
    if(!cloudEnabled)return {queued:false};
    const queue=getQueue();queue.push(op);setQueue(queue);
    if(!navigator.onLine){toast("Сохранено без интернета — отправлю позже");return {queued:true}}
    try{await syncPending();return {queued:false}}catch(e){console.error(e);updateSyncLabel();toast("Сохранено на телефоне — синхронизирую позже");return {queued:true}}
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
    return {barcode:normalizeBarcode(x.barcode)||null,brand:String(x.brand||"").trim()||null,name:String(x.name||"").trim(),category:cat,subcategory:String(x.subcategory||"").trim()||null,volume:volume!=null&&volume!==""?Number(volume):null,package_unit:String(packageUnit||"").trim()||null,unit:String(x.stockUnit||x.stock_unit||guessStockUnit(x,cat)),min_qty:Number(x.minQty??x.min_qty??0),location:String(x.location||"Основной склад"),notes:noteParts.join(" · ")||null,updated_at:now()};
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
    const el=modal("Товар найден",`<div class="scan-found"><div class="item-avatar large">${esc((item.brand||item.name||"?").slice(0,1).toUpperCase())}</div><h3>${esc(itemLabel(item))}</h3><p>${esc(item.subcategory||item.category)}${packLabel(item)?` · ${packLabel(item)}`:""}</p><div class="big-qty">${fmt(item.qty)} <span>${esc(item.unit)}</span></div></div><div class="detail-actions"><button class="consumption" data-quick="consumption">−1 Расход</button><button class="receipt" data-quick="receipt">+1 Поступление</button><button class="edit" data-card>Карточка</button><button class="secondary" data-scan-again>Сканировать ещё</button></div>`);
    el.querySelectorAll("[data-quick]").forEach(b=>b.onclick=async()=>{const type=b.dataset.quick,prev=Number(item.qty),next=type==="receipt"?prev+1:prev-1;if(next<0){toast("Недостаточный остаток");return}try{await persistOperation(item,type,1,prev,next);el.remove();await reload();toast(type==="receipt"?"Добавлено 1":"Списано 1")}catch(e){toast("Ошибка операции")}});
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
  window.addEventListener("online",async()=>{state.sync="Синхронизация…";render();try{await syncPending();await loadCloudSilent();subscribe();toast("Связь появилась — данные синхронизированы")}catch(e){console.error(e);updateSyncLabel()}});
  window.addEventListener("offline",()=>{updateSyncLabel();toast("Нет интернета — работаем офлайн")});
  if("serviceWorker" in navigator)navigator.serviceWorker.register("service-worker.js").catch(console.error);
  load();
})();
