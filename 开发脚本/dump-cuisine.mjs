// 统计菜品库：按菜系 × 类别列出菜名，以及每个标签的实际命中数
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.T={state,DISHES,RESTAURANTS,dishCats,inCat,craveHits,CRAVE_TAGS,restaurantServes,tagHitCount};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const T = globalThis.T;

const ROLE = { single:'一人食', main:'整份菜', side:'素/凉菜', staple:'主食', soup:'汤', drink:'饮品' };

const byCui = new Map();
T.DISHES.forEach(d => {
  if(!byCui.has(d.cui)) byCui.set(d.cui, []);
  byCui.get(d.cui).push(d);
});

console.log('===== 菜系 × 菜品 =====');
[...byCui.entries()].sort((a,b)=>b[1].length-a[1].length).forEach(([cui, list]) => {
  console.log('\n[' + cui + '] ' + list.length + ' 道');
  list.forEach(d => {
    const cats = T.dishCats(d).join('/');
    console.log('   ' + d.id + ' ' + d.name + '  ¥' + d.price + '  role=' + (d.role||'single') +
      '(' + ROLE[d.role||'single'] + ')  cat=' + cats + '  tags=' + d.tags.join(','));
  });
});

console.log('\n===== 现有「今日想吃」标签命中数（只统计 ONE 类菜的库里全量）=====');
T.CRAVE_TAGS.forEach(t => console.log('   ' + t + ' → ' + T.tagHitCount(t) + ' 道'));

console.log('\n===== 每个类别下可选的菜（single 才能当"一人食"）=====');
['rice','noodle','other'].forEach(cat => {
  const list = T.DISHES.filter(d => T.inCat(d, cat));
  const singles = list.filter(d => !d.role || d.role === 'single');
  console.log('\n[' + cat + '] 共 ' + list.length + ' 道，其中可单点 ' + singles.length + ' 道');
  singles.forEach(d => console.log('   ' + d.name + ' ¥' + d.price + ' [' + d.cui + ']'));
});

console.log('\n===== 每道菜有没有店能做（离线库）=====');
const orphan = T.DISHES.filter(d => !T.RESTAURANTS.some(r => T.restaurantServes(r, d)));
console.log(orphan.length ? orphan.map(d => d.id + '/' + d.name).join('、') : '（全部有店）');
