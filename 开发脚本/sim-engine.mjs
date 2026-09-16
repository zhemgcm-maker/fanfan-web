import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/* ---- 最小 DOM 桩 ---- */
function fakeEl() {
  const el = {
    innerHTML: '', textContent: '', value: '', className: '', style: {}, children: [],
    classList: { add(){}, remove(){}, contains(){ return false; } },
    setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){},
    appendChild(c){ el.children.push(c); return c; },
    querySelector(){ return fakeEl(); },
    querySelectorAll(){ return []; },
    scrollIntoView(){}, focus(){}, onclick: null
  };
  return el;
}
const cache = new Map();
const document = {
  querySelector(sel) {
    if (!cache.has(sel)) cache.set(sel, fakeEl());
    return cache.get(sel);
  },
  createElement() { return fakeEl(); },
  addEventListener(){}
};
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const requestAnimationFrame = (fn) => setTimeout(fn, 0);

const hook = `
globalThis.__api = { state, recommend, recommendRestaurants, DISHES, RESTAURANTS, saveProfile, scoreDish };
`;

const fn = new Function('document', 'localStorage', 'requestAnimationFrame', 'fetch', code + hook);
fn(document, localStorage, requestAnimationFrame, () => { throw new Error('no network in sim'); });

const { state, recommend, recommendRestaurants } = globalThis.__api;

function scenario(name, patch) {
  Object.assign(state, {
    tier: null, cat: null, craveTags: [], craveText: '', address: '上海市浦东新区张江高科地铁站',
    mode: 'delivery', spiceMax: 3, seed: 1
  });
  state.profile.allergies = [];
  state.profile.tastes = [];
  state.profile.likes = {};
  state.profile.dislikes = {};
  state.profile.history = [];
  Object.assign(state, patch);
  if (patch.allergies) state.profile.allergies = patch.allergies;
  // 与界面一致：选定档位后，预算上限默认取该档位上限
  const tierCap = { small:25, mid:60, good:150 }[state.tier];
  if (tierCap) state.budget = tierCap;

  const rec = recommend();
  const top = rec.scored.slice(0, 3);
  console.log('\n=== ' + name + ' ===');
  console.log('  候选池 ' + rec.pool.length + ' → 预算内 ' + rec.inBudget.length +
              ' → 通过过滤 ' + rec.passed.length + '（被过滤 ' + rec.filtered.length + '）');
  if (rec.filtered.length) {
    console.log('  过滤示例: ' + rec.filtered.slice(0, 3).map(f => f.dish.name + '(' + f.why + ')').join(' | '));
  }
  if (!top.length) { console.log('  ⚠️ 无候选'); return; }
  top.forEach((s, i) => {
    const rest = recommendRestaurants(s.dish);
    const best = rest.list[0];
    console.log('  ' + (i + 1) + '. ' + s.dish.name + ' ¥' + s.dish.price + ' [' + s.total + '分] → ' +
      (best ? best.restaurant.name + ' / ' + best.km + 'km / ' + best.eta + 'min / 店分' + best.total : '❌ 没有店能做'));
    if (i === 0) {
      console.log('     理由: ' + s.reasons.slice(0, 4).join('；'));
      console.log('     分项: ' + Object.entries(s.parts).map(([k, v]) => k + '=' + v.raw).join(', '));
      console.log('     店理由: ' + (best ? best.reasons.slice(0, 3).join('；') : '-') + (rest.note ? ' [note:' + rest.note + ']' : ''));
    }
  });
}

scenario('中饭 · 吃饭 · 想吃辣 · 五角场 · 外卖', { tier: 'mid', cat: 'rice', craveTags: ['想吃辣'], address: '五角场万达' });
scenario('小饭 · 吃面 · 清淡 · 张江 · 外卖', { tier: 'small', cat: 'noodle', craveTags: ['清淡点'], address: '张江高科' });
scenario('吃好饭 · 其他 · 生鲜 · 陆家嘴 · 堂食', { tier: 'good', cat: 'other', craveTags: ['生鲜/刺身', '一个人随便吃'], address: '陆家嘴', mode: 'dinein' });
scenario('吃好饭 · 吃面 · 海鲜忌口 · 静安寺', { tier: 'good', cat: 'noodle', address: '静安寺', allergies: ['海鲜/虾蟹'] });
scenario('小饭 · 吃饭 · 完全不吃辣 + 海鲜忌口', { tier: 'small', cat: 'rice', spiceMax: 0, allergies: ['海鲜/虾蟹'] });
scenario('中饭 · 其他 · 夜宵烧烤 · 七宝', { tier: 'mid', cat: 'other', craveTags: ['想吃烧烤'], address: '七宝老街' });
scenario('中饭 · 吃饭 · 历史吃过黄焖鸡(2天前)', {
  tier: 'mid', cat: 'rice', address: '张江',
  history: [{ id: 'd01', ts: Date.now() - 2 * 24 * 3600 * 1000, price: 22 }]
});
scenario('换一批：seed=2 对比', { tier: 'mid', cat: 'rice', address: '张江', seed: 2 });
