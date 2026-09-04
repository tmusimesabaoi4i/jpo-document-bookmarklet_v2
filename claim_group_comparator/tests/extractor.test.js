'use strict';
const test = require('node:test');
const assert = require('node:assert');
const extractor = require('../src/extract/extractor');
const helpers = require('./helpers');
const { parseHTML } = require('./minidom');

const CASES = [
  { key: 'parallelTree', count: 24, independents: [1, 8, 15] },
  { key: 'categoryTrio', count: 30, independents: [1, 29, 30] },
  { key: 'multiIndependent', count: 43, independents: [1, 15, 16, 17, 24, 25, 26, 30, 31, 32, 33, 34, 35, 39, 40] },
];

for (const testCase of CASES) {
  test(`${testCase.key}: すべての請求項番号と本文を取得できる`,
    { skip: !helpers.hasFixture(testCase.key) }, () => {
      const result = helpers.extract(testCase.key);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.source, 'claim_mark');
      assert.strictEqual(result.claims.length, testCase.count);
      // 1 から連番で欠けがない
      assert.deepStrictEqual(
        result.claims.map((c) => c.number),
        Array.from({ length: testCase.count }, (_, i) => i + 1)
      );
      for (const claim of result.claims) {
        assert.ok(claim.rawText.replace(/[\s　]/g, '').length > 5, '請求項' + claim.number + ' の本文が空');
        assert.ok(claim.segments.length >= 1);
      }
    });

  test(`${testCase.key}: 独立項の判定が引用一覧と一致する`,
    { skip: !helpers.hasFixture(testCase.key) }, () => {
      const result = helpers.extract(testCase.key);
      const independents = result.claims.filter((c) => c.isIndependent).map((c) => c.number);
      assert.deepStrictEqual(independents, testCase.independents);
    });

  test(`${testCase.key}: 表示用の [n-m] を本文から除去できる`,
    { skip: !helpers.hasFixture(testCase.key) }, () => {
      const result = helpers.extract(testCase.key);
      for (const claim of result.claims) {
        assert.ok(!/\[\d+-\d+\]/.test(claim.rawText), '請求項' + claim.number + ' に表示用番号が残っている');
        assert.ok(!/\[\d+-\d+\]/.test(claim.normalized));
      }
    });

  test(`${testCase.key}: 【請求項 n】の見出しを本文に含めない`,
    { skip: !helpers.hasFixture(testCase.key) }, () => {
      const result = helpers.extract(testCase.key);
      for (const claim of result.claims) {
        assert.ok(claim.rawText.indexOf('【請求項') === -1, '請求項' + claim.number + ' に見出しが混ざっている');
      }
    });
}

test('用語クラス（zenki_wdXX）を補助情報として拾う', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const result = helpers.extract('parallelTree');
  const claim1 = result.claims.find((c) => c.number === 1);
  assert.ok(claim1.termClasses.length > 0);
  assert.ok(claim1.termClasses.every((c) => c.indexOf('zenki_wd') === 0));
  assert.ok(claim1.terms.length > 0);
});

test('カテゴリーを末尾語から判定する', () => {
  assert.strictEqual(extractor.classifyCategory('方法').key, 'method');
  assert.strictEqual(extractor.classifyCategory('制御方法').key, 'method');
  assert.strictEqual(extractor.classifyCategory('情報処理装置').key, 'apparatus');
  assert.strictEqual(extractor.classifyCategory('中継通信デバイス').key, 'apparatus');
  assert.strictEqual(extractor.classifyCategory('インフラストラクチャ機器').key, 'apparatus');
  assert.strictEqual(extractor.classifyCategory('通信デバイス用の回路').key, 'circuit');
  assert.strictEqual(extractor.classifyCategory('コンピュータプログラム').key, 'program');
  assert.strictEqual(extractor.classifyCategory('コンピュータ可読記録媒体').key, 'medium');
  assert.strictEqual(extractor.classifyCategory('無線通信システム').key, 'system');
});

test('カテゴリー未判定の従属項は引用先のカテゴリーを継承する', () => {
  const claims = [
    { number: 1, citations: [], categoryKey: 'apparatus', categoryGroupLabel: '装置', categoryKnown: true },
    { number: 2, citations: [1], categoryKey: 'tail:XYZ', categoryGroupLabel: 'XYZ', categoryKnown: false },
    { number: 3, citations: [2], categoryKey: 'tail:XYZ', categoryGroupLabel: 'XYZ', categoryKnown: false },
  ];
  extractor.inheritCategories(claims);
  assert.strictEqual(claims[1].categoryKey, 'apparatus');
  assert.strictEqual(claims[2].categoryKey, 'apparatus');
  assert.strictEqual(claims[1].categoryInherited, true);
});

test('未知のカテゴリーでも処理を続け、末尾語ごとに別の系列として扱う', () => {
  const composition = extractor.classifyCategory('ポリカーボネート樹脂組成物');
  const shorter = extractor.classifyCategory('樹脂組成物');
  const crystal = extractor.classifyCategory('多形結晶');
  assert.strictEqual(composition.known, false, '表に無い末尾語は「未知」として扱う');
  assert.strictEqual(composition.key, shorter.key, '同じ対象語で終わる末尾語は同じ系列');
  assert.notStrictEqual(composition.key, crystal.key, '違う対象語は別の系列');
  // 末尾語が無いときも例外にしない
  assert.strictEqual(extractor.classifyCategory('').known, false);
  assert.strictEqual(extractor.classifyCategory(null).key, 'unknown');
});

test('多カテゴリーの出願で、独立項のカテゴリーが正しく割れる',
  { skip: !helpers.hasFixture('multiIndependent') }, () => {
    const result = helpers.extract('multiIndependent');
    const key = (n) => result.claims.find((c) => c.number === n).categoryKey;
    for (const n of [1, 17, 26, 32, 35]) assert.strictEqual(key(n), 'method', '請求項' + n);
    for (const n of [15, 24, 30, 33, 39]) assert.strictEqual(key(n), 'apparatus', '請求項' + n);
    for (const n of [16, 25, 31, 34, 40]) assert.strictEqual(key(n), 'circuit', '請求項' + n);
    assert.strictEqual(key(41), 'system');
    assert.strictEqual(key(42), 'program');
    assert.strictEqual(key(43), 'medium');
  });

test('引用一覧が上限に達しても全請求項を抽出できる', { skip: !helpers.hasFixture('overflow') }, () => {
  const result = helpers.extract('overflow');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.claims.length, 92);
  // 引用一覧が権威（罫線ツリーは上限到達で欠落する）
  assert.ok(result.claims.filter((c) => c.citations.length > 0).length > 60);
});

test('解析前のページでは入力欄の【請求項○】へフォールバックする', () => {
  const doc = parseHTML(
    '<html><body><div id="claim_mark"></div>'
    + '<textarea id="doc1">【請求項１】\n　通信装置と通信するためのプログラムであって、処理を実行させるプログラム。\n'
    + '【請求項２】\n　請求項１に記載のプログラムであって、さらに別の処理を実行させるプログラム。</textarea>'
    + '</body></html>'
  );
  const result = extractor.extractClaims(doc);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, 'input');
  assert.deepStrictEqual(result.claims.map((c) => c.number), [1, 2]);
  assert.deepStrictEqual(result.claims[1].citations, [1]);
  assert.strictEqual(result.claims[0].categoryKey, 'program');
});

test('請求項が取れないときはエラーで止めず案内文を返す', () => {
  const doc = parseHTML('<html><body><div id="claim_mark"></div><textarea id="doc1"></textarea></body></html>');
  const result = extractor.extractClaims(doc);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.claims.length, 0);
  assert.strictEqual(result.message, '請求項を取得できませんでした。先にクレーム解析を実行してください。');
});

test('抽出は元ページの DOM を書き換えない', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const doc = helpers.loadDocument('parallelTree');
  const before = doc.querySelector('#claim_mark').innerHTML;
  extractor.extractClaims(doc);
  assert.strictEqual(doc.querySelector('#claim_mark').innerHTML, before);
});
