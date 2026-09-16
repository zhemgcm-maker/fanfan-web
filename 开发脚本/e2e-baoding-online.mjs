// 真实联网端到端：用页面自己的 onlineSearch() 走一遍保定，验证 OSM 免 key 通道 + CORS
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)}},setAttribute(){},addEventListener(){},appendChild(c){el.children.push(c);return c},querySelector(){return fakeEl()},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v);el.innerHTML=t}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__o={state,onlineSearch,recommend,recommendRestaurantsSmart,recommendRestaurants,sourceLabel,CITY,resolveLocation,osmAround,DISHES};')
  (document, localStorage, (f)=>setTimeout(f,0), globalThis.fetch.bind(globalThis));

const api = globalThis.__o;

// 场景：保定市裕华路，想吃本地特色，无高德 key（走 OSM 兜底）
Object.assign(api.state, {
  tier:'mid', cat:'other', budget:60, craveTags:['想吃肉'], craveText:'想吃保定本地的',
  address:'保定市裕华路步行街', mode:'delivery', spiceMax:3, seed:1
});
api.state.profile.allergies = [];
api.state.profile.tastes = [];
api.state.profile.likes = {};
api.state.profile.history = [];
api.state.settings.amapKey = '';
api.state.settings.online = 'on';

console.log('城市配置: ' + JSON.stringify(api.CITY));
const origin = await api.resolveLocation('保定市裕华路步行街');
console.log('地址解析: ' + JSON.stringify(origin));

console.log('\n=== 免 key 通道：CORS 检查 ===');
try {
  const res = await fetch('https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=' + encodeURIComponent('[out:json][timeout:5];node["amenity"="restaurant"](around:500,38.874,115.4646);out 1;'),
    { headers: { Origin: 'null', 'User-Agent': 'MealAgentDemo/1.0' } });
  console.log('maps.mail.ru CORS: ' + (res.headers.get('access-control-allow-origin') || '（无头，浏览器会被拦）') + ' · HTTP ' + res.status);
} catch (e) { console.log('CORS 探测失败: ' + (e.cause?.message || e.message)); }

const rec = api.recommend();
const top3 = rec.scored.slice(0,3);
console.log('\n本地打分前 3 名: ' + top3.map(s=>s.dish.name+'('+s.total+')').join('、'));

const t0 = Date.now();
const online = await api.onlineSearch(top3.map(s=>s.dish));
console.log('\n=== 联网搜索（真实调用）===');
console.log('数据源: ' + api.sourceLabel(online.source) + ' · 耗时 ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
console.log('周边餐饮数: ' + online.around.length);
if (online.error) console.log('错误信息: ' + online.error);
console.log('周边真实店铺示例: ' + online.around.slice(0,10).map(s=>s.name+'('+s.km+'km)').join('、'));

for (const s of top3) {
  const shops = online.byDish[s.dish.id] || [];
  const r = api.recommendRestaurantsSmart(s.dish, online);
  const first = r.list[0];
  console.log('\n· ' + s.dish.name + ' → 来源 ' + api.sourceLabel(r.source) + ' · 候选 ' + r.list.length + ' 家');
  if (shops.length) console.log('   联网命中: ' + shops.slice(0,4).map(x=>x.name).join('、'));
  if (first) console.log('   选出: ' + first.restaurant.name + ' · ' + first.km + 'km · ' + first.total + '分' + (first.restaurant.rating ? ' · ' + first.restaurant.rating + '分' : ''));
}
