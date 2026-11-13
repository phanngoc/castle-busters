/* economy.js — ví / nâng cấp quân / cửa hàng / thanh toán QR của Castle Busters.
   SERVER LÀ NGUỒN CHÂN LÝ (CONTRACT.md): client chỉ đọc profile và POST kết quả trận.
   Không có platform (offline / guest lỗi mạng) ⇒ vẫn chơi chiến dịch bình thường với
   cấp quân lần cuối server trả về (cache), chỉ không nhận thưởng và không mua được. */
(function () {
  'use strict';
  var R = window.CastleRules;
  var NAMES = { rusher: '🐎 Kỵ binh', knight: '🛡️ Kiếm sĩ', archer: '🏹 Cung thủ', bomber: '💣 Pháo thủ', giant: '🪓 Khổng lồ' };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function vnd(n) { return (Number(n) || 0).toLocaleString('vi-VN') + 'đ'; }
  function $(id) { return document.getElementById(id); }

  var profile = null;
  try { profile = JSON.parse(lsGet('cb_profile', 'null')); } catch (e) { profile = null; }
  var online = false, pollTmr = null, reportSeq = 0;

  function api(method, path, body) {
    var G = window.ArcadeGame;
    if (!G || !G.api) return Promise.reject(Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' }));
    return G.api(method, path, body);
  }
  function setProfile(p) {
    if (!p || typeof p !== 'object') return;
    profile = p; online = true; lsSet('cb_profile', JSON.stringify(p));
    renderWallet();
    if (window.__cbRefreshStart) window.__cbRefreshStart();
  }
  function refresh() { return api('GET', '/v1/castle/profile').then(setProfile).catch(function () { online = false; renderWallet(); }); }

  var toastTmr = null;
  function toast(msg) {
    var el = $('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTmr); toastTmr = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function cardUnit() { var u = lsGet('cb_card_unit', 'knight'); return NAMES[u] ? u : 'knight'; }

  var E = window.CastleEconomy = {
    get profile() { return profile; }, get online() { return online; },
    refresh: refresh, toast: toast, api: api,
    unitLevels: function () { return (profile && profile.units) || {}; },
    canStandard: function () {
      if (!online || !profile) return false;
      return (profile.unlocks || []).indexOf('standard') >= 0 || (profile.level || 1) >= 3;
    },
    skin: function () {
      var id = lsGet('cb_skin', 'default');
      return R.ownedSkins(profile && profile.entitlements).indexOf(id) >= 0 ? id : 'default';
    },
    reportMatch: function (m) {
      // Chỉ trận báo gần nhất được ghi màn kết: phản hồi muộn của trận cũ không đè lên.
      var my = ++reportSeq;
      var el0 = $('endReward'), el = { set textContent(v) { if (my === reportSeq && el0) el0.textContent = v; } };
      m.cardUnit = cardUnit();
      if (!online) { if (el) el.textContent = '📴 Offline — trận không tính thưởng'; return Promise.resolve(null); }
      if (el) el.textContent = '…đang nhận thưởng';
      return api('POST', '/v1/castle/match', m).then(function (r) {
        if (r && r.profile) setProfile(r.profile);
        var w = (r && r.reward) || {};
        if (el) el.textContent = (w.gold || w.cards || w.xp)
          ? '💰 +' + (w.gold || 0) + ' vàng · 🃏 +' + (w.cards || 0) + ' thẻ ' + NAMES[m.cardUnit] + ' · ✨ +' + (w.xp || 0) + ' XP'
          : 'Trận không được thưởng (giới hạn ngày / trận quá ngắn)';
        return r;
      }).catch(function () { if (el) el.textContent = 'Không gửi được kết quả — thử lại sau'; });
    },
    upgrade: function (unit) {
      return api('POST', '/v1/castle/upgrade', { unit: unit }).then(function (r) { setProfile(r && r.profile); toast('⬆️ ' + NAMES[unit] + ' lên cấp!'); })
        .catch(function (e) { toast(e && e.code === 'NOT_ENOUGH' ? 'Chưa đủ thẻ hoặc vàng' : 'Không nâng cấp được (offline?)'); });
    }
  };

  // ---------- Ví (màn Lâu đài) ----------
  function renderWallet() {
    var w = $('walletLine');
    if (w) w.innerHTML = profile
      ? '💰 <b>' + (profile.gold || 0).toLocaleString('vi-VN') + '</b> · 🏰 Cấp <b>' + (profile.level || 1) + '</b>' + (online ? '' : ' · 📴')
      : (online ? '' : '📴 Chơi offline — tiến trình lâu đài cần mạng');
    var sb = $('stdBtn'); if (sb) sb.classList.toggle('locked', !E.canStandard());
    if ($('profileOv') && $('profileOv').classList.contains('show')) renderProfile();
  }
  function renderProfile() {
    var p = profile || { gold: 0, cards: {}, units: {}, xp: 0, level: 1, nextLevelXp: 140, entitlements: [] };
    var need = p.nextLevelXp || R.xpToNext(p.level || 1);
    var h = '<div class="pf-head">🏰 Cấp <b>' + (p.level || 1) + '</b> · ✨ ' + (p.xp || 0) + ' / ' + need + ' XP · 💰 <b>' + (p.gold || 0).toLocaleString('vi-VN') + '</b> vàng</div>';
    if (!online) h += '<div class="pf-warn">📴 Đang offline: xem được, không nâng cấp được.</div>';
    h += '<div class="pf-sub">Thẻ thưởng mỗi trận rơi vào quân được chọn ◉</div><div class="pf-units">';
    R.UNITS.forEach(function (u) {
      var lvl = R.unitLevel((p.units || {})[u]), cards = (p.cards || {})[u] || 0, c = R.upgradeCost(lvl + 1);
      var can = c && online && cards >= c.cards && (p.gold || 0) >= c.gold;
      h += '<div class="pf-u"><label><input type="radio" name="cu" value="' + u + '"' + (cardUnit() === u ? ' checked' : '') + '> ' + NAMES[u] + '</label>' +
        '<span>Cấp <b>' + lvl + '</b> (+' + Math.round((R.statMult(lvl) - 1) * 100) + '%) · 🃏 ' + cards + '</span>' +
        (c ? '<button class="mini" data-up="' + u + '"' + (can ? '' : ' disabled') + '>⬆ ' + c.cards + '🃏 ' + c.gold.toLocaleString('vi-VN') + '💰</button>' : '<span class="max">MAX</span>') + '</div>';
    });
    h += '</div><div class="pf-sub">Skin lâu đài (chỉ đổi màu, số gạch giữ nguyên)</div><div class="pf-skins">';
    var owned = R.ownedSkins(p.entitlements), cur = E.skin();
    Object.keys(R.SKINS).forEach(function (id) {
      var s = R.SKINS[id], has = owned.indexOf(id) >= 0;
      h += '<button class="skin' + (cur === id ? ' on' : '') + '" data-skin="' + id + '"' + (has ? '' : ' disabled') + ' style="--c:rgb(' + s.L.join(',') + ')">' + esc(s.name) + (has ? '' : ' 🔒') + '</button>';
    });
    h += '</div>';
    var pa = p.pass || {}, claimed = !!p.passClaimedToday;
    h += '<div class="pf-sub">🎟️ Pass mùa' + (pa.active ? ' <b>Plus</b>' : '') + ' — quà mỗi ngày (vào quân ◉)</div>' +
      '<button class="mini" id="passClaim" data-claim="1"' + (online && !claimed ? '' : ' disabled') + '>' + (claimed ? '✅ Đã nhận hôm nay' : '🎁 Nhận quà Pass') + '</button>';
    $('profileBody').innerHTML = h;
  }
  document.addEventListener('change', function (e) { if (e.target && e.target.name === 'cu') lsSet('cb_card_unit', e.target.value); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-up],[data-skin],[data-buy],[data-open],[data-close],[data-claim]') : null;
    if (!t) return;
    if (t.dataset.up) E.upgrade(t.dataset.up);
    else if (t.dataset.skin) { lsSet('cb_skin', t.dataset.skin); renderProfile(); }
    else if (t.dataset.buy) buy(t.dataset.buy);
    else if (t.dataset.open) openOv(t.dataset.open);
    else if (t.dataset.close) closeOv(t.dataset.close);
    else if (t.dataset.claim) claimPass();
  });
  function claimPass() {
    api('POST', '/v1/castle/pass/claim', { unit: cardUnit() }).then(function (r) {
      if (r && r.profile) setProfile(r.profile);
      var w = (r && r.reward) || {};
      toast('🎁 +' + (w.gold || 0) + ' vàng · +' + (w.cards || 0) + ' thẻ');
    }).catch(function (e) { toast(e && e.code === 'ALREADY_CLAIMED' ? 'Hôm nay đã nhận rồi' : 'Không nhận được (offline?)'); });
  }
  function openOv(id) {
    $(id).classList.add('show');
    if (id === 'profileOv') { renderProfile(); refresh(); }
    if (id === 'shopOv') loadShop();
  }
  function closeOv(id) { $(id).classList.remove('show'); if (id === 'payOv') stopPoll(); }

  // ---------- Cửa hàng ----------
  var LIMIT_TXT = { 'castle.gold.daily': '1/ngày', 'castle.cards.pick': '3/tuần', 'castle.starter': '1 lần/tài khoản', 'castle.pass.s1': '1/mùa' };
  function loadShop() {
    var box = $('shopBody');
    box.innerHTML = '<div class="pf-sub">Đang tải…</div>';
    api('GET', '/v1/shop?game=castle').then(function (items) {
      items = Array.isArray(items) ? items : (items && items.items) || [];
      var h = '<div class="pf-sub">Không bán sức mạnh trực tiếp · không hộp ngẫu nhiên · Đấu Chuẩn luôn ép cấp 5</div>';
      items.forEach(function (it) {
        var left = it.limitLeft, sold = left === 0;
        h += '<div class="shop-it"><div><div class="si-name">' + esc(it.label || it.sku) + '</div>' +
          '<div class="si-tag">' + esc(R.shopLabel(it.kind)) + (LIMIT_TXT[it.sku] ? ' · giới hạn ' + LIMIT_TXT[it.sku] : '') +
          (left != null ? ' · còn ' + esc(left) : '') + '</div></div>' +
          '<button class="mini buy" data-buy="' + esc(it.sku) + '"' + (sold ? ' disabled' : '') + '>' + (sold ? 'Hết lượt' : vnd(it.price)) + '</button></div>';
      });
      box.innerHTML = h;
    }).catch(function () { box.innerHTML = '<div class="pf-warn">📴 Cửa hàng cần kết nối mạng.</div>'; });
  }
  function buy(sku) {
    var body = { sku: sku };
    if (sku === 'castle.cards.pick' || sku === 'castle.starter') body.unit = cardUnit();
    api('POST', '/v1/orders', body).then(showPay).catch(function (e) {
      toast(e && e.code === 'LIMIT_REACHED' ? 'Đã hết lượt mua món này' : 'Không tạo được đơn (offline?)');
    });
  }

  // ---------- Thanh toán QR ----------
  function showPay(o) {
    var q = o.qr || {};
    var h = (o.sandbox ? '<div class="sandbox">🧪 SANDBOX — thanh toán giả lập, không trừ tiền thật</div>' : '') +
      (q.imageUrl ? '<img class="qr" alt="QR chuyển khoản" src="' + esc(q.imageUrl) + '">' : '') +
      '<div class="pay-info">Ngân hàng: <b>' + esc(q.bank) + '</b><br>Số TK: <b>' + esc(q.account) + '</b><br>Số tiền: <b>' + vnd(q.amount || o.amount) +
      '</b><br>Nội dung CK: <b class="code">' + esc(q.content || o.code) + '</b></div>' +
      '<div class="pf-sub" id="payStatus">⏳ Đang chờ thanh toán…</div>' +
      (o.sandbox ? '<button class="btn sec" id="sandboxPay">Giả lập thanh toán</button>' : '');
    $('payBody').innerHTML = h;
    $('payOv').classList.add('show');
    var sp = $('sandboxPay');
    if (sp) sp.addEventListener('click', function () {
      sp.disabled = true;
      api('POST', '/v1/pay/sandbox/confirm', { orderId: o.orderId }).then(function () { poll(o.orderId, true); })
        .catch(function () { sp.disabled = false; toast('Giả lập thất bại'); });
    });
    poll(o.orderId);
  }
  function stopPoll() { clearTimeout(pollTmr); pollTmr = null; }
  function poll(id, now) {
    stopPoll();
    pollTmr = setTimeout(function () {
      api('GET', '/v1/orders/' + encodeURIComponent(id)).then(function (r) {
        var st = $('payStatus');
        if (r && r.status === 'paid') { if (st) st.textContent = '✅ Đã thanh toán — đồ đã vào tài khoản'; toast('✅ Thanh toán thành công'); stopPoll(); refresh(); loadShop(); return; }
        if (r && r.status === 'expired') { if (st) st.textContent = '⌛ Đơn đã hết hạn'; stopPoll(); return; }
        poll(id);
      }).catch(function () { poll(id); });
    }, now ? 300 : 3000);
  }

  E._test = { renderProfile: renderProfile, showPay: showPay, loadShop: loadShop, poll: poll };
  window.__arcadeOnReadyEconomy = refresh;
  renderWallet();
})();
