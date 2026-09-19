// 给"知识库里没有的新菜"生成菜品库记录（并按我们的词表校验）
// 用法：node gen-kb-records.mjs --new <新菜候选.json> --kb ..\outputs\index.html --out <输出目录>
//
// 生成的记录必须满足菜品库的字段规范：
//   类别 cat ∈ {rice,noodle,other}｜角色 role ∈ {single,main,side,soup,staple,drink}
//   菜系 cui 用库里已有的 25 个｜标签 tags 用库里已有的词表｜忌口 alg 用 ALG_MAP 的 11 个键
// 价格一律用采集到的真实价格，不让模型编。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const newFile = flag('new'), kbFile = flag('kb'), outDir = flag('out');
const KEY = process.env.DS_KEY || 'sk-21f864ce09aa412a81b42f06c5d38199';
if(!newFile || !kbFile || !outDir){ console.error('用法：node gen-kb-records.mjs --new <新菜候选.json> --kb <index.html> --out <目录>'); process.exit(1); }

/* ---------- 从页面里取现有词表（保证生成的记录能无缝进库） ---------- */
const html = fs.readFileSync(kbFile, 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const DISHES = new Function('return [' + /const DISHES = \[([\s\S]*?)\n\];/.exec(code)[1] + '];')();
const ALG = new Function('return {' + /const ALG_MAP = \{([\s\S]*?)\n\};/.exec(code)[1] + '};')();
const CUIS = [...new Set(DISHES.map(d => d.cui))];
const TAGS = [...new Set(DISHES.flatMap(d => d.tags))].sort();
const ALG_KEYS = Object.keys(ALG);
const ALG_VALUES = [...new Set(Object.values(ALG).flat())];
// 忌口分组名 → 食材标签：菜品库里 alg 存的是"猪/鸡/蛋/麦"这种食材标签，不是"猪肉/麸质面食"这种分组名
const ALG_FIX = {};
ALG_KEYS.forEach(k => { ALG_FIX[k] = ALG[k]; });
const existingIds = new Set(DISHES.map(d => d.id));
const existingNames = new Set(DISHES.map(d => d.name));

const newDishes = JSON.parse(fs.readFileSync(newFile, 'utf8')).dishes;
console.log('待生成 ' + newDishes.length + ' 道新菜');

const SYSTEM =
  '你是一个中餐菜品库的录入员。用户会给你一批菜（菜名、参考价、所属店里的分类），' +
  '你要按给定字段规范，为每道菜生成一条结构化的菜品记录，只输出 JSON，不要解释。\n' +
  '输出格式：{"records":[{"name":"菜名","cat":"rice|noodle|other","cui":"菜系","price":数字,"spicy":0-3,' +
  '"tags":["标签"],"alg":["忌口"],"role":"single|main|side|soup|staple|drink","desc":"短描述","hot":数字}]}\n' +
  '字段规则：\n' +
  '1) cat 按"这道菜配什么主食"判断：配米饭吃→rice；配面/粉/馄饨/饺子吃→noodle；整份菜、小吃、火锅→other；\n' +
  '2) cui 只能用这些菜系：' + CUIS.join('、') + '（沙县小吃一般用「小吃」，盖浇饭/炒饭也可用「家常」或「小吃」）；\n' +
  '3) price 用用户给的真实价格，不许改、不许编；\n' +
  '4) spicy 只能是 0（不辣）1（微辣）2（中辣）3（重辣）；\n' +
  '5) tags 只能从这份标签词表里选，每道菜 3-6 个，必须包含主料（如 猪/牛/鸡/蛋/豆/蔬菜）和做法或口味：\n' + TAGS.join('、') + '\n' +
  '6) alg 填"这道菜含哪些致敏食材"，只能用这些标签：' + ALG_VALUES.join('、') + '（不含就空数组）；\n' +
  '7) role：一份就能当一顿的（盖浇饭、炒饭、面、馄饨、饺子、套餐）→single；单点的菜/配菜/卤味小食（卤蛋、豆干、鸭胗、大排、热狗）→side；纯汤→soup；米饭→staple；饮料→drink；整份硬菜→main；\n' +
  '8) desc 是 6-14 个字的口语化描述，别写"美味可口"这种废话；\n' +
  '9) hot 是"大众热度"估计值 40-90。\n' +
  '注意：同一批菜里若有"面/粉""炒饭/米粉/河粉"这种一道菜多种主食的写法，按面/粉优先（cat=noodle）。';

async function gen(batch){
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      model: 'deepseek-chat', temperature: 0.2, max_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(batch.map(d => ({ 菜名:d.name, 参考价:d.price, 店里分类:d.cat }))) }
      ]
    })
  });
  if(!res.ok) throw new Error('DeepSeek HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  const txt = j.choices[0].message.content;
  return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)).records || [];
}

/* ---------- 校验：字段必须合法，否则这道菜不进库 ---------- */
const CATS = ['rice','noodle','other'], ROLES = ['single','main','side','soup','staple','drink'];
function validate(r, src){
  const bad = [];
  if(!r || !r.name) bad.push('缺菜名');
  if(CATS.indexOf(r.cat) === -1) bad.push('cat 非法（' + r.cat + '）');
  if(ROLES.indexOf(r.role) === -1) bad.push('role 非法（' + r.role + '）');
  if(CUIS.indexOf(r.cui) === -1) bad.push('cui 不在词表（' + r.cui + '）');
  const tags = (Array.isArray(r.tags) ? r.tags : []).filter(t => TAGS.indexOf(t) !== -1);
  if(tags.length < 2) bad.push('有效标签不足 2 个');
  // 模型可能给的是分组名（猪肉/麸质面食），统一换成食材标签（猪/麦）；都不认识就丢掉
  const alg = [...new Set((Array.isArray(r.alg) ? r.alg : []).flatMap(a =>
    ALG_FIX[a] || (ALG_VALUES.indexOf(a) !== -1 ? [a] : [])))];
  const spicy = [0,1,2,3].indexOf(r.spicy) !== -1 ? r.spicy : 1;
  // 价格一律以采集到的为准
  const price = (src && typeof src.price === 'number') ? src.price : r.price;
  if(typeof price !== 'number') bad.push('没有价格');
  return { bad, rec:{ ...r, tags, alg, spicy, price } };
}

const records = [], rejected = [];
for(let i = 0; i < newDishes.length; i += 15){
  const batch = newDishes.slice(i, i + 15);
  process.stdout.write('  第 ' + (i / 15 + 1) + ' 批（' + batch.length + ' 道）… ');
  let out = [];
  try{ out = await gen(batch); }catch(e){ console.log('失败：' + e.message); continue; }
  for(const src of batch){
    const r = out.find(x => x && (x.name === src.name || String(x.name).indexOf(src.name) === 0));
    const v = validate(r, src);
    if(v.bad.length){ rejected.push({ name:src.name, why:v.bad.join('；') }); continue; }
    records.push(v.rec);
  }
  console.log('累计 ' + records.length + ' 条');
}

/* ---------- 分配 id（不和现有 id 冲突） ---------- */
let n = 1;
for(const r of records){
  let id;
  do { id = 'sx' + String(n).padStart(2, '0'); n++; } while(existingIds.has(id));
  existingIds.add(id); r.id = id;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '新菜记录.json'), JSON.stringify({ generatedAt:new Date().toISOString().slice(0,10), records, rejected }, null, 2), 'utf8');
console.log('\n生成 ' + records.length + ' 条记录，被拒 ' + rejected.length + ' 条');
rejected.forEach(r => console.log('  ❌ ' + r.name + '：' + r.why));
records.slice(0, 60).forEach(r => console.log('  ' + r.id + ' ' + r.name.padEnd(18) + ' ¥' + String(r.price).padEnd(4) +
  r.cat + '/' + r.role + '/' + r.cui + ' 辣' + r.spicy + '  [' + r.tags.join(' ') + ']  忌:' + (r.alg.join('/') || '无')));
