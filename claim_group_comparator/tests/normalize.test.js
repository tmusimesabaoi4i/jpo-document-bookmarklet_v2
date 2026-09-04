'use strict';
const test = require('node:test');
const assert = require('node:assert');
const normalize = require('../src/core/normalize');
const similarity = require('../src/core/similarity');
const settings = require('../src/core/settings');

test('表示用の [n-m] を落とす（請求項番号を指定したときはその請求項のものだけ）', () => {
  assert.strictEqual(normalize.stripDisplayNumbers('複数の[17-4]リモート機器', 17), '複数のリモート機器');
  assert.strictEqual(normalize.stripDisplayNumbers('複数の[17-4]リモート', 26), '複数の[17-4]リモート');
  assert.strictEqual(normalize.stripDisplayNumbers('複数の[17-4]リモート'), '複数のリモート');
});

test('Unicode 正規化で全角・半角をそろえる', () => {
  assert.strictEqual(normalize.normalizeForCompare('ＡＢＣは第１の対象'), 'abcは第1の対象');
  assert.strictEqual(normalize.normalizeForCompare('ｶﾀｶﾅと第２の対象'), 'カタカナと第2の対象');
});

test('英字の大文字・小文字をそろえる', () => {
  assert.strictEqual(normalize.normalizeForCompare('ABC を送信する'), normalize.normalizeForCompare('abc を送信する'));
  assert.strictEqual(normalize.normalizeForCompare('Abc'), 'abc');
});

test('数字表記（漢数字）をそろえる', () => {
  assert.strictEqual(normalize.kanjiDigitsToArabic('第一の対象'), '第1の対象');
  assert.strictEqual(normalize.kanjiDigitsToArabic('十二個'), '12個');
  assert.strictEqual(normalize.kanjiDigitsToArabic('二十個'), '20個');
});

test('空白・改行・全角空白と句読点・装飾文字を落とす', () => {
  const out = normalize.normalizeForCompare('　前記　第1の対象、\n及び　第2の対象。');
  assert.strictEqual(out, '第1の対象及び第2の対象');
});

test('「前記」を削除する（「前記◯◯」と「◯◯」を同じ語として扱う）', () => {
  assert.strictEqual(normalize.normalizeForCompare('前記処理装置'), '処理装置');
  assert.strictEqual(
    normalize.normalizeForCompare('前記処理装置は前記対象を搬送する'),
    normalize.normalizeForCompare('処理装置は対象を搬送する'));
});

test('引用定型句は本文中の位置から丸ごと落とす（引用先が違うだけの請求項を遠ざけない）', () => {
  const a = normalize.normalizeForCompare('請求項1に記載の方法であって、前記対象を搬送する方法。');
  const b = normalize.normalizeForCompare('請求項26に記載の方法であって、前記対象を搬送する方法。');
  assert.strictEqual(a, b);
});

test('定型語の一覧・ストップワード辞書・技術用語辞書を持たない', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/core/normalize'), 'utf8');
  // 「前記」以外に、語を並べた配列を持っていないこと
  const arrays = source.match(/const\s+[A-Z_]+\s*=\s*\[[^\]]*\]/g) || [];
  assert.deepStrictEqual(arrays, [], '語の一覧が残っている: ' + arrays.join(' / '));
  // 削除するのは「前記」だけ
  assert.ok(source.indexOf('const REFERENCE_PREFIX = /前記/g;') !== -1);
});

test('意味的な違いは正規化で潰さない（送信/受信・同じ/異なる）', () => {
  const send = normalize.normalizeForCompare('前記レポートを送信する');
  const receive = normalize.normalizeForCompare('前記レポートを受信する');
  assert.notStrictEqual(send, receive);
  const same = normalize.normalizeForCompare('前記装置と同じ区画内に存在する');
  const diff = normalize.normalizeForCompare('前記装置とは異なる区画内に存在する');
  assert.notStrictEqual(same, diff);
  // それでも「比較候補」に残るくらいには近い
  assert.ok(similarity.dice(similarity.ngrams(same, 3), similarity.ngrams(diff, 3)) > 0.5);
});

test('カテゴリー違いの請求項は、正規化しなくても十分に近い', () => {
  // 「◯◯するステップ」と「◯◯する手段」を辞書で畳まなくても、
  // 全体としては高い類似度になる（定型語の一覧を持たなくて済む理由）
  const method = normalize.normalizeForCompare(
    '前記対象の位置を検出する検出ステップと、前記位置に基づいて搬送する搬送ステップと、を含む方法。');
  const apparatus = normalize.normalizeForCompare(
    '前記対象の位置を検出する検出手段と、前記位置に基づいて搬送する搬送手段と、を備える装置。');
  const score = similarity.dice(similarity.ngrams(method, 3), similarity.ngrams(apparatus, 3));
  assert.ok(score > 0.6, '文字3-gram の一致率が低い: ' + score);
});

test('単語を切り出す（ひらがなが区切りになる。辞書も形態素解析も使わない）', () => {
  const terms = normalize.keyTerms(normalize.normalizeForCompare('前記搬送装置は測定レポートを蓄積する'));
  assert.ok(terms.has('搬送装置'), Array.from(terms).join(','));
  assert.ok(terms.has('測定レポート'), Array.from(terms).join(','));
  assert.ok(terms.has('蓄積'));
});

test('n-gram と Dice 係数', () => {
  assert.deepStrictEqual(Array.from(similarity.ngrams('あいうえ', 3)), ['あいう', 'いうえ']);
  assert.strictEqual(similarity.dice(similarity.ngrams('あいう', 3), similarity.ngrams('あいう', 3)), 1);
  assert.strictEqual(similarity.dice(similarity.ngrams('あいう', 3), similarity.ngrams('かきく', 3)), 0);
  assert.strictEqual(similarity.intersectionSize(new Set([1, 2, 3]), new Set([2, 3, 4])), 2);
});

test('請求項の類似度は決められた配分で合成される（重みは設定に集約）', () => {
  const w = settings.CLAIM_WEIGHTS;
  const sum = Object.keys(w).reduce((acc, key) => acc + w[key], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, '重みの合計が 1 でない: ' + sum);
  // 配分（文字3-gram 40% / 共通単語・共通連続文字列 30% / 段落構造 15% / 用語クラス 10% / 残り 5%）
  assert.ok(Math.abs(w.char3 - 0.40) < 1e-9);
  assert.ok(Math.abs((w.words + w.char2) - 0.30) < 1e-9);
  assert.ok(Math.abs((w.segCount + w.segProfile + w.segAligned) - 0.15) < 1e-9);
  assert.ok(Math.abs(w.termClass - 0.10) < 1e-9);
  assert.ok(Math.abs((w.tree + w.category + w.role + w.cite) - 0.05) < 1e-9);

  const full = {
    char3: 1, words: 1, char2: 1, segCount: 1, segProfile: 1, segAligned: 1,
    termClass: 1, tree: 1, category: 1, role: 1, cite: 1,
  };
  assert.strictEqual(similarity.combine(full), 1);
  // 単一指標では決まらない
  const onlyChars = Object.assign({}, full, { words: 0, char2: 0, segCount: 0, segProfile: 0, segAligned: 0 });
  assert.ok(similarity.combine(onlyChars) < 1);
});

test('用語クラスが無い文書では、その特徴量を按分から外す（点が下駄を履かない）', () => {
  const withClasses = similarity.combine({ char3: 1, termClass: 1 }, { char3: 0.4, termClass: 0.1 });
  const without = similarity.combine({ char3: 1, termClass: null }, { char3: 0.4, termClass: 0.1 });
  assert.strictEqual(withClasses, 1);
  assert.strictEqual(without, 1, '使えない特徴量を 0 として数えてはいけない');
  const half = similarity.combine({ char3: 0.5, termClass: null }, { char3: 0.4, termClass: 0.1 });
  assert.ok(Math.abs(half - 0.5) < 1e-9);
});
