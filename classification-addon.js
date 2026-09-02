(() => {
  'use strict';
  const VERSION = '1.8.0';
  const KEYS = { items:'kambuz_items', queue:'kambuz_pending_ops' };
  const ITEM_FIELDS = ['id','name','brand','barcode','category','subcategory','volume','package_unit','unit','min_qty','location','notes','updated_at','report_group','report_density'];
  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
  const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const now=()=>new Date().toISOString();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function packageUnit(v){
    const u=norm(v);
    if(!u)return null;
    if(['г','гр'].includes(u))return 'г';
    if(u==='кг')return 'кг';
    if(u==='мл')return 'мл';
    if(u==='л')return 'л';
    if(['шт','шт.'].includes(u))return 'шт.';
    return clean(v)||null;
  }

  function normalizeProductSubcategory(s){
    s=clean(s);
    if(['Груши','Яблоки','Цитрусовые','Тропические фрукты'].includes(s))return 'Фрукты';
    if(['Капуста','Корнеплоды','Лук','Овощи','Перец сладкий','Салаты','Томаты'].includes(s))return 'Овощи';
    if(s==='Рис')return 'Крупы';
    if(s==='Молоко')return 'Молочная продукция';
    if(['Кетчупы','Соусы'].includes(s))return 'Соусы и приправы';
    if(s==='Бобовые и крупы')return 'Бобовые';
    return s||null;
  }

  function productSubcategory(name){
    const n=norm(name);
    // Консервы проверяем раньше свежих овощей/фруктов.
    if(/фасоль.*консерв/.test(n))return 'Бобовые консервы';
    if(/(горошек|кукуруз|гриб|икра из баклаж|икра кабач|корнишон|лечо|маслин|оливк|томат.*консерв)/.test(n))return 'Овощные консервы';
    if(/(горбуш|сайр|тунец).*консерв|шпрот/.test(n))return 'Рыбные консервы';
    if(/паштет/.test(n))return 'Мясные консервы';
    if(/сгущ/.test(n))return 'Молочные консервы';
    if(/(абрикос|персик).*консерв/.test(n))return 'Фруктовые консервы';
    if(/джем|варенье/.test(n))return 'Джемы и варенье';
    if(/говяж|говядин|рибай|кулак говяж|глазной мускул/.test(n))return 'Говядина';
    if(/свин|рульк/.test(n))return 'Свинина';
    if(/курин|куриц|индейк/.test(n))return /печен/.test(n)?'Субпродукты':'Птица';
    if(/ветчин|колбас|грудинк.*копчен|сало|сардель|сосиск|шпикач/.test(n))return 'Колбасы и мясная гастрономия';
    if(/купат/.test(n))return 'Мясные полуфабрикаты';
    if(/пельмен/.test(n))return 'Замороженные полуфабрикаты';
    if(/молоко$|кефир|йогурт|сливк|творог|масло сливоч/.test(n))return 'Молочная продукция';
    if(/сыр/.test(n))return 'Сыры';
    if(/яйц/.test(n))return 'Яйца';
    if(/греч|булгур|манн|перлов|пшеничн.*круп|рис/.test(n))return 'Крупы';
    if(/горох колот|чечев|нут\b/.test(n))return 'Бобовые';
    if(/макарон|спагет|вермиш/.test(n))return 'Макаронные изделия';
    if(/^мука/.test(n))return 'Мука';
    if(/^сахар/.test(n))return 'Сахар';
    if(/масло раститель/.test(n))return 'Масла';
    if(/соль|специ|перец молот|приправа/.test(n))return 'Соль и специи';
    if(/кофе/.test(n))return 'Кофе';
    if(/^чай/.test(n))return 'Чай';
    if(/мюсли|хлопья/.test(n))return 'Сухие завтраки';
    if(/сухофрукт|смесь компот/.test(n))return 'Сухофрукты';
    if(/конфет|печенье|шоколад|вафл/.test(n))return 'Кондитерские изделия';
    if(/укроп|петруш|кинз|лук зелен/.test(n))return 'Свежая зелень';
    if(/яблок|груш|банан|ананас|киви|манго|грейпфрут|лимон|мандарин|апельсин/.test(n))return 'Фрукты';
    if(/баклажан|кабач|цукини|огур|броккол|капуст|картоф|лук бел|лук крас|перец крас|перец жел|перец зелен|томат|салат айсберг/.test(n))return 'Овощи';
    if(/майонез|аджик|кетчуп|соев.*соус|остр.*соус|томатн.*паст|уксус/.test(n))return 'Соусы и приправы';
    if(/хлеб|батон/.test(n))return 'Хлеб';
    if(/сок|безалкогольн.*напит/.test(n))return 'Напитки';
    return null;
  }

  function imoGroup(sub){
    if(['Овощные консервы','Рыбные консервы','Мясные консервы','Молочные консервы','Фруктовые консервы','Бобовые консервы','Джемы и варенье'].includes(sub))return 'canned';
    if(['Овощи','Фрукты','Свежая зелень'].includes(sub))return 'fresh_produce';
    if(['Говядина','Свинина','Птица','Субпродукты','Мясные полуфабрикаты','Замороженные полуфабрикаты','Рыба','Морепродукты'].includes(sub))return 'frozen_meat_fish';
    if(['Молочная продукция','Сыры','Яйца'].includes(sub))return 'dairy';
    return 'grocery';
  }

  function classify(item){
    const name=clean(item?.name), n=norm(name), current=clean(item?.category)||'Продукты';
    let category=current, sub=clean(item?.subcategory)||null, unit=clean(item?.unit)||'шт.';
    const pu=packageUnit(item?.package_unit);

    if(/губк|мет\.губ|пленк|плёнк|фольг|пакет|наволоч|пододеяль|простын|подушк|одеял|полотен|шторк.*душ|бумажн.*салфет|туалетн.*бумаг|лента от мух|ловушк.*таракан|тележк.*мусор/.test(n)){
      category='Хозтовары';
      if(/губк/.test(n))sub='Губки и принадлежности для уборки';
      else if(/пленк|плёнк|фольг/.test(n))sub='Плёнка и фольга';
      else if(/пакет/.test(n))sub='Пакеты';
      else if(/наволоч|пододеяль|простын|подушк|одеял/.test(n))sub='Постельное бельё';
      else if(/полотен/.test(n))sub='Полотенца';
      else if(/шторк.*душ/.test(n))sub='Ванная и санузел';
      else if(/бумажн.*салфет|туалетн.*бумаг/.test(n))sub='Бумажная продукция';
      else if(/лента от мух|ловушк.*таракан/.test(n))sub='Борьба с насекомыми';
      else sub='Уборочный инвентарь';
    } else if(/моющ|чистящ|антижир|белизн|кондиционер для белья|стиральн.*порош|мягк.*мыл|освежител.*воздух|крот$|clean glass|floor wash|для пола$|средство для кухни|средство для туалета|средство для нержав|gloss|pure & clean|универсальн.*моющ/.test(n)){
      category='Химия';
      if(/посуд|pure & clean/.test(n))sub='Средства для мытья посуды';
      else if(/floor wash|для пола$/.test(n))sub='Средства для пола';
      else if(/стиральн.*порош|кондиционер для белья/.test(n))sub='Стирка и уход за бельём';
      else if(/мягк.*мыл/.test(n))sub='Мыло и гигиена';
      else if(/освежител.*воздух/.test(n))sub='Освежители воздуха';
      else if(/clean glass|стекл|зеркал/.test(n))sub='Средства для стекол и зеркал';
      else if(/антижир|средство для кухни|нержав/.test(n))sub='Средства для кухни';
      else if(/туалет|унитаз/.test(n))sub='Средства для унитаза';
      else if(/крот$|прочист/.test(n))sub='Средства для прочистки труб';
      else if(/белизн|дезинфиц/.test(n))sub='Отбеливатели и дезинфицирующие средства';
      else if(/gloss|акрил|антиналет|антиналёт/.test(n))sub='Средства для ванной и сантехники';
      else if(/порош/.test(n)&&!/стиральн/.test(n))sub='Чистящие порошки';
      else sub='Универсальные моющие средства';
    } else if(/сковород|нож |мусат|салатник|солонк|стакан стекл|стакан однораз|мельниц.*перц|турка$|соковыжимал|удалитель сердцевины/.test(n)){
      category='Посуда';
      if(/нож |мусат/.test(n))sub='Ножи и заточка';
      else if(/сковород/.test(n))sub='Сковороды';
      else if(/стакан однораз/.test(n))sub='Одноразовая посуда';
      else if(/салатник|солонк|стакан стекл/.test(n))sub='Столовая посуда';
      else sub='Кухонные принадлежности';
      if(/соковыжимал|удалитель сердцевины/.test(n)&&unit==='кг')unit='шт.';
    } else if(/гриль настольн|кофемолк|^утюг$/.test(n)){
      category='Инвентарь'; sub='Электроприборы';
    } else if(current==='Продукты'||productSubcategory(name)){
      category='Продукты'; sub=productSubcategory(name)||normalizeProductSubcategory(sub);
      if(['Овощные консервы','Рыбные консервы','Мясные консервы','Молочные консервы','Фруктовые консервы','Бобовые консервы'].includes(sub) && Number(item?.volume||0)>0 && ['г','кг','мл','л'].includes(pu) && unit==='кг') unit='шт.';
      if(/hochland/i.test(name)&&Number(item?.volume||0)>0&&unit==='кг')unit='шт.';
    }

    const result={category,subcategory:sub||null,unit,package_unit:pu};
    if(category==='Продукты'){
      result.report_group=clean(item.report_group)||imoGroup(result.subcategory);
      result.report_density=Number(item.report_density||0)>0?Number(item.report_density):(/масло раститель/.test(n)?0.92:((unit==='л'||unit==='мл'||pu==='л'||pu==='мл')?1:null));
    }
    return result;
  }

  function differences(item){
    const next=classify(item), changes=[];
    for(const [label,key] of [['Категория','category'],['Подкатегория','subcategory'],['Единица','unit'],['Ед. фасовки','package_unit']]){
      if(clean(item[key])!==clean(next[key]))changes.push([label,clean(item[key])||'—',clean(next[key])||'—']);
    }
    return changes.length?{item,next,changes}:null;
  }
  function scan(){const xs=read(KEYS.items,[]);return (Array.isArray(xs)?xs:[]).map(differences).filter(Boolean)}
  function payload(item){return Object.fromEntries(ITEM_FIELDS.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]))}
  function queueUpsert(queue,item){
    const t={id:`item:${item.id}`,kind:'item_upsert',item_id:item.id,item_name:item.name,item:payload(item),status:'pending',error:null,created_at:now()};
    const old=queue.find(x=>x.kind==='item_upsert'&&x.item_id===item.id); old?Object.assign(old,t):queue.unshift(t);
  }

  // Чиним только УЖЕ существующие pending upsert-задачи. Новые задачи до загрузки облака не создаём.
  function sanitizeExistingPending(){
    const q=read(KEYS.queue,[]), items=read(KEYS.items,[]); let touched=false;
    const byId=new Map((Array.isArray(items)?items:[]).map(x=>[x.id,x]));
    for(const task of Array.isArray(q)?q:[]){
      if(task.kind!=='item_upsert'||!task.item)continue;
      const fixed=classify(task.item); Object.assign(task.item,fixed); touched=true;
      const local=byId.get(task.item_id); if(local)Object.assign(local,fixed);
    }
    if(touched){write(KEYS.queue,q);write(KEYS.items,items)}
  }

  function applySuggestions(suggestions){
    const items=read(KEYS.items,[]),q=read(KEYS.queue,[]),byId=new Map(items.map(x=>[x.id,x])); let n=0;
    for(const s of suggestions){const i=byId.get(s.item.id);if(!i)continue;Object.assign(i,s.next,{updated_at:now()});queueUpsert(q,i);n++}
    write(KEYS.items,items);write(KEYS.queue,q);if(n)setTimeout(()=>location.reload(),250);return n;
  }

  function ensureStyles(){if(document.getElementById('classification-styles'))return;const s=document.createElement('style');s.id='classification-styles';s.textContent='.cl-overlay{position:fixed;inset:0;z-index:170000;background:rgba(10,26,22,.45);display:flex;align-items:flex-end;font-family:system-ui}.cl-sheet{width:100%;max-height:88vh;background:#f7f9f8;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;position:relative}.cl-head{padding:18px;background:#fff;display:flex;align-items:center}.cl-head h2{margin:0;flex:1;font-size:21px}.cl-close{border:0;background:#edf2f0;border-radius:12px;width:40px;height:40px;font-size:20px}.cl-list{overflow:auto;padding:10px 14px 110px}.cl-card{background:#fff;border:1px solid #e2e9e6;border-radius:17px;padding:13px;margin:8px 0}.cl-name{font-weight:800}.cl-change{font-size:12px;color:#657a73;margin-top:5px}.cl-change b{color:#0b725d}.cl-foot{position:absolute;bottom:0;left:0;right:0;background:#fff;padding:12px 16px calc(env(safe-area-inset-bottom) + 12px);border-top:1px solid #e1e8e5}.cl-apply{width:100%;border:0;border-radius:15px;padding:14px;background:#0b7a62;color:white;font:800 16px system-ui}.cl-empty{text-align:center;padding:45px;color:#657a73}@media(min-width:720px){.cl-overlay{align-items:center;justify-content:center}.cl-sheet{max-width:680px;border-radius:24px}}';document.head.appendChild(s)}
  function close(){document.getElementById('classification-overlay')?.remove()}
  function open(){
    close();ensureStyles();const ss=scan(),o=document.createElement('div');o.id='classification-overlay';o.className='cl-overlay';o.innerHTML=`<div class="cl-sheet"><div class="cl-head"><h2>🗂 Порядок в базе</h2><button class="cl-close">×</button></div>${ss.length?`<div class="cl-list">${ss.map((s,i)=>`<div class="cl-card"><label><input type="checkbox" checked data-cl="${i}"> <span class="cl-name">${esc(s.item.name)}</span></label>${s.changes.map(c=>`<div class="cl-change">${esc(c[0])}: ${esc(c[1])} → <b>${esc(c[2])}</b></div>`).join('')}</div>`).join('')}</div><div class="cl-foot"><button class="cl-apply">Применить выбранные (${ss.length})</button></div>`:'<div class="cl-empty">Всё чисто 👍<br>Очевидных ошибок не найдено.</div>'}</div>`;document.body.appendChild(o);o.querySelector('.cl-close').onclick=close;o.querySelector('.cl-apply')?.addEventListener('click',()=>{const chosen=ss.filter((_,i)=>o.querySelector(`[data-cl="${i}"]`)?.checked);if(chosen.length&&confirm(`Исправить ${chosen.length} карточек? Остатки не изменятся.`))applySuggestions(chosen)})
  }
  function heading(){return [...document.querySelectorAll('#app h1,#app h2,#app h3,#app h4,#app div,#app span')].find(e=>(e.textContent||'').trim()==='Рабочие действия')}
  function install(){if(document.getElementById('classification-cleanup-button'))return;const h=heading();if(!h?.parentElement)return;const b=document.createElement('button');b.id='classification-cleanup-button';b.type='button';b.innerHTML='<span style="font-size:24px">🗂</span><span><b style="display:block;font-size:18px">Порядок в базе</b><small style="display:block;margin-top:3px;opacity:.7;font-size:13px">Проверить категории и единицы</small></span>';Object.assign(b.style,{width:'100%',margin:'12px 0 16px',border:'0',borderRadius:'22px',padding:'18px 20px',background:'#e8f3ff',color:'#285f91',textAlign:'left',display:'flex',alignItems:'center',gap:'14px',font:'inherit'});b.onclick=open;h.insertAdjacentElement('afterend',b)}

  sanitizeExistingPending();
  function start(){ensureStyles();install();const app=document.getElementById('app');if(app){let t;new MutationObserver(()=>{clearTimeout(t);t=setTimeout(install,80)}).observe(app,{childList:true,subtree:true})}}
  window.KAMBUZ_CLASSIFIER={version:VERSION,classify,scan,open,imoGroup};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();