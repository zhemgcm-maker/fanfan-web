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
  if(u.indexOf('/api/llm') !== -1) return json({ text:'收到', reasoning:'', model:'deepseek-flash', ms:120, usage:{ prompt:5, completion:1 } });
  return json({ ok:true });
};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__S={state,parseTextToolCall,agentProtocol,serverLlmOn,serverAmapOn,amapFetch,llmChat,setToken,getToken,renderServerUI,DEFAULT_AMAP_KEY};')
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

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 后端融合全部通过'));
process.exit(fail ? 1 : 0);
