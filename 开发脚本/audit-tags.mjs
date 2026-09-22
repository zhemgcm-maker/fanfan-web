// 标签体检：既看全库，也能在入库前体检一份菜单。
//
//   node audit-tags.mjs index.html                     全库体检
//   node audit-tags.mjs index.html --menu 菜单.json     体检一份待入库的菜单（解析结果格式）
//
// 判定口径来自程序自己：把每个界面标签依次挂上去，用 craveHits() 数一遍，
// 所以结论和用户在界面上点标签的结果一致——不是我自己拿字符串比对。
import fs from 'node:fs';

const kbFile = process.argv[2];
if (!kbFile) { console.error('用法：node audit-tags.mjs index.html [--menu 菜单.json]'); process.exit(1); }
const mi = process.argv.indexOf('--menu');
const menuFile = mi === -1 ? null : process.argv[mi + 1];

const html = fs.readFileSync(kbFile, 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){
  const el = { value:'', className:'', style:{}, children:[], dataset:{},
    classList:{ _s:new Set(), add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    setAttribute(){}, addEventListener(){}, appendChild(c){ return c; },
    querySelector(){ return fakeEl(); }, querySelectorAll(){ return []; }, scrollIntoView(){} };
  let t = '';
  Object.defineProperty(el, 'textContent', { get(){ return t; }, set(v){ t = String(v); } });
  let i = '';
  Object.defineProperty(el, 'innerHTML', { get(){ return i; }, set(v){ i = String(v); } });
  return el;
}
const cache = new Map();
const document = { querySelector(s){ if(!cache.has(s)) cache.set(s, fakeEl()); return cache.get(s); },
                   querySelectorAll(){ return []; }, createElement(){ return fakeEl(); }, addEventListener(){} };
const store = new Map();
const localStorage = { getItem:k => (store.has(k) ? store.get(k) : null),
                       setItem:(k,v) => store.set(k, String(v)), removeItem:k => store.delete(k) };
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__A={state,DISHES,CATS,CAT_CRAVE_TAGS,CRAVE_TAG_KEYS,TAG_ONLY_KEYS,ALG_MAP,craveHits};')
  (document, localStorage, f => setTimeout(f, 0), () => Promise.reject(new Error('offline')));
const A = globalThis.__A;

const UI_TAGS = [];
Object.keys(A.CRAVE_TAG_KEYS).forEach(t => { if (UI_TAGS.indexOf(t) === -1) UI_TAGS.push(t); });
const KEYS = new Set();
Object.values(A.CRAVE_TAG_KEYS).forEach(arr => arr.forEach(k => KEYS.add(k)));
A.TAG_ONLY_KEYS.forEach(k => KEYS.add(k));
/* 除了「今天想吃什么」，还有三处会拿菜品标签做判断，写数据时都要照顾到：
 *   口味画像（scoreDish 里的 map）、时段契合（currentPeriod().need）、想吃肉（MEAT_TAGS） */
const TASTE_KEYS = ['清淡','重口','汤','干拌','辣','甜口','酸辣','下饭','健康','烧烤','生鲜'];
const PERIOD_KEYS = ['快','清淡','汤','蛋','下饭','扎实','热','小吃','甜口','聚餐','肉','烧烤','辣','啤酒'];
const MEAT_KEYS = ['猪','牛','羊','鸡','鸭','鱼','虾','蟹','贝','驴肉'];
TASTE_KEYS.concat(PERIOD_KEYS, MEAT_KEYS).forEach(k => KEYS.add(k));
const ALG_OK = new Set(Object.values(A.ALG_MAP).flat());
const CUI_OK = new Set(A.DISHES.map(d => d.cui));      // 25 个枚举（以库内实际取值为准）
const CAT_OK = ['rice', 'noodle', 'other'];
const ROLE_OK = ['single', 'main', 'side', 'staple', 'soup', 'drink'];

// 给一道菜算：能被哪些界面标签选中
function uiHits(dish){
  const hits = [];
  UI_TAGS.forEach(t => {
    A.state.craveTags = [t];
    const r = A.craveHits(dish);
    if (r && r.hitTags && r.hitTags.length) hits.push(t);
  });
  A.state.craveTags = [];
  return hits;
}

const targets = menuFile
  ? JSON.parse(fs.readFileSync(menuFile, 'utf8')).items.map(it => ({
      id: it.name, name: it.name, cat: 'other', cui: '家常', price: it.price || 0,
      spicy: 0, tags: it.tags || [], alg: it.alg || [], desc: it.desc || it.cat || '', role: undefined
    }))
  : A.DISHES;

console.log('=== 标签体系 ===');
console.log('界面标签：' + UI_TAGS.length + ' 个（' + Object.entries(A.CAT_CRAVE_TAGS).map(([c, a]) =>
  ((A.CATS.find(x => x.id === c) || {}).name || c) + ' ' + a.length).join('｜') + '）');
console.log('展开后的关键词：' + KEYS.size + ' 个');
const freq = {};
A.DISHES.forEach(d => (d.tags || []).forEach(t => freq[t] = (freq[t] || 0) + 1));
const usedTags = Object.keys(freq);
console.log('全库用了 ' + usedTags.length + ' 种菜品标签，其中参与计算 ' +
  usedTags.filter(t => KEYS.has(t)).length + ' 种，纯描述 ' + usedTags.filter(t => !KEYS.has(t)).length + ' 种');

console.log('\n=== 逐菜体检（' + targets.length + ' 道）===');
let noHit = [], weak = [], algBad = [], dup = [];
const seen = new Map();
targets.forEach(d => {
  const hits = uiHits(d);
  if (!hits.length) noHit.push(d);
  else if (hits.length <= 2) weak.push({ d, hits });
  const bad = (d.alg || []).filter(a => !ALG_OK.has(a));
  if (bad.length) algBad.push({ d, bad });
  const k = String(d.name).replace(/[\s（）()\/／、·.]/g, '');
  if (seen.has(k)) dup.push(d.name + ' ←→ ' + seen.get(k)); else seen.set(k, d.name);
});

const show = (arr, fmt, limit) => arr.slice(0, limit || 20).forEach(x => console.log('  ' + fmt(x)));
if (noHit.length) { console.log('❌ 任何界面标签都选不到（' + noHit.length + ' 道）——必须补标签：'); show(noHit, d => d.id + ' ' + d.name + '  tags=[' + (d.tags || []).join(',') + ']'); }
else console.log('✅ 没有"选不到"的菜');
if (weak.length) { console.log('\n⚠️ 只命中 1~2 个标签、偏弱（' + weak.length + ' 道）：'); show(weak, x => x.d.name + ' → ' + x.hits.join('、'), 15); }
if (algBad.length) { console.log('\n❌ 忌口 token 不在词表里（' + algBad.length + ' 道）——这些忌口等于没写：'); show(algBad, x => x.d.name + '：' + x.bad.join('、')); }
if (dup.length) { console.log('\n⚠️ 疑似重复入库（' + dup.length + ' 条）：'); show(dup, s => s); }

console.log('\n=== 字段枚举检查 ===');
const badCat = targets.filter(d => CAT_OK.indexOf(d.cat) === -1);
const badRole = targets.filter(d => d.role && ROLE_OK.indexOf(d.role) === -1);
const badCui = targets.filter(d => d.cui && CUI_OK.has(d.cui) === false);
console.log('cat 非法：' + (badCat.length ? badCat.map(d => d.name + '(' + d.cat + ')').join('、') : '无 ✅'));
console.log('role 非法：' + (badRole.length ? badRole.map(d => d.name + '(' + d.role + ')').join('、') : '无 ✅'));
console.log('cui 不在现有枚举内：' + (badCui.length ? badCui.map(d => d.name + '(' + d.cui + ')').join('、') + '（新增菜系要先加进 CATS/CUI_TAGS）' : '无 ✅'));

console.log('\n（写数据的规范见仓库根目录「标签规范.md」）');
process.exit(noHit.length || algBad.length || badCat.length || badRole.length ? 1 : 0);
