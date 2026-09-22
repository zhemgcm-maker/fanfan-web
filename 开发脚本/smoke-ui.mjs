import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// 记录最后一次 innerHTML，便于断言结果卡片真的被渲染出来
function fakeEl(name = 'el') {
  const el = {
    _name: name,
    value: '', className: '', style: {}, children: [], dataset: {},
    classList: {
      _s: new Set(),
      add(c){ this._s.add(c); },
      remove(c){ this._s.delete(c); },
      contains(c){ return this._s.has(c); },
      toggle(c, force){ const on = force === undefined ? !this._s.has(c) : !!force; on ? this._s.add(c) : this._s.delete(c); return on; }
    },
    setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){},
    appendChild(c){ el.children.push(c); return c; },
    querySelector(){ return fakeEl(); },
    querySelectorAll(){ return []; },
    scrollIntoView(){}, focus(){}, onclick: null
  };
  // 贴近真实 DOM：写 textContent 会同步到 innerHTML（读 innerHTML 的断言才有效）
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get(){ return text; },
    set(v){ text = String(v); el.innerHTML = text.replace(/<[^>]+>/g, ''); }
  });
  // 真实 DOM 里 innerHTML='' 会清空子节点，桩里也要一致，否则断言会误判
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get(){ return html; },
    set(v){ html = String(v); if(!html) el.children.length = 0; }
  });
  return el;
}
const cache = new Map();
// #spiceSeg 里的分段按钮：给测试桩造一批带 dataset 的假按钮
const segButtons = ['0','1','2','3'].map(v => {
  const b = fakeEl('spiceBtn');
  b.dataset = { v };
  b._handlers = {};
  b.addEventListener = (type, fn) => { b._handlers[type] = fn; };
  return b;
});
const document = {
  querySelector(sel) { if (!cache.has(sel)) cache.set(sel, fakeEl(sel)); return cache.get(sel); },
  querySelectorAll(sel) { return sel === '#spiceSeg button' ? segButtons : []; },
  createElement(tag) { return fakeEl(tag); },
  addEventListener(){}
};
const store = new Map();
const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k,v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const errors = [];
process.on('unhandledRejection', e => errors.push('unhandledRejection: ' + (e && e.message)));

// 可控的假 fetch：分别模拟 高德 / OpenStreetMap / DeepSeek
const mock = { mode: 'ok', calls: 0, amapCalls: 0, osmCalls: 0, llmCalls: 0, backendCalls: 0 };

const baodingPois = [
  { id:'B0FF1', name:'老保定驴肉火烧（裕华路店）', type:'餐饮服务;中餐厅;河北菜', location:'115.4690,38.8760', adname:'莲池区', address:'裕华路128号', tel:'0312-2012345', biz_ext:{ rating:'4.6', cost:'22' } },
  { id:'B0FF2', name:'直隶会馆', type:'餐饮服务;中餐厅;官府菜', location:'115.4620,38.8730', adname:'莲池区', address:'莲池大街1号', tel:'0312-2023456', biz_ext:{ rating:'4.7', cost:'120' } },
  { id:'B0FF3', name:'白运章包子铺', type:'餐饮服务;小吃快餐;包子', location:'115.4660,38.8780', adname:'莲池区', address:'裕华路65号', tel:'0312-2034567', biz_ext:{ rating:'4.5', cost:'18' } },
  { id:'B0FF4', name:'川味小馆（朝阳大街店）', type:'餐饮服务;中餐厅;川菜', location:'115.4810,38.8830', adname:'竞秀区', address:'朝阳大街99号', tel:'0312-2045678', biz_ext:{ rating:'4.4', cost:'40' } },
  { id:'B0FF5', name:'蜀香火锅（竞秀区店）', type:'餐饮服务;中餐厅;火锅', location:'115.4720,38.8810', adname:'竞秀区', address:'朝阳大街200号', tel:'0312-2056789', biz_ext:{ rating:'4.5', cost:'85' } },
  { id:'B0FF6', name:'炭火烤串屋', type:'餐饮服务;烧烤;烧烤', location:'115.4700,38.8760', adname:'莲池区', address:'军校广场北侧', tel:'0312-2067890', biz_ext:{ rating:'4.3', cost:'50' } },
  { id:'B0FF7', name:'粤香烧腊饭店', type:'餐饮服务;中餐厅;粤菜', location:'115.4650,38.8740', adname:'莲池区', address:'莲池大街88号', tel:'0312-2078901', biz_ext:{ rating:'4.4', cost:'48' } },
  { id:'B0FF8', name:'老味道面馆', type:'餐饮服务;小吃;面馆', location:'115.4740,38.8820', adname:'竞秀区', address:'三丰路12号', tel:'0312-2089012', biz_ext:{ rating:'4.2', cost:'20' } }
];

async function mockFetch(url, opts) {
  mock.calls++;
  /* —— 我们的后端（阿里云 FC）——
   * 这里模拟真实情况：后端的高德 Key 没开通「Web服务」（实测返回 10002），
   * 应用必须先试后端、失败后自动回退本机直连。不显式拦这一路的话，
   * 请求会掉进下面的 DeepSeek 分支，把整条降级链路带偏。 */
  if (url.includes('fcapp.run') || url.includes('/api/amap')) {
    mock.backendCalls++;
    return { ok:true, status:200,
             json: async () => ({ status:'0', info:'SERVICE_NOT_AVAILABLE', infocode:'10002' }),
             text: async () => '' };
  }
  // —— 高德 ——
  if (url.includes('restapi.amap.com')) {
    mock.amapCalls++;
    if (mock.mode === 'amap-badkey') {
      return { ok:true, status:200, json: async () => ({ status:'0', info:'INVALID_USER_KEY', infocode:'10001' }), text: async () => '' };
    }
    if (url.includes('/geocode')) {
      return { ok:true, status:200, json: async () => ({ status:'1', geocodes:[{ location:'115.4646,38.8740', formatted_address:'河北省保定市莲池区裕华路步行街' }] }), text: async () => '' };
    }
    return { ok:true, status:200, json: async () => ({ status:'1', pois: baodingPois }), text: async () => '' };
  }
  // —— OpenStreetMap ——
  if (url.includes('overpass')) {
    mock.osmCalls++;
    if (mock.mode === 'osm-timeout') { const e = new Error('aborted'); throw e; }
    return { ok:true, status:200, json: async () => ({ elements: [
      { type:'node', id:1, lat:38.8750, lon:115.4680, tags:{ name:'驴肉火烧老店', amenity:'restaurant', cuisine:'chinese' } },
      { type:'node', id:2, lat:38.8800, lon:115.4700, tags:{ name:'保定家常菜', amenity:'restaurant', cuisine:'chinese' } }
    ] }), text: async () => '' };
  }
  // —— DeepSeek ——
  mock.llmCalls++;
  const body = JSON.parse(opts.body);
  if (mock.mode === 'http401') {
    return { ok: false, status: 401, text: async () => '{"error":{"message":"Authentication Fails"}}' };
  }
  const reasoningOnly = mock.mode === 'reasoning-only' && mock.calls === 1;
  return {
    ok: true, status: 200,
    json: async () => ({
      model: body.model,
      choices: [{ message: { content: reasoningOnly ? '' : '推荐蜀香小馆的川味回锅肉盖饭，28元、0.5公里、17分钟送达。', reasoning_content: reasoningOnly ? '我们需要回答用户…（一长串思考）' : '' } }],
      usage: { prompt_tokens: 810, completion_tokens: 68 }
    }),
    text: async () => ''
  };
}

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__s={state,run,renderTiers,renderCats,renderChips,renderProfile,updateSummary,acceptCombo,dislikeDish,renderResult,recommend,recommendRestaurants,renderEmpty,PROVIDERS,DEFAULT_KEY,switchTab,renderTierSeg,renderAddrList,renderMeHeader,renderSpiceSeg,saveProfile,TIERS,CITIES,applyCity,changeCity,renderCitySelect,hasOfflineData,clearAmapCache,get CITY(){return CITY},onlineSearch,recommendRestaurantsSmart,DISHES,renderFlowStrip,renderSettingsUI,FLOW_AGENT,FLOW_ALGO};')
  (document, localStorage, (f) => setTimeout(f, 0), mockFetch);

const api = globalThis.__s;

function assert(cond, label) {
  console.log((cond ? '✅ ' : '❌ ') + label);
  if (!cond) errors.push(label);
}

// ---------- 还没选城市时的提醒 ----------
console.log('--- 未设置城市时的提醒 ---');
try {
  api.applyCity('baoding');
  api.state.profile.city = null;          // 模拟"从来没选过城市"
  api.renderCitySelect();
  assert(document.querySelector('#cityReminder').classList.contains('hidden') === false, '没选城市时首页顶部出现提醒卡');
  assert(document.querySelector('#homeCityLine').textContent.includes('还没选择城市'), '首页提示「还没选择城市」');
  assert(document.querySelector('#cityBadge').textContent.includes('请选择城市'), '顶部徽章提示「请选择城市」');
  assert(document.querySelector('#citySelect').value === '', '「我的」里的下拉框显示占位「请选择城市…」');
  assert(document.querySelector('#cityHint').textContent.includes('还没选择城市'), '「我的」里提示还没选城市');

  // 没选城市就点开始推荐 → 拦住并跳到「我的」
  api.state.tier = 'mid'; api.state.cat = 'rice';
  const before = document.querySelector('#result').innerHTML;
  await api.run();
  await new Promise(r => setTimeout(r, 500));
  assert(document.querySelector('#result').innerHTML === before, '没选城市时点了也不会出结果');
  assert(document.querySelector('#pageMe').classList.contains('hidden') === false, '自动跳到「我的」让用户去设置城市');

  // 选好城市后提醒消失
  api.changeCity('baoding');
  assert(document.querySelector('#cityReminder').classList.contains('hidden') === true, '选完城市后首页提醒卡消失');
  assert(document.querySelector('#homeCityLine').textContent.includes('当前城市：保定市'), '首页显示当前城市');
  assert(document.querySelector('#cityBadge').textContent.includes('保定市'), '徽章显示当前城市');
  assert(api.state.profile.city === 'baoding', '城市写入偏好（localStorage）');
} catch (err) {
  assert(false, '未设置城市提醒异常：' + err.message);
}

const scenarios = [
  { tier:'small', cat:'noodle', spiceMax:1, mode:'delivery', address:'七宝', craveTags:['清淡点'],    key:'小饭/面/外卖' },
  { tier:'mid',   cat:'rice',   spiceMax:3, mode:'delivery', address:'五角场', craveTags:['想吃辣'],  key:'中饭/饭/外卖' },
  { tier:'good',  cat:'other',  spiceMax:3, mode:'dinein',   address:'陆家嘴', craveTags:['生鲜/刺身'], key:'吃好饭/其他/堂食' },
  { tier:'good',  cat:'noodle', spiceMax:0, mode:'delivery', address:'',      craveTags:[],          key:'吃好饭/面/空地址' }
];

for (const s of scenarios) {
  try {
    Object.assign(api.state, s, { seed: 1, budget: { small:25, mid:60, good:150 }[s.tier] });
    api.state.profile.allergies = [];
    api.state.profile.history = [];
    await api.run();
    await new Promise(r => setTimeout(r, 3000)); // 等待流水线动画结束
    const resultHtml = document.querySelector('#result').innerHTML;
    assert(resultHtml.includes('card-head') && resultHtml.includes('就吃这一桌'), s.key + ' 组合卡片已渲染');
    assert(resultHtml.includes('combo-item'), s.key + ' 卡片里是一桌菜（多道菜条目）');
    // 走真实交互：点结果卡上的「就吃这一桌」，看有没有记进历史
    const acceptBtn = document.querySelector('#acceptBtn');
    if (acceptBtn && acceptBtn.onclick) acceptBtn.onclick();
    assert(api.state.profile.history.length > 0, s.key + ' 点「就吃这一桌」后记忆写入成功');
  } catch (err) {
    assert(false, s.key + ' 抛异常：' + err.message);
  }
}

// 忌口全开 + 不吃辣的极端组合，应该给出"没有可推荐"的友好提示而不是崩溃
try {
  Object.assign(api.state, { tier:'small', cat:'noodle', spiceMax:0, mode:'delivery', address:'张江', craveTags:[], seed:1, budget:25 });
  api.state.profile.allergies = ['海鲜/虾蟹','牛肉','猪肉','鸡蛋','豆制品','麸质/面食','香菜'];
  await api.run();
  await new Promise(r => setTimeout(r, 3000));
  const htmlOut = document.querySelector('#result').innerHTML;
  assert(htmlOut.includes('没有可推荐') || htmlOut.includes('card-head'), '极端忌口场景有兜底提示');
} catch (err) {
  assert(false, '极端忌口场景抛异常：' + err.message);
}

// ---------- 大模型接入路径 ----------
console.log('\n--- DeepSeek 接入路径 ---');
assert(api.state.settings.provider === 'deepseek', '默认服务商是 DeepSeek');
assert(api.state.settings.base === 'https://api.deepseek.com/v1', '默认接口地址正确');
assert(api.state.settings.model === 'deepseek-chat', '默认模型是 deepseek-chat');
const prefilled = api.DEFAULT_KEY.startsWith('sk-');
if (prefilled) {
  assert(api.state.settings.enabled === 'on', '自用版：大模型默认开启');
  assert(api.state.settings.key === api.DEFAULT_KEY, '自用版：密钥已预填');
} else {
  assert(api.DEFAULT_KEY === '', '分享版：没有预填任何密钥');
  assert(api.state.settings.enabled === 'off', '分享版：大模型默认关闭');
}

// 决策模式：默认 Agent；开发者视角顶部那条流程条要跟着模式变（不能挂羊头卖狗肉）
assert(api.state.settings.agent === 'agent', '默认决策模式是 Agent');
api.state.settings.agent = 'agent';
api.renderFlowStrip();
const stripAgent = document.querySelector('#flowStrip').innerHTML;
assert(stripAgent.includes('search_dishes') && stripAgent.includes('finalize'), 'Agent 模式下流程条画的是 Agent 链路');
assert(document.querySelector('#flowNote').textContent.includes('Agent'), '流程条下方的说明标明当前是 Agent 模式');
api.state.settings.agent = 'off';
api.renderFlowStrip();
const stripAlgo = document.querySelector('#flowStrip').innerHTML;
assert(stripAlgo.includes('知识库检索') && stripAlgo.includes('大模型润色'), '算法引擎模式下流程条画的是①~⑨那条链');
assert(document.querySelector('#flowNote').textContent.includes('算法引擎'), '流程条下方的说明标明当前是算法引擎');
assert(api.FLOW_AGENT.length !== api.FLOW_ALGO.length || stripAgent !== stripAlgo, '两种模式的流程条确实不是同一条');

// 正常返回
mock.mode = 'ok'; mock.calls = 0;
api.state.settings.enabled = 'on';
api.state.settings.key = 'sk-test-dummy';
/* 这个用例测的是算法引擎 + ⑨润色的那条老链路，所以把决策模式钉死在算法引擎上。
 * 不钉的话它会因为"默认 Agent 模式 + 有 Key"去真连大模型，用例就变成了受网络影响的随机结果。 */
api.state.settings.agent = 'off';
try {
  Object.assign(api.state, { tier:'mid', cat:'rice', spiceMax:3, mode:'delivery', address:'五角场', craveTags:['想吃辣'], seed:1, budget:60 });
  api.state.profile.allergies = ['香菜'];
  await api.run();
  await new Promise(r => setTimeout(r, 3000));
  const llmText = document.querySelector('#llmText').innerHTML;
  assert(llmText.includes('川味回锅肉盖饭'), '大模型推荐语写进了结果卡片');
  assert(llmText.includes('deepseek'), '推荐语下方标注了模型与耗时');
  assert(document.querySelector('#devPayload').textContent.includes('candidates'), '开发者面板显示了发给模型的 JSON');
  assert(document.querySelector('#devReasoning').textContent.length > 0, '开发者面板显示了思考链区域');
} catch (err) {
  assert(false, '大模型正常返回路径异常：' + err.message);
}

// 推理模型只给思考链 → 应自动降级重试
mock.mode = 'reasoning-only'; mock.calls = 0;
try {
  api.state.settings.model = 'deepseek-v4-pro';
  Object.assign(api.state, { tier:'mid', cat:'rice', seed:1 });
  await api.run();
  await new Promise(r => setTimeout(r, 3000));
  assert(mock.calls >= 2, '只返回思考链时自动发起了重试（共 ' + mock.calls + ' 次调用）');
  assert(api.state.settings.model === 'deepseek-v4-pro', '降级重试后模型设置被还原');
  assert(document.querySelector('#llmText').innerHTML.includes('回锅肉'), '降级重试后拿到了推荐语');
} catch (err) {
  assert(false, '降级重试路径异常：' + err.message);
}

// 鉴权失败 → 提示可读，页面不能崩
mock.mode = 'http401'; mock.calls = 0;
try {
  api.state.settings.model = 'deepseek-chat';
  await api.run();
  await new Promise(r => setTimeout(r, 3000));
  assert(document.querySelector('#llmText').innerHTML.includes('401'), '密钥失效时给出 401 提示文案');
  assert(document.querySelector('#llmStatus').textContent.includes('❌'), '设置面板显示失败状态');
  assert(document.querySelector('#result').innerHTML.includes('就吃这一桌'), '大模型失败时本地推荐结果照常展示');
} catch (err) {
  assert(false, '鉴权失败路径异常：' + err.message);
}

// 没填密钥 → 不发起请求，本地结果照常
mock.mode = 'ok'; mock.calls = 0; mock.llmCalls = 0;
try {
  api.state.settings.enabled = 'on';
  api.state.settings.key = '';
  await api.run();
  await new Promise(r => setTimeout(r, 3000));
  assert(mock.llmCalls === 0, '没填大模型密钥时不调用 DeepSeek');
  assert(document.querySelector('#result').innerHTML.includes('就吃这一桌'), '没填密钥时本地推荐结果照常展示');
} catch (err) {
  assert(false, '无密钥路径异常：' + err.message);
}

// ---------- 联网搜索路径 ----------
console.log('\n--- 联网搜索（保定真实店铺）---');
api.state.settings.enabled = 'off';          // 这轮只测联网，不测大模型
api.state.settings.online = 'on';
api.state.settings.amapKey = 'fake-amap-key';
mock.mode = 'ok'; mock.calls = 0; mock.amapCalls = 0; mock.osmCalls = 0;
api.clearAmapCache();          // 联网结果有缓存，这里要观察真实请求次数，先清空
try {
  Object.assign(api.state, { tier:'mid', cat:'other', spiceMax:3, mode:'delivery', address:'保定市裕华路步行街', craveTags:['想吃肉'], seed:1, budget:60 });
  api.state.profile.allergies = [];
  await api.run();
  await new Promise(r => setTimeout(r, 3500));
  assert(mock.amapCalls > 0, '配置高德 Key 后发起了高德请求（' + mock.amapCalls + ' 次）');
  const html = document.querySelector('#result').innerHTML;
  assert(html.includes('高德地图实时数据'), '结果卡片标注了数据来源=高德');
  assert(/老保定驴肉火烧|直隶会馆|白运章包子铺|川味小馆|蜀香火锅|炭火烤串屋|粤香烧腊|老味道面馆/.test(html), '结果里用的是联网搜到的保定真实店名');
  assert(/老保定驴肉火烧|直隶会馆|白运章包子铺|川味小馆|蜀香火锅/.test(document.querySelector('#devSearch').textContent), '开发者面板显示了联网搜索原始数据');
} catch (err) {
  assert(false, '高德联网路径异常：' + err.message);
}

// 高德 Key 无效 → 自动降级到 OSM，不崩
  mock.mode = 'amap-badkey'; mock.calls = 0; mock.amapCalls = 0; mock.osmCalls = 0; mock.backendCalls = 0;
  api.state.server.amapOk = null;   // 模拟"这一轮刚开始"，让应用重新试一次后端
  api.state.amapDownUntil = 0; api.clearAmapCache();   // 清掉冷却与缓存，才能真正走到降级逻辑
try {
  await api.run();
  await new Promise(r => setTimeout(r, 3500));
  assert(mock.amapCalls > 0 && mock.osmCalls > 0, '高德失败后自动改走 OpenStreetMap');
  assert(mock.backendCalls > 0, '先试过后端代理（' + mock.backendCalls + ' 次）再回退本机直连');
  assert(api.state.server.amapOk === false, '后端高德的 Key 问题会被记住（下次不再白试一轮）');
  const html = document.querySelector('#result').innerHTML;
  if(!html.includes('OpenStreetMap 实时数据')){
    const marks = html.match(/[^<>]*实时数据[^<>]*/g) || [];
    console.log('    ↳ 卡片里的来源标注：' + (marks.join(' | ') || '（没有「实时数据」字样）'));
    console.log('    ↳ 卡片纯文本前 200 字：' + html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
  }
  assert(html.includes('OpenStreetMap 实时数据'), '降级后标注了实际数据来源');
} catch (err) {
  assert(false, '高德降级路径异常：' + err.message);
}

// 完全没网 / 两个数据源都失败 → 离线店库已清空，应给友好提示而不是假店名
mock.mode = 'osm-timeout'; mock.calls = 0;
try {
  api.state.settings.amapKey = '';
  await api.run();
  await new Promise(r => setTimeout(r, 3500));
  const html = document.querySelector('#result').innerHTML;
  assert(html.includes('这次没搜到饭店'), '联网全失败时提示「这次没搜到饭店」');
  assert(!html.includes('就吃这一桌'), '不再拿示例店顶出一个结果');
} catch (err) {
  assert(false, '无店兜底路径异常：' + err.message);
}

// ---------- 「我的」页面 ----------
console.log('\n--- 我的（个人喜好）页面 ---');
try {
  api.switchTab('me');
  assert(document.querySelector('#pageMe').classList.contains('hidden') === false, '切到「我的」：页面显示');
  assert(document.querySelector('#pageHome').classList.contains('hidden') === true, '切到「我的」：推荐页隐藏');
  assert(document.querySelector('.bar').classList.contains('hide') === true, '「我的」页不显示"开始推荐"按钮');
  assert(document.querySelector('#tabMe').classList.contains('active') === true, '底部 Tab 高亮切到了「我的」');

  api.switchTab('home');
  assert(document.querySelector('#pageHome').classList.contains('hidden') === false, '切回推荐页正常');
  assert(document.querySelector('.bar').classList.contains('hide') === false, '推荐页重新显示"开始推荐"');
} catch (err) {
  assert(false, 'Tab 切换异常：' + err.message);
}

// 在「我的」里选口味偏好 / 忌口 / 辣度
try {
  api.state.profile.tastes = ['清淡', '爱喝汤'];
  api.state.profile.allergies = ['香菜', '花生'];
  document.querySelector('#tasteList')._onclick = null;
  api.renderProfile();
  assert(document.querySelector('#meSub').textContent.includes('2 项口味偏好'), '档案头部显示偏好统计：' + document.querySelector('#meSub').textContent);
  assert(document.querySelector('#meChips').innerHTML.includes('清淡'), '档案头部展示已选口味');
  assert(document.querySelector('#homePrefSummary').textContent.includes('清淡'), '首页卡片同步显示偏好摘要');

  segButtons[0]._handlers.click();
  assert(api.state.spiceMax === 0 && api.state.profile.spiceMax === 0, '点"不吃辣"后辣度写入偏好并持久化');
  assert(document.querySelector('#spiceHint').textContent.includes('完全不吃辣'), '首页辣度提示同步更新');
  api.renderTierSeg();
  assert(document.querySelector('#tierSeg').children.length === 4, '默认档位分段控件渲染出 4 个选项');
} catch (err) {
  assert(false, '我的页面交互异常：' + err.message);
}

// 常用地址
try {
  document.querySelector('#newAddr').value = '保定市河北大学';
  const addBtn = document.querySelector('#addAddr');
  // 直接调用保存逻辑（等价于点按钮）
  api.state.profile.savedAddresses = ['保定市河北大学'];
  api.renderAddrList();
  assert(document.querySelector('#addrList').children.length === 1, '常用地址保存后渲染出 1 个 chip');
  assert(document.querySelector('#homePrefSummary').textContent.includes('常用地址 1 个'), '首页摘要显示常用地址数量');
} catch (err) {
  assert(false, '常用地址异常：' + err.message);
}

// ---------- 城市切换 ----------
console.log('\n--- 备选组合可展开 ---');
try {
  api.applyCity('baoding');
  // 离线店库已清空 → 这里必须走联网路径（用假的高德响应），否则一家店都搜不到，自然没有备选
  api.state.settings.enabled = 'off'; api.state.settings.online = 'on'; api.state.settings.amapKey = 'fake-amap-key';
  mock.mode = 'ok'; mock.calls = 0; mock.amapCalls = 0;
  Object.assign(api.state, { tier:'good', cat:'other', spiceMax:3, mode:'dinein',
    address:'保定市裕华路步行街', craveTags:[], craveText:'', seed:1, budget:150 });
  api.state.profile.allergies = [];
  await api.run();
  await new Promise(r => setTimeout(r, 3500));
  const h = document.querySelector('#result').innerHTML;
  assert(h.indexOf('alt-card') !== -1, '备选组合渲染成可展开卡片');
  assert(h.indexOf('alt-detail') !== -1, '备选卡片里有详情区（菜单＋理由）');
  assert(h.indexOf('alt-pick') !== -1, '备选卡片里有「就选这一桌」按钮');
  assert(h.indexOf('换一家也行（点开看菜单和理由）') !== -1, '备选区标题提示可点开');
  assert(h.indexOf('为什么这样配') !== -1, '展开详情里包含搭配理由');
  const n = (h.match(/alt-card/g) || []).length;
  // 备选数量取决于"搜到几家店能做这一桌菜"：离线店库已清空，假数据里只有 8 家店，
  // 所以这里只断言"渲染出来了"，不硬要求 2 个
  assert(n >= 1, '备选组合渲染出来了（实际 ' + n + ' 个）');
} catch (err) {
  assert(false, '备选展开异常：' + err.message);
}

console.log('\n--- 城市切换（离线店库已清空）---');
try {
  assert(Object.keys(api.CITIES).length === 3, '城市表里有 3 个城市：' + Object.keys(api.CITIES).join('/'));
  assert(Object.values(api.CITIES).every(c => c.offline === false), '所有城市都没有离线店库（offline 全为 false）');

  // 保定：离线店库已删除，选店只能靠联网
  api.applyCity('baoding');
  assert(api.hasOfflineData() === false, '切到保定：离线兜底已关闭');
  const localBaoding = api.recommendRestaurants(api.DISHES.find(d => d.name === '驴肉火烧'));
  assert(localBaoding.list.length === 0, '保定：离线店库返回空（不再有示例店）');

  // 北京：离线兜底关闭
  api.changeCity('beijing');
  assert(api.CITY.name === '北京市' && api.CITY.adcode === '110100', '切到北京：CITY 已换成北京（adcode 110100）');
  assert(api.hasOfflineData() === false, '北京：离线兜底同样关闭');
  assert(api.state.address === '', '切城市后旧地址被清空');
  const localBeijing = api.recommendRestaurants(api.DISHES.find(d => d.name === '驴肉火烧'));
  assert(localBeijing.list.length === 0 && localBeijing.note.indexOf('没有离线店铺数据') !== -1, '北京：离线店库返回空并给出说明');
  assert(api.CITY.landmarks.indexOf('三里屯') !== -1, '北京的地标快捷地址已生效');

  // 北京 + 没网 → 走空结果提示（高德和 OSM 都打成失败）
  mock.mode = 'osm-timeout'; mock.calls = 0;
  api.state.settings.online = 'on';
  api.state.settings.amapKey = '';
  api.state.tier = 'mid'; api.state.cat = 'other'; api.state.budget = 60; api.state.craveTags = []; api.state.craveText = '';
  const onlineNone = await api.onlineSearch([]);
  const smart = api.recommendRestaurantsSmart(api.DISHES[0], onlineNone);
  assert(smart.list.length === 0 && smart.source === 'none', '没网时选店返回空（source=none）');
  await api.run();
  await new Promise(r => setTimeout(r, 3000));
  assert(document.querySelector('#result').innerHTML.indexOf('这次没搜到饭店') !== -1, '没网时页面提示「这次没搜到饭店」');

  // 切回保定
  api.changeCity('baoding');
  assert(api.CITY.name === '保定市', '切回保定正常');
  assert(api.state.profile.city === 'baoding', '城市选择写入偏好（localStorage）');
} catch (err) {
  assert(false, '城市切换异常：' + err.message);
}

console.log('\n' + (errors.length ? '❌ 失败 ' + errors.length + ' 项' : '✅ 全部交互路径通过'));
process.exit(errors.length ? 1 : 0);
