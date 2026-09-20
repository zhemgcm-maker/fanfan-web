// Agent 模式测试：
//   A 段（本地，不联网）—— 工具执行器 + finalize 白名单闸门
//   B 段（真联网）    —— 真跑一次 agentRun()，看模型会不会自己调工具、会不会被闸门拦住
// 用法：node test-agent.mjs ..\outputs\index.html
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
    querySelector(){ return fakeEl(); }, querySelectorAll(){ return []; },
    scrollIntoView(){}, focus(){}, onclick: null
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
  code + '\nglobalThis.__A={state,agentRun,agentCtx,agentResetCtx,runTool,AGENT_TOOLS,' +
         'AGENT_SYSTEM_PROMPT,agentUserBrief,AGENT_MAX_STEPS,CITY,dishById,SHOP_DB,' +
         'toolSearchDishes,toolFinalize,toolGetProfile,toolFilterDishes,toolRemember,' +
         'toolGetShopMenu,dishBrief,shopBrief,DEFAULT_KEY,amapCallsToday};')
  (document, localStorage, f => setTimeout(f, 0), globalThis.fetch.bind(globalThis));

const A = globalThis.__A;
const key = process.env.DS_KEY || A.DEFAULT_KEY;

let fail = 0;
const ok = (cond, label, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? ' — ' + extra : ''));
  if(!cond) fail++;
};

// 固定成"小饭 · 吃饭 · 华电二校区"，和线上实际用法一致
A.state.settings.enabled = 'on';
A.state.settings.key = key;
A.state.settings.model = 'deepseek-chat';
A.state.settings.online = 'on';
A.state.tier = 'small';
A.state.cat = 'rice';
A.state.address = '华北电力大学保定二校区';
A.state.origin = { lng:115.514611, lat:38.888900, label:'华北电力大学保定二校区', precise:true };

console.log('\n===== A 段：工具执行器（本地，不联网）=====');

const t1 = A.toolSearchDishes({ query:'汤面', cat:'noodle', limit:8 });
console.log('   search_dishes(query=汤面) → ' + t1.count + ' 道：' +
            t1.dishes.slice(0,5).map(d => d.name + '¥' + d.price).join('、'));
ok(t1.count > 0, 'search_dishes 能按"汤面"检出候选');
ok(t1.dishes.every(d => d.dish_id && d.name), '每条结果都带 dish_id');

const t2 = A.toolSearchDishes({ query:'奶奶做的味道', cat:'rice', limit:8 });
console.log('   search_dishes(query=奶奶做的味道) → ' + t2.count + ' 道（预期可能为 0，口语词本来就不该硬凑）');

const t3 = A.toolSearchDishes({ query:'川菜', tags:['下饭'], cat:'rice', limit:10 });
console.log('   search_dishes(query=川菜, tags=下饭) → ' + t3.count + ' 道：' +
            t3.dishes.slice(0,5).map(d => d.name).join('、'));
ok(t3.count > 0, 'search_dishes 支持"菜系 + 标签"组合');

const filt = A.toolFilterDishes({ dish_ids: t3.dishes.slice(0,5).map(d => d.dish_id) });
console.log('   filter_dishes → 通过 ' + filt.pass.length + ' 道，拦下 ' + filt.blocked.length + ' 道');
ok(Array.isArray(filt.pass) && Array.isArray(filt.blocked), 'filter_dishes 返回通过/拦下两组');

const prof = A.toolGetProfile();
console.log('   get_profile → 忌口 ' + JSON.stringify(prof.allergies) + '｜辣度 ' + prof.spice_text +
            '｜近 7 天吃过 ' + prof.ate_last_7_days.length + ' 次');
ok(typeof prof.spice_max === 'number', 'get_profile 能读出辣度上限');

const mem = A.toolRemember({ kind:'preference', text:'测试用：爱吃牛肉', evidence:'单元测试' });
const prof2 = A.toolGetProfile();
ok(mem.ok === true && prof2.memory.length > 0, 'remember 能把一条记忆写进去并读回来');

// 防幻觉闸门：编造的店 id / 菜 id 必须被拒绝
const bogus = A.toolFinalize({ shop_id:'amap-我编的店', dishes:[{ dish_id:'不存在' }] });
console.log('   finalize(编造的 id) → ok=' + bogus.ok);
if(bogus.errors) bogus.errors.forEach(e => console.log('      · ' + e));
ok(bogus.ok === false, 'finalize 拦下编造的 shop_id / dish_id');
ok((bogus.errors || []).length >= 2, '两类编造分别给出了原因');

// 真店 + 真菜，但没走过工具 → 也必须拒绝（白名单只认"本次会话见过"）
const stolen = A.toolFinalize({ shop_id:'amap-B0H06MD6IH', dishes:[{ dish_id:'sx01', role:'single' }] });
ok(stolen.ok === false, 'finalize 拦下"id 真实但本次没检索过"的提交');

console.log('\n===== B 段：真跑一次 Agent 循环（联网 + 真调 DeepSeek）=====');
if(!key){ console.log('  ⏭ 没有 Key，跳过'); }
else{
  const t0 = Date.now();
  const r = await A.agentRun({
    brief: JSON.stringify({
      city: A.CITY.name, address:'华北电力大学保定二校区',
      location:{ lng:115.514611, lat:38.888900 },
      tier:{ id:'small', name:'小饭', range:'¥0-25' }, budget_cap: 25,
      food_kind:'rice', food_kind_name:'吃饭',
      craving_tags: [], craving_text:'想吃点下饭的家常菜，别太辣',
      dining:'外卖', period:'午餐',
      ask:'请决定这一顿吃什么、去哪家店，按一桌菜给出来'
    }),
    onStep: rec => {
      if(rec.type === 'think') console.log('  💬 ' + (rec.text || rec.reasoning || '(无文字，直接调工具)').replace(/\s+/g,' ').slice(0,160));
      else if(rec.type === 'tool'){
        const s = JSON.stringify(rec.out);
        console.log('  🔧 ' + rec.name + ' ' + JSON.stringify(rec.args).slice(0,110) +
                    '  → ' + s.slice(0,220) + (s.length > 220 ? '…' : '') + '  (' + rec.ms + 'ms)');
      }
      else if(rec.type === 'nudge') console.log('  ↩️ 模型没提交方案，已提醒它 finalize');
      else if(rec.type === 'error') console.log('  ❌ ' + rec.message);
    }
  });
  const secs = ((Date.now() - t0)/1000).toFixed(1);
  console.log('\n  ── 结果 ──');
  console.log('  ok=' + r.ok + '｜步数=' + (r.ctx ? r.ctx.steps : '?') + '｜用时 ' + secs + 's｜token 输入 ' +
              r.usage.prompt + ' / 输出 ' + r.usage.completion);
  if(r.ok){
    console.log('  店：' + r.plan.shop_name + '（' + r.plan.shop_id + '）');
    console.log('  菜：' + r.plan.items.map(i => i.name + '¥' + i.price).join(' ＋ '));
    console.log('  合计 ¥' + r.plan.total);
    if(r.plan.reason) console.log('  理由：' + r.plan.reason);
  }else{
    console.log('  失败原因：' + r.error);
  }

  const toolCalls = r.log.filter(x => x.type === 'tool');
  ok(toolCalls.length >= 1, '模型真的发起了工具调用', toolCalls.map(x => x.name).join(' → '));
  ok(toolCalls.some(x => x.name === 'search_dishes'), '调了 search_dishes（自己检索菜品）');
  ok(toolCalls.some(x => x.name === 'search_shops' || x.name === 'list_shops_for_dish'), '调了联网搜店工具');
  if(r.ok){
    const ctx = r.ctx;
    ok(r.plan.items.every(i => ctx.seenDish.has(i.dish_id)), '方案里的菜都是本次工具返回过的（无幻觉菜）');
    ok(ctx.seenShop.has(r.plan.shop_id), '方案里的店是本次工具返回过的（无幻觉店）');
  }
  ok(r.usage.prompt > 0, '能拿到 token 用量（用于估成本）');
}

console.log('\n===== 汇总 =====');
console.log(fail === 0 ? '✅ 全部通过' : '❌ ' + fail + ' 项未通过');
process.exit(fail === 0 ? 0 : 1);
