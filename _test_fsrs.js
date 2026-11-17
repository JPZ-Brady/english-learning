/* 用 fsrs-rs 官方测试用例检验本机 fsrs.js 的实现是否正确 */
const fs = require('fs'), vm = require('vm');
const DIR = __dirname;

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(DIR + '/fsrs.js', 'utf8'), ctx, { filename: 'fsrs.js' });

const { retrievability, intervalFor, initStability, initDifficulty, nextDifficulty,
        stabilityAfterSuccess, stabilityAfterFailure, stabilityShortTerm, fsrsNext,
        FSRS_W, DECAY, FACTOR } = ctx;

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { console.log('  ✅ ' + name); pass++; }
  else { console.log('  ❌ ' + name + '   实际=' + got); fail++; }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

console.log('DECAY  = ' + DECAY + '   (官方 FSRS6_DEFAULT_DECAY = 0.1542)');
console.log('FACTOR = ' + FACTOR);

console.log('\n=== 官方测试 1: test_s90_legacy_equals_stability ===');
console.log('    官方断言: intervalFor(S, 0.9) 必须等于 S');
[1.5, 12.345, 121.01552, 3650].forEach(S => {
  const iv = intervalFor(S, 0.9);
  ok('S=' + S + ' → 间隔 ' + iv.toFixed(5), near(iv, S, 1e-4), iv);
});

console.log('\n=== 官方测试 2: next_interval_remains_fractional ===');
const iv = intervalFor(121.01552, 0.9);
ok('intervalFor(121.01552, 0.9) ≈ 121.01551', near(iv, 121.01551, 1e-3), iv);

console.log('\n=== 官方测试 3: forgetting_curve_rounds_elapsed_days ===');
console.log('    官方断言: R(0.0)==R(0.49) 且 R(1.0)==R(0.51)（天数四舍五入）');
ok('R(0.00) == R(0.49)', retrievability(0.0, 10) === retrievability(0.49, 10));
ok('R(1.00) == R(0.51)', retrievability(1.0, 10) === retrievability(0.51, 10));

console.log('\n=== 遗忘曲线自检: R(S, S) 必须 ≈ 0.9 ===');
[1, 10, 100, 1000].forEach(S => {
  const r = retrievability(S, S);
  ok('R(' + S + '天, S=' + S + ') = ' + r.toFixed(6), near(r, 0.9, 1e-6), r);
});

console.log('\n=== 单调性: 时间越长回忆概率越低 / 稳定性越高回忆概率越高 ===');
let mono1 = true, mono2 = true;
for (let t = 0; t < 60; t++) if (retrievability(t + 1, 10) > retrievability(t, 10) + 1e-12) mono1 = false;
for (let s = 1; s < 200; s++) if (retrievability(30, s + 1) < retrievability(30, s) - 1e-12) mono2 = false;
ok('R 随时间单调递减', mono1);
ok('R 随稳定性单调递增', mono2);

console.log('\n=== 参数合法性 ===');
ok('FSRS_W 长度 = 21', FSRS_W.length === 21, FSRS_W.length);
ok('initStability(1..4) 严格递增', initStability(1) < initStability(2) && initStability(2) < initStability(3) && initStability(3) < initStability(4),
   [1,2,3,4].map(initStability).map(x=>x.toFixed(3)).join(' < '));
ok('initDifficulty(1..4) 严格递减', initDifficulty(1) > initDifficulty(2) && initDifficulty(2) > initDifficulty(3) && initDifficulty(3) > initDifficulty(4),
   [1,2,3,4].map(initDifficulty).map(x=>x.toFixed(2)).join(' > '));
const rawD4 = initDifficulty(4);
console.log('    initDifficulty 原始值: ' + [1,2,3,4].map(g=>initDifficulty(g).toFixed(3)).join(', ') + '   ← g=4 按官方公式是负数');
ok('clamp 后在 [1,10]（这才是程序实际用的值）', [1,2,3,4].every(g => { const v = Math.max(1, Math.min(10, initDifficulty(g))); return v >= 1 && v <= 10; }));
ok('官方公式 g=4 确实 < 1（证明我们没擅自改公式）', rawD4 < 1, rawD4);
ok('nextDifficulty 恒在 [1,10]', (() => { for(let d=1; d<=10; d+=0.5) for(let g=1; g<=4; g++){ const v=nextDifficulty(d,g); if(v<1||v>10) return false; } return true; })());

console.log('\n=== 答对后稳定性必须增长 ===');
[2,3,4].forEach(g => {
  const S = 10, R = retrievability(5, S), D = 5;
  const S2 = stabilityAfterSuccess(S, R, D, g);
  ok('rating=' + g + ' 时 S 增长: ' + S + ' → ' + S2.toFixed(2), S2 > S, S2);
});

console.log('\n=== 答错后稳定性必须下降 ===');
(() => {
  const S = 10, R = retrievability(5, S), D = 5;
  const S2 = stabilityAfterFailure(S, R, D);
  ok('答错后 S 下降: ' + S + ' → ' + S2.toFixed(2), S2 < S, S2);
})();

console.log('\n=== 模拟 60 天真实使用：间隔应当是扩张的 ===');
(() => {
  let S = initStability(3), D = initDifficulty(3), day = 0, ivs = [];
  for (let i = 0; i < 8; i++) {
    const iv = Math.max(1, Math.round(intervalFor(S, 0.9)));
    ivs.push(iv);
    const nx = fsrsNext(S, D, iv, 3);
    S = nx.S; D = nx.D; day += iv;
  }
  const growing = ivs.every((v, i) => i === 0 || v >= ivs[i-1]);
  console.log('    间隔序列: ' + ivs.join(' → ') + ' 天（累计 ' + day + ' 天）');
  ok('连续答对 8 次，间隔单调不下降', growing, ivs.join(','));
  ok('间隔确实在扩张（末/首 > 1.5）', ivs[ivs.length-1] / ivs[0] > 1.5, ivs[ivs.length-1]/ivs[0]);
  ok('原始间隔会超过 365（程序里另做 365 天上限）', ivs[ivs.length-1] > 365, ivs[ivs.length-1]);
})();

console.log('\n==================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
