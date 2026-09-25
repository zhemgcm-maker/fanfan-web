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

const html = fs.readFileSync(kbFile, 'utf8');
const arrBody = /const DISHES = \[([\s\S]*?)\n\];/.exec(html);
if(!arrBody){ console.error('没找到 DISHES 数组'); process.exit(1); }
const DISHES = new Function('return [' + arrBody[1] + '];')();

// 归一化口径要和 build-data.mjs 一致：括号、空格、斜杠都吃掉（"擂辣椒皮蛋(热菜)" → "擂辣椒皮蛋热菜"）
const norm = s => String(s || '').replace(/[（）()\s]/g, '').replace(/[/·／、.]/g, '');
const byNorm = new Map();
DISHES.forEach(d => { const k = norm(d.name); if(!byNorm.has(k)) byNorm.set(k, d); });
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
  const hit = findExisting(name);
  if(hit){
    same.push({ name, d:hit.d, exact:hit.exact, price:it.price, kbPrice:hit.d.price });
    if(!hit.exact) it.sameAs = hit.d.name;      // 菜单叫法多几个字 → 写 sameAs，不新增
    return;
  }
  if(!it.cui || !it.tags || !it.alg || it.spicy === undefined){
    missing.push(it);                            // 缺字段的新菜：不动库，列出来让我补
    return;
  }
  const id = nextId();
  it._id = id;
  added.push({
    id, name, cat:it.cat, cui:it.cui, price:it.price, spicy:it.spicy,
    tags:it.tags, alg:it.alg, role:it.role, desc:it.desc, hot:it.hot
  });
});

console.log('店：' + shopName + '　菜单 ' + items.length + ' 道　id 前缀 ' + prefix + (dry ? '（--dry 只预演，不写文件）' : ''));
console.log('\n① 库里已有、**原样不动**的 ' + same.length + ' 道：');
same.forEach(x => console.log('   · ' + x.name + (x.exact ? '' : ' → sameAs ' + x.d.name) +
  '　库内 id=' + x.d.id + ' cui=' + x.d.cui + ' ｜ 菜单价 ¥' + x.price + ' / 库价 ¥' + x.d.price));
console.log('\n② 新增进菜品库的 ' + added.length + ' 道：');
added.forEach(d => console.log('   · ' + d.id + ' ' + d.name + ' ¥' + d.price + ' ' + d.cui + '/' + (d.role || '—') +
  ' tags=[' + (d.tags || []).join(',') + '] alg=[' + (d.alg || []).join(',') + ']'));
if(missing.length){
  console.log('\n⚠️ 字段不全、这次没入库的 ' + missing.length + ' 道（新菜必须有 cat/cui/spicy/tags/alg）：');
  missing.forEach(x => console.log('   · ' + (x.name || JSON.stringify(x))));
}

if(dry){ console.log('\n（--dry：没有写任何文件）'); process.exit(0); }

// ① 新菜插进 DISHES 末尾
if(added.length){
  const lines = added.map(d => {
    const role = d.role ? "role:'" + d.role + "', " : '';
    return "  { id:'" + d.id + "', name:'" + d.name + "', cat:'" + d.cat + "', " + role +
      "cui:'" + d.cui + "', price:" + d.price + ', spicy:' + d.spicy +
      ", tags:['" + (d.tags || []).join("','") + "'], alg:" +
      ((d.alg && d.alg.length) ? "['" + d.alg.join("','") + "']" : '[]') +
      ", desc:'" + String(d.desc || '').replace(/'/g, "\\'") + "', hot:" + (d.hot === undefined ? 60 : d.hot) + ' },';
  }).join('\n');
  const block = '\n\n  /* ===== 采集入库：' + shopName + '（菜单批量录入）===== */\n' + lines;
  const out = html.replace(/(const DISHES = \[[\s\S]*?)(\n\];)/, (m, body, tail) => body + block + tail);
  if(out === html){ console.error('插入 DISHES 失败'); process.exit(1); }
  fs.writeFileSync(kbFile, out, 'utf8');
  console.log('\n已把 ' + added.length + ' 道新菜写进 ' + kbFile);
}

// ② 写/合并 解析结果
/* 默认写到**脚本所在仓库**的 商家数据库\解析结果（跟 find-shop.mjs 一个口径）。
 * 别按 kb 文件推——kb 可能是别的工作目录里的正本，会把菜单写丢在项目外面（踩过一次）。 */
const outDir = flag('out') || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '商家数据库', '解析结果');
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
