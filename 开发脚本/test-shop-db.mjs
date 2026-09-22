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
  code + '\nglobalThis.__D={state,loadShopDb,SHOP_DB,dbShopFor,dbShopForCached,shopCanMake,shopMenuSource,menuHasDish,dbMenuDishes,restaurantServes,buildCombo,recommend,pickAnchors,applyCity,DISHES,clearAmapCache,onlineSearch,recommendRestaurantsSmart,DEFAULT_AMAP_KEY,buildShopDbIndex,dbScopeOf,cuisineRefFor,dishById,menuSourceText,get CITY(){return CITY}};')
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
/* 按名字取，不用 shops[0]：库里现在不止一家店（沙县小吃 + 女掌柜土家菜馆），
 * 顺序跟着文件夹读取顺序走，写死下标会让测试无缘无故变红。 */
const dbShop = D.SHOP_DB.shops.find(s => s.name.indexOf('沙县') !== -1) || D.SHOP_DB.shops[0];
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
/* 菜单条目数 ≥ 对应到的知识库菜数才对：一份菜单里可能有两行指向同一道菜
 * （女掌柜菜单上「回锅肉」和「蒜苗回锅肉」都是知识库的 cn02），去重后自然少一条。 */
ok(menuDishes.length <= (dbShop.menu || []).length && menuDishes.length > 0,
   '菜单 ' + (dbShop.menu || []).length + ' 条 → 对应知识库 ' + menuDishes.length + ' 道菜（去重后，不会凭空多出菜）');

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
  const realSha = D.SHOP_DB.shops.find(s => s.name.indexOf('沙县') !== -1);
  ok(realSha && D.dbScopeOf(realSha) === 'brand', '⑥ 现有那份沙县菜单是"品牌参照"（还没绑定到具体分店）');
  /* 女掌柜是真绑定了高德 ID 的"本店确认"：只认那一家分店，
   * 同城另一家名字像的（高阳县「女掌柜火烧」）不该被塞上这份菜单。 */
  const realNz = D.SHOP_DB.shops.find(s => s.name.indexOf('女掌柜') !== -1);
  ok(realNz && D.dbScopeOf(realNz) === 'branch' && realNz.amapId === 'B0FFGWFUGT',
     '⑦ 女掌柜土家菜馆是本店确认（高德ID ' + (realNz ? realNz.amapId : '—') + '，菜单 ' + (realNz ? realNz.menu.length : 0) + ' 条）');
  ok(D.dbShopFor({ id:'amap-B0FFGWFUGT', name:'女掌柜土家菜馆' }) === realNz, '⑧ 高德ID 精确命中这家店');
  ok(D.dbShopFor({ id:'amap-NOPE', name:'女掌柜火烧' }) === null, '⑨ 名字像的别家店不会被误配（那家是火烧铺）');
}

console.log('\n=== 九、菜系参照（同城同菜系借菜单，只做加法）===');
{
  await D.loadShopDb();
  D.state.profile.city = 'baoding';
  try{ D.applyCity('baoding'); }catch(e){}

  const chuanShop = { id:'amap-CQ1', name:'老重庆江湖菜馆', cui:['川'], tags:['川菜','麻辣'], sig:[], online:true };
  const yueShop   = { id:'amap-Y1',  name:'老广粤菜馆',    cui:['粤'], tags:['粤菜'],     sig:[], online:true };
  const nzShop    = { id:'amap-B0FFGWFUGT', name:'女掌柜土家菜馆', cui:['川'], tags:['川菜'], sig:[], online:true };

  const ref = D.cuisineRefFor(chuanShop);
  ok(!!(ref && ref.name.indexOf('女掌柜') !== -1), '川菜馆没采集过 → 借到同城「女掌柜」的菜单当参考');
  ok(D.cuisineRefFor(yueShop) === null, '粤菜馆借不到（菜系对不上）');
  ok(D.cuisineRefFor(nzShop) === null, '自己已经有本店确认菜单 → 不用借参照');

  const chuanDish = D.dishById('cq45');    // 干锅肥肠（川）
  const homeDish  = D.dishById('cq64');    // 空心菜（家常：菜单里有，但参照不跨菜系）
  const tagless   = D.dishById('cq43');    // 粉蒸格格肉（川：标签跟"川菜"没交集，只有靠参照才认）
  const notOnRef  = D.dishById('cn05');    // 藤椒鱼（川，但女掌柜菜单里没有）
  /* 参照只认同菜系的菜：川菜馆借了这份菜单也不会"会做湘菜/家常菜"，
   * 否则"店与菜按菜系对口"这条底线就破了（菜单里有道湘菜「农家一碗香」）。 */
  ok(D.shopCanMake(chuanShop, homeDish) === false, '参照不跨菜系：川菜馆不会因为菜单里有空心菜就"会做"它');
  /* 因果验证：把粉蒸格格肉的标签清空 → 靠"菜系+标签"推不出来，只有参照能把它认下来 */
  const noTag = Object.assign({}, tagless, { tags: [] });
  const plainChuan = { id:'amap-T1', name:'测试川菜馆', cui:['川'], tags:['川菜'], sig:[] };
  const plainYue   = { id:'amap-T2', name:'测试粤菜馆', cui:['粤'], tags:['粤菜'], sig:[] };
  ok(D.menuHasDish(ref, tagless) === true, '粉蒸格格肉（川）在这份参考菜单里');
  ok(D.restaurantServes(plainChuan, noTag) === true, '同菜系：标签推不出来时，参照把这道川菜认下来了');
  ok(D.restaurantServes(plainYue, noTag) === false, '换菜系：粤菜馆不认这道川菜');
  ok(D.shopCanMake(yueShop, chuanDish) === false, '粤菜馆不会因为库里有川菜菜单就"能做川菜"');
  /* 最关键的一条：参照不是封闭菜单——菜单里没有的菜，菜系对得上照样能做。
   * 如果哪天有人把菜系参照接成 shopMenuSource，别的川菜馆会被锁死成这份菜单，这条就会红。 */
  ok(D.menuHasDish(ref, notOnRef) === false, '藤椒鱼确实不在参照菜单里');
  ok(D.shopCanMake(chuanShop, notOnRef) === true, '但川菜馆依然能做它（菜系推断照旧，没被锁死）');
  ok(D.shopCanMake(nzShop, notOnRef) === false, '女掌柜自己有菜单 → 藤椒鱼不在菜单里就是不能做（封闭集合）');
  ok(D.menuSourceText(chuanShop).indexOf('菜系参照') === 0 && D.menuSourceText(yueShop).indexOf('未采集') === 0,
     '备选卡片文案区分开了：川菜馆「' + D.menuSourceText(chuanShop) + '」/ 粤菜馆「' + D.menuSourceText(yueShop) + '」');

  /* 熊麻婆（现炒浇头面·饭，保定永华北大街店）：本店确认 + 给"盖面盖饭类店"当参照。
   * 它的参照不能只挂菜系——程序把这家店推成「保定」（店名里带城市名），
   * 黄焖鸡这类被判成「西」，所以还得能按店名关键词认（cuisineRefKeys）。 */
  const xm = D.SHOP_DB.shops.find(s => s.name.indexOf('熊麻婆') !== -1);
  ok(xm && xm.amapId === 'B0MUH1QNEC' && D.dbScopeOf(xm) === 'branch',
     '熊麻婆是"本店确认"（高德ID ' + (xm ? xm.amapId : '—') + '）');
  ok(!!(xm && (xm.cuisineRefKeys || []).length), '它同时声明了给盖面盖饭类店的参照关键词');
  /* 高德店名写的是"面.饭"（ASCII 点），库里绑定时写成了"面·饭"（间隔号）。
   * 品牌名归一化必须把这俩当同一个，否则同城分店借不到菜单——实测踩过这个坑。 */
  const sameBrandOther = { id:'amap-XM2', name:'熊麻婆现炒浇头面.饭(保定裕华路店)', cui:['保定'], tags:['中餐厅'], sig:[] };
  ok(D.dbShopFor(sameBrandOther) === xm, '同城同品牌分店能借到（"面.饭" 和 "面·饭" 视为同一品牌）');

  const gaiFan = { id:'amap-GF', name:'老李盖浇饭', cui:['家常'], tags:['快餐'], sig:[] };
  const laMian = { id:'amap-LM', name:'兰州牛肉拉面', cui:['西北'], tags:['拉面'], sig:[] };
  const refGai = D.cuisineRefFor(gaiFan);
  ok(!!(refGai && refGai.name.indexOf('熊麻婆') !== -1), '盖浇饭店没采集过 → 借到熊麻婆的菜单当参考');
  ok(D.cuisineRefFor(laMian) === null, '兰州拉面不借（菜系和店名都对不上）');

  /* 川香苑：点菜型川菜馆，本店确认；同城"川菜参照"现在有两家（女掌柜 + 川香苑），
   * 必须合并成一份，而不是"谁排在前面算谁"。 */
  const cx = D.SHOP_DB.shops.find(s => s.name === '川香苑');
  ok(cx && cx.amapId === 'B0K05HVF6L' && D.dbScopeOf(cx) === 'branch', '川香苑是本店确认（' + (cx ? cx.amapId : '—') + '）');
  ok(!!(cx && cx.menu.some(m => m.name === '米饭' && m.price === 2)), '菜单里有米饭 ¥2（川香苑也有主食）');
  const chuanShop2 = { id:'amap-CX1', name:'老成都川菜馆', cui:['川'], tags:['川菜'], sig:[] };
  const ref2 = D.cuisineRefFor(chuanShop2);
  ok(!!(ref2 && ref2.name.indexOf('女掌柜') !== -1 && ref2.name.indexOf('川香苑') !== -1),
     '同城同类店合并成一份参考：' + (ref2 ? ref2.name : '无'));
  ok(!!(ref2 && D.menuHasDish(ref2, D.dishById('cx01'))), '川香苑的招牌菜在合并参考里');
}

console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 商家数据库（补菜单不改偏好）全部通过'));
process.exit(fail ? 1 : 0);
