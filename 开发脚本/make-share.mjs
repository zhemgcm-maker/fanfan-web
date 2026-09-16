// 由自用版生成本分享版：摘掉预填密钥、默认关闭大模型、文案改成"填自己的密钥"
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const outDir = process.argv[3];
const html = fs.readFileSync(src, 'utf8');

const edits = [
  // 1) 清空预填密钥
  [/const DEFAULT_KEY = 'sk-[^']*';/, "const DEFAULT_KEY = '';   // 分享版：不预填任何密钥，使用者填自己的"],
  // 2) 默认关闭大模型（没有密钥时开启会只弹提示）
  [/settings:\{ v:SETTINGS_VERSION, enabled:'on',/, "settings:{ v:SETTINGS_VERSION, enabled:'off',"],
  // 3) 顶部徽章
  [/<span class="badge">🧠 大模型 \/ 智能体 Demo（DeepSeek 已接入）<\/span>/,
   '<span class="badge">🧠 大模型 / 智能体 Demo（本地引擎离线可用）</span>'],
  // 4) 设置区标题
  [/<summary>🔌 大模型接入（DeepSeek 已配置）<\/summary>/,
   '<summary>🔌 大模型接入（选填：填自己的 DeepSeek 密钥）</summary>'],
  // 5) 设置区说明
  [/推荐逻辑跑在页面内置的「本地推理引擎」上（不联网也能用），大模型负责最后一层：读本地算好的候选、价格、距离、评分和你的忌口，写出自然语言的推荐理由。DeepSeek 的接口地址、模型和密钥已经预填好，直接可用。/,
   '推荐逻辑跑在页面内置的「本地推理引擎」上，不联网、不需要密钥就能用。想让大模型再写一段更自然的推荐理由，就在下面填自己的 DeepSeek 密钥（接口地址和模型已经预填好），然后把"启用大模型"切成开启。'],
  // 6) 密钥安全说明
  [/🔐 密钥只保存在这台设备的浏览器里（localStorage），请求由浏览器直接发往 api\.deepseek\.com（已实测支持跨域）。但这个 HTML 文件本身也带着一份预填密钥，<b>公开发布或发给别人之前，记得先点「清除 Key」<\/b>，或者去 DeepSeek 后台重新生成一个。/,
   '🔐 这个分享版没有内置任何密钥。你填的密钥只保存在自己这台设备的浏览器里，请求由浏览器直接发往 api.deepseek.com（已实测支持跨域）。不填密钥也能正常使用，只是少一段大模型写的推荐语。']
];

let result = html;
for (const [pattern, replacement] of edits) {
  if (!pattern.test(result)) {
    console.error('❌ 没匹配到，自用版可能已改动：' + pattern.toString().slice(0, 70));
    process.exit(1);
  }
  result = result.replace(pattern, replacement);
}

if (result.includes('sk-21f864ce')) {
  console.error('❌ 分享版里仍然残留密钥，已中止');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), result);
// 再存一份中文名的副本：微信里发文件时，中文名对方一看就懂（文件名不影响功能）
fs.writeFileSync(path.join(outDir, '今天吃啥.html'), result);
console.log('✅ 已生成分享版：' + path.join(outDir, 'index.html'));
console.log('   大小 ' + (Buffer.byteLength(result) / 1024).toFixed(1) + ' KB');
console.log('   校验：不含明文密钥 ' + (result.includes('sk-21f864ce') ? '❌ 有残留' : '✓'));

const changes = [
  ["预填密钥", /DEFAULT_KEY = ''/],
  ["默认关闭大模型", /enabled:'off'/],
  ["提示使用者填自己的密钥", /填自己的 DeepSeek 密钥/]
];
changes.forEach(([label, re]) => console.log('   ' + (re.test(result) ? '✓' : '✗') + ' ' + label));
