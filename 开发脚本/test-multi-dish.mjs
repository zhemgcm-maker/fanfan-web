// 固定测试用例：点「汤面」应该给出"一档里的多道同类菜 + 各自的店"，而不是一道菜一家店
import fs from 'node:fs';

/* 把"现在几点"钉死在中午 12:30。
 * 页面打分里有「时段契合」这一维度，不同钟点会挑出不同的菜，
 * 进而影响下面"用到了几家不同的店"这个断言 —— 9 点跑能过、15 点跑就挂，
 * 属于测试本身的不确定性，不是页面问题，所以在测试里固定一个中午时间。 */
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a){ if(!a.length) super(2026, 8, 17, 12, 30, 0); else super(...a); }
  static now(){ return new RealDate(2026, 8, 17, 12, 30, 0).getTime(); }
};

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(name = 'el'){
  const el = {
    _name:name, value:'', className:'', style:{}, children:[], dataset:{}, _handlers:{},
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
      contains(c){return this._s.has(c)}, toggle(c,f){const on = f===undefined?!this._s.has(c):!!f; on?this._s.add(c):this._s.delete(c); return on} },
    setAttribute(){}, getAttribute(){return null},
    addEventListener(t, fn){ el._handlers[t] = fn; }, removeEventListener(){},
    appendChild(c){ el.children.push(c); return c },
    querySelector(){ return fakeEl() }, querySelectorAll(){ return [] },
    scrollIntoView(){}, focus(){}, onclick:null
  };
  let text = '', html = '';
  Object.defineProperty(el, 'textContent', { get(){return text}, set(v){ text = String(v); html = text.replace(/<[^>]+>/g,''); } });
  Object.defineProperty(el, 'innerHTML', { get(){return html}, set(v){ html = String(v); if(!html) el.children.length = 0; } });
  return el;
}
const cacheEl = new Map();
const document = {
  querySelector(s){ if(!cacheEl.has(s)) cacheEl.set(s, fakeEl(s)); return cacheEl.get(s); },
  querySelectorAll(){ return []; },
  createElement(t){ return fakeEl(t); },
  addEventListener(){}
};
const store = new Map();
const localStorage = { getItem:k => store.has(k) ? store.get(k) : null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };

/* ---- 假高德：任何关键词都返回这批"不同菜系的面馆" ----
 * 坐标必须落在"裕华路步行街"地标附近：resolveLocation 优先用内置地标坐标
 * （115.496239,38.859446），而外卖的搜店半径是 3200 米，超出半径的店会被
 * amapSearchByKeyword 当成"不够近"丢掉。之前这里写的是老坐标，离地标 3.2km，
 * 正好压在半径线上，5 家里有 3 家被丢掉 → 断言「≥3 家不同的店」假挂。 */
const LANDMARK = { lng:115.496239, lat:38.859446 };   // 保定 · 裕华路步行街
const POIS = [
  { id:'N1', name:'川味面馆',   type:'餐饮服务;中餐厅;川菜',      location:(LANDMARK.lng + 0.0010) + ',' + (LANDMARK.lat + 0.0006), adname:'莲池区', address:'裕华路1号', biz_ext:{ rating:'4.5', cost:'20' } },
  { id:'N2', name:'兰州牛肉面', type:'餐饮服务;中餐厅;西北菜',    location:(LANDMARK.lng + 0.0016) + ',' + (LANDMARK.lat - 0.0002), adname:'莲池区', address:'裕华路2号', biz_ext:{ rating:'4.4', cost:'22' } },
  { id:'N3', name:'粤式云吞面', type:'餐饮服务;中餐厅;粤菜',      location:(LANDMARK.lng - 0.0010) + ',' + (LANDMARK.lat - 0.0008), adname:'莲池区', address:'裕华路3号', biz_ext:{ rating:'4.3', cost:'26' } },
  { id:'N4', name:'家常面馆',   type:'餐饮服务;中餐厅;家常菜',    location:(LANDMARK.lng - 0.0014) + ',' + (LANDMARK.lat + 0.0008), adname:'莲池区', address:'裕华路4号', biz_ext:{ rating:'4.2', cost:'18' } },
  { id:'N5', name:'过桥米线店', type:'餐饮服务;小吃;米粉',        location:(LANDMARK.lng + 0.0024) + ',' + (LANDMARK.lat + 0.0010), adname:'莲池区', address:'裕华路5号', biz_ext:{ rating:'4.1', cost:'25' } }
];
async function mockFetch(url){
  const u = String(url);
  if(u.includes('restapi.amap.com')){
    if(u.includes('/geocode')) return { ok:true, status:200, json: async () => ({ status:'1', geocodes:[{ location:'115.4646,38.8740', formatted_address:'保定市裕华路' }] }), text: async () => '' };
    return { ok:true, status:200, json: async () => ({ status:'1', count:String(POIS.length), pois:POIS }), text: async () => '' };
  }
  return { ok:false, status:500, json: async () => ({}), text: async () => '' };
}

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__M={state,recommend,pickAnchors,onlineSearch,dishShopOptions,shopsForDish,useDish,run,' +
         'applyCity,DISHES,DEFAULT_AMAP_KEY,restaurantServes,clearAmapCache,diversify,dishCats};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch);
const api = globalThis.__M;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
const settle = (ms = 4200) => new Promise(r => setTimeout(r, ms));

api.applyCity('baoding');
api.state.profile.city = 'baoding';
api.state.settings.enabled = 'off';
api.state.settings.online = 'on';
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY || 'fake';
Object.assign(api.state, { tier:'mid', cat:'noodle', mode:'delivery', spiceMax:3,
  address:'保定市裕华路步行街', budget:60, seed:1, reroll:0 });
api.state.profile.allergies = []; api.state.profile.tastes = [];
api.state.profile.likes = {}; api.state.profile.dislikes = {}; api.state.profile.history = [];
api.state.profile.banned = { dishes:{}, shops:{} };
if(api.clearAmapCache) api.clearAmapCache();

console.log('=== 一、点「汤面」：库里应该找出一批汤面，而不是一道 ===');
api.state.craveTags = ['汤面'];
const rec = api.recommend();
const pool = rec.scored.concat(rec.mains || []);
const noodleSoups = pool.filter(x => ((x.hitTags||[]).length + (x.textHits||[]).length) > 0);
console.log('   命中「汤面」的候选菜（' + noodleSoups.length + ' 道）：' +
  noodleSoups.slice(0, 8).map(x => x.dish.name).join('、') + (noodleSoups.length > 8 ? ' …' : ''));
ok(noodleSoups.length >= 4, '命中标签的汤面类菜有 ' + noodleSoups.length + ' 道（不是只有一道）');
const inNoodle = noodleSoups.filter(x => api.dishCats(x.dish).indexOf('noodle') !== -1);
ok(inNoodle.length === noodleSoups.length, '这 ' + noodleSoups.length + ' 道菜全都属于「吃面」类（含配面吃的整份菜）');

console.log('\n=== 二、锚定菜要多样化（不同菜系/不同主料） ===');
const anchors = api.pickAnchors(rec).map(a => a.dish);
console.log('   挑出来的主角候选：' + anchors.map(d => d.name + '（' + d.cui + '）').join('、'));
ok(new Set(anchors.map(d => d.cui)).size >= 3, '菜系覆盖 ' + new Set(anchors.map(d => d.cui)).size + ' 种（避免全是同一类）');

console.log('\n=== 三、每道菜各自配一家能做它的店 ===');
const online = await api.onlineSearch(anchors, rec);
const options = api.dishShopOptions(rec, online, 5);
options.forEach(o => console.log('   ' + o.dish.name + '（' + o.dish.cui + '） → ' + o.shop.name + '（' + o.shop.cui.join('/') + '） ' + o.km + 'km ¥' + o.dish.price));
ok(options.length >= 3, '给出 ' + options.length + ' 条"菜 + 店"的组合');
ok(options.every(o => api.restaurantServes(o.shop, o.dish) || o.shop.cui.includes(o.dish.cui)), '每条里的店都真的能做那道菜');
ok(new Set(options.map(o => o.shop.id)).size >= 3, '用到了 ' + new Set(options.map(o => o.shop.id)).size + ' 家不同的店（不是一家包圆）');
ok(new Set(options.map(o => o.dish.name)).size === options.length, '每条都是不同的菜');

console.log('\n=== 四、点其中一条 → 主推荐换成那道菜 + 那家店 ===');
await api.run(); await settle();
const before = api.state.lastResult.combo;
console.log('   换之前：' + before.anchorDish.name + ' @ ' + before.restaurant.name);
const target = options.find(o => o.dish.id !== before.anchorDish.id) || options[0];
api.useDish(target.dish.id);
const after = api.state.lastResult.combo;
console.log('   换之后：' + after.anchorDish.name + ' @ ' + after.restaurant.name);
ok(after.anchorDish.id === target.dish.id, '主菜换成了「' + target.dish.name + '」');
ok(after.items.every(i => api.restaurantServes(after.restaurant, i.dish)), '这一桌菜这家店都能点齐');

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 多菜多店（汤面场景）全部通过'));
process.exit(fail ? 1 : 0);
