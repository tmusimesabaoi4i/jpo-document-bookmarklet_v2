'use strict';
const test = require('node:test');
const assert = require('node:assert');
const citation = require('../src/core/citation');
const helpers = require('./helpers');

test('単一引用「請求項1に記載の」を読む', () => {
  const r = citation.parseCitations('請求項1に記載の方法であって、前記中継通信デバイスは、');
  assert.deepStrictEqual(r.numbers, [1]);
  assert.strictEqual(r.spans.length, 1);
  assert.strictEqual(r.spans[0].start, 0);
  // span は「に記載の」まで含み、丸ごと除去できる
  assert.strictEqual('請求項1に記載の方法であって、'.slice(r.spans[0].start, r.spans[0].end), '請求項1に記載の');
});

test('選択的引用「請求項11又は12に記載の」は両方を取る', () => {
  const r = citation.parseCitations('請求項11又は12に記載の方法であって、');
  assert.deepStrictEqual(r.numbers, [11, 12]);
});

test('範囲引用「請求項1から14のいずれか一項に記載の」を展開する', () => {
  const r = citation.parseCitations('請求項1から14のいずれか一項に記載の方法');
  assert.deepStrictEqual(r.numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

test('範囲引用「請求項1から請求項14のいずれか一項に記載の」も展開する', () => {
  const r = citation.parseCitations('請求項1から請求項14のいずれか一項に記載の方法を実行する手段を備える、装置。');
  assert.strictEqual(r.numbers.length, 14);
  assert.strictEqual(r.numbers[0], 1);
  assert.strictEqual(r.numbers[13], 14);
});

test('波ダッシュの範囲「請求項1～7に記載の」を展開する', () => {
  assert.deepStrictEqual(citation.parseCitations('請求項1～7に記載の装置').numbers, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(citation.parseCitations('請求項1〜3に記載の装置').numbers, [1, 2, 3]);
  assert.deepStrictEqual(citation.parseCitations('請求項1乃至3に記載の装置').numbers, [1, 2, 3]);
});

test('列挙引用「請求項1、請求項17、請求項26又は請求項35に記載の」を読む', () => {
  const r = citation.parseCitations('請求項1、請求項17、請求項26、又は請求項35に記載の方法を前記コンピュータに実行させる命令');
  assert.deepStrictEqual(r.numbers, [1, 17, 26, 35]);
  // 引用表現は 1 つの span にまとまる（正規化時に丸ごと落とせる）
  assert.strictEqual(r.spans.length, 1);
});

test('全角数字の引用も読む', () => {
  assert.deepStrictEqual(citation.parseCitations('請求項１１又は１２に記載の方法').numbers, [11, 12]);
});

test('接続語の先に数字が無ければ引用表現に含めない', () => {
  // 「請求項1に記載の方法であって、前記…」の読点を巻き込まない
  const r = citation.parseCitations('請求項1に記載の方法であって、前記蓄積測定レポートは、識別子、及び測定から成る');
  assert.deepStrictEqual(r.numbers, [1]);
  assert.strictEqual(r.spans.length, 1);
});

test('stripCitations は引用表現だけを落とす', () => {
  const text = '請求項26に記載の方法であって、前記蓄積測定レポートは、指標から成る方法。';
  assert.strictEqual(citation.stripCitations(text), '方法であって、前記蓄積測定レポートは、指標から成る方法。');
});

test('引用一覧（#claim_cite）から直接引用・独立/従属・カテゴリー末尾語を読む', () => {
  const text = '合計請求項数: 3  (独立請求項: 1)'
    + '[1]請求項1 『・・方法』 独立請求項　被引用請求項: 2,3'
    + '[2]請求項2 『・・方法』 従属請求項　引用請求項: 1　引用パターンの数: 1　被引用請求項: 3'
    + '[3]請求項3 『・・装置』 従属請求項　引用請求項: 1,2 (間接引用: 1)　引用パターンの数: 2';
  const r = citation.parseCiteList(text);
  assert.strictEqual(r.total, 3);
  assert.deepStrictEqual(r.independents, [1]);
  assert.deepStrictEqual(r.claims.map((c) => c.number), [1, 2, 3]);
  assert.deepStrictEqual(r.claims[0].citations, []);
  assert.strictEqual(r.claims[0].isIndependent, true);
  assert.deepStrictEqual(r.claims[1].citations, [1]);
  assert.deepStrictEqual(r.claims[2].citations, [1, 2]);
  assert.strictEqual(r.claims[2].categoryLabel, '装置');
});

test('「被引用請求項」を引用請求項として拾わない（上限到達時に不完全な値のため）', () => {
  const text = '[1]請求項1 『・・方法』 独立請求項　被引用請求項: 2,3,4,5';
  const r = citation.parseCiteList(text);
  assert.deepStrictEqual(r.claims[0].citations, []);
});

test('実物の引用一覧で、本文解析と引用一覧の直接引用が一致する', { skip: !helpers.hasFixture('multiIndependent') }, () => {
  const result = helpers.extract('multiIndependent');
  assert.ok(result.ok);
  for (const claim of result.claims) {
    if (claim.isIndependent) continue;
    assert.deepStrictEqual(
      claim.textCitations, claim.citations,
      '請求項' + claim.number + ' の本文解析と引用一覧が食い違う'
    );
  }
});
