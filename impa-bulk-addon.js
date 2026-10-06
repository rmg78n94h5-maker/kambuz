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

  const existing=new Map(DATA.items.map(x=>[String(x.code),x]));
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
  function aliasesFor(name){
    const n=" "+String(name||"").toUpperCase()+" ";
    const out=[];
    for(const [key,vals] of phraseAliases)if(n.includes(key))out.push(...vals);
    return [...new Set(out)];
  }
  function imageFor(code){
    return "https://www.shipserv.com/Shipserv/pages/profiles/231092/images/"+code+".JPG";
  }

  let added=0;
  for(const row of BULK){
    if(!Array.isArray(row)||row.length<4)continue;
    const [code,name,uom,category]=row;
    const c=String(code);
    const old=existing.get(c);
    if(old){
      if(!old.uom&&uom)old.uom=uom;
      const extra=aliasesFor(name);
      old.aliases=[...new Set([...(old.aliases||[]),...extra])];
      continue;
    }
    const aliases=aliasesFor(name);
    const item={
      code:c,
      name:String(name||"").trim(),
      ru:aliases[0]||"",
      uom:String(uom||"PCS"),
      section:c.slice(0,2),
      category:String(category||"Камбуз"),
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
  DATA.scope=[...new Set([...(DATA.scope||[]),...(META.sections||[])])].sort();
  DATA.version="0.5.0";
  DATA.image_version="0.5.0";
  DATA.bulk_meta=Object.assign({},META,{added,total:DATA.items.length});
})();