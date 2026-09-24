// 测试：「我的」→ AI 记忆 的查看与编辑
// 覆盖：① 默认只读（没有 ✕），点「编辑」后每条才出现可删按钮
//       ② 删喜欢 / 删不喜欢 / 删被屏蔽的菜：只删这一条，别的条目不动，并且立刻落盘
//       ③「最近吃过」点一条能展开具体日期（年/月/日 + 星期 + 时刻）
//       ④ 相对天数按自然日算：昨晚吃的早上看是「昨天」，不是「今天」
//       ⑤ 同一顿（前后 45 分钟内记的）会一起列出来
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function fakeEl(){const el={innerHTML:'',value:'',className:'',style:{},children:[],dataset:{},classList:{_s:new Set(),add(){},remove(){},contains(){return false},toggle(){}},setAttribute(){},getAttribute(){return null},addEventListener(){},appendChild(c){return c},querySelector(){return fakeEl()},querySelectorAll(){return []},scrollIntoView(){}};let t='';Object.defineProperty(el,'textContent',{get(){return t},set(v){t=String(v);el.innerHTML=String(v).replace(/<[^>]+>/g,'')}});return el}
const cache=new Map();
const document={body:fakeEl(),querySelector(s){if(!cache.has(s))cache.set(s,fakeEl());return cache.get(s)},querySelectorAll(){return []},createElement(){return fakeEl()},addEventListener(){}};
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};

async function mockFetch(){ return { ok:false, status:404, json: async () => ({}), text: async () => '' }; }

new Function('document','localStorage','requestAnimationFrame','fetch',
  code + '\nglobalThis.__M={state,renderProfile,toggleMemEdit,deleteMemEntry,openHistDetail,onMemoryCardClick,fmtMoment,relDay,histKey,DISHES,dishById,saveProfile};')
  (document, localStorage, (f)=>setTimeout(f,0), mockFetch);
const M = globalThis.__M;
const $ = s => document.querySelector(s);

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); if(!cond) fail++; };

// 找两道真菜，避免用不存在的 id（菜名解析不出来时会退化成 id，断言就白测了）
const d0 = M.DISHES[0], d1 = M.DISHES[1], d2 = M.DISHES[2];
const DAY = 24 * 3600 * 1000;
const today10 = new Date(); today10.setHours(10, 0, 0, 0);
const yesterday = today10.getTime() - DAY;          // 昨天 10:00
const lastNight = new Date(); lastNight.setDate(lastNight.getDate() - 1); lastNight.setHours(23, 30, 0, 0);

function resetProfile(){
  M.state.profile.likes = { '家常':3, '川':2 };
  M.state.profile.dislikes = { '香菜':2, '内脏':1 };
  M.state.profile.banned = { dishes:{ [d2.id]: Date.now() }, shops:{} };
  M.state.profile.history = [
    { id:d0.id, ts:yesterday, price:22 },
    { id:d1.id, ts:yesterday + 60*1000, price:9 },      // 同一顿
    { id:d2.id, ts:today10.getTime(), price:28 }
  ];
  M.state.memEdit = false; M.state.memHistOpen = null;
  store.clear();
}

console.log('=== 一、默认只读，点「编辑」才出现删除按钮 ===');
resetProfile();
M.renderProfile();
ok($('#pLikes').innerHTML.includes('家常 ×3'), '喜欢按次数排序展示：' + $('#pLikes').innerHTML);
ok(!$('#pLikes').innerHTML.includes('data-memdel'), '只读态没有删除按钮（不会误删）');
ok(!$('#pHistory').innerHTML.includes('data-memdel'), '最近吃过在只读态也不带删除按钮');
ok($('#memEditBtn').textContent === '编辑', '按钮初始文案是「编辑」');

M.toggleMemEdit();
ok(M.state.memEdit === true, '点一下进入编辑态');
ok($('#memEditBtn').textContent === '完成', '编辑态按钮文案变成「完成」');
ok($('#pLikes').innerHTML.includes('data-memdel="like"') && $('#pLikes').innerHTML.includes('✕'), '喜欢每条都带删除按钮：' + $('#pLikes').innerHTML);
ok($('#pDislikes').innerHTML.includes('data-memdel="dislike"'), '不喜欢每条都带删除按钮');
ok($('#pBanned').innerHTML.includes('data-memdel="banDish"'), '被屏蔽的菜也能逐条删');
ok($('#memEditNote').textContent.includes('✕'), '提示语跟着换成怎么删：' + $('#memEditNote').textContent);

console.log('\n=== 二、逐条删除：只删这一条，别的不动，并落盘 ===');
M.deleteMemEntry('like', '家常');
ok(!('家常' in M.state.profile.likes), '删掉的喜欢已经不在记忆里');
ok(M.state.profile.likes['川'] === 2, '同一张表里别的喜欢没被牵连');
const profKey = [...store.keys()].find(k => String(store.get(k)).includes('"likes"'));
ok(!!profKey, '删完立刻写进浏览器存储（存档 key：' + profKey + '）');
const saved = profKey ? JSON.parse(store.get(profKey)) : {};
ok(!('家常' in (saved.likes || {})), '存进去的那份里也没有「家常」了（刷新后不会复活）');
ok(saved.likes && saved.likes['川'] === 2, '存进去的那份里「川」还在');

console.log('\n--- 误删要能撤销 ---');
ok(typeof $('#toast').onclick === 'function' && $('#toast').textContent.includes('撤销'), '删完的提示条上带撤销入口：' + $('#toast').textContent);
$('#toast').onclick();
ok(M.state.profile.likes['家常'] === 3, '点一下撤销：这条连同原来的次数一起回来了（不是只放回 1 次）');
ok(M.state.profile.likes['川'] === 2, '撤销不会顺手改动别的条目');
ok(typeof $('#toast').onclick !== 'function', '撤销完入口就关掉，不会重复撤销');
M.deleteMemEntry('like', '家常');                    // 再删一次，接着测别的
ok(!('家常' in M.state.profile.likes), '撤销之后还能再删掉');

M.deleteMemEntry('dislike', '香菜');
ok(!('香菜' in M.state.profile.dislikes), '删掉的不喜欢已经不在记忆里');
ok(M.state.profile.dislikes['内脏'] === 1, '别的不喜欢没被牵连');
M.deleteMemEntry('banDish', d2.id);
ok(!(d2.id in M.state.profile.banned.dishes), '删掉的屏蔽菜已经解封');
$('#toast').textContent = '';
M.deleteMemEntry('like', '本来就没有的口味');
ok($('#toast').textContent === '', '删一条本来就不存在的记忆时不会白弹提示');
ok($('#pLikes').innerHTML.includes('川 ×2'), '删完重渲染，剩下的喜欢还在');

console.log('\n=== 三、最近吃过：点一条看具体哪天 ===');
M.toggleMemEdit();                                   // 回到只读态
ok(M.state.memEdit === false, '再点一下退出编辑态');
ok(!$('#pLikes').innerHTML.includes('data-memdel'), '退出编辑态后删除按钮消失');
M.renderProfile();
ok($('#pHistory').innerHTML.includes('data-hist="0"'), '最近吃过每条都能点');
ok(!$('#pHistory').innerHTML.includes('hist-detail'), '没点开时不显示日期卡');
ok($('#pHistory').innerHTML.includes('今天') && $('#pHistory').innerHTML.includes('昨天'), '列表上仍有「今天 / 昨天」的粗粒度提示');
// 记忆可能从别的设备同步过来，数组顺序不保证 —— 展示必须按时间排
const oldTs = yesterday - 5 * DAY;                   // 共 6 天前，故意追加在数组末尾
M.state.profile.history.push({ id:d0.id, ts:oldTs, price:15 });
M.renderProfile();
const listHTML = $('#pHistory').innerHTML;
ok(listHTML.lastIndexOf(M.relDay(oldTs)) > listHTML.lastIndexOf('今天'), '存进去时顺序乱了也不会看错：展示按时间排，"最近吃过"永远是最近的在最前');

// 列表是倒序的：下标 0 是最新那条（今天 10:00），1 是昨天，2 是昨天同一顿的前一道
M.openHistDetail(0);
const htmlToday = $('#pHistory').innerHTML;
ok(htmlToday.includes('hist-detail'), '点开后出现日期卡');
ok(htmlToday.includes(M.fmtMoment(today10.getTime())), '日期卡写清了具体日期与时刻：' + M.fmtMoment(today10.getTime()));
ok(/年\d+月\d+日 周[日一二三四五六] \d\d:\d\d/.test(htmlToday), '格式是「…年…月…日 周X HH:MM」');
ok(htmlToday.includes('¥28'), '顺带显示当时记的价：¥28');

M.openHistDetail(1);
const htmlYesterday = $('#pHistory').innerHTML;
ok(htmlYesterday.includes(M.fmtMoment(yesterday + 60*1000)), '换一条显示对应的日期：' + M.fmtMoment(yesterday + 60*1000));
ok(!htmlYesterday.includes('hist-detail"><div class="hd-date">' + M.fmtMoment(today10.getTime())), '换一条后上一条的日期卡收起来了');
ok(htmlYesterday.includes('同一顿还记了：' + d0.name), '同一顿里的别的菜一起列出来：' + d0.name);
M.openHistDetail(1);
ok(!$('#pHistory').innerHTML.includes('hist-detail'), '再点同一条收起日期卡');

console.log('\n=== 四、相对天数按自然日算 ===');
ok(M.relDay(Date.now()) === '今天', '刚记的 = 今天');
ok(M.relDay(lastNight.getTime()) === '昨天', '昨晚 23:30 吃的那顿，早上看是「昨天」而不是「今天」');
ok(M.relDay(Date.now() - 3 * DAY) === '3天前', '三天前 = 3天前');

console.log('\n=== 五、卡片点击委托 ===');
const evt = sel => ({ target:{ closest:(s) => (s === sel ? { getAttribute:(k) => ({ 'data-memdel':'like','data-memkey':'川' }[k]) } : null) } });
M.deleteMemEntry('like', '川');
M.state.profile.likes['川'] = 2;                     // 放回去，专门测委托这条路
M.onMemoryCardClick(evt('[data-memdel]'));
ok(!('川' in M.state.profile.likes), '点胶囊（事件委托）也能删掉那条记忆');
M.onMemoryCardClick({ target:{} });
ok(true, '点到卡片空白处不报错');

console.log('\n' + (fail ? '❌ 有 ' + fail + ' 条没通过' : '✅ AI 记忆编辑 + 最近吃过日期：全部通过'));
process.exit(fail ? 1 : 0);
