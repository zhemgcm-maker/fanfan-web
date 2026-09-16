// 固定测试用例：第 2 步选「吃饭/吃面/其他」时，「今日想吃」标签动态切换 + 每个标签都能点出菜
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/* ---- 最小 DOM 桩：innerHTML 清空时要真的清空 children（否则测不出"重画"）---- */
function fakeEl(){
  const el = {
    value:'', className:'', style:{}, children:[], dataset:{},
    classList:{ add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    setAttribute(){}, addEventListener(){}, appendChild(c){ el.children.push(c); return c; },
    querySelector(){ return fakeEl(); }, querySelectorAll(){ return []; },
    scrollIntoView(){}, focus(){}, onclick:null
  };
  let t = '', h = '';
  Object.defineProperty(el, 'textContent', { get(){ return t; }, set(v){ t = v; } });
  Object.defineProperty(el, 'innerHTML', {
    get(){ return h; },
    set(v){ h = v; el.children.length = 0; }
  });
  return el;
}
const cache = new Map();
const document = {
  querySelector(s){ if(!cache.has(s)) cache.set(s, fakeEl()); return cache.get(s); },
  querySelectorAll(){ return []; },
  createElement(){ return fakeEl(); },
  addEventListener(){}
};
const store = new Map();
const localStorage = { getItem:k => store.has(k) ? store.get(k) : null, setItem:()=>{}, removeItem:()=>{} };

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.T={state,recommend,planMeal,dishCats,inCat,craveHits,DISHES,RESTAURANTS,' +
         'CATS,CAT_CRAVE_TAGS,CRAVE_TAGS,craveTagsFor,isCraveTagOf,renderCats,renderChips,catName,craveKeys,restaurantServes,get CITY(){return CITY}};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));
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
const CATNAME = { rice:'吃饭', noodle:'吃面', other:'其他' };

function reset(patch){
  Object.assign(T.state, {
    tier:'mid', cat:null, budget:60, mode:'delivery', address:'保定市裕华路步行街',
    craveTags:[], craveText:'', spiceMax:3, seed:1
  });
  T.state.profile.allergies = []; T.state.profile.tastes = [];
  T.state.profile.likes = {}; T.state.profile.dislikes = {}; T.state.profile.history = [];
  Object.assign(T.state, patch || {});
}

// 用真实的界面按钮点击，测的是界面里那段 onclick，不是另写一份逻辑
function clickCat(catId){
  T.renderCats();
  const btns = document.querySelector('#catList').children;
  const i = T.CATS.findIndex(c => c.id === catId);
  const b = btns[i];
  if(!b || !b.onclick) throw new Error('找不到 ' + catId + ' 的类型按钮');
  b.onclick();
}
const chipTexts = () => document.querySelector('#craveList').children.map(c => c.textContent);

console.log('=== 一、标签集合本身是"分类型"的，而且每条都有菜 ===');
ok(Object.keys(T.CAT_CRAVE_TAGS).join() === 'rice,noodle,other', '按类型拆成了三套标签：' + Object.keys(T.CAT_CRAVE_TAGS).join(' / '));
ok(new Set(T.CRAVE_TAGS).size === T.CRAVE_TAGS.length, '全集标签无重复（' + T.CRAVE_TAGS.length + ' 条）');
ok(T.craveTagsFor('rice') === T.CAT_CRAVE_TAGS.rice && T.craveTagsFor('noodle') === T.CAT_CRAVE_TAGS.noodle, 'craveTagsFor() 能按类型取到对应标签');
ok(T.craveTagsFor('rice').indexOf('粤菜') !== -1, '「吃饭」里有菜系标签：粤菜');
ok(T.craveTagsFor('noodle').indexOf('汤面') !== -1, '「吃面」里有做法标签：汤面');
ok(T.craveTagsFor('other').indexOf('火锅') !== -1, '「其他」里有吃法标签：火锅');
ok(T.craveTagsFor(null).length === T.CRAVE_TAGS.length, '还没选类型时给全集兜底，界面不会空着');
// 每个标签必须在本类型里真有菜（否则点了扑空）
let deadTag = [];
['rice','noodle','other'].forEach(cat => {
  T.CAT_CRAVE_TAGS[cat].forEach(tag => {
    const saved = T.state.craveTags; T.state.craveTags = [tag];
    const n = T.DISHES.filter(d => T.inCat(d, cat)).filter(d => {
      const h = T.craveHits(d); return h.hitTags.length + h.textHits.length;
    }).length;
    T.state.craveTags = saved;
    if(n < 3) deadTag.push(CATNAME[cat] + '·' + tag + '(' + n + ')');
  });
});
ok(!deadTag.length, '每个标签在自己类型里都有 ≥3 道菜可推荐' + (deadTag.length ? '，可疑：' + deadTag.join('、') : ''));

console.log('\n=== 二、换类型 → 界面上的标签跟着换 ===');
reset({});
clickCat('rice');
const riceChips = chipTexts();
ok(riceChips.length === T.CAT_CRAVE_TAGS.rice.length && riceChips[0] === '川菜',
  '选「吃饭」后界面刷出 ' + riceChips.length + ' 个标签，第一个是「' + riceChips[0] + '」');
ok(riceChips.indexOf('汤面') === -1 && riceChips.indexOf('火锅') === -1, '选「吃饭」时不会出现「汤面」「火锅」这类不搭的标签');
clickCat('noodle');
const noodleChips = chipTexts();
ok(noodleChips.length === T.CAT_CRAVE_TAGS.noodle.length && noodleChips[0] === '汤面',
  '切到「吃面」后换成 ' + noodleChips.length + ' 个做法标签，第一个是「' + noodleChips[0] + '」');
ok(noodleChips.indexOf('粤菜') === -1 && noodleChips.indexOf('火锅') === -1, '「吃面」里没有「粤菜」「火锅」');
clickCat('other');
const otherChips = chipTexts();
ok(otherChips.length === T.CAT_CRAVE_TAGS.other.length && otherChips[0] === '火锅',
  '切到「其他」后换成 ' + otherChips.length + ' 个吃法标签，第一个是「' + otherChips[0] + '」');
ok(otherChips.indexOf('粤菜') === -1 && otherChips.indexOf('汤面') === -1, '「其他」里没有「粤菜」「汤面」');
ok(document.querySelector('#craveHint').textContent.indexOf('什么吃法') !== -1,
  '第 3 步的说明文案也跟着变：' + document.querySelector('#craveHint').textContent.slice(0, 24) + '…');

console.log('\n=== 三、换类型会清掉"不属于新类型"的旧标签（避免看不见的标签偷偷影响结果）===');
reset({});
clickCat('other');
T.state.craveTags = ['火锅','烤肉'];
T.renderChips();
clickCat('noodle');
ok(T.state.craveTags.length === 0, '从「其他」切到「吃面」后，火锅/烤肉被清掉：' + JSON.stringify(T.state.craveTags));
T.state.craveTags = ['想吃辣'];
T.renderChips();
clickCat('rice');
ok(T.state.craveTags.join() === '想吃辣', '「想吃辣」两类型通用，切类型不会被误清：' + JSON.stringify(T.state.craveTags));

console.log('\n=== 四、每个「类型 × 标签」都真的能点出一桌菜 ===');
const bad = [];
['rice','noodle','other'].forEach(cat => {
  T.CAT_CRAVE_TAGS[cat].forEach(tag => {
    reset({ cat, tier:'good', budget:150 });
    T.state.craveTags = [tag];
    const rec = T.recommend();
    const meal = T.planMeal(rec, { on:false });
    const best = meal.best;
    if(!best){ bad.push(CATNAME[cat] + '·' + tag + '：没有配出任何一桌'); return; }
    const anchorHit = T.craveHits(best.anchorDish).hitTags.length > 0;
    const anchorInCat = T.inCat(best.anchorDish, cat);
    const shopOk = best.restaurant && best.items.length > 0;
    if(!anchorHit || !anchorInCat || !shopOk){
      bad.push(CATNAME[cat] + '·' + tag + '：锚定菜「' + best.anchorDish.name +
        '」命中=' + anchorHit + ' 类别=' + anchorInCat + ' 店=' + (best.restaurant ? best.restaurant.name : '无'));
    }
  });
});
ok(!bad.length, '三类型共 ' + (T.CAT_CRAVE_TAGS.rice.length + T.CAT_CRAVE_TAGS.noodle.length + T.CAT_CRAVE_TAGS.other.length) +
  ' 个标签，全部配得出「本类型 + 命中该标签」的一桌菜' + (bad.length ? '\n   ' + bad.join('\n   ') : ''));

console.log('\n=== 五、抽样看结果像不像话 ===');
[['rice','粤菜'],['rice','湘菜'],['noodle','炒面'],['noodle','凉面'],['other','火锅'],['other','日式料理']].forEach(([cat, tag]) => {
  reset({ cat, tier:'good', budget:150 });
  T.state.craveTags = [tag];
  const meal = T.planMeal(T.recommend(), { on:false });
  const b = meal.best;
  ok(!!b, CATNAME[cat] + ' + ' + tag + ' → ' + (b ? b.restaurant.name + '：' + b.items.map(i => i.dish.name).join('＋') + '（¥' + b.total + '）' : '无结果'));
});

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 动态标签 + 组合推荐全部通过'));
process.exit(fail ? 1 : 0);
