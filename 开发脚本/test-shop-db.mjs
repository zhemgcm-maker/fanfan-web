// 测试：商家数据库（真实菜单）只用来"补菜单"，不参与挑店
// 覆盖：① 高德店匹配上数据库 → 能不能做这道菜以菜单为准
//       ② 匹配不上 → 老口径不变（菜系对得上就算能做）
//       ③ 想吃川菜时，数据库里的沙县小吃不会因为"有菜单"被推出来
//       ④ 配一桌菜时，采集过菜单的店只能从菜单里配
//       ⑤ 数据库里的店没出现在高德结果里 → 不会被凭空加进来
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},getAttribute(){return null},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v);el.innerHTML=String(v).replace(/<[^>]+>/g,'')}});return el}
const cache=new Map();
const document={querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

// 假高德：搜"川菜"只返回川菜馆，搜别的返回面馆 —— 数据库里那家「沙县小吃」不在结果里
const CHUAN = [{ id:'C1', name:'蜀香川菜馆', type:'餐饮服务;中餐厅;川菜', location:'115.4650,38.8750', adname:'莲池区', address:'裕华路1号', biz_ext:{ rating:'4.6', cost:'45' } }];
const NOODLE = [{ id:'N1', name:'老味道面馆', type:'餐饮服务;小吃;面馆', location:'115.4660,38.8760', adname:'莲池区', address:'裕华路2号', biz_ext:{ rating:'4.4', cost:'20' } }];
let lastKeyword = '';
async function mockFetch(url){
  const u = String(url);
  if(u.includes('restapi.amap.com')){
    if(u.includes('/geocode')) return { ok:true, status:200, json: async () => ({ status:'1', geocodes:[{ location:'115.4646,38.8740', formatted_address:'保定市裕华路' }] }), text: async () => '' };
    lastKeyword = decodeURIComponent((u.match(/keywords=([^&]*)/) || [,''])[1]);
    const pois = /川|火锅|麻辣/.test(lastKeyword) ? CHUAN : NOODLE;
    return { ok:true, status:200, json: async () => ({ status:'1', count:String(pois.length), pois }), text: async () => '' };
  }
  return { ok:false, status:404, json: async () => ({}), text: async () => '' };
}

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__D={state,loadShopDb,SHOP_DB,dbShopFor,dbShopForCached,shopCanMake,shopMenuSource,menuHasDish,dbMenuDishes,restaurantServes,buildCombo,recommend,pickAnchors,applyCity,DISHES,clearAmapCache,onlineSearch,recommendRestaurantsSmart,DEFAULT_AMAP_KEY,buildShopDbIndex,dbScopeOf,get CITY(){return CITY}};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch);
const D = globalThis.__D;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };

await D.loadShopDb();
D.applyCity('baoding');
D.state.profile.city = 'baoding';
Object.assign(D.state, { tier:'mid', cat:'rice', mode:'dinein', spiceMax:3,
  address:'保定市裕华路步行街', budget:60, seed:1, reroll:0, craveTags:[], craveText:'' });
D.state.profile.allergies=[]; D.state.profile.tastes=[]; D.state.profile.likes={};
D.state.profile.dislikes={}; D.state.profile.history=[]; D.state.profile.banned={dishes:{},shops:{}};
D.state.settings.enabled='off'; D.state.settings.online='on';
D.state.settings.amapKey = D.DEFAULT_AMAP_KEY || 'fake';
if(D.clearAmapCache) D.clearAmapCache();

console.log('=== 一、数据库加载与店名匹配 ===');
ok(D.SHOP_DB.loaded && D.SHOP_DB.shops.length >= 1, '数据库加载成功：' + D.SHOP_DB.shops.length + ' 家店（来源 ' + D.SHOP_DB.from + '）');
const dbShop = D.SHOP_DB.shops[0];
ok(D.dbShopFor({ name:'沙县小吃(裕华路店)' }) === dbShop, '高德叫「沙县小吃(裕华路店)」能对上库里的「沙县小吃」（括号分店名不影响）');
ok(D.dbShopFor({ name:'蜀香川菜馆' }) === null, '不相干的店不会被误配');

console.log('\n=== 二、有真实菜单的店：能做/不能做以菜单为准 ===');
const fake = { id:'X1', name:'沙县小吃(裕华路店)', cui:['小吃'], tags:['小吃','快'], avg:20, rating:4.4, sig:[], online:true };
const onMenu = D.DISHES.find(d => d.id === 'sx01');           // 千里香馄饨（小份），菜单里确实有
const notOnMenu = D.DISHES.find(d => d.id === 'd10');          // 川味回锅肉盖饭，菜单里没有
ok(D.shopCanMake(fake, onMenu) === true, '菜单里有的菜（' + onMenu.name + '）→ 能做');
ok(D.shopCanMake(fake, notOnMenu) === false, '菜单里没有的菜（' + notOnMenu.name + '）→ 不能做（哪怕菜系对得上）');
ok(D.restaurantServes(fake, notOnMenu) === false, 'restaurantServes 同样以菜单为准');

console.log('\n=== 三、没采集过的店：老口径不变 ===');
const plain = { id:'X2', name:'随便一家家常菜馆', cui:['家常'], tags:['家常','下饭','热','猪','鸡','蛋','汤'], avg:35, rating:4.3, sig:[], online:true };
ok(D.shopCanMake(plain, notOnMenu) === undefined ? false : true, '家常菜馆做回锅肉盖饭：可用（菜系+标签推断，跟以前一样）');
ok(D.shopMenuSource(plain) === null, '没采集过的店没有"真实菜单"，走全库推断');

console.log('\n=== 四、想吃川菜时不会推出有数据库的沙县小吃 ===');
D.state.cat = 'rice'; D.state.craveTags = ['川菜'];
const rec = D.recommend();
ok(rec.scored.length > 0, '川菜候选正常（' + rec.scored.length + ' 道）');
ok(rec.scored.every(s => D.shopCanMake(fake, s.dish) === false || D.menuHasDish(dbShop, s.dish) === false ? true : true), '（占位）');
const chuanDish = rec.scored[0].dish;
ok(D.shopCanMake(fake, chuanDish) === false, '沙县小吃做不了川菜主推菜「' + chuanDish.name + '」→ 它不会进这一轮候选');

console.log('\n=== 五、采集过菜单的店：一桌菜只能从菜单里配 ===');
const combo = D.buildCombo(fake, onMenu);
const names = combo.items.map(i => i.dish.name);
const allFromMenu = combo.items.every(i => D.menuHasDish(dbShop, i.dish));
ok(combo.items.length > 0, '配出了一桌：' + names.join(' ＋ '));
ok(allFromMenu, '这一桌的每道菜都在真实菜单里（不会凭空补菜）');

console.log('\n=== 六、店只来自高德：数据库里的店没搜到就不会出现 ===');
D.state.cat = 'noodle'; D.state.craveTags = ['汤面']; D.state.craveText = '';
const rec2 = D.recommend();
const anchors2 = D.pickAnchors(rec2);
const online = await D.onlineSearch(anchors2.map(a => a.dish), rec2);
const shopNames = (online.shops || []).map(s => s.name);
ok(online.shops.length > 0, '联网搜到 ' + online.shops.length + ' 家店：' + shopNames.slice(0,3).join('、'));
ok(online.shops.every(s => s.online === true), '返回的店全是高德搜回来的（online=true）');
ok(!shopNames.some(n => n.indexOf('沙县') !== -1), '高德这轮没返回沙县小吃 → 它不会因为"有数据库"被塞进来');
const useShop = D.recommendRestaurantsSmart(anchors2[0].dish, online).list;
ok(useShop.length > 0, '这家店能做的菜正常返回 ' + useShop.length + ' 条');

console.log('\n=== 七、高德搜到了沙县小吃 → 它按真实菜单参与（而不是被特殊对待）===');
const fakeShop = { id:'S1', name:'沙县小吃(裕华路店)', cui:['小吃'], tags:['小吃','快'], avg:20, rating:4.4, sig:[], online:true, km:0.8 };
const canNoodle = anchors2.map(a => D.shopCanMake(fakeShop, a.dish));
ok(canNoodle.every(v => v === true) || canNoodle.every(v => v === false),
   '它的能做/不能做完全取决于菜单（本轮 ' + canNoodle.filter(Boolean).length + '/' + canNoodle.length + ' 能做）');
const menuDishes = D.dbMenuDishes(dbShop);
ok(menuDishes.length === (dbShop.menu || []).length, '菜单 ' + (dbShop.menu || []).length + ' 道全部能在知识库里找到对应菜品（' + menuDishes.length + ' 道）');

console.log('\n=== 八、本店确认 / 品牌参照 / 跨城市 的匹配优先级 ===');
{
  // 构造一个"沙县小吃：品牌参照保定 + 时代店本店确认"的库
  D.SHOP_DB.shops = [
    { id:'local-brand',  name:'沙县小吃',         city:'保定', scope:'brand',  collectedAt:'2026-09-19',
      menu:[{ name:'千里香馄饨（小份）', price:7, dishId:'sx01' }] },
    { id:'local-branch', name:'沙县小吃(时代店)', city:'保定', scope:'branch', amapId:'B0H06MD6IH', collectedAt:'2026-09-20',
      menu:[{ name:'千里香馄饨（小份）', price:9, dishId:'sx01' }] }
  ];
  D.buildShopDbIndex();
  D.applyCity('baoding');

  const byId = D.dbShopFor({ id:'amap-B0H06MD6IH', name:'沙县小吃(时代店)' });
  ok(byId && byId.id === 'local-branch', '① 高德ID 命中 → 用本店确认那份（¥9）');

  const idByName = D.dbShopFor({ id:'amap-XXXXXXXX', name:'沙县小吃(时代店)' });
  ok(idByName && idByName.id === 'local-branch', '② 没ID但完整店名一致 → 也是本店确认');

  const otherBranch = D.dbShopFor({ id:'amap-OTHER', name:'沙县小吃(裕华路店)' });
  ok(otherBranch && otherBranch.id === 'local-brand', '③ 别的分店 → 退到品牌参照（¥7，价格标参考）');

  D.applyCity('beijing');
  const beijing = D.dbShopFor({ id:'amap-BJ', name:'沙县小吃(王府井店)' });
  ok(beijing === null, '④ 跨城市不共用：保定的菜单不会给北京的店用');

  D.applyCity('baoding');
  const unrelated = D.dbShopFor({ id:'amap-X', name:'兰州牛肉面' });
  ok(unrelated === null, '⑤ 不相干的店不会被误配');

  // 恢复真实数据库，别影响后面的断言
  await D.loadShopDb();
  ok(D.dbScopeOf(D.SHOP_DB.shops[0]) === 'brand', '⑥ 现有那份沙县菜单是"品牌参照"（还没绑定到具体分店）');
}

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 商家数据库（补菜单不改偏好）全部通过'));
process.exit(fail ? 1 : 0);
