// 把「用户提交的菜单」那个 JSON 包，还原成"图片 + 人工核对单"
//
// 两种包都能吃，格式是一样的：
//   ① 后端导出的（推荐）：浏览器打开
//        https://<后端地址>/api/submit/pending?key=<审核密钥>
//      会自动存成一个 json 文件
//   ② 用户自己导的：在「发现美食 › 拍照上传菜单」面板里点「导出」，
//      他用微信发给我们（收件接口挂了、或者没登录时用这条兜底）
//
// 这个脚本只做一件事：把 base64 图片取出来落盘，并生成一份核对单；
// 后面的 OCR / 入库交给现成的 import-menu.mjs → ingest-menu.mjs → build-data.mjs。
//
// 用法：
//   node 开发脚本/解析提交包.mjs <提交包.json> [--out <目录>]
//
// 之后接着跑（这一条链是现成的）：
//   node 开发脚本/import-menu.mjs <out目录> --shop "店名"     ← 图片 → OCR → 结构化菜单
//   node 开发脚本/ingest-menu.mjs --menu <解析结果.json> --kb index.html
//   node 开发脚本/build-data.mjs                              ← 生成 data/shops.json
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
if(!file){ console.error('用法：node 开发脚本/解析提交包.mjs <提交包.json> [--out <目录>]'); process.exit(1); }

if(!fs.existsSync(file)){
  console.error('找不到这个文件：' + file);
  console.error('（路径里有空格或中文的话，要用引号把整个路径包起来，例如 "D:\\下载\\fanfan-pending.json"）');
  process.exit(1);
}
let pack;
try{
  pack = JSON.parse(fs.readFileSync(file, 'utf8'));
}catch(e){
  console.error('这个文件不是合法的 JSON：' + file);
  console.error('（要的是「审核导出」下载的那个 .json，或者用户在面板里点「导出」存下来的 .json）');
  process.exit(1);
}
const subs = Array.isArray(pack.submissions) ? pack.submissions : [];
if(!subs.length){ console.error('这个包里没有提交记录'); process.exit(1); }

const outRoot = flag('out') || path.join(path.dirname(path.resolve(file)), '提交-解析结果');
fs.mkdirSync(outRoot, { recursive:true });

/* 店名要当文件夹名，先把文件名非法字符换掉 */
const safe = s => String(s || '未命名').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
let total = 0;

for(const s of subs){
  const dir = path.join(outRoot, safe(s.shop));
  fs.mkdirSync(dir, { recursive:true });

  const images = [];
  (s.images || []).forEach((m, i) => {
    if(!m || !m.data) return;
    const buf = Buffer.from(m.data, 'base64');
    if(!buf.length) return;
    const name = String(i + 1).padStart(2, '0') + '_' + safe(m.name || 'menu').replace(/\.(jpe?g|png|webp)$/i, '') + '.jpg';
    fs.writeFileSync(path.join(dir, name), buf);
    images.push({ file:name, w:m.w || null, h:m.h || null, bytes:buf.length });
    total++;
  });

  // 顺手写一份"人工核对单"：审核时对着它填价格、确认店名，再交给 ingest-menu
  const sheet = {
    shop: s.shop || '',
    where: s.where || '',
    note: s.note || '',
    submittedAt: s.at ? new Date(Number(s.at) || s.at).toISOString() : '',
    submittedBy: s.logged || '（未登录）',
    images,
    // 这几行是给审核人填的
    review: { city:'保定', campus:'华北电力大学（保定）', canteen:'', stall:'', cuisine:'', avg:null, reviewedBy:'', reviewedAt:'' }
  };
  fs.writeFileSync(path.join(dir, '提交信息.json'), JSON.stringify(sheet, null, 2), 'utf8');
  console.log('✅ ' + (s.shop || '(没写店名)') + ' → ' + dir + '（' + images.length + ' 张图）');
  if(s.where || s.note) console.log('   位置：' + (s.where || '—') + ' ｜ 备注：' + (s.note || '—'));
}

console.log('');
console.log('共取出 ' + total + ' 张图片，放在：' + outRoot);
console.log('下一步：');
console.log('  1) 打开每家的「提交信息.json」，人工核对店名/食堂/楼层，把错的改对');
console.log('  2) node 开发脚本/import-menu.mjs "' + outRoot + '" --shop "店名"   # 图片 → OCR → 结构化菜单');
console.log('  3) 抽查解析结果里的价格（OCR 会认错字），确认后再入库');
console.log('  4) node 开发脚本/ingest-menu.mjs --menu <解析结果.json> --kb index.html');
console.log('  5) node 开发脚本/build-data.mjs && 走 push-live-full 推上线');
