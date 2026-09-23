// 后端融合（阿里云 FC）的离线回归测试——不联网、不花 token，全靠假 fetch 观察"请求发去哪了"。
//   ① 文字工具协议解析器（后端吞掉 tools 时 Agent 靠它活着）
//   ② 大模型走哪条通道（登录=后端代理 / 未登录=本机直连）
//   ③ 高德走哪条通道 + 服务端 Key 坏掉时自动回退直连
// 用法：node test-server.mjs index.html
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){
  const el = { value:'', className:'', style:{}, children:[], dataset:{},
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
      contains(c){return this._s.has(c)}, toggle(c,f){const on=f===undefined?!this._s.has(c):!!f;on?this._s.add(c):this._s.delete(c);return on} },
    setAttribute(){}, addEventListener(){}, appendChild(c){ el.children.push(c); return c; },
    querySelector(){ return fakeEl(); }, querySelectorAll(){ return []; }, scrollIntoView(){}, focus(){} };
  let t = '';
  Object.defineProperty(el, 'textContent', { get(){ return t; }, set(v){ t = String(v); } });
  let i = '';
  Object.defineProperty(el, 'innerHTML', { get(){ return i; }, set(v){ i = String(v); } });
  return el;
}
const cache = new Map();
const document = { querySelector(s){ if(!cache.has(s)) cache.set(s, fakeEl()); return cache.get(s); },
                   querySelectorAll(){ return []; }, createElement(){ return fakeEl(); }, addEventListener(){} };
const store = new Map();
const localStorage = { getItem:k => (store.has(k) ? store.get(k) : null),
                       setItem:(k,v) => store.set(k, String(v)), removeItem:k => store.delete(k) };

// 假 fetch：记录每次请求，按 URL 返回预置响应
const calls = [];
let amapServerMode = 'ok';       // ok | badkey
let llmMode = 'normal';          // normal | tools-ok（透传 tools）| swallow（把 tools 吞掉）
const fakeFetch = async (url, init) => {
  const u = String(url);
  calls.push({ url:u, body: init && init.body ? JSON.parse(init.body) : null,
               auth:(init && init.headers && (init.headers.Authorization || init.headers.authorization)) || '' });
  const json = (obj) => ({ ok:true, status:200, json: async () => obj, text: async () => JSON.stringify(obj) });
  if(u.indexOf('/api/amap') !== -1){
    return amapServerMode === 'ok'
      ? json({ status:'1', info:'OK', geocodes:[{ location:'115.4,38.8' }] })
      : json({ status:'0', info:'SERVICE_NOT_AVAILABLE', infocode:'10002' });
  }
  if(u.indexOf('restapi.amap.com') !== -1) return json({ status:'1', info:'OK', geocodes:[{ location:'115.5,38.9' }] });
  if(u.indexOf('/api/llm') !== -1){
    const body = init && init.body ? JSON.parse(init.body) : {};
    /* swallow：模拟"后端把 tools 吞了"——模型只能顺着话往下聊，不会回 tool_calls */
    if(llmMode === 'swallow'){
      return json({ text:'我觉得搜火锅挺好的，不过我没法直接调工具。', reasoning:'', model:'deepseek-flash', ms:120,
                    usage:{ prompt:5, completion:12 } });
    }
    /* tools-ok：模拟"后端真的透传了 tools"——带 tools 的请求会回 tool_calls */
    if(llmMode === 'tools-ok' && Array.isArray(body.tools) && body.tools.length){
      const nm = ((body.tools[0] || {}).function || {}).name || 'ping_tool';
      return json({ text:'', reasoning:'', model:'deepseek-flash', ms:150, usage:{ prompt:5, completion:2 },
                    tool_calls:[{ index:0, id:'call_probe_1', type:'function',
                                  function:{ name:nm, arguments: nm === 'ping_tool' ? '{"ok":true}' : '{}' } }] });
    }
    return json({ text:'收到', reasoning:'', model:'deepseek-flash', ms:120, usage:{ prompt:5, completion:1 } });
  }
  return json({ ok:true });
};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__S={state,parseTextToolCall,agentProtocol,serverLlmOn,serverAmapOn,amapFetch,llmChat,setToken,getToken,renderServerUI,DEFAULT_AMAP_KEY,flushAllergyIfDirty,saveProfileNow,pushProfileNow,renderAllergyState,' +
         'probeToolsPassThrough,ensureAgentChannel,agentRun};')
  (document, localStorage, f => setTimeout(f, 0), fakeFetch);
const S = globalThis.__S;

let fail = 0;
const ok = (c, label, extra) => { console.log((c ? '  ✅ ' : '  ❌ ') + label + (extra ? ' — ' + extra : '')); if(!c) fail++; };

console.log('=== 一、文字工具协议解析器 ===');
ok(!!S.parseTextToolCall('{"tool":"search_dishes","args":{"query":"川菜"}}'), '干净的 JSON 能解析');
ok(!!S.parseTextToolCall('先说一句\n```json\n{"tool":"finalize","args":{"shop_id":"x"}}\n```'), '带代码块和前言也能解析');
const multi = S.parseTextToolCall('{"tools":[{"tool":"a","args":{}},{"tool":"b","args":{"x":1}}]}');
ok(multi && multi.length === 2 && multi[1].function.name === 'b', '一次调多个工具');
ok(S.parseTextToolCall('今天想吃火锅，你觉得呢？') === null, '纯聊天不会被误判');
ok(S.parseTextToolCall('{"tool":"x","args":"{\\"a\\":1}"}') !== null, 'args 是字符串也能吃下');

console.log('\n=== 二、大模型走哪条通道 ===');
S.state.settings.apiBase = 'https://backend.example.com';
S.state.settings.useServerLlm = 'auto';
S.setToken('');
ok(S.serverLlmOn() === false, '没登录 → 走本机直连');
S.setToken('fake.jwt.token');
ok(S.serverLlmOn() === true, '登录了 → 走后端代理');
ok(S.agentProtocol() === 'text', '后端 tools 能力未知时先用文字协议（保守）');
S.state.server.llmTools = true;
ok(S.agentProtocol() === 'native', '自检确认后端透传 tools → 用原生协议');
S.state.server.llmTools = false;
ok(S.agentProtocol() === 'text', '自检确认后端吞 tools → 用文字协议');
S.state.settings.useServerLlm = 'off';
ok(S.serverLlmOn() === false, '显式关掉 → 哪怕登录了也走本机');
S.state.settings.useServerLlm = 'auto';

console.log('\n=== 三、高德走哪条通道 + 自动回退 ===');
calls.length = 0;
S.state.server.amapOk = true;
S.state.settings.useServerAmap = 'auto';
const j1 = await S.amapFetch('/geocode/geo', { address:'保定' }, 5000);
ok(calls.length === 1 && calls[0].url.indexOf('/api/amap') !== -1, '后端可用 → 只打后端代理', calls[0].url);
ok(String(j1.status) === '1', '拿到正常结果');

calls.length = 0;
S.state.server.amapOk = null;
amapServerMode = 'badkey';
const j2 = await S.amapFetch('/geocode/geo', { address:'保定' }, 5000);
const urls = calls.map(c => c.url);
ok(urls.some(u => u.indexOf('/api/amap') !== -1), '先试了后端代理');
ok(urls.some(u => u.indexOf('restapi.amap.com') !== -1), '后端 Key 坏了 → 自动回退本机直连', urls[urls.length - 1]);
ok(String(j2.status) === '1', '回退后依然拿到结果');
ok(S.state.server.amapOk === false, '把后端高德标记为不可用（下次不再白试）');

calls.length = 0;
await S.amapFetch('/place/text', { keywords:'火锅' }, 5000);
ok(calls.length === 1 && calls[0].url.indexOf('restapi.amap.com') !== -1, '已标记不可用 → 直接走本机，不再试后端');

calls.length = 0;
S.state.server.amapOk = true;
S.state.settings.useServerAmap = 'off';
await S.amapFetch('/place/text', { keywords:'火锅' }, 5000);
ok(calls.length === 1 && calls[0].url.indexOf('restapi.amap.com') !== -1, '显式选择"强制本机" → 走后端以外的路');
ok(calls[0].url.indexOf('key=' + S.DEFAULT_AMAP_KEY) !== -1, '本机直连带的是自己的 Key');

console.log('\n=== 四、后端挂了不影响本机 ===');
S.state.settings.useServerAmap = 'auto';
S.state.server.amapOk = true;
amapServerMode = 'ok';
calls.length = 0;
const r = await S.llmChat('sys', 'hi', {});
ok(calls[0].url.indexOf('/api/llm') !== -1, 'llmChat 登录后走 /api/llm');
ok(calls[0].auth.indexOf('Bearer') === 0, '带上了登录令牌');
ok(r && r.text === '收到' && r.via === 'server', '返回值被归一化成内部结构（Agent 不用改）');

console.log('\n=== 五、工具协议的自动识别与自动切换 ===');
S.setToken('fake.jwt.token');
S.state.settings.useServerLlm = 'auto';
S.state.server.amapOk = true;

// ① 队友把 /api/llm 的透传打开了 → 探测应当发现，并自动切到原生协议
S.state.server.llmTools = null; S.state.server.checkedAt = 0;
llmMode = 'tools-ok';
calls.length = 0;
const p1 = await S.probeToolsPassThrough();
ok(p1.has === true, '探测到后端真的透传 tools（回了 tool_calls）');
ok(S.state.server.llmTools === true && S.agentProtocol() === 'native', '结论被记住 → Agent 改用原生协议');
ok(calls.some(c => c.url.indexOf('/api/llm') !== -1 && c.body && c.body.tools), '探测请求确实把 tools 发出去了');

// ② 结论还新鲜 → 开跑前不该重复打请求
calls.length = 0;
await S.ensureAgentChannel();
ok(calls.length === 0, '6 小时内测过 → 不再重复探测');

// ③ 后端要是又改回"吞 tools" → 探测能发现，结论回到文字协议
S.state.server.llmTools = null; S.state.server.checkedAt = 0;
llmMode = 'swallow';
const p2 = await S.probeToolsPassThrough();
ok(p2.has === false && S.agentProtocol() === 'text', '探测到 tools 被吞 → 回到文字协议');

// ④ 结论过期（>6 小时）→ 下一次开跑自动重测，不需要用户手动点自检
llmMode = 'tools-ok';
S.state.server.checkedAt = Date.now() - 7 * 3600 * 1000;
calls.length = 0;
await S.ensureAgentChannel();
ok(S.state.server.llmTools === true, '结论过期后自动重测 → 又切回原生协议');

// ⑤ 万一结论是错的（先按原生跑，模型第一步没动静）→ 自动换文字协议重跑，并把结论改回来
S.state.server.llmTools = true;
S.state.server.checkedAt = Date.now();       // 新鲜的结论，不会再探测
llmMode = 'swallow';
calls.length = 0;
const res = await S.agentRun({ brief:'{}', onStep(){} });
ok(res && res.protocolAutoSwitched === true, '原生跑不动 → 自动改成文字协议重跑了一次');
ok(S.state.server.llmTools === false, '并把"这个通道吞 tools"记进设置（下次直接走文字协议）');
ok(calls.filter(c => c.url.indexOf('/api/llm') !== -1).length >= 2, '两次尝试都真的发了请求（' + calls.length + ' 次）');
llmMode = 'normal';

console.log('\n=== 六、忌口「保存」与"跟着账号走"的逻辑（离线）===');
S.setToken('');
S.state.identity = { type:'guest' };
S.state.profile.allergies = [];
S.state._allergySaved = [];
ok(S.flushAllergyIfDirty() === false, '没有改动 → 什么都不做');
S.state.profile.allergies.push('花生');
ok(S.flushAllergyIfDirty() === true, '有改动 → 落盘（安全网）');
ok(S.state._allergySaved.join() === '花生', '落盘后快照跟着更新，状态不再是"未保存"');
ok(S.flushAllergyIfDirty() === false, '同样的内容不会重复推送');

const msgGuest = await S.saveProfileNow();
ok(msgGuest.indexOf('本机') !== -1 && msgGuest.indexOf('1 项忌口') !== -1, '未登录时反馈是"已保存在本机 + 几项"', msgGuest);

// 已登录（假令牌）时，保存要真的发 PUT，并且反馈里带上账号名
calls.length = 0;
S.state.identity = { type:'user', id:'u1', username:'测试账号' };
S.setToken('fake.jwt');
S.state.settings.apiBase = 'https://backend.example.com';
S.state.profile.allergies.push('香菜');
const msgUser = await S.saveProfileNow();
ok(calls.some(c => c.url.indexOf('/api/profile') !== -1), '登录后保存会真的推后端');
ok(msgUser.indexOf('测试账号') !== -1, '反馈里说清了存到哪个账号', msgUser);

// 页面正在关闭时那次推送要带 keepalive，否则关页会把它掐掉
ok(S.state._allergySaved.length === 2, '快照记录了 2 项忌口');

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 后端融合全部通过'));
process.exit(fail ? 1 : 0);
