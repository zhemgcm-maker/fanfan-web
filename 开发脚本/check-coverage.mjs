import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',textContent:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){el.children.push(c);return c},querySelector(){return fakeEl()},scrollIntoView(){}};return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__c={DISHES,RESTAURANTS,restaurantServes,TIERS};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>{});

const { DISHES, RESTAURANTS, restaurantServes } = globalThis.__c;

const bydish = new Map();
console.log('菜品总数 ' + DISHES.length);
if (!RESTAURANTS.length) {
  console.log('离线兜底店库已清空（RESTAURANTS 为空）→ 跳过"每道菜有没有店能做"的检查。');
  console.log('现在店铺完全来自联网检索（高德 / OpenStreetMap），菜品库只负责"推荐吃什么"。');
  DISHES.forEach(d => bydish.set(d.id, []));
} else {
  let orphans = 0;
  DISHES.forEach(d => {
    const shops = RESTAURANTS.filter(r => restaurantServes(r, d));
    bydish.set(d.id, shops);
    if (!shops.length) { orphans++; console.log('❌ 没有店能做：' + d.name + '（' + d.cui + ' / ' + d.tags.join(',') + '）'); }
  });
  console.log('无店可做的菜品 ' + orphans + ' 个');
}

// 各 role 的数量与覆盖
const roles = {};
DISHES.forEach(d => { const r = d.role || 'single'; roles[r] = (roles[r] || 0) + 1; });
console.log('角色分布: ' + Object.entries(roles).map(([k,v]) => k + ':' + v).join('  '));

// 每个 档位 x 类型 组合下，外卖/堂食两种模式是否都有可用菜品
if (RESTAURANTS.length) {
const probe = globalThis.__c;
const combos = [];
for (const tier of ['small','mid','good']) {
  for (const cat of ['rice','noodle','other']) {
    for (const mode of ['delivery','dinein']) {
      const cap = { small:25, mid:60, good:150 }[tier];
      const ok = DISHES.filter(d => d.cat === cat && d.price <= cap + 8)
        .filter(d => bydish.get(d.id).some(r => mode === 'dinein' || r.delivery));
      combos.push(`${tier}/${cat}/${mode}: ${ok.length}`);
      if (!ok.length) console.log('⚠️ 组合为空：' + tier + ' + ' + cat + ' + ' + mode);
    }
  }
}
console.log(combos.join('  |  '));

// 外卖模式下，各档位/类型有多少菜品只有堂食店可做
let onlyDinein = 0;
DISHES.forEach(d => {
  const shops = bydish.get(d.id);
  if (shops.length && !shops.some(r => r.delivery)) onlyDinein++;
});
console.log('仅堂食可做的菜品数量：' + onlyDinein + '（这些在外卖模式下会提示切换到店方案）');
} else {
  console.log('（没有离线店库，档位 × 类型 × 外卖/堂食 的覆盖检查跳过）');
}
