// 实测：地理编码 + 保定市真实饭店数据（OpenStreetMap）
const UA = 'MealAgentDemo/1.0 (personal demo; contact: local user)';

async function probe(label, url, headers = {}) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    const cors = res.headers.get('access-control-allow-origin');
    const body = await res.text();
    console.log(`\n[${label}] HTTP ${res.status} · ${Date.now() - t}ms · CORS: ${cors === null ? '（无）' : cors}`);
    console.log('  ' + body.slice(0, 320).replace(/\s+/g, ' '));
    return { status: res.status, body };
  } catch (e) {
    console.log(`\n[${label}] 失败: ${e.cause?.message || e.message}`);
    return { error: true };
  }
}

// 1) 地理编码：保定市几个地标
for (const q of ['保定市裕华路', '河北大学', '保定东站']) {
  await probe('Nominatim: ' + q,
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=cn&q=' + encodeURIComponent(q));
}

// 2) Overpass：保定市中心（直隶总督署一带）1.5km 内的餐饮 POI
const overpassQuery = `[out:json][timeout:25];
(
  node["amenity"~"^(restaurant|fast_food|cafe)$"](around:1500,38.8740,115.4646);
  way["amenity"~"^(restaurant|fast_food|cafe)$"](around:1500,38.8740,115.4646);
);
out center 60;`;

for (const endpoint of [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
]) {
  const r = await probe('Overpass ' + new URL(endpoint).host,
    endpoint + '?data=' + encodeURIComponent(overpassQuery));
  if (!r.error && r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      const names = j.elements.map(e => e.tags && (e.tags.name || e.tags['name:zh'])).filter(Boolean);
      console.log('  元素数: ' + j.elements.length + '，有名字的: ' + names.length);
      console.log('  示例: ' + names.slice(0, 12).join(' / '));
      const cuisines = [...new Set(j.elements.map(e => e.tags?.cuisine).filter(Boolean))];
      console.log('  cuisine 标签: ' + (cuisines.slice(0, 12).join(', ') || '（无）'));
    } catch (e) { console.log('  解析失败: ' + e.message); }
  }
}
