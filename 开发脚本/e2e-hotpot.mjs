// 真实联网端到端：用页面自己的 onlineSearch() 在保定搜「火锅」，看现在能拿到多少家店
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)},toggle(c,f){const on=f===undefined?!this._s.has(c):!!f;on?this._s.add(c):this._s.delete(c);return on}},setAttribute(){},addEventListener(){},appendChild(c){el.children.push(c);return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v);el.innerHTML=t}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__o={state,onlineSearch,recommend,pickAnchors,recommendRestaurantsSmart,planMeal,DISHES,DEFAULT_AMAP_KEY,resolveLocation,CITY,amapSearchByKeyword,state2:state};')
  (document, localStorage, (f)=>setTimeout(f,0), globalThis.fetch.bind(globalThis));

const api = globalThis.__o;

const addr = process.argv[3] || '保定市裕华路步行街';
Object.assign(api.state, {
  tier:'mid', cat:'other', budget:80, craveTags:['火锅'], craveText:'',
  address: addr, mode:'dinein', spiceMax:3, seed:1
});
api.state.profile.allergies = []; api.state.profile.tastes = []; api.state.profile.likes = {}; api.state.profile.history = [];
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY || '';
api.state.settings.online = 'on';

console.log('城市: ' + api.CITY.name + '   地址: ' + addr);
const rec = api.recommend();
const anchors = api.pickAnchors(rec);
console.log('参与搜店的主菜: ' + anchors.map(a => a.dish.name).join('、'));

const online = await api.onlineSearch(anchors.map(a => a.dish));
console.log('\n数据源: ' + online.source + '   周边餐饮总数: ' + online.around.length + (online.error ? '   错误: ' + online.error : ''));
let totalShops = 0, uniq = new Set();
Object.keys(online.byDish).forEach(id => {
  const dish = api.DISHES.find(d => d.id === id);
  const shops = online.byDish[id] || [];
  totalShops += shops.length;
  shops.forEach(s => uniq.add(s.id));
  console.log('\n【' + (dish ? dish.name : id) + '】搜到 ' + shops.length + ' 家店：');
  shops.slice(0, 8).forEach((s, i) => console.log('   ' + (i + 1) + '. ' + s.name + '  ' + s.km + 'km  ' + s.area + '  人均¥' + s.avg + '  ' + (s.rating || '-')));
  if (shops.length > 8) console.log('   … 还有 ' + (shops.length - 8) + ' 家');
});
console.log('\n合计 ' + totalShops + ' 个「菜×店」候选，去重后 ' + uniq.size + ' 家不同店铺');

// 再走一遍完整组合流程，看看主推几家里的差异
const meal = api.planMeal(rec, online);
console.log('\n主推：' + (meal.best ? meal.best.restaurant.name + ' —— ' + meal.best.items.map(i => i.dish.name).join('＋') : '（没配出来）'));
console.log('备选 ' + Math.max(0, meal.list.length - 1) + ' 家：' + meal.list.slice(1, 5).map(c => c.restaurant.name).join('、'));
