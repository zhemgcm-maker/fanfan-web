// 真实联网端到端：用页面自己的 parseCraving() 打一次 DeepSeek，看"一句话"能不能被解析成标签/关键词
// 用法：node e2e-llm-parse.mjs ..\outputs\index.html
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},getAttribute(){return null},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v)}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__L={state,parseCraving,clearCraveParseCache,craveTagsFor,DEFAULT_KEY,craveHits};')
  (document, localStorage, (f)=>setTimeout(f,0), globalThis.fetch.bind(globalThis));
const L = globalThis.__L;

const key = process.env.DS_KEY || L.DEFAULT_KEY;
if(!key){ console.error('没拿到 DeepSeek Key'); process.exit(1); }
L.state.settings.enabled = 'on';
L.state.settings.key = key;
L.state.settings.model = 'deepseek-chat';
L.clearCraveParseCache();

const CASES = [
  ['rice',   '想吃奶奶做的味道，清淡点的'],
  ['rice',   '想大口吃肉，最好有锅气那种，别给我沙拉'],
  ['noodle', '来碗热乎的汤的，别太辣，要有嚼劲'],
  ['other',  '今天想和朋友边聊边吃，吃点热闹的'],
  ['other',  '随便吧，你看着来']
];

let bad = 0;
for(const [cat, text] of CASES){
  const allowed = L.craveTagsFor(cat);
  try{
    const t0 = Date.now();
    const v = await L.parseCraving(text, cat);
    const ms = Date.now() - t0;
    const illegal = v.tags.filter(t => allowed.indexOf(t) === -1);
    if(illegal.length) bad++;
    console.log('\n【' + cat + '】' + text);
    console.log('   → 标签 ' + (v.tags.join('、') || '（无）') +
                ' ｜ 关键词 ' + (v.keywords.join('、') || '（无）') +
                ' ｜ note：' + (v.note || '（无）'));
    console.log('   ' + v.model + ' ' + ms + 'ms ｜ 标签是否都在词表内：' + (illegal.length ? '❌ ' + illegal.join('、') : '✅'));
    const demo = { id:'x', name:'砂锅豆腐', cui:'家常', tags:['清淡','素'], desc:'砂锅炖的', spicy:0, price:20, alg:[], role:'single' };
    const savedTags = L.state.craveTags, savedAuto = L.state.craveAuto, savedInfo = L.state.craveAutoInfo;
    L.state.craveTags = []; L.state.craveAuto = v.tags; L.state.craveAutoInfo = { src:'llm', keywords:v.keywords };
    const h = L.craveHits(demo);
    console.log('   算法侧抽样（一道"砂锅豆腐"）：命中标签 ' + (h.hitTags.join('、') || '无') +
                ' ｜ 关键词 ' + (h.textHits.join('、') || '无') + ' ｜ 今日想吃得分 ' + h.crave);
    L.state.craveTags = savedTags; L.state.craveAuto = savedAuto; L.state.craveAutoInfo = savedInfo;
  }catch(err){
    bad++;
    console.log('\n【' + cat + '】' + text + '\n   ❌ 失败：' + err.message);
  }
}
console.log('\n' + (bad ? '⚠️ 有 ' + bad + ' 个用例有问题' : '✅ 全部用例通过：真模型能把口语翻译成词表内的标签'));
