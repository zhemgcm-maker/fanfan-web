// 真实调用 DeepSeek，验证"一桌菜"提示词的效果
import fs from 'node:fs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.E={state,recommend,planMeal,callLLM,SYSTEM_PROMPT,catName,pickTier,currentPeriod,sourceLabel,ROLE_LABEL,CITY};')
  (document, localStorage, (f)=>setTimeout(f,0), globalThis.fetch.bind(globalThis));
const E = globalThis.E;

Object.assign(E.state, {
  tier:'mid', cat:'other', budget:60, mode:'dinein', address:'保定市军校广场',
  craveTags:['想吃辣','想吃肉'], craveText:'想跟同事一起吃个午饭',
  spiceMax:3, seed:1,
  settings:{ v:3, enabled:'on', provider:'deepseek', model:'deepseek-chat',
             base:'https://api.deepseek.com/v1', key:process.env.DS_KEY, online:'off', amapKey:'' }
});
E.state.profile.allergies = ['香菜'];
E.state.profile.tastes = ['下饭至上','嗜辣'];
E.state.profile.likes = { '下饭':2 };
E.state.profile.history = [];

const rec = E.recommend();
const meal = E.planMeal(rec, { on:false });
const combo = meal.best;
console.log('组合：' + combo.restaurant.name + ' | ' + combo.items.map(i=>i.dish.name+'¥'+i.dish.price).join(' + ') + ' = ¥' + combo.total);

const payload = {
  city: E.CITY.full,
  tier:{ id:'mid', name:'中饭', range:'¥26-60', budgetCap:60 },
  category:{ id:'other', name:'其他' },
  craving:{ tags:E.state.craveTags, text:E.state.craveText },
  address:'保定市军校广场', location:{ label:'军校广场', precise:false },
  mode:'dinein', period:E.currentPeriod().label,
  restaurantDataSource: E.sourceLabel(combo.source),
  mealPlan:{
    restaurant: combo.restaurant.name, area: combo.restaurant.area,
    address:null, tel:null, km: combo.km, rating: combo.restaurant.rating,
    dishes: combo.items.map(i => ({ role:E.ROLE_LABEL[i.role], name:i.dish.name, price:i.dish.price, highlight:!!i.anchor })),
    total: combo.total, perPerson: combo.perPerson, pairingReasons: combo.reasons
  },
  alternativeCombos: meal.list.slice(1,3).map(c => ({ restaurant:c.restaurant.name, dishes:c.items.map(i=>i.dish.name), total:c.total, km:c.km })),
  profile:{ allergies:E.state.profile.allergies, tastes:E.state.profile.tastes, likes:['下饭'] }
};

console.log('\n--- 发给 DeepSeek 的 mealPlan ---');
console.log(JSON.stringify(payload.mealPlan, null, 1));

try{
  const r = await E.callLLM(payload);
  console.log('\n--- DeepSeek 的推荐语（' + (r.ms/1000).toFixed(1) + 's）---');
  console.log(r.text);
}catch(err){
  console.log('调用失败：' + err.message);
}
