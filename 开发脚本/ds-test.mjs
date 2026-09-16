// 实测 DeepSeek 接口：连通性、模型名、CORS 响应头
const key = process.env.DS_KEY;
if (!key) { console.error('缺少 DS_KEY 环境变量'); process.exit(1); }

async function probe(label, url, options = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const cors = res.headers.get('access-control-allow-origin');
    const body = await res.text();
    console.log(`\n[${label}] HTTP ${res.status} (${Date.now() - started}ms)`);
    console.log('  access-control-allow-origin: ' + (cors === null ? '（无 CORS 头）' : cors));
    console.log('  body: ' + body.slice(0, 400).replace(/\s+/g, ' '));
    return { status: res.status, cors, body };
  } catch (err) {
    console.log(`\n[${label}] 请求失败: ${err.message}${err.cause ? ' / ' + err.cause.message : ''}`);
    return { error: err.message };
  }
}

await probe('models', 'https://api.deepseek.com/v1/models');

await probe('chat 直连（无 Origin）', 'https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: '只回复两个字：可以' }], max_tokens: 20 })
});

await probe('chat 模拟浏览器（带 Origin）', 'https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: { Origin: 'http://localhost:8080' },
  body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: '只回复两个字：可以' }], max_tokens: 20 })
});

await probe('OPTIONS 预检', 'https://api.deepseek.com/v1/chat/completions', {
  method: 'OPTIONS',
  headers: {
    Origin: 'http://localhost:8080',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type'
  }
});

await probe('chat 来自 file://（Origin: null）', 'https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: { Origin: 'null' },
  body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: '回复：ok' }], max_tokens: 10 })
});

await probe('模型 deepseek-flash', 'https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '回复：ok' }], max_tokens: 10 })
});

await probe('模型 deepseek-v4-pro', 'https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'deepseek-v4-pro', messages: [{ role: 'user', content: '回复：ok' }], max_tokens: 10 })
});
