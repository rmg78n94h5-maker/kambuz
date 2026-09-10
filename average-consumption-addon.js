(() => {
  'use strict';
  const VERSION='1.9.6';
  const OPS_KEY='kambuz_ops';
  let lastItemId=null;
  let sb=null;
  let refreshToken=0;
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
  const fmt=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
  const sod=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
  const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
  function validQty(o){const n=Number(o?.quantity);return Number.isFinite(n)&&n>=0&&n<1e9?n:null}
  function localConsumptions(id){return (read(OPS_KEY,[])||[]).filter(o=>o.item_id===id&&o.type==='consumption'&&validQty(o)!==null&&Number.isFinite(new Date(o.created_at).getTime()))}
  async function client(){
    if(sb)return sb;
    const c=window.KAMBUZ_CONFIG||{};
    if(!navigator.onLine||!window.supabase||!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY)return null;
    sb=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    return sb;
  }
  function calc(ops){
    const today=sod(new Date());
    const start30=addDays(today,-29);
    const tomorrow=addDays(today,1);
    const xs=(ops||[]).filter(o=>o.type==='consumption'&&validQty(o)!==null&&new Date(o.created_at)>=start30&&new Date(o.created_at)<tomorrow);
    const total=xs.reduce((s,o)=>s+validQty(o),0);
    if(!xs.length)return {avg:0,days:0,total};
    const first=sod(new Date(Math.min(...xs.map(o=>new Date(o.created_at).getTime()))));
    const days=Math.max(1,Math.min(30,Math.floor((today-first)/86400000)+1));
    return {avg:total/days,days,total};
  }
  function findCard(){
    return [...document.querySelectorAll('.modal-backdrop')].find(m=>m.querySelector('.ic-metrics'))||null;
  }
  function setLoading(itemId){
    const modal=findCard();if(!modal)return;
    const tiles=modal.querySelectorAll('.ic-metrics>div');if(tiles.length<4)return;
    const strong=tiles[3].querySelector('strong');
    const em=tiles[3].querySelector('em');
    const local=localConsumptions(itemId);
    if(!local.length){
      if(strong)strong.textContent='…';
      if(em)em.textContent=navigator.onLine?'загружаю расход…':'нет локальных данных';
    }
  }
  function applyToCard(itemId,ops){
    const modal=findCard();if(!modal)return false;
    const tiles=modal.querySelectorAll('.ic-metrics>div');if(tiles.length<4)return false;
    const result=calc(ops);
    const unit=(read('kambuz_items',[])||[]).find(i=>i.id===itemId)?.unit||'';
    const strong=tiles[3].querySelector('strong');
    const em=tiles[3].querySelector('em');
    const strongText=`${fmt(result.avg)} ${unit}`.trim();
    const emText=result.days?`за ${result.days} календ. дн. от первого расхода`:'расходов за 30 дней нет';
    if(strong&&strong.textContent!==strongText)strong.textContent=strongText;
    if(em&&em.textContent!==emText)em.textContent=emText;
    return true;
  }
  async function refresh(itemId){
    if(!itemId)return;
    const token=++refreshToken;
    const local=localConsumptions(itemId);
    setLoading(itemId);
    const c=await client();
    if(token!==refreshToken||itemId!==lastItemId)return;
    if(!c){applyToCard(itemId,local);return;}
    const start30=addDays(sod(new Date()),-29);
    try{
      const {data,error}=await c.from('operations').select('id,item_id,type,quantity,created_at').eq('item_id',itemId).eq('type','consumption').gte('created_at',start30.toISOString()).order('created_at',{ascending:true});
      if(error)throw error;
      if(token!==refreshToken||itemId!==lastItemId)return;
      const byId=new Map();
      for(const o of [...(data||[]),...local.filter(o=>o.pending)]){
        const key=o.id||`${o.item_id}|${o.created_at}|${o.quantity}`;
        byId.set(key,o);
      }
      applyToCard(itemId,[...byId.values()]);
    }catch(e){
      console.warn('Average consumption refresh failed',e);
      if(token===refreshToken&&itemId===lastItemId)applyToCard(itemId,local);
    }
  }
  function detectCard(node){
    if(!(node instanceof Element)||!lastItemId)return;
    const modal=node.matches('.modal-backdrop')?node:node.querySelector?.('.modal-backdrop');
    if(!modal?.querySelector('.ic-metrics'))return;
    if(modal.dataset.avgConsumptionItem===lastItemId)return;
    modal.dataset.avgConsumptionItem=lastItemId;
    refresh(lastItemId);
  }
  document.addEventListener('click',e=>{
    const row=e.target.closest?.('[data-item]');
    if(row?.dataset.item)lastItemId=row.dataset.item;
  },true);
  document.addEventListener('kambuz:item-card-open',e=>{
    const id=e?.detail?.itemId;
    if(id){lastItemId=id;refresh(id);}
  });
  new MutationObserver(ms=>{
    for(const m of ms)for(const n of m.addedNodes)detectCard(n);
  }).observe(document.body,{childList:true,subtree:true});
  window.KAMBUZ_AVERAGE_CONSUMPTION={version:VERSION,calc,refresh};
})();