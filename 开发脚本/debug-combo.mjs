import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){el.children.push(c);return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v)}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.D={state,recommend,planMeal,buildCombo,scoreDish,recommendRestaurantsSmart,restaurantServes,DISHES,TIERS};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const D = globalThis.D;

Object.assign(D.state, { tier:'good', cat:'other', budget:150, mode:'dinein', address:'保定市军校广场',
  craveTags:['想吃辣','想吃肉'], craveText:'', spiceMax:3, seed:1 });
D.state.profile.allergies = [];

const rec = D.recommend();
console.log('候选池 ' + rec.pool.length + ' / 通过过滤 ' + rec.passed.length);
console.log('\n打分前 8 名：');
rec.scored.slice(0,8).forEach((s,i) => {
  console.log(' ' + (i+1) + '. ' + s.dish.name + ' ¥' + s.dish.price + ' [' + (s.dish.role||'single') + '] 总分 ' + s.total +
    '  分项 ' + Object.entries(s.parts).map(([k,v])=>k+'='+v.raw).join(','));
});

console.log('\n前 4 名各自的店：');
rec.scored.filter(s=>['single','main'].indexOf(s.dish.role||'single')!==-1).slice(0,4).forEach(s => {
  const shops = D.recommendRestaurantsSmart(s.dish, {on:false});
  console.log(' · ' + s.dish.name + '(' + s.total + ') → ' + shops.list.slice(0,3).map(x=>x.restaurant.name+'('+x.km+'km,店分'+x.total+')').join(' / '));
  shops.list.slice(0,2).forEach(x => {
    const c = D.buildCombo(x.restaurant, s.dish);
    console.log('     在 ' + x.restaurant.name + ' 配出: ' + c.items.map(i=>i.dish.name+'¥'+i.dish.price).join(' + ') +
      ' = ¥' + c.total + ' | 组合分 ' + Math.round(c.score + x.total*0.5));
  });
});
