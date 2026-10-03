(() => {
  'use strict';
  const VERSION='2.3.0';
  const cfg=window.KAMBUZ_CONFIG||{}; let sb=null;
  const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateKey=v=>{const d=new Date(v);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const dateLabel=k=>{const [y,m,d]=k.split('-');return `${d}.${m}.${y}`};
  const read=(key,fallback=[])=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const write=(key,v)=>localStorage.setItem(key,JSON.stringify(v));
  const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pendingDeleteIds=()=>new Set(read('kambuz_pending_ops',[]).filter(x=>x?.kind==='operation_delete').map(x=>x.operation_id));
  const itemLabel=i=>[i?.brand,i?.name].filter(Boolean).join(' ').replace(/\s+/g,' ').trim()||'Товар';
  async function client(){if(sb)return sb;if(!window.supabase)await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=res;s.onerror=rej;document.head.appendChild(s)});sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);return sb}
  function styles(){
    if(document.getElementById('fc-style'))return;
    const s=document.createElement('style');
    s.id='fc-style';
    s.textContent=`
      .fc-pill{}
      .fc-overlay{
        position:fixed;inset:0;z-index:120000;
        overflow:auto;
        padding:calc(env(safe-area-inset-top) + 14px) 14px calc(env(safe-area-inset-bottom) + 104px);
        background:
          radial-gradient(circle at 94% -6%,rgba(22,199,200,.10),transparent 28rem),
          linear-gradient(180deg,#f8fafb 0%,#f3f6f8 100%);
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
        color:#10243a;
      }
      .fc-head{
        max-width:760px;margin:0 auto 12px;
        display:flex;justify-content:space-between;align-items:flex-end;gap:12px;
      }
      .fc-head h2{
        margin:2px 0 0;
        color:#08243d;
        font-size:25px;
        line-height:1.05;
        letter-spacing:-.04em;
      }
      .fc-head:before{
        content:'РАСХОДЫ';
        display:block;position:absolute;
        color:#07989a;font-size:10px;font-weight:850;letter-spacing:.1em;
        transform:translateY(-20px);
      }
      .fc-head .fc-muted{margin-top:5px;color:#80909d;font-size:12px}
      .fc-head-actions{display:flex;gap:7px;align-items:center}
      .fc-add-top{
        min-height:42px;
        border:0;border-radius:13px;
        padding:0 12px;
        background:linear-gradient(145deg,#19ccca,#09a9ad);
        color:#063a49;
        font-weight:850;
        box-shadow:0 8px 20px rgba(11,176,179,.16);
      }
      .fc-close{
        width:42px;height:42px;border:1px solid #e1e9ee;border-radius:13px;
        background:#fff;color:#5f7383;font-size:20px;
        box-shadow:0 5px 16px rgba(20,48,73,.05);
      }
      .fc-kpi{
        max-width:760px;margin:12px auto 14px;
        position:relative;overflow:hidden;
        border-radius:24px;padding:20px;
        background:
          radial-gradient(circle at 92% 8%,rgba(93,246,240,.18),transparent 32%),
          linear-gradient(145deg,#08243d 0%,#0b3152 72%,#0d4967 100%);
        color:#fff;
        box-shadow:0 16px 36px rgba(8,36,61,.16);
      }
      .fc-kpi:after{
        content:'₽';
        position:absolute;right:-6px;bottom:-34px;
        font-size:118px;font-weight:900;line-height:1;
        opacity:.08;
      }
      .fc-kpi small{position:relative;z-index:1;color:#9db5c5;font-size:11px}
      .fc-kpi strong{
        position:relative;z-index:1;
        display:block;margin:5px 0 4px;
        color:#fff;font-size:34px;line-height:1;
        letter-spacing:-.04em;
      }
      .fc-list{max-width:760px;margin:auto}
      .fc-day{
        margin:9px 0;
        padding:14px;
        border:1px solid #e2eaf0;border-radius:20px;
        background:#fff;
        box-shadow:0 7px 22px rgba(20,48,73,.045);
      }
      .fc-day-top{display:flex;justify-content:space-between;gap:12px;align-items:center}
      .fc-day b{color:#17364d;font-size:16px}
      .fc-muted{color:#84949f;font-size:11px;line-height:1.35}
      .fc-btn{
        border:1px solid #cde9e8;border-radius:12px;
        background:#e7f8f7;color:#087c82;
        font-weight:850;padding:8px 10px;
      }
      .fc-lines{
        margin-top:12px;padding-top:8px;
        border-top:1px solid #edf2f5;
      }
      .fc-line{
        display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center;
        padding:9px 0;border-bottom:1px solid #eef3f5;
      }
      .fc-line:last-child{border-bottom:0}
      .fc-line-name{color:#17364d;font-weight:750;font-size:12px}
      .fc-line-side{display:flex;flex-direction:column;align-items:flex-end;gap:5px}
      .fc-line-side>b{font-size:13px;color:#17364d}
      .fc-delete{
        border:0;border-radius:9px;padding:6px 8px;
        background:#fff0ef;color:#c83f45;
        font:800 9px system-ui;
      }
      .fc-expand{
        border:0;border-radius:9px;padding:6px 8px;
        background:#edf5f7;color:#496677;
        font:800 9px system-ui;
      }
      .fc-subops{
        grid-column:1/-1;margin-top:2px;padding:6px 9px;
        border-radius:12px;background:#f6f9fa;
      }
      .fc-subop{
        display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;
        padding:7px 0;border-bottom:1px solid #e7edf1;
      }
      .fc-subop:last-child{border-bottom:0}
      .fc-actions{
        display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;
      }
      .fc-actions button{
        min-height:42px;border:1px solid #e0e8ed;border-radius:12px;
        padding:9px;background:#f6f9fa;color:#3d5a6d;font-weight:800;
      }
      .fc-actions .fc-add-day{
        grid-column:1/-1;
        border-color:#cfeae9;background:#e8f8f7;color:#087e84;
      }
      .fc-warning{
        margin-top:10px;padding:10px 12px;border:1px solid #f1dfb9;border-radius:13px;
        background:#fff6e5;color:#8b651d;font-size:11px;line-height:1.4;
      }

      .fc-editor{
        position:fixed;inset:0;z-index:350000;
        display:flex;align-items:flex-end;
        background:rgba(5,25,42,.48);
        backdrop-filter:blur(5px);
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      }
      .fc-editor-card{
        width:100%;max-height:92vh;overflow:auto;
        padding:18px 16px calc(env(safe-area-inset-bottom) + 22px);
        border-radius:28px 28px 0 0;background:#fff;color:#10243a;
        box-shadow:0 -20px 50px rgba(6,31,52,.18);
      }
      .fc-editor-head{
        display:flex;justify-content:space-between;align-items:flex-start;gap:10px;
        margin-bottom:14px;
      }
      .fc-editor-head h3{margin:0;color:#08243d;font-size:20px;letter-spacing:-.02em}
      .fc-editor-close{
        width:38px;height:38px;border:0;border-radius:12px;
        background:#eef3f6;color:#4d6576;font-size:20px;
      }
      .fc-field{display:grid;gap:6px;margin:11px 0}
      .fc-field label{color:#687c8c;font-size:11px;font-weight:800}
      .fc-field input{
        width:100%;min-height:47px;
        border:1px solid #dfe8ee;border-radius:14px;
        padding:11px 12px;background:#fbfcfd;color:#10243a;font-size:15px;
      }
      .fc-field input:focus{
        outline:none;border-color:#5bd7d5;
        box-shadow:0 0 0 3px rgba(22,199,200,.11);
      }
      .fc-search-results{
        overflow:auto;max-height:260px;
        border:1px solid #e1e9ee;border-radius:15px;background:#fff;
      }
      .fc-search-results:empty{display:none}
      .fc-search-results button{
        width:100%;display:flex;justify-content:space-between;gap:8px;
        padding:11px 12px;border:0;border-bottom:1px solid #edf2f5;
        background:#fff;color:#17364d;text-align:left;
      }
      .fc-search-results button:last-child{border-bottom:0}
      .fc-search-results button b{white-space:nowrap}
      .fc-selected{
        margin:10px 0;padding:12px;
        border:1px solid #dcebed;border-radius:14px;
        background:#f0f9f9;
      }
      .fc-selected b,.fc-selected small{display:block}
      .fc-selected b{color:#17364d}
      .fc-selected small{margin-top:4px;color:#768b99}
      .fc-save{
        width:100%;min-height:49px;margin-top:12px;
        border:0;border-radius:15px;
        background:linear-gradient(145deg,#19ccca,#09a9ad);
        color:#063a49;font-weight:850;
        box-shadow:0 10px 24px rgba(11,176,179,.18);
      }
      .fc-save:disabled{opacity:.42;box-shadow:none}
      .fc-future-note{
        margin-top:10px;padding:10px 12px;border-radius:13px;
        background:#eaf3ff;color:#37658f;font-size:11px;line-height:1.4;
      }

      @media(min-width:760px){
        .fc-editor-card{max-width:760px;margin:0 auto}
      }
      @media(max-width:390px){
        .fc-overlay{padding-left:10px;padding-right:10px}
        .fc-head h2{font-size:22px}
        .fc-add-top{padding:0 10px;font-size:11px}
        .fc-kpi strong{font-size:30px}
        .fc-actions{grid-template-columns:1fr}
        .fc-actions .fc-add-day{grid-column:auto}
      }
    `;
    document.head.appendChild(s);
  }

  async function loadOps(){
    const deleted=pendingDeleteIds();
    const local=read('kambuz_ops',[]).filter(o=>['consumption','writeoff'].includes(o?.type)&&!deleted.has(o.id));
    if(!navigator.onLine)return local.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    try{
      const c=await client();
      const {data,error}=await c.from('operations').select('id,item_id,item_name,type,quantity,unit,created_at,unit_price_rub,cost_total_rub,user_name,previous_qty,new_qty').in('type',['consumption','writeoff']).order('created_at',{ascending:false}).limit(5000);
      if(error)throw error;
      const map=new Map((data||[]).filter(o=>!deleted.has(o.id)).map(o=>[o.id,o]));
      for(const o of local)if(!map.has(o.id))map.set(o.id,o);
      return [...map.values()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    }catch(e){if(local.length)return local.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));throw e}
  }
  function groupDayOps(ops){
    const map=new Map();
    for(const o of ops){const key=o.item_id||`${String(o.item_name||'').trim().toLowerCase()}|${o.unit||''}`;if(!map.has(key))map.set(key,{key,item_id:o.item_id||null,item_name:o.item_name||'Товар',unit:o.unit||'',quantity:0,cost_total_rub:0,ops:[],prices:new Set()});const g=map.get(key);g.quantity+=Number(o.quantity||0);g.cost_total_rub+=Number(o.cost_total_rub||0);g.ops.push(o);if(o.unit_price_rub!=null)g.prices.add(Number(o.unit_price_rub))}
    return [...map.values()].map(g=>{const prices=[...g.prices];g.unit_price_rub=prices.length===1?prices[0]:null;g.mixed_prices=prices.length>1;return g})
  }
  function csv(day,ops){const lines=[['Дата','Продукт','Количество','Ед.','Цена за ед., ₽','Сумма, ₽','Кто']];for(const o of ops)lines.push([dateLabel(day),o.item_name,o.quantity,o.unit||'',o.unit_price_rub??'',o.cost_total_rub??'',o.user_name||'']);lines.push(['','','','','ИТОГО',ops.reduce((s,o)=>s+Number(o.cost_total_rub||0),0),'']);const text='\ufeff'+lines.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=`Камбуз_расход_${day}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function printDay(day,ops){const total=ops.reduce((s,o)=>s+Number(o.cost_total_rub||0),0);const html=`<!doctype html><meta charset="utf-8"><title>Расход ${day}</title><style>body{font:14px Arial;padding:24px;color:#222}h1{font-size:22px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:7px;text-align:left}th{background:#eee}.r{text-align:right}tfoot{font-weight:bold}</style><h1>Камбуз — расход питания ${dateLabel(day)}</h1><table><thead><tr><th>Продукт</th><th>Количество</th><th>Цена, ₽</th><th>Сумма, ₽</th><th>Кто</th></tr></thead><tbody>${ops.map(o=>`<tr><td>${esc(o.item_name)}</td><td>${o.quantity} ${esc(o.unit||'')}</td><td class="r">${o.unit_price_rub==null?'—':Number(o.unit_price_rub).toFixed(2)}</td><td class="r">${o.cost_total_rub==null?'—':Number(o.cost_total_rub).toFixed(2)}</td><td>${esc(o.user_name||'')}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Итого</td><td class="r">${total.toFixed(2)} ₽</td><td></td></tr></tfoot></table>`;const w=window.open('','_blank');if(!w)return alert('Разреши всплывающее окно для печати/PDF.');w.document.write(html);w.document.close();setTimeout(()=>w.print(),250)}
  function requestDelete(opId){const api=window.KAMBUZ_OPERATIONS;if(!api?.deleteOperation){alert('Удаление операций пока недоступно. Обнови Камбуз.');return}api.deleteOperation(opId)}
  function timestampForDay(day){const [y,m,d]=day.split('-').map(Number);const now=new Date();const x=new Date(y,m-1,d,now.getHours(),now.getMinutes(),now.getSeconds(),0);return x.toISOString()}
  async function syncNewOperation(op){
    if(!navigator.onLine)return false;
    try{const c=await client();const {data,error}=await c.rpc('kambuz_apply_operation',{p_operation_id:op.id,p_item_id:op.item_id,p_type:op.type,p_quantity:Number(op.quantity),p_target_qty:null,p_item_name:op.item_name,p_reason:null,p_comment:op.comment||null,p_user_name:op.user_name,p_unit:op.unit,p_created_at:op.created_at});if(error)throw error;const q=read('kambuz_pending_ops',[]).filter(x=>x.id!==op.id);write('kambuz_pending_ops',q);const ops=read('kambuz_ops',[]);const local=ops.find(x=>x.id===op.id);if(local){local.pending=false;if(data?.unit_price_rub!=null)local.unit_price_rub=data.unit_price_rub;if(data?.cost_total_rub!=null)local.cost_total_rub=data.cost_total_rub;write('kambuz_ops',ops)}return true}catch(e){console.warn('Dated expense sync failed',e);return false}
  }
  function openEditor(defaultDay=dateKey(new Date())){
    styles();document.querySelector('.fc-editor')?.remove();const items=read('kambuz_items',[]).filter(i=>i?.category==='Продукты').sort((a,b)=>itemLabel(a).localeCompare(itemLabel(b),'ru'));let selected=null;
    const root=document.createElement('div');root.className='fc-editor';root.innerHTML=`<div class="fc-editor-card"><div class="fc-editor-head"><div><h3>Добавить списание</h3><div class="fc-muted">Выбери день, товар и количество</div></div><button class="fc-editor-close">×</button></div><div class="fc-field"><label>Дата списания</label><input type="date" id="fc-date" value="${esc(defaultDay)}"></div><div class="fc-field"><label>Товар</label><input type="search" id="fc-search" placeholder="Начни вводить название"></div><div class="fc-search-results" id="fc-results"></div><div class="fc-selected" id="fc-selected" hidden></div><div class="fc-field"><label>Количество</label><input type="number" id="fc-qty" min="0.001" step="0.001" inputmode="decimal" placeholder="0"></div><div class="fc-field"><label>Комментарий</label><input id="fc-comment" placeholder="Необязательно"></div><div class="fc-future-note" id="fc-note" hidden>Будущая дата: товар резервируется сразу — количество сразу вычитается из доступного остатка, а в стоимости питания попадёт на выбранный день.</div><button class="fc-save" id="fc-save" disabled>Добавить списание</button></div>`;document.body.appendChild(root);
    const date=root.querySelector('#fc-date'),search=root.querySelector('#fc-search'),results=root.querySelector('#fc-results'),sel=root.querySelector('#fc-selected'),qty=root.querySelector('#fc-qty'),save=root.querySelector('#fc-save'),note=root.querySelector('#fc-note');
    const validate=()=>{save.disabled=!(selected&&Number(qty.value)>0&&date.value);note.hidden=!(date.value>dateKey(new Date()))};
    const drawResults=()=>{const q=search.value.trim().toLowerCase();const list=q?items.filter(i=>`${itemLabel(i)} ${i.subcategory||''}`.toLowerCase().includes(q)).slice(0,12):[];results.innerHTML=list.map(i=>`<button type="button" data-pick="${esc(i.id)}"><span>${esc(itemLabel(i))}</span><b>${Number(i.qty||0).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${esc(i.unit||'')}</b></button>`).join('');results.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{selected=items.find(i=>i.id===b.dataset.pick)||null;search.value='';results.innerHTML='';if(selected){sel.hidden=false;sel.innerHTML=`<b>${esc(itemLabel(selected))}</b><small>Остаток: ${Number(selected.qty||0).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${esc(selected.unit||'')}</small>`}validate()})};
    root.querySelector('.fc-editor-close').onclick=()=>root.remove();search.oninput=drawResults;qty.oninput=validate;date.onchange=validate;validate();
    save.onclick=async()=>{const amount=Number(qty.value);if(!selected||!Number.isFinite(amount)||amount<=0)return;if(amount>Number(selected.qty||0)){alert(`Недостаточный остаток: ${selected.qty} ${selected.unit}`);return}save.disabled=true;const prev=Number(selected.qty||0),next=prev-amount,op={id:uid(),item_id:selected.id,item_name:itemLabel(selected),type:'consumption',quantity:amount,reason:null,comment:root.querySelector('#fc-comment').value.trim()||null,user_name:localStorage.getItem('kambuz_user')||'Пользователь',unit:selected.unit,previous_qty:prev,new_qty:next,target_qty:null,created_at:timestampForDay(date.value),pending:Boolean(cfg.SUPABASE_URL)};selected.qty=next;selected.updated_at=new Date().toISOString();write('kambuz_items',read('kambuz_items',[]).map(i=>i.id===selected.id?selected:i));const ops=read('kambuz_ops',[]);ops.unshift(op);write('kambuz_ops',ops);const queue=read('kambuz_pending_ops',[]);queue.push({...op,kind:'operation',status:'pending'});write('kambuz_pending_ops',queue);await syncNewOperation(op);root.remove();document.dispatchEvent(new CustomEvent('kambuz-dated-expense-added',{detail:{day:dateKey(op.created_at),operationId:op.id}}));setTimeout(open,100)};
    setTimeout(()=>search.focus(),80)
  }
  async function open(){
    styles();document.querySelector('.fc-overlay')?.remove();const navButton=document.querySelector('.fc-pill');navButton?.classList.add('active');const root=document.createElement('div');root.className='fc-overlay';root.innerHTML=`<div class="fc-head"><div><h2>💰 Стоимость питания</h2><div class="fc-muted">Расход по дням · рубли</div></div><div class="fc-head-actions"><button class="fc-add-top">＋ Списание</button><button class="fc-close">×</button></div></div><div class="fc-kpi"><small>Загружаю…</small><strong>—</strong></div><div class="fc-list"></div>`;document.body.appendChild(root);root.querySelector('.fc-close').onclick=()=>{root.remove();navButton?.classList.remove('active')};root.querySelector('.fc-add-top').onclick=()=>openEditor(dateKey(new Date()));
    try{const ops=await loadOps();const groups={};for(const o of ops)(groups[dateKey(o.created_at)]??=[]).push(o);const days=Object.keys(groups).sort().reverse();const today=dateKey(new Date());const todayOps=groups[today]||[];const todayTotal=todayOps.reduce((s,o)=>s+Number(o.cost_total_rub||0),0);root.querySelector('.fc-kpi').innerHTML=`<small>Сегодня · ${dateLabel(today)}</small><strong>${money(todayTotal)}</strong><small>${todayOps.length} списаний</small>`;root.querySelector('.fc-list').innerHTML=days.length?days.map(day=>{const xs=groups[day],total=xs.reduce((s,o)=>s+Number(o.cost_total_rub||0),0),missing=xs.filter(o=>o.cost_total_rub==null).length;return `<div class="fc-day" data-day="${day}"><div class="fc-day-top"><div><b>${dateLabel(day)}</b><div class="fc-muted">${groupDayOps(xs).length} позиций${xs.length!==groupDayOps(xs).length?` · ${xs.length} списаний`:''}${missing?` · без цены: ${missing}`:''}</div></div><div style="text-align:right"><b>${money(total)}</b><br><button class="fc-btn">Открыть</button></div></div><div class="fc-lines" hidden></div></div>`}).join(''):'<div class="fc-day">Пока нет списаний.</div>';
      root.querySelectorAll('.fc-day[data-day]').forEach(card=>{const day=card.dataset.day,xs=groups[day],lines=card.querySelector('.fc-lines');card.querySelector('.fc-btn').onclick=()=>{if(!lines.hidden){lines.hidden=true;return}lines.hidden=false;const grouped=groupDayOps(xs);lines.innerHTML=grouped.map(g=>{const priceText=g.mixed_prices?'несколько цен':g.unit_price_rub==null?'цена не задана':money(g.unit_price_rub)+' / ед.';const sub=g.ops.length>1?`<div class="fc-subops" data-subops="${esc(g.key)}" hidden>${g.ops.map(o=>`<div class="fc-subop"><div><div class="fc-muted">${new Date(o.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})} · ${o.quantity} ${esc(o.unit||'')} · ${o.cost_total_rub==null?'—':money(o.cost_total_rub)}</div></div><button class="fc-delete" type="button" data-fc-delete="${esc(o.id)}">Удалить</button></div>`).join('')}</div>`:'';return `<div class="fc-line"><div><div class="fc-line-name">${esc(g.item_name)}</div><div class="fc-muted">${Number(g.quantity).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${esc(g.unit||'')} · ${priceText}${g.ops.length>1?` · ${g.ops.length} списания`:''}</div></div><div class="fc-line-side"><b>${money(g.cost_total_rub)}</b>${g.ops.length===1?`<button class="fc-delete" type="button" data-fc-delete="${esc(g.ops[0].id)}">Удалить</button>`:`<button class="fc-expand" type="button" data-fc-expand="${esc(g.key)}">Развернуть</button>`}</div>${sub}</div>`}).join('')+`${xs.some(o=>o.cost_total_rub==null)?'<div class="fc-warning">Есть позиции без цены — итог дня пока неполный.</div>':''}<div class="fc-actions"><button class="fc-add-day">＋ Добавить списание на этот день</button><button data-csv>Скачать CSV</button><button data-print>Печать / PDF</button></div>`;lines.querySelector('.fc-add-day').onclick=()=>openEditor(day);lines.querySelector('[data-csv]').onclick=()=>csv(day,xs);lines.querySelector('[data-print]').onclick=()=>printDay(day,xs);lines.querySelectorAll('[data-fc-delete]').forEach(b=>b.onclick=e=>{e.stopPropagation();requestDelete(b.dataset.fcDelete)});lines.querySelectorAll('[data-fc-expand]').forEach(b=>b.onclick=e=>{e.stopPropagation();const box=lines.querySelector(`[data-subops="${CSS.escape(b.dataset.fcExpand)}"]`);if(!box)return;box.hidden=!box.hidden;b.textContent=box.hidden?'Развернуть':'Свернуть'})}})
    }catch(e){root.querySelector('.fc-list').innerHTML=`<div class="fc-warning">Не удалось загрузить расходы: ${esc(e.message||e)}</div>`}
  }
  function installNavButton(){const nav=document.querySelector('.bottom-nav');if(!nav||nav.querySelector('.fc-pill'))return;const b=document.createElement('button');b.className='nav-btn fc-pill';b.type='button';b.innerHTML='<span class="nav-icon nav-icon-ruble">₽</span><em>Питание</em>';b.onclick=open;nav.appendChild(b)}
  function start(){styles();installNavButton();const root=document.getElementById('app');if(root)new MutationObserver(()=>installNavButton()).observe(root,{childList:true,subtree:true});document.addEventListener('kambuz-operation-deleted',()=>{if(document.querySelector('.fc-overlay'))setTimeout(open,80)});document.addEventListener('kambuz-dated-expense-added',()=>{if(document.querySelector('.fc-overlay'))setTimeout(open,80)})}
  window.KAMBUZ_FOOD_COST={version:VERSION,open,openEditor};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();