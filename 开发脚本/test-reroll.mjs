// 固定测试用例：「换一批」必须真的换一家店；「不喜欢」必须真的屏蔽那道菜和那家店
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(name = 'el'){
  const el = {
    _name:name, value:'', className:'', style:{}, children:[], dataset:{},
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
      contains(c){return this._s.has(c)}, toggle(c,f){const on = f===undefined?!this._s.has(c):!!f; on?this._s.add(c):this._s.delete(c); return on} },
    setAttribute(){}, getAttribute(){return null}, addEventListener(){}, removeEventListener(){},
    appendChild(c){ el.children.push(c); return c }, querySelector(){ return fakeEl() }, querySelectorAll(){ return [] },
    scrollIntoView(){}, focus(){}, onclick:null
  };
  let text = '', html = '';
  Object.defineProperty(el, 'textContent', { get(){return text}, set(v){ text = String(v); html = text.replace(/<[^>]+>/g,''); } });
  Object.defineProperty(el, 'innerHTML', { get(){return html}, set(v){ html = String(v); if(!html) el.children.length = 0; } });
  return el;
}
const cache = new Map();
const document = {
  querySelector(s){ if(!cache.has(s)) cache.set(s, fakeEl(s)); return cache.get(s); },
  querySelectorAll(){ return []; },
  createElement(t){ return fakeEl(t); },
  addEventListener(){}
};
const store = new Map();
const localStorage = { getItem:k => store.has(k) ? store.get(k) : null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };

// ---- 假高德：给出 8 家不同的火锅店（名字、距离、评分都不同）----
const CENTER = { lng:115.4646, lat:38.8740 };
const shops = Array.from({ length: 8 }, (_, i) => ({
  id: 'B' + (100 + i),
  name: '测试火锅店' + (i + 1) + '号店',
  type: '餐饮服务;中餐厅;火锅店',
  location: (CENTER.lng + 0.002 * (i + 1)) + ',' + (CENTER.lat + 0.001 * (i + 1)),
  adname: '竞秀区',
  address: '测试路' + (i + 1) + '号',
  tel: '0312-200000' + i,
  biz_ext: { rating: String(4.8 - i * 0.1), cost: String(50 + i * 5) }
}));
let llmCalls = 0;
async function mockFetch(url){
  if(String(url).includes('restapi.amap.com')){
    if(String(url).includes('/geocode')){
      return { ok:true, status:200, json: async () => ({ status:'1', geocodes:[{ location: CENTER.lng + ',' + CENTER.lat, formatted_address:'河北省保定市莲池区裕华路' }] }), text: async () => '' };
    }
    return { ok:true, status:200, json: async () => ({ status:'1', count:'8', pois: shops }), text: async () => '' };
  }
  if(String(url).includes('deepseek')){ llmCalls++; return { ok:true, status:200, json: async () => ({ choices:[{ message:{ content:'测试点评' } }] }), text: async () => '' }; }
  return { ok:false, status:500, json: async () => ({}), text: async () => '' };
}

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__r={state,run,recommend,planMeal,pickAnchors,dislikeDish,bannedDishIds,bannedShopIds,applyCity,' +
         'DISHES,DEFAULT_AMAP_KEY,saveProfile,renderResult};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch);
const api = globalThis.__r;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
const settle = (ms = 4200) => new Promise(r => setTimeout(r, ms));

api.applyCity('baoding');
api.state.profile.city = 'baoding';
api.state.settings.enabled = 'off';            // 这轮只测推荐轮换，不调大模型
api.state.settings.online = 'on';
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY || 'fake';
Object.assign(api.state, { tier:'mid', cat:'other', mode:'dinein', spiceMax:3,
  address:'保定市裕华路步行街', craveTags:['火锅'], craveText:'', seed:1, budget:60, reroll:0 });
api.state.profile.allergies = []; api.state.profile.tastes = [];
api.state.profile.likes = {}; api.state.profile.dislikes = {}; api.state.profile.history = [];
api.state.profile.banned = { dishes:{}, shops:{} };

const sig = () => {
  const c = api.state.lastResult && api.state.lastResult.combo;
  return c ? { shop:c.restaurant.name, dish:(c.anchorDish || c.items[0].dish).name } : null;
};

console.log('=== 一、搜火锅：第一次推荐 ===');
await api.run(); await settle();
const first = sig();
ok(!!first, '第一次推荐成功：' + (first ? first.shop + '（' + first.dish + '）' : '无'));
const shopsSeen = new Set(first ? [first.shop] : []);

console.log('\n=== 二、点「换一批」必须换一家店 ===');
let prev = first ? first.shop : '';
for (let i = 1; i <= 3; i++) {
  document.querySelector('#rerollBtn').onclick();
  await settle();
  const now = sig();
  ok(!!now && now.shop !== prev, '第 ' + i + ' 次换一批：' + prev + ' → ' + (now ? now.shop : '无') + '（主菜 ' + (now ? now.dish : '-') + '）');
  if (now) { shopsSeen.add(now.shop); prev = now.shop; }
}
ok(shopsSeen.size >= 3, '连点几次换一批后出现的不同店铺数 = ' + shopsSeen.size + '：' + [...shopsSeen].join('、'));

console.log('\n=== 三、点「不喜欢」必须屏蔽这道菜和这家店 ===');
const beforeDislike = sig();
document.querySelector('#dislikeBtn').onclick();
await settle(5000);
const afterDislike = sig();
const bannedD = api.bannedDishIds(), bannedS = api.bannedShopIds();
console.log('   不喜欢前：' + beforeDislike.shop + ' / ' + beforeDislike.dish);
console.log('   不喜欢后：' + afterDislike.shop + ' / ' + afterDislike.dish);
ok(bannedD.length >= 1, '屏蔽记录里有 ' + bannedD.length + ' 道菜：' + bannedD.join(','));
ok(bannedS.length >= 1, '屏蔽记录里有 ' + bannedS.length + ' 家店：' + bannedS.join(','));
ok(afterDislike.shop !== beforeDislike.shop, '立刻换了一家店：' + beforeDislike.shop + ' → ' + afterDislike.shop);

console.log('\n=== 四、再点几次换一批，不能回到被屏蔽的店 ===');
let back = false;
for (let i = 0; i < 4; i++) {
  document.querySelector('#rerollBtn').onclick();
  await settle();
  const now = sig();
  if (now && now.shop === beforeDislike.shop) back = true;
  console.log('   换第 ' + (i + 1) + ' 次 → ' + (now ? now.shop : '无'));
}
ok(!back, '后续 4 次换一批都没有再出现被屏蔽的「' + beforeDislike.shop + '」');

console.log('\n=== 五、清空屏蔽记录 ===');
api.state.profile.banned = { dishes:{}, shops:{} };
ok(api.bannedDishIds().length === 0 && api.bannedShopIds().length === 0, '清空后屏蔽列表为空，被屏蔽的菜和店重新参与推荐');

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 换一批 / 不喜欢 全部通过'));
process.exit(fail ? 1 : 0);
