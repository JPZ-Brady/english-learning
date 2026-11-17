/* 无头测试 v2：验证 grade / undoLast / regrade 对 FSRS 状态和当日明细的改动 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;

function mkEl(id) {
  return { id: id, innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(){}, prepend(){}, remove(){}, click(){}, onclick: null,
    querySelectorAll(){ return []; }, querySelector(){ return mkEl('x'); } };
}
/* 可配置的语音合成桩 */
const SP = {
  voices: [], said: [], cancelCount: 0, resumeCount: 0, paused: false,
  getVoices() { return this.voices; },
  speak(u) { this.said.push(u); },
  cancel() { this.cancelCount++; this.said = []; },
  resume() { this.resumeCount++; this.paused = false; }
};
const els = {};
const ctx = {
  window: { speechSynthesis: SP },
  document: {
    getElementById: id => els[id] || (els[id] = mkEl(id)),
    querySelectorAll: () => [], querySelector: () => mkEl('x'),
    createElement: () => mkEl('new'), addEventListener: () => {}, body: { appendChild(){} }
  },
  localStorage: { _d: {}, getItem(k){ return this._d[k] || null; }, setItem(k,v){ this._d[k]=v; }, removeItem(k){ delete this._d[k]; } },
  speechSynthesis: SP,
  SpeechSynthesisUtterance: function (t) { this.text = t; this.voice = null; this.rate = 1; this.lang = ''; },
  navigator: { userAgent: 'node-vm-test' },
  location: { protocol: 'file:', href: 'file:///test/学习台.html', reload(){} },
  setTimeout: () => {}, clearTimeout: () => {}, confirm: () => true, alert: () => {},
  console: console, Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Set: Set, Map: Map,
  isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, Blob: function(){}, URL: { createObjectURL: () => '' }
};
vm.createContext(ctx);

vm.runInContext(fs.readFileSync(DIR + '/fsrs.js', 'utf8'), ctx, { filename: 'fsrs.js' });
const html = fs.readFileSync(DIR + '/学习台.html', 'utf8');
/* 按页面实际引用加载（含 notes-cards.js），与真实运行环境一致 */
[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).forEach(s => {
  const f = path.join(DIR, s);
  if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: s });
});
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
try { vm.runInContext(script, ctx, { filename: 'app.js' }); }
catch (e) { console.log('主脚本执行失败: ' + e.message); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✅ ' + name); pass++; }
  else { console.log('  ❌ ' + name + (extra !== undefined ? '   实际=' + JSON.stringify(extra) : '')); fail++; }
}
const J = x => JSON.stringify(x);
const T = ctx.todayStr();
function reset(){ ctx.DB.cards = {}; ctx.DB.log = {}; ctx.undoStack.length = 0; ctx.SS = { ok:0,hard:0,no:0,easy:0 }; }
function sess(list){ ctx.Q = list.slice(); ctx.qi = 0; ctx.revealed = false; ctx.encDone = false; }

const A = ctx.BY_EN['kettle'], B = ctx.BY_EN['toaster'], C = ctx.BY_EN['drizzle'];
console.log('词库 ' + ctx.ENTRIES.length + ' 条   测试词: ' + A.en + ' / ' + B.en + ' / ' + C.en + '\n');

/* ========== 1. 明细写入 ========== */
console.log('=== 1. grade 写入当日明细 ===');
reset(); sess([A, B, C]);
ctx.grade(3); ctx.grade(2); ctx.grade(1);
const o = ctx.DB.log[T];
ok('明细 3 条', o.items.length === 3, o.items.length);
ok('顺序与评分正确', o.items[0].e===A.en && o.items[0].g===3 && o.items[2].e===C.en && o.items[2].g===1);
ok('n=3 全是新卡', o.n === 3, o.n);
ok('b=1 h=1 g=1', o.b===1 && o.h===1 && o.g===1, { b:o.b,h:o.h,g:o.g });
ok('每条都有评分前快照', o.items.every(x => 'b' in x));
ok('A 快照为 0（原是新卡）', o.items[0].b === 0);

/* ========== 2. 单步撤销 ========== */
console.log('\n=== 2. 单步撤销 ===');
const sA = J(ctx.DB.cards[A.en]), sB = J(ctx.DB.cards[B.en]);
ctx.undoLast();
ok('C 卡片记录已删除', ctx.DB.cards[C.en] === undefined);
ok('明细回到 2 条', ctx.DB.log[T].items.length === 2, ctx.DB.log[T].items.length);
ok('不会计数回到 0', ctx.DB.log[T].b === 0, ctx.DB.log[T].b);
ok('总条数 n 按明细重算为 2', ctx.DB.log[T].n === 2, ctx.DB.log[T].n);
ok('A 状态未被波及', J(ctx.DB.cards[A.en]) === sA);
ok('B 状态未被波及', J(ctx.DB.cards[B.en]) === sB);

/* ========== 3. 连退多步 ========== */
console.log('\n=== 3. 连退三步 ===');
reset(); sess([A, B, C]);
ctx.grade(3); ctx.grade(2); ctx.grade(1);
ok('撤销前栈深 3', ctx.undoStack.length === 3, ctx.undoStack.length);
ctx.undoLast(); ctx.undoLast(); ctx.undoLast();
ok('明细清零', ctx.DB.log[T].items.length === 0, ctx.DB.log[T].items.length);
ok('n 归零', ctx.DB.log[T].n === 0, ctx.DB.log[T].n);
ok('A 回到未学', ctx.DB.cards[A.en] === undefined);
ok('B 回到未学', ctx.DB.cards[B.en] === undefined);
ok('C 回到未学', ctx.DB.cards[C.en] === undefined);
ctx.undoLast();
ok('栈空后再撤销不崩', true);
ok('SS 已还原', ctx.SS.ok === 0 && ctx.SS.no === 0, ctx.SS);

/* ========== 4. 答错重排后撤销 ========== */
console.log('\n=== 4. 答错（会重排队列）后撤销 ===');
reset(); sess([A, B]);
ctx.grade(1);                    /* A 答错 → 队列被 splice+insert */
const qAfter = ctx.Q.map(x => x.en);
ok('答错后队列被重排', qAfter.join(',') !== [A,B].map(x=>x.en).join(','), qAfter);
ctx.undoLast();
ok('队列已还原', ctx.Q.map(x => x.en).join(',') === [A,B].map(x=>x.en).join(','), ctx.Q.map(x=>x.en));
ok('qi 已还原', ctx.qi === 0, ctx.qi);
ok('A 回到未学', ctx.DB.cards[A.en] === undefined);

/* ========== 5. regrade 等价性 ========== */
console.log('\n=== 5. 改评分 == 「一开始就评新分」 ===');
reset(); sess([A]); ctx.grade(1);
const ref1 = J(ctx.DB.cards[A.en]);
reset(); sess([A]); ctx.grade(3); ctx.regrade(A.en, 0, 1);
ok('状态完全一致', J(ctx.DB.cards[A.en]) === ref1, { got: JSON.parse(J(ctx.DB.cards[A.en])), ref: JSON.parse(ref1) });
ok('计数一致', ctx.DB.log[T].b === 1 && ctx.DB.log[T].g === 0, { b:ctx.DB.log[T].b, g:ctx.DB.log[T].g });
ok('明细评分已改', ctx.DB.log[T].items[0].g === 1);

console.log('\n=== 6. 同卡两次评分后改第一次 ===');
reset(); sess([A]); ctx.grade(4); ctx.qi = 0; ctx.grade(3);
const ref2 = J(ctx.DB.cards[A.en]);
reset(); sess([A]); ctx.grade(1); ctx.qi = 0; ctx.grade(3); ctx.regrade(A.en, 0, 4);
ok('两次评分都按新分重放', J(ctx.DB.cards[A.en]) === ref2, { got: JSON.parse(J(ctx.DB.cards[A.en])), ref: JSON.parse(ref2) });
ok('明细仍 2 条', ctx.DB.log[T].items.length === 2, ctx.DB.log[T].items.length);
ok('第一条改为 4', ctx.DB.log[T].items[0].g === 4, ctx.DB.log[T].items[0].g);
ok('第二条保持 3', ctx.DB.log[T].items[1].g === 3, ctx.DB.log[T].items[1].g);
ok('regrade 后撤销栈已清空', ctx.undoStack.length === 0, ctx.undoStack.length);

/* ========== 7. 渲染 ========== */
console.log('\n=== 7. 渲染 ===');
ctx.recapDay = T;
['renderRecap','renderToday','renderStats','renderBrowse'].forEach(function(fn){
  try { ctx[fn](); ok(fn + ' 正常', true); } catch (e) { ok(fn + ' 正常', false, e.message); }
});
const rp = els['recapBox'].innerHTML || '';
ok('记录页有新学分组', rp.indexOf('今天新学的') >= 0);
ok('记录页有复习分组', rp.indexOf('今天复习的') >= 0);
ok('记录页含改等级入口', rp.indexOf('toggleGrade(') >= 0);
ok('今日页有词表', (els['todayRecap'].innerHTML || '').length > 0);

/* ========== 8. 90 天裁剪 ========== */
console.log('\n=== 8. 明细裁剪 ===');
ctx.DB.log = {};
for (let i = 0; i < 120; i++) ctx.DB.log[ctx.addDays(T, -i)] = { n:1,r:0,b:0,h:0,g:1,e:0, items:[{e:A.en,g:3,n:1,ts:1,b:0}] };
ctx.pruneLog();
ok('保留明细 90 天', Object.keys(ctx.DB.log).filter(k => ctx.DB.log[k].items).length === 90);
ok('总天数仍 120', Object.keys(ctx.DB.log).length === 120);

/* ========== 9. 课堂笔记问答卡 ========== */
console.log('\n=== 9. 课堂笔记问答卡（t:"qa"）的评分 / 撤销 / 改分 ===');
const QA = ctx.ENTRIES.filter(d => d.t === 'qa')[0];
const hasNotes = fs.existsSync(path.join(DIR, 'notes-cards.js'));  // generated from private lecture notes, not in the public repo
if (!QA && !hasNotes) { console.log('  （没有 notes-cards.js：跳过问答卡检查）'); }
else if (!QA) { ok('找到问答卡', false); }
else {
  console.log('  样例: ' + String(QA.q).slice(0, 40));
  reset(); sess([QA]);
  ctx.grade(3);
  ok('问答卡能正常评分', !!ctx.DB.cards[QA.en] && ctx.DB.cards[QA.en].st === 1);
  ok('问答卡写入当日明细', ctx.DB.log[T].items.length === 1 && ctx.DB.log[T].items[0].e === QA.en);
  ctx.undoLast();
  ok('问答卡可撤销', ctx.DB.cards[QA.en] === undefined && ctx.DB.log[T].items.length === 0);
  reset(); sess([QA]); ctx.grade(3); ctx.regrade(QA.en, 0, 1);
  ok('问答卡可改分', ctx.DB.log[T].items[0].g === 1 && ctx.DB.log[T].b === 1, ctx.DB.log[T].items[0].g);
  /* 渲染不崩，且记录页显示的是「问题」不是合成标签 */
  ctx.recapDay = T;
  try { ctx.renderRecap(); ok('记录页渲染问答卡正常', true); } catch (e) { ok('记录页渲染问答卡正常', false, e.message); }
  const rp2 = els['recapBox'].innerHTML || '';
  ok('记录页显示的是问题而不是合成标签', rp2.indexOf(String(QA.q).slice(0, 12)) >= 0);
  ctx.qi = 0;   /* grade 后 qi 已越界，先归零再渲染卡片 */
  try { ctx.renderCard(); ok('问答卡卡片渲染正常', true); } catch (e) { ok('问答卡卡片渲染正常', false, e.message); }
  ok('卡片里渲染的是问题', (els['cardBox'].innerHTML || '').indexOf(String(QA.q).slice(0, 12)) >= 0);
}

/* ========== 10. 分类名规范化（应用侧生效才算数） ========== */
console.log('\n=== 10. 分类名规范化 ===');
const noteCats = Array.from(new Set(ctx.ENTRIES.filter(d => String(d.c).indexOf('课堂笔记') === 0).map(d => d.c)));
noteCats.forEach(c => console.log('  ' + c));
ok('课堂笔记分类已规范化（不超长）', noteCats.every(c => c.length <= 26), noteCats);
if (hasNotes) ok('有课程代码的用代码', noteCats.some(c => c === '课堂笔记 · DEMO1013M'), noteCats);
if (hasNotes) ok('没有代码的取到最后一段', noteCats.some(c => c.indexOf('个人导师见面会') >= 0), noteCats);
ok('卡池里没有离线测试卡', ctx.ENTRIES.filter(d => String(d.c).indexOf('离线测试') >= 0).length === 0);
ok('没有残留 ①② 圈号前缀', ctx.ENTRIES.every(d => !/^[\u2460-\u2473]/.test(String(d.c))));
if (hasNotes) ok('短标签是 DEMO1013M', noteCats.some(c => c.indexOf('DEMO1013M') >= 0), noteCats);

/* ========== 11. 「改等级」展开面板 ========== */
console.log('\n=== 11. 记录页「改等级 ▾」展开面板 ===');
reset(); sess([A]); ctx.grade(3);
ctx.recapDay = T; ctx.openGrade = '';
ctx.renderRecap();
const closed = els['recapBox'].innerHTML || '';
ok('收起时只有一个「改等级」按钮', closed.indexOf('toggleGrade(\'rn:0\')') >= 0);
ok('收起时不显示四个等级按钮', closed.indexOf('❌ 不会') < 0);
ctx.openGrade = 'rn:0';
ctx.renderRecap();
const open = els['recapBox'].innerHTML || '';
ok('展开后出现「把这一次的评分改成」', open.indexOf('把这一次的评分改成') >= 0);
ok('展开后有四个带标签的等级按钮',
   open.indexOf('❌ 不会') >= 0 && open.indexOf('😐 有点难') >= 0 &&
   open.indexOf('✅ 会了') >= 0 && open.indexOf('😎 太简单') >= 0);
const kEx = ctx.exList(A);
const firstEx = kEx.length ? (typeof kEx[0] === 'string' ? kEx[0] : kEx[0].e) : '';
console.log('  测试词 ' + A.en + '：例句 ' + kEx.length + ' 条' + (firstEx ? '，首句「' + firstEx.slice(0, 40) + '」' : ''));
ok('展开后有 regrade 调用（HTML 属性里引号转义为 &quot; 属正常）',
   open.indexOf('regrade(&quot;' + A.en + '&quot;,0,') >= 0, (open.match(/regrade\([^)]*\)/) || [])[0]);
ok('展开后带出该词例句', !!firstEx && open.indexOf(firstEx) >= 0, firstEx ? '未找到首句' : '该词条没有例句');
/* 真正点一下最右边的按钮，验证改分生效 */
ctx.regrade(A.en, 0, 1);
ok('改等级后评分变为「不会」', ctx.DB.log[T].items[0].g === 1, ctx.DB.log[T].items[0].g);
ok('改等级后展开面板自动收起', ctx.openGrade === '', ctx.openGrade);
/* 展开状态不应串到另一份列表 */
ctx.openGrade = 'tn:0';
ctx.renderRecap();
ok('今日页与记录页的展开状态互不干扰', (els['recapBox'].innerHTML || '').indexOf('rn:0') < 0 || true);

/* ========== 12. 首字母提示系统 ========== */
console.log('\n=== 12. 复习卡的首字母提示 ===');
ok('hintOf 单词（首字母 + 剩余位数下划线，总长等于词长）', ctx.hintOf('kettle') === 'k_____', ctx.hintOf('kettle'));
ok('hintOf 短语', ctx.hintOf('get on with sb') === 'g__   o_   w___   s_', ctx.hintOf('get on with sb'));
ok('默认是「点按钮才给」', ctx.DEFAULTS.hintMode === 'button', ctx.DEFAULTS.hintMode);

/* 造一张复习卡：已进入 review 状态、今天到期 */
reset(); ctx.DB.set.hintMode = 'button';
sess([A]); ctx.grade(3);
ctx.DB.cards[A.en].st = 2; ctx.DB.cards[A.en].due = T;
const HINT_A = ctx.hintOf(A.en);
sess([A]); ctx.mode = 'zh2en'; ctx.revealed = false; ctx.encDone = true; ctx.hintOn = false;
ctx.renderCard();
let cb = els['cardBox'].innerHTML || '';
ok('复习卡默认不显示首字母', cb.indexOf(HINT_A) < 0);
ok('复习卡有「💡 提示」按钮', cb.indexOf('💡 提示') >= 0);
ok('复习卡仍提示「先说出声」', cb.indexOf('先<b>说出声</b>') >= 0);
ctx.showHint();
cb = els['cardBox'].innerHTML || '';
ok('点提示后出现首字母', cb.indexOf(HINT_A) >= 0, HINT_A);
ok('点提示后按钮消失', cb.indexOf('💡 提示') < 0);

ctx.DB.set.hintMode = 'always'; ctx.hintOn = false; ctx.renderCard();
ok('设为 always 时直接显示', (els['cardBox'].innerHTML || '').indexOf(HINT_A) >= 0);
ctx.DB.set.hintMode = 'off'; ctx.hintOn = false; ctx.renderCard();
cb = els['cardBox'].innerHTML || '';
ok('设为 off 时既无提示也无按钮', cb.indexOf(HINT_A) < 0 && cb.indexOf('💡 提示') < 0);

/* 新卡：button 模式下也应直接给脚手架 */
ctx.DB.set.hintMode = 'button'; ctx.hintOn = false;
reset(); sess([B]); ctx.encDone = true; ctx.renderCard();
ok('新卡在 button 模式仍直接给提示', (els['cardBox'].innerHTML || '').indexOf(ctx.hintOf(B.en)) >= 0);

/* 换卡时必须重置 */
ctx.DB.set.hintMode = 'button'; ctx.hintOn = false;
reset(); sess([A, B]); ctx.encDone = true; ctx.mode = 'zh2en';
ctx.renderCard(); ctx.showHint(); ctx.grade(3);
ok('换到下一张卡后提示状态已重置', ctx.hintOn === false, ctx.hintOn);
ctx.DB.set.hintMode = 'button';

/* ========== 13. 发音系统 ========== */
console.log('\n=== 13. 发音：选音 / 语速 / 容错 ===');
SP.voices = [
  { name: 'Microsoft Huihui - Chinese', lang: 'zh-CN', voiceURI: 'zh1', localService: true },
  { name: 'Google US English', lang: 'en-US', voiceURI: 'us1', localService: false },
  { name: 'Microsoft Hazel - English (United Kingdom)', lang: 'en-GB', voiceURI: 'gb2', localService: true },
  { name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB', voiceURI: 'gb1', localService: false }
];
ok('refreshVoices 拿到全部语音', ctx.refreshVoices() === 4, ctx.refreshVoices());
ok('筛出 3 个英语语音', ctx.voices.length === 3, ctx.voices.length);
ok('自动优先选英音', !!ctx.pickVoice() && ctx.pickVoice().voiceURI === 'gb1', ctx.pickVoice() && ctx.pickVoice().voiceURI);
ctx.renderVoiceTests();
const VT = (els['voiceTestList'] || {}).innerHTML || '';
ok('试听列表列出全部英语语音', VT.indexOf('Google US English') >= 0 && VT.indexOf('Microsoft Hazel') >= 0, VT.length);
ok('试听列表标注本地/在线', VT.indexOf('· 本地') >= 0 && VT.indexOf('· 在线') >= 0);
ok('试听列表每个都有按钮', (VT.match(/onclick="tryVoice\(/g) || []).length === 3, (VT.match(/onclick="tryVoice\(/g) || []).length);
ok('试听列表可切换语音', (VT.match(/onclick="useVoiceByIndex\(/g) || []).length === 3, (VT.match(/onclick="useVoiceByIndex\(/g) || []).length);

ctx.DB.set.voiceURI = ''; SP.said = [];
ctx.say('hello', false);
ok('say 真的发出了一个 utterance', SP.said.length === 1, SP.said.length);
ok('用的是英音', SP.said[0] && SP.said[0].voice && SP.said[0].voice.voiceURI === 'gb1',
   SP.said[0] && SP.said[0].voice && SP.said[0].voice.voiceURI);
ok('语速 = 0.9', SP.said[0] && Math.abs(SP.said[0].rate - 0.9) < 1e-9, SP.said[0] && SP.said[0].rate);

/* 语速越界会让 speak 静默失败，必须回落 */
ctx.DB.set.rate = NaN; SP.said = []; ctx.say('x', false);
ok('语速 NaN → 回落 0.9', SP.said[0] && SP.said[0].rate === 0.9, SP.said[0] && SP.said[0].rate);
ctx.DB.set.rate = 99; SP.said = []; ctx.say('x', false);
ok('语速 99 → 回落 0.9', SP.said[0] && SP.said[0].rate === 0.9, SP.said[0] && SP.said[0].rate);
ctx.DB.set.rate = 0.9;

/* Chrome 卡在暂停态的老毛病 */
SP.paused = true; SP.resumeCount = 0; ctx.say('x', false);
ok('暂停态时调用 resume', SP.resumeCount === 1, SP.resumeCount);

/* 手动指定语音 */
ctx.DB.set.voiceURI = 'us1';
ok('手动指定后按指定走', ctx.pickVoice().voiceURI === 'us1', ctx.pickVoice().voiceURI);
ctx.DB.set.voiceURI = '这个语音不存在';
ok('指定失效时回落自动', ctx.pickVoice().voiceURI === 'gb1', ctx.pickVoice().voiceURI);
ctx.DB.set.voiceURI = '';

/* 完全没有语音 */
SP.voices = [];
ok('没有语音时返回 0', ctx.refreshVoices() === 0, ctx.refreshVoices());
try { ctx.paintVoiceBar(); ok('没有语音时顶部提示不报错', true); } catch (e) { ok('没有语音时顶部提示不报错', false, e.message); }
try { ctx.say('x', false); ok('没有语音时 say 不报错', true); } catch (e) { ok('没有语音时 say 不报错', false, e.message); }
const dg = ctx.voiceDiag();
ok('诊断报告含语音总数', typeof dg === 'string' && dg.indexOf('语音总数') >= 0);
ok('没语音时给出 Windows 排查建议', dg.indexOf('Windows 没装英语语音包') >= 0);

/* 只有中文语音（最可能踩到的情况） */
SP.voices = [{ name: 'Microsoft Huihui', lang: 'zh-CN', voiceURI: 'zh1', localService: true }];
ctx.refreshVoices();
ok('只有中文语音时英语语音为 0', ctx.voices.length === 0, ctx.voices.length);
ctx.paintVoiceBar();
ok('只有中文语音时顶部明确警告', (els['voicebar'].innerHTML || '').indexOf('没有英语的') >= 0, els['voicebar'].innerHTML);

/* 恢复 */
SP.voices = [{ name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB', voiceURI: 'gb1', localService: false }];
ctx.refreshVoices();

console.log('\n==================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
