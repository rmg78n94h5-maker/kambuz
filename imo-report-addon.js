(() => {
  'use strict';
  const VERSION='1.8.0';
  const KEYS={items:'kambuz_items',queue:'kambuz_pending_ops'};
  const GROUPS=[
    ['frozen_meat_fish','Frozen foods, meat, fish, chicken'],
    ['fresh_produce','Fresh vegetables, fruits'],
    ['grocery','Grocery'],
    ['dairy','Dairy products'],
    ['canned','Canned goods']
  ];
  const ITEM_FIELDS=['id','name','brand','barcode','category','subcategory','volume','package_unit','unit','min_qty','location','notes','updated_at','report_group','report_density'];
  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toLowerCase().replace(/ё/g,'е').trim();
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
  const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const now=()=>new Date().toISOString();
  const fmt=(n,d=2)=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:d});
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function inferGroup(item){
    if(item.report_group)return item.report_group;
    const fn=window.KAMBUZ_CLASSIFIER?.imoGroup;
    if(typeof fn==='function')return fn(item.subcategory);
    const s=clean(item.subcategory);
    if(/консервы|джем|варенье/i.test(s))return 'canned';
    if(['Овощи','Фрукты','Свежая зелень'].includes(s))return 'fresh_produce';
    if(/Говядина|Свинина|Птица|Субпродукты|полуфабрикаты|Рыба|Морепродукты/.test(s))return 'frozen_meat_fish';
    if(['Молочная продукция','Сыры','Яйца'].includes(s))return 'dairy';
    return 'grocery';
  }
  function density(item){
    const d=Number(item.report_density||0);
    if(d>0)return d;
    return /масло раститель/i.test(item.name||'')?0.92:1;
  }
  function kgFor(item){
    const q=Number(item.qty||0),u=norm(item.unit),v=Number(item.volume||0),pu=norm(item.package_unit),d=density(item);
    if(q<=0)return {kg:0,formula:'0'};
    if(u==='кг')return {kg:q,formula:`${fmt(q)} кг`};
    if(u==='г')return {kg:q/1000,formula:`${fmt(q)} г ÷ 1000`};
    if(u==='л')return {kg:q*d,formula:`${fmt(q)} л × ${fmt(d,3)} кг/л`};
    if(u==='мл')return {kg:q/1000*d,formula:`${fmt(q)} мл ÷ 1000 × ${fmt(d,3)}`};
    if(v>0&&pu==='г')return {kg:q*v/1000,formula:`${fmt(q)} ${item.unit||'шт.'} × ${fmt(v)} г`};
    if(v>0&&pu==='кг')return {kg:q*v,formula:`${fmt(q)} ${item.unit||'шт.'} × ${fmt(v)} кг`};
    if(v>0&&pu==='мл')return {kg:q*v/1000*d,formula:`${fmt(q)} ${item.unit||'шт.'} × ${fmt(v)} мл × ${fmt(d,3)} кг/л`};
    if(v>0&&pu==='л')return {kg:q*v*d,formula:`${fmt(q)} ${item.unit||'шт.'} × ${fmt(v)} л × ${fmt(d,3)} кг/л`};
    return {kg:null,reason:'Нет массы/объёма фасовки для пересчёта в кг'};
  }
  function build(){
    const items=read(KEYS.items,[]).filter(i=>i.category==='Продукты');
    const groups=Object.fromEntries(GROUPS.map(([id])=>[id,{total:0,rows:[]}])) , unresolved=[];
    for(const item of items){
      if(Number(item.qty||0)<=0)continue;
      const r=kgFor(item),g=inferGroup(item);
      if(r.kg==null){unresolved.push({item,reason:r.reason});continue}
      if(!groups[g])groups[g]={total:0,rows:[]};
      groups[g].total+=r.kg;groups[g].rows.push({item,kg:r.kg,formula:r.formula});
    }
    return {groups,unresolved};
  }
  function queueUpsert(item){
    const q=read(KEYS.queue,[]),payload=Object.fromEntries(ITEM_FIELDS.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
    const task={id:`item:${item.id}`,kind:'item_upsert',item_id:item.id,item_name:item.name,item:payload,status:'pending',error:null,created_at:now()};
    const old=q.find(x=>x.kind==='item_upsert'&&x.item_id===item.id);old?Object.assign(old,task):q.unshift(task);write(KEYS.queue,q);
  }
  function saveItemMeta(id,patch){
    const xs=read(KEYS.items,[]),i=xs.find(x=>x.id===id);if(!i)return;
    Object.assign(i,patch,{updated_at:now()});write(KEYS.items,xs);queueUpsert(i);
  }

  function ensureStyles(){if(document.getElementById('imo-report-styles'))return;const s=document.createElement('style');s.id='imo-report-styles';s.textContent='.imo-o{position:fixed;inset:0;z-index:180000;background:#f5f7f6;font-family:system-ui;color:#17352e;overflow:auto}.imo-h{position:sticky;top:0;background:#fff;padding:calc(env(safe-area-inset-top) + 12px) 16px 12px;border-bottom:1px solid #e2e8e5;display:flex;align-items:center;gap:10px}.imo-h b{font-size:21px;flex:1}.imo-x{border:0;background:#edf2f0;border-radius:12px;width:42px;height:42px;font-size:20px}.imo-body{padding:16px 16px 120px;max-width:760px;margin:auto}.imo-note{font-size:13px;color:#62766f;margin-bottom:12px}.imo-table{background:#fff;border:1px solid #dfe7e4;border-radius:18px;overflow:hidden}.imo-row{display:grid;grid-template-columns:1fr auto;gap:12px;padding:14px;border-bottom:1px solid #e8eeeb;align-items:center}.imo-row:last-child{border-bottom:0}.imo-row button{border:0;background:transparent;text-align:left;font:700 14px system-ui;color:#23483e}.imo-row strong{font-size:16px}.imo-warn{margin-top:14px;background:#fff3df;border:1px solid #f0d09c;border-radius:16px;padding:13px;color:#7c5619}.imo-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.imo-actions button{border:0;border-radius:14px;padding:13px;font:750 14px system-ui}.imo-primary{background:#0b7a62;color:white}.imo-secondary{background:#e9f0ed;color:#24483f}.imo-detail{background:#fff;border-radius:16px;padding:12px;margin:8px 0;border:1px solid #e2e9e6}.imo-detail b{display:block}.imo-detail small{display:block;color:#697d76;margin-top:4px}.imo-fix{margin-top:8px;border:0;border-radius:10px;padding:8px 10px;background:#eef3f1}.imo-editor{background:#fff;border-radius:18px;padding:14px;margin-top:14px}.imo-editor select,.imo-editor input{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #d4dfdb;border-radius:10px;margin-top:6px;font:15px system-ui}.imo-editor label{font-size:12px;color:#667a73;display:block;margin-top:10px}.imo-editor button{width:100%;margin-top:12px;border:0;border-radius:12px;padding:12px;background:#0b7a62;color:#fff;font:750 14px system-ui}';document.head.appendChild(s)}

  function openEditor(item){
    const old=document.getElementById('imo-editor');old?.remove();
    const box=document.createElement('div');box.id='imo-editor';box.className='imo-editor';
    box.innerHTML=`<b>Настройка: ${esc(item.name)}</b><label>Учёт на складе</label><select data-u>${['шт.','бут.','упак.','короб','мешок','канистра','кг','г','л','мл'].map(x=>`<option${x===item.unit?' selected':''}>${x}</option>`).join('')}</select><label>Фасовка</label><input data-v inputmode="decimal" value="${esc(item.volume??'')}"><label>Ед. фасовки</label><select data-pu><option value="">—</option>${['г','кг','мл','л','шт.'].map(x=>`<option${x===clean(item.package_unit)?' selected':''}>${x}</option>`).join('')}</select><label>Группа IMO/FAL</label><select data-g>${GROUPS.map(([id,label])=>`<option value="${id}"${id===inferGroup(item)?' selected':''}>${label}</option>`).join('')}</select><label>Коэффициент кг/л для жидкостей</label><input data-d inputmode="decimal" value="${esc(item.report_density??density(item))}"><button>Сохранить карточку</button>`;
    document.querySelector('.imo-body')?.prepend(box);
    box.querySelector('button').onclick=()=>{const v=Number(String(box.querySelector('[data-v]').value).replace(',','.'))||null,d=Number(String(box.querySelector('[data-d]').value).replace(',','.'))||null;saveItemMeta(item.id,{unit:box.querySelector('[data-u]').value,volume:v,package_unit:box.querySelector('[data-pu]').value||null,report_group:box.querySelector('[data-g]').value,report_density:d});location.reload()};
    box.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function renderDetails(id){
    const r=build(),g=r.groups[id],body=document.querySelector('.imo-body');if(!body)return;const label=GROUPS.find(x=>x[0]===id)?.[1]||id;
    body.innerHTML=`<div class="imo-note"><b>${esc(label)}</b> · ${fmt(g.total)} kg (${Math.round(g.total)} Kgs в форме)</div>${g.rows.map(x=>`<div class="imo-detail"><b>${esc(x.item.name)}</b><small>${esc(x.formula)} = ${fmt(x.kg)} kg</small><button class="imo-fix" data-edit="${x.item.id}">Настроить карточку</button></div>`).join('')||'<div class="imo-note">Нет позиций</div>'}<button class="imo-secondary" style="width:100%;border:0;border-radius:13px;padding:12px" data-back>← Назад</button>`;
    body.querySelector('[data-back]').onclick=renderMain;body.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(read(KEYS.items,[]).find(i=>i.id===b.dataset.edit)));
  }
  function renderMain(){
    const r=build(),body=document.querySelector('.imo-body');if(!body)return;
    body.innerHTML=`<div class="imo-note">Формат с твоего IMO FAL Form 3: все строки PROVISION STORES выводятся в <b>Kgs</b>. На складе при этом сохраняются реальные шт./кг/л и фасовка.</div><div class="imo-table">${GROUPS.map(([id,label])=>`<div class="imo-row"><button data-g="${id}">${esc(label)}</button><strong>${Math.round(r.groups[id]?.total||0)} Kgs</strong></div>`).join('')}</div>${r.unresolved.length?`<div class="imo-warn"><b>⚠️ Не рассчитано: ${r.unresolved.length}</b><div style="margin-top:6px">${r.unresolved.map(x=>`${esc(x.item.name)} — ${fmt(x.item.qty)} ${esc(x.item.unit||'')}`).join('<br>')}</div></div>`:''}<div class="imo-actions"><button class="imo-primary" data-copy>Скопировать</button><button class="imo-secondary" data-print>PDF / печать</button></div>${r.unresolved.map(x=>`<div class="imo-detail"><b>${esc(x.item.name)}</b><small>${esc(x.reason)}</small><button class="imo-fix" data-edit="${x.item.id}">Заполнить фасовку</button></div>`).join('')}`;
    body.querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>renderDetails(b.dataset.g));body.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(read(KEYS.items,[]).find(i=>i.id===b.dataset.edit)));
    body.querySelector('[data-copy]').onclick=async()=>{const text=['PROVISION STORES:',...GROUPS.map(([id,label])=>`${label} — ${Math.round(r.groups[id]?.total||0)} Kgs`),...(r.unresolved.length?['','NOT CALCULATED:',...r.unresolved.map(x=>`${x.item.name} — ${x.item.qty} ${x.item.unit}`)]:[])].join('\n');try{await navigator.clipboard.writeText(text);alert('Отчёт скопирован')}catch{alert(text)}};
    body.querySelector('[data-print]').onclick=()=>{const w=window.open('','_blank');w.document.write(`<html><meta charset="utf-8"><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #555;padding:8px;text-align:left}td:last-child{text-align:right}</style><h2>PROVISION STORES</h2><table><tr><th>Name of articles</th><th>Quantity</th></tr>${GROUPS.map(([id,label])=>`<tr><td>${esc(label)}</td><td>${Math.round(r.groups[id]?.total||0)} Kgs</td></tr>`).join('')}</table>${r.unresolved.length?`<p><b>Warning:</b> ${r.unresolved.length} item(s) not calculated.</p>`:''}<script>print()</script>`);w.document.close()};
  }
  function open(){ensureStyles();document.getElementById('imo-report-overlay')?.remove();const o=document.createElement('div');o.id='imo-report-overlay';o.className='imo-o';o.innerHTML='<div class="imo-h"><b>IMO / FAL — Provision Stores</b><button class="imo-x">×</button></div><div class="imo-body"></div>';document.body.appendChild(o);o.querySelector('.imo-x').onclick=()=>o.remove();renderMain()}

  // Заменяем свободный ввод "Мл/МЛ/мл" на фиксированный список единиц фасовки.
  function patchPackageSelect(){
    document.querySelectorAll('input[name="package_unit"]').forEach(inp=>{if(inp.dataset.imoPatched)return;const sel=document.createElement('select');sel.name='package_unit';sel.dataset.imoPatched='1';sel.innerHTML='<option value="">—</option>'+['г','кг','мл','л','шт.'].map(x=>`<option${clean(inp.value).toLowerCase().replace('.','')===x.replace('.','')?' selected':''}>${x}</option>`).join('');sel.className=inp.className;inp.replaceWith(sel)});
  }
  function heading(){return [...document.querySelectorAll('#app h1,#app h2,#app h3,#app h4,#app div,#app span')].find(e=>(e.textContent||'').trim()==='Рабочие действия')}
  function install(){patchPackageSelect();if(document.getElementById('imo-report-button'))return;const h=heading();if(!h?.parentElement)return;const b=document.createElement('button');b.id='imo-report-button';b.type='button';b.innerHTML='<span style="font-size:24px">📄</span><span><b style="display:block;font-size:18px">IMO / FAL отчёт</b><small style="display:block;margin-top:3px;opacity:.7;font-size:13px">Provision Stores · итог в Kgs</small></span>';Object.assign(b.style,{width:'100%',margin:'12px 0 16px',border:'0',borderRadius:'22px',padding:'18px 20px',background:'#eaf6ef',color:'#19614e',textAlign:'left',display:'flex',alignItems:'center',gap:'14px',font:'inherit'});b.onclick=open;h.insertAdjacentElement('afterend',b)}
  function start(){ensureStyles();install();let t;new MutationObserver(()=>{clearTimeout(t);t=setTimeout(()=>{install();patchPackageSelect()},60)}).observe(document.body,{childList:true,subtree:true})}
  window.KAMBUZ_IMO_REPORT={version:VERSION,build,open,kgFor};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();