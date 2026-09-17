// 追查：搜"火锅"时，主推的那家店到底是什么类型、分数怎么来的
import fs from 'node:fs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set({}){}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:()=>{},removeItem:()=>{}};
new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__d={state,recommend,pickAnchors,recommendRestaurantsSmart,onlineSearch,DISHES,DEFAULT_AMAP_KEY,restaurantServes,amapTags,amapCui,CUI_TAGS};')
  (document, localStorage, (f)=>setTimeout(f,0), globalThis.fetch.bind(globalThis));
const api = globalThis.__d;

Object.assign(api.state, { tier:'mid', cat:'other', budget:80, craveTags:['火锅'], craveText:'',
  address:'保定市裕华路步行街', mode:'dinein', spiceMax:3, seed:1 });
api.state.profile.allergies=[]; api.state.profile.tastes=[]; api.state.profile.likes={}; api.state.profile.history=[];
api.state.settings.amapKey = api.DEFAULT_AMAP_KEY; api.state.settings.online='on';

const rec = api.recommend();
const anchors = api.pickAnchors(rec);
console.log('锚定菜数：' + anchors.length + ' → ' + anchors.map(a => a.dish.name + '（cui=' + a.dish.cui + '）').join('、'));
const outer = await api.onlineSearch(anchors.map(a => a.dish));

const dish = anchors[0].dish;
console.log('\n=== 拿「' + dish.name + '」(cui=' + dish.cui + ') 去给各家店打分 ===');
const r = api.recommendRestaurantsSmart(dish, outer);
console.log('候选店数：' + r.list.length);
r.list.slice(0, 8).forEach((x, i) => {
  const rr = x.restaurant;
  console.log('  ' + (i + 1) + '. ' + rr.name.padEnd(24) + ' 总分 ' + x.total +
    ' ｜ km ' + x.km + ' ｜ cui=' + rr.cui.join('/') + ' ｜ 菜系对口=' + rr.cui.includes(dish.cui) +
    ' ｜ 能做？' + api.restaurantServes(rr, dish) + ' ｜ 人均 ' + rr.avg + ' ｜ 评分 ' + (rr.rating || '-'));
  console.log('      分项: ' + Object.entries(x.parts).map(([k, v]) => k + '=' + v.raw).join(' ') + '  ｜ tags=' + rr.tags.slice(0, 8).join(','));
});
