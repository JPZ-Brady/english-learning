const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;
const HTML = path.join(DIR, '学习台.html');

/* ---- 1. 内联脚本语法 ---- */
const h = fs.readFileSync(HTML, 'utf8');
const blocks = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];
try { new Function(blocks[blocks.length - 1][1]); console.log('主程序语法: OK'); }
catch (e) { console.log('主程序语法 FAIL: ' + e.message); process.exit(1); }

/* ---- 2. 按页面实际顺序加载所有 src（这才是「学习台真的会加载什么」）---- */
const srcs = [...h.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const missing = srcs.filter(s => !fs.existsSync(path.join(DIR, s)));
if (missing.length) console.log('引用的文件缺失: ' + missing.join('、'));

const ctx = { window: {} };
vm.createContext(ctx);
const loadErr = [];
srcs.forEach(s => {
  const f = path.join(DIR, s);
  if (!fs.existsSync(f)) return;
  try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: s }); }
  catch (e) { loadErr.push(s + ' -> ' + e.message); }
});
if (loadErr.length) loadErr.forEach(x => console.log('  加载失败: ' + x));

const parts = ctx.window.DECK_PARTS || {};

/* ---- 3. 去重：直接用 学习台.html 里标记之间的那一段（唯一定义，不再复制规则）---- */
const REGION = /\/\* ===== 词库去重规则（唯一定义）开始 ===== \*\/([\s\S]*?)\/\* ===== 词库去重规则（唯一定义）结束 ===== \*\//;
const region = h.match(REGION);
if (!region) { console.log('去重规则: FAIL（学习台.html 里找不到「词库去重规则」区块标记）'); process.exit(1); }
vm.runInContext(region[1], ctx, { filename: '学习台.html#去重规则' });
const uniq = ctx.allEntries();
const exCount = ctx.exCount;

/* ---- 4. 统计（单词卡 / 问答卡分开算）---- */
const words = uniq.filter(d => d.t !== 'qa');
const qas = uniq.filter(d => d.t === 'qa');
const dist = {}, cats = {};
let badWord = 0, badQa = 0, noEx = 0;
words.forEach(d => {
  const n = exCount(d); dist[n] = (dist[n] || 0) + 1;
  if (!d.c || !d.en || !d.zh) badWord++;
  if (!d.ex || !exCount(d)) noEx++;
});
qas.forEach(d => { cats[d.c] = (cats[d.c] || 0) + 1; if (!d.q || !d.a) badQa++; });
words.forEach(d => { cats[d.c] = (cats[d.c] || 0) + 1; });

console.log('\n================ 学习台实际卡池 ================');
console.log('引用文件    : ' + srcs.length + ' 个' + (missing.length ? '（缺 ' + missing.length + '）' : '') + '，全部加载成功');
console.log('DECK_PARTS  : ' + Object.keys(parts).length + ' 个分片');
console.log('原始条目    : ' + Object.values(parts).reduce((a, b) => a + b.length, 0));
console.log('去重后      : ' + uniq.length + ' 张   （单词卡 ' + words.length + ' + 问答卡 ' + qas.length + '）');
console.log('单词卡例句  : ' + Object.keys(dist).sort().map(n => n + '句=' + dist[n]).join('   '));
console.log('分类数      : ' + Object.keys(cats).length);
console.log('字段问题    : 单词卡 ' + badWord + '   问答卡 ' + badQa);
console.log('================================================');

const noteParts = Object.keys(parts).filter(k => /^9\d-/.test(k));
if (noteParts.length) {
  console.log('\n课堂笔记分片（由 notes-cards.js 生成）:');
  noteParts.forEach(k => console.log('  ' + k + ' : ' + (parts[k] || []).length + ' 张'));
  console.log('  合计去重后 ' + uniq.filter(d => String(d.c).indexOf('课堂笔记') === 0).length + ' 张');
}

console.log('\n分类明细（按张数排序）:');
Object.keys(cats).sort((a, b) => cats[b] - cats[a]).forEach(c => console.log('  ' + String(cats[c]).padStart(4) + '  ' + c));
