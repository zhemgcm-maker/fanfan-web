// 把单文件页面传到匿名托管站，拿到可以直接发微信的公网链接
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const name = path.basename(file);

async function catbox() {
  const fd = new FormData();
  fd.append('reqtype', 'fileupload');
  fd.append('fileToUpload', new Blob([buf], { type: 'text/html' }), name);
  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodexDeploy/1.0' },
    body: fd
  });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//.test(text)) throw new Error('HTTP ' + res.status + ' → ' + text.slice(0, 160));
  return text;
}

async function tmpfiles() {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'text/html' }), name);
  const res = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd });
  const j = await res.json();
  if (!j || !j.data || !j.data.url) throw new Error('返回异常：' + JSON.stringify(j).slice(0, 160));
  return j.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
}

async function verify(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const ct = res.headers.get('content-type');
  const body = await res.text();
  return { status: res.status, contentType: ct, isOurPage: body.includes('今天吃啥'), bytes: body.length };
}

for (const [label, fn] of [['catbox.moe', catbox], ['tmpfiles.org', tmpfiles]]) {
  try {
    const url = await fn();
    const v = await verify(url);
    console.log(`\n[${label}] 上传成功`);
    console.log('  链接: ' + url);
    console.log('  校验: HTTP ' + v.status + ' · ' + v.contentType + ' · ' + (v.isOurPage ? '内容正确' : '⚠️ 内容不符') + ' · ' + v.bytes + ' 字节');
  } catch (err) {
    console.log(`\n[${label}] 失败: ${err.message}${err.cause ? ' / ' + err.cause.message : ''}`);
  }
}
