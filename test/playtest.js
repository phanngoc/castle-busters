/* playtest.js — cổng verify Castle Busters bằng Chrome headless qua DevTools Protocol
   (cùng khung với blockdrop/test/playtest.js). Tự bật server.js trên cổng tạm.

   G2 BOOT   : 0 lỗi JS, canvas có kích thước.
   G3 CHƠI   : bấm CHƠI → trận chạy; chạm thẻ → lính ra + trừ năng lượng; kéo phía địch → đạn bay.
   G4 LUẬT   : trận giả lập (bot cố định vs AI) luôn kết thúc với thắng/thua, không có hòa.
   G5 ĐỘ KHÓ : bot chạy màn 1..20, in tỉ lệ thắng; đường cong phải giảm dần (không bậc thang).

   Chạy: node test/playtest.js [url]   (GAMES=N đổi số trận / màn, mặc định 12)
*/
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
// ws: thử gói cài riêng trước, rồi tới node_modules của platform (khi game nằm
// trong repo games/). Clone lẻ mà thiếu cả hai thì nói rõ phải làm gì.
let WebSocket;
for (const p of ['ws', '../../node_modules/ws', require('node:os').homedir() + '/goterm-workspace/games/node_modules/ws']) {
  try { WebSocket = require(p); break; } catch (e) { /* thử tiếp */ }
}
if (!WebSocket) {
  console.error('Thiếu gói "ws" (chỉ harness cần, game thì không).\n  npm i --no-save ws');
  process.exit(2);
}
class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.waits = new Map(); this.events = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.id && this.waits.has(m.id)) { this.waits.get(m.id)(m); this.waits.delete(m.id); }
        else if (m.method) this.events.push(m);
      });
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waits.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async tap(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'touch' });
    }
    await sleep(60);
  }
  async drag(x0, y0, x1, y1, steps) {
    steps = steps || 8;
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1, pointerType: 'touch' });
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1, pointerType: 'touch',
        x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps
      });
      await sleep(20);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1, pointerType: 'touch' });
    await sleep(80);
  }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const SRV_PORT = 8791 + Math.floor(Math.random() * 100);
const URL = process.argv[2] || `http://127.0.0.1:${SRV_PORT}/?debug=1`;
const VW = 390, VH = 844, VDPR = 3;
const GAMES = parseInt(process.env.GAMES || '12', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function gate(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' — ' + detail : ''));
}
function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Bot "người chơi trung bình" — cố định qua mọi màn, nên tỉ lệ thắng chỉ phản ánh AI.
// Chạy trong trang: giả lập cả trận bằng __cb.step, không render.
const SIM = `(function sim(level, games) {
  var cb = window.__cb, out = { win: 0, lose: 0, draw: 0, overtime: 0, scores: [] };
  for (var g = 0; g < games; g++) {
    cb.setLevel(level); cb.newGame();
    var S = cb.S, geo = cb.geo(), dt = 1 / 30, t = 0, nextDeploy = 1.5, guard = 0;
    while (!S.over && guard++ < 30 * 200) {
      t += dt;
      if (t >= nextDeploy) {
        var opts = cb.CARD_ORDER.filter(function (k) { return cb.UNIT_TYPES[k].cost <= S.energy; });
        if (opts.length) cb.deploy(opts[Math.floor(Math.random() * opts.length)]);
        nextDeploy = t + 2.6 + Math.random() * 1.2;
      }
      if (S.cannonCd <= 0 && Math.random() < 0.05) {
        var fc = cb.frontColumn('R');
        if (fc) cb.fire(fc.x + geo.brickW / 2 + (Math.random() * 2 - 1) * geo.brickW * 0.9,
                        geo.groundY - fc.n * geo.brickH * (0.35 + Math.random() * 0.6));
      }
      cb.step(dt);
    }
    if (S.overtimeUsed) out.overtime++;
    out[S.result || (S.hpR <= 0.0001 ? 'win' : S.hpL <= 0.0001 ? 'lose' : S.hpL > S.hpR ? 'win' : S.hpR > S.hpL ? 'lose' : 'draw')]++; out.scores.push(S.score);
  }
  return out;
})`;


// Mock platform API khớp CONTRACT.md (castle profile/match/upgrade, shop, orders, sandbox) — chạy trong trang.
const MOCK = `(function () {
  var st = { gold: 5000, cards: { rusher: 0, knight: 30, archer: 0, bomber: 0, giant: 0 }, units: { rusher: 9, knight: 1, archer: 1, bomber: 1, giant: 9 },
    xp: 0, level: 3, nextLevelXp: 220, unlocks: ['daily', 'standard'], firstWinsToday: 0, entitlements: [], pass: { active: false, until: null } };
  var calls = window.__mockCalls = [], orders = {}, seen = {};
  var SHOP = [['castle.skin.ice',29000,'cosmetic',null],['castle.skin.redstone',39000,'cosmetic',null],['castle.skin.bamboo',49000,'cosmetic',null],
    ['castle.pass.s1',59000,'cosmetic+boost',1],['castle.gold.daily',15000,'boost',1],['castle.cards.pick',20000,'boost',3],['castle.starter',25000,'boost',1]];
  function err(code) { var e = new Error(code); e.code = code; return Promise.reject(e); }
  function prof() { return JSON.parse(JSON.stringify(st)); }
  window.ArcadeGame.api = function (m, path, b) {
    calls.push([m, path, b]);
    if (m === 'GET' && path === '/v1/castle/profile') return Promise.resolve(prof());
    if (m === 'POST' && path === '/v1/castle/match') {
      if (seen[b.matchId]) return Promise.resolve({ reward: { gold: 0, cards: 0, xp: 0 }, profile: prof() }); seen[b.matchId] = 1;
      var r = b.won ? { gold: 60, cards: 8, xp: 30 } : { gold: 20, cards: 2, xp: 10 };
      st.gold += r.gold; st.cards[b.cardUnit] += r.cards; st.xp += r.xp; return Promise.resolve({ reward: r, profile: prof() });
    }
    if (m === 'POST' && path === '/v1/castle/upgrade') {
      var to = st.units[b.unit] + 1, c = window.CastleRules.upgradeCost(to);
      if (!c || st.cards[b.unit] < c.cards || st.gold < c.gold) return err('NOT_ENOUGH');
      st.cards[b.unit] -= c.cards; st.gold -= c.gold; st.units[b.unit] = to; st.xp += c.xp; return Promise.resolve({ profile: prof() });
    }
    if (m === 'GET' && path === '/v1/shop?game=castle') return Promise.resolve(SHOP.map(function (x) {
      return { sku: x[0], price: x[1], kind: x[2], label: x[0], limitLeft: x[3] }; }));
    if (m === 'POST' && path === '/v1/orders') {
      var it = SHOP.find(function (x) { return x[0] === b.sku; }), id = 'o' + Object.keys(orders).length;
      orders[id] = { status: 'pending', sku: b.sku };
      return Promise.resolve({ orderId: id, amount: it[1], code: 'ARCTEST0001', sandbox: true,
        qr: { bank: 'MB', account: '0000', amount: it[1], content: 'ARCTEST0001', imageUrl: '' } });
    }
    if (m === 'POST' && path === '/v1/pay/sandbox/confirm') { var o = orders[b.orderId]; o.status = 'paid'; st.entitlements.push(o.sku); return Promise.resolve({ ok: true }); }
    if (m === 'GET' && path.indexOf('/v1/orders/') === 0) return Promise.resolve({ status: orders[decodeURIComponent(path.slice(11))].status });
    return err('NOT_FOUND');
  };
  return window.CastleEconomy.refresh().then(function () { return !!window.CastleEconomy.online; });
})()`;

(async function main() {
  const srv = process.argv[2] ? null : spawn(process.execPath, [__dirname + '/../server.js'],
    { env: Object.assign({}, process.env, { PORT: String(SRV_PORT) }), stdio: 'ignore' });
  const profile = fs.mkdtempSync('/tmp/cb-chrome-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--mute-audio', `--window-size=${VW},${VH}`, 'about:blank'
  ], { stdio: 'ignore' });
  let cdp;
  try {
    for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); break; } catch (e) { await sleep(200); } }
    const page = (await getJSON('/json/list')).find((t) => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: VDPR, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(400);
    await cdp.send('Page.navigate', { url: URL });
    await sleep(1800);

    console.log('\n── G2: BOOT ' + '─'.repeat(40));
    const errs = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network'));
    gate('0 lỗi JS', errs.length === 0, errs.length ? JSON.stringify(errs.slice(0, 2)).slice(0, 400) : 'sạch');
    const boot = await cdp.evaluate(`({ api: !!window.__cb, w: document.getElementById('game').width })`);
    gate('game khởi tạo, canvas có kích thước', boot.api && boot.w > 0, 'canvas ' + boot.w + 'px');

    console.log('\n── G3: CHƠI ĐƯỢC ' + '─'.repeat(35));
    await cdp.evaluate(`document.getElementById('playBtn').click()`);
    await sleep(300);
    const s0 = await cdp.evaluate(`({ run: __cb.S.running, e: __cb.S.energy, u: __cb.S.units.length })`);
    gate('bấm CHƠI → trận chạy', s0.run === true);
    await cdp.evaluate(`__cb.S.energy = 6`);
    const card = await cdp.evaluate(`(() => { const r = document.querySelector('#cards .card').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cdp.tap(card.x, card.y);
    const s1 = await cdp.evaluate(`({ e: __cb.S.energy, u: __cb.S.units.filter(u => u.side === 'L').length })`);
    gate('chạm thẻ → lính ra, trừ năng lượng', s1.u >= 1 && s1.e < 6, `lính ${s1.u}, ⚡ ${s1.e.toFixed(2)}`);
    const tgt = await cdp.evaluate(`(() => { const f = __cb.frontColumn('R'), g = __cb.geo(); return { x: f.x + g.brickW / 2, y: g.groundY - f.n * g.brickH * 0.6 }; })()`);
    await cdp.drag(VW * 0.6, VH * 0.4, tgt.x, tgt.y, 6);
    const s2 = await cdp.evaluate(`({ b: __cb.S.balls.filter(b => b.side === 'L').length, cd: __cb.S.cannonCd })`);
    gate('kéo phía địch → đại bác bắn', s2.b >= 1 || s2.cd > 0, `đạn ${s2.b}, hồi ${s2.cd.toFixed(2)}s`);
    await cdp.shot('/tmp/castle-playtest.png');

    console.log('\n── G1b: OFFLINE vẫn chơi được ' + '─'.repeat(22));
    const off = await cdp.evaluate(`({ online: CastleEconomy.online, std: CastleEconomy.canStandard(), lv: __cb.S.lv.L.rusher })`);
    gate('không có platform: chiến dịch chạy, Đấu Chuẩn khoá', off.online === false && off.std === false && off.lv === 1, JSON.stringify(off));

    console.log('\n── G4: LUẬT — trận giả lập ' + '─'.repeat(25));
    const r1 = await cdp.evaluate(`${SIM}(5, ${GAMES})`);
    gate('mọi trận kết thúc', r1.win + r1.lose + r1.draw === GAMES, JSON.stringify({ w: r1.win, l: r1.lose, d: r1.draw, ot: r1.overtime }));
    const STRICT = !process.env.LEGACY;   // LEGACY=1: chạy trên luật cũ (trước BRAINSTORM #1) — chỉ in, không chặn
    if (STRICT) gate('không có hòa', r1.draw === 0, r1.draw + ' hòa');

    console.log('\n── G5: ĐỘ KHÓ — bot cố định, màn 1..20 ' + '─'.repeat(12));
    const curve = [];
    for (let lv = 1; lv <= 20; lv++) {
      const r = await cdp.evaluate(`${SIM}(${lv}, ${GAMES})`);
      curve.push(r.win / GAMES);
    }
    console.log('  tỉ lệ thắng: ' + curve.map((w, i) => (i + 1) + ':' + Math.round(w * 100) + '%').join(' '));
    // làm mượt cửa sổ 5 màn để bớt nhiễu mẫu nhỏ, rồi đo
    const sm = curve.map((_, i) => { const a = curve.slice(Math.max(0, i - 2), i + 3); return a.reduce((x, y) => x + y, 0) / a.length; });
    const first = (sm[0] + sm[1]) / 2, last = (sm[18] + sm[19]) / 2;
    const flat10 = sm.slice(10).every((v) => Math.abs(v - sm[10]) < 0.08);
    const ups = sm.slice(1).filter((v, i) => v > sm[i] + 0.12).length;
    const ok = first - last >= 0.3 && ups === 0 && !flat10;
    if (STRICT) gate('tỉ lệ thắng giảm dần từ màn 1 → 20', ok,
      `đầu ${Math.round(first * 100)}% → cuối ${Math.round(last * 100)}%, đoạn tăng ngược ${ups}, phẳng sau màn 10: ${flat10}`);
    else console.log(`  (LEGACY) đầu ${Math.round(first * 100)}% → cuối ${Math.round(last * 100)}%, phẳng sau màn 10: ${flat10}`);

    console.log('\n── G6: TIẾN TRÌNH + CỬA HÀNG (mock platform) ' + '─'.repeat(6));
    const on = await cdp.evaluate(MOCK);
    gate('đọc profile từ server', on === true);
    const camp = await cdp.evaluate(`(() => { __cb.setLevel(20); __cb.newGame('campaign'); return { L: __cb.S.lv.L, R: __cb.S.lv.R }; })()`);
    gate('chiến dịch dùng cấp sở hữu + AI màn 20 = cấp 8', camp.L.rusher === 9 && camp.L.knight === 1 && camp.R.giant === 8, JSON.stringify(camp));
    const std = await cdp.evaluate(`(() => { document.getElementById('endOv').classList.remove('show'); __cb.newGame('standard');
      __cb.S.energy = 10; __cb.deploy('giant'); var u = __cb.S.units.find(x => x.side === 'L');
      var lvs = Object.values(__cb.S.lv.L).concat(Object.values(__cb.S.lv.R));
      return { all5: lvs.every(v => v === 5), hp: u.hpMax, dmg: u.t.dmg, cost: u.t.cost }; })()`);
    gate('Đấu Chuẩn ép mọi quân 2 bên cấp 5 (Khổng lồ 42×1.16 máu, chi phí giữ 5)',
      std.all5 && Math.abs(std.hp - 42 * 1.16) < 1e-6 && Math.abs(std.dmg - 3 * 1.16) < 1e-6 && std.cost === 5, JSON.stringify(std));
    await cdp.evaluate(`(() => { var S = __cb.S; S.startedAt = Date.now() - 30000; __cb.endGame('win', true); })()`);
    await sleep(200);
    const rep = await cdp.evaluate(`({ m: __mockCalls.filter(c => c[1] === '/v1/castle/match').map(c => c[2]), txt: document.getElementById('endReward').textContent })`);
    const lastM = rep.m[rep.m.length - 1] || {};
    gate('kết quả trận POST lên server (mode standard, có matchId, thẻ vào quân chọn)', lastM.mode === 'standard' && !!lastM.matchId && lastM.won === true && lastM.cardUnit === 'knight' && /\+60/.test(rep.txt), rep.txt);
    await cdp.evaluate(`document.querySelector('[data-open=profileOv]').click()`); await sleep(200);
    await cdp.evaluate(`document.querySelector('[data-up=knight]').click()`); await sleep(200);
    const up = await cdp.evaluate(`({ k: CastleEconomy.unitLevels().knight, g: CastleEconomy.profile.gold })`);
    gate('nâng cấp Kiếm sĩ 1→2 qua server (−2 thẻ, −50 vàng)', up.k === 2 && up.g === 5000 + 60 - 50, JSON.stringify(up));
    await cdp.evaluate(`document.querySelector('[data-close=profileOv]').click(); document.querySelector('[data-open=shopOv]').click()`); await sleep(300);
    const shop = await cdp.evaluate(`({ n: document.querySelectorAll('#shopBody .shop-it').length, deco: document.querySelectorAll('#shopBody .si-tag').length,
      txt: document.getElementById('shopBody').textContent })`);
    gate('cửa hàng liệt kê đủ 7 SKU, có nhãn Trang trí/Tăng tốc + giới hạn', shop.n === 7 && /🎨 Trang trí/.test(shop.txt) && /⏩ Tăng tốc/.test(shop.txt) && /3\/tuần/.test(shop.txt) && /1\/ngày/.test(shop.txt), 'items ' + shop.n);
    await cdp.evaluate(`document.querySelector('[data-buy="castle.skin.ice"]').click()`); await sleep(300);
    const pay = await cdp.evaluate(`({ show: document.getElementById('payOv').classList.contains('show'), sb: !!document.querySelector('#payBody .sandbox'), btn: !!document.getElementById('sandboxPay'), code: document.querySelector('#payBody .code').textContent })`);
    gate('mua → màn QR có banner sandbox + nút Giả lập thanh toán', pay.show && pay.sb && pay.btn && pay.code === 'ARCTEST0001', JSON.stringify(pay));
    await cdp.shot('/tmp/castle-checkout.png');
    await cdp.evaluate(`document.getElementById('sandboxPay').click()`); await sleep(1200);
    const paid = await cdp.evaluate(`({ st: document.getElementById('payStatus').textContent, ent: CastleEconomy.profile.entitlements })`);
    gate('Giả lập thanh toán → poll thấy paid → có skin Băng', /Đã thanh toán/.test(paid.st) && paid.ent.includes('castle.skin.ice'), paid.st);
    const skin = await cdp.evaluate(`(() => { document.getElementById('payOv').classList.remove('show'); document.getElementById('shopOv').classList.remove('show');
      __cb.newGame('campaign'); var a = __cb.S.left.total; localStorage.setItem('cb_skin', 'ice'); __cb.newGame('campaign');
      return { a: a, b: __cb.S.left.total, skin: CastleEconomy.skin(), cols: __cb.S.left.cols.map(c => c.bricks.length).join(',') }; })()`);
    gate('skin Băng áp dụng, số gạch/hình lâu đài không đổi', skin.skin === 'ice' && skin.a === skin.b && skin.cols === '4,6,8,6,4', JSON.stringify(skin));
    await cdp.evaluate(`localStorage.setItem('cb_skin','redstone'); __cb.newGame('campaign'); localStorage.setItem('cb_skin','default')`);
    gate('skin chưa mua (Đá Đỏ) bị từ chối → default', (await cdp.evaluate(`CastleEconomy.skin()`)) === 'default');
    await cdp.shot('/tmp/castle-skin.png');

    const failed = results.filter((r) => !r.ok);
    console.log('\n' + (failed.length ? '❌ ' + failed.length + ' cổng hỏng' : '✅ tất cả ' + results.length + ' cổng qua'));
    process.exitCode = failed.length ? 1 : 0;
  } catch (e) {
    console.error('playtest lỗi:', e.message); process.exitCode = 2;
  } finally {
    try { cdp && cdp.ws.close(); } catch (e) {}
    chrome.kill('SIGKILL'); if (srv) srv.kill();
  }
})();
