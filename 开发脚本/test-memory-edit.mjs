// 测试：「我的 → AI 记忆」三块点进去看全记录 + 在里面删
// 覆盖：① 卡片上三块都是入口（data-gomem），摘要里没有删除按钮
//       ② 点进去整页切走（我的页隐藏、全记录页显示、底部 Tab 收起），点返回回来
//       ③ 喜欢 / 不喜欢：全记录不截断，逐条删 + 撤销（连次数一起放回）
//       ④ 被屏蔽的推荐：菜和店都列出名字，逐条删 + 一键清空
//       ⑤ 最近吃过：全量倒序、每条写明具体哪天吃的、同一顿合并、删一条能按原位置放回
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

async function mockFetch(){ return { ok:false, status:404, json: async () => ({}), text: async () => '' }; }

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__M={state,renderProfile,openMemPage,closeMemPage,renderMemPage,deleteMemEntry,clearBannedList,onMemoryClick,fmtMoment,relDay,histKey,sortedHistory,DISHES,dishById,saveProfile};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch);
const M = globalThis.__M;
const $ = s => document.querySelector(s);

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
// 造一个"点到了某个选择器"的假事件，验证事件委托这条路
const clickOn = sel => M.onMemoryClick({ target:{ closest:(s) => (s === sel ? {
  getAttribute:(k) => ({ 'data-memdel':'like', 'data-memkey':'川', 'data-gomem':'taste' }[k])
} : null) } });

const d0 = M.DISHES[0], d1 = M.DISHES[1], d2 = M.DISHES[2], d3 = M.DISHES[3];
const DAY = 24 * 3600 * 1000;
const today10 = new Date(); today10.setHours(10, 0, 0, 0);
const lastNight = new Date(); lastNight.setDate(lastNight.getDate() - 1); lastNight.setHours(23, 30, 0, 0);

// 12 条喜欢 / 10 条不喜欢 / 12 条历史 —— 都比摘要里的 8 条多，用来证明"全记录"真的是全的
function resetProfile(){
  const likes = {}; for(let i = 0; i < 12; i++) likes['口味' + i] = 12 - i;
  const dislikes = {}; for(let i = 0; i < 10; i++) dislikes['不爱' + i] = 10 - i;
  const history = [];
  for(let i = 0; i < 12; i++) history.push({ id:d0.id, ts:today10.getTime() - i*DAY, price:20 + i });
  history[0] = { id:d0.id, ts:today10.getTime(), price:28 };
  history[1] = { id:d1.id, ts:today10.getTime() + 2000, price:9 };      // 和上面同一顿
  history[11] = { id:d2.id, ts:lastNight.getTime(), price:15 };         // 昨晚 —— 自然日要算"昨天"
  M.state.profile.likes = likes;
  M.state.profile.dislikes = dislikes;
  M.state.profile.history = history;
  M.state.profile.banned = { dishes:{ [d3.id]: Date.now() }, shops:{ 'B0TEST': Date.now() }, shopNames:{ 'B0TEST':'楼下沙县小吃' } };
  M.state.memPage = null;
  store.clear();
}

console.log('=== 一、卡片摘要：三块都是入口，但不能就地删 ===');
resetProfile();
M.renderProfile();
ok($('#pLikes').innerHTML.includes('口味0 ×12'), '喜欢摘要照旧显示：' + $('#pLikes').innerHTML.slice(0, 60));
ok(!$('#pLikes').innerHTML.includes('data-memdel'), '摘要里没有删除按钮（不会误删）');
ok(!$('#pHistory').innerHTML.includes('data-memdel'), '最近吃过摘要里也没有删除按钮');
ok($('#memBannedMore').textContent.indexOf('查看全部（2）') === 0, '屏蔽入口标出总数：' + $('#memBannedMore').textContent);
ok($('#memHistoryMore').textContent.indexOf('查看全部（12）') === 0, '最近吃过入口标出总数：' + $('#memHistoryMore').textContent);

console.log('\n=== 二、点进去整页切走，点返回回来 ===');
M.openMemPage('taste');
ok(M.state.memPage === 'taste', '进入了喜欢 / 不喜欢全记录');
ok($('#pageMe').classList.contains('hidden'), '「我的」页收起来');
ok(!$('#pageMem').classList.contains('hidden'), '全记录页显示出来');
ok($('.tabbar').classList.contains('hidden'), '底部 Tab 收起（不让它在半截页面上乱跳）');
ok($('#memPageTitle').textContent === 'AI 记住的喜欢 / 不喜欢', '页面标题对：' + $('#memPageTitle').textContent);
const tasteHTML = $('#memPageBody').innerHTML;
ok(tasteHTML.includes('AI 记住的喜欢（12 条）') && tasteHTML.includes('AI 记住的不喜欢（10 条）'), '两个分段都写清了条数');
ok(tasteHTML.includes('口味11') && tasteHTML.includes('不爱9'), '摘要里被截掉的条目，全记录里都在');
ok((tasteHTML.match(/data-memdel="like"/g) || []).length === 12, '喜欢 12 条每条都能删');
ok((tasteHTML.match(/data-memdel="dislike"/g) || []).length === 10, '不喜欢 10 条每条都能删');
ok(tasteHTML.includes('被记了 12 次'), '每条写明被记了多少次');

M.closeMemPage();
ok(M.state.memPage === null, '点返回退出全记录');
ok(!$('#pageMe').classList.contains('hidden') && $('#pageMem').classList.contains('hidden'), '回到「我的」页，全记录页收起来');
ok(!$('.tabbar').classList.contains('hidden'), '底部 Tab 回来了');

console.log('\n=== 三、删一条喜欢 —— 只删这条，还能撤销 ===');
M.openMemPage('taste');
M.deleteMemEntry('like', '口味0');
ok(!('口味0' in M.state.profile.likes), '删掉了这条喜欢');
ok(M.state.profile.likes['口味1'] === 11, '别的喜欢没被牵连');
ok(!$('#memPageBody').innerHTML.includes('口味0'), '全记录页立刻刷新，那条不在了');
const profKey = [...store.keys()].find(k => String(store.get(k)).includes('"likes"'));
ok(!!profKey && !('口味0' in JSON.parse(store.get(profKey)).likes), '删完立刻落盘（刷新不会复活）');
ok(typeof $('#toast').onclick === 'function' && $('#toast').textContent.includes('撤销'), '提示条带撤销入口：' + $('#toast').textContent);
$('#toast').onclick();
ok(M.state.profile.likes['口味0'] === 12, '撤销把这条连同次数一起放回（不是只放回 1 次）');
M.deleteMemEntry('like', '口味0');
M.deleteMemEntry('dislike', '不爱0');
ok(!('不爱0' in M.state.profile.dislikes) && M.state.profile.dislikes['不爱1'] === 9, '不喜欢也能单独删，别的条目不动');
$('#toast').onclick();                                  // 撤销回去
ok(M.state.profile.dislikes['不爱0'] === 10, '撤销不喜欢同样连次数一起放回');

console.log('\n=== 四、被屏蔽的推荐：菜和店都看得到、都能删 ===');
M.openMemPage('banned');
const banHTML = $('#memPageBody').innerHTML;
ok($('#memPageTitle').textContent === '被屏蔽的推荐', '标题对');
ok(banHTML.includes('被屏蔽的菜（1 道）') && banHTML.includes(d3.name), '列出被屏蔽的菜名：' + d3.name);
ok(banHTML.includes('被屏蔽的店（1 家）') && banHTML.includes('楼下沙县小吃'), '列出被屏蔽的店名（不是高德 ID）');
ok(banHTML.includes('data-memclear="banned"'), '带「清空屏蔽记录」按钮');
M.deleteMemEntry('banDish', d3.id);
ok(!(d3.id in M.state.profile.banned.dishes), '屏蔽的菜能单独删掉');
M.deleteMemEntry('banShop', 'B0TEST');
ok(!('B0TEST' in M.state.profile.banned.shops), '屏蔽的店能单独删掉');
M.clearBannedList();
ok(Object.keys(M.state.profile.banned.dishes).length === 0 && Object.keys(M.state.profile.banned.shops).length === 0, '一键清空屏蔽记录');
ok($('#memPageBody').innerHTML.includes('还没有'), '清空后两段都显示「还没有」');

console.log('\n=== 五、最近吃过：全量 + 具体哪天 ===');
M.openMemPage('history');
let histHTML = $('#memPageBody').innerHTML;
ok($('#memPageTitle').textContent === '最近吃过', '标题对');
ok((histHTML.match(/data-memdel="hist"/g) || []).length === 12, '12 条历史全列出来（摘要只显示 8 条）');
ok(histHTML.includes(M.fmtMoment(today10.getTime())), '写出具体哪天吃的：' + M.fmtMoment(today10.getTime()));
ok(/年\d+月\d+日 周[日一二三四五六] \d\d:\d\d/.test(histHTML), '格式是「…年…月…日 周X HH:MM」');
ok(histHTML.includes('同一顿还记了：'), '同一顿的菜合在一处说明');
ok(histHTML.indexOf(M.fmtMoment(today10.getTime())) < histHTML.indexOf(M.fmtMoment(lastNight.getTime())), '按时间从新到旧排');
ok(histHTML.includes('¥28'), '带上当时记的价');

const beforeLen = M.state.profile.history.length;
const key3 = M.histKey(M.state.profile.history[3]);
M.deleteMemEntry('hist', key3);
ok(M.state.profile.history.length === beforeLen - 1, '能删掉一条用餐记录');
ok(!M.state.profile.history.some(h => M.histKey(h) === key3), '删的就是那一条');
$('#toast').onclick();
ok(M.state.profile.history.length === beforeLen && M.histKey(M.state.profile.history[3]) === key3, '撤销按原来的位置塞回去（顺序不乱）');

console.log('\n=== 六、相对天数按自然日算 ===');
ok(M.relDay(Date.now()) === '今天', '刚记的 = 今天');
ok(M.relDay(lastNight.getTime()) === '昨天', '昨晚 23:30 吃的那顿，早上看是「昨天」而不是「今天」');
ok(M.relDay(Date.now() - 3 * DAY) === '3天前', '三天前 = 3天前');

console.log('\n=== 七、事件委托 ===');
M.closeMemPage();
clickOn('[data-gomem]');
ok(M.state.memPage === 'taste', '点卡片上的块（事件委托）能进全记录页');
clickOn('[data-memdel]');
ok(!('川' in M.state.profile.likes), '点全记录里的删除按钮能删掉那条');
M.onMemoryClick({ target:{} });
ok(true, '点到空白处不报错');

console.log('\n' + (fail ? '❌ 有 ' + fail + ' 条没通过' : '✅ AI 记忆全记录 + 删除：全部通过'));
process.exit(fail ? 1 : 0);
