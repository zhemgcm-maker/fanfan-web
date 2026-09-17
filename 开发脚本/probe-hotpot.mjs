// 用真实高德接口探查：保定火锅店有多少家？应用现在能拿到几家？
// 用法：node probe-hotpot.mjs <关键词> [城市adcode]
const KEY = 'f54ea5a57d96f171cfd3a01451a16f30';
const kw = process.argv[2] || '火锅';
const city = process.argv[3] || '130600';
const center = process.env.CENTER || '115.4646,38.8740';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function textPage(page) {
  const u = 'https://restapi.amap.com/v3/place/text?keywords=' + encodeURIComponent(kw) +
    '&city=' + city + '&citylimit=true&offset=25&page=' + page + '&extensions=all&key=' + KEY;
  const j = await (await fetch(u)).json();
  return j;
}

const seen = new Map();
let total = null;
for (let p = 1; p <= 4; p++) {
  const j = await textPage(p);
  if (j.status !== '1') { console.log('第 ' + p + ' 页失败：' + j.info + ' ' + j.infocode); break; }
  total = j.count;
  const pois = j.pois || [];
  console.log('第 ' + p + ' 页：返回 ' + pois.length + ' 条（高德说共 ' + j.count + ' 条）');
  pois.forEach(x => { if (!seen.has(x.id)) seen.set(x.id, x); });
  if (pois.length < 25) break;
  await sleep(220);
}

console.log('\n去重后累计拿到 ' + seen.size + ' 家，高德标称共 ' + total + ' 家');
console.log('\n前 30 家名字：');
[...seen.values()].slice(0, 30).forEach((x, i) => {
  const cost = x.biz_ext && x.biz_ext.cost ? x.biz_ext.cost : '—';
  const rating = x.biz_ext && x.biz_ext.rating ? x.biz_ext.rating : '—';
  console.log('  ' + String(i + 1).padStart(2) + '. ' + x.name + ' ｜ ' + (x.adname || '') + ' ｜人均 ' + cost + ' ｜评分 ' + rating + ' ｜ ' + (x.type || ''));
});

// 周边搜索（应用也在用）
const au = 'https://restapi.amap.com/v3/place/around?location=' + center +
  '&radius=2500&types=050000&offset=25&page=1&extensions=all&sortrule=distance&key=' + KEY;
const aj = await (await fetch(au)).json();
console.log('\n周边 2.5km 餐饮：高德说共 ' + aj.count + ' 条，本页返回 ' + ((aj.pois || []).length));
