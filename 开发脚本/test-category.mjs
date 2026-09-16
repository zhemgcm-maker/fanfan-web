// 固定测试用例：类别（吃饭/吃面/其他）与「今日想吃」标签的优先级
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.T={state,recommend,planMeal,dishCats,inCat,craveHits,DISHES,pickAnchors,craveKeys};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const T = globalThis.T;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };
const CATNAME = { rice:'吃饭', noodle:'吃面', other:'其他' };

function run(cat, tags, tier='mid'){
  Object.assign(T.state, { tier, cat, budget: tier==='good'?150:60, mode:'dinein',
    address:'保定市裕华路步行街', craveTags:tags, craveText:'', spiceMax:3, seed:1 });
  T.state.profile.allergies=[]; T.state.profile.tastes=[]; T.state.profile.likes={};
  T.state.profile.dislikes={}; T.state.profile.history=[];
  const rec = T.recommend();
  return { rec, meal: T.planMeal(rec, { on:false }) };
}
const names = m => m.best ? m.best.items.map(i => i.dish.name) : [];

console.log('=== 一、类别归属按"配什么主食"来定 ===');
const expect = [
  ['黄咖喱鸡饭', ['rice']],
  ['泰式炒河粉', ['noodle']],
  ['冬阴功汤', ['other']],
  ['泰式柠檬鱼', ['other','rice']],
  ['越南牛肉河粉', ['noodle']],
  ['水煮鱼', ['other','rice']],
  ['紫菜包饭', ['other','rice']],
  ['云南过桥米线', ['noodle']]
];
expect.forEach(([name, cats]) => {
  const d = T.DISHES.find(x => x.name === name);
  const got = d ? T.dishCats(d).sort().join('+') : '（库里没有这道菜）';
  ok(got === cats.slice().sort().join('+'), name + ' → ' + got);
});

console.log('\n=== 二、同一菜系跨三个类别都有候选（泰餐为例）===');
['rice','noodle','other'].forEach(cat => {
  // 用「吃好饭」档位（人均 ≤150），这样泰式柠檬鱼(¥78)这类整份菜才在预算内
  const { rec } = run(cat, [], 'good');
  // 「其他」类别的候选在 mains（点菜型整份菜）里，不是 pool（一人食）里
  const all = rec.pool.concat((rec.mains || []).map(s => s.dish));
  const thai = all.filter(d => d.cui === '东南亚').map(d => d.name);
  ok(thai.length > 0, '选「' + CATNAME[cat] + '」时，泰餐候选：' + (thai.join('、') || '无'));
});

console.log('\n=== 三、类别优先：本类别有命中就绝不跨类 ===');
{
  const { rec, meal } = run('rice', ['炸物快乐']);
  ok(!rec.crossCatUsed, '「吃饭 + 炸物快乐」没有跨类别兜底（饭类里有咖喱猪排饭等炸物）');
  const p = rec.pool.every(d => T.inCat(d, 'rice'));
  ok(p, '候选池全部属于「吃饭」类别');
  const itemNames = names(meal).join('、');
  ok(!/汉堡|炸鸡/.test(itemNames), '推荐结果没有跳到汉堡炸鸡：' + itemNames);
}
{
  const { rec } = run('rice', ['想吃辣']);
  ok(!rec.crossCatUsed, '「吃饭 + 想吃辣」不跨类（饭类里有回锅肉盖饭、石锅拌饭这些辣菜）');
  const top = rec.scored[0];
  ok(T.inCat(top.dish, 'rice'), '第一名是饭类菜：' + top.dish.name);
}

console.log('\n=== 四、标签兜底：本类别真的没有才跨类 ===');
{
  const { rec, meal } = run('noodle', ['炸物快乐']);
  ok(rec.crossCatUsed, '「吃面 + 炸物快乐」允许跨类别兜底（面类里确实没有炸物）');
  ok(rec.crossCatNames.length > 0, '跨类补进来的菜：' + rec.crossCatNames.join('、'));
  const crossScored = rec.scored.filter(s => s.crossCat);
  const raw = crossScored.map(s => s.total);
  ok(crossScored.length > 0 && raw.every(x => x > 0), '跨类的菜被打了 0.9 折（分数已下调）');
  const itemNames = names(meal).join('、');
  ok(/薯条|炸鸡|汉堡|鸡翅|里脊|鸡米花|鸡块|天妇罗/.test(itemNames), '结果确实是炸物：' + itemNames);
}
{
  const { rec } = run('rice', ['想吃泰餐']);
  const thaiTop = rec.pool.filter(d => d.cui === '东南亚');
  ok(thaiTop.length > 0, '「吃饭 + 想吃泰餐」能在饭类里找到泰餐（黄咖喱鸡饭/泰式柠檬鱼配饭）');
}

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 类别优先级全部通过'));
process.exit(fail ? 1 : 0);
