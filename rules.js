/* rules.js — luật thuần của Castle Busters (không DOM), dùng chung cho game.js
   (script tag → window.CastleRules) và test (require). BRAINSTORM #1, 04/11/2026. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CastleRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var R = {
    ROUND: 60, ENERGY_MAX: 10, ENERGY_REGEN: 1.05, START_ENERGY: 4,
    FINAL_SECS: 15, FINAL_MULT: 2,          // 15s cuối: năng lượng x2
    OT_SECS: 20, OT_MULT: 3,                // hiệp phụ 20s, năng lượng x3
    NEAR_TIE_BRICKS: 1,                     // chênh <= 1 viên lúc hết giờ ⇒ hiệp phụ
    WIN_BONUS: 300, KO_PER_SEC: 10, LOSS_DAILY_FACTOR: 0.5
  };

  // Năng lượng/giây — AI và người chơi dùng CÙNG hàm (không còn +25% cho AI).
  R.energyRate = function (timeLeft, overtime) {
    if (overtime) return R.ENERGY_REGEN * R.OT_MULT;
    return timeLeft <= R.FINAL_SECS ? R.ENERGY_REGEN * R.FINAL_MULT : R.ENERGY_REGEN;
  };

  // Hết 60s: 'win' | 'lose' | 'overtime'. bricksL/R = số gạch còn lại.
  R.resolveTimeUp = function (bricksL, bricksR) {
    if (Math.abs(bricksL - bricksR) <= R.NEAR_TIE_BRICKS) return 'overtime';
    return bricksL > bricksR ? 'win' : 'lose';
  };

  // Trong hiệp phụ, mỗi frame. o = { lostL, lostR (gạch mất từ đầu hiệp phụ),
  // bricksL, bricksR, hpSumL, hpSumR (tổng máu gạch còn lại), timeLeft }.
  // Mất gạch trước là thua; hết giờ: ít gạch hơn thua, rồi ít máu gạch hơn thua,
  // bằng hết thì người chơi (bên thủ nhà) thắng — không còn hòa.
  R.resolveOvertime = function (o) {
    if (o.lostL > 0 || o.lostR > 0) {
      if (o.lostL !== o.lostR) return o.lostL > o.lostR ? 'lose' : 'win';
      // cùng frame mất bằng nhau: rơi xuống so tiếp như hết giờ
      if (o.timeLeft > 0) return null;
    }
    if (o.timeLeft > 0) return null;
    if (o.bricksL !== o.bricksR) return o.bricksL > o.bricksR ? 'win' : 'lose';
    if (o.hpSumL !== o.hpSumR) return o.hpSumL > o.hpSumR ? 'win' : 'lose';
    return 'win';
  };

  // Điểm cuối trận. ko = lâu đài địch về 0 trước khi hết giờ.
  R.finalScore = function (base, result, timeLeft, ko) {
    var s = base;
    if (result === 'win') {
      s += R.WIN_BONUS;
      if (ko) s += R.KO_PER_SEC * Math.ceil(Math.max(0, timeLeft));
    }
    return s;
  };
  // Bảng daily: thua chỉ tính một nửa. Bảng alltime giữ nguyên điểm.
  R.dailyScore = function (score, result) {
    return result === 'lose' ? Math.floor(score * R.LOSS_DAILY_FACTOR) : score;
  };

  // Độ khó trơn 1→20 (trước đây kẹp ở màn 10 ⇒ 10–20 như nhau).
  R.skill = function (level) { return Math.min(1, Math.max(0, (level - 1) / 19)); };

  // Khắc chế: lính của người chơi → lính AI nên ra.
  R.COUNTER = { rusher: 'knight', knight: 'archer', archer: 'rusher', bomber: 'rusher', giant: 'archer' };

  // AI chọn lính. threat = loại lính người chơi gần lâu đài AI nhất (hoặc null).
  // Xác suất khắc chế tăng theo skill; còn lại chọn ngẫu nhiên trong số đủ tiền.
  // Trả về { pick } hoặc { wait: true } (để dành năng lượng cho lính khắc chế).
  R.aiPick = function (opts, energy, threat, skill, costs, rnd) {
    rnd = rnd || Math.random;
    var counter = threat ? R.COUNTER[threat] : null;
    if (counter && rnd() < 0.25 + 0.7 * skill) {
      if (costs[counter] <= energy) return { pick: counter };
      if (rnd() < skill) return { wait: true };
    }
    var aff = opts.filter(function (k) { return costs[k] <= energy; });
    if (!aff.length) return { wait: true };
    return { pick: aff[Math.floor(rnd() * aff.length)] };
  };
  return R;
});
