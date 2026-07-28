'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../src/core/parser');
const resolver = require('../src/core/resolver');
const generator = require('../src/core/generator');
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

test('ゴールデンケース全件: 生成文がバイト単位で完全一致', () => {
  for (const c of examples.goldenCases) {
    const resolved = resolver.resolveAffectedClaims(graphOf(c.tree), c.issueClaims, c.relatedClaims);
    assert.equal(resolved.ok, true, c.id);
    const text = generator.generateStatement({ issueType: c.issueType, resolved });
    assert.equal(text, c.expectedText, c.id);
  }
});

test('コードポイントの検証: 行頭は全角スペース、区切りは読点、範囲は半角ハイフン', () => {
  const resolved = resolver.resolveAffectedClaims(graphOf('tree1'), [1], [21]);
  const text = generator.generateStatement({ issueType: 'clarity', resolved });
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(line.charAt(0), '　'); // 全角スペース
  }
  assert.ok(text.includes('１、２１')); // １、２１（読点 U+3001）
  assert.ok(text.includes('２-２０')); // ２-２０（半角ハイフン U+002D）
});

test('関連が空・従属項ありの場合は1文目のみ省略', () => {
  const resolved = resolver.resolveAffectedClaims(graphOf('tree1'), [1], []);
  const text = generator.generateStatement({ issueType: 'clarity', resolved });
  assert.equal(text, [
    '　請求項１を引用する請求項２-２０にも同様の点が指摘される。',
    '　よって、請求項１-２０に係る発明は明確でない。',
  ].join('\n'));
});

test('サポート要件の結論文', () => {
  const resolved = resolver.resolveAffectedClaims(graphOf('tree3'), [1], []);
  const text = generator.generateStatement({ issueType: 'support', resolved });
  assert.equal(text, '　よって、請求項１に係る発明は、発明の詳細な説明に記載したものでない。');
});

test('文字列入力からの統合フロー（parseClaimNumberList → resolver → generator）', () => {
  const issue = parser.parseClaimNumberList('２、４');
  const related = parser.parseClaimNumberList('9, 13, 25');
  assert.equal(issue.ok, true);
  assert.equal(related.ok, true);
  const resolved = resolver.resolveAffectedClaims(graphOf('tree1'), issue.claims, related.claims);
  const text = generator.generateStatement({ issueType: 'clarity', resolved });
  const golden = examples.goldenCases.find((c) => c.id === 'case2-clarity');
  assert.equal(text, golden.expectedText);
});

test('不明な指摘事項は例外', () => {
  const resolved = resolver.resolveAffectedClaims(graphOf('tree3'), [1], []);
  assert.throws(() => generator.generateStatement({ issueType: 'novelty', resolved }));
  assert.throws(() => generator.generateStatement({ issueType: 'clarity', resolved: null }));
});

test('ISSUE_TYPES のラベル定義', () => {
  assert.equal(generator.ISSUE_TYPES.clarity.label, '明確性');
  assert.equal(generator.ISSUE_TYPES.support.label, 'サポート要件');
});
