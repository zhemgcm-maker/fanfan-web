// 把页面里的本地知识库原样导出，便于核对
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=v}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.KB={DISHES,RESTAURANTS,TIERS,CATS,CRAVE_TAGS,ALLERGIES,TASTE_TAGS,CUISINE_KEYWORDS,LANDMARK_COORDS,ALG_MAP,AMAP_CUI_RULES,OSM_MIRRORS,CITY,PROVIDERS};')
  (document, localStorage, (f)=>setTimeout(f,0), ()=>Promise.reject(new Error('x')));

const K = globalThis.KB;
const p = (s) => console.log(s);

p('=== 菜品库：' + K.DISHES.length + ' 道 ===');
for (const cat of K.CATS) {
  const list = K.DISHES.filter(d => d.cat === cat.id);
  p('\n[' + cat.name + '] ' + list.length + ' 道');
  list.forEach(d => p('  ' + d.name.padEnd(20, ' ') + ' ¥' + String(d.price).padStart(3) + '  辣' + d.spicy + '  ' + d.cui + '  ' + d.tags.join('/')));
}

p('\n按菜系统计:');
const byCui = {};
K.DISHES.forEach(d => byCui[d.cui] = (byCui[d.cui] || 0) + 1);
p('  ' + Object.entries(byCui).sort((a,b)=>b[1]-a[1]).map(([k,v]) => k + ':' + v).join('  '));

p('\n价格分布: ¥' + Math.min(...K.DISHES.map(d=>d.price)) + ' ~ ¥' + Math.max(...K.DISHES.map(d=>d.price)));
p('单价 ≤25 的: ' + K.DISHES.filter(d=>d.price<=25).length + ' 道；26-60 的: ' + K.DISHES.filter(d=>d.price>25&&d.price<=60).length + ' 道；>60 的: ' + K.DISHES.filter(d=>d.price>60).length + ' 道');

p('\n=== 离线兜底饭店：' + K.RESTAURANTS.length + ' 家 ===');
const byArea = {};
K.RESTAURANTS.forEach(r => (byArea[r.area] = byArea[r.area] || []).push(r));
Object.entries(byArea).forEach(([area, list]) => {
  p('\n[' + area + ']');
  list.forEach(r => p('  ' + r.name.padEnd(24, ' ') + ' 人均¥' + String(r.avg).padStart(3) + '  ' + r.rating + '分  ' + r.cui.join('/') + (r.delivery ? '  可外卖' : '  仅堂食') + (r.sig.length ? '  招牌' + r.sig.length + '道' : '')));
});

p('\n=== 标签体系 ===');
p('预算档位 ' + K.TIERS.length + ' 档: ' + K.TIERS.map(t=>t.emoji+t.name+'(¥'+(t.min===0?'≤'+t.max:t.min+'-'+t.max)+')').join('  '));
p('食物大类 ' + K.CATS.length + ': ' + K.CATS.map(c=>c.emoji+c.name).join('  '));
p('今日想吃标签 ' + K.CRAVE_TAGS.length + ': ' + K.CRAVE_TAGS.join('、'));
p('忌口/过敏项 ' + K.ALLERGIES.length + ': ' + K.ALLERGIES.join('、'));
p('口味偏好标签 ' + K.TASTE_TAGS.length + ': ' + K.TASTE_TAGS.join('、'));
p('忌口→食材映射 ALG_MAP: ' + Object.entries(K.ALG_MAP).map(([k,v])=>k+'→'+v.join('/')).join('  '));

p('\n=== 保定地理数据 ===');
p('城市: ' + JSON.stringify(K.CITY));
p('商圈关键词 ' + Object.keys(K.CUISINE_KEYWORDS).length + ' 个: ' + Object.keys(K.CUISINE_KEYWORDS).join('、'));
p('地标坐标 ' + Object.keys(K.LANDMARK_COORDS).length + ' 个: ' + Object.keys(K.LANDMARK_COORDS).join('、'));

p('\n=== 联网/模型配置 ===');
p('高德类型→菜系规则 ' + K.AMAP_CUI_RULES.length + ' 条');
p('OSM 镜像 ' + K.OSM_MIRRORS.length + ' 个: ' + K.OSM_MIRRORS.join(' , '));
p('大模型服务商 ' + Object.keys(K.PROVIDERS).length + ' 个: ' + Object.entries(K.PROVIDERS).map(([k,v])=>k+'('+v.models.map(m=>m.id).join('/')+')').join('  '));
