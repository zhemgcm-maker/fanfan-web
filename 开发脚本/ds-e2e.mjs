// 端到端：直接调用页面里的 callLLM()，验证真实生产代码路径
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',textContent:'',value:'',className:'',style:{},children:[],classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)}},setAttribute(){},addEventListener(){},appendChild(c){el.children.push(c);return c},querySelector(){return fakeEl()},scrollIntoView(){}};return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__e={state,recommend,recommendRestaurants,callLLM,SYSTEM_PROMPT,catName,pickTier,currentPeriod,PROVIDERS,DEFAULT_KEY,providerLabel};')
  (document, localStorage, (f)=>setTimeout(f,0), globalThis.fetch.bind(globalThis));

const api = globalThis.__e;
const { state, recommend, recommendRestaurants, catName, pickTier, currentPeriod } = api;

console.log('页面默认配置: ' + api.PROVIDERS[state.settings.provider].label +
            ' / ' + state.settings.base + ' / ' + state.settings.model +
            ' / 预填密钥 ' + (state.settings.key === api.DEFAULT_KEY ? '已设置' : '未设置'));

// 场景：中饭 + 吃饭 + 想吃辣 + 五角场 + 外卖 + 忌口香菜
Object.assign(state, {
  tier:'mid', cat:'rice', budget:60, craveTags:['想吃辣'], craveText:'想吃点有锅气的',
  address:'五角场万达', mode:'delivery', spiceMax:3, seed:1
});
state.profile.allergies = ['香菜'];
state.profile.tastes = ['下饭至上'];
state.profile.likes = { '下饭':2, '鸡':1 };
state.profile.history = [{ id:'d11', ts: Date.now() - 3*24*3600*1000 }];

const tier = pickTier(), period = currentPeriod();
const rec = recommend();
const likeTop = ['下饭','鸡'];

const payload = {
  tier:{ id:tier.id, name:tier.name, range:'¥'+tier.min+'-'+tier.max, budgetCap:Math.min(tier.max,state.budget) },
  category:{ id:state.cat, name:catName(state.cat) },
  craving:{ tags:state.craveTags, text:state.craveText },
  address:state.address, mode:state.mode, period:period.label,
  profile:{ allergies:state.profile.allergies, tastes:state.profile.tastes, likes:likeTop },
  candidates: rec.scored.slice(0,5).map(s=>({
    dish:s.dish.name, cuisine:s.dish.cui, price:s.dish.price, score:s.total, spicy:s.dish.spicy,
    reasons:s.reasons,
    shops: recommendRestaurants(s.dish).list.slice(0,2).map(x=>({ name:x.restaurant.name, area:x.restaurant.area, km:x.km, rating:x.restaurant.rating, eta:x.eta }))
  }))
};

for (const model of ['deepseek-chat', 'deepseek-v4-pro']) {
  state.settings.model = model;
  try {
    const r = await api.callLLM(payload);
    console.log(`\n=== ${model}（走页面 callLLM）===`);
    console.log('回执: ' + r.model + ' · ' + (r.ms/1000).toFixed(1) + 's · tokens ' + JSON.stringify(r.usage));
    console.log('思考链: ' + (r.reasoning ? r.reasoning.slice(0,120).replace(/\s+/g,' ') + '…（共' + r.reasoning.length + '字）' : '（无）'));
    console.log('推荐语: ' + r.text);
  } catch (err) {
    console.log(`\n=== ${model} 失败: ${err.message} ===`);
  }
}

// 错误处理路径：无效密钥应给出可读提示而不是崩掉
state.settings.key = 'sk-invalid-key-for-test';
try {
  await api.callLLM(payload);
  console.log('\n❌ 无效密钥竟然调用成功（异常情况）');
} catch (err) {
  console.log('\n无效密钥的提示文案: ' + err.message.slice(0, 140));
}
