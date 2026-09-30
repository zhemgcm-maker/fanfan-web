import fs from 'node:fs';

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
/* 数据（菜品库/城市/词表）现在在 index.html 同目录的 data/db.js 里，跑测试要一起加载 */
const _dataDir = String(file).replace(/[^\\/]+$/, '');
const _dbSrc = fs.existsSync(_dataDir + 'data/db.js') ? fs.readFileSync(_dataDir + 'data/db.js', 'utf8') : '';
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
/* 数据文件（菜品库/城市/词表）也要过一遍语法：数据里少个引号、多一个逗号，
 * 这里会当场报出来（以前数据内联在页面里，是靠页面那一遍顺带查的）。 */
if (_dbSrc) blocks.push(_dbSrc);
/* 下面的静态计数把数据文件的内容也算进来（菜品数、用到的菜系都要从 data/db.js 里数） */
const all = html + '\n' + _dbSrc;

if (!blocks.length) {
  console.error('NO_SCRIPT_FOUND');
  process.exit(1);
}

let ok = true;
blocks.forEach((code, i) => {
  try {
    // 只编译不执行，用来抓语法错误
    new Function(code);
    console.log(`script[${i}] syntax OK (${code.length} chars)`);
  } catch (err) {
    ok = false;
    console.error(`script[${i}] SYNTAX ERROR: ${err.message}`);
  }
});

// 顺手做几个静态一致性检查
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log('duplicate ids:', dupes.length ? [...new Set(dupes)].join(', ') : 'none');

const missing = [];
for (const m of html.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) {
  if (!ids.includes(m[1])) missing.push(m[1]);
}
console.log('missing DOM ids referenced by JS:', missing.length ? [...new Set(missing)].join(', ') : 'none');

/* 数菜品/菜系：只在"菜品库那一段"里数——数据现在在 data/db.js 的 dishes 数组里，
 * 直接全文正则会把档位（TIERS）、类别（CATS）之类的 id 也数进去。 */
function dishesSegment(){
  const src = _dbSrc || all;
  const at = src.indexOf('"dishes"') === -1 ? src.indexOf('const DISHES') : src.indexOf('"dishes"');
  if (at === -1) return '';
  let i = src.indexOf('[', at), depth = 0, str = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '[') { depth++; continue; }
    if (c === ']') { depth--; if (depth === 0) break; }
  }
  return src.slice(src.indexOf('[', at), i);
}
const dishSeg = dishesSegment();
const dishIds = [...dishSeg.matchAll(/[{,"']\s*(?:"id"|id)\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
console.log('dishes:', dishIds.length);
const restIds = [...all.matchAll(/[{,"]\s*id['"]?\s*:\s*['"](r\d\d)['"]/g)].map(m => m[1]);
console.log('restaurants:', restIds.length);

const sigRefs = [...all.matchAll(/sig["']?\s*:\s*\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]));
const unknownSig = [...new Set(sigRefs.filter(id => !dishIds.includes(id)))];
console.log('signature dish ids not in dish table:', unknownSig.length ? unknownSig.join(', ') : 'none');

const cuiValues = [...new Set([...dishSeg.matchAll(/(?:"cui"|cui)\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
console.log('cuisines used by dishes:', cuiValues.join(', '));

process.exit(ok ? 0 : 1);
