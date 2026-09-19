// 测试：大模型把"用一句话说说"解析成标签/关键词，再交给算法
// 覆盖：正常解析 / 返回非 JSON / 返回词表外标签 / 关掉大模型 / 同一句话走缓存 / 全流程跑通
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(name = 'el') {
  const el = {
    _name:name, value:'', className:'', style:{}, children:[], dataset:{},
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
                contains(c){return this._s.has(c)}, toggle(c,f){const on=f===undefined?!this._s.has(c):!!f; on?this._s.add(c):this._s.delete(c); return on} },
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){},
    appendChild(c){ el.children.push(c); return c; },
    querySelector(){ return fakeEl(); }, querySelectorAll(){ return []; },
    scrollIntoView(){}, onclick:null, disabled:false
  };
  let text = '';
  Object.defineProperty(el, 'textContent', { get(){ return text; }, set(v){ text = String(v); el.innerHTML = text.replace(/<[^>]+>/g,''); } });
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html || ''; }, set(v){ el._html = String(v); text = String(v).replace(/<[^>]+>/g,''); } });
  return el;
}
const elCache = new Map();
const document = {
  querySelector(s){ if(!elCache.has(s)) elCache.set(s, fakeEl(s)); return elCache.get(s); },
  querySelectorAll(){ return []; },
  createElement(){ return fakeEl(); },
  addEventListener(){}
};
const store = new Map();
const localStorage = {
  getItem:k => store.has(k) ? store.get(k) : null,
  setItem:(k,v) => store.set(k, String(v)),
  removeItem:k => store.delete(k)
};

// ---- 假 fetch：按 system prompt 区分"口味解析"和"推荐语"两种调用 ----
const mock = { parseCalls:0, phrasingCalls:0, amapCalls:0, parseReply:'', mode:'ok' };
const POIS = [
  { id:'N1', name:'保定家常菜馆', type:'餐饮服务;中餐厅;家常菜', location:'115.4650,38.8750', adname:'莲池区', address:'裕华路1号', biz_ext:{ rating:'4.5', cost:'30' } },
  { id:'N2', name:'川味小馆',     type:'餐饮服务;中餐厅;川菜',   location:'115.4660,38.8760', adname:'莲池区', address:'裕华路2号', biz_ext:{ rating:'4.4', cost:'28' } }
];
async function mockFetch(url, opts){
  const u = String(url);
  if(u.includes('restapi.amap.com')){
    mock.amapCalls++;
    if(u.includes('/geocode')) return { ok:true, status:200, json: async () => ({ status:'1', geocodes:[{ location:'115.4646,38.8740', formatted_address:'保定市裕华路' }] }), text: async () => '' };
    return { ok:true, status:200, json: async () => ({ status:'1', count:String(POIS.length), pois:POIS }), text: async () => '' };
  }
  if(u.includes('chat/completions')){
    const body = JSON.parse(opts.body);
    const isParse = String(body.messages[0].content).includes('点餐意图解析器');
    if(isParse){
      mock.parseCalls++;
      if(mock.mode === 'http500') return { ok:false, status:500, text: async () => 'server error' };
      return { ok:true, status:200, json: async () => ({ model:body.model,
        choices:[{ message:{ content: mock.parseReply } }], usage:{ prompt_tokens:120, completion_tokens:30 } }), text: async () => '' };
    }
    mock.phrasingCalls++;
    return { ok:true, status:200, json: async () => ({ model:body.model,
      choices:[{ message:{ content:'就吃这一桌吧。' } }], usage:{ prompt_tokens:800, completion_tokens:20 } }), text: async () => '' };
  }
  return { ok:false, status:404, json: async () => ({}), text: async () => '' };
}

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__P={state,run,recommend,craveHits,craveWords,cravingTags,shopIntents,pickAnchors,applyCity,' +
         'clearAmapCache,DEFAULT_AMAP_KEY,renderCraveParse,traceCravingParse,CAT_CRAVE_TAGS,craveTagsFor,tagHitCount,craveParseInfo:()=>state.craveAutoInfo};')
  (document, localStorage, (f) => setTimeout(f, 0), mockFetch);
const api = globalThis.__P;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
const settle = (ms = 2500) => new Promise(r => setTimeout(r, ms));

api.applyCity('baoding');
api.state.profile.city = 'baoding';
if(api.clearAmapCache) api.clearAmapCache();
Object.assign(api.state, { tier:'mid', cat:'rice', mode:'dinein', spiceMax:3,
  address:'保定市裕华路步行街', budget:60, seed:1, reroll:0, craveTags:[] });
api.state.profile.allergies = []; api.state.profile.tastes = [];
api.state.profile.likes = {}; api.state.profile.dislikes = {}; api.state.profile.history = [];
api.state.profile.banned = { dishes:{}, shops:{} };

console.log('=== 一、大模型把一句话解析成标签，直接进算法 ===');
api.state.settings.enabled = 'on';
api.state.settings.key = 'sk-test-dummy';
api.state.craveText = '想吃奶奶做的味道，清淡点的';
mock.parseReply = '```json\n{"tags":["清淡点","家常菜"],"keywords":["砂锅"],"note":"想吃家常清淡的"}\n```';
await api.traceCravingParse();
ok(mock.parseCalls === 1, '解析调用打了 1 次大模型');
ok(api.state.craveAuto.join('/') === '清淡点/家常菜', '解析出的标签进了 craveAuto：' + api.state.craveAuto.join('、'));
ok(api.cravingTags().join('/') === '清淡点/家常菜', '标签和用户勾选的 chips 合并成一路：' + api.cravingTags().join('、'));
ok(api.craveWords().join('/') === '砂锅', '关键词替换掉本地切词：' + api.craveWords().join('、'));
const info = api.craveParseInfo();
ok(info && info.src === 'llm' && info.note === '想吃家常清淡的', '解析详情记下来了（含 note）');

const dish = { id:'x', name:'砂锅豆腐', cui:'家常', tags:['清淡','素'], desc:'砂锅炖的', spicy:0, price:20, alg:[], role:'single' };
const h = api.craveHits(dish);
ok(h.hitTags.indexOf('清淡点') !== -1, '算法确实用上了"清淡点"这个标签（命中：' + h.hitTags.join('、') + '）');
ok(h.textHits.indexOf('砂锅') !== -1, '关键词"砂锅"也参与了打分（命中：' + h.textHits.join('、') + '）');
const intents = api.shopIntents(api.recommend(), api.pickAnchors(api.recommend()));
ok(intents.some(i => i.why.indexOf('大模型读懂了') !== -1), '搜店意图里带上了"大模型读懂了「…」"的说明');

console.log('\n=== 二、结果展示与开发者面板 ===');
ok(document.querySelector('#craveParsed').innerHTML.indexOf('大模型理解') !== -1, '输入框下面显示「大模型理解」那一行');
ok(document.querySelector('#craveParsed').innerHTML.indexOf('清淡点') !== -1, '那一行写出了解析到的标签');
ok(document.querySelector('#devParse').textContent.indexOf('砂锅') !== -1, '开发者面板能看到模型原始返回');

console.log('\n=== 三、同一句话第二次走缓存，不再调模型 ===');
mock.parseCalls = 0;
await api.traceCravingParse();
ok(mock.parseCalls === 0, '同样的句子没有再打大模型');
ok(api.state.craveAuto.join('/') === '清淡点/家常菜', '缓存里的结果照样生效');

console.log('\n=== 四、模型乱答 / 返回词表外的标签 → 自动退回本地词表 ===');
mock.parseReply = '我觉得你想吃点好的，具体不清楚。';   // 不是 JSON
api.state.craveText = '随便来点有锅气的';
await api.traceCravingParse();
ok(api.craveParseInfo().src === 'rules', '不是 JSON 时 src=rules（回退）');
ok(api.state.craveAuto.length === 0, '没有把垃圾结果塞进算法');
ok(api.craveWords().length > 0, '退回本地切词，照样有关键词可用：' + api.craveWords().join('、'));

mock.parseReply = '{"tags":["汉堡快餐","火锅"],"keywords":[],"note":"乱标"}';   // 都不属于"吃饭"类
api.state.craveText = '想吃点好的';
await api.traceCravingParse();
ok(api.state.craveAuto.length === 0, '词表外的标签被校验丢掉了（不会污染算法）');
ok(api.craveParseInfo().src === 'rules', '全被丢掉后同样退回本地词表');

mock.mode = 'http500';
api.state.craveText = '接口挂掉的时候';
await api.traceCravingParse();
ok(api.craveParseInfo().src === 'rules' && api.state.craveAuto.length === 0, '接口 500 时不影响流程，退回本地词表');
mock.mode = 'ok';

console.log('\n=== 五、关掉大模型 → 一次都不调，行为跟以前一样 ===');
mock.parseCalls = 0;
api.state.settings.enabled = 'off';
api.state.craveText = '想吃辣的';
await api.traceCravingParse();
ok(mock.parseCalls === 0, '关闭时完全不调用大模型');
ok(api.craveParseInfo().src === 'rules', '标记为本地词表');
ok(api.craveWords().join('/') === '想吃辣的', '本地切词照旧：' + api.craveWords().join('、'));

console.log('\n=== 六、完整跑一次推荐（大模型开启）===');
api.state.settings.enabled = 'on';
api.state.craveTags = [];
api.state.craveText = '想吃奶奶做的味道，清淡点的';
api.state.seed = 1;
mock.parseCalls = 0;
await api.run();
await settle(1500);
const html2 = document.querySelector('#result').innerHTML;
ok(mock.parseCalls === 0, '同一句话在完整流程里同样走缓存');
ok(html2.indexOf('card-head') !== -1, '结果卡片照常渲染');
const traceItems = document.querySelector('#traceList').children || [];
ok(traceItems.some(li => String(li.innerHTML || '').indexOf('大模型理解你说的话') !== -1),
   '流水线里出现了"②b 大模型理解你说的话"这一步（共 ' + traceItems.length + ' 步）');

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 大模型口味解析全部通过'));
process.exit(fail ? 1 : 0);
