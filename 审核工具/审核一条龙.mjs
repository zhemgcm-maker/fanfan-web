/* 用户提交的菜单：从提交包一路做到入库（解包 → 识别 → 补价格 → 【你改】→ 补字段 → 入库 → 生成数据）
 *
 * 为什么要有它：这条链要跑 6 个脚本、参数各不相同（校内档口和校外店的字段还不一样），
 * 中间还有一步必须人工（对着照片补价格、改被 OCR 认花的菜名），散着敲命令很容易漏。
 *
 * 用法（两种都行）：
 *   ① 直接双击 审核工具\一键审核.bat        —— 会一样一样问你
 *   ② node 审核工具\审核一条龙.mjs --pack <提交包.json> --shop "店名" --where campus --canteen 第二餐厅 ...
 *
 * 参数：
 *   --pack   后端导出的提交包（浏览器打开 /api/submit/pending?key=... 下载的那个）
 *   --shop   店名（校外店要尽量写得和高德上一样，不然菜单挂不到那家店）
 *   --where  campus = 校内食堂档口；outside = 校外店
 *   --canteen/--stall   校内档口才要：哪个食堂、档口名
 *   --cuisine/--avg     这家店的菜系、人均
 *   --prefix 新菜的 id 前缀（校内校外都要，短且别和现有的重，比如 yxc / akxc）
 *   --user/--pass       一个饭饭账号（识别那步走自己后端的 /api/llm，本机不放 Key）
 *   --out    工作目录，默认 商家数据库\待审核-<今天>
 *   --dry    只打印每一步要跑什么，不真跑（第一次可以先用它看看）
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/* 必须用 fileURLToPath：new URL(...).pathname 会把中文目录转义成 %E9%AD…，
 * 而项目目录就叫 D:\饭饭web（这个坑在别的脚本里踩过一次了）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = path.join(ROOT, '开发脚本');
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const has = n => args.indexOf('--' + n) !== -1;
const dry = has('dry');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
async function ask(q, def){
  const a = (await rl.question(q + (def ? '（默认 ' + def + '）' : '') + '：')).trim();
  return a || def || '';
}
const run = (label, script, scriptArgs) => {
  console.log('\n──────── ' + label + ' ────────');
  const cmd = [path.join(DEV, script)].concat(scriptArgs);
  console.log('  node ' + cmd.map(x => /\s/.test(x) ? '"' + x + '"' : x).join(' '));
  if(dry) return 0;
  const r = cp.spawnSync(process.execPath, cmd, { stdio:'inherit', cwd:ROOT });
  return r.status || 0;
};

/* ---------- 收参数（不够就挨个问） ---------- */
const pack = flag('pack') || await ask('① 把下载的提交包拖到这里（或者粘路径）');
if(!fs.existsSync(pack)){ console.error('找不到这个提交包：' + pack); process.exit(1); }
const shop = flag('shop') || await ask('② 店名（校外店尽量和高德上写的一样）');
let where = flag('where') || await ask('③ 校内食堂档口还是校外店？填 campus / outside', 'outside');
if(where !== 'campus') where = 'outside';
const prefix = flag('prefix') || await ask('④ 新菜的 id 前缀（2~6 个小写字母，别和现有重）');
const user = flag('user') || await ask('⑤ 你的饭饭账号（识别走自己后端，本机不放 Key）');
const pass = flag('pass') || await ask('⑥ 密码');
let cuisine = flag('cuisine') || '';
let avg = Number(flag('avg')) || 0;
let canteen = flag('canteen') || '', stall = flag('stall') || '';
if(where === 'campus'){
  canteen = canteen || await ask('⑦ 哪个食堂（例如 第二餐厅）');
  stall = stall || await ask('⑧ 档口名', shop);
  cuisine = cuisine || await ask('⑨ 菜系（例如 家常 / 川 / 湘）', '家常');
  avg = avg || Number(await ask('⑩ 人均大概多少元', '12')) || 12;
}else{
  cuisine = cuisine || await ask('⑦ 菜系（例如 小吃 / 川 / 烤肉）', '小吃');
  avg = avg || Number(await ask('⑧ 人均大概多少元', '10')) || 10;
}

const today = new Date().toISOString().slice(0, 10);
const outDir = flag('out') || path.join(ROOT, '商家数据库', '待审核-' + today);
const workDir = path.join(outDir, '_解析');

console.log('\n===== 要跑的一整条链 =====');
console.log('  店名：' + shop + '　类型：' + (where === 'campus' ? '校内档口' : '校外店'));
console.log('  工作目录：' + outDir);
console.log('  id 前缀：' + prefix + '　菜系：' + cuisine + '　人均：¥' + avg);
if(dry) console.log('  （--dry：只打印，不真跑）');

/* ---------- ① 解包：把照片和核对单取出来 ---------- */
run('① 解包（图片落盘 + 生成核对单）', '解析提交包.mjs', [pack, '--out', outDir]);
if(dry){ console.log('\n（--dry 到此为止）'); rl.close(); process.exit(0); }

/* 找这家店的图片文件夹（解包出来的目录名是店名，但空格/括号会被换成下划线） */
const slug = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_');
let shopDir = path.join(outDir, slug(shop));
if(!fs.existsSync(shopDir)){
  const cands = fs.readdirSync(outDir, { withFileTypes:true }).filter(d => d.isDirectory() && d.name.indexOf('_解析') === -1);
  const hit = cands.find(d => d.name.indexOf(slug(shop).slice(0, 6)) !== -1);
  if(hit) shopDir = path.join(outDir, hit.name);
}
if(!fs.existsSync(shopDir)){ console.error('\n在 ' + outDir + ' 里找不到这家店的文件夹，先看看解包结果对不对'); process.exit(1); }

/* ---------- ② 识别 ---------- */
run('② 识别（图片 → OCR → 大模型）', 'import-menu.mjs',
  [shopDir, '--shop', shop, '--server', flag('server') || 'https://fanfan-web-qpznnriewb.cn-hangzhou.fcapp.run',
   '--user', user, '--pass', pass, '--out', workDir]);

/* ---------- ③ 对着 OCR 原文补价格 ---------- */
const menuJson = path.join(workDir, slug(shop) + '.json');
run('③ 对着 OCR 原文补价格', '对照原文补价格.mjs', [menuJson]);

/* ---------- ④ 人工这一步（必须做，脚本替不了） ---------- */
console.log('\n════════ 该你了 ════════');
console.log('打开这个文件：');
console.log('  ' + menuJson);
console.log('做三件事：');
console.log('  1) 看看有没有「还是没配到价格」的菜，对着照片把 price 填上');
console.log('  2) 看看菜名有没有被 OCR 认花的（比如"水皎"、"干豆镉"），改成正确的');
console.log('  3) 价格若真是免费的，就填 0');
await ask('改完按回车继续（要放弃就关掉这个窗口）');

/* ---------- ⑤ 补"这家店是谁"的字段 ---------- */
console.log('\n──────── ⑤ 补上店铺字段 ────────');
{
  const j = JSON.parse(fs.readFileSync(menuJson, 'utf8'));
  const meta = where === 'campus'
    ? { shop, city:'保定', place:'campus', campus:flag('campus') || '华北电力大学（保定）', canteen, stall,
        cuisine, avg, idPrefix:prefix }
    : { shop, city:flag('city') || '保定', cuisine, avg };
  const rest = Object.assign({}, j);
  Object.keys(meta).forEach(k => delete rest[k]);
  fs.writeFileSync(menuJson, JSON.stringify(Object.assign({}, meta, rest), null, 2), 'utf8');
  console.log('  写好：' + JSON.stringify(meta));
}

/* ---------- ⑥ 入库 + ⑦ 生成前端数据 ---------- */
run('⑥ 菜单入库（写 data/db.js + 解析结果）', 'ingest-menu.mjs',
  ['--menu', menuJson, '--kb', path.join(ROOT, 'index.html'), '--prefix', prefix]);
run('⑦ 生成前端数据（data/shops.json）', 'build-data.mjs',
  ['--parsed', path.join(ROOT, '商家数据库', '解析结果'), '--kb', path.join(ROOT, 'index.html'), '--out', path.join(ROOT, 'data')]);

/* 如果 build-data 报了"知识库里没有的新菜"，再补两步把新菜建成菜品库记录 */
const candFile = path.join(ROOT, 'data', '新菜候选.json');
let newCount = 0;
try{ newCount = (JSON.parse(fs.readFileSync(candFile, 'utf8')).dishes || []).length; }catch(e){}
if(newCount){
  console.log('\n发现 ' + newCount + ' 道新菜还没进菜品库，接着补：');
  run('⑧ 生成新菜记录（按词表规范）', 'gen-kb-records.mjs',
    ['--new', candFile, '--kb', path.join(ROOT, 'index.html'), '--out', workDir,
     '--server', flag('server') || 'https://fanfan-web-qpznnriewb.cn-hangzhou.fcapp.run', '--user', user, '--pass', pass]);
  run('⑨ 插进菜品库', 'insert-dishes.mjs',
    ['--kb', path.join(ROOT, 'index.html'), '--records', path.join(workDir, '新菜记录.json')]);
  run('⑩ 再生成一次前端数据', 'build-data.mjs',
    ['--parsed', path.join(ROOT, '商家数据库', '解析结果'), '--kb', path.join(ROOT, 'index.html'), '--out', path.join(ROOT, 'data')]);
}

console.log('\n════════ 做完了 ════════');
console.log('接着做三件事：');
console.log('  1) 双击 index.html →「发现美食」里看这家店的菜单对不对');
console.log('  2) 让 Codex 推上线（或自己跑推送脚本）');
console.log('  3) 把这条从待审核池里划掉：POST /api/submit/review {"key":"…","ids":["…"],"status":"accepted"}');
rl.close();
