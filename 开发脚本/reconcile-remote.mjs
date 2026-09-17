// 把远端那个"API 推送"产生的 commit 对象取回本地，让本地分支重新与远端对齐
// （不碰工作区文件：只写入对象库 + 移动分支指针）
import cp from 'node:child_process';
import fs from 'node:fs';

const dir = process.argv[2] || 'D:\\饭饭web';
const slug = process.argv[3] || 'zhemgcm-maker/fanfan-web';
const token = (process.env.GH_TOKEN || '').trim();
if (!token) { console.log('缺少 GH_TOKEN'); process.exit(1); }
const H = { Authorization: 'token ' + token, 'User-Agent': 'fanfan-upload' };
const git = (args, input) => cp.execSync('git -C "' + dir + '" ' + args, { encoding: 'utf8', input }).trim();

const ref = await (await fetch('https://api.github.com/repos/' + slug + '/git/ref/heads/main', { headers: H })).json();
const remoteFull = ref.object.sha;
const localFull = git('rev-parse HEAD');
console.log('远端 ' + remoteFull.slice(0, 12) + '   本地 ' + localFull.slice(0, 12));
if (remoteFull === localFull) { console.log('✅ 已经一致，不用处理'); process.exit(0); }

const commit = await (await fetch('https://api.github.com/repos/' + slug + '/git/commits/' + remoteFull, { headers: H })).json();
const ts = Math.floor(new Date(commit.committer.date).getTime() / 1000);
const header =
  'tree ' + commit.tree.sha + '\n' +
  'parent ' + commit.parents[0].sha + '\n' +
  'author ' + commit.author.name + ' <' + commit.author.email + '> ' + ts + ' +0000\n' +
  'committer ' + commit.committer.name + ' <' + commit.committer.email + '> ' + ts + ' +0000\n\n';

let written = null;
for (const [label, msg] of [['带结尾换行', commit.message + '\n'], ['不带结尾换行', commit.message]]) {
  const body = header + msg;
  const sha = git('hash-object -t commit --stdin', body);
  console.log('  ' + label + ' → ' + sha.slice(0, 12) + (sha === remoteFull ? '  ✅ 与远端一致' : ''));
  if (sha === remoteFull) { git('hash-object -t commit -w --stdin', body); written = sha; break; }
}
if (!written) {
  console.log('⚠️ 无法精确重建远端 commit（不影响内容，只是本地/远端历史分叉）');
  process.exit(2);
}

// 本地分支指向"与远端同一个提交"，工作区文件完全不动
git('update-ref refs/heads/main ' + written + ' ' + localFull);
console.log('✅ 本地 main 已对齐到远端提交 ' + written.slice(0, 12));
console.log('   git log 顶部：' + git('log --oneline -1'));
const dirty = git('status --short');
console.log('   工作区状态：' + (dirty ? '有改动 ' + dirty : '干净 ✅'));
