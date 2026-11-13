'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../rules.js');

test('bảng hệ số chỉ số cấp quân 1..9 = 1 + 0.04*(lvl-1)', () => {
  const want = [1, 1.04, 1.08, 1.12, 1.16, 1.2, 1.24, 1.28, 1.32];
  for (let l = 1; l <= 9; l++) assert.strictEqual(R.statMult(l), want[l - 1], 'lvl ' + l);
  assert.strictEqual(R.statMult(0), 1); assert.strictEqual(R.statMult(42), 1.32);
});

test('scaleUnit chỉ đổi hp & dmg, giữ cost/speed/range', () => {
  const base = { cost: 5, hp: 42, dmg: 3, speed: 44, range: 24, atkCd: 0.95 };
  const u = R.scaleUnit(base, 9);
  assert.ok(Math.abs(u.hp - 42 * 1.32) < 1e-9); assert.ok(Math.abs(u.dmg - 3 * 1.32) < 1e-9);
  for (const k of ['cost', 'speed', 'range', 'atkCd']) assert.strictEqual(u[k], base[k], k);
  assert.strictEqual(base.hp, 42, 'không sửa object gốc');
});

test('AI chiến dịch: cấp quân = min(9, 1+floor((m-1)/2.5))', () => {
  const got = []; for (let m = 1; m <= 20; m++) got.push(R.aiUnitLevel(m));
  assert.deepStrictEqual(got, [1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 7, 8, 8]);
  assert.strictEqual(R.aiUnitLevel(99), 9);
});

test('Đấu Chuẩn ép MỌI quân cả 2 bên về cấp 5, bất kể cấp sở hữu/màn', () => {
  const owned = { rusher: 9, knight: 1, archer: 7, bomber: 3, giant: 9 };
  const lv = R.matchLevels('standard', owned, 20);
  for (const u of R.UNITS) { assert.strictEqual(lv.L[u], 5); assert.strictEqual(lv.R[u], 5); }
  const c = R.matchLevels('campaign', owned, 20);
  assert.strictEqual(c.L.rusher, 9); assert.strictEqual(c.L.knight, 1); assert.strictEqual(c.R.giant, 8);
  assert.deepStrictEqual(R.boardsFor('standard'), ['standard']);
  assert.ok(!R.boardsFor('campaign').includes('standard'));
});

test('skin không đổi số gạch / hình lâu đài', () => {
  const base = R.castleSpec('default');
  for (const id of ['ice', 'redstone', 'bamboo']) {
    const s = R.castleSpec(id);
    assert.strictEqual(s.skin, id);
    assert.strictEqual(s.total, base.total);
    assert.deepStrictEqual(s.cols, base.cols);
  }
  assert.strictEqual(base.total, 28);
});

test('skin sở hữu theo entitlement; nhãn shop', () => {
  assert.deepStrictEqual(R.ownedSkins([]), ['default']);
  assert.deepStrictEqual(R.ownedSkins(['castle.skin.bamboo', 'castle.starter']), ['default', 'bamboo']);
  assert.strictEqual(R.shopLabel('cosmetic'), '🎨 Trang trí');
  assert.strictEqual(R.shopLabel('boost'), '⏩ Tăng tốc');
});

test('chi phí nâng cấp khớp §2.3 (tổng 786 thẻ, 30.600 vàng, 1.389 XP)', () => {
  let c = 0, g = 0, x = 0;
  for (let l = 2; l <= 9; l++) { const k = R.upgradeCost(l); c += k.cards; g += k.gold; x += k.xp; }
  assert.deepStrictEqual([c, g, x], [786, 30600, 1389]);
});
