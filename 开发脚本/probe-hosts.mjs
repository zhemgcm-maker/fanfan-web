// 探测各免登录托管服务：能否上传、返回的 Content-Type 能不能直接渲染网页
const tiny = new Blob(['<!doctype html><meta charset="utf-8"><title>probe</title><h1>probe</h1>'], { type: 'text/html' });

async function check(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const ct = res.headers.get('content-type') || '';
    const body = await res.text();
    return `HTTP ${res.status} · ${ct} · ${body.length}B`;
  } catch (e) { return '拉取失败: ' + (e.cause?.message || e.message); }
}

// A) 0x0.st
try {
  const fd = new FormData();
  fd.append('file', tiny, 'probe.html');
  const res = await fetch('https://0x0.st', {
    method: 'POST',
    headers: { 'User-Agent': 'meal-agent-deploy/1.0 (personal use)' },
    body: fd
  });
  const text = (await res.text()).trim();
  console.log('[0x0.st] ' + res.status + ' → ' + text.slice(0, 120));
  if (/^https?:/.test(text)) console.log('  校验: ' + await check(text));
} catch (e) { console.log('[0x0.st] 失败: ' + (e.cause?.message || e.message)); }

// B) uguu.se（临时 3 小时）
try {
  const fd = new FormData();
  fd.append('files[]', tiny, 'probe.html');
  const res = await fetch('https://uguu.se/upload?output=text', { method: 'POST', body: fd });
  const text = (await res.text()).trim();
  console.log('[uguu.se] ' + res.status + ' → ' + text.slice(0, 160));
  if (/^https?:/.test(text)) console.log('  校验: ' + await check(text));
} catch (e) { console.log('[uguu.se] 失败: ' + (e.cause?.message || e.message)); }

// C) Vercel 匿名部署（无 token 试探）
try {
  const res = await fetch('https://api.vercel.com/v13/deployments?forceNew=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'meal-agent-probe',
      files: [{ file: 'index.html', data: '<!doctype html><h1>probe</h1>' }],
      projectSettings: { framework: null },
      target: 'production'
    })
  });
  const text = await res.text();
  console.log('[vercel 匿名] ' + res.status + ' → ' + text.slice(0, 200));
} catch (e) { console.log('[vercel 匿名] 失败: ' + (e.cause?.message || e.message)); }

// D) Netlify 匿名部署（无 token 试探）
try {
  const res = await fetch('https://api.netlify.com/api/v1/sites', { method: 'POST' });
  const text = await res.text();
  console.log('[netlify 匿名] ' + res.status + ' → ' + text.slice(0, 200));
} catch (e) { console.log('[netlify 匿名] 失败: ' + (e.cause?.message || e.message)); }

// E) surge.sh 是否需要登录
try {
  const res = await fetch('https://surge.surge.sh/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log('[surge.surge.sh] ' + res.status + ' · ' + (res.headers.get('content-type') || ''));
} catch (e) { console.log('[surge] 失败: ' + (e.cause?.message || e.message)); }
