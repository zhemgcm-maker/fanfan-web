// 探针：选「吃饭」时，一桌菜里为什么会出现「面」？
// 用法：node probe-rice-noodle.mjs ..\outputs\index.html
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.T={state,recommend,planMeal,inCat,dishCats,DISHES,RESTAURANTS,CITY,CATS,CAT_CRAVE_TAGS,craveTagsFor,buildCombo,restaurantServes,pickAnchors,dishShopOptions,ROLE_LABEL};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
const T = globalThis.T;

/* 产品里的离线店库已清空；这里塞两家"测试店"来跑组合逻辑：
 *  - 万能店：什么菜都会做（cui/tags 从菜品库反推）
 *  - 只有川菜标签的店：模拟真实高德搜回来的川菜馆 */
{
  const cui = [...new Set(T.DISHES.map(d => d.cui))];
  const tags = [...new Set(T.DISHES.flatMap(d => d.tags))];
  T.CITY.offline = true;
  T.RESTAURANTS.push({ id:'test-all', name:'测试餐厅（万能）', area:'裕华路', cui, tags, avg:40, rating:4.5, delivery:true, sig:[] });
  T.RESTAURANTS.push({ id:'test-chuan', name:'测试川菜馆', area:'裕华路', cui:['川'], tags,
                       avg:40, rating:4.5, delivery:true, sig:[] });
}
const shop = T.RESTAURANTS[0];
const NOODLEISH = /面|粉|米线|拉面|凉皮|河粉|馄饨|饺|意面|刀削|馕|饼/;
const isNoodleish = d => NOODLEISH.test(d.name) && !/米饭|饭/.test(d.name.replace(/汤|饮料/g, ''));

console.log('===== 一、先把几道关键菜的类别摊开看 =====');
['米饭','刀削面','手工水饺','保定火烧','花卷／馒头','重庆小面','新疆大盘鸡','兰州牛肉拉面','麻辣牛油火锅','水煮鱼','黄焖鸡米饭']
  .forEach(n => {
    const d = T.DISHES.find(x => x.name === n);
    if(!d) return console.log('  ' + n + ' → 库里没有');
    const cats = T.dishCats(d).map(c => T.CATS.find(x=>x.id===c).name).join('+');
    console.log('  ' + n.padEnd(12) + ' role=' + String(d.role || 'single').padEnd(7) + ' → ' + cats);
  });

console.log('\n===== 二、哪些菜同时属于「吃饭」和「吃面」 =====');
const both = T.DISHES.filter(d => T.inCat(d,'rice') && T.inCat(d,'noodle'));
console.log('  共 ' + both.length + ' 道：' + both.map(d => d.name + '(' + (d.role||'single') + ')').join('、'));

console.log('\n===== 三、所有「主食」角色的菜，落在这个类别里的情况 =====');
T.DISHES.filter(d => d.role === 'staple').forEach(d => {
  console.log('  ' + d.name.padEnd(12) + ' 吃饭=' + (T.inCat(d,'rice')?'✅':'❌') +
              '  吃面=' + (T.inCat(d,'noodle')?'✅':'❌') + '  其他=' + (T.inCat(d,'other')?'✅':'❌'));
});

console.log('\n===== 四、遍历「吃饭」类别下所有标签，看组合里会不会冒出“面” =====');
let bad = 0;
const run = (tags, tier, cat, text='') => {
  Object.assign(T.state, { tier, cat, budget: tier==='good'?150:(tier==='mid'?60:25), mode:'dinein',
    address:'保定市裕华路步行街', craveTags:tags, craveText:text, spiceMax:3, seed:1 });
  T.state.profile.allergies=[]; T.state.profile.tastes=[];
  T.state.profile.likes={}; T.state.profile.dislikes={}; T.state.profile.history=[];
  T.state.profile.banned={dishes:{},shops:{}};
  const rec = T.recommend();
  const meal = T.planMeal(rec, { on:false, shops:[shop], byDish:{}, around:[] });
  return meal;
};
const dishName = i => i.dish.name;
for(const tier of ['small','mid','good']){
  for(const tag of [null].concat(T.CAT_CRAVE_TAGS.rice)){
    const tags = tag ? [tag] : [];
    const meal = run(tags, tier, 'rice');
    const items = meal && meal.best ? meal.best.items : [];
    const names = items.map(dishName);
    const noodleInRice = items.filter(i => !T.inCat(i.dish, 'rice') || (/面|粉|米线|拉面|饺|刀削|饼|馄饨/.test(i.dish.name) && i.role !== 'staple'));
    const flag = noodleInRice.length ? '⚠️' : '  ';
    if(noodleInRice.length){ bad++; }
    console.log('  ' + flag + ' [' + tier + '] ' + String(tag || '（没选标签）').padEnd(8) + ' → ' +
      (names.join(' ＋ ') || '（配不出）') +
      (noodleInRice.length ? '   ← 里面的「' + noodleInRice.map(dishName).join('、') + '」不属于吃饭类别' : ''));
  }
}
console.log(bad ? '\n⚠️ 有 ' + bad + ' 组在「吃饭」里混进了非饭类菜' : '\n✅ 全部都在「吃饭」类别内');

console.log('\n===== 四之二、出问题的那几单，逐项拆开看角色 =====');
[['small',[]],['small',['想吃肉']],['small',['川菜']],['mid',[]]].forEach(([tier,tags]) => {
  const meal = run(tags, tier, 'rice');
  const best = meal && meal.best;
  if(!best){ console.log('  [' + tier + '] ' + (tags.join('/')||'无标签') + ' → 配不出'); return; }
  console.log('  [' + tier + '] ' + (tags.join('/')||'无标签') + ' 锚定菜=' + best.anchorDish.name +
    '(role=' + (best.anchorDish.role||'single') + ', ¥' + best.anchorDish.price + ')');
  best.items.forEach(i => console.log('      · ' + T.ROLE_LABEL[i.role] + '：' + i.dish.name +
    '（¥' + i.dish.price + '，类别 ' + T.dishCats(i.dish).join('/') + '）'));
});

console.log('\n===== 四之三、锚定菜是整份荤菜、但档位是「小饭」时发生了什么 =====');
{
  const cap = 25;
  const mains = T.DISHES.filter(d => d.role === 'main');
  console.log('  整份荤菜（main）共 ' + mains.length + ' 道，其中 ≤¥' + cap + ' 的只有 ' +
    mains.filter(d => d.price <= cap).length + ' 道：' +
    (mains.filter(d => d.price <= cap).map(d => d.name + '¥' + d.price).join('、') || '（一道都没有）'));
  const singles = T.DISHES.filter(d => (d.role||'single') === 'single' && d.price <= cap);
  console.log('  「一人食」（single）≤¥' + cap + ' 的有 ' + singles.length + ' 道，里面属于吃面/其他的：' +
    singles.filter(d => !T.inCat(d, 'rice')).slice(0, 8).map(d => d.name).join('、') + ' …');
console.log('  → 小饭档主菜位填不上时，代码会退到「一人食」里挑分最高的，这里就可能挑到面。');

console.log('\n===== 七、换个类别看是不是同一个毛病（小饭档）=====');
[['rice','吃饭'],['noodle','吃面']].forEach(([cat, cn]) => {
  let off = 0, tot = 0, samples = [];
  for(const tag of [null].concat(T.CAT_CRAVE_TAGS[cat])){
    const meal = run(tag ? [tag] : [], 'small', cat);
    const best = meal && meal.best;
    if(!best) continue;
    tot++;
    const single = best.items.find(i => i.role === 'single');
    if(single && !T.inCat(single.dish, cat)){ off++; samples.push(tag || '（无标签）' + '→' + single.dish.name); }
  }
  console.log('  ' + cn + '：' + tot + ' 组里有 ' + off + ' 组的"一人食"跑到类别外（' + samples.slice(0,4).join('，') + ' …）');
});

console.log('\n===== 八、如果"本类别优先"套到每个位置，各位置候选够不够 =====');
['rice','noodle','other'].forEach(cat => {
  const cn = T.CATS.find(c => c.id === cat).name;
  console.log('  【' + cn + '】');
  const roles = ['main','single','side','soup','staple','drink'];
  roles.forEach(role => {
    const all = T.DISHES.filter(d => (d.role || 'single') === role);
    const fit = all.filter(d => T.inCat(d, cat));
    const sample = fit.slice(0, 6).map(d => d.name + '¥' + d.price).join('、');
    console.log('    ' + T.ROLE_LABEL[role].padEnd(8) + ' 本类别内 ' + String(fit.length).padStart(3) + ' 道 / 全库 ' +
      String(all.length).padStart(3) + ' 道' + (fit.length ? ' ｜ 例：' + sample : ' ｜ （类别内没有 → 会跨类兜底）'));
  });
});
}

console.log('\n===== 五、自由文本里写"面"，但类型选的是「吃饭」 =====');
['想吃重庆小面','牛肉面','面'].forEach(t => {
  const meal = run([], 'mid', 'rice', t);
  const items = meal && meal.best ? meal.best.items : [];
  console.log('  文本「' + t + '」→ ' + (items.map(dishName).join(' ＋ ') || '（配不出）'));
});

console.log('\n===== 六、「小饭」档（≤¥25）逐标签体检：主菜位填不上时会挑到什么 =====');
console.log('  标签'.padEnd(10) + '锚定菜(角色/价格)'.padEnd(22) + '最终「一人食」位'.padEnd(18) + '它属于吃饭吗');
const NOD = /面|粉|米线|拉面|刀削|饺|馄饨|馍|卷/;
for(const tag of [null].concat(T.CAT_CRAVE_TAGS.rice)){
  const meal = run(tag ? [tag] : [], 'small', 'rice');
  const best = meal && meal.best;
  if(!best){ console.log('  ' + String(tag||'—').padEnd(10) + '配不出'); continue; }
  const a = best.anchorDish;
  const single = best.items.find(i => i.role === 'single');
  const name = single ? single.dish.name : '（没有一人食位）';
  const okCat = single ? T.inCat(single.dish, 'rice') : true;
  console.log('  ' + String(tag||'—').padEnd(10) +
    (a.name + '(' + (a.role||'single') + '/¥' + a.price + ')').padEnd(22) +
    name.padEnd(18) + (okCat ? '✅ 是' : '❌ 不是' + (NOD.test(name) ? '（是面/粉类）' : '')));
}
