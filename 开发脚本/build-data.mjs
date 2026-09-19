// 入库：把「采集解析结果」写成前端能读的数据库文件 data/shops.json
// 用法：node build-data.mjs --parsed <解析结果目录> --kb ..\outputs\index.html --out <输出目录>
//
// 同时做两件核对：
//   ① 菜单里的菜，有多少已经在菜品知识库里（能对上 dishId）；
//   ② 有多少是库里没有的新菜（要补进知识库并推断标签）——单独列出来，不自动写库。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const parsedDir = flag('parsed');
const kbFile = flag('kb');
const outDir = flag('out');
if(!parsedDir || !kbFile || !outDir){ console.error('用法：node build-data.mjs --parsed <目录> --kb <index.html> --out <目录>'); process.exit(1); }

// 从页面里取菜品库（只取名字/菜系/价格/角色，用来做匹配）
const html = fs.readFileSync(kbFile, 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const m = /const DISHES = \[([\s\S]*?)\n\];/.exec(code);
if(!m){ console.error('没在页面里找到 DISHES 菜品库'); process.exit(1); }
const DISHES = new Function('return [' + m[1] + '];')();
console.log('知识库现有 ' + DISHES.length + ' 道菜');

// 把菜单菜名和知识库菜名归一化后比对（去掉规格、斜杠、括号、常见后缀词）
const norm = s => String(s || '')
  // 注意：括号里的"（小份）/（大份）"要**保留**——那是不同的菜，删了会把它俩并成一条
  .replace(/[（）()\s]/g, '')
  .replace(/\s|\/|·|／/g, '')
  .replace(/(盖浇饭|盖浇)$/, '饭')       // 盖浇饭 = 盖饭
  .replace(/米粉|河粉|米线/g, '粉');
const kbIndex = new Map();
DISHES.forEach(d => { const k = norm(d.name); if(!kbIndex.has(k)) kbIndex.set(k, []); kbIndex.get(k).push(d); });

const files = fs.readdirSync(parsedDir).filter(f => f.endsWith('.json'));
const shops = [];
const newDishes = [];
for(const f of files){
  const p = JSON.parse(fs.readFileSync(path.join(parsedDir, f), 'utf8'));
  const menu = [];
  for(const it of p.items || []){
    const k = norm(it.name);
    let hit = (kbIndex.get(k) || [])[0] || null;
    /* 允许"只差规格后缀"的前缀匹配，其余一律算新菜。
     * 之前放得太松，出现过"回锅肉盖浇饭"配到"回锅肉"、"卤蛋"配到"卤蛋卤肉饭"这种错配——
     * 菜单上的菜配错库里的菜，比配不上还糟。 */
    if(!hit){
      const specOnly = /^(小份|大份|中份|一份|套餐|加饭|加蛋|加肉|大|小)$/;
      for(const [kk, arr] of kbIndex){
        if(kk.length < 3) continue;
        const extra = k.indexOf(kk) === 0 ? k.slice(kk.length) : (kk.indexOf(k) === 0 ? kk.slice(k.length) : null);
        if(extra !== null && (extra === '' || specOnly.test(extra))){ hit = arr[0]; break; }
      }
    }
    const entry = { name: it.name, price: it.price, cat: it.cat || '' };
    if(hit){ entry.dishId = hit.id; entry.kbName = hit.name; }
    else { entry.isNew = true; newDishes.push({ shop:p.shop || path.basename(f, '.json'), name:it.name, price:it.price, cat:it.cat || '' }); }
    menu.push(entry);
  }
  shops.push({
    id: 'local-' + path.basename(f, '.json'),
    name: p.shop || path.basename(f, '.json'),
    city: p.city || '保定',
    confidence: 'confirmed',              // confirmed = 菜单是实际采集来的，不是推断
    source: p.source || '自己拍菜单',
    collectedAt: p.collectedAt || '',
    image: p.image || '',
    menu,
    uncertain: p.uncertain || []
  });
}

fs.mkdirSync(outDir, { recursive: true });
const db = { version:1, updatedAt:new Date().toISOString().slice(0,10), shops };
fs.writeFileSync(path.join(outDir, 'shops.json'), JSON.stringify(db, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, '新菜候选.json'), JSON.stringify({ generatedAt:db.updatedAt, dishes:newDishes }, null, 2), 'utf8');

/* 顺手把数据库快照写进页面。
 * 为什么需要：用 file:// 直接打开本机 html 时，浏览器不允许 fetch 本地 json（CORS），
 * 没有这份快照就只能在服务器上才生效。页面优先用 fetch 到的 data/shops.json（你改了立刻生效），
 * fetch 不到才用这份快照。 */
{
  const kb = fs.readFileSync(kbFile, 'utf8');
  const block = '/* SHOP_DB_BUILTIN:BEGIN —— 下面这一块由 开发脚本/build-data.mjs 自动写入，别手工改 */\n' +
    'const SHOP_DB_BUILTIN = ' + JSON.stringify(db) + ';\n' +
    '/* SHOP_DB_BUILTIN:END */';
  const re = /\/\* SHOP_DB_BUILTIN:BEGIN[\s\S]*?SHOP_DB_BUILTIN:END \*\//;
  if(!re.test(kb)){ console.error('⚠️ 页面里没找到 SHOP_DB_BUILTIN 标记，跳过写快照'); }
  else {
    fs.writeFileSync(kbFile, kb.replace(re, block), 'utf8');
    console.log('已把数据库快照写进 ' + kbFile + '（' + Math.round(block.length / 1024) + ' KB）');
  }
}

const total = shops.reduce((n, s) => n + s.menu.length, 0);
const matched = shops.reduce((n, s) => n + s.menu.filter(i => i.dishId).length, 0);
console.log('写入 ' + shops.length + ' 家店，菜单共 ' + total + ' 条');
console.log('  能对上知识库：' + matched + ' 条');
console.log('  知识库里没有的新菜：' + newDishes.length + ' 条 → 新菜候选.json');
console.log('输出目录：' + outDir);
newDishes.slice(0, 40).forEach(d => console.log('    · ' + d.name + '（' + d.cat + ' ¥' + d.price + '）'));
