(() => {
  'use strict';

  const cfg = window.KAMBUZ_CONFIG || {};
  const PROJECT_REF = (() => {
    try { return new URL(cfg.SUPABASE_URL).hostname.split('.')[0]; } catch { return ''; }
  })();
  const AUTH_KEY = PROJECT_REF ? `sb-${PROJECT_REF}-auth-token` : '';
  let client = null;

  function esc(v){return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  function readStoredUser(){
    if(!AUTH_KEY) return null;
    try{
      const raw = localStorage.getItem(AUTH_KEY);
      if(!raw) return null;
      const data = JSON.parse(raw);
      const user = data?.user || data?.currentSession?.user || data?.session?.user || null;
      return user;
    }catch{return null;}
  }

  function displayName(user){
    return String(user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || '').trim();
  }

  const storedUser = readStoredUser();
  if(storedUser){
    const name = displayName(storedUser);
    if(name) localStorage.setItem('kambuz_user', name);
  }

  function loadSupabase(){
    if(window.supabase) return Promise.resolve(window.supabase);
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.async=true;
      s.onload=()=>window.supabase?resolve(window.supabase):reject(new Error('Модуль входа не запустился'));
      s.onerror=()=>reject(new Error('Не удалось загрузить модуль входа'));
      document.head.appendChild(s);
    });
  }

  function style(){
    if(document.getElementById('kambuz-auth-style')) return;
    const s=document.createElement('style');
    s.id='kambuz-auth-style';
    s.textContent=`
      .kauth-overlay{position:fixed;inset:0;z-index:100000;background:#f3f7f5;display:flex;align-items:center;justify-content:center;padding:24px;padding-top:calc(env(safe-area-inset-top) + 24px);font-family:system-ui,-apple-system,sans-serif;color:#18322c}
      .kauth-card{width:min(430px,100%);background:#fff;border-radius:24px;padding:24px;box-shadow:0 18px 60px rgba(15,55,44,.16)}
      .kauth-logo{font-size:30px;font-weight:800;margin-bottom:4px}.kauth-sub{color:#61766f;margin:0 0 20px;line-height:1.4}
      .kauth-tabs{display:grid;grid-template-columns:1fr 1fr;background:#edf3f0;border-radius:14px;padding:4px;margin-bottom:18px}
      .kauth-tab{border:0;background:transparent;border-radius:11px;padding:10px;font-weight:700;color:#536a62}.kauth-tab.active{background:#fff;color:#0b5d4b;box-shadow:0 2px 8px rgba(0,0,0,.07)}
      .kauth-field{display:block;margin:12px 0}.kauth-field span{display:block;font-size:13px;font-weight:700;margin-bottom:6px}.kauth-field input{box-sizing:border-box;width:100%;font-size:16px;padding:13px 14px;border:1px solid #cbd8d3;border-radius:13px;background:#fff;color:#18322c}
      .kauth-submit{width:100%;border:0;border-radius:14px;background:#0b5d4b;color:#fff;font-size:16px;font-weight:800;padding:14px;margin-top:8px}.kauth-submit:disabled{opacity:.55}
      .kauth-msg{font-size:13px;line-height:1.4;margin-top:12px;color:#9b3d36}.kauth-msg.ok{color:#0b7258}
      .kauth-pill{position:fixed;z-index:90000;right:12px;top:calc(env(safe-area-inset-top) + 8px);border:0;border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 3px 16px rgba(0,0,0,.12);padding:8px 11px;font:700 12px system-ui;color:#23433a;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .kauth-sheet{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center}.kauth-sheet-card{width:min(500px,100%);background:#fff;border-radius:22px 22px 0 0;padding:22px;padding-bottom:calc(env(safe-area-inset-bottom) + 22px);font-family:system-ui;color:#18322c}.kauth-sheet-card button{width:100%;padding:13px;border-radius:13px;border:0;margin-top:9px;font-weight:800}.kauth-logout{background:#fff0ef;color:#a33}.kauth-close{background:#edf3f0;color:#23433a}
    `;
    document.head.appendChild(s);
  }

  function setMessage(root,text,ok=false){
    const el=root.querySelector('.kauth-msg'); if(!el) return;
    el.textContent=text||''; el.classList.toggle('ok',!!ok);
  }

  function renderLogin(){
    style();
    document.querySelector('.kauth-overlay')?.remove();
    const root=document.createElement('div');
    root.className='kauth-overlay';
    root.innerHTML=`<div class="kauth-card">
      <div class="kauth-logo">🍽️ Камбуз</div>
      <p class="kauth-sub">Один склад для всей команды. Войди под своим аккаунтом — все остатки и списания будут общими.</p>
      <div class="kauth-tabs"><button class="kauth-tab active" data-mode="login">Войти</button><button class="kauth-tab" data-mode="signup">Создать аккаунт</button></div>
      <form class="kauth-form">
        <label class="kauth-field kauth-name" style="display:none"><span>Имя</span><input name="name" autocomplete="name" placeholder="Например, Лёха"></label>
        <label class="kauth-field"><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="name@example.com"></label>
        <label class="kauth-field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="Минимум 6 символов"></label>
        <button class="kauth-submit" type="submit">Войти в Камбуз</button>
        <div class="kauth-msg"></div>
      </form>
    </div>`;
    document.body.appendChild(root);
    let mode='login';
    root.querySelectorAll('.kauth-tab').forEach(btn=>btn.onclick=()=>{
      mode=btn.dataset.mode;
      root.querySelectorAll('.kauth-tab').forEach(x=>x.classList.toggle('active',x===btn));
      root.querySelector('.kauth-name').style.display=mode==='signup'?'block':'none';
      root.querySelector('.kauth-submit').textContent=mode==='signup'?'Создать аккаунт':'Войти в Камбуз';
      root.querySelector('[name=password]').autocomplete=mode==='signup'?'new-password':'current-password';
      setMessage(root,'');
    });
    root.querySelector('.kauth-form').onsubmit=async e=>{
      e.preventDefault();
      const btn=root.querySelector('.kauth-submit'); btn.disabled=true;
      const fd=new FormData(e.currentTarget);
      const email=String(fd.get('email')||'').trim();
      const password=String(fd.get('password')||'');
      const name=String(fd.get('name')||'').trim();
      try{
        if(mode==='signup'){
          if(!name) throw new Error('Укажи имя — оно будет видно в истории списаний.');
          const {data,error}=await client.auth.signUp({email,password,options:{data:{display_name:name}}});
          if(error) throw error;
          if(data?.session){
            localStorage.setItem('kambuz_user',name);
            location.reload();
          }else{
            setMessage(root,'Аккаунт создан. Проверь почту и подтверди email, затем войди.',true);
          }
        }else{
          const {data,error}=await client.auth.signInWithPassword({email,password});
          if(error) throw error;
          const n=displayName(data?.user);
          if(n) localStorage.setItem('kambuz_user',n);
          location.reload();
        }
      }catch(err){setMessage(root,err?.message||'Не удалось войти');}
      finally{btn.disabled=false;}
    };
  }

  async function roleFor(user){
    try{
      const {data}=await client.from('crew_members').select('display_name,role').eq('user_id',user.id).maybeSingle();
      return data||null;
    }catch{return null;}
  }

  function renderAccount(user,member){
    style();
    document.querySelector('.kauth-pill')?.remove();
    const name=member?.display_name || displayName(user) || 'Пользователь';
    if(name) localStorage.setItem('kambuz_user',name);
    const pill=document.createElement('button'); pill.className='kauth-pill'; pill.textContent=`👤 ${name}`;
    pill.onclick=()=>{
      const old=document.querySelector('.kauth-sheet'); if(old){old.remove();return;}
      const sh=document.createElement('div'); sh.className='kauth-sheet';
      sh.innerHTML=`<div class="kauth-sheet-card"><b style="font-size:20px">${esc(name)}</b><div style="margin-top:5px;color:#61766f">${esc(user.email||'')} · ${member?.role==='admin'?'Администратор':'Пользователь'}</div><button class="kauth-logout">Выйти из аккаунта</button><button class="kauth-close">Закрыть</button></div>`;
      sh.querySelector('.kauth-close').onclick=()=>sh.remove();
      sh.querySelector('.kauth-logout').onclick=async()=>{await client.auth.signOut();localStorage.removeItem('kambuz_user');location.reload();};
      sh.onclick=e=>{if(e.target===sh)sh.remove();}; document.body.appendChild(sh);
    };
    document.body.appendChild(pill);
  }

  async function start(){
    style();
    if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY){renderLogin();const r=document.querySelector('.kauth-overlay');setMessage(r,'В приложении не настроено облачное подключение.');return;}
    try{
      const lib=await loadSupabase();
      client=lib.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
      const {data}=await client.auth.getSession();
      const user=data?.session?.user;
      if(!user){renderLogin();return;}
      const member=await roleFor(user);
      renderAccount(user,member);
      client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session)renderLogin();});
    }catch(err){
      renderLogin();
      const r=document.querySelector('.kauth-overlay'); setMessage(r,err?.message||'Ошибка входа');
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
