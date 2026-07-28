'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const summarizer = require('../src/core/summarizer');

// ITEM は clarity-support が作るが、本テストでは要約に使う素材のみを手組みする。
// 素材は原文（raw）のスライスなので全角数字（請求項２）が入る点に注意。
function item(fields) {
  return Object.assign({
    itemNumber: 1,
    problematicPhrases: [],
    specStatements: [],
    clarityCoreSentence: null,
    firstBodySentence: null,
    conclusionText: null,
    sourceText: null,
  }, fields);
}

// ---------- テンプレート1: かぎ括弧 2 記載の異同（quotePair） ----------

test('quotePair: 「A」と「B」との異同が不明確 → 請求項2の「A」と「B」の異同が不明確。', () => {
  const result = summarizer.buildIssueSummary(item({
    clarityCoreSentence: 'してみると、請求項２に係る発明において「第1送信ステップ」と「第2接続設定処理」との異同が不明確である。',
  }), 'clarity');
  assert.equal(result.summary, '請求項2の「第1送信ステップ」と「第2接続設定処理」の異同が不明確。');
  assert.equal(result.reliable, true);
});

test('quotePair: 半角数字の素材でも同じ出力になる（正規化の冪等性）', () => {
  const result = summarizer.buildIssueSummary(item({
    clarityCoreSentence: 'してみると、請求項2に係る発明において「第1送信ステップ」と「第2接続設定処理」との異同が不明確である。',
  }), 'clarity');
  assert.equal(result.summary, '請求項2の「第1送信ステップ」と「第2接続設定処理」の異同が不明確。');
  assert.equal(result.reliable, true);
});

test('quotePair: 「関係」「対応関係」「明確でない」の言い回しにも対応する', () => {
  const relation = summarizer.buildIssueSummary(item({
    clarityCoreSentence: '請求項１２に係る発明において「第1処理」と「第2処理」との関係が明確でない。',
  }), 'clarity');
  assert.equal(relation.summary, '請求項12の「第1処理」と「第2処理」の関係が不明確。');
  const correspondence = summarizer.buildIssueSummary(item({
    clarityCoreSentence: 'そうすると、請求項３に係る発明において「A部」と「B部」との対応関係が不明確である。',
  }), 'clarity');
  assert.equal(correspondence.summary, '請求項3の「A部」と「B部」の対応関係が不明確。');
});

// ---------- テンプレート2: 明細書の欠落記載（specMissing） ----------

test('specMissing: 明細書に「…」の記載がない。', () => {
  const result = summarizer.buildIssueSummary(item({
    specStatements: [{
      sentence: 'しかしながら、本願明細書には任意の条件に基づいて、第1接続設定処理を実行するか、第2接続設定処理を実行するかを制御することは記載されていない。',
      missing: '任意の条件に基づいて、第1接続設定処理を実行するか、第2接続設定処理を実行するかを制御する',
    }],
  }), 'support');
  assert.equal(
    result.summary,
    '明細書に「任意の条件に基づいて、第1接続設定処理を実行するか、第2接続設定処理を実行するかを制御する」の記載がない。'
  );
  assert.equal(result.reliable, true);
});

test('specMissing: missing が無ければ sentence を使い、末尾の句点は落とす', () => {
  const result = summarizer.buildIssueSummary(item({
    specStatements: [{ sentence: '本願明細書には第２接続設定処理の実行条件が記載されていない。', missing: null }],
  }), 'support');
  assert.equal(result.summary, '明細書に「本願明細書には第2接続設定処理の実行条件が記載されていない」の記載がない。');
  assert.equal(result.reliable, true);
});

test('テンプレート優先順: support は specMissing、clarity は quotePair を採る', () => {
  const both = {
    clarityCoreSentence: '請求項２に係る発明において「A」と「B」との異同が不明確である。',
    specStatements: [{ sentence: '本願明細書には…記載されていない。', missing: 'Ｂの制御' }],
  };
  assert.equal(summarizer.buildIssueSummary(item(both), 'support').summary, '明細書に「Ｂの制御」の記載がない。');
  assert.equal(
    summarizer.buildIssueSummary(item(both), 'clarity').summary,
    '請求項2の「A」と「B」の異同が不明確。'
  );
  // 区分が明確性・サポート要件以外なら quotePair → specMissing の順
  assert.equal(
    summarizer.buildIssueSummary(item(both), 'other').summary,
    '請求項2の「A」と「B」の異同が不明確。'
  );
});

// ---------- テンプレート3: 中核文をそのまま（coreClarity） ----------

test('coreClarity: 文頭の接続表現を除去し、全角数字は半角にする', () => {
  const result = summarizer.buildIssueSummary(item({
    clarityCoreSentence: 'してみると、発明特定事項同士の関係が整合しておらず、請求項１９に係る発明は不明確である。',
  }), 'clarity');
  assert.equal(result.summary, '発明特定事項同士の関係が整合しておらず、請求項19に係る発明は不明確である。');
  assert.equal(result.reliable, true);
});

test('coreClarity: したがって／そうすると／すると も除去し、句点が無ければ補う', () => {
  const cases = [
    ['したがって、請求項５に係る発明は不明確である', '請求項5に係る発明は不明確である。'],
    ['そうすると、請求項５に係る発明は不明確である。', '請求項5に係る発明は不明確である。'],
    ['すると、請求項５に係る発明は不明確である。', '請求項5に係る発明は不明確である。'],
  ];
  for (const [core, want] of cases) {
    assert.equal(summarizer.buildIssueSummary(item({ clarityCoreSentence: core }), 'clarity').summary, want);
  }
});

// ---------- テンプレート4: 素材不足（fallback） ----------

test('fallback: firstBodySentence を要約とし reliable:false', () => {
  const result = summarizer.buildIssueSummary(item({
    firstBodySentence: '請求項１を引用する請求項２には「前記所定の接続」が記載されている。',
  }), 'clarity');
  assert.equal(result.summary, '請求項1を引用する請求項2には「前記所定の接続」が記載されている。');
  assert.equal(result.reliable, false);
});

test('fallback: 素材が原文しか無い場合は 40 文字で切って reliable:false', () => {
  const source = '・請求項 ２-７\n' + 'あ'.repeat(60);
  const result = summarizer.buildIssueSummary(item({ sourceText: source }), 'other');
  assert.equal(result.reliable, false);
  assert.equal(result.summary.length, 41, '40 文字 + 省略記号');
  assert.ok(result.summary.endsWith('…'));
  assert.ok(result.summary.startsWith('・請求項 2-7 ああ'), '改行は空白に潰す: ' + result.summary);
});

test('素材が何も無い ITEM は summary:null / reliable:false', () => {
  assert.deepEqual(summarizer.buildIssueSummary(item({}), 'clarity'), { summary: null, reliable: false });
  assert.deepEqual(summarizer.buildIssueSummary(null, 'clarity'), { summary: null, reliable: false });
});

// ---------- 補助関数・29条系の要約 ----------

test('truncate: 上限以下はそのまま、超えたら省略記号を付す', () => {
  assert.equal(summarizer.truncate('あいうえお', 10), 'あいうえお');
  assert.equal(summarizer.truncate('あいうえお', 3), 'あいう…');
  assert.equal(summarizer.truncate(null, 5), '');
});

test('buildMappingSummary: 引用文献番号と下位区分の一行要約', () => {
  assert.deepEqual(
    summarizer.buildMappingSummary({ subCategory: 'inventiveStep', subCategoryLabel: '進歩性', referenceNumbers: [1, 2] }),
    { summary: '引用文献1、2に基づく進歩性の指摘。', reliable: true }
  );
  assert.deepEqual(
    summarizer.buildMappingSummary({ subCategory: 'novelty', subCategoryLabel: '新規性', referenceNumbers: [1] }),
    { summary: '引用文献1に基づく新規性の指摘。', reliable: true }
  );
  // 引用文献の対応が取れていない場合は区分のみ
  assert.deepEqual(
    summarizer.buildMappingSummary({ subCategoryLabel: '29条系（区分不明）', referenceNumbers: [] }),
    { summary: '29条系（区分不明）の指摘。', reliable: true }
  );
  assert.deepEqual(summarizer.buildMappingSummary(null), { summary: null, reliable: false });
});
