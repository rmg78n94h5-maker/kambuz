(() => {
  'use strict';
  const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const read=(key,fallback=[])=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
  const dateKey=v=>{const d=v?new Date(v):new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  function todayCost(){
    const today=dateKey();
    const deleted=new Set(read('kambuz_pending_ops',[]).filter(x=>x?.kind==='operation_delete').map(x=>x.operation_id));
    return read('kambuz_ops',[])
      .filter(o=>o&&!deleted.has(o.id)&&['consumption','writeoff'].includes(o.type)&&dateKey(o.created_at)===today)
      .reduce((sum,o)=>sum+Number(o.cost_total_rub||0),0);
  }
  function apply(){
    const next=money(todayCost());
    document.querySelectorAll('.card.stat').forEach(card=>{
      const label=card.querySelector('span');
      if(label?.textContent.trim()!=='Расход сегодня')return;
      const value=card.querySelector('strong');
      if(value && value.textContent!==next)value.textContent=next;
    });
  }
  function start(){
    apply();
    const root=document.getElementById('app')||document.body;
    let queued=false;
    new MutationObserver(()=>{
      if(queued)return;
      queued=true;
      requestAnimationFrame(()=>{queued=false;apply()});
    }).observe(root,{childList:true,subtree:true});
    window.addEventListener('storage',apply);
    document.addEventListener('kambuz-operation-deleted',apply);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
