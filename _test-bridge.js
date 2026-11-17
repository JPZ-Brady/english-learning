/*
 * _test-bridge.js —— 验证「课堂笔记 → 学习台」接入是否正确（离线，不开浏览器）
 * 1) 抽出 学习台.html 的内联脚本做语法检查
 * 2) 用 node 模拟加载全部分片（含 notes-cards.js），复现 allEntries() 去重逻辑
 * 3) 校验新卡字段完整性
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync('学习台.html', 'utf8');
let bad = 0;

// --- 1) 内联脚本语法检查 ---
const scripts = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);
console.log('=== 1) 内联脚本语法 ===');
scripts.forEach((s, i) => {
  try { new vm.Script(s); console.log('  [√] #' + (i + 1) + ' 通过（' + s.length + ' 字符）'); }
  catch (e) { bad++; console.log('  [X] #' + (i + 1) + ' 语法错误：' + e.message); }
});

// --- 2) 加载分片并复现 allEntries ---
console.log('\n=== 2) 词库加载与去重 ===');
const sandbox = { window: {}, console: console };
vm.createContext(sandbox);
const files = fs.readdirSync('deck-parts').filter((f) => f.endsWith('.js')).sort()
  .map((f) => path.join('deck-parts', f));
const hasNotes = fs.existsSync('notes-cards.js');  // generated from private lecture notes, not in the public repo
if (hasNotes) files.push('notes-cards.js');
else console.log('  （没有 notes-cards.js：跳过课堂笔记分片检查）');
files.forEach((f) => {
  if (!fs.existsSync(f)) { bad++; console.log('  [X] 缺少文件：' + f); return; }
  try { vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f }); }
  catch (e) { bad++; console.log('  [X] ' + f + ' 执行失败：' + e.message); }
});
const parts = sandbox.window.DECK_PARTS || {};
const keys = Object.keys(parts).sort();
const newKeys = keys.filter((k) => k.indexOf('9') === 0 && /lecture/.test(k));
console.log('  分片总数：' + keys.length + '，其中课堂笔记分片：' + newKeys.join('、'));
if (hasNotes && !newKeys.length) { bad++; console.log('  [X] 没找到课堂笔记分片（notes-cards.js 没生效）'); }

function exCount(d) { return Array.isArray(d.ex) ? d.ex.length : (d.ex ? 1 : 0); }
/* 去重规则只有一个定义：直接把 学习台.html 里标记之间的那一段跑起来，不再写复制品
   （以前是三份复制品，改一处忘两处就会“数字看着对、其实错”）。 */
const REGION = /\/\* ===== 词库去重规则（唯一定义）开始 ===== \*\/([\s\S]*?)\/\* ===== 词库去重规则（唯一定义）结束 ===== \*\//;
const region = html.match(REGION);
if (!region) { bad++; console.log('  [X] 学习台.html 里找不到「词库去重规则」区块标记'); }
else vm.runInContext(region[1], sandbox, { filename: '学习台.html#去重规则' });

const all = typeof sandbox.allEntries === 'function' ? sandbox.allEntries() : [];
const fromNotes = all.filter((d) => String(d.c).indexOf('课堂笔记') === 0);
console.log('  去重后卡池：' + all.length + ' 张（原 v3 词库 + 新增；规则取自 学习台.html 本体）');
console.log('  来自课堂笔记：' + fromNotes.length + ' 张');
console.log('  新增分类：' + Array.from(new Set(fromNotes.map((d) => d.c))).join(' ｜ '));

// --- 3) 字段校验 + 样例 ---
console.log('\n=== 3) 卡片字段校验 ===');
const qaCards = fromNotes.filter((d) => d.t === 'qa');
const wordCards = fromNotes.filter((d) => d.t !== 'qa');
let miss = 0;
fromNotes.forEach((d) => { if (!d.en || !d.zh) miss++; });
qaCards.forEach((d) => { if (!d.q || !d.a) miss++; });
console.log('  术语卡 ' + wordCards.length + ' 张，问答卡 ' + qaCards.length + ' 张');
console.log('  带课堂原句例句的术语卡：' + wordCards.filter((d) => d.ex && d.ex.length).length + ' 张');
console.log(miss ? '  [X] 有 ' + miss + ' 张卡缺必填字段' : '  [√] 全部卡片字段完整（en/zh；问答卡另有 q/a）');
if (miss) bad++;
const w = wordCards[0], q = qaCards[0];
if (w) console.log('  样例术语卡：' + w.en + ' → ' + String(w.zh).slice(0, 40) + (w.ex ? ' ｜ 例句：' + w.ex[0].e.slice(0, 60) : ''));
if (q) console.log('  样例问答卡：' + q.q.slice(0, 46) + ' → ' + q.a.slice(0, 46));

// --- 4) 不变量：课堂笔记卡不会被基础词库顶掉（2026-09-29 实测：16 张课内术语输给了同名基础卡）---
console.log('\n=== 4) 不变量：课堂笔记卡优先 ===');
const noteKeys = new Set(), baseKeys = new Set();
keys.forEach((k) => (parts[k] || []).forEach((d) => {
  if (!d || !d.en) return;
  (/^9\d-/.test(k) ? noteKeys : baseKeys).add(String(d.en).trim());
}));
const byEn = new Map(all.map((d) => [String(d.en).trim(), d]));
const clash = Array.from(noteKeys).filter((x) => baseKeys.has(x));
const lost = clash.filter((x) => String((byEn.get(x) || {}).c || '').indexOf('课堂笔记') !== 0);
const thin = clash.filter((x) => exCount(byEn.get(x) || {}) < 2);
console.log('  与基础词库同名的课堂卡：' + clash.length + ' 张｜被顶掉的：' + lost.length + ' 张｜例句仍 <2 的：' + thin.length + ' 张');
console.log(lost.length ? '  [X] 被顶掉：' + lost.slice(0, 8).join('、')
  : '  [√] 课内含义全部保留（不会被通用释义取代，且并进了基础卡例句）');
if (lost.length) bad++;
if (thin.length) { bad++; console.log('  [X] 例句不足：' + thin.slice(0, 8).join('、')); }

console.log('\n' + (bad ? '结论：有 ' + bad + ' 项未通过' : '结论：接入检查全部通过'));
process.exit(bad ? 1 : 0);
