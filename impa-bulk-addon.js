(()=>{
  const DATA=window.KAMBUZ_IMPA_DATA;
  const BULK=window.KAMBUZ_IMPA_BULK||[];
  const META=window.KAMBUZ_IMPA_BULK_META||{};
  if(!DATA||!Array.isArray(DATA.items)||!BULK.length)return;

  DATA.sections=Object.assign({
    "00":"Provisions",
    "11":"Welfare Items",
    "15":"Cloth & Linen Products",
    "17":"Tableware & Galley Utensils",
    "19":"Clothing",
    "51":"Brushes & Mats",
    "53":"Lavatory Equipment",
    "55":"Cleaning Material & Chemicals"
  },DATA.sections||{});

  let existing=null;
  const phraseAliases=[
    ["SPONGE",["губка","губки","губчатая"]],
    ["SCOUR",["губка","абразивная губка","пад","абразив"]],
    ["SCRUB",["губка","щетка","скраббер","абразив"]],
    ["CLEANING PAD",["губка","пад","абразивная губка"]],
    ["CLOTH",["салфетка","тряпка","ткань"]],
    ["BRUSH",["щетка","щётка"]],
    ["MOP",["моп","швабра"]],
    ["SQUEEGEE",["сквидж","стеклоочиститель"]],
    ["TOWEL",["полотенце"]],
    ["GLOVE",["перчатки"]],
    ["SOAP",["мыло"]],
    ["DETERGENT",["моющее средство","детергент"]],
    ["CLEANER",["очиститель","чистящее средство"]],
    ["DISHWASH",["посудомойка","посудомоечная"]],
    ["PLATE",["тарелка"]],
    ["BOWL",["миска","чаша"]],
    ["MUG",["кружка"]],
    ["CUP",["чашка","стакан"]],
    ["FORK",["вилка"]],
    ["SPOON",["ложка"]],
    ["KNIFE",["нож"]],
    ["PAN ",["сковорода","противень"]],
    ["POT ",["кастрюля"]],
    ["KETTLE",["чайник"]],
    ["THERMO POT",["термопот"]],
    ["MICROWAVE",["микроволновка","свч"]],
    ["TOASTER",["тостер"]],
    ["BLENDER",["блендер"]],
    ["MIXER",["миксер"]],
    ["FRYER",["фритюрница"]],
    ["FAN ",["вентилятор"]],
    ["VACUUM",["пылесос"]],
    ["WASHING MACHINE",["стиральная машина"]],
    ["PILLOW",["подушка"]],
    ["PILLOW CASE",["наволочка"]],
    ["SHEET",["простыня"]],
    ["MATTRESS",["матрас"]],
    ["BLANKET",["одеяло"]],
    ["APRON",["фартук"]],
    ["COAT ",["китель","куртка"]],
    ["TROUSERS",["брюки"]],
    ["SHIRT",["рубашка"]],
    ["APPLE",["яблоко"]],
    ["BANANA",["банан"]],
    ["ORANGE",["апельсин"]],
    ["LEMON",["лимон"]],
    ["POTATO",["картофель","картошка"]],
    ["TOMATO",["помидор","томат"]],
    ["ONION",["лук"]],
    ["GARLIC",["чеснок"]],
    ["CARROT",["морковь"]],
    ["CABBAGE",["капуста"]],
    ["CUCUMBER",["огурец"]],
    ["BEEF",["говядина"]],
    ["PORK",["свинина"]],
    ["CHICKEN",["курица"]],
    ["LAMB",["баранина"]],
    ["FISH",["рыба"]],
    ["SALMON",["лосось"]],
    ["TUNA",["тунец"]],
    ["SHRIMP",["креветка","креветки"]],
    ["PRAWN",["креветка","креветки"]],
    ["MILK",["молоко"]],
    ["CHEESE",["сыр"]],
    ["BUTTER",["масло"]],
    ["BREAD",["хлеб"]],
    ["RICE",["рис"]],
    ["FLOUR",["мука"]],
    ["SUGAR",["сахар"]],
    ["SALT",["соль"]],
    ["COFFEE",["кофе"]],
    ["TEA ",["чай"]],
    ["JUICE",["сок"]],
    ["EGG",["яйцо","яйца"]]
  ];
  function aliasesFor(name,category){
    const n=" "+String(name||"").toUpperCase()+" ";
    const out=[];
    for(const [key,vals] of phraseAliases){
      const cleaningWord=["SPONGE","SCOUR","SCRUB","CLEANING PAD"].includes(key);
      if(cleaningWord&&category!=="Уборка")continue;
      if(key==="SCRUB"&&!n.includes("SPONGE")&&!n.includes("PAD"))continue;
      if(n.includes(key))out.push(...vals);
    }
    return [...new Set(out)];
  }
  function imageFor(code){
    return "https://www.shipserv.com/Shipserv/pages/profiles/231092/images/"+code+".JPG";
  }

  const allowed15=new Set(["1501","1502","1503","1505","1506"]);
  const allowed51=new Set(["5106","5108","5110","5111"]);
  const allowed55=new Set(["5501","5502","5503","5505","5506","5515"]);
  const denied17=new Set(["1713","1743"]);

  function keepBulkItem(code){
    const c=String(code||"");
    const sec=c.slice(0,2),sub=c.slice(0,4);
    if(sec==="15")return allowed15.has(sub);
    if(sec==="17")return !denied17.has(sub);
    if(sec==="51")return allowed51.has(sub);
    if(sec==="53")return true;
    if(sec==="55")return allowed55.has(sub);
    return false;
  }

  function categoryFor(code,fallback){
    const c=String(code||"");
    const sec=c.slice(0,2),sub=c.slice(0,4);
    if(sec==="15")return "Бельё";
    if(sec==="51")return "Уборка";
    if(sec==="53")return "Санузлы";
    if(sec==="55")return "Химия";
    if(sec==="17"){
      if(["1745","1746","1747","1750","1751","1755"].includes(sub))return "Оборудование";
      if(sub==="1741")return "Уборка";
      if(["1715","1742"].includes(sub))return "Расходники";
      if(["1701","1702","1703","1704","1706","1707","1708","1709","1710","1711","1712","1714","1731","1734","1736","1737"].includes(sub))return "Посуда";
      return "Кухня";
    }
    return fallback||"Кухня";
  }

  // Apply the same scope to the older seed catalogue, otherwise old section 11,
  // paint tools and technical chemicals leak back into the visible list.
  const legacyKeep=new Set(["190136","391946"]);
  DATA.items=DATA.items.filter(item=>keepBulkItem(item.code)||legacyKeep.has(String(item.code)));
  for(const item of DATA.items){
    item.category=categoryFor(item.code,item.category);
    // Older hand-picked cards sometimes use third-party representative photos.
    // Keep those photos, but always provide the exact IMPA/ShipServ illustration
    // as a local catalogue fallback so a dead hotlink never leaves a broken image.
    if(item.image && item.image_source!=="ShipServ / IMPA" && !item.image_fallback){
      item.image_fallback=imageFor(item.code);
    }
  }
  existing=new Map(DATA.items.map(x=>[String(x.code),x]));

  let added=0,bulkVisible=0;
  for(const row of BULK){
    if(!Array.isArray(row)||row.length<4)continue;
    const [code,name,uom,category]=row;
    const c=String(code);
    if(!keepBulkItem(c))continue;
    bulkVisible++;
    const normalizedCategory=categoryFor(c,category);
    const old=existing.get(c);
    if(old){
      if(!old.uom&&uom)old.uom=uom;
      const extra=aliasesFor(name,normalizedCategory);
      old.aliases=[...new Set([...(old.aliases||[]),...extra])];
      old.category=categoryFor(c,old.category);
      continue;
    }
    const aliases=aliasesFor(name,normalizedCategory);
    const item={
      code:c,
      name:String(name||"").trim(),
      ru:aliases[0]||"",
      uom:String(uom||"PCS"),
      section:c.slice(0,2),
      category:normalizedCategory,
      aliases,
      image:imageFor(c),
      image_kind:"impa-illustration",
      image_label:"Иллюстрация по IMPA-коду "+c,
      image_source:"ShipServ / IMPA",
      image_source_url:"https://impa-catalogue.shipserv.com/"
    };
    DATA.items.push(item);
    existing.set(c,item);
    added++;
  }
  DATA.items.sort((a,b)=>String(a.code).localeCompare(String(b.code)));
  DATA.scope=["15","17","51","53","55"];
  DATA.version="0.6.2";
  DATA.image_version="0.6.2";
  DATA.bulk_meta=Object.assign({},META,{
    added,
    source_count:BULK.length,
    bulk_visible:bulkVisible,
    bulk_removed:BULK.length-bulkVisible,
    total:DATA.items.length,
    policy:"galley-accommodation-curated"
  });
})();