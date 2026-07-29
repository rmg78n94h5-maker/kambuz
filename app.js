(() => {
  const CATEGORIES = ["Химия","Хозтовары","Посуда","Инвентарь","Продукты"];
  const UNITS = ["шт.","бут.","упак.","рулон","кг","г","л","мл","компл."];
  const WRITE_OFF_REASONS = ["Брак","Повреждение","Протечка","Разбилось","Просрочено","Потеряно","Выброшено","Ошибка поставки","Другое"];
  const cfg = window.KAMBUZ_CONFIG || {};
  const cloudEnabled = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = cloudEnabled ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const state = { tab:"home", items:[], ops:[], query:"", category:"Все", user:localStorage.getItem("kambuz_user") || "Никита", sync:cloudEnabled?"Подключение…":"Демо-режим" };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const uid = () => crypto.randomUUID?.() || String(Date.now()+Math.random());
  const now = () => new Date().toISOString();

  const seed = [
    {id:uid(),name:"Fairy Lemon 900 мл",category:"Химия",unit:"бут.",qty:6,min_qty:3,location:"Хозкладовая",barcode:"",notes:""},
    {id:uid(),name:"Губки кухонные, 5 шт.",category:"Хозтовары",unit:"упак.",qty:12,min_qty:5,location:"Хозкладовая",barcode:"",notes:""},
    {id:uid(),name:"Мусорные пакеты 120 л",category:"Хозтовары",unit:"рулон",qty:4,min_qty:3,location:"Хозкладовая",barcode:"",notes:""},
    {id:uid(),name:"Domestos 1 л",category:"Химия",unit:"бут.",qty:2,min_qty:3,location:"Хозкладовая",barcode:"",notes:""}
  ];

  async function load(){
    if(cloudEnabled){
      try{
        const [{data:items,error:e1},{data:ops,error:e2}] = await Promise.all([
          sb.from("items").select("*").order("name"),
          sb.from("operations").select("*").order("created_at",{ascending:false}).limit(500)
        ]);
        if(e1||e2) throw e1||e2;
        state.items = items || []; state.ops = ops || []; state.sync="Облако подключено";
        subscribe();
      }catch(e){ console.error(e); state.sync="Ошибка облака"; loadLocal(); }
    } else loadLocal();
    render();
  }
  function loadLocal(){
    state.items = JSON.parse(localStorage.getItem("kambuz_items")||"null") || seed;
    state.ops = JSON.parse(localStorage.getItem("kambuz_ops")||"[]");
    saveLocal();
  }
  function saveLocal(){localStorage.setItem("kambuz_items",JSON.stringify(state.items));localStorage.setItem("kambuz_ops",JSON.stringify(state.ops));}
  function subscribe(){
    sb.channel("kambuz-live").on("postgres_changes",{event:"*",schema:"public",table:"items"},loadCloudSilent)
      .on("postgres_changes",{event:"*",schema:"public",table:"operations"},loadCloudSilent).subscribe();
  }
  async function loadCloudSilent(){
    const [{data:items},{data:ops}] = await Promise.all([sb.from("items").select("*").order("name"),sb.from("operations").select("*").order("created_at",{ascending:false}).limit(500)]);
    if(items) state.items=items;if(ops)state.ops=ops;render();
  }
  function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2300)}
  function fmt(n){return Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:3})}
  function syncClass(){return state.sync.includes("подключено")?"ok":state.sync.includes("Ошибка")?"bad":""}

  function shell(content){
    return `<div class="app-shell">
      <header class="topbar"><div class="brand"><div class="logo">⚓</div><div><h1>Камбуз</h1><div class="subtitle">${esc(cfg.PROJECT_NAME||"Основной камбуз")}</div></div></div><button class="icon-btn" data-action="profile">👤</button></header>
      <div class="sync ${syncClass()}">${esc(state.sync)} · ${esc(state.user)}</div>
      ${content}
      ${state.tab==="stock"?'<button class="fab" data-action="add-item">＋</button>':''}
    </div>
    <nav class="bottom-nav">
      ${navBtn("home","🏠","Главная")}${navBtn("stock","📦","Склад")}${navBtn("history","🧾","История")}${navBtn("export","⬇️","Экспорт")}
    </nav>`;
  }
  function navBtn(tab,icon,label){return `<button class="nav-btn ${state.tab===tab?"active":""}" data-tab="${tab}"><span>${icon}</span>${label}</button>`}
  function render(){
    const root=$("#app");
    const view = state.tab==="home"?home():state.tab==="stock"?stock():state.tab==="history"?history():exportsView();
    root.innerHTML=shell(view);bind();
  }
  function home(){
    const low=state.items.filter(i=>Number(i.qty)<=Number(i.min_qty||0)).length;
    const today=new Date().toISOString().slice(0,10);
    const used=state.ops.filter(o=>o.type==="consumption"&&String(o.created_at).slice(0,10)===today).reduce((s,o)=>s+Number(o.quantity),0);
    return `<div class="grid stats" style="margin-top:12px">
      ${stat(state.items.length,"Позиций")}${stat(low,"Заканчивается")}${stat(state.ops.length,"Операций")}${stat(fmt(used),"Расход сегодня")}
    </div>
    <div class="section-title"><h2>Быстрые действия</h2></div>
    <div class="grid quick-actions">
      ${quick("📦","Открыть склад","Найти и изменить остатки","stock","a-green")}
      ${quick("➕","Добавить товар","Новая позиция в базе","add-item","a-blue")}
      ${quick("🧾","Инвентаризация","Сверка фактических остатков","inventory","a-amber")}
      ${quick("⬇️","Выгрузить остатки","PDF или Word","export","a-gray")}
    </div>
    <div class="section-title"><h2>Требуют внимания</h2><button class="link-btn" data-tab="stock">Все товары</button></div>
    <div class="card">${state.items.filter(i=>Number(i.qty)<=Number(i.min_qty||0)).slice(0,6).map(itemRow).join("")||'<div class="empty">Всё в порядке 👌</div>'}</div>`;
  }
  function stat(v,l){return `<div class="card stat"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`}
  function quick(icon,title,sub,action,cls){return `<button class="action ${cls}" data-action="${action}"><span style="font-size:24px">${icon}</span><b>${title}</b><small>${sub}</small></button>`}
  function stock(){
    const filtered=state.items.filter(i=>(state.category==="Все"||i.category===state.category)&&`${i.name} ${i.barcode||""} ${i.notes||""}`.toLowerCase().includes(state.query.toLowerCase()));
    return `<div class="search"><input id="search" placeholder="Поиск по названию…" value="${esc(state.query)}"><button class="filter-btn" data-action="add-item">＋</button></div>
      <div class="chips">${["Все",...CATEGORIES].map(c=>`<button class="chip ${state.category===c?"active":""}" data-category="${c}">${c}</button>`).join("")}</div>
      <div class="card">${filtered.map(itemRow).join("")||'<div class="empty">Ничего не найдено</div>'}</div>`;
  }
  function itemRow(i){const low=Number(i.qty)<=Number(i.min_qty||0);return `<button class="item" data-item="${i.id}" style="width:100%;border-left:0;border-right:0;border-top:0;background:none;text-align:left"><div class="item-main"><div class="item-title">${esc(i.name)}</div><div class="item-meta">${esc(i.category)} · ${esc(i.location||"Место не указано")}</div></div><div><div class="qty ${low?"low":""}">${fmt(i.qty)} ${esc(i.unit)}</div><div class="item-meta">мин. ${fmt(i.min_qty||0)}</div></div></button>`}
  function history(){
    const rows=state.ops.map(o=>{const i=state.items.find(x=>x.id===o.item_id);return `<div class="history-entry"><div class="history-top"><div><span class="badge b-${o.type}">${labelType(o.type)}</span> <b>${esc(i?.name||o.item_name||"Товар")}</b></div><b>${sign(o.type)}${fmt(o.quantity)} ${esc(i?.unit||o.unit||"")}</b></div><div class="item-meta">${new Date(o.created_at).toLocaleString("ru-RU")} · ${esc(o.user_name||"Пользователь")}${o.reason?` · ${esc(o.reason)}`:""}${o.comment?` · ${esc(o.comment)}`:""}</div></div>`}).join("");
    return `<div class="section-title"><h2>История операций</h2></div><div class="card">${rows||'<div class="empty">Операций пока нет</div>'}</div>`;
  }
  function exportsView(){return `<div class="section-title"><h2>Выгрузка остатков</h2></div><div class="card"><p>Сформируй текущую ведомость по всем категориям или только по выбранной.</p><div class="form"><div class="field"><label>Категория</label><select id="export-category"><option>Все</option>${CATEGORIES.map(c=>`<option>${c}</option>`).join("")}</select></div><button class="primary" data-action="export-pdf">Скачать PDF / печать</button><button class="secondary" data-action="export-doc">Скачать Word (.doc)</button></div></div>`}
  function labelType(t){return ({consumption:"Расход",receipt:"Поступление",writeoff:"Списание",adjustment:"Корректировка"})[t]||t}
  function sign(t){return t==="receipt"?"+":"−"}

  function bind(){
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render()});
    document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>handle(b.dataset.action));
    document.querySelectorAll("[data-category]").forEach(b=>b.onclick=()=>{state.category=b.dataset.category;render()});
    document.querySelectorAll("[data-item]").forEach(b=>b.onclick=()=>openItem(b.dataset.item));
    const s=$("#search");if(s)s.oninput=e=>{state.query=e.target.value;render()};
  }
  function handle(a){
    if(a==="add-item") itemForm(); else if(a==="profile") profile(); else if(a==="inventory") inventory(); else if(a==="export"){state.tab="export";render()} else if(a==="export-pdf") exportPdf(); else if(a==="export-doc") exportDoc(); else if(a==="stock"){state.tab="stock";render()}
  }
  function modal(title,body){
    const el=document.createElement("div");el.className="modal-backdrop";el.innerHTML=`<div class="modal"><div class="modal-head"><h3>${esc(title)}</h3><button class="close">✕</button></div>${body}</div>`;document.body.appendChild(el);el.querySelector(".close").onclick=()=>el.remove();el.onclick=e=>{if(e.target===el)el.remove()};return el;
  }
  function itemForm(item){
    const el=modal(item?"Изменить товар":"Новый товар",`<form class="form" id="item-form">
      <div class="field"><label>Название</label><input name="name" required value="${esc(item?.name||"")}"></div>
      <div class="row"><div class="field"><label>Категория</label><select name="category">${CATEGORIES.map(c=>`<option ${item?.category===c?"selected":""}>${c}</option>`).join("")}</select></div><div class="field"><label>Единица</label><select name="unit">${UNITS.map(u=>`<option ${item?.unit===u?"selected":""}>${u}</option>`).join("")}</select></div></div>
      <div class="row"><div class="field"><label>Остаток</label><input name="qty" type="number" step="0.001" min="0" required value="${item?.qty??0}"></div><div class="field"><label>Минимум</label><input name="min_qty" type="number" step="0.001" min="0" value="${item?.min_qty??0}"></div></div>
      <div class="field"><label>Место хранения</label><input name="location" value="${esc(item?.location||"")}"></div>
      <div class="field"><label>Штрихкод</label><input name="barcode" inputmode="numeric" value="${esc(item?.barcode||"")}"></div>
      <div class="field"><label>Примечание / слова для поиска</label><textarea name="notes">${esc(item?.notes||"")}</textarea></div>
      <button class="primary">Сохранить</button></form>`);
    el.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const data={...item,...f,qty:Number(f.qty),min_qty:Number(f.min_qty),id:item?.id||uid(),updated_at:now()};
      if(cloudEnabled){const {error}=await sb.from("items").upsert(data);if(error)return toast(error.message);} else {const ix=state.items.findIndex(x=>x.id===data.id);if(ix>=0)state.items[ix]=data;else state.items.push(data);saveLocal();}
      el.remove();toast("Товар сохранён");await reload();};
  }
  function openItem(id){const i=state.items.find(x=>x.id===id);if(!i)return;const el=modal(i.name,`<div class="card" style="box-shadow:none"><div class="item-meta">${esc(i.category)} · ${esc(i.location||"Место не указано")}</div><div style="font-size:34px;font-weight:900;margin:8px 0">${fmt(i.qty)} ${esc(i.unit)}</div><div class="item-meta">Минимальный остаток: ${fmt(i.min_qty||0)} ${esc(i.unit)}</div></div><div class="detail-actions"><button class="consumption" data-op="consumption">Расход</button><button class="receipt" data-op="receipt">Поступление</button><button class="writeoff" data-op="writeoff">Списание</button><button class="edit" data-edit>Изменить</button></div><button class="secondary" style="width:100%;margin-top:10px" data-op="adjustment">Корректировка остатка</button>`);
    el.querySelectorAll("[data-op]").forEach(b=>b.onclick=()=>{el.remove();operationForm(i,b.dataset.op)});el.querySelector("[data-edit]").onclick=()=>{el.remove();itemForm(i)};
  }
  function operationForm(item,type){
    const isAdj=type==="adjustment", isWrite=type==="writeoff";
    const el=modal(labelType(type),`<form class="form"><div class="card" style="box-shadow:none"><b>${esc(item.name)}</b><div class="item-meta">Текущий остаток: ${fmt(item.qty)} ${esc(item.unit)}</div></div>
      <div class="field"><label>${isAdj?"Фактический остаток":"Количество"}</label><input name="quantity" type="number" min="0" step="0.001" required></div>
      ${isWrite?`<div class="field"><label>Причина</label><select name="reason" required><option value="">Выбрать…</option>${WRITE_OFF_REASONS.map(r=>`<option>${r}</option>`).join("")}</select></div>`:""}
      <div class="field"><label>Комментарий</label><textarea name="comment" placeholder="Необязательно${isWrite?" (для причины «Другое» — обязательно)":""}"></textarea></div>
      <button class="primary ${isWrite?"danger":""}">Сохранить</button></form>`);
    el.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));let q=Number(f.quantity);if(isWrite&&f.reason==="Другое"&&!f.comment.trim())return toast("Добавь комментарий");
      const old=Number(item.qty), next=isAdj?q:type==="receipt"?old+q:Math.max(0,old-q);const delta=isAdj?Math.abs(next-old):q;
      const op={id:uid(),item_id:item.id,item_name:item.name,type,quantity:delta,reason:f.reason||null,comment:f.comment||null,user_name:state.user,unit:item.unit,created_at:now(),previous_qty:old,new_qty:next};
      if(cloudEnabled){const {error:e1}=await sb.from("operations").insert(op);if(e1)return toast(e1.message);const {error:e2}=await sb.from("items").update({qty:next,updated_at:now()}).eq("id",item.id);if(e2)return toast(e2.message);} else {state.ops.unshift(op);item.qty=next;saveLocal();}
      el.remove();toast("Операция сохранена");await reload();};
  }
  function profile(){const el=modal("Пользователь",`<form class="form"><div class="field"><label>Имя в журнале</label><input name="user" value="${esc(state.user)}" required></div><div class="item-meta">На втором телефоне укажите имя «Лёха». Все операции будут подписаны.</div><button class="primary">Сохранить</button></form>`);el.querySelector("form").onsubmit=e=>{e.preventDefault();state.user=new FormData(e.target).get("user").trim();localStorage.setItem("kambuz_user",state.user);el.remove();render();toast("Имя сохранено")}}
  function inventory(){
    const el=modal("Инвентаризация",`<form class="form"><div class="item-meta">Введи фактические остатки. Изменённые позиции сохранятся как корректировки.</div>${state.items.map(i=>`<div class="row"><div><b>${esc(i.name)}</b><div class="item-meta">В системе: ${fmt(i.qty)} ${esc(i.unit)}</div></div><input name="${i.id}" type="number" min="0" step="0.001" value="${i.qty}" style="border:1px solid var(--line);border-radius:14px;padding:10px"></div>`).join("")}<button class="primary">Завершить инвентаризацию</button></form>`);
    el.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);for(const i of state.items){const n=Number(f.get(i.id));if(n!==Number(i.qty)){const old=Number(i.qty),op={id:uid(),item_id:i.id,item_name:i.name,type:"adjustment",quantity:Math.abs(n-old),reason:"Инвентаризация",comment:"Фактический пересчёт",user_name:state.user,unit:i.unit,created_at:now(),previous_qty:old,new_qty:n};if(cloudEnabled){await sb.from("operations").insert(op);await sb.from("items").update({qty:n,updated_at:now()}).eq("id",i.id);}else{state.ops.unshift(op);i.qty=n;}}}if(!cloudEnabled)saveLocal();el.remove();await reload();toast("Инвентаризация сохранена")}
  }
  function filteredExport(){const c=$("#export-category")?.value||"Все";return state.items.filter(i=>c==="Все"||i.category===c)}
  function exportPdf(){
    const items=filteredExport();const w=window.open("","_blank");const groups=group(items);w.document.write(`<html><head><meta charset="utf-8"><title>Остатки</title><style>body{font-family:Arial;padding:24px}h1{margin-bottom:4px}h2{margin-top:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:8px;text-align:left}th{background:#eee}.sign{margin-top:40px}</style></head><body><h1>Ведомость остатков</h1><div>${new Date().toLocaleString("ru-RU")} · ${esc(cfg.PROJECT_NAME||"")}</div>${Object.entries(groups).map(([c,arr])=>`<h2>${esc(c)}</h2><table><tr><th>№</th><th>Наименование</th><th>Остаток</th><th>Ед.</th><th>Место</th><th>Факт</th></tr>${arr.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.name)}</td><td>${fmt(i.qty)}</td><td>${esc(i.unit)}</td><td>${esc(i.location||"")}</td><td></td></tr>`).join("")}</table>`).join("")}<div class="sign">Подпись: _______________________</div><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
  }
  function exportDoc(){
    const items=filteredExport(),groups=group(items);const html=`<html><head><meta charset="utf-8"></head><body><h1>Ведомость остатков</h1><p>${new Date().toLocaleString("ru-RU")} · ${esc(cfg.PROJECT_NAME||"")}</p>${Object.entries(groups).map(([c,arr])=>`<h2>${esc(c)}</h2><table border="1" cellspacing="0" cellpadding="6"><tr><th>№</th><th>Наименование</th><th>Остаток</th><th>Ед.</th><th>Место</th><th>Факт</th></tr>${arr.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.name)}</td><td>${fmt(i.qty)}</td><td>${esc(i.unit)}</td><td>${esc(i.location||"")}</td><td></td></tr>`).join("")}</table>`).join("")}<p>Подпись: _______________________</p></body></html>`;const blob=new Blob(["\ufeff",html],{type:"application/msword"});download(blob,`kambuz-ostatki-${new Date().toISOString().slice(0,10)}.doc`);toast("Файл Word готов")
  }
  function group(items){return items.reduce((a,i)=>((a[i.category]??=[]).push(i),a),{})}
  function download(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  async function reload(){if(cloudEnabled)await loadCloudSilent();else render()}
  if("serviceWorker" in navigator)navigator.serviceWorker.register("service-worker.js").catch(console.error);
  load();
})();
