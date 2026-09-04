'use strict';
const test = require('node:test');
const assert = require('node:assert');
const treeModule = require('../src/core/tree');
const helpers = require('./helpers');

function claims(spec) {
  return Object.keys(spec).map((n) => ({ number: Number(n), citations: spec[n] }));
}

test('引用が無い請求項が主ツリーの根になる', () => {
  const tree = treeModule.buildTree(claims({ 1: [], 2: [1], 3: [2], 4: [] }));
  assert.deepStrictEqual(tree.roots, [1, 4]);
  assert.deepStrictEqual(tree.get(1).children, [2]);
  assert.deepStrictEqual(tree.get(2).children, [3]);
  assert.strictEqual(tree.get(3).depth, 2);
  assert.strictEqual(tree.get(4).size, 1);
});

test('兄弟は番号昇順で並び、相対位置（path）を持つ', () => {
  const tree = treeModule.buildTree(claims({ 1: [], 2: [1], 4: [1], 5: [1], 6: [5] }));
  assert.deepStrictEqual(tree.get(1).children, [2, 4, 5]);
  assert.deepStrictEqual(tree.get(2).path, [0]);
  assert.deepStrictEqual(tree.get(4).path, [1]);
  assert.deepStrictEqual(tree.get(5).path, [2]);
  assert.deepStrictEqual(tree.get(6).path, [2, 0]);
  assert.strictEqual(tree.get(4).siblingIndex, 1);
});

test('多項従属は枝に載せず、multiDependent として持つ', () => {
  const tree = treeModule.buildTree(claims({ 1: [], 2: [1], 3: [1, 2] }));
  assert.strictEqual(tree.get(3).multiDependent, true);
  assert.strictEqual(tree.get(3).primaryParent, null);
  assert.deepStrictEqual(tree.get(1).children, [2], '多項従属を子に含めない');
  assert.strictEqual(tree.get(3).depth, 1, '深さは最小の親の1つ下');
});

test('サブツリーの正準形（shape）が形の一致を表す', () => {
  const tree = treeModule.buildTree(claims({
    1: [], 2: [1], 3: [2], 4: [1],
    10: [], 11: [10], 12: [11], 13: [10],
    20: [], 21: [20],
  }));
  assert.strictEqual(tree.get(1).shape, tree.get(10).shape);
  assert.notStrictEqual(tree.get(1).shape, tree.get(20).shape);
  assert.deepStrictEqual(tree.preorder(1), [1, 2, 3, 4]);
  assert.deepStrictEqual(tree.preorder(10), [10, 11, 12, 13]);
});

test('自分より大きい番号の引用は親にしない（循環を作らない）', () => {
  const tree = treeModule.buildTree(claims({ 1: [2], 2: [] }));
  assert.deepStrictEqual(tree.get(1).parents, []);
  assert.deepStrictEqual(tree.roots, [1, 2]);
});

test('実物の並行ツリーで、3本のサブツリーの形が一致する',
  { skip: !helpers.hasFixture('parallelTree') }, () => {
    const result = helpers.extract('parallelTree');
    const tree = treeModule.buildTree(result.claims);
    assert.deepStrictEqual(tree.roots, [1, 8, 15]);
    assert.strictEqual(tree.get(1).shape, tree.get(8).shape);
    assert.strictEqual(tree.get(8).shape, tree.get(15).shape);
    // DFS 前順で同じ位置どうしが対応する
    assert.deepStrictEqual(tree.preorder(1), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(tree.preorder(8), [8, 9, 10, 11, 12, 13, 14]);
    assert.deepStrictEqual(tree.preorder(15), [15, 16, 17, 18, 19, 20, 21]);
  });

test('独立項がすべて葉のときも壊れない', { skip: !helpers.hasFixture('multiIndependent') }, () => {
  const result = helpers.extract('multiIndependent');
  const tree = treeModule.buildTree(result.claims);
  assert.strictEqual(tree.get(16).size, 1);
  assert.strictEqual(tree.get(16).shape, '()');
  assert.strictEqual(tree.get(41).multiDependent, true);
});
