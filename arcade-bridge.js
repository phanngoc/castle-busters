/* arcade-bridge.js — nối game với platform Arcade.
   Nguyên tắc: platform là BỔ SUNG, không phải phụ thuộc. Platform chết thì game
   vẫn chơi được y như cũ bằng localStorage. Mọi lời gọi ở đây đều nuốt lỗi. */
(function () {
  'use strict';
  var GAME_ID = window.ARCADE_GAME_ID;
  var api = null, ready = false;

  function noop() {}
  var G = window.ArcadeGame = {
    onScore: noop, syncSave: noop, top: function () { return Promise.resolve([]); },
    ready: false, playerId: null,
  };

  if (!window.Arcade || !GAME_ID) return;   // chạy standalone: không có SDK thì thôi

  window.Arcade.init({ gameId: GAME_ID }).then(function (a) {
    api = a; ready = true; G.ready = true; G.playerId = a.playerId;

    // extra (vd {matchId}) đi kèm body: bảng 'standard' của castle bắt buộc matchId của trận Đấu Chuẩn.
    G.onScore = function (board, score, name, extra) {
      if (!ready || typeof score !== 'number' || score <= 0) return;
      if (extra) {
        api.req('POST', '/v1/leaderboard/' + encodeURIComponent(board), Object.assign({ score: Math.trunc(score), name: name }, extra)).catch(noop);
        return;
      }
      api.leaderboard(board).submit(Math.trunc(score), name).catch(noop);
    };
    G.syncSave = function (obj) {
      if (!ready) return;
      api.save.set(obj).catch(noop);        // ghi đè: game là nguồn chân lý trong phiên này
    };
    G.top = function (board, n) {
      if (!ready) return Promise.resolve([]);
      return api.leaderboard(board).top(n || 10).catch(function () { return []; });
    };
    G.track = function (n, p) { if (ready) api.track(n, p); };
    // REST tới platform (profile/match/upgrade/shop/orders) — trả body, lỗi mang .code.
    G.api = function (method, path, body) { return api.req(method, path, body).then(function (r) { return r.body; }); };

    // Kéo save từ platform về (chơi máy khác). Game tự quyết dùng hay không.
    api.save.get().then(function (doc) {
      if (doc && doc.data && typeof window.__arcadeApplyRemote === 'function') {
        try { window.__arcadeApplyRemote(doc.data); } catch (e) {}
      }
    }).catch(noop);

    if (typeof window.__arcadeOnReadyEconomy === 'function') { try { window.__arcadeOnReadyEconomy(); } catch (e) {} }
    if (typeof window.__arcadeOnReady === 'function') { try { window.__arcadeOnReady(); } catch (e) {} }
  }).catch(noop);
})();
