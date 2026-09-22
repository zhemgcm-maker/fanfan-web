// 端到端：Agent 模式走完整流程 —— 真调 DeepSeek + 真连高德，最后必须渲染出结果卡片。
// 还验证一件事：Agent 跑不通时，run() 要自动回退到算法引擎（不能白屏）。
// 用法：node e2e-agent-ui.mjs ..\outputs\index.html
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(name = 'el') {
  const el = {
    _name: name, value: '', className: '', style: {}, children: [], dataset: {},
    classList: {
      _s: new Set(),
      add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); },
      toggle(c, force){ const on = force === undefined ? !this._s.has(c) : !!force; on ? this._s.add(c) : this._s.delete(c); return on; }
    },
    setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){},
    appendChild(c){ el.children.push(c); return c; },
    querySelector(sel){ if(!el._q) el._q = {}; if(!el._q[sel]) el._q[sel] = fakeEl(sel); return el._q[sel]; },
    querySelectorAll(){ return []; },
    scrollIntoView(){}, focus(){}, onclick: null, disabled: false
  };
  let text = '';
  Object.defineProperty(el, 'textContent', { get(){ return text; }, set(v){ text = String(v); } });
  let inner = '';
  Object.defineProperty(el, 'innerHTML', { get(){ return inner; }, set(v){ inner = String(v); } });
  return el;
}
const cache = new Map();
const document = {
  querySelector(s){ if(!cache.has(s)) cache.set(s, fakeEl(s)); return cache.get(s); },
  querySelectorAll(){ return []; },
  createElement(){ return fakeEl(); },
  addEventListener(){}
};
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__U={state,run,runAgentFlow,agentUserBrief,CITY,applyCity,DEFAULT_KEY,' +
         'renderResult,loadShopDb,dishById,SHOP_DB};')
  (document, localStorage, f => setTimeout(f, 0), globalThis.fetch.bind(globalThis));

const U = globalThis.__U;
const key = process.env.DS_KEY || U.DEFAULT_KEY;
let fail = 0;
const ok = (cond, label, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? ' — ' + extra : ''));
  if(!cond) fail++;
};

try{ await U.loadShopDb(); }catch(e){}
U.state.profile.city = 'baoding';
try{ U.applyCity('baoding'); }catch(e){}
U.state.settings.enabled = 'on';
U.state.settings.key = key;
U.state.settings.model = 'deepseek-chat';
U.state.settings.online = 'on';
U.state.settings.agent = 'agent';
U.state.tier = 'small';
U.state.cat = 'rice';
U.state.address = '华北电力大学保定二校区';
U.state.origin = { lng:115.514611, lat:38.888900, label:'华北电力大学保定二校区', precise:true };
U.state.craveText = '想吃点下饭的家常菜，别太辣';

console.log('\n===== 1. Agent 模式：真跑一次，看有没有结果卡片 =====');
/* 大模型有随机性：偶尔会把步数烧在"换词重搜"上。所以这里允许两次机会，
 * 并如实报出第几次才过——测试要反映真实稳定性，不能靠一次运气。 */
/* 记录这一轮的推理过程行（连 class 一起，才能区分"可见"和"折叠"）。
 * 必须跑之前装钩子：traceAdd 是 appendChild 出来的，事后再看 DOM 桩里什么都没有。 */
const agentTrace = [];
const traceHookEl = document.querySelector('#traceList');
traceHookEl.appendChild = child => { agentTrace.push({ node:child, cls:String(child.className||''), html:String(child.innerHTML||'') }); return child; };
const t0 = Date.now();
let done = false, attempts = 0;
while(!done && attempts < 2){
  attempts++;
  done = await U.runAgentFlow();
  if(!done) console.log('  第 ' + attempts + ' 次没跑通（step 用尽或模型没提交），重试一次…');
}
const secs = ((Date.now() - t0)/1000).toFixed(1);
const card = document.querySelector('#result').innerHTML || '';
console.log('  返回 done=' + done + '（第 ' + attempts + ' 次成功），总用时 ' + secs + 's，结果卡片长度 ' + card.length);
ok(done === true, 'runAgentFlow 能在两次之内跑通并返回 true');
ok(card.length > 200, '结果卡片真的渲染出来了');
const shownShop = (U.state.lastCombo && U.state.lastCombo.restaurant) ? U.state.lastCombo.restaurant.name : '';
console.log('  主推店铺：' + shownShop);
console.log('  一桌菜：' + (U.state.lastCombo ? U.state.lastCombo.items.map(i => i.dish.name + '¥' + i.dish.price).join(' ＋ ') : '（无）'));
ok(!!shownShop && card.indexOf(shownShop) !== -1, '卡片里写了推荐的店名');
ok(U.state.lastCombo && U.state.lastCombo.items.length > 0, '卡片里有菜');
ok(!!(U.state.lastCombo && U.state.lastCombo.km >= 0), '距离字段有值', String(U.state.lastCombo && U.state.lastCombo.km));
ok(!!(U.state.lastCombo && U.state.lastCombo.agentPlan), '保留了 Agent 的方案与用量（可展示"为什么"）');
/* Agent 跑通时界面只留一行：定案 */
const vis2 = agentTrace.filter(x => x.cls.indexOf('t-silent') === -1);
const vis2Html = vis2.map(x => x.html).join(' ') + ' ' +
                 vis2.map(x => { try{ return x.node.querySelector('.t-title').textContent; }catch(e){ return ''; } }).join(' ');
console.log('    ↳ Agent 成功后界面可见 ' + vis2.length + ' 行：' + vis2Html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50));
ok(vis2.length === 1, 'Agent 跑通时界面只有 1 行');
ok(vis2Html.indexOf('定案') !== -1 || vis2Html.indexOf('↩️') !== -1, '那一行是"定案"（或说明为什么没用智能体）');
const onlineShops = (U.state.lastOnline && Array.isArray(U.state.lastOnline.shops)) ? U.state.lastOnline.shops : [];
ok(onlineShops.length > 0, '把本次搜到的店交给了"换一家也行"清单', onlineShops.length + ' 家');

console.log('\n===== 2. 兜底：Agent 跑不通时，run() 必须自动回退算法引擎 =====');
/* traceAdd() 是 appendChild 出来的，桩里不会汇总到 innerHTML，
 * 所以这里自己接一根记录线，把每一步的标题收集起来。 */
const traceLines = [];
const traceListEl = document.querySelector('#traceList');
traceListEl.appendChild = child => { traceLines.push({ node:child, cls:String(child.className || ''), html:String(child.innerHTML || child.textContent || '') }); return child; };
U.state.settings.key = 'sk-00000000000000000000000000000000';   // 故意用假 Key，让大模型必然失败
U.state.lastCombo = null;
U.state.address = '华北电力大学保定二校区';
let threw = null;
const t1 = Date.now();
try{ await U.run(); }catch(e){ threw = e; }
const secs2 = ((Date.now() - t1)/1000).toFixed(1);
const card2 = document.querySelector('#result').innerHTML || '';
const trace2 = document.querySelector('#traceList').innerHTML || '';
const traceText = traceLines.map(x => x.html).join('\n');
console.log('  用时 ' + secs2 + 's，结果卡片长度 ' + card2.length + '，是否抛异常：' + (threw ? threw.message : '否'));
console.log('  推理过程步数：' + traceLines.length);
ok(!threw, '假 Key 下 run() 没抛异常');
ok(traceText.indexOf('回退算法引擎') !== -1, '推理过程里明确写了"回退算法引擎"');
ok(!!(U.state.lastCombo && U.state.lastCombo.items && U.state.lastCombo.items.length), '回退后依然出了结果（不是白屏）');
/* 界面上只留关键几行：兜底时 = 「回退算法引擎」+ 算法引擎的最后一行 */
const vis = traceLines.filter(x => x.cls.indexOf('t-silent') === -1);
/* 读"活"的标题：traceAdd 先把初始文字塞进 innerHTML，之后 traceUpdate 会把标题改成
 * 「↩️ 回退算法引擎」——只读抓取时刻的字符串会看不到这次更新。 */
const liveTitle = x => { try{ return String(x.node.querySelector('.t-title').textContent || ''); }catch(e){ return ''; } };
console.log('    ↳ 界面可见 ' + vis.length + ' 行：' + vis.map(x => x.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)).join(' ／ '));
ok(vis.length <= 2, '兜底时用户最多看到 2 行（回退提示 + 最终方案）');
ok(vis.some(x => x.html.indexOf('回退算法引擎') !== -1 || liveTitle(x).indexOf('回退算法引擎') !== -1), '其中一行是回退说明');

console.log('\n===== 汇总 =====');
console.log(fail === 0 ? '✅ 全部通过' : '❌ ' + fail + ' 项未通过');
process.exit(fail === 0 ? 0 : 1);
