// 探针：用户同时点多个「今天想吃」标签时，匹配是取交集还是并集？
// 用法：node probe-crave-union.mjs ..\outputs\index.html
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.T={state,recommend,planMeal,inCat,DISHES,craveHits,craveKeys,scoreDish};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const T = globalThis.T;

function setup(cat, tags, tier='mid'){
  Object.assign(T.state, { tier, cat, budget: tier==='good'?150:60, mode:'dinein',
    address:'保定市裕华路步行街', craveTags:tags, craveText:'', spiceMax:3, seed:1 });
  T.state.profile.allergies=[]; T.state.profile.tastes=[];
  T.state.profile.likes={}; T.state.profile.dislikes={}; T.state.profile.history=[];
  T.state.profile.banned={dishes:{},shops:{}};
}
const hitNames = tags => {
  setup('rice', tags);
  return new Set(T.DISHES.filter(d => T.inCat(d,'rice')).filter(d => {
    const h = T.craveHits(d); return h.hitTags.length + h.textHits.length > 0;
  }).map(d => d.name));
};
const topOf = tags => {
  setup('rice', tags);
  const rec = T.recommend();
  return rec.scored.slice(0,5).map(s => s.dish.name + '(' + s.total + ')');
};

console.log('===== 场景：类型「吃饭」，标签「川菜」+「粤菜」 =====\n');
const A = hitNames(['川菜']);
const B = hitNames(['粤菜']);
const AB = hitNames(['川菜','粤菜']);
const uni = new Set([...A, ...B]);
const inter = new Set([...A].filter(x => B.has(x)));

console.log('「川菜」单独命中      : ' + A.size + ' 道');
console.log('「粤菜」单独命中      : ' + B.size + ' 道');
console.log('两个一起选命中        : ' + AB.size + ' 道');
console.log('两者并集大小          : ' + uni.size + ' 道');
console.log('两者交集大小          : ' + inter.size + ' 道' + (inter.size ? '（' + [...inter].join('、') + '）' : '（空 —— 一道菜不可能既是川菜又是粤菜）'));
console.log('实际命中 == 并集 ?    : ' + (AB.size === uni.size && [...uni].every(n => AB.has(n)) ? '是，完全等于并集 → 取并集' : '否'));
console.log('实际命中 == 交集 ?    : ' + (AB.size === inter.size ? '是' : '否，取并集'));
console.log('\n只看川菜的菜是否还在？');
[...A].filter(n => !B.has(n)).slice(0,3).forEach(n => console.log('  「' + n + '」在双标签结果里？' + (AB.has(n) ? '✅ 在' : '❌ 被并集过滤掉了')));

console.log('\n----- 排序对比 -----');
console.log('只点「川菜」 前 5：' + topOf(['川菜']).join('、'));
console.log('只点「粤菜」 前 5：' + topOf(['粤菜']).join('、'));
console.log('两个都点     前 5：' + topOf(['川菜','粤菜']).join('、'));

console.log('\n===== 场景：两个标签能同时命中的情况（「川菜」+「想吃辣」）=====');
const C = hitNames(['川菜','想吃辣']);
const A2 = hitNames(['川菜']);
const B2 = hitNames(['想吃辣']);
console.log('「川菜」' + A2.size + ' 道 ／「想吃辣」' + B2.size + ' 道 ／ 一起选 ' + C.size +
            ' 道 ／ 并集 ' + new Set([...A2,...B2]).size + ' 道 ／ 交集 ' + [...A2].filter(x=>B2.has(x)).length + ' 道');
setup('rice', ['川菜']);
const one = T.craveHits(T.DISHES.find(d => d.name === '水煮鱼')).crave;
setup('rice', ['川菜','想吃辣']);
const two = T.craveHits(T.DISHES.find(d => d.name === '水煮鱼')).crave;
console.log('同一道「水煮鱼」的「今日想吃」得分：只点川菜 ' + one + ' 分 → 两个都点 ' + two + ' 分（满分 26，命中越多分越高）');
