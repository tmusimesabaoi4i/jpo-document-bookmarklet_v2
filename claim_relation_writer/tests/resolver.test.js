'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../src/core/parser');
const resolver = require('../src/core/resolver');
const examples = require('../examples/examples');

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const graphCache = {};
function graphOf(treeKey) {
  if (!graphCache[treeKey]) {
    const r = parser.parseClaimTree(examples.trees[treeKey].text);
    assert.equal(r.ok, true, treeKey + ' の解析に失敗');
    graphCache[treeKey] = r.graph;
  }
  return graphCache[treeKey];
}

test('ゴールデンケース全件: 5つの集合が期待値と完全一致', () => {
  for (const c of examples.goldenCases) {
    const r = resolver.resolveAffectedClaims(graphOf(c.tree), c.issueClaims, c.relatedClaims);
    assert.equal(r.ok, true, c.id);
    for (const key of ['issueClaims', 'relatedClaims', 'dependentClaims', 'allAffectedClaims', 'citedSeeds']) {
      assert.deepEqual(r[key], c.expectedSets[key], c.id + ': ' + key);
    }
  }
});

test('多重経路（木構造2）でも従属項は重複しない', () => {
  const r = resolver.resolveAffectedClaims(graphOf('tree2'), [1], []);
  assert.deepEqual(r.dependentClaims, range(2, 7).concat([12]));
  // 12 へは多数の経路があるが一度だけ現れる
  assert.equal(r.dependentClaims.filter((n) => n === 12).length, 1);
});

test('関連請求項が指摘請求項の従属項でもそのまま尊重される', () => {
  const r = resolver.resolveAffectedClaims(graphOf('tree1'), [1], [5]);
  assert.deepEqual(r.issueClaims, [1]);
  assert.deepEqual(r.relatedClaims, [5]);
  assert.deepEqual(r.dependentClaims, range(2, 20).filter((n) => n !== 5));
  assert.deepEqual(r.allAffectedClaims, range(1, 20));
  assert.deepEqual(r.citedSeeds, [1]); // 5 は葉（引用してくる項なし）なので主語に載せない
});

test('指摘と関連の重複は関連側から除去される', () => {
  const r = resolver.resolveAffectedClaims(graphOf('tree1'), [1, 5], [5, 9]);
  assert.deepEqual(r.issueClaims, [1, 5]);
  assert.deepEqual(r.relatedClaims, [9]);
});

test('入力順に依存せず昇順に正規化される', () => {
  const r = resolver.resolveAffectedClaims(graphOf('tree1'), [4, 2], [25, 13, 9]);
  assert.deepEqual(r.issueClaims, [2, 4]);
  assert.deepEqual(r.relatedClaims, [9, 13, 25]);
});

test('存在しない請求項番号は番号を明示してエラー', () => {
  const r = resolver.resolveAffectedClaims(graphOf('tree1'), [99], []);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('99'));
  assert.ok(r.error.includes('存在しません'));
  const r2 = resolver.resolveAffectedClaims(graphOf('tree1'), [1], [31, 40]);
  assert.equal(r2.ok, false);
  assert.ok(r2.error.includes('31、40'));
});

test('指摘する請求項が空ならエラー', () => {
  const r = resolver.resolveAffectedClaims(graphOf('tree1'), [], [21]);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('1つ以上'));
});

test('グラフ未解析ならエラー', () => {
  const r = resolver.resolveAffectedClaims(null, [1], []);
  assert.equal(r.ok, false);
});
