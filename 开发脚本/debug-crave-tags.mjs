// 诊断：每个"今日想吃"标签到底能不能命中菜品
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.D={state,craveKeys,craveHits,scoreDish,recommend,planMeal,CRAVE_TAGS,DISHES,sourceLabel,ROLE_LABEL,pickAnchors};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const D = globalThis.D;

function setup(tags, text){
  Object.assign(D.state, { tier:'mid', cat:'other', budget:60, mode:'delivery', address:'保定市裕华路步行街',
    craveTags:tags, craveText:text || '', spiceMax:3, seed:1 });
  D.state.profile.allergies = []; D.state.profile.tastes = []; D.state.profile.likes = {};
  D.state.profile.dislikes = {}; D.state.profile.history = [];
}

console.log('=== 一、标签能不能命中 ===');
for (const tag of D.CRAVE_TAGS) {
  setup([tag]);
  const keys = D.craveKeys(tag);
  const hits = D.DISHES.filter(d => (D.craveHits(d).hitTags.length + D.craveHits(d).textHits.length) > 0).length;
  const mark = hits === 0 ? '❌ 完全没命中' : (hits < 5 ? '⚠️ 只命中 ' + hits + ' 道' : '✅ 命中 ' + hits + ' 道');
  console.log('  ' + tag.padEnd(12, '　') + ' 关键词 [' + keys.join(', ') + ']  →  ' + mark);
}

console.log('\n=== 二、点「炸物快乐」时的实际链路 ===');
setup(['炸物快乐']);
console.log('1) 标签 "炸物快乐" → craveKeys() 拆出的关键词: ' + JSON.stringify(D.craveKeys('炸物快乐')));
const rec = D.recommend();
const withCrave = rec.scored.map(s => ({ name:s.dish.name, crave:s.parts['今日想吃'].raw, total:s.total }));
console.log('2) 这个关键词在菜品库里的命中数: ' + withCrave.filter(x => x.crave > 0).length + ' / ' + withCrave.length);
console.log('3) 打分前 8 名（注意"今日想吃"这一列）:');
withCrave.slice(0,8).forEach((x,i) => console.log('   ' + (i+1) + '. ' + x.name.padEnd(14,' ') + ' 今日想吃=' + x.crave + '  总分=' + x.total));
const anchors = D.pickAnchors(rec);
console.log('4) 因为没有任何菜命中，锚定菜退回"总分前几名": ' + anchors.map(a=>a.dish.name).join('、'));
const meal = D.planMeal(rec, { on:false });
console.log('5) 最终推荐的一桌: ' + (meal.best ? meal.best.restaurant.name + ' → ' + meal.best.items.map(i=>i.dish.name).join(' ＋ ') : '无'));

console.log('\n=== 三、对照：点「想吃辣」时 ===');
setup(['想吃辣']);
const rec2 = D.recommend();
const c2 = rec2.scored.map(s => ({ name:s.dish.name, crave:s.parts['今日想吃'].raw }));
console.log('关键词: ' + JSON.stringify(D.craveKeys('想吃辣')) + ' · 命中 ' + c2.filter(x=>x.crave>0).length + ' 道');
console.log('锚定菜: ' + D.pickAnchors(rec2).map(a=>a.dish.name).join('、'));
