/* 验证：「不会」点得太多会怎样放大负荷
   注意两条放大链：
   ① 答错 → 稳定性被打回 1-2 天 → 这张卡隔天甚至当天又回来
   ② 答错 → 本轮内重新出现 → 今天已完成里多算一次（同一张卡被评两次）*/
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

/* failRate = 复习时点「不会」的比例（新词首次按「会了」）*/
function simulate(opt){
  var rng = mkRng(opt.seed || 20261002);
  var dr = opt.dr, npd = opt.newPerDay, days = opt.days, failRate = opt.failRate;
  var cards = [], daily = [];
  for(var day = 1; day <= days; day++){
    var neu = 0, events = 0, touched = {};
    for(var i = 0; i < npd; i++){
      var c = { st:0, S:0, D:0, last:null, due:null, lapses:0, reps:0, id:'n'+cards.length };
      cards.push(c); reviewCard(c, 3, day, dr); neu++;
    }
    for(var pass = 0; pass < 12; pass++){
      var due = cards.filter(function(x){ return x.st > 0 && x.due !== null && x.due <= day; });
      if(!due.length) break;
      for(var k = 0; k < due.length; k++){
        var x = due[k];
        events++; touched[x.id] = 1;
        var g = (rng() < failRate) ? 1 : 3;
        reviewCard(x, g, day, dr);
      }
    }
    daily.push({ day:day, neu:neu, events:events, distinct:Object.keys(touched).length,
                 total:neu+events, cards:cards.length });
  }
  return daily;
}
`;

const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(fsrsSrc + '\n' + simSrc, ctx, { filename: 'fsrs+sim.js' });

console.log('每天 19 个新词 ｜ 保持率 0.90 ｜ 新词首次一律按「会了」');
console.log('唯一变量：复习时点「不会」的比例\n');
console.log('  「不会」比例      第10天            第30天            第90天');
for (const fr of [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70]) {
  const d = ctx.simulate({ newPerDay:19, dr:0.90, days:90, failRate:fr });
  const cell = x => {
    const y = d[x-1];
    return String(y.total).padStart(4) + ' 次 (' + String(y.distinct).padStart(3) + ' 张不同卡)';
  };
  console.log('      ' + String(Math.round(fr*100)).padStart(2) + '%        ' + cell(10) + '   ' + cell(30) + '   ' + cell(90));
}

console.log('\n★ 每张卡平均被评几次（衡量「同一张卡重复出现」的严重程度）');
for (const fr of [0.10, 0.30, 0.50, 0.70]) {
  const d = ctx.simulate({ newPerDay:19, dr:0.90, days:30, failRate:fr });
  const y = d[29];
  console.log('   「不会」' + String(Math.round(fr*100)).padStart(2) + '% → 第30天 ' +
    y.total + ' 次评分 / ' + y.distinct + ' 张不同卡 = 每张 ' + (y.events / y.distinct).toFixed(2) + ' 次');
}
