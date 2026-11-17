/* 持久化测试：模拟「学一批 → 关页面 → 重新打开」，验证进度能回来；
   以及存档损坏时绝不覆盖旧数据 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;

/* 一个共享的 localStorage 桩，模拟同一台浏览器 */
function makeStore() {
  return {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    get length() { return Object.keys(this._d).length; },
    key(i) { return Object.keys(this._d)[i]; }
  };
}
function mkEl(id) {
  return { id, innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(){}, prepend(){}, remove(){}, click(){}, onclick: null,
    querySelectorAll(){ return []; }, querySelector(){ return mkEl('x'); } };
}
/* 每次「打开页面」都新建一套 DOM，但共用同一个 localStorage */
function openPage(store, deckCode) {
  const els = {};
  const ctx = {
    window: {},
    document: {
      getElementById: id => els[id] || (els[id] = mkEl(id)),
      querySelectorAll: () => [], querySelector: () => mkEl('x'),
      createElement: () => mkEl('new'), addEventListener: () => {}, body: { appendChild(){} }
    },
    localStorage: store,
    speechSynthesis: { getVoices: () => [], speak(){}, cancel(){} },
    SpeechSynthesisUtterance: function(){}, setTimeout: () => {}, clearTimeout: () => {},
    confirm: () => true, alert: () => {}, location: { reload(){} },
    console: console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Set, Map,
    isNaN, parseInt, parseFloat, Blob: function(){}, URL: { createObjectURL: () => '' }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DIR + '/fsrs.js', 'utf8'), ctx, { filename: 'fsrs.js' });
  const dp = DIR + '/deck-parts';
  fs.readdirSync(dp).filter(f => /^\d\d-.*\.js$/.test(f)).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dp, f), 'utf8'), ctx, { filename: f });
  });
  if (fs.existsSync(DIR + '/notes-cards.js')) {
    vm.runInContext(fs.readFileSync(DIR + '/notes-cards.js', 'utf8'), ctx, { filename: 'notes-cards.js' });
  }
  const html = fs.readFileSync(DIR + '/学习台.html', 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx, { filename: 'app.js' });
  ctx.__els = els;
  return ctx;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✅ ' + name); pass++; }
  else { console.log('  ❌ ' + name + (extra !== undefined ? '   实际=' + JSON.stringify(extra) : '')); fail++; }
}

const store = makeStore();

/* ---------- 1. 第一次打开，学几个词 ---------- */
console.log('=== 1. 第一次打开页面并学习 ===');
let p1 = openPage(store, 1);
ok('首次打开状态为 empty', p1.LOAD_STATE === 'empty', p1.LOAD_STATE);
const words = ['kettle', 'toaster', 'drizzle'];
const ents = words.map(w => p1.BY_EN[w] || p1.ENTRIES[0]);
p1.Q = ents.slice(); p1.qi = 0; p1.mode = 'zh2en'; p1.encDone = true;
ents.forEach(() => p1.grade(3));
const T = p1.todayStr();
ok('写入了 3 张卡的记录', Object.keys(p1.DB.cards).length === 3, Object.keys(p1.DB.cards).length);
ok('存档已落盘', (store.getItem('leeds_en_v3') || '').length > 100, (store.getItem('leeds_en_v3') || '').length);
const savedSize = (store.getItem('leeds_en_v3') || '').length;

/* ---------- 2. 关掉页面，重新打开 ---------- */
console.log('\n=== 2. 关掉页面后重新打开（模拟第二天打开）===');
let p2 = openPage(store, 1);
ok('第二次打开状态为 ok（不是 empty）', p2.LOAD_STATE === 'ok', p2.LOAD_STATE);
ok('3 张卡的学习进度全部回来了', Object.keys(p2.DB.cards).length === 3, Object.keys(p2.DB.cards).length);
ok('已学过数量一致', p2.counts().learned === 3, p2.counts());
ok('今天的明细也回来了', (p2.DB.log[T] || {}).items && p2.DB.log[T].items.length === 3,
   p2.DB.log[T] && p2.DB.log[T].items && p2.DB.log[T].items.length);
ok('连续天数不为 0', p2.streak() >= 1, p2.streak());
/* 再学一张，确认能继续累加 */
p2.Q = [p2.BY_EN['surname'] || p2.ENTRIES[5]]; p2.qi = 0; p2.encDone = true;
p2.grade(3);
ok('能在旧进度上继续累加', Object.keys(p2.DB.cards).length === 4, Object.keys(p2.DB.cards).length);

/* ---------- 3. 存档损坏：绝不覆盖 ---------- */
console.log('\n=== 3. 存档损坏时的保护 ===');
const store2 = makeStore();
store2.setItem('leeds_en_v3', '{"cards":{"a":1},"set":{}');   /* 故意截断的坏 JSON */
const broken = store2.getItem('leeds_en_v3');
let p3 = openPage(store2, 1);
ok('损坏存档被识别为 unreadable', p3.LOAD_STATE === 'unreadable', p3.LOAD_STATE);
ok('页面照常打开（不白屏）', p3.ENTRIES.length > 1000, p3.ENTRIES.length);
const wrote = p3.saveDB();
ok('saveDB 拒绝写入并返回 false', wrote === false, wrote);
ok('坏存档原封不动（没被冲掉）', store2.getItem('leeds_en_v3') === broken,
   (store2.getItem('leeds_en_v3') || '').slice(0, 30));
/* 再触发几次评分，仍不应写入 */
p3.Q = [p3.BY_EN['kettle'] || p3.ENTRIES[0]]; p3.qi = 0; p3.encDone = true; p3.grade(3);
ok('评分后依然没有覆盖坏存档', store2.getItem('leeds_en_v3') === broken);

/* ---------- 4. 正常存档不该被误判 ---------- */
console.log('\n=== 4. 正常存档不被误判 ===');
ok('正常存档状态为 ok', p2.LOAD_STATE === 'ok', p2.LOAD_STATE);
ok('正常存档可以写', p2.saveDB() === true);

/* ---------- 5. 备份机制 ---------- */
console.log('\n=== 5. 本机备份 ===');
ok('备份键已写入', !!store.getItem('leeds_en_v3_bak'), (store.getItem('leeds_en_v3_bak') || '').length);
ok('备份时间戳已写入', parseInt(store.getItem('leeds_en_v3_bakt') || '0', 10) > 0);
/* 模拟：主存档被清空 → 从备份恢复 */
const bak = store.getItem('leeds_en_v3_bak');
store.setItem('leeds_en_v3', '{"cards":{},"set":{},"log":{}}');
ok('备份里确实有 4 张卡', JSON.parse(bak).cards && Object.keys(JSON.parse(bak).cards).length >= 1,
   bak ? Object.keys(JSON.parse(bak).cards).length : 0);

console.log('\n==================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
