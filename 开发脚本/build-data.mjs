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
    /* 采集来的菜单经常跟知识库叫法不一样（菜单写"麻辣水煮鱼"，库里那道菜叫"水煮鱼"）。
     * 这种就在解析结果里写 sameAs:'水煮鱼' 显式指过去——比放宽模糊匹配安全，
     * 因为模糊匹配会出"回锅肉盖浇饭 ↦ 回锅肉"这种错配。 */
    let hit = it.sameAs ? ((kbIndex.get(norm(it.sameAs)) || [])[0] || null) : null;
    if(!hit && !it.sameAs) hit = (kbIndex.get(k) || [])[0] || null;
    if(!hit && it.sameAs){
      const byName = DISHES.find(d => d.name === it.sameAs);
      if(byName){ hit = byName; }
      else console.log('  ⚠️ sameAs 指向的菜不存在：' + it.name + ' → ' + it.sameAs);
    }
    /* 允许"只差规格后缀"的前缀匹配，其余一律算新菜。
     * 之前放得太松，出现过"回锅肉盖浇饭"配到"回锅肉"、"卤蛋"配到"卤蛋卤肉饭"这种错配——
     * 菜单上的菜配错库里的菜，比配不上还糟。 */
    if(!hit && !it.sameAs){
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
    /* scope 决定这份菜单的作用范围：
     *   branch = 本店确认（在某一家分店实拍，amapId 精确绑定，只对那一家生效）
     *   brand  = 品牌参照（同品牌同名分店共用，价格标成参考价；跨城市不共享）
     * 没写 scope 时：绑了 amapId 就算本店确认，否则算品牌参照。 */
    scope: p.scope || (p.amapId ? 'branch' : 'brand'),
    amapId: p.amapId || '',
    branchName: p.branchName || '',
    /* cuisineRef：这份菜单还愿意给哪些菜系当参照（同城、别的店没采集过时用）。
     * 例：女掌柜土家菜馆 cuisineRef:['川'] —— 保定的川菜馆没采集过菜单时，
     * 可以拿它当"这类店通常有什么菜"的参考。只做加法，不当封闭菜单。 */
    cuisineRef: p.cuisineRef || [],
    /* cuisineRefKeys：按"店名/店铺标签关键词"认的参照（盖饭、盖浇饭、浇头面这类）。
     * 为什么不能只按菜系：程序把"熊麻婆现炒浇头面.饭(保定市永华北大街店)"推成了「保定」
     * （店名里带城市名），黄焖鸡米饭这类被判成「西」——光靠菜系挂不住同类店。 */
    cuisineRefKeys: p.cuisineRefKeys || [],
    /* cuisineRefWhole：被上面这些关键词命中的同类店，可以整份借这份菜单（不再逐道比菜的菜系）。
     * 肉蟹煲这类菜只能用这个：高德给肉蟹煲店的是"中餐厅"，程序推成「家常」，菜却按江浙/川写。 */
    cuisineRefWhole: !!p.cuisineRefWhole,
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
