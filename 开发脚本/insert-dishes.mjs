// 把生成好的新菜记录插进菜品库（插在 dishes 数组末尾）
// 菜品库现在住在 index.html 同目录的 data/db.js 里——这就是"数据外置"之后唯一要改的地方：
// 以前往 index.html 里的 DISHES 数组写，现在往 data/db.js 的 dishes 数组写。
// 用法：node insert-dishes.mjs --kb index.html --records data\新菜记录.json
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const kbFile = flag('kb'), recFile = flag('records');
if(!kbFile || !recFile){ console.error('用法：node insert-dishes.mjs --kb <index.html> --records <新菜记录.json>'); process.exit(1); }

/* 数据文件在 index.html 的同目录 */
const dbFile = String(kbFile).replace(/[^\\/]+$/, '') + 'data/db.js';
if(!fs.existsSync(dbFile)){ console.error('找不到 ' + dbFile + '（菜品库在 data/db.js 里）'); process.exit(1); }
let src = fs.readFileSync(dbFile, 'utf8');
const records = JSON.parse(fs.readFileSync(recFile, 'utf8')).records;
if(!records.length){ console.error('没有要插入的记录'); process.exit(1); }

/* 防重复插入：id 不能重，**同名也要看库**——
 * "四喜丸子"在大库和校内档口库里各有一条是正常的（两个菜库严格隔离），
 * 只按名字去重会把"校内版四喜丸子"当成重复项直接跳过（实测踩到）。
 * 所以判重键是「库 + 名字」：campus|四喜丸子 和 db|四喜丸子 是两道菜。 */
const DISHES = new Function(src + '\nreturn FANFAN_DB.dishes;')();
const keyOf = (name, place) => ((place === 'campus') ? 'campus|' : 'db|') + name;
const haveIds = new Set(DISHES.map(d => d.id));
const haveKeys = new Set(DISHES.map(d => keyOf(d.name, d.place)));
const fresh = records.filter(r => !haveIds.has(r.id) && !haveKeys.has(keyOf(r.name, r.place)));
if(!fresh.length){ console.log('记录都已经在库里了，无需插入'); process.exit(0); }

const lines = fresh.map(r => {
  const o = { id:r.id, name:r.name, cat:r.cat };
  if(r.role && r.role !== 'single') o.role = r.role;      // single 是默认值，不写
  /* place 一定要带：'campus' = 食堂档口的菜。以前这里漏了它，
   * 结果校内档口的新菜全落进"大库"，在校内模式里被 dishInPlace 判定"不能用"。 */
  if(r.place) o.place = r.place;
  o.cui = r.cui; o.price = r.price; o.spicy = r.spicy;
  o.tags = r.tags || []; o.alg = r.alg || []; o.desc = r.desc || ''; o.hot = r.hot || 60;
  return '    // —— 由「商家数据库」采集写入：' + r.name + '\n    ' + JSON.stringify(o) + ',';
}).join('\n');

/* 找到 dishes 数组的收尾括号：从 "dishes": [ 开始做括号配对（跳过字符串里的括号） */
const start = src.indexOf('"dishes": [');
if(start === -1){ console.error('data/db.js 里找不到 dishes 数组'); process.exit(1); }
let i = src.indexOf('[', start), depth = 0, str = null, closeIdx = -1;
for(; i < src.length; i++){
  const c = src[i];
  if(str){ if(c === '\\'){ i++; continue; } if(c === str) str = null; continue; }
  if(c === '"'){ str = c; continue; }
  if(c === '['){ depth++; continue; }
  if(c === ']'){ depth--; if(depth === 0){ closeIdx = i; break; } }
}
if(closeIdx === -1){ console.error('没找到 dishes 数组的结尾，未插入'); process.exit(1); }

/* 数组最后一个元素后面是没有逗号的（正常写法），直接往它后面接新元素会变成 `} {` 语法错误。
 * 所以先看收尾括号前面最后一个可见字符：不是逗号（也不是刚开的括号）就补一个。 */
let head = src.slice(0, closeIdx);
const tailChar = /(\S)(\s*)$/.exec(head);
if(tailChar && tailChar[1] !== ',' && tailChar[1] !== '['){
  head = head.slice(0, tailChar.index + 1) + ',' + tailChar[2];
}

src = head + lines + '\n  ' + src.slice(closeIdx);
fs.writeFileSync(dbFile, src, 'utf8');
console.log('已插入 ' + fresh.length + ' 道新菜（' + fresh[0].id + ' … ' + fresh[fresh.length - 1].id + '）');
console.log('写入的是 ' + dbFile + '（index.html 不用改）');
