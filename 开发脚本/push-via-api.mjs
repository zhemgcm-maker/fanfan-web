// 当 github.com:443（git 协议）被墙时，用 GitHub REST API 把本地最新提交推上去。
// 用法：$env:GH_TOKEN=... ; node push-via-api.mjs <本地仓库目录> <owner/repo>
const fs = await import('node:fs');
const path = await import('node:path');
const cp = await import('node:child_process');

const repoDir = process.argv[2];
const slug = process.argv[3] || 'zhemgcm-maker/fanfan-web';
const token = (process.env.GH_TOKEN || '').trim();
if (!token) { console.log('缺少 GH_TOKEN'); process.exit(1); }

const H = { Authorization: 'token ' + token, 'User-Agent': 'fanfan-upload', Accept: 'application/vnd.github+json' };
const API = 'https://api.github.com/repos/' + slug;
const git = (args) => cp.execSync('git -C "' + repoDir + '" ' + args, { encoding: 'utf8' }).trim();

const headSha = git('rev-parse HEAD');
const headMsg = git('log -1 --pretty=%B');
const parentSha = git('rev-parse HEAD~1');
const files = git('diff --name-only HEAD~1 HEAD').split('\n').map(s => s.trim()).filter(Boolean);
console.log('本地提交 ' + headSha.slice(0, 7) + '：' + headMsg.split('\n')[0]);
console.log('涉及 ' + files.length + ' 个文件');

async function api(url, opts = {}) {
  const res = await fetch(API + url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = { raw: txt }; }
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status + ' ' + (json && json.message ? json.message : ''));
  return json;
}

// 远端当前状态
const ref = await api('/git/ref/heads/main');
const remoteSha = ref.object.sha;
console.log('远端 main 现在在 ' + remoteSha.slice(0, 7));
if (remoteSha === headSha) { console.log('远端已经是最新的，不用推'); process.exit(0); }

// 逐个文件做成 blob
const blobs = [];
const deleted = [];
for (const rel of files) {
  const full = path.join(repoDir, rel);
  // 本地删掉的文件：在远端 tree 里用 sha:null 标记删除，否则远端会一直留着
  if (!fs.existsSync(full)) { deleted.push(rel.replace(/\\/g, '/')); console.log('  ✗ 删除 ' + rel); continue; }
  const b64 = fs.readFileSync(full).toString('base64');
  const blob = await api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64, encoding: 'base64' }) });
  blobs.push({ path: rel.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
  console.log('  ✓ blob ' + rel);
}
for (const rel of deleted) blobs.push({ path: rel, mode: '100644', type: 'blob', sha: null });

const remoteCommit = await api('/git/commits/' + remoteSha);
const tree = await api('/git/trees', {
  method: 'POST',
  body: JSON.stringify({ base_tree: remoteCommit.tree.sha, tree: blobs })
});
const commit = await api('/git/commits', {
  method: 'POST',
  body: JSON.stringify({ message: headMsg, tree: tree.sha, parents: [remoteSha] })
});
await api('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
console.log('✅ 已通过 API 推送：' + commit.sha.slice(0, 7) + '（本地是 ' + headSha.slice(0, 7) + '，父提交 ' + parentSha.slice(0, 7) + '）');
