/* 长期负荷模拟：① 词库无限增长（转写台持续加词）② 19 新词/天 ③ 不同评分分布的影响
   逐行复刻 学习台.html 的 review() 状态转移 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;
const fsrsSrc = fs.readFileSync(path.join(DIR, 'fsrs.js'), 'utf8');

const simSrc = `
function mkRng(seed){ var s = seed >>> 0; return function(){ s = (s*1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function reviewCard(c, g, day, dr){
  var elapsed = (c.last === null) ? 0 : (day - c.last);
  var S, D;
  if(c.reps === 0){ S = initStability(g); D = clamp(initDifficulty(g), 1, 10); }
  else { var nx = fsrsNext(c.S || 1, c.D || 5, elapsed, g); S = nx.S; D = nx.D; }
  c.S = S; c.D = D; c.last = day; c.reps++;
  if(g === 1){ c.lapses++; c.st = 1; c.due = day; }
  else if(c.reps === 1){ c.st = 1; c.due = day + 1; }
  else { c.st = 2; c.due = day + clamp(Math.round(intervalFor(S, dr)), 1, 365); }
}

/* mix = {p2,p3,p4} 答对时评「有点难/会了/太简单」的比例；passBias 强制通过率（null=按遗忘曲线）*/
function simulate(opt){
  var rng = mkRng(opt.seed || 20261002);
  var dr = opt.dr, npd = opt.newPerDay, days = opt.days;
  var mix = opt.mix, passBias = opt.passBias;
  var cards = [], daily = [];
  for(var day = 1; day <= days; day++){
    var neu = 0, rev = 0;
    for(var i = 0; i < npd; i++){                       /* 词库无限：永远能发新词 */
      var c = { st:0, S:0, D:0, last:null, due:null, lapses:0, reps:0 };
      cards.push(c);
      reviewCard(c, 3, day, dr);
      neu++;
    }
    var done = 0;
    for(var pass = 0; pass < 12; pass++){
      var due = cards.filter(function(x){ return x.st > 0 && x.due !== null && x.due <= day; });
      if(!due.length) break;
      for(var k = 0; k < due.length; k++){
        if(opt.maxReview && done >= opt.maxReview) break;
        var x = due[k]; rev++; done++;
        var R = (x.last === null) ? 1 : retrievability(day - x.last, x.S);
        var p = (passBias === null || passBias === undefined) ? R : passBias;
        var g;
        if(rng() < p){ var u = rng(); g = (u < mix.p2) ? 2 : (u < mix.p2 + mix.p3 ? 3 : 4); }
        else g = 1;
        reviewCard(x, g, day, dr);
      }
    }
    daily.push({ day:day, neu:neu, rev:rev, total:neu+rev, cards:cards.length });
  }
  return daily;
}
`;

const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(fsrsSrc + '\n' + simSrc, ctx, { filename: 'fsrs+sim.js' });

const D = 1095;   /* 3 年 */

const cases = [
  ['A 宽松（多数点「会了」）', { newPerDay:19, dr:0.90, days:D, mix:{p2:0.15,p3:0.75,p4:0.10}, passBias:null }],
  ['B 吃力（三成点「有点难」）', { newPerDay:19, dr:0.90, days:D, mix:{p2:0.30,p3:0.65,p4:0.05}, passBias:null }],
  ['C 很吃力（一半点难/不会）', { newPerDay:19, dr:0.90, days:D, mix:{p2:0.35,p3:0.60,p4:0.05}, passBias:0.80 }],
  ['D 宽松 + 保持率降到 0.85', { newPerDay:19, dr:0.85, days:D, mix:{p2:0.15,p3:0.75,p4:0.10}, passBias:null }],
  ['E 宽松 + 新词降到 12', { newPerDay:12, dr:0.90, days:D, mix:{p2:0.15,p3:0.75,p4:0.10}, passBias:null }]
];

for (const [label, opt] of cases) {
  const d = ctx.simulate(opt);
  const peak = d.reduce((a, b) => b.total > a.total ? b : a, d[0]);
  const rev = dd => d[dd - 1];
  console.log('\n── ' + label + '（' + opt.newPerDay + ' 新词/天, 保持率 ' + opt.dr + '）──');
  [30, 90, 180, 365, 547, 730, 1095].forEach(x => {
    const y = rev(x);
    console.log('   第 ' + String(x).padStart(4) + ' 天:  新 ' + String(y.neu).padStart(2) +
      ' + 复习 ' + String(y.rev).padStart(3) + ' = ' + String(y.total).padStart(3) +
      '   （累计学过 ' + y.cards + ' 张）');
  });
  console.log('   3 年最高: ' + peak.total + ' 张（第 ' + peak.day + ' 天）');
  console.log('   ★ 每 1 新词/天 → 第 3 年约 ' + (rev(1095).rev / opt.newPerDay).toFixed(1) + ' 张复习/天');
}
