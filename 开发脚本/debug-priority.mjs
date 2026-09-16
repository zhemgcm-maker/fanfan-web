// 诊断：类别（吃饭/吃面/其他）和「今日想吃」标签的优先级关系
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.D={state,craveKeys,craveHits,scoreDish,recommend,planMeal,pickAnchors,DISHES,hardFilter,dishCats,inCat,craveKeysForTag:craveKeys};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const D = globalThis.D;

function run(tags, cat, tier, note){
  Object.assign(D.state, { tier:tier, cat:cat, budget: tier==='good'?150:60, mode:'dinein',
    address:'保定市裕华路步行街', craveTags:tags, craveText:'', spiceMax:3, seed:1 });
  D.state.profile.allergies=[]; D.state.profile.tastes=[]; D.state.profile.likes={};
  D.state.profile.dislikes={}; D.state.profile.history=[];

  const rec = D.recommend();
  const catName = { rice:'吃饭', noodle:'吃面', other:'其他' }[cat];
  console.log('\n══════ ' + note + ' ══════');
  console.log('选了类别「' + catName + '」 + 标签 ' + JSON.stringify(tags) + ' · 档位 ' + tier);
  const inCatList = rec.pool.filter(d => D.inCat(d, cat));
  const cross = rec.pool.filter(d => !D.inCat(d, cat));
  console.log('候选池 ' + rec.pool.length + ' 道 = 命中本类别 ' + inCatList.length + ' 道 ＋ 跨类别兜底 ' + cross.length + ' 道');
  if (cross.length) {
    console.log('跨类别兜底的是: ' + cross.map(d => d.name).join('、') + '   ← 因为你在本类别里的『今日想吃』一道都没命中');
  }
  console.log('类别归属举例: ' + ['黄咖喱鸡饭','泰式炒河粉','冬阴功汤','泰式柠檬鱼'].map(n => {
    const d = D.DISHES.find(x => x.name === n);
    return d ? n + '=[' + D.dishCats(d).map(c => ({rice:'吃饭',noodle:'吃面',other:'其他'}[c])).join('+') + ']' : n + '=无';
  }).join('  '));
  console.log('打分前 6 名:');
  rec.scored.slice(0,6).forEach((s,i) => {
    const c = D.dishCats(s.dish).map(x => ({rice:'吃饭',noodle:'吃面',other:'其他'}[x])).join('+');
    const flag = D.inCat(s.dish, cat) ? '  ' : ' ⬅跨类别兜底';
    console.log('   ' + (i+1) + '. ' + s.dish.name.padEnd(14,' ') + ' [' + c + ']  今日想吃=' + s.parts['今日想吃'].raw + '  总分=' + s.total + flag);
  });
  const meal = D.planMeal(rec, { on:false });
  console.log('最终一桌: ' + (meal.best ? meal.best.restaurant.name + ' → ' + meal.best.items.map(i=>i.dish.name).join(' ＋ ') : '无'));
}

run(['炸物快乐'], 'rice', 'mid', '一、吃饭 ＋ 炸物快乐');
run([], 'rice', 'mid', '二、对照：只选吃饭，不点任何标签');
run(['想吃辣'], 'rice', 'mid', '三、对照：吃饭 ＋ 想吃辣（辣在吃饭类里也有）');
run(['炸物快乐'], 'noodle', 'mid', '四、吃面 ＋ 炸物快乐');
