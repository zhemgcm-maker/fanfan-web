// 固定测试用例：定位我（GPS + 逆地理编码）与选地点（搜索/附近）两条链路
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
const cache = new Map();
const document = {
  querySelector(s){ if(!cache.has(s)) cache.set(s, fakeEl(s)); return cache.get(s); },
  querySelectorAll(){ return []; },
  createElement(t){ return fakeEl(t); },
  addEventListener(){}
};
const store = new Map();
const localStorage = { getItem:k => store.has(k) ? store.get(k) : null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };

// ---- 假高德：逆地理编码 + 关键词搜索 ----
let regeo = { addr:'河北省保定市竞秀区朝阳大街99号', adcode:'130600', city:'保定市', province:'河北省' };
const places = [
  { id:'P1', name:'万博广场', type:'购物服务;商场', location:'115.4800,38.8830', pname:'河北省', cityname:'保定市', adname:'竞秀区', address:'朝阳北大街', biz_ext:{} },
  { id:'P2', name:'河北大学', type:'科教文化服务;学校', location:'115.4930,38.8870', pname:'河北省', cityname:'保定市', adname:'莲池区', address:'五四东路', biz_ext:{} }
];
let lastQuery = '';
let lastTipsQuery = '';
let tipsDelayMs = 0;
/* 高德「输入提示」的假数据：按关键词返回不同候选，方便断言"联想"和"旧响应丢弃" */
function tipsFor(kw){
  if(kw === '华电') return [
    { name:'华北电力大学（保定二校区）', district:'莲池区', address:'永华北大街', location:'115.5146,38.8889', adcode:'130600' },
    { name:'华电家园', district:'莲池区', address:'', location:'', adcode:'130600' }          // 只有名字、没有坐标
  ];
  if(kw === '万') return [ { name:'万博旧响应测试点', district:'莲池区', address:'', location:'', adcode:'130600' } ];
  if(kw === '万博') return [ { name:'万博广场（联想）', district:'竞秀区', address:'朝阳北大街', location:'115.4800,38.8830', adcode:'130600' } ];
  return [];
}
async function mockFetch(url){
  const u = String(url);
  if(u.includes('restapi.amap.com')){
    if(u.includes('/geocode/regeo')){
      return { ok:true, status:200, json: async () => ({ status:'1', regeocode:{ formatted_address:regeo.addr,
        addressComponent:{ adcode:regeo.adcode, city:regeo.city, province:regeo.province } } }), text: async () => '' };
    }
    if(u.includes('/assistant/inputtips')){
      lastTipsQuery = decodeURIComponent((u.match(/keywords=([^&]*)/) || [,''])[1]);
      const tips = tipsFor(lastTipsQuery);
      if(tipsDelayMs) await new Promise(r => setTimeout(r, tipsDelayMs));
      return { ok:true, status:200, json: async () => ({ status:'1', count:String(tips.length), tips }), text: async () => '' };
    }
    if(u.includes('/geocode/geo')){
      return { ok:true, status:200, json: async () => ({ status:'1', geocodes:[{ location:'115.5146,38.8889' }] }), text: async () => '' };
    }
    if(u.includes('/place/text')){
      lastQuery = decodeURIComponent((u.match(/keywords=([^&]*)/) || [,''])[1]);
      const hit = places.filter(p => p.name.includes(lastQuery));
      return { ok:true, status:200, json: async () => ({ status:'1', count:String(hit.length), pois:hit }), text: async () => '' };
    }
    return { ok:true, status:200, json: async () => ({ status:'1', count:String(places.length), pois:places }), text: async () => '' };
  }
  return { ok:false, status:500, json: async () => ({}), text: async () => '' };
}

// ---- 假定位：第一次直接给坐标，第二次（可选）报权限拒绝 ----
let geoMode = 'ok';
let geoAsked = 0;
let geoCoords = { longitude:115.4800, latitude:38.8830 };   // 每个场景换一组坐标（真实定位也不会一直在同一个点）
const navigator = {
  geolocation: {
    getCurrentPosition(ok, err){
      geoAsked++;
      if(geoMode === 'ok') setTimeout(() => ok({ coords: geoCoords }), 0);
      else setTimeout(() => err({ code:1, message:'User denied Geolocation' }), 0);
    }
  }
};

new Function('document','localStorage','requestAnimationFrame','fetch','navigator',
  code + '\nglobalThis.__L={state,resolveLocation,renderAddrStatus,geolocateMe,toggleLocPanel,searchPlaces,pickLoc,renderLocList,' +
         'locTypeahead,locScore,localLocTips,' +
         'CITY:()=>CITY, CITIES, applyCity, DEFAULT_AMAP_KEY, locResults:()=>locResults, switchCityByAdcode};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch, navigator);
const api = globalThis.__L;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

api.applyCity('baoding');
api.state.profile.city = 'baoding';
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY || 'fake-key';
api.state.address = ''; api.state.origin = null;

console.log('=== 一、定位我：GPS → 逆地理编码 → 填进地址栏 ===');
api.geolocateMe();
await tick(200);
ok(geoAsked === 1, '调用了浏览器定位接口（' + geoAsked + ' 次）');
ok(!!api.state.origin && Math.abs(api.state.origin.lng - 115.48) < 0.001, '拿到精确坐标：' + JSON.stringify(api.state.origin && { lng:api.state.origin.lng, lat:api.state.origin.lat, src:api.state.origin.source }));
ok(api.state.address.indexOf('保定') !== -1, '坐标被翻译成人话地址：' + api.state.address);
ok(document.querySelector('#addr').value === api.state.address, '地址栏自动填好了');
ok(document.querySelector('#addrStatus').textContent.indexOf('已定位') !== -1, '页面上显示「已定位」：' + document.querySelector('#addrStatus').textContent.slice(0, 40) + '…');

let origin = await api.resolveLocation(api.state.address);
ok(origin.precise === true && origin.source === 'gps' && Math.abs(origin.lng - 115.48) < 0.001,
  '搜店用的是定位坐标（不再地理编码）：' + JSON.stringify({ lng:origin.lng, lat:origin.lat, source:origin.source, precise:origin.precise }));

console.log('\n=== 二、定位到别的城市会自动切城市 ===');
regeo = { addr:'北京市朝阳区建国路87号', adcode:'110100', city:'北京市', province:'北京市' };
geoCoords = { longitude:116.4074, latitude:39.9042 };        // 换到北京
api.geolocateMe();
await tick(200);
ok(api.CITY().adcode === '110100', '定位到北京后城市自动切到：' + api.CITY().name + '（' + api.CITY().adcode + '）');

console.log('\n=== 三、定位到城市表里没有的城市 ===');
regeo = { addr:'江苏省南京市玄武区中山路1号', adcode:'320100', city:'南京市', province:'江苏省' };
geoCoords = { longitude:118.7969, latitude:32.0603 };        // 换到南京
api.geolocateMe();
await tick(200);
ok(api.CITY().adcode === '320100', '临时切到：' + api.CITY().name);
const auto = Object.values(api.CITIES).find(c => c.adcode === '320100');
ok(!!auto && auto.key.indexOf('auto-') === 0, '城市列表里现场加了一项：' + (auto ? auto.key : '无'));

console.log('\n=== 四、选地点：搜关键词 → 点一个当地址 ===');
api.applyCity('baoding'); api.state.origin = null; api.state.address = '';
// 真机上这个面板初始带 class="hidden"，测试桩里手动补上，才能测出"点开→自动列附近"
document.querySelector('#locPanel').classList.add('hidden');
api.toggleLocPanel();
await tick(200);
ok(api.locResults().length === 2, '留空时列出"附近的地点"：' + api.locResults().map(x => x.name + '(' + x.km + 'km)').join('、'));
await api.searchPlaces('万博');
ok(lastQuery === '万博', '搜索关键词传给了高德：' + lastQuery);
ok(api.locResults().length === 1 && api.locResults()[0].name === '万博广场', '搜到：「' + api.locResults().map(x => x.name).join('、') + '」');
api.pickLoc(0);
ok(api.state.address === '万博广场', '点选后地址变成：' + api.state.address);
ok(api.state.origin && api.state.origin.source === 'picked', '记下了选点坐标：' + JSON.stringify(api.state.origin && { lng:api.state.origin.lng, src:api.state.origin.source }));
origin = await api.resolveLocation(api.state.address);
ok(Math.abs(origin.lng - 115.48) < 0.0001 && origin.precise === true, '搜店直接用选点坐标：' + origin.lng + ',' + origin.lat);
ok(document.querySelector('#addrStatus').textContent.indexOf('已选点') !== -1, '页面显示「已选点」');

console.log('\n=== 四之二、选地点的模糊联想（打「华电」出「华北电力大学」） ===');
api.applyCity('baoding'); api.state.origin = null; api.state.address = '';
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY || 'fake-key';
document.querySelector('#locPanel').classList.add('hidden');
api.toggleLocPanel();
await tick(200);

const qEl = document.querySelector('#locQuery');
ok(typeof qEl._handlers.input === 'function', '搜索框绑定了 input 事件（边打字边联想）');

// 模糊打分本身：三种命中方式
ok(api.locScore('华电', '华北电力大学') > 0, '跳字匹配：「华电」能命中「华北电力大学」（' + api.locScore('华电','华北电力大学') + ' 分）');
ok(api.locScore('万博', '万博广场') > api.locScore('万博', '保定东站'), '包含匹配比不匹配得分高');
ok(api.locScore('华北电力大学', '华北电力大学') === 1000, '完全相同得分最高');
ok(api.locScore('炸鸡', '华北电力大学') === 0, '完全不沾边的返回 0');

qEl._handlers.input({ target:{ value:'华电' } });
await tick(600);                                        // 300ms 防抖 + 请求 + 渲染
let names = api.locResults().map(x => x.name);
ok(names.some(n => n.indexOf('华北电力大学') === 0), '打「华电」命中内置地标：' + names.slice(0, 5).join('、'));
ok(document.querySelector('#locList').innerHTML.indexOf('<b>华电</b>') !== -1, '命中的那两个字在列表里高亮');
ok(lastTipsQuery === '华电', '同时问了高德的输入提示接口（keywords=' + lastTipsQuery + '）');
ok(names.includes('华电家园'), '高德返回的长尾候选合并进来了');
ok(api.locResults()[0].name.indexOf('华北电力大学') === 0, '内置地标排在前面（离线也能立刻出）：' + api.locResults()[0].name);
ok(document.querySelector('#locNote').textContent.indexOf('联想') !== -1,
   '状态行写清来源：' + document.querySelector('#locNote').textContent.slice(0, 46));

// 高德候选里"只有名字、没有坐标"的那种：点的时候自动补一次地理编码
const idxNoCoord = api.locResults().map(x => x.name).indexOf('华电家园');
await api.pickLoc(idxNoCoord);
ok(api.state.address === '华电家园' && api.state.origin && Math.abs(api.state.origin.lng - 115.5146) < 0.0001,
   '没坐标的候选点选后自动补上坐标：' + JSON.stringify(api.state.origin && { lng:api.state.origin.lng, lat:api.state.origin.lat }));

// 没填高德 Key：只有内置地标，但这条功能依然能用（离线兜底）
api.state.origin = null; api.state.address = '';
api.state.settings.amapKey = '';
document.querySelector('#locPanel').classList.add('hidden');
api.toggleLocPanel(); await tick(200);
qEl._handlers.input({ target:{ value:'河大' } });
await tick(600);
names = api.locResults().map(x => x.name);
ok(names.includes('河北大学'), '没填 Key 时内置地标照样匹配：「河大」→ ' + names.join('、'));
ok(document.querySelector('#locNote').textContent.indexOf('内置地标') !== -1,
   '状态行说明这是离线匹配：' + document.querySelector('#locNote').textContent.slice(0, 40));
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY || 'fake-key';

// 打字快：慢的那次（"万"）结果回来时不能覆盖后发起的（"万博"）
tipsDelayMs = 500;
const slow = api.locTypeahead('万');
tipsDelayMs = 0;
await api.locTypeahead('万博');
await slow;
const after = api.locResults().map(x => x.name);
ok(after.includes('万博广场（联想）') && after.indexOf('万博旧响应测试点') === -1,
   '慢的旧响应被丢弃，不会覆盖新结果：' + after.join('、'));

console.log('\n=== 五、手动改地址会作废定位坐标 ===');
const inputHandler = document.querySelector('#addr')._handlers.input;
ok(typeof inputHandler === 'function', '地址输入框绑定了 input 事件');
if(inputHandler) inputHandler({ target:{ value:'河北大学' } });
ok(api.state.origin === null, '手动输入后定位坐标被清掉（避免用错位置）');
ok(document.querySelector('#addrStatus').textContent.indexOf('按这个地址解析坐标') !== -1, '状态行改回"按地址解析"');

console.log('\n=== 六、浏览器不给定位时要有兜底提示 ===');
geoMode = 'denied';
api.geolocateMe();
await tick(200);
ok(document.querySelector('#addrStatus').textContent.indexOf('定位权限被拒绝') !== -1,
  '拒绝权限时提示：' + document.querySelector('#addrStatus').textContent.slice(0, 32) + '…');

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 定位 / 选点 全部通过'));
process.exit(fail ? 1 : 0);
