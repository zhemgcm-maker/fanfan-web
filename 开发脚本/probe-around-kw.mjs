// 对比两种高德搜法：关键词搜索(place/text) vs 周边+关键词搜索(place/around)
// 目的：看哪种能在用户 3km 内拿到更多「火锅」店
const KEY = 'f54ea5a57d96f171cfd3a01451a16f30';
const center = '115.4646,38.8740';           // 保定市中心
const [lng, lat] = center.split(',').map(Number);
const kw = process.argv[2] || '火锅';

const R = 6371;
function km(lng2, lat2) {
  const dLat = (lat2 - lat) * Math.PI / 180, dLng = (lng2 - lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function around(page, radius) {
  const u = 'https://restapi.amap.com/v3/place/around?location=' + center + '&keywords=' + encodeURIComponent(kw) +
    '&types=050000&radius=' + radius + '&offset=25&page=' + page + '&extensions=all&sortrule=distance&key=' + KEY;
  return (await (await fetch(u)).json());
}

console.log('=== A. 周边搜索 + 关键词「' + kw + '」（按距离排序）===');
for (const radius of [3000, 5000]) {
  const all = new Map();
  for (let p = 1; p <= 3; p++) {
    const j = await around(p, radius);
    if (j.status !== '1') { console.log('  失败 ' + j.info); break; }
    (j.pois || []).forEach(x => { if (!all.has(x.id)) all.set(x.id, x); });
    if ((j.pois || []).length < 25) break;
    await sleep(200);
  }
  const list = [...all.values()].map(x => {
    const [x1, y1] = String(x.location).split(',').map(Number);
    return { n: x.name, d: km(x1, y1), ad: x.adname };
  }).sort((a, b) => a.d - b.d);
  console.log('半径 ' + (radius / 1000) + 'km：拿到 ' + list.length + ' 家，其中 ≤3km 的 ' + list.filter(x => x.d <= 3).length + ' 家');
  list.slice(0, 8).forEach((x, i) => console.log('   ' + (i + 1) + '. ' + x.n + ' ｜' + x.d.toFixed(2) + 'km ｜' + x.ad));
  await sleep(300);
}

console.log('\n=== B. 现状：关键词搜索第 1 页（应用目前的做法）===');
const u2 = 'https://restapi.amap.com/v3/place/text?keywords=' + encodeURIComponent(kw) +
  '&city=130600&citylimit=true&offset=25&page=1&extensions=all&key=' + KEY;
const j2 = await (await fetch(u2)).json();
const cur = (j2.pois || []).map(x => {
  const [x1, y1] = String(x.location).split(',').map(Number);
  return { n: x.name, d: km(x1, y1) };
}).filter(x => x.d <= 3).sort((a, b) => a.d - b.d);
console.log('第 1 页 25 条里，≤3km 的只有 ' + cur.length + ' 家 → 应用再截断成最多 8 家，所以你觉得翻来覆去就那么几家');
cur.forEach((x, i) => console.log('   ' + (i + 1) + '. ' + x.n + ' ｜' + x.d.toFixed(2) + 'km'));
