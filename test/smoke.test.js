'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('game.js parse được và index.html nạp đủ script', () => {
  new Function(fs.readFileSync(path.join(root, 'game.js'), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const id of ['game', 'cards', 'playBtn', 'againBtn', 'endOv']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(/<script src="game\.js/.test(html));
});
