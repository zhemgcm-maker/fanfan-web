// 实测国内地图 Web 服务是否可达、是否带 CORS 头（决定能不能浏览器直连）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

async function probe(label, url) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Origin: 'null' } });
    const cors = res.headers.get('access-control-allow-origin');
    const body = await res.text();
    console.log(`[${label}] HTTP ${res.status} · ${Date.now() - t}ms · CORS: ${cors === null ? '（无头）' : cors}`);
    console.log('   ' + body.slice(0, 220).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`[${label}] 失败: ${e.cause?.message || e.message}`);
  }
}

await probe('高德 restapi', 'https://restapi.amap.com/v3/place/text?key=testkey&keywords=%E9%A9%B4%E8%82%89%E7%81%AB%E7%83%A7&city=%E4%BF%9D%E5%AE%9A&offset=3');
await probe('高德 周边搜索', 'https://restapi.amap.com/v3/place/around?key=testkey&location=115.4646,38.8740&radius=1500&types=050000&offset=3');
await probe('腾讯地图', 'https://apis.map.qq.com/ws/place/v1/search?key=testkey&keyword=%E9%A9%B4%E8%82%89%E7%81%AB%E7%83%A7&boundary=region(%E4%BF%9D%E5%AE%9A,0)&page_size=3');
await probe('百度地图', 'https://api.map.baidu.com/place/v2/search?query=%E9%A9%B4%E8%82%89%E7%81%AB%E7%83%A7&region=%E4%BF%9D%E5%AE%9A&output=json&ak=test');
await probe('Overpass 镜像1', 'https://overpass.kumi.systems/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A20%5D%3Bnode%5B%22amenity%22%3D%22restaurant%22%5D%28around%3A1200%2C38.8740%2C115.4646%29%3Bout%20center%2020%3B');
await probe('Overpass 镜像2', 'https://overpass.private.coffee/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A20%5D%3Bnode%5B%22amenity%22%3D%22restaurant%22%5D%28around%3A1200%2C38.8740%2C115.4646%29%3Bout%20center%2020%3B');
