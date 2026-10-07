// 批量入库菜单（给"用户一次给好多家菜单"用的快通道）
//
// 用法：
//   node 开发脚本/ingest-menu.mjs --menu <菜单.json> --kb <index.html> [--prefix lxz] [--dry]
//
// 它做四件事：
//   ① 按名字比对菜品库：**库里已有的菜一律不动**（同名冲突时维持原有 cui/tags，这是用户定的规矩）；
//      名字只差规格/括号的，自动在菜单里写 sameAs 指过去，不新增重复菜；
//   ② 库里没有的菜，插进 DISHES 末尾（注释块按店分组），id 用 --prefix + 两位序号；
//   ③ 把菜单写成 商家数据库\解析结果\<店名>.json（已存在就合并 items，不覆盖店铺元信息）；
//   ④ 打印一份清单：新增几道、同名几道、分别是什么。
//
// 入库后自己手动跑一次 build-data.mjs 生成 data/shops.json 和页面快照（这一步不能省）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const menuFile = flag('menu'), kbFile = flag('kb');
const dry = args.indexOf('--dry') !== -1;
if(!menuFile || !kbFile){ console.error('用法：node 开发脚本/ingest-menu.mjs --menu <菜单.json> --kb <index.html> [--prefix xx] [--dry]'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(menuFile, 'utf8'));
const items = Array.isArray(raw) ? raw : (raw.items || raw.dishes || []);
const shopName = Array.isArray(raw) ? path.basename(menuFile, '.json') : (raw.shop || path.basename(menuFile, '.json'));
const prefix = (flag('prefix') || (raw.idPrefix || '')).trim();
if(!prefix) { console.error('缺少 --prefix（菜品 id 前缀，比如 lxz），或菜单里给 idPrefix'); process.exit(1); }
if(!items.length){ console.error('菜单里没有 items'); process.exit(1); }

/* 菜品库住在 index.html 同目录的 data/db.js 里（数据外置之后就在这儿，index.html 里已经没有 DISHES 了）。
 * db.js 是「var FANFAN_DB = {...};」这种 JS 对象字面量，里面还带注释，所以不能用 JSON.parse——
 * 直接执行它再把对象取出来，注释和写法都不用管。 */
const dataDir = String(kbFile).replace(/[^\\/]+$/, '');
const dbFile = path.join(dataDir, 'data', 'db.js');
if(!fs.existsSync(dbFile)){ console.error('找不到菜品库：' + dbFile + '\n（--kb 传项目里的 index.html，菜品库在它同级的 data/db.js）'); process.exit(1); }
let dbSrc = fs.readFileSync(dbFile, 'utf8');
let DISHES;
try{
  DISHES = new Function(dbSrc + '\nreturn FANFAN_DB;')().dishes || [];
}catch(e){
  console.error('读不出 data/db.js 里的 dishes：' + e.message);
  process.exit(1);
}
if(!DISHES.length){ console.error('data/db.js 里 dishes 是空的？'); process.exit(1); }

// 归一化口径要和 build-data.mjs 一致：括号、空格、斜杠都吃掉（"擂辣椒皮蛋(热菜)" → "擂辣椒皮蛋热菜"）
const norm = s => String(s || '').replace(/[（）()\s]/g, '').replace(/[/·／、.]/g, '');
/* **只在同一个菜库里比对**：这家店是校内档口（place:'campus'）就只跟校内菜比，
 * 是校外店就只跟大库比。以前不分库，于是"大库里有道同名菜"会被当成"库里已有"，
 * 菜单就链到了别的菜库上，校内模式下那道菜根本用不了。 */
const wantCampus = (raw.place === 'campus');
const byNorm = new Map();
DISHES.forEach(d => {
  if((d.place === 'campus') !== wantCampus) return;
  const k = norm(d.name); if(!byNorm.has(k)) byNorm.set(k, d);
});
console.log('　（' + (wantCampus ? '校内档口' : '校外店') + '：只跟同库的 ' +
  DISHES.filter(d => (d.place === 'campus') === wantCampus).length + ' 道菜比对）');
// 只差规格后缀（(热菜)/(小份)/加蛋…）也算同一道菜
const SPEC = /^(热菜|凉菜|小份|大份|中份|一份|半份|套餐|加饭|加蛋|加肉|大|小|中)$/;
function findExisting(name){
  const k = norm(name);
  if(byNorm.has(k)) return { d: byNorm.get(k), exact:true };
  for(const [kk, d] of byNorm){
    if(kk.length < 3) continue;
    const extra = k.indexOf(kk) === 0 ? k.slice(kk.length) : (kk.indexOf(k) === 0 ? kk.slice(k.length) : null);
    if(extra !== null && (extra === '' || SPEC.test(extra))) return { d, exact:false };
  }
  return null;
}

const existIds = new Set(DISHES.map(d => d.id));
let seq = 0;
const nextId = () => {
  for(;;){ seq++; const id = prefix + String(seq).padStart(2, '0'); if(!existIds.has(id)){ existIds.add(id); return id; } }
};

const added = [], same = [], missing = [];
items.forEach(it => {
  const name = String(it.name || '').trim();
  if(!name){ missing.push(it); return; }
  /* 允许调用方在菜单里预先指定 sameAs（外卖平台上同一道菜的名字五花八门：
     "巨无霸汉堡(单品)"、"麦辣鸡腿汉堡"、"甜品站麦旋风奥利奥"…）。指到已有菜就别新增。 */
  if(it.sameAs){
    const target = byNorm.get(norm(it.sameAs));
    if(target){ same.push({ name, d:target, exact:false, price:it.price, kbPrice:target.price }); return; }
  }
  const hit = findExisting(name);
  if(hit){
    same.push({ name, d:hit.d, exact:hit.exact, price:it.price, kbPrice:hit.d.price });
    if(!hit.exact) it.sameAs = hit.d.name;      // 菜单叫法多几个字 → 写 sameAs，不新增
    return;
  }
  /* 新菜必须有：菜系、辣度、标签、食材、**价格**。
   * 价格尤其不能空——库里 0 道没价格的菜，而前端拿到 price=null 会算成 ¥0：
   * 预算判定 `null <= 60` 成立（拿满分）、一桌合计里 `1 + null = 1`，这道菜就成了"免费菜"。
   * 所以缺价格的一律不入库，列出来让人补。 */
  if(!it.cui || !it.tags || !it.alg || it.spicy === undefined || typeof it.price !== 'number'){
    missing.push(it);
    return;
  }
  const id = nextId();
  it._id = id;
  added.push({
    id, name, cat:it.cat, cui:it.cui, price:it.price, spicy:it.spicy,
    tags:it.tags, alg:it.alg, role:it.role, desc:it.desc, hot:it.hot
  });
  // 同一批里后面的条目可以 sameAs 指到刚加进来的这道（先出现的当正名）
  const k = norm(name);
  if(!byNorm.has(k)) byNorm.set(k, { id, name, cui:it.cui, tags:it.tags, price:it.price });
});

console.log('店：' + shopName + '　菜单 ' + items.length + ' 道　id 前缀 ' + prefix + (dry ? '（--dry 只预演，不写文件）' : ''));
console.log('\n① 库里已有、**原样不动**的 ' + same.length + ' 道：');
same.forEach(x => console.log('   · ' + x.name + (x.exact ? '' : ' → sameAs ' + x.d.name) +
  '　库内 id=' + x.d.id + ' cui=' + x.d.cui + ' ｜ 菜单价 ¥' + x.price + ' / 库价 ¥' + x.d.price));
console.log('\n② 新增进菜品库的 ' + added.length + ' 道：');
added.forEach(d => console.log('   · ' + d.id + ' ' + d.name + ' ¥' + d.price + ' ' + d.cui + '/' + (d.role || '—') +
  ' tags=[' + (d.tags || []).join(',') + '] alg=[' + (d.alg || []).join(',') + ']'));
if(missing.length){
  console.log('\n⚠️ 字段不全、这次没入库的 ' + missing.length + ' 道（新菜必须有 价格/cat/cui/spicy/tags/alg，缺的补上再跑）：');
  missing.forEach(x => console.log('   · ' + (x.name || JSON.stringify(x))));
}

if(dry){ console.log('\n（--dry：没有写任何文件）'); process.exit(0); }

// ① 新菜插进 data/db.js 的 dishes 数组末尾（写法跟 insert-dishes.mjs 保持一致：JSON 风格 + 一行注释）
if(added.length){
  const lines = added.map(d => {
    const o = { id:d.id, name:d.name, cat:d.cat };
    if(d.role && d.role !== 'single') o.role = d.role;      // single 是默认值，不写
    o.cui = d.cui; o.price = d.price; o.spicy = d.spicy;
    o.tags = d.tags || []; o.alg = d.alg || [];
    o.desc = d.desc || ''; o.hot = (d.hot === undefined ? 60 : d.hot);
    return '    // 采集入库：' + d.name + '\n    ' + JSON.stringify(o) + ',';
  }).join('\n');

  /* 找 dishes 数组的收尾括号：括号配对，跳过字符串里的括号（和 insert-dishes.mjs 一个做法） */
  const start = dbSrc.indexOf('"dishes": [');
  if(start === -1){ console.error('data/db.js 里找不到 "dishes": ['); process.exit(1); }
  let i = dbSrc.indexOf('[', start), depth = 0, str = false, closeIdx = -1;
  for(; i < dbSrc.length; i++){
    const c = dbSrc[i];
    if(str){ if(c === '\\'){ i++; continue; } if(c === '"') str = false; continue; }
    if(c === '"'){ str = true; continue; }
    if(c === '['){ depth++; continue; }
    if(c === ']'){ depth--; if(depth === 0){ closeIdx = i; break; } }
  }
  if(closeIdx === -1){ console.error('没找到 dishes 数组的结尾，未插入'); process.exit(1); }

  /* 数组最后一个元素后面通常没有逗号，直接接新元素会变成 `} {` 语法错误，先补一个 */
  let head = dbSrc.slice(0, closeIdx);
  const tailChar = /(\S)(\s*)$/.exec(head);
  if(tailChar && tailChar[1] !== ',' && tailChar[1] !== '['){
    head = head.slice(0, tailChar.index + 1) + ',' + tailChar[2];
  }
  dbSrc = head + '\n\n    /* ===== 采集入库：' + shopName + '（菜单批量录入）===== */\n' + lines +
          '\n  ' + dbSrc.slice(closeIdx);
  fs.writeFileSync(dbFile, dbSrc, 'utf8');
  console.log('\n已把 ' + added.length + ' 道新菜写进 ' + dbFile);
}

// ② 写/合并 解析结果
/* 默认写到**脚本所在仓库**的 商家数据库\解析结果（跟 find-shop.mjs 一个口径）。
 * 别按 kb 文件推——kb 可能是别的工作目录里的正本，会把菜单写丢在项目外面（踩过一次）。 */
/* 路径用 fileURLToPath：new URL(...).pathname 会把中文/空格转义成 %E9…，项目目录叫 D:\饭饭web 就会写歪 */
const outDir = flag('out') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '商家数据库', '解析结果');
const target = path.join(outDir, shopName.replace(/[\\/:*?"<>|\s]+/g, '_') + '.json');
const meta = Array.isArray(raw) ? {} : raw;
const menuItems = items.filter(it => it.name).map(it => {
  const o = { name: it.name, price: it.price, cat: it.cat || '' };
  if(it.sameAs) o.sameAs = it.sameAs;
  return o;
});
const merged = Object.assign({}, meta, {
  shop: shopName,
  city: meta.city || '保定',
  source: meta.source || '菜单整理录入（用户提供）',
  collectedAt: new Date().toISOString().slice(0, 10),
  items: menuItems
});
delete merged.dishes; delete merged.idPrefix;
if(fs.existsSync(target)){
  const old = JSON.parse(fs.readFileSync(target, 'utf8'));
  merged.items = menuItems.concat((old.items || []).filter(o => !menuItems.some(n => norm(n.name) === norm(o.name))));
  console.log('已合并进已有的 ' + target);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(target, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log('菜单写到 ' + target);
console.log('\n下一步（不能省）：node 开发脚本/build-data.mjs --parsed 商家数据库\\解析结果 --kb ' + kbFile + ' --out data');
