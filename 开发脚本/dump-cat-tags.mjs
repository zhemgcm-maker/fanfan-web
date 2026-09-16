// 体检：每个类型下的每个标签，在"本类别"里能命中多少道菜（0 = 点了会扑空）
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.T={state,DISHES,RESTAURANTS,CATS,CAT_CRAVE_TAGS,CRAVE_TAGS,craveTagsFor,craveKeys,craveHits,inCat,tagAudit,tagHitCountInCat,recommend,planMeal,catName};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const T = globalThis.T;

console.log('登录检查：标签总数 ' + T.CRAVE_TAGS.length + '，去重后 ' + new Set(T.CRAVE_TAGS).size);
Object.keys(T.CAT_CRAVE_TAGS).forEach(c => {
  console.log('  ' + T.catName(c) + '：' + T.CAT_CRAVE_TAGS[c].length + ' 个标签 → ' + T.CAT_CRAVE_TAGS[c].join('、'));
});

let bad = 0;
['rice','noodle','other'].forEach(cat => {
  console.log('\n===== ' + T.catName(cat) + ' =====');
  T.CAT_CRAVE_TAGS[cat].forEach(tag => {
    const inCat = T.tagHitCountInCat(tag, cat);
    const all = (() => { const s = T.state.craveTags; T.state.craveTags = [tag];
      let n = 0; T.DISHES.forEach(d => { const h = T.craveHits(d); if(h.hitTags.length + h.textHits.length) n++; });
      T.state.craveTags = s; return n; })();
    const flag = inCat === 0 ? '❌' : (inCat < 3 ? '⚠️ ' : '✅');
    if(inCat < 3) bad++;
    // 举几个例子：本类别里命中的菜名
    const s = T.state.craveTags; T.state.craveTags = [tag];
    const names = T.DISHES.filter(d => T.inCat(d, cat)).filter(d => {
      const h = T.craveHits(d); return h.hitTags.length + h.textHits.length;
    }).slice(0, 4).map(d => d.name);
    T.state.craveTags = s;
    console.log('  ' + flag + ' ' + tag.padEnd(12, ' ') + ' 本类别 ' + String(inCat).padStart(3) + ' 道 ｜ 全库 ' +
      String(all).padStart(3) + ' 道 ｜ 例：' + (names.join('、') || '（无）'));
  });
});
console.log('\n' + (bad ? '⚠️ 有 ' + bad + ' 个标签在本类别里少于 3 道菜' : '✅ 所有标签在本类别里都有 ≥3 道菜'));
