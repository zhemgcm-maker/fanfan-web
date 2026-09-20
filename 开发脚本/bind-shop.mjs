// 把一份采集结果绑定到具体分店（本店确认），或者退回品牌参照
// 用法：
//   node bind-shop.mjs <解析结果.json> --amapId B0H06MD6IH --branch "沙县小吃(金源南街店)" --city 保定
//   node bind-shop.mjs <解析结果.json> --scope brand          # 退回品牌参照（清掉 amapId）
//
// 绑定后请再跑一次 build-data.mjs 才会写进 data/shops.json 和页面快照。
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const file = args.find(a => !a.startsWith('--') && ['--amapId','--branch','--city','--scope'].indexOf(args[args.indexOf(a) - 1]) === -1);
if(!file){ console.error('用法：node bind-shop.mjs <解析结果.json> --amapId <高德ID> [--branch 店名] [--city 城市]'); process.exit(1); }

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const scope = flag('scope');
if(scope === 'brand'){
  j.scope = 'brand';
  delete j.amapId;
  console.log('已改成品牌参照（清掉 amapId）');
}else{
  const amapId = flag('amapId');
  if(!amapId){ console.error('要么给 --amapId，要么给 --scope brand'); process.exit(1); }
  j.scope = 'branch';
  j.amapId = amapId;
  if(flag('branch')) j.branchName = flag('branch');
  if(flag('city')) j.city = flag('city');
  console.log('已绑定本店确认：' + (j.shop || '') + ' → 高德ID ' + amapId + (j.branchName ? '（' + j.branchName + '）' : ''));
}
fs.writeFileSync(file, JSON.stringify(j, null, 2), 'utf8');
console.log('写回：' + file);
console.log('接着跑：node build-data.mjs --parsed <解析结果目录> --kb ..\\outputs\\index.html --out _数据');
