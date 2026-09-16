import fs from 'node:fs';

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

if (!blocks.length) {
  console.error('NO_SCRIPT_FOUND');
  process.exit(1);
}

let ok = true;
blocks.forEach((code, i) => {
  try {
    // 只编译不执行，用来抓语法错误
    new Function(code);
    console.log(`script[${i}] syntax OK (${code.length} chars)`);
  } catch (err) {
    ok = false;
    console.error(`script[${i}] SYNTAX ERROR: ${err.message}`);
  }
});

// 顺手做几个静态一致性检查
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log('duplicate ids:', dupes.length ? [...new Set(dupes)].join(', ') : 'none');

const missing = [];
for (const m of html.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) {
  if (!ids.includes(m[1])) missing.push(m[1]);
}
console.log('missing DOM ids referenced by JS:', missing.length ? [...new Set(missing)].join(', ') : 'none');

const dishIds = [...html.matchAll(/\{ id:'(d\d\d)'/g)].map(m => m[1]);
console.log('dishes:', dishIds.length);
const restIds = [...html.matchAll(/\{ id:'(r\d\d)'/g)].map(m => m[1]);
console.log('restaurants:', restIds.length);

const sigRefs = [...html.matchAll(/sig:\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'(d\d\d)'/g)].map(x => x[1]));
const unknownSig = [...new Set(sigRefs.filter(id => !dishIds.includes(id)))];
console.log('signature dish ids not in dish table:', unknownSig.length ? unknownSig.join(', ') : 'none');

const cuiValues = [...new Set([...html.matchAll(/cui:'([^']+)'/g)].map(m => m[1]))];
console.log('cuisines used by dishes:', cuiValues.join(', '));

process.exit(ok ? 0 : 1);
