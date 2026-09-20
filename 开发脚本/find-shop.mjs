// 找一个品牌/关键词附近的店（采集菜单前先用它定位，顺便拿到高德 POI ID）
// 用法：node find-shop.mjs "沙县小吃" --at "华北电力大学保定二校区" [--radius 3000] [--city 130600]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const keyword = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--at' &&
                               args[args.indexOf(a) - 1] !== '--radius' && args[args.indexOf(a) - 1] !== '--city');
const at = flag('at');
const radius = Number(flag('radius') || 3000);
const city = flag('city') || '130600';
if(!keyword){ console.error('用法：node find-shop.mjs "沙县小吃" --at "华北电力大学保定二校区" [--radius 3000]'); process.exit(1); }

const html = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', 'outputs', 'index.html'), 'utf8');
const KEY = process.env.AMAP_KEY || /const DEFAULT_AMAP_KEY = '([0-9a-f]{32})'/.exec(html)[1];

async function api(p, params){
  const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const j = await (await fetch('https://restapi.amap.com/v3/' + p + '?key=' + KEY + '&' + qs)).json();
  if(j.status !== '1') throw new Error(p + ' 失败：' + j.info + '（' + j.infocode + '）');
  return j;
}

let center = null, centerLabel = '';
if(at){
  const g = await api('geocode/geo', { address: at, city });
  if(!g.geocodes || !g.geocodes.length) throw new Error('地址解析不出来：' + at);
  center = g.geocodes[0].location;
  centerLabel = g.geocodes[0].formatted_address;
  console.log('定位：' + at + ' → ' + centerLabel + '（' + center + '）\n');
}

const j = await api('place/around', {
  location: center || '115.4646,38.8740', keywords: keyword,
  radius: String(radius), types: '050000', offset: '25', page: '1', extensions: 'all', sortrule: 'distance'
});
const pois = (j.pois || []).filter(p => String(p.name).indexOf(keyword) !== -1);
console.log('【' + keyword + '】' + Math.round(radius / 1000) + 'km 内 ' + j.count + ' 家，名字对得上的 ' + pois.length + ' 家：');
pois.forEach(p => {
  const b = p.biz_ext || {};
  console.log('  · ' + p.name);
  console.log('      高德ID ' + p.id + ' ｜ ' + Math.round(Number(p.distance || 0)) + 'm ｜ 人均 ¥' + (b.cost || '—') + ' ｜ 评分 ' + (b.rating || '—'));
  console.log('      地址 ' + (p.address || p.adname || '') + ' ｜ 电话 ' + (typeof p.tel === 'string' && p.tel ? p.tel : '—'));
});
console.log('\n提示：把高德ID记进 data/shops.json 的 amapId 字段，这家店就能被精确匹配（本店确认），不用靠店名模糊匹配。');
