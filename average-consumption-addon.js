(() => {
  'use strict';
  const VERSION='1.9.4';
  const OPS_KEY='kambuz_ops';
  let lastItemId=null;
  let sb=null;
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
    const xs=(ops||[]).filter(o=>o.type==='consumption'&&validQty(o)!==null&&new Date(o.created_at)>=start30&&new Date(o.created_at)<=addDays(today,1));
    const total=xs.reduce((s,o)=>s+validQty(o),0);
    if(!xs.length)return {avg:0,days:0,total};
    const firstRaw=new Date(Math.min(...xs.map(o=>new Date(o.created_at).getTime())));
    const first=sod(firstRaw)<start30?start30:sod(firstRaw);
    const days=Math.max(1,Math.min(30,Math.floor((today-first)/86400000)+1));
    return {avg:total/days,days,total};
  }
  function applyToCard(itemId,ops){
    const modal=[...document.querySelectorAll('.modal-backdrop')].find(m=>m.querySelector('.ic-metrics'));
    if(!modal)return;
    const tiles=modal.querySelectorAll('.ic-metrics>div');
    if(tiles.length<4)return;
    const result=calc(ops);
    const unit=(read('kambuz_items',[])||[]).find(i=>i.id===itemId)?.unit||'';
    const strong=tiles[3].querySelector('strong');
    const em=tiles[3].querySelector('em');
    if(strong)strong.textContent=`${fmt(result.avg)} ${unit}`.trim();
    if(em)em.textContent=result.days?`за ${result.days} календ. дн. от первого расхода`:'расходов пока нет';
  }
  async function refresh(itemId){
    const local=localConsumptions(itemId);
    applyToCard(itemId,local);
    const c=await client();
    if(!c)return;
    const today=sod(new Date()),start30=addDays(today,-29);
    try{
      const {data,error}=await c.from('operations').select('*').eq('item_id',itemId).eq('type','consumption').gte('created_at',start30.toISOString()).order('created_at',{ascending:true});
      if(error)throw error;
      const byId=new Map();
      for(const o of [...(data||[]),...local.filter(o=>o.pending)])byId.set(o.id||`${o.created_at}|${o.quantity}`,o);
      applyToCard(itemId,[...byId.values()]);
    }catch(e){console.warn('Average consumption refresh failed',e)}
  }
  function maybeRefresh(){
    if(!lastItemId)return;
    const modal=[...document.querySelectorAll('.modal-backdrop')].find(m=>m.querySelector('.ic-metrics'));
    if(modal)refresh(lastItemId);
  }
  document.addEventListener('click',e=>{
    const row=e.target.closest?.('[data-item]');
    if(row?.dataset.item)lastItemId=row.dataset.item;
  },true);
  let timer;
  new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(maybeRefresh,80)}).observe(document.body,{childList:true,subtree:true});
  window.KAMBUZ_AVERAGE_CONSUMPTION={version:VERSION,calc};
})();