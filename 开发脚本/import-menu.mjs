// 采集菜单：图片 → Windows OCR → DeepSeek 结构化 → JSON（给"商家数据库"用）
// 用法：node import-menu.mjs <图片或文件夹> --shop "沙县小吃" [--city 保定] [--out <目录>]
//
// 设计原则（重要）：
//   1) OCR 只负责"看见字"，大模型只负责"把字整理成结构"和"修 OCR 的错别字"（兀→元、甲鸟→鸭）；
//   2) 价格必须来自图上，对不上就填 null 并进 uncertain —— 宁可缺，不许猜；
//   3) 输出到单独文件供人工抽查，不直接改数据库。
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf('--' + name); return i === -1 ? null : args[i + 1]; };
const inputs = args.filter(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--shop' &&
                               args[args.indexOf(a) - 1] !== '--city' && args[args.indexOf(a) - 1] !== '--out');
const shopName = flag('shop') || '';
const city = flag('city') || '保定';
const outDir = flag('out') || path.join(process.cwd(), '_解析结果');

const KEY = process.env.DS_KEY || 'sk-21f864ce09aa412a81b42f06c5d38199';
const OCR_PS1 = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'ocr-image.ps1');

function listImages(p){
  const st = fs.statSync(p);
  if(st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => /\.(jpe?g|png|bmp|webp|tiff?)$/i.test(f))
    .map(f => path.join(p, f));
}
function ocr(file){
  const r = cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OCR_PS1, file, '-Blob'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if(r.status !== 0) throw new Error('OCR 失败：' + (r.stderr || '').slice(0, 200));
  return (r.stdout || '').trim();
}
// 带坐标的 OCR：每行给出 y、x、文字，用来核对"这个价格到底出自哪一行"
function ocrLayout(file){
  const r = cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OCR_PS1, file, '-Layout'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if(r.status !== 0) throw new Error('OCR 失败：' + (r.stderr || '').slice(0, 200));
  const lines = (r.stdout || '').trim().split(/\r?\n/).map(l => {
    const m = /^(\d+)\t(\d+)\t([\s\S]*)$/.exec(l);
    return m ? { y:+m[1], x:+m[2], text:m[3] } : null;
  }).filter(Boolean);
  return lines;
}

const PROMPT =
  '你是一个菜单数字化工具。用户会给你一张菜单照片经 OCR 得到的文字，格式是每行：y坐标<TAB>x坐标<TAB>文字。\n' +
  '文字里可能有错别字、多余的标点；菜单是分栏排版，一道菜的菜名和价格可能在同一行，也可能分成两行（价格那行的 y 通常大 30~70，x 更大）。\n' +
  '请把它整理成结构化菜单，只输出一个 JSON，不要解释、不要 markdown 代码块。\n' +
  'JSON 格式：\n' +
  '{"shop":"店名","items":[{"name":"菜名","price":数字或null,"cat":"分类","nameY":菜名行的y,"priceY":价格行的y}],' +
  '"uncertain":[{"name":"菜名","reason":"为什么不确定"}],"note":"整体说明"}\n' +
  '规则：\n' +
  '1) 修正 OCR 错别字：兀→元、甲鸟→鸭、犭者→猪、饨/吨→馄饨、盖漲/盖伍/盖浇→盖浇饭 等；\n' +
  '2) 菜名用规范写法，规格保留在名字里（例如"千里香馄饨（小份）"）；\n' +
  '3) **价格必须来自某一行原文的数字+元**，并写出那一行的 y 坐标（priceY）；菜名所在行的 y 写进 nameY（同一行就填一样的值）；\n' +
  '4) 找不到价格就填 null，并把这条写进 uncertain 说明原因 —— 绝对不要凭常识或记忆编价格；\n' +
  '5) 分类用简短词：馄饨/饺子/面/粉/饭/盖浇饭/汤/套餐/小吃/饮料 这类；\n' +
  '6) 促销口号、图片说明、"以实物为准"这类非菜品文字不要进 items；\n' +
  '7) 同一道菜不同规格拆成两条（小份/大份、加鸡腿/加鸭腿）；\n' +
  '8) 一行里同时出现菜名和价格的（分栏被 OCR 并成一行），按行内先后对应。';

async function structure(ocrText, hintShop){
  const body = {
    model: 'deepseek-chat',
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: (hintShop ? '店名：' + hintShop + '\n' : '') + 'OCR 文字：\n' + ocrText }
    ]
  };
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error('DeepSeek HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  const txt = j.choices[0].message.content;
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  return JSON.parse(txt.slice(a, b + 1));
}

/* 第二轮：把第一轮没配到价格的条目，拿原始 OCR 文字再对一次。
 * 关键约束：每填一个价格都必须给出"原文出处"，方便人工核对——还是那句，宁可缺，不许猜。 */
const FILL_PROMPT =
  '用户会给你一段菜单的 OCR 原文，以及一批"还没配到价格"的菜名。\n' +
  '请只在原文里确有其价时把价格补上，只输出 JSON：\n' +
  '{"filled":[{"name":"菜名","price":数字,"priceY":价格所在行的 y 坐标}]}\n' +
  '规则：\n' +
  '1) 必须指出价格在哪一行：priceY 填那一行的 y 坐标（原文每行开头就是 y）；\n' +
  '2) 那一行里必须真的有这个数字+元；\n' +
  '3) 菜单是分栏排版，价格可能离菜名很远（成组出现），只有在成组对应关系明确时才填；\n' +
  '4) 确认不了就不要放进 filled，宁可留空；\n' +
  '5) 不要参考任何菜单常识或记忆中的价格，只看这段 OCR 文字。';

async function refillPrices(ocrText, items){
  const body = {
    model: 'deepseek-chat',
    temperature: 0,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FILL_PROMPT },
      { role: 'user', content: 'OCR 原文：\n' + ocrText + '\n\n还没配到价格的菜名：\n' + items.map(i => i.name).join('\n') }
    ]
  };
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error('DeepSeek HTTP ' + res.status);
  const j = await res.json();
  const txt = j.choices[0].message.content;
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  try{ return JSON.parse(txt.slice(a, b + 1)).filled || []; }catch(e){ return []; }
}

// 同名条目合并（同一道菜在两页菜单里各出现一次时，保留有价格的那条）
function dedupe(items){
  const key = s => String(s || '').replace(/[\s（）()]/g, '').replace(/／/g, '/');
  const map = new Map();
  for(const it of items){
    const k = key(it.name);
    const prev = map.get(k);
    if(!prev) { map.set(k, it); continue; }
    if(prev.price == null && it.price != null) map.set(k, it);
  }
  return [...map.values()];
}

/* 价格核对：大模型说"这个价格来自 y=816 那一行"，我就真的去那一行看。
 * 对不上的（行不存在、那行里没有这个数字）一律把价格作废 —— 这是防止它凭常识编价格的关键一步。 */
function verifyPrices(items, lines, opts){
  const tol = (opts && opts.tol) || 120;          // 菜名行和价格行允许的最大纵向距离
  /* 菜单分栏时，同一个 y 上可能同时存在两条不同列的行（左栏价格 + 右栏价格）。
   * 所以"这一行"要用 y + x 一起定位，不能只用 y，否则会把两栏的价格当成同一个。 */
  // 价格匹配要加数字边界，"17 元"不能被当成"7 元"
  // 允许前面有个 OCR 带出来的 0（"019 元"其实还是 19 元）
  const priceRe = p => new RegExp('(^|\\D)0?' + p + '\\s*[元兀]');
  const at = y => lines.map((l, i) => ({ l, i })).filter(o => Math.abs(o.l.y - y) <= 6);
  // 先找到"菜名那一行"，拿到它的 x——菜单左右两栏的 y 可能完全一样，只有 x 能区分
  const nameX = it => {
    if(typeof it.nameY !== 'number') return null;
    const frag = String(it.name || '').replace(/[（）()]/g, '').slice(0, 3);
    const cands = at(it.nameY);
    if(!cands.length) return null;
    const withName = frag ? cands.filter(o => o.l.text.indexOf(frag) !== -1) : [];
    return (withName.length ? withName[0] : cands[0]).l.x;
  };
  const findLine = (y, price, xHint) => {
    const cands = at(y).filter(o => priceRe(price).test(o.l.text));
    if(!cands.length) return null;
    if(typeof xHint === 'number'){
      const inline = cands.find(o => Math.abs(o.l.x - xHint) <= 40);   // 菜名和价格在同一行
      if(inline) return inline.i;
      const right = cands.filter(o => o.l.x >= xHint);                 // 否则取同栏、靠右的那条
      if(right.length) return right.sort((a, b) => a.l.x - b.l.x)[0].i;
      return cands.sort((a, b) => Math.abs(a.l.x - xHint) - Math.abs(b.l.x - xHint))[0].i;
    }
    return cands[0].i;
  };
  let ok = 0, bad = 0;
  const claims = new Map();                        // 具体某一行被几道菜认领
  for(const it of items){
    if(typeof it.price !== 'number'){ it.price = null; continue; }
    const py = (typeof it.priceY === 'number') ? it.priceY : it.nameY;
    const sameLine = (typeof it.nameY === 'number' && Math.abs(py - it.nameY) <= 6);
    const tooFar = (!sameLine && typeof it.nameY === 'number' && Math.abs(py - it.nameY) > tol);
    const li = tooFar ? null : findLine(py, it.price, typeof it.priceX === 'number' ? it.priceX : nameX(it));
    if(li === null){
      it.priceNeedsReviewFrom = it.price;          // 留个痕迹：模型原本想填这个数
      it.price = null; it.priceVerified = false;
      it.priceReviewReason = tooFar ? '价格行离菜名太远（y 差 ' + Math.abs(py - it.nameY) + '）' : '它指的那一行里没有这个价格';
      bad++;
      continue;
    }
    it.priceVerified = true; ok++;
    if(!claims.has(li)) claims.set(li, []);
    claims.get(li).push(it);
  }
  // 一条价格行被两道菜同时认领 = 对应关系没搞清（常见于"4 个菜名只有 3 个价格"的分栏菜单）
  for(const [py, arr] of claims){
    if(arr.length < 2) continue;
    for(const it of arr){
      it.priceNeedsReviewFrom = it.price;
      it.price = null; it.priceVerified = false;
      it.priceReviewReason = '这一行的价格被多道菜指到（y=' + py + '），需要人工核对';
      ok--; bad++;
    }
  }
  return { ok, bad };
}

fs.mkdirSync(outDir, { recursive: true });
const files = inputs.flatMap(p => listImages(p));
console.log('待处理图片 ' + files.length + ' 张');

let done = 0;
for(const f of files){
  const base = path.basename(f).replace(/\.[^.]+$/, '');
  const slug = (shopName || base).replace(/[\\/:*?"<>|\s]+/g, '_');
  const target = path.join(outDir, slug + '.json');
  if(fs.existsSync(target)){ console.log('  跳过（已解析过）：' + base); continue; }
  process.stdout.write('  ' + base + ' → OCR … ');
  let lines = [];
  try{ lines = ocrLayout(f); }catch(e){ console.log('失败：' + e.message); continue; }
  const layoutText = lines.map(l => l.y + '\t' + l.x + '\t' + l.text).join('\n');
  process.stdout.write(lines.length + ' 行 → 大模型整理 … ');
  let parsed;
  try{ parsed = await structure(layoutText, shopName || base); }
  catch(e){ console.log('失败：' + e.message); continue; }
  parsed.image = path.basename(f);
  parsed.city = city;
  parsed.ocrChars = layoutText.length;
  parsed.source = '自己拍菜单';
  parsed.collectedAt = new Date().toISOString().slice(0, 10);
  parsed.items = dedupe(parsed.items || []);
  const v1 = verifyPrices(parsed.items, lines);   // 价格必须能在原文某一行里找到，找不到就作废
  // 第二轮：补那些没配到价格的
  const missing = parsed.items.filter(i => i.price == null);
  if(missing.length){
    process.stdout.write('（补价格 ' + missing.length + ' 条 … ');
    try{
      const filled = await refillPrices(layoutText, missing);
      const filledItems = [];
      for(const f of filled){
        const hit = parsed.items.find(i => i.name === f.name && i.price == null);
        if(!hit || typeof f.price !== 'number') continue;
        hit.price = f.price; hit.priceY = f.priceY;
        filledItems.push(hit);
      }
      const v2 = verifyPrices(filledItems, lines);   // 补的这轮同样要核对
      // 补过之后仍为空的，追加到 uncertain（保留模型自己报的那些，不要覆盖）
      parsed.uncertain = (parsed.uncertain || []).concat(
        parsed.items.filter(i => i.price == null)
          .map(i => ({ name:i.name, reason:i.priceReviewReason || '价格需要人工核对', modelSuggestedPrice:i.priceNeedsReviewFrom || null })));
      process.stdout.write('补上 ' + v2.ok + ' 条）');
    }catch(e){ process.stdout.write('补价格失败：' + e.message + '）'); }
  }
  parsed.priceCheck = { verified:v1.ok, dropped:v1.bad };
  fs.writeFileSync(target, JSON.stringify(parsed, null, 2), 'utf8');
  fs.writeFileSync(target.replace(/\.json$/, '.ocr.txt'), layoutText, 'utf8');
  const priced = (parsed.items || []).filter(i => typeof i.price === 'number').length;
  console.log('得到 ' + (parsed.items || []).length + ' 道菜（其中 ' + priced + ' 道有价格）→ ' + path.basename(target));
  done++;
}
console.log('完成 ' + done + ' 张，输出目录：' + outDir);
