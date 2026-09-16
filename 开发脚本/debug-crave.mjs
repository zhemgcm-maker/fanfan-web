import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',textContent:'',value:'',className:'',style:{},children:[],classList:{add(){},remove(){},contains(){return false}},setAttribute(){},addEventListener(){},appendChild(c){el.children.push(c);return c},querySelector(){return fakeEl()},scrollIntoView(){}};return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__t={state,craveKeys,scoreDish,recommend,DISHES};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>{});

const { state, craveKeys, recommend, DISHES } = globalThis.__t;

console.log('craveKeys("生鲜/刺身") =', JSON.stringify(craveKeys('生鲜/刺身')));
console.log('craveKeys("想吃辣") =', JSON.stringify(craveKeys('想吃辣')));
console.log('craveKeys("和朋友一起吃") =', JSON.stringify(craveKeys('和朋友一起吃')));

state.tier='good'; state.cat='other'; state.budget=150; state.mode='dinein';
state.address='陆家嘴'; state.craveTags=['生鲜/刺身','一个人随便吃']; state.craveText='';
state.profile.allergies=[]; state.profile.tastes=[]; state.profile.likes={}; state.profile.dislikes={}; state.profile.history=[];

const su = DISHES.find(d=>d.id==='d38');
const s = globalThis.__t.scoreDish(su, {});
console.log('\n寿司拼盘 tags =', su.tags.join(','));
console.log('寿司拼盘 总分 =', s.total, '今日想吃 =', s.parts['今日想吃'].raw, '理由 =', s.reasons.join(' | '));

const rec = recommend();
console.log('\nTop5:', rec.scored.slice(0,5).map(x=>`${x.dish.name}=${x.total}(想吃${x.parts['今日想吃'].raw})`).join('  '));
