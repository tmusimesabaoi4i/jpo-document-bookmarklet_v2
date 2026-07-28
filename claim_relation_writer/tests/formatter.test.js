'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const formatter = require('../src/core/formatter');

const f = formatter.formatClaimNumbers;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('単独の番号', () => {
  assert.equal(f([26]), '２６');
});

test('2つ連続でも範囲表記になる（提示例: １０-１１、２５-２６）', () => {
  assert.equal(f([10, 11]), '１０-１１');
  assert.equal(f([25, 26]), '２５-２６');
});

test('単独と範囲の混在', () => {
  assert.equal(f([3, 5, 6, 7]), '３、５-７');
});

test('提示例の複合パターン', () => {
  const nums = range(2, 7).concat(range(9, 11), range(13, 20), [25, 26]);
  assert.equal(f(nums), '２-７、９-１１、１３-２０、２５-２６');
  assert.equal(f(range(1, 26)), '１-２６');
});

test('重複除去と昇順ソート', () => {
  assert.equal(f([25, 2, 26, 2]), '２、２５-２６');
  assert.equal(f([3, 2, 4]), '２-４');
});

test('空・未指定は空文字', () => {
  assert.equal(f([]), '');
  assert.equal(f(undefined), '');
});

test('コードポイントの固定: 全角数字 U+FF10台・半角ハイフン U+002D・読点 U+3001', () => {
  assert.equal(f([2, 3]), '２-３');
  assert.equal(f([1, 3]), '１、３');
});

test('toFullWidthDigits は数字のみ全角化する', () => {
  assert.equal(formatter.toFullWidthDigits('12a-b'), '１２a-b');
});
