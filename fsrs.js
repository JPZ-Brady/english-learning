/* ============================================================
   FSRS-6 调度器  —— 参数与公式逐行取自官方实现
   来源: https://github.com/open-spaced-repetition/fsrs-rs
         src/inference_v6.rs  (FSRS6_DEFAULT_PARAMETERS / FSRS6_DEFAULT_DECAY)
         src/model_v6.rs      (各 step 函数)
   ------------------------------------------------------------
   变量: S = 记忆稳定性(天)   D = 难度(1-10)   R = 可回忆度(0-1)
   ============================================================ */
var FSRS_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194,
  0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
  1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
];
var DECAY = FSRS_W[20];                       /* FSRS6_DEFAULT_DECAY = 0.1542 */
var FACTOR = Math.pow(0.9, 1 / -DECAY) - 1;   /* 0.9^(1/decay) - 1 */
var S_MIN = 0.01, S_MAX = 36500, D_MIN = 1, D_MAX = 10;

function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

/* 幂函数遗忘曲线: R(t,S) = (t/S * factor + 1)^(-decay) */
function retrievability(t, S) {
  S = Math.max(S, S_MIN);
  t = Math.max(0, Math.round(t));
  return Math.pow((t / S) * FACTOR + 1, -DECAY);
}
/* 由稳定性和期望保持率反推间隔天数 */
function intervalFor(S, dr) {
  S = Math.max(S, S_MIN);
  dr = clamp(dr, 0.0001, 0.9999);
  return clamp((S / FACTOR) * (Math.pow(dr, 1 / -DECAY) - 1), 0, S_MAX);
}
function initStability(g) { return clamp(FSRS_W[g - 1], S_MIN, S_MAX); }
function initDifficulty(g) { return FSRS_W[4] - Math.exp(FSRS_W[5] * (g - 1)) + 1; }
function nextDifficulty(D, g) {
  var dD = -FSRS_W[6] * (g - 3);
  var nd = D + ((10 - D) / 9) * dD;
  return clamp(FSRS_W[7] * initDifficulty(4) + (1 - FSRS_W[7]) * nd, D_MIN, D_MAX);
}
/* 答对后的稳定性 */
function stabilityAfterSuccess(S, R, D, g) {
  var hard = (g === 2) ? FSRS_W[15] : 1;
  var easy = (g === 4) ? FSRS_W[16] : 1;
  var v = S * (Math.exp(FSRS_W[8]) * (11 - D) * Math.pow(S, -FSRS_W[9]) *
          (Math.exp((1 - R) * FSRS_W[10]) - 1) * hard * easy + 1);
  return clamp(v, S_MIN, S_MAX);
}
/* 答错后的稳定性（FSRS-6: 取 min(公式值, S/exp(w17*w18)) ） */
function stabilityAfterFailure(S, R, D) {
  var sMin = S / Math.exp(FSRS_W[17] * FSRS_W[18]);
  var ns = FSRS_W[11] * Math.pow(D, -FSRS_W[12]) *
           (Math.pow(S + 1, FSRS_W[13]) - 1) * Math.exp((1 - R) * FSRS_W[14]);
  return clamp(Math.min(ns, sMin), S_MIN, S_MAX);
}
/* 同一天内的短期稳定性 */
function stabilityShortTerm(S, g) {
  var sinc = Math.exp(FSRS_W[17] * (g - 3 + FSRS_W[18])) * Math.pow(S, -FSRS_W[19]);
  var v = S * (g >= 2 ? Math.max(sinc, 1) : sinc);
  return clamp(v, S_MIN, S_MAX);
}
/* 一次复习后的完整状态转移 */
function fsrsNext(S, D, elapsedDays, g) {
  var R = retrievability(elapsedDays, S);
  var S2;
  if (elapsedDays === 0) S2 = stabilityShortTerm(S, g);
  else if (g === 1) S2 = stabilityAfterFailure(S, R, D);
  else S2 = stabilityAfterSuccess(S, R, D, g);
  return { S: S2, D: nextDifficulty(D, g), R: R };
}
