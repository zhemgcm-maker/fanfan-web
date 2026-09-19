// 把生成好的新菜记录插入页面里的 DISHES 菜品库（插在数组末尾）
// 用法：node insert-dishes.mjs --kb ..\outputs\index.html --records _数据\新菜记录.json
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const kbFile = flag('kb'), recFile = flag('records');
if(!kbFile || !recFile){ console.error('用法：node insert-dishes.mjs --kb <index.html> --records <新菜记录.json>'); process.exit(1); }

const html = fs.readFileSync(kbFile, 'utf8');
const records = JSON.parse(fs.readFileSync(recFile, 'utf8')).records;
if(!records.length){ console.error('没有要插入的记录'); process.exit(1); }

// 已有的 id / 菜名，防重复插入
const arrText = /const DISHES = \[([\s\S]*?)\n\];/.exec(html)[1];
const haveIds = new Set([...arrText.matchAll(/id:'([^']+)'/g)].map(m => m[1]));
const haveNames = new Set([...arrText.matchAll(/name:'([^']+)'/g)].map(m => m[1]));
const fresh = records.filter(r => !haveIds.has(r.id) && !haveNames.has(r.name));
if(!fresh.length){ console.log('记录都已经在库里了，无需插入'); process.exit(0); }

const pad = s => { const w = [...s].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, 22 - w)); };
const lines = fresh.map(r => {
  const role = (r.role && r.role !== 'single') ? "role:'" + r.role + "', " : '';
  return '  // —— 由「商家数据库」采集写入：' + r.name + ' @ 沙县小吃\n' +
    "  { id:'" + r.id + "', name:'" + r.name + "', cat:'" + r.cat + "', " + role +
    "cui:'" + r.cui + "', price:" + r.price + ', spicy:' + r.spicy +
    ", tags:['" + r.tags.join("','") + "'], alg:" +
    ((r.alg && r.alg.length) ? "['" + r.alg.join("','") + "']" : '[]') + ',' +
    " desc:'" + r.desc + "', hot:" + r.hot + ' },';
}).join('\n');

const out = html.replace(/(const DISHES = \[[\s\S]*?)(\n\];)/,
  (m, body, tail) => body + '\n\n  /* ===== 采集入库：沙县小吃（2026-09-19 拍菜单识别）===== */\n' + lines + tail);
if(out === html){ console.error('没找到 DISHES 数组的结尾，未插入'); process.exit(1); }
fs.writeFileSync(kbFile, out, 'utf8');
console.log('已插入 ' + fresh.length + ' 道新菜（' + fresh[0].id + ' … ' + fresh[fresh.length - 1].id + '）');
