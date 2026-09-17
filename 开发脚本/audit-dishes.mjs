// 菜品库数据体检：字段完整性 / id 与菜名唯一 / 枚举值合法 / 极口词表一致
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.A={DISHES,ALG_MAP,dishCats,CRAVE_TAGS,craveHits,CAT_CRAVE_TAGS};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const A = globalThis.A;

const ALG_OK = new Set(Object.values(A.ALG_MAP).flat());
const CAT_OK = new Set(['rice','noodle','other']);
const ROLE_OK = new Set(['single','main','side','staple','soup','drink']);
let problems = [];

A.DISHES.forEach((d, i) => {
  const at = '第' + (i+1) + '条 ' + (d.id || '(无id)') + '/' + (d.name || '(无name)');
  ['id','name','cat','cui','price','spicy','tags','alg','desc','hot'].forEach(k => {
    if(d[k] === undefined || d[k] === null || d[k] === '') problems.push(at + '：缺字段 ' + k);
  });
  if(!CAT_OK.has(d.cat)) problems.push(at + '：cat 非法 ' + d.cat);
  if(d.role && !ROLE_OK.has(d.role)) problems.push(at + '：role 非法 ' + d.role);
  if(!Array.isArray(d.tags) || !d.tags.length) problems.push(at + '：tags 为空');
  if(!Array.isArray(d.alg)) problems.push(at + '：alg 不是数组');
  (d.alg || []).forEach(a => { if(!ALG_OK.has(a)) problems.push(at + '：alg 里有不认识的致敏标签「' + a + '」'); });
  if(!(d.price > 0)) problems.push(at + '：price 异常 ' + d.price);
  if(!(d.spicy >= 0 && d.spicy <= 3)) problems.push(at + '：spicy 越界 ' + d.spicy);
  (d.tags || []).forEach(t => { if(typeof t !== 'string' || !t.trim()) problems.push(at + '：tags 有空值'); });
});

const idSeen = new Map(), nameSeen = new Map();
A.DISHES.forEach(d => {
  if(idSeen.has(d.id)) problems.push('id 重复：' + d.id + '（' + idSeen.get(d.id) + ' 与 ' + d.name + '）');
  else idSeen.set(d.id, d.name);
  if(nameSeen.has(d.name)) problems.push('菜名重复：' + d.name);
  else nameSeen.set(d.name, d.id);
});

console.log('菜品总数：' + A.DISHES.length);
// 数组空洞检查（多写一个逗号就会产生 undefined 元素，运行时会崩）
const holes = [];
for (let i = 0; i < A.DISHES.length; i++) if (!A.DISHES[i]) holes.push(i);
if (holes.length) problems.push('DISHES 数组有空洞（多余的逗号）共 ' + holes.length + ' 处，位置 ' + holes.slice(0, 5).join(','));
const roles = {};
A.DISHES.forEach(d => { const r = d.role || 'single'; roles[r] = (roles[r]||0)+1; });
console.log('角色分布：' + Object.entries(roles).map(([k,v]) => k + ':' + v).join('  '));
const cuis = {};
A.DISHES.forEach(d => { cuis[d.cui] = (cuis[d.cui]||0)+1; });
console.log('菜系分布：' + Object.entries(cuis).sort((a,b)=>b[1]-a[1]).map(([k,v]) => k + v).join(' '));
const cats = { rice:0, noodle:0, other:0 };
['rice','noodle','other'].forEach(c => { cats[c] = A.DISHES.filter(d => A.dishCats(d).indexOf(c) !== -1).length; });
console.log('类别覆盖：吃饭 ' + cats.rice + ' / 吃面 ' + cats.noodle + ' / 其他 ' + cats.other + '（同一道菜可属多类）');

console.log('\n（"今日想吃"标签的命中数由 dump-cat-tags.mjs / test-cat-tags.mjs 检查）');

if(problems.length){
  console.log('\n❌ 发现问题 ' + problems.length + ' 处：');
  problems.slice(0, 40).forEach(p => console.log('   ' + p));
  if(problems.length > 40) console.log('   …还有 ' + (problems.length - 40) + ' 处');
  process.exit(1);
} else {
  console.log('\n✅ 菜品库字段体检全部通过');
}
