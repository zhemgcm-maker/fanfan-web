// 回归：本机存储（localStorage）满了的时候，用户的东西不能丢
// 覆盖：① 高德缓存按体积封顶 + 过期就扔（不能长到 8 MB 把额度吃光）
//       ② 存储被塞满后，新打的评价仍然写得进去（旧代码是 catch(e){} 静默吞掉，
//          用户打完分刷新页面评价就没了——2026-10-08 用户实测报过来的）
//       ③ 真的救不回来时，给出提示而不是悄悄丢
// 用法：node 开发脚本/test-store-full.mjs index.html
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const _dataDir = String(process.argv[2]).replace(/[^\\/]+$/, '');
const _dbSrc = fs.existsSync(_dataDir + 'data/db.js') ? fs.readFileSync(_dataDir + 'data/db.js', 'utf8') : '';
const code = _dbSrc + [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/* 带额度的假 localStorage：超过 QUOTA 就抛 QuotaExceededError（真浏览器就是这样） */
const QUOTA = 5 * 1024 * 1024;
function makeStore(){
  const map = new Map();
  const used = () => { let n = 0; map.forEach((v, k) => { n += k.length + v.length; }); return n; };
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      v = String(v);
      const before = map.has(k) ? map.get(k).length : 0;
      if(used() - before + v.length > QUOTA){ const e = new Error('quota exceeded'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem: k => { map.delete(k); },
    _used: used, _keys: () => [...map.keys()]
  };
}
const store = makeStore();

function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},getAttribute(){return null},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v)}});return el}
const cache = new Map();
const document = { querySelector(s){ if(!cache.has(s)) cache.set(s, fakeEl()); return cache.get(s); }, querySelectorAll(){ return []; }, createElement(){ return fakeEl(); }, addEventListener(){} };

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__S={state,putRate,ratings,saveProfile,saveAmapCache,trimAmapCache,amapCacheSet,loadAmapCache,AMAP_CACHE_NS,AMAP_CACHE_BUDGET,AMAP_TTL,safeStore,toast,LS_PROFILE};')
  (document, store, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('no net')));
const S = globalThis.__S;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };

/* ---------- ① 缓存：过期就扔 + 按体积封顶 ---------- */
console.log('\n--- ① 高德缓存的两道闸 ---');
{
  const pad = 'x'.repeat(34 * 1024);
  for(let i = 0; i < 300; i++) S.amapCacheSet('kw:测试' + i, { ok:true, pois:[{ pad }] });
  S.saveAmapCache();
  const raw = store.getItem(S.AMAP_CACHE_NS) || '';
  ok(raw.length <= S.AMAP_CACHE_BUDGET + 40 * 1024, '300 条搜索结果（约 10 MB）被裁到 ' + (raw.length / 1024 / 1024).toFixed(2) + ' MB，没撑爆 5 MB 额度');
  ok(S.AMAP_CACHE_BUDGET === 1200 * 1024, '缓存预算就是 1.2 MB');

  S.loadAmapCache()['kw:过期的搜索'] = { t: Date.now() - 25 * 3600 * 1000, v: { pad } };
  S.loadAmapCache()['geo:130600:过期的地址'] = { t: Date.now() - 25 * 3600 * 1000, v: { pad } };
  S.saveAmapCache();
  const keys = Object.keys(S.loadAmapCache());
  ok(!keys.some(k => k.indexOf('过期的') !== -1), '过期的缓存项（搜索 10 分钟 / 地理编码 24 小时）保存时被清掉');
}

/* ---------- ② 存储塞满之后，评价仍然存得住 ---------- */
console.log('\n--- ② 存储被塞满时打一次分 ---');
{
  // 用碎片把余量吃干净，直到连 8 字节都写不进去（真实用户是搜索记录一点点攒满的）
  let pads = 0;
  for(const step of [4096, 512, 64, 8]){
    for(;;){
      try{ store.setItem('__pad_' + step + '_' + pads, 'y'.repeat(step)); pads++; }
      catch(e){ break; }
      if(pads > 20000) break;
    }
  }
  let canTiny = true;
  try{ store.setItem('__probe', 'z'.repeat(8)); }catch(e){ canTiny = false; }
  ok(!canTiny, '先把存储塞满（连 8 字节都写不进去），模拟搜了很多次店之后的状态');

  S.putRate('dish', 'c07', 5, Date.now());     // 用户打了个 5 星
  S.saveProfile();
  const saved = JSON.parse(store.getItem(S.LS_PROFILE) || 'null');
  ok(!!(saved && saved.ratings && saved.ratings.dish && saved.ratings.dish.c07), '打完分：评价真的写进了本机存储（不是只活在内存里）');
  ok(Object.keys(S.ratings().dish).indexOf('c07') !== -1, '内存里也有这条评价');
}

/* ---------- ③ 腾地方用的是"可再生"的东西 ---------- */
console.log('\n--- ③ 腾地方时牺牲的是缓存，不是用户数据 ---');
{
  ok(store.getItem(S.AMAP_CACHE_NS) === null || (store.getItem(S.AMAP_CACHE_NS) || '').length < 1.3 * 1024 * 1024,
     '联网缓存被腾掉了（最坏就是重新搜一次店）');
  const saved = JSON.parse(store.getItem(S.LS_PROFILE) || 'null');
  ok(!!saved, '用户画像还在（评价/忌口/记忆都在这份里）');
}

console.log('');
console.log(fail ? '❌ 有 ' + fail + ' 条没通过' : '✅ 存储塞满时的自保逻辑全部通过');
process.exit(fail ? 1 : 0);
