// 把 index.html 里的菜品知识库导出来看：
//   ① 终端打印统计（每个类别多少道、每个菜系多少道、价格区间）
//   ② 生成一个可以在手机浏览器里翻的「知识库.html」（搜索 + 按类别/菜系筛选）
// 用法：node dump-kb.mjs index.html [输出路径.html]
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('用法：node dump-kb.mjs index.html [输出.html]'); process.exit(1); }
const html = fs.readFileSync(src, 'utf8');

function grab(re, label) {
  const m = html.match(re);
  if (!m) { console.error('没找到' + label); process.exit(1); }
  return m[1];
}
// 数组/对象字面量在页面里是纯数据，直接当表达式求值最稳（比正则抠字段可靠）
const evalLit = (code) => new Function('return ' + code)();

const DISHES = evalLit(grab(/const DISHES = (\[[\s\S]*?\n\]);/, 'DISHES'));
const CATS = evalLit(grab(/const CATS = (\[[\s\S]*?\n\]);/, 'CATS'));
const TIERS = evalLit(grab(/const TIERS = (\[[\s\S]*?\n\]);/, 'TIERS'));
const CAT_CRAVE_TAGS = evalLit(grab(/const CAT_CRAVE_TAGS = (\{[\s\S]*?\n\});/, 'CAT_CRAVE_TAGS'));

const catName = (id) => (CATS.find(c => c.id === id) || {}).name || id;
const byCat = {}, byCui = {};
DISHES.forEach(d => {
  byCat[d.cat] = (byCat[d.cat] || 0) + 1;
  byCui[d.cui] = (byCui[d.cui] || 0) + 1;
});
const prices = DISHES.map(d => d.price).sort((a, b) => a - b);
const q = (p) => prices[Math.floor((prices.length - 1) * p)];

console.log('=== 菜品知识库 ===');
console.log('总菜数：' + DISHES.length + ' 道');
console.log('按类别：' + Object.entries(byCat).map(([k, v]) => k + '=' + v).join('  ') +
            '（' + CATS.map(c => c.name).join('/') + '）');
console.log('菜系：' + Object.keys(byCui).length + ' 个 → ' +
            Object.entries(byCui).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join('、'));
console.log('价格：最低 ¥' + prices[0] + '｜中位 ¥' + q(0.5) + '｜最高 ¥' + prices[prices.length - 1]);
console.log('预算档位：' + TIERS.map(t => t.name + ' ¥' + t.min + '-' + t.max).join('｜'));
console.log('今日想吃标签：' + Object.entries(CAT_CRAVE_TAGS)
  .map(([k, v]) => catName(k) + ' ' + v.length + ' 个').join('｜'));

const out = process.argv[3] || path.join(path.dirname(src), '知识库.html');
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rows = DISHES.map(d => ({
  id: d.id, name: d.name, cat: d.cat, catName: catName(d.cat), cui: d.cui,
  price: d.price, spicy: d.spicy, tags: d.tags || [], desc: d.desc || '', hot: d.hot || 0
}));

fs.writeFileSync(out, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>菜品知识库 · ${DISHES.length} 道</title>
<style>
  :root{--bg:#0f1115;--card:#181b21;--line:#272b33;--fg:#e8eaed;--dim:#9aa3af;--hi:#ffb648}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;padding:16px 14px 40px}
  h1{font-size:19px;margin:0 0 4px}
  .sub{color:var(--dim);font-size:13px;margin-bottom:14px}
  .stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:12.5px;color:var(--dim)}
  .chip b{color:var(--fg)}
  input,select{width:100%;background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:10px;padding:11px 12px;font-size:15px;margin-bottom:10px}
  .tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:6px}
  .tab{flex:0 0 auto;background:var(--card);border:1px solid var(--line);color:var(--dim);border-radius:999px;padding:8px 14px;font-size:13.5px;cursor:pointer}
  .tab.on{background:var(--hi);border-color:var(--hi);color:#20160a;font-weight:600}
  .count{color:var(--dim);font-size:13px;margin:6px 0 12px}
  .list{display:grid;gap:9px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:11px 12px}
  .r1{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .nm{font-weight:600;font-size:15.5px}
  .pr{color:var(--hi);font-weight:700;white-space:nowrap}
  .meta{color:var(--dim);font-size:12.5px;margin-top:3px}
  .tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
  .tg{background:#22262e;border-radius:6px;padding:2px 7px;font-size:11.5px;color:#c3cad4}
  .ds{color:#b6bdc7;font-size:13px;margin-top:6px}
  .id{color:#5d6572;font-size:11px;margin-top:6px}
  .empty{color:var(--dim);text-align:center;padding:30px 0}
</style></head><body>
<h1>菜品知识库</h1>
<div class="sub">共 <b>${DISHES.length}</b> 道菜 · 来自 index.html 的 DISHES 表 · 生成于 ${new Date().toLocaleString('zh-CN')}</div>
<div class="stats">
  ${CATS.map(c => `<span class="chip">${esc(c.name)} <b>${byCat[c.id] || 0}</b></span>`).join('')}
  <span class="chip">菜系 <b>${Object.keys(byCui).length}</b></span>
  <span class="chip">价格 <b>¥${prices[0]}–¥${prices[prices.length - 1]}</b></span>
  <span class="chip">中位 <b>¥${q(0.5)}</b></span>
</div>
<input id="q" placeholder="搜菜名 / 菜系 / 标签，例如 汤面、川菜、牛肉">
<div class="tabs" id="tabs"></div>
<div class="count" id="count"></div>
<div class="list" id="list"></div>
<script>
const ALL = ${JSON.stringify(rows)};
const CATS = ${JSON.stringify(CATS.map(c => ({ id: c.id, name: c.name })))};
let cat = 'all';
const tabs = document.getElementById('tabs'), list = document.getElementById('list'), cnt = document.getElementById('count');
[ { id:'all', name:'全部' } ].concat(CATS).forEach(c => {
  const b = document.createElement('div');
  b.className = 'tab' + (c.id === cat ? ' on' : '');
  b.textContent = c.name + (c.id === 'all' ? ' ' + ALL.length : ' ' + ALL.filter(d => d.cat === c.id).length);
  b.onclick = () => { cat = c.id; render(); [...tabs.children].forEach(x => x.classList.toggle('on', x.textContent.startsWith(c.name))); };
  tabs.appendChild(b);
});
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
function render(){
  const kw = document.getElementById('q').value.trim().toLowerCase();
  const hit = ALL.filter(d => (cat === 'all' || d.cat === cat) &&
    (!kw || (d.name + d.cui + d.catName + (d.tags||[]).join('') + (d.desc||'')).toLowerCase().includes(kw)));
  cnt.textContent = '显示 ' + hit.length + ' / ' + ALL.length + ' 道';
  list.innerHTML = hit.length ? hit.map(d => '<div class="card"><div class="r1"><span class="nm">' + esc(d.name) +
    '</span><span class="pr">¥' + d.price + '</span></div>' +
    '<div class="meta">' + esc(d.catName) + ' · ' + esc(d.cui) + (d.spicy ? ' · 辣度 ' + d.spicy : ' · 不辣') + (d.hot ? ' · 热度 ' + d.hot : '') + '</div>' +
    '<div class="tags">' + (d.tags||[]).map(t => '<span class="tg">' + esc(t) + '</span>').join('') + '</div>' +
    (d.desc ? '<div class="ds">' + esc(d.desc) + '</div>' : '') +
    '<div class="id">' + esc(d.id) + '</div></div>').join('') : '<div class="empty">没有匹配的菜</div>';
}
document.getElementById('q').oninput = render;
render();
</script></body></html>
`, 'utf8');
console.log('\n已生成：' + out);
