// 对着 OCR 原文把"没配到价格"的菜补上价格（确定性做法，**不调大模型**）
//
// 为什么需要它：菜单照片常有分栏，OCR 会把几道菜并成一行——
//   素炒青菜 4 元鼢蒜蓉西兰花 5 元鼢大盘鸡块 6 元
// 大模型经常只认出第一道，剩下的价格就丢了。其实价格**就在原文里**，
// 这个脚本按"菜名后面紧跟的数字+元"来配，并且把出处原文一并打印出来供人工核对。
//
// 用法：
//   node 开发脚本/对照原文补价格.mjs <识别结果.json> [--dry]
//   会自动找同目录下的 *.ocr.txt（import-menu 生成的）
//
// 规矩（和 import-menu 一致）：价格必须来自原文，配不到就保持 null，绝不猜。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dry = args.indexOf('--dry') !== -1;
const file = args.find(a => !a.startsWith('--'));
if(!file){ console.error('用法：node 开发脚本/对照原文补价格.mjs <识别结果.json> [--dry]'); process.exit(1); }
if(!fs.existsSync(file)){ console.error('找不到文件：' + file); process.exit(1); }

const dir = path.dirname(path.resolve(file));
const ocrFiles = fs.readdirSync(dir).filter(f => /\.ocr\.txt$/i.test(f)).map(f => path.join(dir, f));
if(!ocrFiles.length){ console.error('同目录下没找到 *.ocr.txt（import-menu 跑完会生成，用来核对价格出处）'); process.exit(1); }

/* OCR 原文按行读进来：格式 y<TAB>x<TAB>文字 */
const lines = [];
for(const f of ocrFiles){
  fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).forEach(l => {
    const m = /^(\d+)\t(\d+)\t([\s\S]*)$/.exec(l);
    if(m) lines.push({ page:path.basename(f).replace(/\.ocr\.txt$/i, ''), y:+m[1], x:+m[2], t:m[3].trim() });
  });
}

/* 价格有两种排版，都要认：
 *   ① 一道菜一个价：  总督豆腐 5 元
 *   ② 小份/大份一行两个价：猪肉白菜水饺 10 元 12 元   ← 分栏排版 OCR 并成一行了
 * 所以：菜名后面把**所有**「数字+元」都抓出来，按条目的（小份）/（大份）取第 1 / 第 2 个。 */
const yuanLike = /[元无兀]/;
// "1 1 元" 这种被空格拆开的数字先合上（OCR 常干）
const joinDigits = t => t.replace(/(\d)\s+(?=\d)/g, '$1');

/* 一行两个价时，谁是"大份"谁是"小份"不能靠位置猜：菜单有写"10 元 12 元"的（小在前），
 * 也有写"大 10 元小 9 元"的（大在前，实测踩到过，两种都被搞反）。
 * 所以看每个价格**前面 8 个字里有没有"大/小"**，原文自己会说明白。 */
function pricesAfter(line, base){
  const t = joinDigits(line);
  const at = t.indexOf(base);
  if(at === -1) return null;
  const seg = t.slice(at + base.length, at + base.length + 60);
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*([元无兀])/g;
  let m;
  while((m = re.exec(seg))){
    if(yuanLike.test(m[2])){
      const p = Number(m[1]);
      if(!isFinite(p) || p <= 0 || p >= 500) continue;
      /* 取**离这个价格最近**的那个"大/小"标记：
       * "大 10 元小 9 元" 里，9 前面既有"大"（更远）也有"小"（更近），该算小份。
       * 用窗口里"有没有大"来判断会把它算成大份（踩过）。 */
      const before = seg.slice(Math.max(0, m.index - 8), m.index);
      const d = before.lastIndexOf('大'), x = before.lastIndexOf('小');
      out.push({ price:p, size: (d === -1 && x === -1) ? '' : (d > x ? '大' : '小') });
    }
  }
  /* 原文里"元"被认丢的情况（"大盘鸡块 6 艹"）：菜名后面紧跟着的孤立数字也收，
   * 但标记成"没写元"，让人核对。 */
  if(!out.length){
    /* 允许菜名后面先跟 1~2 个认花的字再是数字：OCR 把"干豆腐 6 元"认成"干豆镉 6"这种 */
    const m2 = /^\s*\S{0,2}\s*(\d+(?:\.\d+)?)/.exec(seg);
    if(m2){
      const p = Number(m2[1]);
      if(isFinite(p) && p > 0 && p < 500) return { list:[{ price:p, size:'' }], loose:true };
    }
    return { list:[], loose:false };
  }
  return { list:out, loose:false };
}

/* 条目名可能是「担担面（小份）」这种，去掉规格后缀再去原文里找。
 * OCR 经常把菜名认错一个字（水饺→水皎/水茂、猪肉玉米水饺→猪肉玉米水），
 * 所以按"从全名到少两个字"逐级尝试前缀，命中即止（前缀至少 3 个字，避免"猪肉"这种撞车）。 */
function findPrice(itemName){
  /* 名字里常带括号说明："板面（宽/细，大份）"、"饺子（猪肉大葱）"。
   * 先剥掉所有括号内容得到"核心菜名"（板面 / 饺子），再去原文里找。 */
  const base = itemName
    .replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
    .replace(/[，,、\/／].*$/, '')
    .replace(/\s+/g, '');
  if(base.length < 2) return null;
  /* 要哪一档：原文里写的是"大份/小份"，有的写成"大/小" */
  const want = /大份/.test(itemName) ? '大' : (/小份/.test(itemName) ? '小' : '');
  for(const L of lines){
    /* 能砍几个字：长名字（≥4 字）最多砍 2 个，短名字（3 字）只能砍 1 个，
     * 再短就不敢砍了（"干豆"砍成"干"会撞车）。以前一刀切要求前缀≥3 字，
     * 结果"干豆腐"这种三字菜名永远匹配不上被认花的"干豆镉"。 */
    const minLen = Math.max(2, base.length - (base.length >= 4 ? 2 : 1));
    for(let len = base.length; len >= minLen; len--){
      const probe = base.slice(0, len);
      const got = pricesAfter(L.t, probe);
      if(!got || !got.list.length) continue;
      const list = got.list;
      /* 要（大份）就找原文标了「大」的那个价，要（小份）就找标了「小」的；
       * 原文没标大小（"10 元 12 元"）才退回按位置：第 1 个是小份、第 2 个是大份。 */
      let hit = null;
      if(want) hit = list.find(x => x.size === want) || null;
      if(!hit){
        const idx = want === '大' ? Math.min(1, list.length - 1) : 0;
        hit = list[idx];
      }
      if(hit && hit.price != null){
        return { price:hit.price, from:L.t, page:L.page, y:L.y,
                 候选价:list.map(x => x.size ? x.size + ':' + x.price : x.price),
                 没写元:got.loose, 用前缀:probe };
      }
    }
  }
  return null;
}

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const unfilled = (j.items || []).filter(i => i.price == null);
const hit = [], miss = [];
for(const it of unfilled){
  const r = findPrice(it.name);
  if(r){
    it.price = r.price;
    it.priceY = r.y;
    it.pricePage = r.page;
    it.priceFrom = 'OCR 原文：' + r.from + (r.用前缀 && r.用前缀 !== it.name.replace(/（.*?）/, '') ? '（菜名按前几个字匹配的）' : '');
    /* 原文里连"元"都没写出来的，不敢说核对过 —— 留个标记让人看一眼 */
    it.priceVerified = !r.没写元;
    if(r.没写元) it.priceNote = '原文这个价没写"元"字，请核对';
    hit.push({ name:it.name, ...r });
  }
  else miss.push(it.name);
}

console.log('原文里配到价格的：' + hit.length + ' 道');
hit.forEach(x => console.log('   ¥' + x.price + '  ' + x.name + '   ← ' + x.from +
  (x.没写元 ? '   ⚠️ 原文没写"元"，请核对' : '') +
  (x.用前缀 && x.用前缀 !== x.name.replace(/（.*?）/, '') ? '   （菜名认花了，按「' + x.用前缀 + '」匹配）' : '')));
if(miss.length){
  console.log('');
  console.log('还是没配到（要人工对着照片补）的 ' + miss.length + ' 道：');
  miss.forEach(n => console.log('   · ' + n));
}

if(dry){
  console.log('');
  console.log('（--dry：没有写文件）');
}else{
  fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
  const priced = (j.items || []).filter(i => typeof i.price === 'number').length;
  console.log('');
  console.log('已写回 ' + file + '：' + (j.items || []).length + ' 道里 ' + priced + ' 道有价格');
}
