// 冗余体检：找出页面里"定义了但没人用"的东西
//   ① JS 死代码：只声明、全文没有任何引用的函数/变量
//   ② 没用到的 CSS 类
//   ③ HTML 上孤立 id（JS、CSS 都不引用）
//   ④ 反向检查：JS 引用了但 HTML 里不存在的 id（写错的坑）
// 用法：node scan-redundant.mjs ..\outputs\index.html
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const lines = html.split('\n');
const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const jsBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const noJs = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const rest = html.replace(/<style>[\s\S]*?<\/style>/g, '');   // 结构与 JS 都在，用来查类名有没有被用到

let problems = 0;

/* ---------- ① JS 死代码 ---------- */
const declRe = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const decls = [];
lines.forEach((line, i) => {
  const m = declRe.exec(line);
  if (m && (m[1] || m[2])) decls.push({ name: m[1] || m[2], line: i + 1, kind: m[1] ? 'function' : 'var' });
});
const dead = [];
const seen = new Set();
for (const d of decls) {
  if (seen.has(d.name)) continue;
  seen.add(d.name);
  const n = (html.match(new RegExp('\\b' + d.name.replace(/\$/g, '\\$') + '\\b', 'g')) || []).length;
  if (n === 1) dead.push(d);
}
console.log('① JS 死代码（只有声明、全文没引用）：' + dead.length + ' 个');
dead.forEach(d => console.log('     ' + String(d.line).padStart(5) + '  [' + d.kind + '] ' + d.name));
problems += dead.length;

/* ---------- ② 没用到的 CSS 类 ---------- */
const cssClasses = new Set();
for (const m of styleBlocks.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);
const unusedCss = [...cssClasses].filter(c => {
  const rx = new RegExp('["\'\\s.]' + c.replace(/-/g, '\\-') + '(?![\\w-])');
  return !rx.test(rest);
});
console.log('\n② 定义了但没用到的 CSS 类：' + unusedCss.length + ' 个');
console.log('     ' + unusedCss.join('  '));
problems += unusedCss.length;

/* ---------- ③ / ④ id 双向检查 ---------- */
const ids = [...new Set([...noJs.matchAll(/id="([^"]+)"/g)].map(m => m[1]))];
const orphan = ids.filter(id => {
  const rx = new RegExp('#' + id.replace(/-/g, '\\-') + '(?![\\w-])');
  return !rx.test(jsBlocks) && !rx.test(styleBlocks);
});
const jsRefs = [...new Set([...jsBlocks.matchAll(/\$\('#([^']+)'\)/g)].map(m => m[1]))];
const missing = jsRefs.filter(id => ids.indexOf(id) === -1);
console.log('\n③ HTML 里没有 JS/CSS 引用的 id：' + orphan.length + ' 个（无害，可留着当锚点）');
console.log('     ' + orphan.join('  '));
console.log('④ JS 引用但 HTML 里不存在的 id：' + missing.length + ' 个（若是动态生成的就算正常）');
console.log('     ' + missing.join('  '));

console.log('\n合计需要处理的项：' + problems + ' 个');
