(() => {
  'use strict';
  const VERSION='1.9.2';
  const KEYS={items:'kambuz_items',ops:'kambuz_ops'};
  const GROUP_LABELS={
    frozen_meat_fish:'Frozen foods, meat, fish, chicken',
    fresh_produce:'Fresh vegetables, fruits',
    grocery:'Grocery',
    dairy:'Dairy products',
    canned:'Canned goods'
  };
  const clean=v=>String(v??'').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
  const dayKey=value=>{const d=value?new Date(value):new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const startOfDay=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
  const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
  let lastItemId=null;
  let cloudClient=null;

  function safeQuantity(op){
    const n=Number(op?.quantity);
    if(!Number.isFinite(n)||n<0)return null;
    // Unix timestamps in milliseconds must never be interpreted as stock quantities.
    if(n>=978307200000&&n<=4133980800000)return null;
    // A galley stock operation above one billion units is data corruption, not real usage.
    if(n>1000000000)return null;
    return n;
  }
  function validOperation(op){
    if(!op||typeof op!=='object')return false;
    if(safeQuantity(op)===null)return false;
    const t=new Date(op.created_at).getTime();
    return Number.isFinite(t);
  }
  function sanitizeOps(ops){return (Array.isArray(ops)?ops:[]).filter(validOperation)}
  function mergeById(primary,secondary){
    const out=[],seen=new Set();
    for(const op of [...sanitizeOps(primary),...sanitizeOps(secondary)]){
      const key=op.id||`${op.item_id}|${op.type}|${op.created_at}|${op.quantity}`;
      if(seen.has(key))continue;seen.add(key);out.push(op);
    }
    return out.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  }

  function itemById(id){return (read(KEYS.items,[])||[]).find(x=>x.id===id)}
  function localOps(id){return sanitizeOps(read(KEYS.ops,[])||[]).filter(o=>o.item_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}
  function opLabel(o){
    if(o.type==='receipt')return 'Поступление';
    if(o.type==='consumption')return 'Расход';
    if(o.type==='writeoff')return 'Списание';
    if(o.type==='adjustment' && /инвентаризац/i.test(`${o.reason||''} ${o.comment||''}`))return 'Инвентаризация';
    if(o.type==='adjustment')return 'Корректировка';
    return o.type||'Операция';
  }
  function opSign(o){return o.type==='receipt'?'+':o.type==='adjustment'?'±':'−'}

  async function getCloudClient(){
    if(cloudClient)return cloudClient;
    const cfg=window.KAMBUZ_CONFIG||{};
    if(!navigator.onLine||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase)return null;
    cloudClient=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    return cloudClient;
  }
  async function fetchCloudOps(itemId,{since=null,all=false}={}){
    const client=await getCloudClient();
    if(!client)return null;
    try{
      if(!all){
        let q=client.from('operations').select('*').eq('item_id',itemId).order('created_at',{ascending:false}).limit(1000);
        if(since)q=q.gte('created_at',since.toISOString());
        const {data,error}=await q;if(error)throw error;return sanitizeOps(data||[]);
      }
      const out=[];let from=0;
      while(true){
        const {data,error}=await client.from('operations').select('*').eq('item_id',itemId).order('created_at',{ascending:false}).range(from,from+999);
        if(error)throw error;const page=data||[];out.push(...page);if(page.length<1000||out.length>=10000)break;from+=1000;
      }
      return sanitizeOps(out);
    }catch(e){console.warn('Item history cloud fetch failed',e);return null}
  }

  function stats(rawOps){
    const ops=sanitizeOps(rawOps);
    const now=new Date(),today=startOfDay(now),start7=addDays(today,-6),start30=addDays(today,-29);
    const consumption=ops.filter(o=>o.type==='consumption');
    const sumSince=start=>consumption.filter(o=>new Date(o.created_at)>=start).reduce((s,o)=>s+(safeQuantity(o)??0),0);
    const todayQty=consumption.filter(o=>dayKey(o.created_at)===dayKey(today)).reduce((s,o)=>s+(safeQuantity(o)??0),0);
    const q7=sumSince(start7),q30=sumSince(start30);
    const relevant=ops.filter(o=>new Date(o.created_at)>=start30);
    let days=30;
    if(relevant.length){
      const oldest=new Date(Math.min(...relevant.map(o=>new Date(o.created_at).getTime())));
      const first=startOfDay(oldest)>start30?startOfDay(oldest):start30;
      days=Math.max(1,Math.min(30,Math.floor((today-first)/86400000)+1));
    }
    return {today:todayQty,q7,q30,avg:q30/days,days,start30,today};
  }

  function chartHtml(rawOps){
    const ops=sanitizeOps(rawOps);
    const today=startOfDay(new Date()),days=[];
    for(let n=29;n>=0;n--){const d=addDays(today,-n);days.push({key:dayKey(d),date:d,value:0})}
    const map=new Map(days.map(x=>[x.key,x]));
    ops.filter(o=>o.type==='consumption').forEach(o=>{const x=map.get(dayKey(o.created_at));if(x)x.value+=(safeQuantity(o)??0)});
    const max=Math.max(1,...days.map(x=>x.value));
    return `<div class="ic-chart"><div class="ic-bars">${days.map(x=>`<div class="ic-bar-wrap" title="${x.date.toLocaleDateString('ru-RU')}: ${fmt(x.value)}"><div class="ic-bar${x.value?' active':''}" style="height:${Math.max(2,Math.round(x.value/max*52))}px"></div></div>`).join('')}</div><div class="ic-chart-axis"><span>${days[0].date.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</span><span>Расход за 30 дней</span><span>сегодня</span></div></div>`;
  }

  function infoHtml(item){
    const pack=Number(item.volume||0)>0&&clean(item.package_unit)?`${fmt(item.volume)} ${esc(item.package_unit)}`:'—';
    let imo='—',imoAmount='—';
    if(item.category==='Продукты'){
      imo=GROUP_LABELS[item.report_group]||GROUP_LABELS[window.KAMBUZ_CLASSIFIER?.imoGroup?.(item.subcategory)]||'Grocery';
      const r=window.KAMBUZ_IMO_REPORT?.kgFor?.(item);
      if(r?.kg!=null)imoAmount=`${fmt(r.kg)} кг`;
      else if(Number(item.qty||0)>0)imoAmount='нужна фасовка';
    }
    return `<div class="ic-info-grid">
      <div><small>Категория</small><b>${esc(item.category||'—')}</b></div>
      <div><small>Подкатегория</small><b>${esc(item.subcategory||'—')}</b></div>
      <div><small>Учёт на складе</small><b>${esc(item.unit||'—')}</b></div>
      <div><small>Фасовка</small><b>${pack}</b></div>
      <div><small>IMO/FAL группа</small><b>${esc(imo)}</b></div>
      <div><small>В IMO сейчас</small><b>${esc(imoAmount)}</b></div>
      <div><small>Минимум</small><b>${fmt(item.min_qty||0)} ${esc(item.unit||'')}</b></div>
      <div><small>Штрихкод</small><b>${esc(item.barcode||'—')}</b></div>
    </div>`;
  }

  function metricsHtml(item,ops){
    const s=stats(ops),u=esc(item.unit||'');
    return `<div class="ic-section"><div class="ic-section-title"><b>📊 Расход</b><small>Только обычный расход; списания и инвентаризация не учитываются</small></div>
      <div class="ic-metrics">
        <div><small>Сегодня</small><strong>${fmt(s.today)} ${u}</strong></div>
        <div><small>7 дней</small><strong>${fmt(s.q7)} ${u}</strong></div>
        <div><small>30 дней</small><strong>${fmt(s.q30)} ${u}</strong></div>
        <div><small>Средний / день</small><strong>${fmt(s.avg)} ${u}</strong><em>за ${s.days} дн. данных</em></div>
      </div>${chartHtml(ops)}</div>`;
  }

  function historyPreview(item,rawOps){
    const ops=sanitizeOps(rawOps);
    const rows=ops.slice(0,5).map(o=>`<div class="ic-op"><div><span class="ic-badge t-${esc(o.type)}">${esc(opLabel(o))}</span><small>${new Date(o.created_at).toLocaleString('ru-RU')}${o.reason?` · ${esc(o.reason)}`:''}${o.comment?` · ${esc(o.comment)}`:''}</small></div><strong>${opSign(o)}${fmt(safeQuantity(o)??0)} ${esc(o.unit||item.unit||'')}</strong></div>`).join('')||'<div class="ic-empty">Операций пока нет</div>';
    return `<div class="ic-section"><div class="ic-section-title"><b>📜 История</b><small class="ic-history-count">${ops.length} операций загружено</small></div>${rows}<button class="ic-history-btn" type="button">Вся история</button></div>`;
  }

  function ensureStyles(){
    if(document.getElementById('item-card-v2-styles'))return;
    const s=document.createElement('style');s.id='item-card-v2-styles';s.textContent=`
      .ic-v2{margin-top:14px}.ic-section{background:#f7faf8;border:1px solid #e1e9e6;border-radius:18px;padding:14px;margin:12px 0}.ic-section-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:11px}.ic-section-title>b{font-size:15px}.ic-section-title>small{font-size:11px;color:#70817b;text-align:right;max-width:60%}
      .ic-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ic-metrics>div,.ic-info-grid>div{background:#fff;border:1px solid #e6ece9;border-radius:13px;padding:10px;min-width:0}.ic-metrics small,.ic-info-grid small{display:block;font-size:10px;color:#73857f;margin-bottom:4px}.ic-metrics strong,.ic-info-grid b{font-size:14px;overflow-wrap:anywhere}.ic-metrics em{display:block;font-style:normal;font-size:9px;color:#8b9995;margin-top:3px}
      .ic-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ic-chart{margin-top:12px;background:#fff;border:1px solid #e6ece9;border-radius:13px;padding:10px}.ic-bars{height:58px;display:flex;gap:2px;align-items:flex-end}.ic-bar-wrap{flex:1;height:56px;display:flex;align-items:flex-end}.ic-bar{width:100%;min-height:2px;border-radius:3px 3px 1px 1px;background:#dce7e2}.ic-bar.active{background:#5cae92}.ic-chart-axis{display:flex;justify-content:space-between;color:#82918c;font-size:9px;margin-top:5px}
      .ic-op{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #e3ebe7;align-items:center}.ic-op:first-of-type{border-top:0}.ic-op>div{min-width:0}.ic-op small{display:block;color:#74857f;font-size:10px;margin-top:4px}.ic-op strong{font-size:13px;white-space:nowrap}.ic-badge{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:700;background:#e9efec}.ic-badge.t-consumption{background:#e3f4ed;color:#17664f}.ic-badge.t-receipt{background:#e5efff;color:#2c5c9c}.ic-badge.t-writeoff{background:#fff0e3;color:#985413}.ic-badge.t-adjustment{background:#f0e9ff;color:#6742a0}.ic-history-btn{width:100%;border:0;border-radius:12px;padding:11px;margin-top:8px;background:#e9f0ed;color:#24483f;font:750 13px system-ui}.ic-empty{color:#74857f;text-align:center;padding:15px}
      .ich-overlay{position:fixed;inset:0;z-index:220000;background:#f5f7f6;color:#17352e;font-family:system-ui;display:flex;flex-direction:column}.ich-head{padding:calc(env(safe-area-inset-top) + 12px) 16px 12px;background:#fff;border-bottom:1px solid #e2e9e6;display:flex;align-items:center;gap:10px}.ich-head>div{flex:1;min-width:0}.ich-head b{display:block;font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ich-head small{color:#73857f}.ich-close{border:0;background:#edf2f0;border-radius:12px;width:42px;height:42px;font-size:20px}.ich-filters{display:flex;gap:7px;overflow:auto;padding:10px 16px;background:#f5f7f6;scrollbar-width:none}.ich-chip{white-space:nowrap;border:1px solid #d8e2de;background:#fff;border-radius:999px;padding:8px 11px;font:700 12px system-ui;color:#526a62}.ich-chip.on{background:#dff3eb;border-color:#afdccb;color:#0a6c56}.ich-list{overflow:auto;padding:0 16px calc(env(safe-area-inset-bottom) + 30px)}.ich-row{background:#fff;border:1px solid #e1e8e5;border-radius:15px;padding:12px;margin:8px 0}.ich-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.ich-top strong{white-space:nowrap}.ich-meta{font-size:11px;color:#71837d;margin-top:6px}.ich-loading{text-align:center;color:#71837d;padding:35px}
    `;document.head.appendChild(s);
  }

  function hideOldHistory(modal){
    const h=[...modal.querySelectorAll('h3')].find(x=>clean(x.textContent)==='Последние операции');
    if(h){h.style.display='none';if(h.nextElementSibling)h.nextElementSibling.style.display='none'}
  }

  function enhance(modal,itemId){
    if(!modal?.querySelector('.detail-card')||modal.dataset.cardV2)return;
    const item=itemById(itemId);if(!item)return;
    modal.dataset.cardV2='1';hideOldHistory(modal);
    const edit=modal.querySelector('[data-edit-item]');if(!edit)return;
    const holder=document.createElement('div');holder.className='ic-v2';
    const ops=localOps(item.id);
    holder.innerHTML=`<div class="ic-section"><div class="ic-section-title"><b>ℹ️ Карточка товара</b><small>${esc(item.category||'')} · ${esc(item.subcategory||'')}</small></div>${infoHtml(item)}</div>${metricsHtml(item,ops)}${historyPreview(item,ops)}`;
    edit.insertAdjacentElement('beforebegin',holder);
    holder.querySelector('.ic-history-btn').onclick=()=>openHistory(item);
    refreshMetricsFromCloud(item,holder);
  }

  async function refreshMetricsFromCloud(item,holder){
    const since=addDays(startOfDay(new Date()),-29);
    const cloud=await fetchCloudOps(item.id,{since});
    if(!cloud||!holder.isConnected)return;
    const pendingLocal=localOps(item.id).filter(o=>o.pending&&new Date(o.created_at)>=since);
    const allRecent=mergeById(cloud,pendingLocal);
    const metrics=holder.querySelectorAll('.ic-section')[1];
    if(metrics)metrics.outerHTML=metricsHtml(item,allRecent);
    const count=holder.querySelector('.ic-history-count');if(count)count.textContent='история доступна из облака';
  }

  function renderHistoryRows(box,item,rawOps,filter){
    const ops=sanitizeOps(rawOps);
    const list=filter==='all'?ops:filter==='inventory'?ops.filter(o=>o.type==='adjustment'&&/инвентаризац/i.test(`${o.reason||''} ${o.comment||''}`)):ops.filter(o=>o.type===filter);
    box.innerHTML=list.map(o=>`<div class="ich-row"><div class="ich-top"><span class="ic-badge t-${esc(o.type)}">${esc(opLabel(o))}</span><strong>${opSign(o)}${fmt(safeQuantity(o)??0)} ${esc(o.unit||item.unit||'')}</strong></div><div class="ich-meta">${new Date(o.created_at).toLocaleString('ru-RU')} · ${esc(o.user_name||'Пользователь')}${o.reason?` · ${esc(o.reason)}`:''}${o.comment?` · ${esc(o.comment)}`:''}${o.previous_qty!=null&&o.new_qty!=null?` · ${fmt(o.previous_qty)} → ${fmt(o.new_qty)}`:''}</div></div>`).join('')||'<div class="ich-loading">Нет операций этого типа</div>';
  }

  async function openHistory(item){
    document.getElementById('item-history-v2')?.remove();
    const o=document.createElement('div');o.id='item-history-v2';o.className='ich-overlay';o.innerHTML=`<div class="ich-head"><div><b>${esc(item.name)}</b><small class="ich-status">История товара</small></div><button class="ich-close">×</button></div><div class="ich-filters">${[['all','Все'],['consumption','Расход'],['receipt','Поступление'],['writeoff','Списание'],['inventory','Инвентаризация'],['adjustment','Корректировки']].map(([v,l])=>`<button class="ich-chip${v==='all'?' on':''}" data-hf="${v}">${l}</button>`).join('')}</div><div class="ich-list"><div class="ich-loading">Загружаю историю…</div></div>`;document.body.appendChild(o);o.querySelector('.ich-close').onclick=()=>o.remove();
    let ops=localOps(item.id),filter='all';const box=o.querySelector('.ich-list'),status=o.querySelector('.ich-status');renderHistoryRows(box,item,ops,filter);status.textContent=`${ops.length} операций на телефоне`;
    o.querySelectorAll('[data-hf]').forEach(b=>b.onclick=()=>{filter=b.dataset.hf;o.querySelectorAll('[data-hf]').forEach(x=>x.classList.toggle('on',x===b));renderHistoryRows(box,item,ops,filter)});
    const cloud=await fetchCloudOps(item.id,{all:true});
    if(cloud&&o.isConnected){ops=mergeById(cloud,localOps(item.id).filter(x=>x.pending));status.textContent=`${ops.length} операций · облако`;renderHistoryRows(box,item,ops,filter)}else if(o.isConnected&&!navigator.onLine)status.textContent=`${ops.length} операций · офлайн`;
  }

  function detectModal(node){
    if(!(node instanceof Element))return;
    const backdrop=node.matches('.modal-backdrop')?node:node.querySelector?.('.modal-backdrop');
    if(backdrop?.querySelector('.detail-card')&&lastItemId)setTimeout(()=>enhance(backdrop,lastItemId),0);
  }
  function start(){
    ensureStyles();
    document.addEventListener('click',e=>{const row=e.target.closest?.('[data-item]');if(row?.dataset.item)lastItemId=row.dataset.item},true);
    new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(detectModal))).observe(document.body,{childList:true,subtree:true});
  }
  window.KAMBUZ_ITEM_CARD={version:VERSION,openHistory,safeQuantity,sanitizeOps};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();