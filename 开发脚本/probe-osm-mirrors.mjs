// 逐个测 Overpass 镜像：能不能在保定搜到真实饭店
const q = '[out:json][timeout:10];node["amenity"~"^(restaurant|fast_food|cafe)$"](around:2000,38.8740,115.4646);out center 50;';
const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
for (const ep of endpoints) {
  const t = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(ep + '?data=' + encodeURIComponent(q), { signal: ctrl.signal, headers: { 'User-Agent': 'MealAgentDemo/1.0' } });
    clearTimeout(timer);
    const txt = await res.text();
    let names = [];
    try { const j = JSON.parse(txt); names = j.elements.map(e => e.tags?.name).filter(Boolean); } catch {}
    console.log(`HTTP ${res.status} · ${Date.now() - t}ms · 元素 ${names.length} · ${new URL(ep).host}`);
    if (names.length) console.log('   示例: ' + names.slice(0, 8).join(' / '));
  } catch (e) {
    console.log(`失败 · ${Date.now() - t}ms · ${new URL(ep).host} · ${e.cause?.message || e.message}`);
  }
}
