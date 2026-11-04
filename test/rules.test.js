'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../rules.js');

test('năng lượng x2 trong 15s cuối, x3 hiệp phụ', () => {
  assert.strictEqual(R.energyRate(40, false), R.ENERGY_REGEN);
  assert.strictEqual(R.energyRate(15, false), R.ENERGY_REGEN * 2);
  assert.strictEqual(R.energyRate(3, false), R.ENERGY_REGEN * 2);
  assert.strictEqual(R.energyRate(18, true), R.ENERGY_REGEN * 3);
});

test('hết giờ: chênh <=1 gạch ⇒ hiệp phụ, còn lại phân thắng thua', () => {
  assert.strictEqual(R.resolveTimeUp(10, 10), 'overtime');
  assert.strictEqual(R.resolveTimeUp(10, 11), 'overtime');
  assert.strictEqual(R.resolveTimeUp(12, 10), 'win');
  assert.strictEqual(R.resolveTimeUp(8, 10), 'lose');
});

test('hiệp phụ: mất gạch trước thua; hết giờ ít gạch/máu hơn thua; không hòa', () => {
  const base = { lostL: 0, lostR: 0, bricksL: 10, bricksR: 10, hpSumL: 20, hpSumR: 20, timeLeft: 5 };
  assert.strictEqual(R.resolveOvertime(base), null);
  assert.strictEqual(R.resolveOvertime({ ...base, lostL: 1 }), 'lose');
  assert.strictEqual(R.resolveOvertime({ ...base, lostR: 1 }), 'win');
  assert.strictEqual(R.resolveOvertime({ ...base, lostL: 1, lostR: 1 }), null);
  assert.strictEqual(R.resolveOvertime({ ...base, timeLeft: 0, bricksR: 9 }), 'win');
  assert.strictEqual(R.resolveOvertime({ ...base, timeLeft: 0, hpSumL: 19 }), 'lose');
  assert.strictEqual(R.resolveOvertime({ ...base, timeLeft: 0 }), 'win');
  for (const r of ['win', 'lose']) assert.notStrictEqual(r, 'draw');
});

test('điểm: +300 thắng, +10/giây còn lại khi KO, thua tính nửa daily', () => {
  assert.strictEqual(R.finalScore(120, 'win', 0, false), 420);
  assert.strictEqual(R.finalScore(120, 'win', 22.3, true), 120 + 300 + 230);
  assert.strictEqual(R.finalScore(120, 'lose', 22, false), 120);
  assert.strictEqual(R.dailyScore(121, 'lose'), 60);
  assert.strictEqual(R.dailyScore(420, 'win'), 420);
});

test('skill trơn từ màn 1 tới 20, không kẹp ở màn 10', () => {
  assert.strictEqual(R.skill(1), 0);
  assert.strictEqual(R.skill(20), 1);
  assert.ok(R.skill(15) > R.skill(10) && R.skill(10) > R.skill(5));
});

test('AI khắc chế: skill cao luôn ra lính khắc chế khi đủ tiền', () => {
  const costs = { rusher: 2, knight: 2, archer: 3, bomber: 4, giant: 5 };
  const opts = Object.keys(costs);
  for (const [threat, counter] of Object.entries(R.COUNTER)) {
    assert.deepStrictEqual(R.aiPick(opts, 10, threat, 1, costs, () => 0.01), { pick: counter });
  }
  // không có mối đe doạ ⇒ chọn ngẫu nhiên trong số đủ tiền
  const p = R.aiPick(opts, 2.5, null, 1, costs, () => 0.99);
  assert.ok(costs[p.pick] <= 2.5);
  // thiếu tiền cho lính khắc chế ở skill cao ⇒ để dành
  assert.deepStrictEqual(R.aiPick(opts, 2, 'knight', 1, costs, () => 0.01), { wait: true });
});
