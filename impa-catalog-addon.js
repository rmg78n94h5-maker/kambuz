(()=>{
  const VERSION="0.5.0";
  const DATA=window.KAMBUZ_IMPA_DATA||{items:[],sections:{}};
  const KEY_DRAFT="kambuz_impa_draft_v1";
  const KEY_FAV="kambuz_impa_favorites_v1";
  const KEY_VESSEL="kambuz_impa_vessel";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||"null")??f}catch{return f}};
  const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const norm=s=>String(s||"").toLowerCase().replace(/ё/g,"е").replace(/×/g,"x").replace(/[^a-zа-я0-9]+/gi," ").trim();
  const today=()=>new Date().toISOString().slice(0,10);
  const fileDate=()=>today();
  const iconOf=i=>({"Продукты":"🍎","Техника":"⚙","Камбуз":"🍳","Сервировка":"🍽","Уборка":"🧽","Химия":"🧴","Бельё":"🛏","Каюты":"🛋","Одежда":"👕","Расходники":"▦"})[i.category]||"⚓";
  const labelSection=s=>DATA.sections?.[s]||("Section "+s);
  let root=null;
  const PAGE_SIZE=120;
  const state={view:"catalog",query:"",category:"Все",selected:null,catalogScroll:0,limit:PAGE_SIZE};

  function draft(){return read(KEY_DRAFT,[])}
  function favs(){return new Set(read(KEY_FAV,[]))}
  function saveDraft(v){write(KEY_DRAFT,v);render()}
  function saveFavs(set){write(KEY_FAV,[...set]);render()}
  function lineCount(){return draft().length}
  function totalQty(){return draft().reduce((s,x)=>s+Number(x.qty||0),0)}
  function itemSearchBlob(i){return norm([i.code,i.name,i.ru,i.category,i.section,...(i.aliases||[])].join(" "))}
  function filteredItems(){
    const q=norm(state.query);
    const f=favs();
    return DATA.items.filter(i=>{
      if(state.category==="Избранное"&&!f.has(i.code))return false;
      if(state.category!=="Все"&&state.category!=="Избранное"&&i.category!==state.category)return false;
      if(!q)return true;
      const words=q.split(/\s+/).filter(Boolean);
      const blob=itemSearchBlob(i);
      return words.every(w=>blob.includes(w));
    });
  }
  function imageHtml(i,cls="impa-thumb"){
    if(!i.image)return '<div class="'+cls+'"><span>'+esc(iconOf(i))+'</span></div>';
    const fallback=i.image_fallback?(' data-impa-fallback="'+esc(i.image_fallback)+'"'):"";
    const priority=cls==="impa-product-image"?' loading="eager" fetchpriority="high"':' loading="lazy"';
    return '<div class="'+cls+'"><img data-impa-img'+priority+' decoding="async" src="'+esc(i.image)+'"'+fallback+' alt="'+esc(i.name||("IMPA "+i.code))+'"></div>';
  }
  function imageLabel(i){
    if(!i.image_label)return "";
    const isPhoto=i.image_kind==="supplier-photo"||i.image_kind==="representative-photo";
    const kind=i.image_kind==="representative-photo"?"Пример":isPhoto?"Фото":"Иллюстрация";
    return '<div class="impa-image-source '+(isPhoto?"photo":"illustration")+'"><span>'+kind+'</span><b>'+esc(i.image_label)+'</b></div>';
  }
  function thumb(i,cls="impa-thumb"){return imageHtml(i,cls)}
  function bindImages(scope=root){
    $$("[data-impa-img]",scope).forEach(img=>{
      img.onerror=()=>{
        const fallback=img.dataset.impaFallback;
        if(fallback&&img.src!==fallback){img.dataset.impaFallback="";img.src=fallback;return}
        const wrap=img.parentElement;
        if(wrap)wrap.innerHTML='<span>⚓</span>';
      };
    });
  }
  function shell(){
    return `<div class="impa-screen">
      <div class="impa-top">
        <div class="impa-head">
          <button type="button" data-impa-navback aria-label="${state.view==="catalog"?"Закрыть каталог":"Назад в каталог"}">‹</button>
          <div class="impa-head-title"><b>IMPA · Камбуз и быт</b><small>${DATA.items.length} позиций · офлайн-каталог</small></div>
          <button type="button" data-impa-draft aria-label="Заявка">▤</button>
        </div>
        <div class="impa-search">
          <span>⌕</span>
          <input id="impa-search" autocomplete="off" inputmode="search" placeholder="Код IMPA, название или слово" value="${esc(state.query)}">
          <button type="button" data-impa-clear ${state.query?"":"hidden"}>✕</button>
        </div>
        <div class="impa-chips">
          ${["Все","Продукты","Камбуз","Сервировка","Техника","Каюты","Бельё","Уборка","Химия","Одежда","Расходники","Избранное"].map(c=>`<button class="impa-chip ${state.category===c?"active":""}" type="button" data-impa-cat="${esc(c)}">${esc(c)}</button>`).join("")}
        </div>
      </div>
      <div class="impa-body" id="impa-body"></div>
      ${lineCount()?`<div class="impa-draftbar"><div><b>Заявка · ${lineCount()} позиций</b><small>Количество: ${totalQty()}</small></div><button type="button" data-impa-draft>Открыть →</button></div>`:""}
    </div>`;
  }
  function catalogHtml(){
    const all=filteredItems();
    const items=all.slice(0,state.limit);
    const left=Math.max(0,all.length-items.length);
    return `
      <div class="impa-intro"><small>Судовой справочник</small><b>Без PDF-талмуда</b><p>Поиск по IMPA-коду, английскому названию и русским словам. Каталог и черновик заявки работают на телефоне.</p></div>
      <div class="impa-section-head"><div><b>${state.category==="Все"?"Каталог":esc(state.category)}</b><small>${all.length} найдено · показано ${items.length}</small></div><small>IMPA</small></div>
      <div class="impa-grid">
      ${items.length?items.map(i=>`<article class="impa-item" data-impa-item="${esc(i.code)}">
        ${thumb(i)}
        <div class="impa-meta">
          <div class="impa-code">IMPA ${esc(i.code)} <i>${esc(i.uom)}</i></div>
          <b>${esc(i.name)}</b>
          ${i.ru?'<p>'+esc(i.ru)+'</p>':""}
          <small>${esc(i.category)} · ${esc(labelSection(i.section))}</small>
        </div>
        <button class="impa-add" type="button" data-impa-add="${esc(i.code)}" aria-label="Добавить">＋</button>
      </article>`).join(""):'<div class="impa-empty"><b>Ничего не нашёл</b>Попробуй другой код или русское название.</div>'}
      </div>
      ${left?'<button class="impa-secondary impa-load-more" type="button" data-impa-more>Показать ещё · осталось '+left+'</button>':""}`;
  }
  function productHtml(i){
    const f=favs(),inFav=f.has(i.code);
    return `
      <button class="impa-secondary" style="width:auto;padding:0 14px;margin-bottom:10px" type="button" data-impa-back>← Каталог</button>
      <div class="impa-product-media">${i.image?imageHtml(i,"impa-product-image"):'<span>'+esc(iconOf(i))+'</span>'}</div>
      ${imageLabel(i)}
      ${i.visual_note?'<div class="impa-visual-note">'+esc(i.visual_note)+'</div>':""}
      <div class="impa-product-code">IMPA ${esc(i.code)}</div>
      <h2 class="impa-product-title">${esc(i.name)}</h2>
      <p class="impa-product-ru">${esc(i.ru)}</p>
      <div class="impa-pills"><span>${esc(i.category)}</span><span>Section ${esc(i.section)}</span>${i.legacy?'<span>Ранее заказывали</span>':""}</div>
      <div class="impa-info-grid">
        <div><small>Единица</small><b>${esc(i.uom)}</b></div>
        <div><small>Раздел IMPA</small><b>${esc(labelSection(i.section))}</b></div>
      </div>
      <button class="impa-primary" type="button" data-impa-add="${esc(i.code)}">＋ В заявку</button>
      <button class="impa-secondary" style="margin-top:8px" type="button" data-impa-fav="${esc(i.code)}">${inFav?"♥ Убрать из избранного":"♡ В избранное"}</button>
    `;
  }
  function draftHtml(){
    const d=draft();
    const sections=new Set(d.map(x=>x.section)).size;
    return `
      <button class="impa-secondary" style="width:auto;padding:0 14px;margin-bottom:10px" type="button" data-impa-back>← Каталог</button>
      <div class="impa-section-head"><div><b>Черновик заявки</b><small>Можно редактировать до выгрузки</small></div><small>${d.length} поз.</small></div>
      <div class="impa-summary"><div><small>Позиций</small><b>${d.length}</b></div><div><small>Разделов</small><b>${sections}</b></div></div>
      <div class="impa-draft-list">
      ${d.length?d.map((x,n)=>`<div class="impa-draft-row">
        ${thumb(x,"impa-thumb")}
        <div><b>${n+1}. IMPA ${esc(x.code)} · ${esc(x.ru||x.name)}</b><small>${esc(x.name)} · ${esc(x.qty)} ${esc(x.uom)}${x.comment?' · '+esc(x.comment):""}</small></div>
        <div class="impa-row-actions"><button type="button" data-impa-edit="${esc(x.code)}">✎</button><button class="danger" type="button" data-impa-remove="${esc(x.code)}">⌫</button></div>
      </div>`).join(""):'<div class="impa-empty"><b>Заявка пустая</b>Добавь позиции из каталога кнопкой «＋».</div>'}
      </div>
      ${d.length?'<button class="impa-primary" type="button" data-impa-export>Сформировать файл</button><button class="impa-secondary" style="margin-top:8px" type="button" data-impa-clear-draft>Очистить черновик</button>':""}
    `;
  }
  function rememberCatalogScroll(){
    const body=$("#impa-body",root);
    if(state.view==="catalog"&&body)state.catalogScroll=body.scrollTop||0;
  }
  function goCatalog({restore=true}={}){
    state.view="catalog";state.selected=null;render();
    if(restore)requestAnimationFrame(()=>{const body=$("#impa-body",root);if(body)body.scrollTop=state.catalogScroll||0});
  }
  function headerBack(){
    if(state.view==="catalog"){close();return}
    goCatalog();
  }
  function render(){
    if(!root)return;
    root.innerHTML=shell();
    const body=$("#impa-body",root);
    body.innerHTML=state.view==="draft"?draftHtml():state.view==="product"&&state.selected?productHtml(state.selected):catalogHtml();
    bind();
  }
  function bind(){
    const search=$("#impa-search",root);
    if(search)search.oninput=e=>{state.query=e.target.value;state.catalogScroll=0;state.limit=PAGE_SIZE;const b=$("[data-impa-clear]",root);if(b)b.hidden=!state.query;state.view="catalog";$("#impa-body",root).innerHTML=catalogHtml();bindBody()};
    $$("[data-impa-navback]",root).forEach(b=>b.onclick=headerBack);
    $$("[data-impa-draft]",root).forEach(b=>b.onclick=()=>{rememberCatalogScroll();state.view="draft";state.selected=null;render()});
    $("[data-impa-cat]",root).forEach(b=>b.onclick=()=>{state.category=b.dataset.impaCat;state.catalogScroll=0;state.limit=PAGE_SIZE;state.view="catalog";state.selected=null;render()});
    const clear=$("[data-impa-clear]",root);if(clear)clear.onclick=()=>{state.query="";state.catalogScroll=0;state.limit=PAGE_SIZE;state.view="catalog";render();setTimeout(()=>$("#impa-search",root)?.focus(),0)};
    bindBody();
  }
  function bindBody(){
    $$("[data-impa-item]",root).forEach(el=>el.onclick=e=>{if(e.target.closest("[data-impa-add]"))return;const i=DATA.items.find(x=>x.code===el.dataset.impaItem);if(i){rememberCatalogScroll();state.selected=i;state.view="product";render()}});
    $$("[data-impa-add]",root).forEach(b=>b.onclick=e=>{e.stopPropagation();const i=DATA.items.find(x=>x.code===b.dataset.impaAdd);if(i)editLine(i)});
    $$("[data-impa-back]",root).forEach(b=>b.onclick=()=>goCatalog());
    $$("[data-impa-fav]",root).forEach(b=>b.onclick=()=>{const f=favs(),code=b.dataset.impaFav;f.has(code)?f.delete(code):f.add(code);saveFavs(f)});
    $$("[data-impa-edit]",root).forEach(b=>b.onclick=()=>{const line=draft().find(x=>x.code===b.dataset.impaEdit),i=DATA.items.find(x=>x.code===b.dataset.impaEdit)||line;if(i)editLine(i,line)});
    $$("[data-impa-remove]",root).forEach(b=>b.onclick=()=>saveDraft(draft().filter(x=>x.code!==b.dataset.impaRemove)));
    $$("[data-impa-clear-draft]",root).forEach(b=>b.onclick=()=>{if(confirm("Очистить весь черновик заявки?"))saveDraft([])});
    $("[data-impa-export]",root).forEach(b=>b.onclick=exportSheet);
    const more=$("[data-impa-more]",root);
    if(more)more.onclick=()=>{
      const body=$("#impa-body",root),y=body?.scrollTop||0;
      state.limit+=PAGE_SIZE;
      if(body){body.innerHTML=catalogHtml();bindBody();requestAnimationFrame(()=>{body.scrollTop=y})}
    };
    bindImages(root);
  }
  function editLine(i,existing=null){
    const old=existing||draft().find(x=>x.code===i.code);
    const back=document.createElement("div");back.className="impa-sheetback";
    back.innerHTML=`<div class="impa-sheet">
      <div class="impa-sheet-handle"></div>
      <h3>${esc(i.ru||i.name)}</h3><p>IMPA ${esc(i.code)} · ${esc(i.name)}</p>
      <div class="impa-field"><label>Количество</label><div class="impa-qty"><button type="button" data-qminus>−</button><input id="impa-qty" type="number" inputmode="decimal" min="0.001" step="1" value="${esc(old?.qty||1)}"><button type="button" data-qplus>＋</button><select id="impa-uom"><option>${esc(old?.uom||i.uom)}</option></select></div></div>
      <div class="impa-field"><label>Комментарий для поставщика (English)</label><textarea id="impa-comment" maxlength="300" placeholder="Например: Prefer 5–7 L if available">${esc(old?.comment||"")}</textarea></div>
      <button class="impa-primary" type="button" data-save-line>${old?"Сохранить":"Добавить в заявку"}</button>
      <button class="impa-secondary" style="margin-top:8px" type="button" data-sheet-close>Отмена</button>
    </div>`;
    document.body.appendChild(back);
    const q=$("#impa-qty",back);
    $("[data-qminus]",back).onclick=()=>q.value=String(Math.max(1,Number(q.value||1)-1));
    $("[data-qplus]",back).onclick=()=>q.value=String(Number(q.value||0)+1);
    const closeSheet=()=>back.remove();
    $("[data-sheet-close]",back).onclick=closeSheet;
    back.onclick=e=>{if(e.target===back)closeSheet()};
    $("[data-save-line]",back).onclick=()=>{
      const qty=Number(q.value||0);if(!(qty>0)){q.focus();return}
      const d=draft().filter(x=>x.code!==i.code);
      d.push({...i,qty,uom:$("#impa-uom",back).value||i.uom,comment:$("#impa-comment",back).value.trim()});
      write(KEY_DRAFT,d);closeSheet();render();
    };
  }
  function exportSheet(){
    const d=draft();if(!d.length)return;
    const back=document.createElement("div");back.className="impa-sheetback";
    const user=localStorage.getItem("kambuz_user")||"";
    const vessel=localStorage.getItem(KEY_VESSEL)||"";
    back.innerHTML=`<div class="impa-sheet">
      <div class="impa-sheet-handle"></div>
      <h3>Формирование файла</h3><p>${d.length} позиций · таблица для снабжения</p>
      <div class="impa-field"><label>Судно</label><input id="impa-vessel" value="${esc(vessel)}" placeholder="Название судна"></div>
      <div class="impa-field"><label>Отдел</label><input id="impa-dept" value="Galley / Accommodation"></div>
      <div class="impa-field"><label>Дата</label><input id="impa-date" type="date" value="${today()}"></div>
      <div class="impa-field"><label>Запросил</label><input id="impa-requested" value="${esc(user)}"></div>
      <div class="impa-note">Файл содержит: № · IMPA No. · Part Name · Unit · Qty · Comments. Названия IMPA и комментарии для поставщика остаются на английском.</div>
      <div class="impa-export-options">
        <button type="button" data-format="xlsx"><span>▦</span>XLSX</button>
        <button type="button" data-format="pdf"><span>▧</span>PDF</button>
        <button type="button" data-format="doc"><span>▤</span>DOC</button>
      </div>
      <button class="impa-secondary" style="margin-top:10px" type="button" data-sheet-close>Отмена</button>
    </div>`;
    document.body.appendChild(back);
    const closeSheet=()=>back.remove();
    $("[data-sheet-close]",back).onclick=closeSheet;
    back.onclick=e=>{if(e.target===back)closeSheet()};
    $$("[data-format]",back).forEach(b=>b.onclick=async()=>{
      const meta={
        vessel:$("#impa-vessel",back).value.trim(),
        dept:$("#impa-dept",back).value.trim()||"Galley / Accommodation",
        date:$("#impa-date",back).value||today(),
        requested:$("#impa-requested",back).value.trim()
      };
      localStorage.setItem(KEY_VESSEL,meta.vessel);
      b.disabled=true;
      const old=b.innerHTML;b.innerHTML="<span>…</span>Готовлю";
      try{
        if(b.dataset.format==="xlsx")await exportXlsx(meta,d);
        else if(b.dataset.format==="pdf")await exportPdf(meta,d);
        else exportDoc(meta,d);
      }finally{b.disabled=false;b.innerHTML=old}
    });
  }
  function tableRows(d){return d.map((x,n)=>[n+1,x.code,x.name,x.uom,Number(x.qty||0),x.comment||""])}
  function filename(ext){return "IMPA_Requisition_Galley_"+fileDate()+"."+ext}
  function trigger(blob,name){
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200);
  }
  function exportDoc(meta,d){
    const rows=tableRows(d).map(r=>"<tr>"+r.map(v=>"<td>"+esc(v)+"</td>").join("")+"</tr>").join("");
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#162f43;padding:24px}h1{font-size:20px;margin:0 0 8px}.meta{font-size:11px;margin-bottom:14px}.meta div{margin:3px 0}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #9eacb6;padding:6px;text-align:left;vertical-align:top}th{background:#eaf1f4}</style></head><body><h1>GALLEY / ACCOMMODATION REQUISITION</h1><div class="meta"><div><b>Vessel:</b> ${esc(meta.vessel||"")}</div><div><b>Date:</b> ${esc(meta.date)}</div><div><b>Department:</b> ${esc(meta.dept)}</div><div><b>Requested by:</b> ${esc(meta.requested)}</div></div><table><thead><tr><th>No.</th><th>IMPA No.</th><th>Part Name</th><th>Unit</th><th>Qty</th><th>Comments</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    trigger(new Blob(["\ufeff",html],{type:"application/msword;charset=utf-8"}),filename("doc"));
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const old=[...document.scripts].find(s=>s.src===src);if(old){if(old.dataset.ready==="1")return resolve();old.addEventListener("load",resolve,{once:true});old.addEventListener("error",reject,{once:true});return}
      const s=document.createElement("script");s.src=src;s.async=true;s.onload=()=>{s.dataset.ready="1";resolve()};s.onerror=reject;document.head.appendChild(s);
    });
  }
  async function exportXlsx(meta,d){
    try{
      if(!window.XLSX)await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
      if(!window.XLSX)throw new Error("XLSX unavailable");
      const aoa=[
        ["GALLEY / ACCOMMODATION REQUISITION"],
        ["Vessel",meta.vessel],["Date",meta.date],["Department",meta.dept],["Requested by",meta.requested],[],
        ["No.","IMPA No.","Part Name","Unit","Qty","Comments"],
        ...tableRows(d)
      ];
      const ws=window.XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"]=[{wch:6},{wch:12},{wch:48},{wch:10},{wch:8},{wch:55}];
      const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,"Requisition");
      window.XLSX.writeFile(wb,filename("xlsx"));
    }catch(e){console.error(e);alert("Не удалось загрузить модуль XLSX. Попробуй при наличии интернета.")}
  }
  async function ensurePdf(){
    try{
      if(!window.pdfMake)await loadScript("https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/pdfmake.min.js");
      if(!window.pdfMake?.vfs)await loadScript("https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/vfs_fonts.js");
      return Boolean(window.pdfMake?.createPdf);
    }catch(e){console.error(e);return false}
  }
  async function exportPdf(meta,d){
    if(!(await ensurePdf())){alert("Не удалось загрузить PDF-модуль.");return}
    const body=[
      [{text:"No.",bold:true},{text:"IMPA No.",bold:true},{text:"Part Name",bold:true},{text:"Unit",bold:true},{text:"Qty",bold:true},{text:"Comments",bold:true}],
      ...tableRows(d).map(r=>r.map(v=>String(v)))
    ];
    const doc={
      pageSize:"A4",pageOrientation:"landscape",pageMargins:[28,28,28,28],
      content:[
        {text:"GALLEY / ACCOMMODATION REQUISITION",fontSize:17,bold:true,color:"#10243a"},
        {columns:[
          [{text:"Vessel: "+(meta.vessel||""),fontSize:9},{text:"Department: "+meta.dept,fontSize:9}],
          [{text:"Date: "+meta.date,fontSize:9,alignment:"right"},{text:"Requested by: "+meta.requested,fontSize:9,alignment:"right"}]
        ],margin:[0,6,0,12]},
        {table:{headerRows:1,widths:[24,55,"*",44,36,"*"],body},layout:"lightHorizontalLines"}
      ],
      defaultStyle:{font:"Roboto",fontSize:8}
    };
    window.pdfMake.createPdf(doc).download(filename("pdf"));
  }
  function open(){
    if(root)return;
    root=document.createElement("div");root.className="impa-overlay";document.body.appendChild(root);
    state.view="catalog";state.selected=null;state.catalogScroll=0;state.limit=PAGE_SIZE;render();
  }
  function close(){root?.remove();root=null}
  window.KAMBUZ_IMPA={version:VERSION,open,close,getDraft:draft};
})();