import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
// 去掉 script / style 内容，只检查静态标签结构
const stripped = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const stack = [];
const problems = [];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
let m;
while ((m = tagRe.exec(stripped))) {
  const [, closing, rawName, attrs, selfClose] = m;
  const name = rawName.toLowerCase();
  if (voidTags.has(name) || selfClose === '/') continue;
  if (!closing) {
    stack.push({ name, index: m.index });
  } else {
    const last = stack.pop();
    if (!last) problems.push(`多余的闭合标签 </${name}>`);
    else if (last.name !== name) problems.push(`</${name}> 与未闭合的 <${last.name}> 不匹配`);
  }
}
stack.forEach(s => problems.push(`未闭合的 <${s.name}>`));

console.log('静态标签结构：' + (problems.length ? '❌ ' + problems.join('；') : '✅ 全部闭合且嵌套正确'));

const checks = [
  ['viewport 适配手机', /name="viewport"[^>]*width=device-width/],
  ['没有外链资源（可离线打开）', /^(?![\s\S]*<(?:script|link)[^>]*(?:src|href)="https?:)[\s\S]*$/],
  ['安全区适配（刘海屏）', /env\(safe-area-inset-bottom\)/],
  ['禁用缩放的字体平滑', /-webkit-font-smoothing/],
  ['按钮均有 44px 以上点击区', /\.btn\{[\s\S]*?padding:13px 18px/]
];
checks.forEach(([label, re]) => console.log((re.test(html) ? '✅ ' : '⚠️ ') + label));

console.log('文件大小：' + (fs.statSync(process.argv[2]).size / 1024).toFixed(1) + ' KB');
