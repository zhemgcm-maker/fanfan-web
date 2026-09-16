// 验证"一桌菜"组合逻辑：必须同一家店、同一桌能点齐、符合忌口与预算
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)},toggle(c,f){const on=f===undefined?!this._s.has(c):!!f;on?this._s.add(c):this._s.delete(c);return on}},setAttribute(){},addEventListener(){},appendChild(c){el.children.push(c);return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v)}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.T={state,recommend,planMeal,buildCombo,restaurantServes,hardFilter,ROLE_LABEL,ROLE_EMOJI,DISHES,RESTAURANTS,recommendRestaurantsSmart,TIERS,sourceLabel,get CITY(){return CITY}};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('no net')));

const T = globalThis.T;

/* 产品里的离线店库已经清空（真实用法只靠联网搜店）。为了还能测「一桌菜」组合逻辑，
 * 这里塞一家"什么都能做"的测试店：cui / tags 直接从菜品库反推，保证每道菜它都能做。 */
{
  const cui = [...new Set(T.DISHES.map(d => d.cui))];
  const tags = [...new Set(T.DISHES.flatMap(d => d.tags))];
  T.CITY.offline = true;   // 测试环境：打开离线兜底开关，配合下面这家测试店
  T.RESTAURANTS.push({ id:'test-shop', name:'测试餐厅（万能）', area:'裕华路', cui, tags,
                       avg:40, rating:4.5, delivery:true, sig:[] });
}

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };

function scenario(name, patch){
  console.log('\n========== ' + name + ' ==========');
  Object.assign(T.state, {
    tier:'mid', cat:'other', budget:60, craveTags:[], craveText:'', address:'保定市军校广场',
    mode:'dinein', spiceMax:3, seed:1
  }, patch);
  T.state.profile.allergies = patch.allergies || [];
  if(patch.allergies) delete patch.allergies;
  const rec = T.recommend();
  const meal = T.planMeal(rec, { on:false });
  if(!meal.best){ console.log('  （这个条件下没有组合）'); return; }

  const c = meal.best;
  console.log('店：' + c.restaurant.name + '（' + c.restaurant.area + '）· ' + c.km + 'km');
  c.items.forEach(i => console.log('   ' + (T.ROLE_EMOJI[i.role] || '') + ' ' + T.ROLE_LABEL[i.role].padEnd(6,' ') + ' ' + i.dish.name.padEnd(14,' ') + ' ¥' + i.dish.price));
  console.log('   合计 ¥' + c.total + ' / 人均 ¥' + c.perPerson + ' · 组合分 ' + Math.round(c.score));
  c.reasons.forEach(r => console.log('   · ' + r));

  // 断言 1：所有菜都必须是这家店能做的（关键！）
  const allServed = c.items.every(i => T.restaurantServes(c.restaurant, i.dish));
  ok(allServed, '这一桌菜全部来自同一家店（' + c.restaurant.name + ' 都能做）');

  // 断言 2：不能违反忌口
  const noAllergy = c.items.every(i => T.hardFilter(i.dish).ok);
  ok(noAllergy, '没有触碰忌口/辣度上限');

  // 断言 3：不能是同一道菜重复
  const ids = c.items.map(i => i.dish.id);
  ok(new Set(ids).size === ids.length, '没有重复的菜');

  // 断言 4：一顿正经饭要有"主食"来源：要么配了主食，要么主菜本身就是盖饭/面/粉
  // single 角色本身就是一顿饭（盖饭/面/饺子），算作有主食
  const hasStaple = c.items.some(i => i.role === 'staple' || i.role === 'single');
  // 甜品/饮品组合（"想喝奶茶"）不需要主食
  const dessertOnly = c.items.every(i => ['drink','side','soup'].indexOf(i.role) !== -1);
  ok(hasStaple || dessertOnly, '主食有着落（配了主食，或主菜本身就是盖饭/面食，或本来就是甜品饮品局）');

  // 断言 5：总价不超过预算上限
  const cap = Math.min(T.pickTierMax ? 999 : 999, T.state.budget);
  ok(c.total <= cap, '整桌 ¥' + c.total + ' 没超预算上限 ¥' + cap);

  // 备选组合
  if(meal.list.length > 1){
    console.log('   备选：' + meal.list.slice(1,3).map(x => x.restaurant.name + '(' + x.items.length + '道 ¥' + x.total + ')').join('、'));
  }
}

scenario('中饭 · 其他 · 堂食 · 军校广场（想吃川菜）', { tier:'mid', cat:'other', budget:60, mode:'dinein', address:'保定市军校广场', craveTags:['想吃辣','想吃肉'] });
scenario('吃好饭 · 堂食 · 想吃辣（一桌硬菜）', { tier:'good', cat:'other', budget:150, mode:'dinein', address:'保定市裕华路步行街', craveTags:['想吃辣','想吃肉'] });
scenario('中饭 · 外卖 · 一人食', { tier:'mid', cat:'rice', budget:60, mode:'delivery', address:'保定市河北大学' });
scenario('小饭 · 外卖 · 只求吃饱', { tier:'small', cat:'noodle', budget:25, mode:'delivery', address:'保定市河北大学' });
scenario('吃好饭 · 堂食 · 忌口海鲜+不吃辣', { tier:'good', cat:'other', budget:150, mode:'dinein', address:'保定市万博广场', spiceMax:0, allergies:['海鲜/虾蟹'] });
scenario('吃好饭 · 堂食 · 保定本地菜', { tier:'good', cat:'other', budget:150, mode:'dinein', address:'保定市裕华路步行街', craveTags:['想吃本地特色'] });
scenario('中饭 · 外卖 · 想吃汉堡薯条', { tier:'mid', cat:'other', budget:60, mode:'delivery', address:'保定市河北大学', craveText:'想吃汉堡 薯条' });
scenario('吃好饭 · 堂食 · 想吃披萨', { tier:'good', cat:'other', budget:150, mode:'dinein', address:'保定市万博广场', craveText:'想吃披萨 芝士' });
scenario('吃好饭 · 堂食 · 想吃烤肉', { tier:'good', cat:'other', budget:150, mode:'dinein', address:'保定市军校广场', craveText:'想吃烤肉' });
scenario('中饭 · 堂食 · 想吃泰餐', { tier:'mid', cat:'other', budget:70, mode:'dinein', address:'保定市万博广场', craveText:'想吃泰式 酸辣' });
scenario('中饭 · 外卖 · 想吃日料', { tier:'mid', cat:'other', budget:80, mode:'delivery', address:'保定市万博广场', craveText:'想吃寿司' });
scenario('中饭 · 外卖 · 来点甜的收尾', { tier:'mid', cat:'other', budget:45, mode:'delivery', address:'保定市裕华路', craveText:'想喝奶茶' });

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 组合逻辑全部通过'));
process.exit(fail ? 1 : 0);
