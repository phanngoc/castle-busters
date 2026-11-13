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

  // ---- Tiến trình (design §2.2–§2.3; CONTRACT.md) ----
  R.UNIT_LVL_MIN = 1; R.UNIT_LVL_MAX = 9; R.STANDARD_LVL = 5;
  R.UNITS = ['rusher', 'knight', 'archer', 'bomber', 'giant'];
  function lvlClamp(l) { l = Math.floor(Number(l) || 1); return l < 1 ? 1 : l > 9 ? 9 : l; }
  R.unitLevel = lvlClamp;
  // Hệ số máu & sát thương. Chi phí/tốc độ KHÔNG đổi.
  R.statMult = function (lvl) { return Math.round((1 + 0.04 * (lvlClamp(lvl) - 1)) * 10000) / 10000; };
  // Chỉ số hiệu dụng của 1 quân ở cấp lvl: chỉ hp & dmg nhân hệ số.
  R.scaleUnit = function (base, lvl) {
    var m = R.statMult(lvl), o = {};
    for (var k in base) o[k] = base[k];
    o.hp = base.hp * m; o.dmg = base.dmg * m; o.lvl = lvlClamp(lvl);
    return o;
  };
  // AI màn chiến dịch m dùng quân cấp min(9, 1 + floor((m-1)/2.5)).
  R.aiUnitLevel = function (stage) { return Math.min(9, 1 + Math.floor((Math.max(1, stage | 0) - 1) / 2.5)); };
  // Bảng cấp quân cho 1 trận. mode 'standard' ⇒ MỌI quân cả 2 bên = 5, bỏ qua cấp sở hữu.
  R.matchLevels = function (mode, owned, stage) {
    var L = {}, E = {};
    R.UNITS.forEach(function (u) {
      if (mode === 'standard') { L[u] = R.STANDARD_LVL; E[u] = R.STANDARD_LVL; }
      else { L[u] = lvlClamp(owned && owned[u]); E[u] = R.aiUnitLevel(stage); }
    });
    return { L: L, R: E };
  };
  // Bảng xếp hạng theo mode: standard chỉ nộp vào 'standard'; chiến dịch giữ daily/alltime.
  R.boardsFor = function (mode) { return mode === 'standard' ? ['standard'] : ['alltime', 'daily']; };
  // Chi phí nâng cấp lên cấp `to` (2..9) — §2.3, chỉ để HIỂN THỊ; server quyết.
  R.UPGRADE = { 2: [2, 50, 4], 3: [4, 150, 10], 4: [10, 400, 25], 5: [20, 1000, 50], 6: [50, 2000, 100], 7: [100, 4000, 200], 8: [200, 8000, 400], 9: [400, 15000, 600] };
  R.upgradeCost = function (to) { var c = R.UPGRADE[to]; return c ? { cards: c[0], gold: c[1], xp: c[2] } : null; };
  R.xpToNext = function (n) { return 100 + 40 * n; };

  // ---- Hình lâu đài + skin (chỉ đổi MÀU, không đổi số gạch/hitbox) ----
  R.CASTLE_HEIGHTS = [4, 6, 8, 6, 4];
  R.SKINS = {
    default:  { name: 'Đá Xám', sku: null, L: [120, 150, 200], R: [200, 130, 120], mortar: 'rgba(255,255,255,.10)', pattern: 'plain' },
    ice:      { name: 'Gạch Băng', sku: 'castle.skin.ice', L: [150, 215, 245], R: [150, 215, 245], mortar: 'rgba(255,255,255,.35)', pattern: 'ice' },
    redstone: { name: 'Đá Đỏ', sku: 'castle.skin.redstone', L: [178, 58, 48], R: [178, 58, 48], mortar: 'rgba(255,200,150,.18)', pattern: 'redstone' },
    bamboo:   { name: 'Tre Làng', sku: 'castle.skin.bamboo', L: [150, 180, 70], R: [150, 180, 70], mortar: 'rgba(60,80,20,.35)', pattern: 'bamboo' }
  };
  R.skinFor = function (id) { return R.SKINS[id] || R.SKINS.default; };
  // Skin dùng được: default + skin có entitlement (sku).
  R.ownedSkins = function (entitlements) {
    var e = entitlements || [];
    return Object.keys(R.SKINS).filter(function (id) { var s = R.SKINS[id]; return !s.sku || e.indexOf(s.sku) >= 0; });
  };
  // Lâu đài thuần (không DOM) — skin chỉ gắn nhãn, KHÔNG tham gia số gạch.
  R.castleSpec = function (skinId, brickHp) {
    var cols = R.CASTLE_HEIGHTS.map(function (h) { return { bricks: h, hp: brickHp || 2 }; });
    return { skin: R.SKINS[skinId] ? skinId : 'default', cols: cols, total: R.CASTLE_HEIGHTS.reduce(function (a, b) { return a + b; }, 0) };
  };
  R.SHOP_LABEL = { cosmetic: '🎨 Trang trí', boost: '⏩ Tăng tốc', 'cosmetic+boost': '🎨 + ⏩' };
  R.shopLabel = function (kind) { return R.SHOP_LABEL[kind] || kind; };
  return R;
});
