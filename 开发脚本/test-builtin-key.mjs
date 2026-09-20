// 验证：把 Key 写进 DEFAULT_AMAP_KEY 后，程序是否自动使用它（用户无需填写）
import fs from 'node:fs';

const src = process.argv[2];
const html = fs.readFileSync(src, 'utf8');
// 不管文件里现在是空 Key 还是已经填了真 Key，都换成测试值（原来只匹配空字符串，填了 Key 之后就失效了）
const patched = html.replace(/const DEFAULT_AMAP_KEY = '[^']*';/, "const DEFAULT_AMAP_KEY = 'test-amap-key-abc123';");
if (patched === html) { console.error('❌ 没找到 DEFAULT_AMAP_KEY 那一行'); process.exit(1); }

const code = [...patched.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.K={state,DEFAULT_AMAP_KEY,renderSettingsUI,resolveLocation,DEFAULT_KEY,providerLabel};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));

const K = globalThis.K;
console.log('内置高德 Key: ' + JSON.stringify(K.DEFAULT_AMAP_KEY));
console.log('程序实际用的: ' + JSON.stringify(K.state.settings.amapKey));
console.log('用户是否需要自己填: ' + (K.state.settings.amapKey === K.DEFAULT_AMAP_KEY && K.DEFAULT_AMAP_KEY ? '否（自动用内置 Key）' : '是'));
K.renderSettingsUI();
console.log('设置面板状态文案: ' + document.querySelector('#amapStatus').textContent);
console.log('输入框自动填入: ' + (document.querySelector('#amapKey').value === K.DEFAULT_AMAP_KEY ? '是' : '否'));
