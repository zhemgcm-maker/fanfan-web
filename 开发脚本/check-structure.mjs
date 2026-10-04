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
  ['安全区适配（刘海屏）', /env\(safe-area-inset-bottom\)/],
  ['禁用缩放的字体平滑', /-webkit-font-smoothing/],
  ['按钮均有 44px 以上点击区', /\.btn\{[\s\S]*?padding:13px 18px/]
];
checks.forEach(([label, re]) => console.log((re.test(html) ? '✅ ' : '⚠️ ') + label));

/* 「可离线打开」= 双击 index.html 也能用，页面不会去网上取任何东西。
 * 注意区分两类 https 链接：
 *   · 会真的去加载的 —— script/img/iframe/link(stylesheet|icon|manifest|preload…)，这些必须没有外链；
 *   · 只是元数据、不会加载的 —— rel="canonical"、og:image、twitter:card，有 https 是正常的，不算外链。 */
const LOADING_REL = '(?:stylesheet|icon|apple-touch-icon|manifest|preload|prefetch|modulepreload)';
const external = [
  /<script[^>]+src=["']https?:/i,
  /<(?:img|iframe|video|audio|source|embed)[^>]+src=["']https?:/i,
  new RegExp('<link[^>]*rel=["\']' + LOADING_REL + '["\'][^>]+href=["\']https?:', 'i'),
  new RegExp('<link[^>]*href=["\']https?:[^>]*rel=["\']' + LOADING_REL + '["\']', 'i')
].some(re => re.test(html));
console.log((external ? '⚠️ 有外链资源（离线打开会缺东西）' : '✅ 没有外链资源（可离线打开）'));

console.log('文件大小：' + (fs.statSync(process.argv[2]).size / 1024).toFixed(1) + ' KB');
