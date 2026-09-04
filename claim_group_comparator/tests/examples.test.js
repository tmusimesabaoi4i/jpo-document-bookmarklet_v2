'use strict';
/*
 * examples.test.js — examples/examples.js のゴールデンケースを実装で検証する。
 * 実物のクレームから採った書き方を、実装が取りこぼしていないかの回帰テスト。
 */
const test = require('node:test');
const assert = require('node:assert');
const examples = require('../examples/examples');
const citation = require('../src/core/citation');
const segment = require('../src/core/segment');
const extractor = require('../src/extract/extractor');
const grouping = require('../src/core/grouping');
const helpers = require('./helpers');

test('ゴールデンケース: 引用表現', () => {
  for (const example of examples.CITATIONS) {
    assert.deepStrictEqual(
      citation.parseCitations(example.text).numbers, example.numbers, example.text);
  }
});

test('ゴールデンケース: 段落分割', () => {
  for (const example of examples.SEGMENTS) {
    const segments = segment.splitSegments(example.text);
    assert.strictEqual(segments.length, example.expected.length, example.title);
    example.expected.forEach((want, i) => {
      assert.strictEqual(segments[i].depth, want.depth, example.title + ' の段落' + (i + 1) + 'の深さ');
      if (want.endsWith) {
        assert.ok(segments[i].text.endsWith(want.endsWith),
          example.title + ' の段落' + (i + 1) + ': ' + segments[i].text);
      }
    });
  }
});

test('ゴールデンケース: カテゴリー判定', () => {
  for (const example of examples.CATEGORIES) {
    assert.strictEqual(extractor.classifyCategory(example.label).key, example.key, example.label);
  }
});

test('ゴールデンケース: 自動グルーピング（広め）', () => {
  for (const example of examples.GROUPING) {
    if (!helpers.hasFixture(example.fixture)) continue;
    const result = helpers.extract(example.fixture);
    const groups = grouping.autoGroup(result.claims, { preset: 'broad' }).groups;
    for (const wanted of example.mustContain) {
      assert.ok(helpers.hasGroupContaining(groups, wanted),
        example.fixture + '（' + example.note + '）で ' + wanted.join('・') + ' が候補にならない'
        + '\n実際: ' + groups.map((g) => g.claimNumbers.join(',')).join(' / '));
    }
  }
});
