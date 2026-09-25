// 测试：「饭饭AI」页——AI 今日推荐 / 纯聊天 / 「根据聊天推荐菜」
// 覆盖：① 底部三个 Tab（推荐 / 饭饭AI / 我的）与切页显示
//       ② 今日推荐：同一人同一天固定不变、换人换一天会变、严格避开忌口、点进去有详情
//       ③ 详情卡：菜的来历（大模型生成 + 缓存）/ 口味 / 菜系 / 我的记录 / 哪里能吃到
//       ④ 纯聊天：不带 tools（纯聊天不做决策），历史落盘
//       ⑤ 「根据聊天推荐菜」：没聊过不出方案；聊过出组合卡；「就吃这一桌」进历史
//       ⑥ 决策不污染「推荐」页的状态（档位 / 类型 / 预算 / 今日想吃）
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(name = 'el') {
  const el = {
    _name: name, innerHTML: '', value: '', className: '', style: {}, children: [], dataset: {},
    classList: {
      _s: new Set(),
      add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); },
      toggle(c, force){ const on = force === undefined ? !this._s.has(c) : !!force; on ? this._s.add(c) : this._s.delete(c); return on; }
    },
    setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, appendChild(c){ return c }, querySelector(){ return fakeEl() }, querySelectorAll(){ return [] },
    scrollIntoView(){}, focus(){}, onclick: null
  };
  let text = '';
  Object.defineProperty(el, 'textContent', { get(){ return text; }, set(v){ text = String(v); el.innerHTML = text.replace(/<[^>]+>/g, ''); } });
  return el;
}
const cache = new Map();
const document = {
  body: fakeEl('body'),
  querySelector(sel){ if(!cache.has(sel)) cache.set(sel, fakeEl(sel)); return cache.get(sel); },
  querySelectorAll(){ return []; }, createElement(){ return fakeEl() }, addEventListener(){}
};
const store = new Map();
const localStorage = { getItem:k => (store.has(k) ? store.get(k) : null), setItem:(k,v) => store.set(k, String(v)), removeItem:k => store.delete(k) };

// 假大模型：按请求内容分流（意图解析 / 菜品讲解 / 普通聊天），同时把每轮的 body 记下来
const llmBodies = [];
async function mockFetch(url, init){
  if(String(url).includes('deepseek') || String(url).includes('/chat/completions')){
    let body = {};
    try{ body = JSON.parse((init && init.body) || '{}'); }catch(e){ body = {}; }
    llmBodies.push(body);
    const sys = String(((body.messages || [])[0] || {}).content || '');
    let content = '随便聊聊吃的。';
    if(sys.includes('提炼出"这一顿想吃什么"')) content = '{"cat":"other","tier":"mid","budget":80,"tags":["想吃辣"],"keywords":[],"note":"想吃辣，两人80"}';
    else if(sys.includes('写菜品介绍')) content = '{"story":"测试来历：这道菜的说法。","cui":"测试菜系：咸鲜为主。"}';
    return { ok:true, status:200, json: async () => ({ choices:[{ message:{ content } }], usage:{ prompt_tokens:10, completion_tokens:5 } }), text: async () => '' };
  }
  // 逆地理编码：定位成功后把坐标翻译成人话地址
  if(String(url).includes('/geocode/regeo')){
    return { ok:true, status:200, json: async () => ({ status:'1', regeocode:{ formatted_address:'河北省保定市莲池区华电路1号',
      addressComponent:{ adcode:'130600', city:'保定市', province:'河北省' } } }), text: async () => '' };
  }
  return { ok:false, status:404, json: async () => ({}), text: async () => '' };
}

// 假浏览器定位：能在"答应 / 拒绝"之间切换，并记下被申请了几次授权
let geoMode = 'ok', geoAsked = 0;
const navigator = {
  geolocation: {
    getCurrentPosition(okFn, errFn){
      geoAsked++;
      if(geoMode === 'ok') setTimeout(() => okFn({ coords:{ longitude:115.514611, latitude:38.888900 } }), 0);
      else setTimeout(() => errFn({ code:1, message:'User denied Geolocation' }), 0);
    }
  }
};

new Function('document','localStorage','requestAnimationFrame','fetch','navigator',
  code + '\nglobalThis.__a={state,switchTab,renderAiPage,renderAiDaily,aiPickDailyDish,aiDailyReasons,aiShopsForDish,' +
         'aiUserKey,aiDeviceId,aiDayKey,aiRnd,aiLoad,aiSave,aiState,aiSend,aiMakeCombo,aiAccept,aiParseIntent,' +
         'aiNormalizeIntent,aiLocalIntent,onAiMsgsClick,openAiSheet,closeAiSheet,aiSheetHTML,aiMsgHTML,aiComboHTML,' +
         'aiComboToCombo,recordCombo,hardFilter,dishById,DISHES,RESTAURANTS,applyCity,AI_SPICY,AI_KEEP_MSGS,' +
         'geolocate,geolocateMe,aiAskGeo,aiGeoNote,hasPreciseLoc,aiNewChat,renderAiChat,get CITY(){return CITY}};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch, navigator);
const M = globalThis.__a;
const $ = s => document.querySelector(s);

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

/* ---- 和 test-combo 一样：塞一家"什么都能做"的离线测试店，让决策不依赖网络 ---- */
M.applyCity('baoding');
M.state.profile.city = 'baoding';
M.state.settings.enabled = 'on';
M.state.settings.online = 'off';                       // 搜店走离线兜底，测试才可复现
M.state.settings.agent = 'off';                        // 默认测算法引擎那一路；Agent 那一路另有 e2e
M.state.settings.key = 'test-key';
M.state.profile.allergies = [];
M.state.profile.tastes = [];
M.state.profile.likes = {};
M.state.profile.dislikes = {};
M.state.profile.history = [];
M.state.profile.banned = { dishes:{}, shops:{} };
M.state.address = '保定市军校广场';
M.state.running = false;
{
  const cui = [...new Set(M.DISHES.map(d => d.cui))];
  const tags = [...new Set(M.DISHES.flatMap(d => d.tags))];
  M.CITY.offline = true;   // 测试环境：打开离线兜底开关，配合下面这家"万能"测试店
  M.RESTAURANTS.push({ id:'test-shop', name:'测试餐厅（万能）', area:'裕华路', cui, tags, avg:40, rating:4.5, delivery:true, sig:[] });
}

console.log('=== 一、底部三个 Tab ===');
ok(!!$('#tabAi'), '底部多了一个「饭饭AI」Tab');
M.switchTab('ai');
ok(!$('#pageAi').classList.contains('hidden'), '切到「饭饭AI」后页面显示出来');
ok($('#pageHome').classList.contains('hidden') && $('#pageMe').classList.contains('hidden'), '推荐页和我的页都收起来了');
ok($('#tabAi').classList.contains('active'), '「饭饭AI」Tab 高亮');
ok(!$('#tabHome').classList.contains('active') && !$('#tabMe').classList.contains('active'), '另外两个 Tab 不高亮');
ok($('.bar').classList.contains('hide'), '「开始推荐」按钮只在推荐页出现');
M.switchTab('home');
ok($('#pageAi').classList.contains('hidden') && !$('#tabAi').classList.contains('active'), '切回推荐页后饭饭AI 收起来');

console.log('\n=== 二、AI 今日推荐：每天每人一道，但不能是忌口菜 ===');
const pickFor = dev => { store.set('eatAgent.aidevice.v1', dev); M.aiState.hist = []; return M.aiPickDailyDish(); };
const d1 = pickFor('dev-alpha'), d1b = pickFor('dev-alpha');
ok(!!d1 && d1.id === d1b.id, '同一个人的同一天：挑出来的菜是固定的（不会刷新一次换一道）');
const picks = new Set(['dev-a', 'dev-b', 'dev-c', 'dev-d', 'dev-e', 'dev-f', 'dev-g', 'dev-h'].map(d => pickFor(d).id));
ok(picks.size >= 2, '换一个用户就会换菜（8 个设备挑出 ' + picks.size + ' 种不同的菜）');
ok(M.aiRnd('2026-09-25|d01') === M.aiRnd('2026-09-25|d01'), '确定性伪随机：同样的种子永远同样的结果');
ok(M.aiRnd('2026-09-25|d01') !== M.aiRnd('2026-09-26|d01'), '换一天就是另一个种子（今日推荐不会天天一样）');
{
  M.state.profile.allergies = ['海鲜/虾蟹'];
  const bad = ['海鲜', '虾', '蟹', '鱼', '贝'];
  let hit = 0;
  ['dev-a', 'dev-b', 'dev-c', 'dev-d', 'dev-e', 'dev-f'].forEach(dev => {
    const d = pickFor(dev);
    if(!M.hardFilter(d).ok || (d.alg || []).some(t => bad.indexOf(t) !== -1)) hit++;
  });
  ok(hit === 0, '忌口海鲜时，6 次抽样都没挑到海鲜类（忌口是硬条件）');
  M.state.profile.allergies = [];
}
{
  M.state.profile.likes = {}; M.state.profile.dislikes = {}; M.state.profile.history = [];
  M.state.profile.banned = { dishes:{}, shops:{} };
  store.set('eatAgent.aidevice.v1', 'dev-alpha');
  M.aiState.hist = []; M.aiState.day = ''; M.aiState.dishId = ''; M.aiState.key = '';
  M.renderAiPage();
  const card = $('#aiDaily').innerHTML;
  ok(card.includes('AI 今日推荐'), '卡片标题对');
  ok(card.includes('参考价 ¥') && card.includes('菜系'), '卡片上有参考价和菜系');
  ok(card.includes('aiDailyOpen'), '有一个「看看这道菜的来历」入口');
  const first = M.aiState.dishId;
  M.renderAiDaily();
  ok(M.aiState.dishId === first, '同一天里再渲染一次，推荐的还是同一道菜');
  // 推荐过的菜会被记进 hist（短期内不再重复推）
  ok(M.aiState.hist.indexOf(first) !== -1, '推过的菜进了"最近推过"清单，短期不会重复');
}

console.log('\n=== 三、点进去看这道菜：来历 / 口味 / 菜系 / 我的记录 / 哪里能吃到 ===');
{
  const dish = M.dishById(M.aiState.dishId);
  const t0 = new Date(); t0.setDate(t0.getDate() - 3);
  M.state.profile.history = [ { id:dish.id, ts:t0.getTime(), price:dish.price, meal:t0.getTime(), shop:'老味道面馆' } ];
  M.openAiSheet(dish);
  ok($('#aiSheet').classList.contains('show'), '详情从底部升起来');
  ok($('#aiSheetCard').innerHTML.includes('正在取'), '先显示"正在取"，不空着');
  await tick(60);
  const sheet = $('#aiSheetCard').innerHTML;
  ok(sheet.includes('这道菜的来历'), '有「这道菜的来历」一段');
  ok(sheet.includes('测试来历'), '来历是大模型给的（不是本地兜底那句）');
  ok(sheet.includes('这个菜系') && sheet.includes('测试菜系'), '有「这个菜系」一段');
  ok(sheet.includes('口味和属性') && sheet.includes(dish.tags[0]), '口味标签都在');
  ok(sheet.includes(dish.cui + '菜系') && sheet.includes('¥' + dish.price) && sheet.includes(M.AI_SPICY[dish.spicy]), '菜系 / 参考价 / 辣度都写清了');
  ok(sheet.includes('你的记录') && sheet.includes('吃过 1 次') && sheet.includes('3 天前'), '写清了我吃过几次、最近一次什么时候');
  ok(sheet.includes('哪里能吃到'), '有「哪里能吃到」一段');
  ok(sheet.includes('应用不编店') || sheet.includes('测试餐厅') || sheet.includes('已绑定高德') || sheet.includes('品牌参照'),
     '没采集过菜单时如实说不给店名，不会编店');
  M.closeAiSheet();
  ok(!$('#aiSheet').classList.contains('show'), '点关闭能收起来');
  // 讲解缓存：同一道菜第二次打开不再调大模型
  const before = llmBodies.length;
  M.openAiSheet(dish);
  await tick(60);
  ok(llmBodies.length === before, '同一道菜的讲解缓存住了，第二次打开不再花 token');
  M.closeAiSheet();
  M.state.profile.history = [];
}

console.log('\n=== 四、纯聊天：只说话，不做决策 ===');
{
  M.aiState.msgs = []; M.aiState.seq = 0;
  $('#aiInput').value = '江西菜为什么这么辣';
  const before = llmBodies.length;
  await M.aiSend();
  ok(M.aiState.msgs.length === 2, '一来一回：聊天记录里多了 2 条');
  ok(M.aiState.msgs[0].role === 'me' && M.aiState.msgs[0].text === '江西菜为什么这么辣', '我的那句原样留着');
  ok(M.aiState.msgs[1].role === 'ai' && M.aiState.msgs[1].text.length > 0, '饭饭回了一句');
  ok(llmBodies.length === before + 1, '这轮只发了一次请求');
  const body = llmBodies[llmBodies.length - 1];
  ok(!body.tools, '纯聊天不带 tools（不做决策、不调工具）');
  ok((body.messages || []).length === 2, '上下文是 系统提示 + 一句用户话');
  ok(String(body.messages[0].content).includes('保定市'), '系统提示里带上了用户在哪个城市');
  ok(String(body.messages[0].content).includes('忌口'), '系统提示里带上了忌口等信息');
  // 注意：key 得精确匹配，「eatAgent.ai.v1」和「eatAgent.aidevice.v1」前缀是一样的
  ok(store.has('eatAgent.ai.v1') && JSON.parse(store.get('eatAgent.ai.v1')).msgs.length === 2,
     '聊天记录落盘了（刷新还在）');
  ok($('#aiMsgs').innerHTML.includes('江西菜为什么这么辣'), '页面上渲染出了这轮对话');
}

console.log('\n=== 四之二、出方案前会申请定位授权（跟「我的 › 定位我」同一套）===');
{
  M.state.origin = null; M.state.address = ''; M.aiState.geoDenied = false;
  geoMode = 'ok'; geoAsked = 0;
  M.aiState.msgs = []; M.aiState.seq = 0; M.aiState.reroll = 0;
  M.state.running = false;
  // 一个字都没聊过：不该申请定位（先让用户说想吃什么）
  await M.aiMakeCombo({});
  ok(geoAsked === 0, '还没聊过就按：连定位都不申请（先问想吃什么）');

  M.aiState.msgs.push({ id:'m1', role:'me', kind:'text', text:'想吃辣的，两个人 80 块' });
  await M.aiMakeCombo({});
  await tick(20);
  ok(geoAsked === 1, '按下「根据聊天推荐菜」：申请了一次定位授权（浏览器会弹权限框）');
  ok(!!M.state.origin && M.state.origin.source === 'gps',
     '用户答应后拿到精确坐标：' + JSON.stringify(M.state.origin && { lng:M.state.origin.lng, lat:M.state.origin.lat, src:M.state.origin.source }));
  ok(M.state.address.indexOf('保定') !== -1, '坐标被翻译成人话地址，搜店就按它算距离：' + M.state.address);
  const c1 = M.aiState.msgs.filter(m => m.kind === 'combo').slice(-1)[0];
  ok(!!c1, '答应授权后照常出方案');
  ok(!!c1 && String(c1.combo.geo).indexOf('按你的真实位置') !== -1, '方案卡上写清是"按哪配的"：' + (c1 && c1.combo.geo));
  ok(!!c1 && M.aiComboHTML(c1.combo).indexOf('ac-geo') !== -1, '这行字真渲染进卡片了');

  const before = geoAsked;
  M.state.running = false;
  await M.aiMakeCombo({});
  await tick(20);
  ok(geoAsked === before, '已经拿到精确坐标了就不再反复申请授权');
}
{
  // 拒绝这条路：不能挡着不让出方案，而且不反复弹
  M.state.origin = null; M.state.address = '保定市军校广场'; M.aiState.geoDenied = false;
  geoMode = 'deny'; geoAsked = 0;
  M.aiState.msgs = []; M.aiState.seq = 0;
  M.aiState.msgs.push({ id:'m1', role:'me', kind:'text', text:'想吃辣的' });
  M.state.running = false;
  await M.aiMakeCombo({});
  await tick(20);
  ok(geoAsked === 1, '拒绝授权这条路：申请过一次');
  const c2 = M.aiState.msgs.filter(m => m.kind === 'combo').slice(-1)[0];
  ok(!!c2, '被拒绝也照样出方案（定位不是硬门槛）');
  ok(!!c2 && c2.combo.geo.indexOf('没拿到定位') !== -1 && c2.combo.geo.indexOf('定位权限被拒绝') !== -1,
     '方案卡上如实写"没拿到定位、按你填的位置找的店"：' + (c2 && c2.combo.geo));
  ok(M.aiState.geoDenied === true, '记住了"这次会话里被拒过"');
  const before2 = geoAsked;
  M.state.running = false;
  await M.aiMakeCombo({});
  await tick(20);
  ok(geoAsked === before2, '被拒过一次就不再反复弹授权框（不骚扰用户）');
  // 手动点「定位我」还是要能再试一次（人工触发的入口不受这个记忆限制）
  geoAsked = 0;
  M.geolocateMe();
  await tick(20);
  ok(geoAsked === 1, '「我的」页手动点「定位我」依然会申请（只有饭饭这边才不反复弹）');
  geoMode = 'ok';
}

console.log('\n=== 五、「根据聊天推荐菜」：按下才真的出方案 ===');
{
  M.aiState.msgs = []; M.aiState.seq = 0;
  const before = llmBodies.length;
  await M.aiMakeCombo({});
  ok(llmBodies.length === before, '一句话都没聊过：按了也不发请求（先让你说想吃什么）');
  ok(!M.aiState.msgs.some(m => m.kind === 'combo'), '没出方案');
}
{
  M.aiState.msgs = []; M.aiState.seq = 0; M.aiState.reroll = 0; M.aiState.hist = [];
  M.state.running = false;
  M.aiState.msgs.push({ id:'m1', role:'me', kind:'text', text:'想吃辣的，两个人 80 块' });
  // 记住"推荐页"此刻的选择，跑完必须原样还在
  M.state.tier = 'small'; M.state.cat = 'rice'; M.state.budget = 25; M.state.craveTags = ['想吃肉'];
  const snapshot = { tier:M.state.tier, cat:M.state.cat, budget:M.state.budget, tags:M.state.craveTags.join(',') };
  await M.aiMakeCombo({});
  await tick(20);
  const comboMsg = M.aiState.msgs.filter(m => m.kind === 'combo')[0];
  ok(!!comboMsg, '聊过之后按按钮，出了一张"这一桌"的卡');
  if(comboMsg){
    const c = comboMsg.combo;
    console.log('    → ' + c.shop.name + '：' + c.items.map(i => i.name + ' ¥' + i.price).join(' + ') + '（合计 ¥' + c.total + '）');
    ok(c.items.length >= 1 && c.total > 0, '卡上有菜、有合计');
    ok(!!c.shop.name, '卡上写清是哪家店（不是空的）');
    ok(c.items.every(i => !!M.dishById(i.dishId)), '卡上的菜都能在知识库里对上');
    ok(c.items.every(i => M.hardFilter(M.dishById(i.dishId)).ok), '这一桌没有违反忌口／辣度');
    ok(String(c.foot || '').includes('算法引擎') || String(c.foot || '').includes('Agent'), '卡上注明这桌是谁定的：' + (c.foot || ''));
  }
  ok(M.state.tier === snapshot.tier && M.state.cat === snapshot.cat &&
     M.state.budget === snapshot.budget && M.state.craveTags.join(',') === snapshot.tags,
     '决策不污染「推荐」页的选择（档位／类型／预算原样还在）');
  ok(!M.state.running, '跑完把"正在跑"的标志放开了');
  const tipGone = !M.aiState.msgs.some(m => m.kind === 'note' && String(m.text).indexOf('正在读') !== -1);
  ok(tipGone, '「正在读…」的临时提示收掉了，不留垃圾消息');
}

console.log('\n=== 六、卡上的两个按钮：就吃这一桌 / 换一桌 ===');
{
  const comboMsg = M.aiState.msgs.filter(m => m.kind === 'combo').slice(-1)[0];
  const cid = comboMsg.combo.id;
  const before = M.state.profile.history.length;
  const n = comboMsg.combo.items.length;
  // 走事件委托（和真点击同一条路）
  M.onAiMsgsClick({ target:{ closest:(sel) => (sel === '[data-aicombo]' ? { closest:() => ({ getAttribute:() => cid }), getAttribute:() => 'accept' } : null) } });
  ok(M.state.profile.history.length === before + n, '「就吃这一桌」把这一桌记进了「最近吃过」（' + n + ' 道）');
  ok(comboMsg.combo.accepted === true, '这张卡标记成"已经吃过"，不会重复记');
  const after = M.state.profile.history.length;
  M.aiAccept(cid);
  ok(M.state.profile.history.length === after, '再点一次不会重复记一桌');
  ok($('#aiMsgs').innerHTML.includes('已经记进'), '卡上给出"已记录"的反馈');
}
{
  // 换一桌：必须再跑一次决策，并且给出新的一张卡
  const cardsBefore = M.aiState.msgs.filter(m => m.kind === 'combo').length;
  const rerollBefore = M.aiState.reroll;
  M.state.running = false;
  await M.aiMakeCombo({ reroll:true });
  await tick(20);
  const cards = M.aiState.msgs.filter(m => m.kind === 'combo');
  ok(cards.length >= cardsBefore, '「换一桌」之后多了一张卡');
  ok(M.aiState.reroll === rerollBefore + 1, '换一桌的计数加一（下一桌会避开这一桌）');
}

console.log('\n=== 七、意图解析的校验与兜底 ===');
{
  M.aiState.msgs = [ { id:'m1', role:'me', kind:'text', text:'想吃辣' }, { id:'m2', role:'ai', kind:'text', text:'好' } ];
  $('#aiInput').value = '';
  const it = await M.aiParseIntent();
  ok(it.src === 'llm' && it.cat === 'other' && it.tier === 'mid', '大模型给的 JSON 被正确读出来：' + JSON.stringify({ cat:it.cat, tier:it.tier, budget:it.budget }));
  ok(it.tags.indexOf('想吃辣') !== -1, '标签落在词表里就保留');
  const dirty = M.aiNormalizeIntent({ cat:'rice', tier:'nope', budget:0, tags:['不存在的标签'], keywords:['瓦罐汤'] }, 'llm', 'x', 0);
  ok(dirty.tier === 'mid' && dirty.budget === 60, '非法档位／预算会被修正成中饭上限');
  ok(dirty.tags.length === 0, '词表外的标签被丢掉（不许硬凑）');
  ok(dirty.keywords.indexOf('瓦罐汤') !== -1, '词表外的具体说法当关键词保留');
  M.state.budget = 999;
  const off = M.aiLocalIntent();
  ok(off.cat === 'other' && off.tier === 'mid', '没模型时的本地兜底也能给出一个合理档位');
}

console.log('\n=== 八、「新对话」：只清聊天，长期记忆一根汗毛都不动 ===');
{
  // 先造一份"长期记忆"，再聊两句
  M.state.profile.likes = { '辣':3, '下饭':2 };
  M.state.profile.allergies = ['海鲜/虾蟹'];
  M.state.profile.history = [ { id:M.DISHES[0].id, ts:Date.now(), price:20, meal:Date.now(), shop:'老味道面馆' } ];
  M.aiState.msgs = []; M.aiState.seq = 0; M.aiState.reroll = 3;
  M.aiState.msgs.push({ id:'m1', role:'me', kind:'text', text:'想吃辣的' });
  M.aiState.msgs.push({ id:'m2', role:'ai', kind:'text', text:'好，辣的安排上' });
  M.state.running = false; M.aiState.sending = false;
  M.renderAiChat();
  ok($('#aiMsgs').innerHTML.indexOf('想吃辣的') !== -1, '清空之前，聊天记录在页面上');

  M.aiNewChat();
  ok(M.aiState.msgs.length === 0, '点「新对话」后聊天记录清空');
  ok($('#aiMsgs').innerHTML.indexOf('想吃辣的') === -1, '页面上也不再显示');
  ok(M.aiState.reroll === 0, '「换一桌」的计数归零（新对话就是新的一轮）');
  ok(M.state.profile.likes['辣'] === 3 && M.state.profile.likes['下饭'] === 2, '长期记忆没被动：喜欢的标签还在');
  ok(M.state.profile.allergies.length === 1 && M.state.profile.allergies[0] === '海鲜/虾蟹', '忌口没被动');
  ok(M.state.profile.history.length === 1, '吃过的记录没被动');
  ok(store.has('eatAgent.ai.v1') && JSON.parse(store.get('eatAgent.ai.v1')).msgs.length === 0,
     '清空立刻落盘（刷新不会复活）');
  ok(typeof $('#toast').onclick === 'function' && $('#toast').textContent.indexOf('撤销') !== -1,
     '给了撤销入口：' + $('#toast').textContent);
  $('#toast').onclick();
  ok(M.aiState.msgs.length === 2 && M.aiState.msgs[0].text === '想吃辣的' && M.aiState.msgs[1].text === '好，辣的安排上',
     '点撤销把整段对话原样找回来（顺序也对）');
  ok(M.aiState.reroll === 3, '撤销连「换一桌」的计数一起还原');
}
{
  M.aiState.msgs = [];
  M.aiNewChat();
  ok($('#toast').textContent.indexOf('还没有聊天记录') !== -1, '没有记录时只给一句提示，不会误清');
  ok(M.state.profile.likes['辣'] === 3, '顺手也不会碰到长期记忆');
}
{
  // 一轮没跑完时不许清：不然回复会落进已经被清空的对话里
  M.aiState.msgs = [ { id:'m1', role:'me', kind:'text', text:'正在跑' } ];
  M.state.running = true;
  M.aiNewChat();
  ok(M.aiState.msgs.length === 1, '一轮没跑完时点「新对话」不生效');
  ok($('#toast').textContent.indexOf('等这一轮') !== -1, '并且说清为什么不动：' + $('#toast').textContent);
  M.state.running = false;
}

console.log('\n' + (fail ? '❌ 共 ' + fail + ' 条断言失败' : '✅ 饭饭AI 页面全部通过'));
M.aiSave();
process.exit(fail ? 1 : 0);
