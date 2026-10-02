(() => {
  'use strict';

  const marker = 'kambuz_preview_seeded_v1';
  if (localStorage.getItem(marker)) return;

  const now = Date.now();
  const iso = hoursAgo => new Date(now - hoursAgo * 3600000).toISOString();

  const items = [
    {id:'demo-rice',name:'Рис длиннозёрный',brand:'Makfa',barcode:'4607001770011',category:'Продукты',subcategory:'Рис',volume:900,package_unit:'г',unit:'шт.',qty:18,min_qty:6,location:'Сухой склад · стеллаж 2',notes:'Тестовые данные',updated_at:iso(2)},
    {id:'demo-milk',name:'Молоко 3,2%',brand:'Parmalat',barcode:'8002580020301',category:'Продукты',subcategory:'Молоко',volume:1,package_unit:'л',unit:'шт.',qty:7,min_qty:8,location:'Холодильная камера 1',notes:'Тестовые данные',updated_at:iso(4)},
    {id:'demo-tomato',name:'Томаты очищенные',brand:'Mutti',barcode:'8005110043108',category:'Продукты',subcategory:'Овощные консервы',volume:400,package_unit:'г',unit:'шт.',qty:3,min_qty:5,location:'Сухой склад · стеллаж 4',notes:'Тестовые данные',updated_at:iso(6)},
    {id:'demo-oil',name:'Масло подсолнечное',brand:'Золотая семечка',barcode:'4602441001015',category:'Продукты',subcategory:'Масла',volume:1,package_unit:'л',unit:'бут.',qty:12,min_qty:4,location:'Сухой склад · стеллаж 3',notes:'Тестовые данные',updated_at:iso(8)},
    {id:'demo-coffee',name:'Кофе зерновой',brand:'Lavazza',barcode:'8000070012011',category:'Продукты',subcategory:'Кофе',volume:1,package_unit:'кг',unit:'пачка',qty:5,min_qty:2,location:'Сухой склад · шкаф 1',notes:'Тестовые данные',updated_at:iso(10)},
    {id:'demo-cleaner',name:'Средство для мытья посуды',brand:'Fairy',barcode:'8001090574748',category:'Химия',subcategory:'Моющие средства',volume:900,package_unit:'мл',unit:'бут.',qty:9,min_qty:3,location:'Хозкладовая',notes:'Тестовые данные',updated_at:iso(12)},
    {id:'demo-eggs',name:'Яйца С1',brand:'Фермерские',barcode:'4600000000019',category:'Продукты',subcategory:'Яйца',volume:10,package_unit:'шт.',unit:'упак.',qty:4,min_qty:4,location:'Холодильная камера 1',notes:'Тестовые данные',updated_at:iso(14)},
    {id:'demo-flour',name:'Мука пшеничная',brand:'Макфа',barcode:'4607001770035',category:'Продукты',subcategory:'Мука',volume:2,package_unit:'кг',unit:'пачка',qty:11,min_qty:4,location:'Сухой склад · стеллаж 2',notes:'Тестовые данные',updated_at:iso(16)}
  ];

  const ops = [
    {id:'demo-op-1',item_id:'demo-milk',item_name:'Parmalat Молоко 3,2%',type:'consumption',quantity:2,reason:null,comment:'На завтрак',user_name:'Тест',unit:'шт.',previous_qty:9,new_qty:7,target_qty:null,created_at:iso(1),pending:false},
    {id:'demo-op-2',item_id:'demo-rice',item_name:'Makfa Рис длиннозёрный',type:'receipt',quantity:10,reason:null,comment:'Поставка',user_name:'Тест',unit:'шт.',previous_qty:8,new_qty:18,target_qty:null,created_at:iso(5),pending:false},
    {id:'demo-op-3',item_id:'demo-tomato',item_name:'Mutti Томаты очищенные',type:'consumption',quantity:2,reason:null,comment:'Соус',user_name:'Тест',unit:'шт.',previous_qty:5,new_qty:3,target_qty:null,created_at:iso(9),pending:false},
    {id:'demo-op-4',item_id:'demo-oil',item_name:'Золотая семечка Масло подсолнечное',type:'writeoff',quantity:1,reason:'Повреждение',comment:'Тестовая операция',user_name:'Тест',unit:'бут.',previous_qty:13,new_qty:12,target_qty:null,created_at:iso(20),pending:false}
  ];

  localStorage.setItem('kambuz_items', JSON.stringify(items));
  localStorage.setItem('kambuz_ops', JSON.stringify(ops));
  localStorage.setItem('kambuz_pending_ops', '[]');
  localStorage.setItem('kambuz_user', 'Тест');
  localStorage.setItem(marker, '1');
})();
