(() => {
  'use strict';
  const ITEMS='kambuz_items', QUEUE='kambuz_pending_ops', MARK='kambuz_merge_tombstone_reload';
  const cfg=window.KAMBUZ_CONFIG||{};
  let client=null, running=false;
  function read(k,f=[]){try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}}
  function write(k,v){localStorage.setItem(k,JSON.stringify(v))}
  async function loadSupabase(){if(window.supabase)return window.supabase;return new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=()=>window.supabase?res(window.supabase):rej(new Error('no supabase'));s.onerror=()=>rej(new Error('no supabase'));document.head.appendChild(s)})}
  async function clean(){
    if(running||!navigator.onLine||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return;running=true;
    try{
      const lib=await loadSupabase(); client=client||lib.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
      const {data:{session}}=await client.auth.getSession(); if(!session)return;
      const {data,error}=await client.from('item_merges').select('source_item_id'); if(error||!data?.length)return;
      const dead=new Set(data.map(x=>String(x.source_item_id)));
      const items=read(ITEMS,[]); const filtered=items.filter(x=>!dead.has(String(x.id)));
      const q=read(QUEUE,[]); const q2=q.filter(x=>!dead.has(String(x.item_id)) && !(x.kind==='item_upsert'&&dead.has(String(x.item?.id||x.item_id))));
      const changed=filtered.length!==items.length || q2.length!==q.length;
      if(changed){write(ITEMS,filtered);write(QUEUE,q2);const stamp=Date.now();localStorage.setItem(MARK,String(stamp));setTimeout(()=>location.reload(),80)}
    }catch(e){console.warn('merge tombstone cleanup',e)}finally{running=false}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(clean,700),{once:true});else setTimeout(clean,700);
  setInterval(clean,4000);
  window.addEventListener('online',clean);
})();