/* Castle Busters — web clone (canvas). Vanilla JS, no deps.
   Core loop: deploy troops that clash mid-field + fire arcing cannonballs that
   smash destructible brick castles. 60s round; lowest-HP castle loses. */
(function () {
  'use strict';

  var cv = document.getElementById('game');
  var ctx = cv.getContext('2d');
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  // ---- tunables ----
  var GRAV = 1500;            // px/s^2 for cannonballs & falling bricks
  var RULES = window.CastleRules;          // rules.js — luật thuần, có unit test
  var ROUND = RULES.ROUND;                 // seconds
  var ENERGY_MAX = RULES.ENERGY_MAX;
  var CANNON_CD = 0.9;       // seconds
  var CANNON_DMG = 3;        // >= BRICK_HP so a direct hit shatters bricks
  var BRICK_HP = 2;
  var COMBO_WINDOW = 2.6;    // seconds to keep a scoring combo alive

  var UNIT_TYPES = {
    rusher: { name: 'Kỵ binh', ic: '🐎', cost: 2, hp: 6, dmg: 1, atkCd: 0.4, speed: 132, range: 20, kind: 'melee', r: 12, col: '#ffd27a' },
    knight: { name: 'Kiếm sĩ', ic: '🛡️', cost: 2, hp: 12, dmg: 2, atkCd: 0.5, speed: 76, range: 20, kind: 'melee', r: 13, col: '#cfd8e6' },
    archer: { name: 'Cung thủ', ic: '🏹', cost: 3, hp: 8, dmg: 1, atkCd: 0.75, speed: 64, range: 150, kind: 'ranged', r: 12, col: '#a7e0a0' },
    bomber: { name: 'Pháo thủ', ic: '💣', cost: 4, hp: 8, dmg: 3, atkCd: 1.5, speed: 52, range: 250, kind: 'artillery', r: 14, col: '#c9a0ff' },
    giant:  { name: 'Khổng lồ', ic: '🪓', cost: 5, hp: 42, dmg: 3, atkCd: 0.95, speed: 44, range: 24, kind: 'melee', r: 20, col: '#e6b57a' }
  };
  var CARD_ORDER = ['rusher', 'knight', 'archer', 'bomber', 'giant'];

  // ---- progression (persisted) ----
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var LEVEL = clamp(parseInt(lsGet('cb_level', '1'), 10) || 1, 1, 20);
  var BEST = parseInt(lsGet('cb_best', '0'), 10) || 0;

  // Platform trả save về sau khi khởi động. Lấy giá trị TỐT HƠN giữa local và
  // remote, không ghi đè mù — người chơi offline một lúc rồi mới online lại
  // thì tiến độ offline không được biến mất.
  window.__arcadeApplyRemote = function (d) {
    if (!d) return;
    if (typeof d.best === 'number' && d.best > BEST) { BEST = d.best; lsSet('cb_best', String(BEST)); }
    if (typeof d.level === 'number' && d.level > LEVEL) {
      LEVEL = clamp(d.level, 1, 20); lsSet('cb_level', String(LEVEL));
    }
  };

  // ---- audio (tiny Web Audio SFX) ----
  var AC = null, muted = (lsGet('cb_mute', '0') === '1');
  function initAudio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); }
  function tone(freq, dur, type, gain, slideTo) {
    if (!AC || muted) return;
    var o = AC.createOscillator(), g = AC.createGain(), t0 = AC.currentTime;
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain || 0.15, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, gain) {
    if (!AC || muted) return;
    var n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = AC.createBufferSource(); src.buffer = buf;
    var g = AC.createGain(); g.gain.value = gain || 0.2;
    var f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(AC.destination); src.start();
  }
  function sfx(kind) {
    if (!AC || muted) return;
    if (kind === 'fire') { tone(220, 0.18, 'sawtooth', 0.12, 520); }
    else if (kind === 'boom') { noise(0.28, 0.28); tone(90, 0.22, 'square', 0.14, 45); }
    else if (kind === 'deploy') { tone(520, 0.1, 'square', 0.1, 720); }
    else if (kind === 'hit') { tone(300, 0.06, 'square', 0.06); }
    else if (kind === 'win') { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { tone(f, 0.18, 'triangle', 0.16); }, i * 110); }); }
    else if (kind === 'lose') { [400, 320, 240, 160].forEach(function (f, i) { setTimeout(function () { tone(f, 0.2, 'sawtooth', 0.14); }, i * 130); }); }
  }

  // ---- world / state ----
  var W = 0, H = 0, groundY = 0, brickW = 20, brickH = 15;
  var S = null; // game state

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- layout / resize ----------
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    groundY = H - clamp(Math.round(H * 0.2), 140, 210);
    brickW = clamp(Math.round(W * 0.055), 16, 30);
    brickH = Math.round(brickW * 0.72);
    if (S) layoutCastles();
  }

  // castle: { side, cols:[{x, bricks:[{hp,y,vy,flash}]}], total }
  function buildCastle(side) {
    var heights = RULES.CASTLE_HEIGHTS;          // silhouette — skin KHÔNG đổi số gạch
    var n = heights.length;
    var castle = { side: side, cols: [], total: 0, dead: false };
    for (var i = 0; i < n; i++) {
      var bricks = [];
      for (var k = 0; k < heights[i]; k++) bricks.push({ hp: BRICK_HP, y: 0, vy: 0, flash: 0 });
      castle.cols.push({ x: 0, bricks: bricks, heights0: heights[i] });
      castle.total += heights[i];
    }
    castle.aliveMax = castle.total;
    return castle;
  }
  function layoutCastles() {
    var n = S.left.cols.length;
    var margin = Math.max(10, W * 0.03);
    for (var i = 0; i < n; i++) {
      S.left.cols[i].x = margin + i * brickW;
      S.right.cols[i].x = W - margin - brickW - i * brickW;
    }
    // set resting y for all bricks
    [S.left, S.right].forEach(function (c) {
      c.cols.forEach(function (col) {
        for (var j = 0; j < col.bricks.length; j++) col.bricks[j].y = groundY - (j + 1) * brickH;
      });
    });
    // cannon positions (in front / on top of own castle)
    S.left.innerEdge = S.left.cols[n - 1].x + brickW;
    S.right.innerEdge = S.right.cols[n - 1].x;
    S.cannonP = { x: S.left.cols[0].x + brickW * 1.0, y: groundY - (8 * brickH) - 6 };
    S.cannonE = { x: S.right.cols[0].x, y: groundY - (8 * brickH) - 6 };
  }

  function castleHP(c) {
    var alive = 0;
    for (var i = 0; i < c.cols.length; i++) alive += c.cols[i].bricks.length;
    return alive / c.aliveMax;
  }

  // ---------- damage ----------
  // returns number of bricks destroyed (0 => nothing in range)
  function damageArea(castle, hx, hy, dmg, radius) {
    var destroyed = 0, touched = 0;
    for (var i = 0; i < castle.cols.length; i++) {
      var col = castle.cols[i];
      for (var j = col.bricks.length - 1; j >= 0; j--) {
        var b = col.bricks[j];
        var bx = col.x + brickW / 2, by = b.y + brickH / 2;
        var dx = bx - hx, dy = by - hy;
        if (dx * dx + dy * dy <= radius * radius) {
          b.hp -= dmg; b.flash = 0.12; touched++;
          if (b.hp <= 0) { col.bricks.splice(j, 1); destroyed++; debris(bx, by, castle.side === 'L' ? '#8fb7ff' : '#ffb08f', 8); }
        }
      }
    }
    return { destroyed: destroyed, touched: touched };
  }
  function damageColumnBase(castle, colIndex, dmg) {
    var col = castle.cols[colIndex];
    if (!col || !col.bricks.length) return;
    var b = col.bricks[0];
    b.hp -= dmg; b.flash = 0.12;
    if (b.hp <= 0) { col.bricks.splice(0, 1); debris(col.x + brickW / 2, groundY - brickH / 2, castle.side === 'L' ? '#8fb7ff' : '#ffb08f', 6); }
  }
  function frontColumn(castle) { // nearest alive column to the enemy (inner side)
    var cols = castle.cols, n = cols.length;
    if (castle.side === 'R') { for (var i = 0; i < n; i++) if (cols[i].bricks.length) return i; }
    else { for (var j = n - 1; j >= 0; j--) if (cols[j].bricks.length) return j; }
    return -1;
  }

  // ---------- particles ----------
  function debris(x, y, col, count) {
    for (var i = 0; i < count; i++) S.parts.push({ x: x, y: y, vx: rand(-140, 140), vy: rand(-260, -40), life: rand(0.4, 0.9), col: col, s: rand(3, 7), g: 1 });
  }
  function puff(x, y, col, count, spd) {
    for (var i = 0; i < count; i++) S.parts.push({ x: x, y: y, vx: rand(-spd, spd), vy: rand(-spd, spd), life: rand(0.25, 0.55), col: col, s: rand(3, 6), g: 0 });
  }
  function floatText(x, y, txt, col) { S.floats.push({ x: x, y: y, txt: txt, col: col, life: 0.9 }); }

  // ---------- entities ----------
  function spawnUnit(side, type) {
    var lv = S.lv ? S.lv[side === 'L' ? 'L' : 'R'][type] : 1;
    var t = RULES.scaleUnit(UNIT_TYPES[type], lv);   // cấp quân: chỉ máu & sát thương
    var dir = side === 'L' ? 1 : -1;
    var x = side === 'L' ? (S.left.innerEdge + 8) : (S.right.innerEdge - 8);
    S.units.push({ side: side, type: type, t: t, x: x, y: groundY - t.r, hp: t.hp, hpMax: t.hp, dir: dir, cd: 0, bob: rand(0, 6.28) });
  }
  function fireCannon(side, tx, ty) {
    var src = side === 'L' ? S.cannonP : S.cannonE;
    tx = clamp(tx, brickW, W - brickW); ty = clamp(ty, 10, groundY);
    var T = clamp(Math.abs(tx - src.x) / 360, 0.55, 1.5);
    var vx = (tx - src.x) / T;
    var vy = (ty - src.y - 0.5 * GRAV * T * T) / T;
    S.balls.push({ side: side, kind: 'cannon', x: src.x, y: src.y, vx: vx, vy: vy, r: Math.max(8, brickH * 0.5), dmg: CANNON_DMG, life: 4 });
    puff(src.x, src.y, '#ffe6a3', 8, 120);
    S.shake = Math.max(S.shake, 3);
    if (side === 'L') { S.aimAngle = Math.atan2(vy, vx); sfx('fire'); }
  }
  // bomber lobs a bomb at (tx,ty); reuses the ball pipeline (kind 'bomb')
  function lobBomb(un, tx, ty) {
    var T = clamp(Math.abs(tx - un.x) / 300, 0.5, 1.3);
    var vx = (tx - un.x) / T, vy = (ty - (un.y - un.t.r) - 0.5 * GRAV * T * T) / T;
    S.balls.push({ side: un.side, kind: 'bomb', x: un.x, y: un.y - un.t.r, vx: vx, vy: vy, r: Math.max(6, brickH * 0.38), dmg: un.t.dmg, life: 3 });
  }
  function scoreHit(x, y, destroyed, combos) {
    if (!destroyed) return;
    if (combos) { S.combo++; S.comboTmr = COMBO_WINDOW; }
    var mult = combos ? clamp(S.combo, 1, 9) : 1;
    var pts = destroyed * 10 * mult;
    S.score += pts;
    floatText(x, y - 14, '+' + pts + (combos && S.combo >= 2 ? '  x' + S.combo : ''), '#fff3a0');
  }
  function resetCombo() { S.combo = 0; S.comboTmr = 0; }

  // ---------- input: press-drag-release aiming with live trajectory ----------
  function aimStart(x, y) {
    if (!S || !S.running || S.over) return;
    initAudio();
    S.aim = { x: x, y: y, ok: true };
  }
  function aimMove(x, y) { if (S && S.aim) { S.aim.x = x; S.aim.y = y; } }
  function aimEnd() {
    if (!S || !S.aim) return;
    var a = S.aim; S.aim = null;
    if (!S.running || S.over) return;
    if (S.cannonCd > 0) { flashHint('Đại bác đang hồi…'); return; }
    if (a.x < W * 0.4) { flashHint('Chạm/kéo phía địch (bên phải) để bắn 💥'); return; }
    fireCannon('L', a.x, a.y);
    S.cannonCd = CANNON_CD;
  }
  cv.addEventListener('pointerdown', function (e) { e.preventDefault(); aimStart(e.clientX, e.clientY); });
  cv.addEventListener('pointermove', function (e) { if (S && S.aim) { e.preventDefault(); aimMove(e.clientX, e.clientY); } });
  window.addEventListener('pointerup', function (e) { aimEnd(); });
  cv.addEventListener('pointercancel', function () { if (S) S.aim = null; });

  var hintEl = document.getElementById('hint'), hintTmr = 0;
  function flashHint(txt) { hintEl.textContent = txt; hintEl.style.opacity = '1'; hintTmr = 1.4; }

  // ---------- cards ----------
  function buildCards() {
    var host = document.getElementById('cards'); host.innerHTML = '';
    S.cardEls = {};
    CARD_ORDER.forEach(function (key) {
      var t = UNIT_TYPES[key];
      var el = document.createElement('div'); el.className = 'card';
      el.innerHTML = '<div class="ic">' + t.ic + '</div><div class="nm">' + t.name + '</div><div class="cost">⚡' + t.cost + '</div><div class="cd"></div>';
      el.addEventListener('pointerdown', function (e) { e.preventDefault(); tryDeploy(key); });
      host.appendChild(el);
      S.cardEls[key] = el;
    });
  }
  function tryDeploy(key) {
    if (!S.running || S.over) return;
    initAudio();
    var t = UNIT_TYPES[key];
    if (S.energy < t.cost) { flashHint('Chưa đủ năng lượng ⚡'); return; }
    S.energy -= t.cost;
    spawnUnit('L', key);
    sfx('deploy');
    S.cardEls[key].animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 200 });
  }

  // ---------- AI ----------
  function updateAI(dt) {
    var ai = S.ai, k = S.aiSkill; // 0..1 skill scaling from level
    ai.energy = Math.min(ENERGY_MAX, ai.energy + RULES.energyRate(S.time, S.overtime) * dt);
    ai.deployTmr -= dt; ai.fireTmr -= dt;
    if (ai.deployTmr <= 0) {
      // mối đe doạ = lính người chơi đi xa nhất (gần lâu đài AI nhất)
      var threat = null, tx0 = -1;
      for (var q = 0; q < S.units.length; q++) { var pu = S.units[q]; if (pu.side === 'L' && pu.hp > 0 && pu.x > tx0) { tx0 = pu.x; threat = pu.type; } }
      var costs = {}; CARD_ORDER.forEach(function (key) { costs[key] = UNIT_TYPES[key].cost; });
      var choice = RULES.aiPick(CARD_ORDER, ai.energy, threat, k, costs);
      if (choice.pick) { ai.energy -= UNIT_TYPES[choice.pick].cost; spawnUnit('R', choice.pick); }
      ai.deployTmr = choice.wait ? 0.4 : rand(4.2 - 3.2 * k, 6.0 - 4.4 * k);   // màn thấp: ra lính chậm, phí năng lượng ở trần
    }
    if (ai.fireTmr <= 0) {
      var fi = frontColumn(S.left);
      if (fi >= 0) {
        var col = S.left.cols[fi];
        var scatter = brickW * (2.4 - 2.15 * k); // màn 1 bắn trượt nhiều, màn 20 gần như trúng
        var tx = col.x + brickW / 2 + rand(-scatter, scatter);
        var ty = groundY - (col.bricks.length) * brickH * rand(0.35, 0.95);
        fireCannon('R', tx, ty);
      }
      ai.fireTmr = rand(4.5 - 3.5 * k, 6.5 - 5.2 * k);
    }
  }

  // ---------- update ----------
  function update(dt) {
    if (!S.running || S.over) return;
    S.time -= dt; if (S.time < 0) S.time = 0;
    S.energy = Math.min(ENERGY_MAX, S.energy + RULES.energyRate(S.time, S.overtime) * dt);
    if (!S.overtime && !S.finalRush && S.time <= RULES.FINAL_SECS) { S.finalRush = true; flashHint('⚡ x2 NĂNG LƯỢNG — 15 giây cuối!'); }
    S.cannonCd = Math.max(0, S.cannonCd - dt);
    if (S.comboTmr > 0) { S.comboTmr -= dt; if (S.comboTmr <= 0) S.combo = 0; }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 24);
    updateAI(dt);

    // ---- bricks settle (collapse) ----
    [S.left, S.right].forEach(function (c) {
      c.cols.forEach(function (col) {
        for (var j = 0; j < col.bricks.length; j++) {
          var b = col.bricks[j];
          var target = groundY - (j + 1) * brickH;
          if (b.y < target - 0.5) {
            b.vy += GRAV * dt; b.y += b.vy * dt;
            if (b.y >= target) { b.y = target; if (b.vy > 200) { puff(col.x + brickW / 2, target + brickH / 2, '#00000030', 3, 40); } b.vy = 0; }
          } else { b.y = target; b.vy = 0; }
          if (b.flash > 0) b.flash -= dt;
        }
      });
    });

    // ---- cannonballs ----
    for (var i = S.balls.length - 1; i >= 0; i--) {
      var ball = S.balls[i];
      var steps = 3; var sdt = dt / steps; var gone = false;
      for (var s = 0; s < steps && !gone; s++) {
        ball.vy += GRAV * sdt; ball.x += ball.vx * sdt; ball.y += ball.vy * sdt; ball.life -= sdt;
        var target = ball.side === 'L' ? S.right : S.left;
        var res = damageArea(target, ball.x, ball.y, ball.dmg, ball.r + brickW * (ball.kind === 'bomb' ? 0.5 : 0.6));
        if (res.touched > 0) {
          var big = ball.kind !== 'bomb';
          puff(ball.x, ball.y, '#ffd98a', big ? 16 : 10, 220); S.shake = Math.max(S.shake, big ? 9 : 5); sfx('boom');
          if (ball.side === 'L') scoreHit(ball.x, ball.y, res.destroyed, ball.kind === 'cannon');
          else floatText(ball.x, ball.y - 10, big ? 'BÙM!' : '💥', '#ffd34d');
          gone = true;
        } else if (ball.y >= groundY - 2) { puff(ball.x, groundY, '#caa66a', 10, 120); S.shake = Math.max(S.shake, 4); if (ball.side === 'L' && ball.kind === 'cannon') resetCombo(); gone = true; }
        else if (ball.x < -30 || ball.x > W + 30 || ball.life <= 0) gone = true;
      }
      if (gone) S.balls.splice(i, 1);
    }

    // ---- units ----
    for (var u = S.units.length - 1; u >= 0; u--) {
      var un = S.units[u];
      if (un.hp <= 0) { puff(un.x, un.y, un.t.col, 10, 160); floatText(un.x, un.y - un.t.r, '✕', '#fff'); S.units.splice(u, 1); continue; }
      un.cd = Math.max(0, un.cd - dt); un.bob += dt * 8;
      var enemyCastle = un.side === 'L' ? S.right : S.left;

      // artillery (bomber): march to standoff range, then lob bombs at the castle
      if (un.t.kind === 'artillery') {
        var afi = frontColumn(enemyCastle);
        var acx = afi >= 0 ? (un.side === 'L' ? enemyCastle.cols[afi].x : enemyCastle.cols[afi].x + brickW) : (un.side === 'L' ? W : 0);
        if (Math.abs(acx - un.x) <= un.t.range && afi >= 0) {
          if (un.cd <= 0) {
            un.cd = un.t.atkCd;
            var acol = enemyCastle.cols[afi];
            var ty2 = acol.bricks.length ? acol.bricks[acol.bricks.length - 1].y : groundY - brickH;
            lobBomb(un, acol.x + brickW / 2, ty2 + brickH / 2);
          }
        } else un.x += un.dir * un.t.speed * dt;
        continue;
      }

      // find nearest opposing unit ahead
      var foe = null, foeDist = 1e9;
      for (var v = 0; v < S.units.length; v++) {
        var o = S.units[v]; if (o.side === un.side || o.hp <= 0) continue;
        var d = (o.x - un.x) * un.dir; // ahead if positive
        if (d >= -un.t.r && d < foeDist) { foeDist = d; foe = o; }
      }
      var reach = un.t.kind === 'ranged' ? un.t.range : (un.t.r + 14);

      if (foe && foeDist <= reach) {
        // engage foe
        if (un.cd <= 0) {
          un.cd = un.t.atkCd;
          if (un.t.kind === 'ranged') shootArrow(un, foe.x, foe.y);
          else { foe.hp -= un.t.dmg; puff((un.x + foe.x) / 2, un.y, '#fff2', 4, 60); }
        }
      } else {
        // advance toward enemy castle
        var fi = frontColumn(enemyCastle);
        var castleFrontX = fi >= 0 ? (un.side === 'L' ? enemyCastle.cols[fi].x : enemyCastle.cols[fi].x + brickW) : (un.side === 'L' ? W : 0);
        var distCastle = (castleFrontX - un.x) * un.dir;
        if (distCastle <= reach && fi >= 0) {
          if (un.cd <= 0) {
            un.cd = un.t.atkCd;
            if (un.t.kind === 'ranged') { var col = enemyCastle.cols[fi]; shootArrowAtCastle(un, col.x + brickW / 2, col.bricks.length ? col.bricks[col.bricks.length - 1].y + brickH / 2 : groundY); }
            else { damageColumnBase(enemyCastle, fi, un.t.dmg); puff(castleFrontX, groundY - brickH, '#fff3', 5, 70); }
          }
        } else {
          un.x += un.dir * un.t.speed * dt;
        }
      }
    }

    // ---- arrows ----
    for (var a = S.arrows.length - 1; a >= 0; a--) {
      var ar = S.arrows[a];
      ar.vy += GRAV * 0.35 * dt; ar.x += ar.vx * dt; ar.y += ar.vy * dt; ar.life -= dt;
      var hitUnit = false;
      if (ar.targetUnit) {
        for (var w = 0; w < S.units.length; w++) {
          var tu = S.units[w]; if (tu.side === ar.side || tu.hp <= 0) continue;
          if (Math.abs(tu.x - ar.x) < tu.t.r && Math.abs(tu.y - ar.y) < tu.t.r) { tu.hp -= ar.dmg; puff(ar.x, ar.y, '#fff', 4, 60); hitUnit = true; break; }
        }
      } else {
        var tc = ar.side === 'L' ? S.right : S.left;
        var ares = damageArea(tc, ar.x, ar.y, ar.dmg, brickW * 0.5);
        if (ares.touched > 0) { puff(ar.x, ar.y, '#ffd98a', 4, 80); if (ar.side === 'L' && ares.destroyed) S.score += ares.destroyed * 10; hitUnit = true; }
      }
      if (hitUnit || ar.y >= groundY || ar.x < -20 || ar.x > W + 20 || ar.life <= 0) S.arrows.splice(a, 1);
    }

    // ---- particles / floats ----
    for (var p = S.parts.length - 1; p >= 0; p--) {
      var pt = S.parts[p]; pt.life -= dt; if (pt.g) pt.vy += GRAV * 0.6 * dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      if (pt.life <= 0) S.parts.splice(p, 1);
    }
    for (var f = S.floats.length - 1; f >= 0; f--) { var fl = S.floats[f]; fl.life -= dt; fl.y -= 30 * dt; if (fl.life <= 0) S.floats.splice(f, 1); }

    // ---- win check ----
    var hpL = castleHP(S.left), hpR = castleHP(S.right);
    S.hpL = hpL; S.hpR = hpR;
    if (hpR <= 0.0001) endGame('win', true);
    else if (hpL <= 0.0001) endGame('lose', true);
    else if (S.overtime) {
      var bl = bricks(S.left), br = bricks(S.right);
      var r = RULES.resolveOvertime({ lostL: S.otStart.L - bl, lostR: S.otStart.R - br, bricksL: bl, bricksR: br,
        hpSumL: brickHpSum(S.left), hpSumR: brickHpSum(S.right), timeLeft: S.time });
      if (r) endGame(r, false);
    } else if (S.time <= 0) {
      var tr = RULES.resolveTimeUp(bricks(S.left), bricks(S.right));
      if (tr === 'overtime') {
        S.overtime = true; S.overtimeUsed = true; S.time = RULES.OT_SECS;
        S.otStart = { L: bricks(S.left), R: bricks(S.right) };
        flashHint('⏱️ HIỆP PHỤ x3 ⚡ — mất gạch trước là thua!');
      } else endGame(tr, false);
    }
  }

  function bricks(c) { var n = 0; for (var i = 0; i < c.cols.length; i++) n += c.cols[i].bricks.length; return n; }
  function brickHpSum(c) { var n = 0; for (var i = 0; i < c.cols.length; i++) for (var j = 0; j < c.cols[i].bricks.length; j++) n += c.cols[i].bricks[j].hp; return n; }

  function shootArrow(un, tx, ty) {
    var T = 0.5; var vx = (tx - un.x) / T; var vy = (ty - un.y - 0.5 * (GRAV * 0.35) * T * T) / T;
    S.arrows.push({ side: un.side, x: un.x, y: un.y - un.t.r, vx: vx, vy: vy, dmg: un.t.dmg, life: 1.5, targetUnit: true });
  }
  function shootArrowAtCastle(un, tx, ty) {
    var T = clamp(Math.abs(tx - un.x) / 300, 0.35, 1.1); var vx = (tx - un.x) / T; var vy = (ty - un.y - 0.5 * (GRAV * 0.35) * T * T) / T;
    S.arrows.push({ side: un.side, x: un.x, y: un.y - un.t.r, vx: vx, vy: vy, dmg: un.t.dmg, life: 2, targetUnit: false });
  }

  // ---------- render ----------
  function drawCastle(c, flagCol) {
    for (var i = 0; i < c.cols.length; i++) {
      var col = c.cols[i];
      for (var j = 0; j < col.bricks.length; j++) {
        var b = col.bricks[j];
        var x = col.x, y = b.y;
        var t = b.hp / BRICK_HP;
        // base stone colour, darker when damaged
        var sk = c.side === 'L' ? SKIN : RULES.SKINS.default;
        var base = sk[c.side];
        var shade = 0.55 + 0.45 * t;
        ctx.fillStyle = 'rgb(' + Math.round(base[0] * shade) + ',' + Math.round(base[1] * shade) + ',' + Math.round(base[2] * shade) + ')';
        roundRect(x + 1, y + 1, brickW - 2, brickH - 2, 3); ctx.fill();
        // mortar highlight
        ctx.fillStyle = sk.mortar; ctx.fillRect(x + 2, y + 2, brickW - 4, 2);
        skinDetail(sk.pattern, x, y);
        if (b.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (b.flash / 0.12 * 0.6) + ')'; roundRect(x + 1, y + 1, brickW - 2, brickH - 2, 3); ctx.fill(); }
      }
      // flag on the middle (tallest) column
      if (i === ((c.cols.length - 1) >> 1) && col.bricks.length) {
        var topY = col.bricks[col.bricks.length - 1].y;
        var fx = col.x + brickW / 2;
        ctx.strokeStyle = '#5b4636'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, topY); ctx.lineTo(fx, topY - 20); ctx.stroke();
        ctx.fillStyle = flagCol; ctx.beginPath(); ctx.moveTo(fx, topY - 20); ctx.lineTo(fx + 14, topY - 16); ctx.lineTo(fx, topY - 12); ctx.closePath(); ctx.fill();
      }
    }
  }
  // Hoạ tiết skin: chỉ vẽ trong ô gạch, không đổi hitbox.
  function skinDetail(pat, x, y) {
    if (pat === 'ice') {
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x + brickW * 0.25, y + 3); ctx.lineTo(x + brickW * 0.45, y + brickH * 0.6); ctx.lineTo(x + brickW * 0.7, y + brickH - 3); ctx.stroke();
    } else if (pat === 'redstone') {
      ctx.fillStyle = 'rgba(255,90,40,.55)'; ctx.fillRect(x + brickW * 0.3, y + brickH * 0.45, 3, 3); ctx.fillRect(x + brickW * 0.65, y + brickH * 0.25, 2, 2);
    } else if (pat === 'bamboo') {
      ctx.fillStyle = 'rgba(60,80,20,.45)'; ctx.fillRect(x + brickW * 0.33, y + 1, 1.5, brickH - 2); ctx.fillRect(x + brickW * 0.66, y + 1, 1.5, brickH - 2);
      ctx.fillRect(x + 1, y + brickH * 0.5, brickW - 2, 1);
    }
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawUnit(un) {
    var bobY = Math.sin(un.bob) * 2;
    var x = un.x, y = un.y + bobY, r = un.t.r;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x, groundY + 2, r * 0.9, r * 0.35, 0, 0, 6.29); ctx.fill();
    // body
    ctx.fillStyle = un.side === 'L' ? un.t.col : shiftRed(un.t.col);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
    ctx.strokeStyle = un.side === 'L' ? '#2b6fae' : '#a83232'; ctx.lineWidth = 2.5; ctx.stroke();
    // icon
    ctx.font = (r * 1.25 | 0) + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(un.t.ic, x, y + 1);
    // hp pip
    var hpw = r * 1.6, hp = un.hp / un.hpMax;
    ctx.fillStyle = '#0007'; ctx.fillRect(x - hpw / 2, y - r - 7, hpw, 4);
    ctx.fillStyle = hp > 0.4 ? '#7fe08a' : '#ff6b6b'; ctx.fillRect(x - hpw / 2, y - r - 7, hpw * hp, 4);
  }
  function shiftRed(hex) { return hex; }

  function render() {
    ctx.save();
    if (S && S.shake > 0.3) ctx.translate(rand(-S.shake, S.shake), rand(-S.shake, S.shake));
    // sky
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#8fd3ff'); g.addColorStop(0.7, '#bfe9ff'); g.addColorStop(1, '#e7f7e0');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    // distant hills
    ctx.fillStyle = '#a7d7a0'; hill(0.2, 0.62); hill(0.55, 0.66); hill(0.85, 0.6);
    // ground
    ctx.fillStyle = '#6bbf59'; ctx.fillRect(-20, groundY, W + 40, H - groundY + 40);
    ctx.fillStyle = '#5aa84a'; ctx.fillRect(-20, groundY, W + 40, 6);

    if (S) {
      drawCastle(S.left, '#3aa0ff');
      drawCastle(S.right, '#ff4d4d');
      // cannons (player barrel tracks the aim / last shot)
      var pAng = S.aim ? Math.atan2(S.aim.y - S.cannonP.y, S.aim.x - S.cannonP.x) : (S.aimAngle != null ? S.aimAngle : -0.85);
      drawCannon(S.cannonP, '#2b7fe0', S.cannonCd > 0, pAng);
      drawCannon(S.cannonE, '#c23030', false, -2.25);
      S.units.forEach(drawUnit);
      if (S.aim && S.running && !S.over) drawAimPreview();
      // arrows
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2.5;
      S.arrows.forEach(function (ar) { var a = Math.atan2(ar.vy, ar.vx); ctx.save(); ctx.translate(ar.x, ar.y); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(6, 0); ctx.stroke(); ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(2, -3); ctx.lineTo(2, 3); ctx.fill(); ctx.restore(); });
      // cannonballs & bombs
      S.balls.forEach(function (b) {
        var isBomb = b.kind === 'bomb';
        ctx.fillStyle = isBomb ? '#33204d' : '#2b2b33'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.29); ctx.fill();
        ctx.fillStyle = isBomb ? '#7a52a8' : '#5a5a66'; ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.35, 0, 6.29); ctx.fill();
        if (isBomb) { ctx.strokeStyle = '#ffce54'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(b.x, b.y - b.r); ctx.lineTo(b.x + 3, b.y - b.r - 4); ctx.stroke(); }
      });
      // particles
      S.parts.forEach(function (p) { ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.s, p.s); });
      ctx.globalAlpha = 1;
      // floats
      S.floats.forEach(function (f) { ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillStyle = f.col; ctx.font = '900 18px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.txt, f.x, f.y); });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    drawHudText();
  }
  function hill(cx, cy) { ctx.beginPath(); ctx.ellipse(W * cx, H * cy, W * 0.42, H * 0.16, 0, 0, 6.29); ctx.fill(); }
  function drawCannon(pos, col, cooling, angle) {
    ctx.save(); ctx.translate(pos.x, pos.y);
    // barrel (behind the hub)
    ctx.save(); ctx.rotate(angle || 0);
    ctx.fillStyle = '#242430'; roundRect(0, -5, 24, 10, 4); ctx.fill();
    ctx.fillStyle = '#3a3a48'; roundRect(20, -5, 5, 10, 3); ctx.fill();
    ctx.restore();
    // hub
    ctx.fillStyle = col; roundRect(-13, -10, 26, 19, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; roundRect(-13, -10, 26, 6, 6); ctx.fill();
    if (cooling) { ctx.fillStyle = 'rgba(0,0,0,.4)'; roundRect(-13, -10, 26, 19, 6); ctx.fill(); }
    ctx.restore();
  }
  function drawAimPreview() {
    var a = S.aim; if (a.x < W * 0.4) return;
    var src = S.cannonP;
    var tx = clamp(a.x, brickW, W - brickW), ty = clamp(a.y, 10, groundY);
    var T = clamp(Math.abs(tx - src.x) / 360, 0.55, 1.5);
    var vx = (tx - src.x) / T, vy = (ty - src.y - 0.5 * GRAV * T * T) / T;
    var x = src.x, y = src.y, dtp = 0.032;
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < 46; i++) {
      vy += GRAV * dtp; x += vx * dtp; y += vy * dtp;
      if (y >= groundY || x < 0 || x > W) break;
      if (i % 2 === 0) { ctx.globalAlpha = clamp(1 - i / 46, 0.12, 0.7); ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.29); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = S.cannonCd > 0 ? '#ff7a7a' : '#ffce54'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 11, 0, 6.29); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - 15, ty); ctx.lineTo(tx + 15, ty); ctx.moveTo(tx, ty - 15); ctx.lineTo(tx, ty + 15); ctx.stroke();
  }
  function drawHudText() {
    if (!S) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.font = '900 16px -apple-system,sans-serif'; ctx.fillStyle = '#fff';
    var sTxt = '⭐ ' + S.score;
    ctx.strokeText(sTxt, W / 2, 52); ctx.fillText(sTxt, W / 2, 52);
    if (S.combo >= 2) { ctx.font = '900 13px -apple-system,sans-serif'; ctx.fillStyle = '#ffce54'; var cTxt = 'COMBO x' + S.combo + ' 🔥'; ctx.strokeText(cTxt, W / 2, 73); ctx.fillText(cTxt, W / 2, 73); }
    ctx.textAlign = 'left'; ctx.font = '800 12px -apple-system,sans-serif'; ctx.fillStyle = '#ffffffdd';
    ctx.strokeText('MÀN ' + S.level, 10, 52); ctx.fillText('MÀN ' + S.level, 10, 52);
  }

  // ---------- HUD sync ----------
  var hpPEl = document.getElementById('hpP'), hpEEl = document.getElementById('hpE'),
    timerEl = document.getElementById('timer'), energyEl = document.querySelector('#energy>i'),
    energyNumEl = document.getElementById('energyNum');
  function syncHUD() {
    hpPEl.style.width = (clamp(S.hpL, 0, 1) * 100).toFixed(1) + '%';
    hpEEl.style.width = (clamp(S.hpR, 0, 1) * 100).toFixed(1) + '%';
    var ss = Math.ceil(S.time); timerEl.textContent = (S.overtime ? 'HP ' : '') + Math.floor(ss / 60) + ':' + (ss % 60 < 10 ? '0' : '') + (ss % 60);
    timerEl.classList.toggle('warn', S.time <= 10);
    energyEl.style.width = (S.energy / ENERGY_MAX * 100) + '%';
    energyNumEl.textContent = Math.floor(S.energy) + ' / ' + ENERGY_MAX;
    for (var k in S.cardEls) { var t = UNIT_TYPES[k]; S.cardEls[k].classList.toggle('disabled', S.energy < t.cost); }
  }

  // ---------- loop ----------
  var last = 0, acc = 0;
  function frame(now) {
    if (!last) last = now;
    var dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
    if (S && S.running && !S.over) { update(dt); syncHUD(); }
    if (hintTmr > 0) { hintTmr -= dt; if (hintTmr <= 0) hintEl.style.opacity = '0'; }
    render();
    requestAnimationFrame(frame);
  }

  // ---------- game lifecycle ----------
  // mode: 'campaign' (mặc định) | 'standard' (Đấu Chuẩn: mọi quân cấp 5, bảng 'standard').
  var MODE = 'campaign';
  var SKIN = RULES.SKINS.default;
  function ownedLevels() { return (window.CastleEconomy && CastleEconomy.unitLevels()) || {}; }
  function newGame(mode) {
    if (mode) MODE = mode;
    var skill = RULES.skill(LEVEL);
    SKIN = RULES.skinFor(window.CastleEconomy ? CastleEconomy.skin() : 'default');
    S = {
      running: true, over: false, time: ROUND, energy: RULES.START_ENERGY, overtime: false, overtimeUsed: false, finalRush: false, otStart: null, result: null, cannonCd: 0, shake: 0,
      left: buildCastle('L'), right: buildCastle('R'),
      units: [], balls: [], arrows: [], parts: [], floats: [],
      ai: { energy: RULES.START_ENERGY, deployTmr: rand(1.5, 2.5), fireTmr: rand(2, 3) },
      aiSkill: skill, level: LEVEL, mode: MODE, lv: RULES.matchLevels(MODE, ownedLevels(), LEVEL),
      matchId: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), startedAt: Date.now(),
      score: 0, combo: 0, comboTmr: 0, aim: null, aimAngle: null,
      hpL: 1, hpR: 1, cardEls: null
    };
    layoutCastles();
    buildCards();
    flashHint((MODE === 'standard' ? 'ĐẤU CHUẨN (mọi quân cấp 5)' : 'MÀN ' + LEVEL) + ' — kéo phía địch để ngắm bắn 💥');
  }
  function endGame(result, ko) {
    if (S.over) return;
    S.over = true; S.running = false; S.aim = null; S.result = result;
    var baseScore = S.score;
    S.score = RULES.finalScore(baseScore, result, S.time, !!ko);
    if (S.score > BEST) { BEST = S.score; lsSet('cb_best', String(BEST)); }
    if (window.ArcadeGame) {
      RULES.boardsFor(S.mode).forEach(function (b) {
        ArcadeGame.onScore(b, b === 'daily' ? RULES.dailyScore(S.score, result) : S.score);
      });
      ArcadeGame.syncSave({ level: LEVEL, best: BEST });
    }
    if (window.CastleEconomy) CastleEconomy.reportMatch({ matchId: S.matchId, mode: S.mode, stage: LEVEL, won: result === 'win', durationMs: Date.now() - S.startedAt });
    var leveledUp = false;
    if (S.mode === 'standard') { sfx(result === 'win' ? 'win' : 'lose'); }
    else if (result === 'win') { if (LEVEL < 20) { LEVEL++; leveledUp = true; } lsSet('cb_level', String(LEVEL)); sfx('win'); }
    else sfx('lose');
    var rt = document.getElementById('resultTxt'), st = document.getElementById('endStat');
    rt.className = 'result ' + (result === 'win' ? 'win' : 'lose');
    rt.textContent = result === 'win' ? 'THẮNG! 🎉' : 'THUA 💥';
    st.innerHTML = 'Lâu đài bạn <b>' + Math.round(clamp(S.hpL, 0, 1) * 100) + '%</b> · địch <b>' + Math.round(clamp(S.hpR, 0, 1) * 100) + '%</b>';
    var bonus = S.score - baseScore;
    document.getElementById('endScore').innerHTML = '⭐ Điểm: <b>' + S.score + '</b>' + (bonus ? ' (thưởng +' + bonus + ')' : '') +
      (result === 'lose' ? ' · daily tính ' + RULES.dailyScore(S.score, result) : '') + ' · Kỷ lục: <b>' + BEST + '</b>';
    document.getElementById('endLevel').textContent = S.mode === 'standard' ? 'Đấu Chuẩn — điểm vào bảng Chuẩn' : result === 'win'
      ? (leveledUp ? '⬆️ Lên Màn ' + LEVEL + '!' : 'Màn tối đa — Màn ' + LEVEL)
      : 'Vẫn ở Màn ' + LEVEL + ' — thử lại nhé';
    var nextBtn = document.getElementById('againBtn');
    nextBtn.textContent = S.mode === 'standard' ? 'ĐẤU LẠI ↻' : result === 'win' ? 'MÀN TIẾP ▶' : 'THỬ LẠI ↻';
    document.getElementById('endOv').classList.add('show');
  }

  function refreshStartInfo() {
    var el = document.getElementById('startLevel');
    if (el) el.innerHTML = 'MÀN <b>' + LEVEL + '</b> · Kỷ lục ⭐ <b>' + BEST + '</b>';
  }
  document.getElementById('playBtn').addEventListener('click', function () {
    initAudio();
    document.getElementById('startOv').classList.remove('show');
    newGame('campaign');
  });
  document.getElementById('againBtn').addEventListener('click', function () {
    initAudio();
    document.getElementById('endOv').classList.remove('show');
    newGame();
  });

  var muteBtn = document.getElementById('muteBtn');
  function refreshMute() { if (muteBtn) muteBtn.textContent = muted ? '🔇' : '🔊'; }
  if (muteBtn) muteBtn.addEventListener('click', function (e) { e.preventDefault(); muted = !muted; lsSet('cb_mute', muted ? '1' : '0'); refreshMute(); });
  refreshMute();

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

  // debug hook
  // step/setLevel/deploy/fire: cho test/playtest.js chạy trận giả lập nhanh (không render).
  if (/[?&]debug=1/.test(location.search)) window.__cb = {
    get S() { return S; }, newGame: newGame, RULES: RULES, endGame: endGame, get level() { return LEVEL; },
    setLevel: function (n) { LEVEL = clamp(n | 0, 1, 20); },
    step: function (dt) { if (S && S.running && !S.over) update(dt); },
    deploy: function (k) { tryDeploy(k); },
    fire: function (x, y) { if (S.cannonCd <= 0) { fireCannon('L', x, y); S.cannonCd = CANNON_CD; return true; } return false; },
    frontColumn: function (side) { var c = side === 'R' ? S.right : S.left; var i = frontColumn(c); return i < 0 ? null : { x: c.cols[i].x, n: c.cols[i].bricks.length }; },
    geo: function () { return { W: W, H: H, groundY: groundY, brickW: brickW, brickH: brickH }; },
    UNIT_TYPES: UNIT_TYPES, CARD_ORDER: CARD_ORDER
  };

  document.getElementById('menuBtn').addEventListener('click', function () {
    document.getElementById('endOv').classList.remove('show');
    refreshStartInfo(); document.getElementById('startOv').classList.add('show');
  });
  var stdBtn = document.getElementById('stdBtn');
  if (stdBtn) stdBtn.addEventListener('click', function () {
    if (window.CastleEconomy && !CastleEconomy.canStandard()) { CastleEconomy.toast('Đấu Chuẩn mở ở cấp Lâu đài 3 (cần online)'); return; }
    initAudio(); document.getElementById('startOv').classList.remove('show'); newGame('standard');
  });
  window.__cbRefreshStart = refreshStartInfo;
  refreshStartInfo();
  resize();
  requestAnimationFrame(frame);
})();
