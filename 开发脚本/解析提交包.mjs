// 把用户在「发现美食 › 提交你搜集的菜单」里导出的 JSON，还原成"图片 + 菜单骨架"
//
// 为什么要有这一步：收件接口（后端 /api/submit）还没开通的时候，
// 用户可以点「导出」把这一条存成一个 .json 文件，用微信发给我们；
// 这个脚本把里面的图片取出来落到磁盘，剩下的交给现成的识别/入库链路。
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

const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
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
    submittedAt: s.at ? new Date(s.at).toISOString() : '',
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
