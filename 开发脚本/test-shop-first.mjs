// 固定测试用例：店为先的检索（多菜 → 意图 → 多店 → 反查能做哪些菜）+ 饭店评分维度 + 手动换店
import fs from 'node:fs';

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

// ---- 假高德：按关键词返回不同菜系的店（模拟真实"搜什么关键词就来哪类店"）----
const CENTER = '115.4646,38.8740';
const SHOPS = {
  '川菜':   { id:'S-CHUAN',  name:'蜀香川菜馆', type:'餐饮服务;中餐厅;川菜',   km:0.6, rating:'4.5', cost:'55' },
  '烤肉':   { id:'S-KAO',    name:'炭火烤肉店', type:'餐饮服务;烤肉',         km:1.2, rating:'4.6', cost:'88' },
  '家常菜': { id:'S-JIACHANG', name:'家常小馆', type:'餐饮服务;中餐厅',       km:0.4, rating:'4.2', cost:'35' },
  '火锅':   { id:'S-HOTPOT', name:'牛油火锅店', type:'餐饮服务;中餐厅;火锅店', km:0.8, rating:'4.4', cost:'90' },
  '面馆':   { id:'S-NDL',    name:'兰州面馆',   type:'餐饮服务;小吃;面馆',    km:0.3, rating:'4.1', cost:'20' }
};
let amapCalls = [];
async function mockFetch(url){
  const u = String(url);
  if(u.includes('restapi.amap.com')){
    if(u.includes('/geocode')) return { ok:true, status:200, json: async () => ({ status:'1', geocodes:[{ location:CENTER, formatted_address:'保定市裕华路' }] }), text: async () => '' };
    const kw = decodeURIComponent((u.match(/keywords=([^&]*)/) || [,''])[1] || '');
    amapCalls.push(kw);
    const hit = Object.keys(SHOPS).filter(k => kw.includes(k));
    const pois = hit.map(k => {
      const sp = SHOPS[k];
      return { id:sp.id, name:sp.name, type:sp.type, location:'115.4700,38.8800', adname:'竞秀区', address:'测试路',
               biz_ext:{ rating:sp.rating, cost:sp.cost } };
    });
    return { ok:true, status:200, json: async () => ({ status:'1', count:String(pois.length), pois }), text: async () => '' };
  }
  return { ok:false, status:500, json: async () => ({}), text: async () => '' };
}

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__S={state,recommend,pickAnchors,onlineSearch,shopIntents,scoreRestaurant,planMeal,useShop,run,' +
         'applyCity,DISHES,DEFAULT_AMAP_KEY,restaurantServes,CANDIDATE_DISHES:()=>CANDIDATE_DISHES,clearAmapCache};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch);
const api = globalThis.__S;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
const settle = (ms = 4200) => new Promise(r => setTimeout(r, ms));

api.applyCity('baoding');
api.state.profile.city = 'baoding';
api.state.settings.enabled = 'off';
api.state.settings.online = 'on';
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY || 'fake';
Object.assign(api.state, { tier:'mid', cat:'rice', mode:'delivery', spiceMax:3,
  address:'保定市裕华路步行街', budget:60, seed:1, reroll:0 });
api.state.profile.allergies = []; api.state.profile.tastes = [];
api.state.profile.likes = {}; api.state.profile.dislikes = {}; api.state.profile.history = [];
api.state.profile.banned = { dishes:{}, shops:{} };
if(api.clearAmapCache) api.clearAmapCache();

console.log('=== 一、"想吃肉"不再等于只搜一道菜，而是搜一类 ===');
api.state.craveTags = ['想吃肉'];
const rec = api.recommend();
const anchors = api.pickAnchors(rec);
const intents = api.shopIntents(rec, anchors);
console.log('   搜索意图：' + intents.map(x => x.kw + '（' + x.why + '）').join('   '));
ok(intents.length >= 3, '给出 ' + intents.length + ' 个搜店意图（不是一道菜名）');
ok(intents.some(x => ['川菜','烤肉','家常菜','火锅','粤菜'].indexOf(x.kw) !== -1), '意图里包含菜系/品类关键词');
ok(intents.every(x => x.why && x.why.length), '每个意图都带"为什么搜它"的说明');
ok(intents.some(x => x.why.indexOf('想吃肉') !== -1), '「想吃肉」被翻译成了菜系意图：' +
  (intents.find(x => x.why.indexOf('想吃肉') !== -1) || {}).kw);

console.log('\n=== 二、搜回来的店：反查能做哪些候选菜（而不是按菜名匹配）===');
const online = await api.onlineSearch(anchors.map(a => a.dish), rec);
console.log('   实际请求的关键词：' + [...new Set(amapCalls)].join('、'));
ok(online.shops.length >= 3, '搜到 ' + online.shops.length + ' 家不同店铺');
const chuan = online.shops.find(s => s.name === '蜀香川菜馆');   // 高德 POI 转成店之后 id 会加前缀，所以按名字找
ok(!!chuan, '川菜馆在候选里：' + (chuan ? chuan.name + '（cui=' + chuan.cui.join('/') + '）' : '无'));
// byDish 只覆盖"可能当主角的锚定菜"（planMeal 只会用这些），这是设计
const anchorNames = anchors.map(a => a.dish.name);
const chuanDishes = anchors.map(a => a.dish).filter(d => (online.byDish[d.id] || []).some(s => s.name === '蜀香川菜馆'));
ok(chuanDishes.length >= 1, '川菜馆被挂到了锚定菜里的 ' + chuanDishes.length + ' 道川菜下：' + chuanDishes.map(d => d.name).join('、'));
ok(chuanDishes.every(d => d.cui === '川'), '而且挂上去的都是川菜（' + chuanDishes.map(d => d.cui).join('/') + '），不是靠菜名硬匹配');
ok(anchorNames.length > chuanDishes.length, '其余锚定菜（' + anchorNames.filter(n => !chuanDishes.some(d => d.name === n)).slice(0,3).join('、') + '…）由别的店接');
ok(api.CANDIDATE_DISHES().length >= 8, '记下了 ' + api.CANDIDATE_DISHES().length + ' 道候选菜（给"能做几道"打分用）');

console.log('\n=== 三、饭店评分维度变丰富 ===');
const dish = chuanDishes[0];
const scored = api.scoreRestaurant(chuan, dish, {});
console.log('   店分项：' + Object.entries(scored.parts).map(([k, v]) => k + '=' + v.raw).join('  '));
['距离','评分','人均匹配','菜系对口','菜品覆盖','口味契合','方式匹配'].forEach(k => {
  ok(!!scored.parts[k], '评分包含维度「' + k + '」');
});
ok(scored.parts['菜品覆盖'].raw > 0, '菜品覆盖得分 ' + scored.parts['菜品覆盖'].raw + '（这家店能做多道候选菜）');
ok(scored.reasons.some(x => x.indexOf('都能做') !== -1), '给用户的理由里说明了"能做几道"：' + scored.reasons.filter(x=>x.indexOf('都能做')!==-1).join(''));

console.log('\n=== 四、走完整流程 + 手动换店（人在环）===');
await api.run(); await settle();
const first = api.state.lastResult.combo;
ok(!!first, '推荐成功：' + (first ? first.restaurant.name + ' —— ' + first.items.map(i => i.dish.name).join('＋') : '无'));
const others = (api.state.lastOnline.shops || []).filter(sp => sp.id !== first.restaurant.id);
ok(others.length >= 2, '还有 ' + others.length + ' 家店可以手动换');
const target = others[0];
api.useShop(target.id);
const after = api.state.lastResult.combo;
ok(after.restaurant.id === target.id, '点「' + target.name + '」之后主推荐换成了它（现在：' + after.restaurant.name + '）');
ok(after.items.length >= 1, '换店后照样配出了一桌：' + after.items.map(i => i.dish.name).join('＋'));
ok(after.items.every(i => api.restaurantServes(after.restaurant, i.dish)), '这一桌菜确实都能在这家店点到');

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 店为先检索 / 店评分 / 手动换店 全部通过'));
process.exit(fail ? 1 : 0);
