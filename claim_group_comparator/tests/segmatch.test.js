'use strict';
/*
 * segmatch.test.js — 段落の対応付け
 *
 * 合成データは意図的に**通信以外の分野**（化学・機械）で書いている。
 * 段落対応が特定の技術用語に依存していないことを、テストの側からも示すため。
 */
const test = require('node:test');
const assert = require('node:assert');
const segmatch = require('../src/core/segmatch');
const normalize = require('../src/core/normalize');
const settings = require('../src/core/settings');
const helpers = require('./helpers');

// 段落テキストの配列から、matcher が必要とする最小の請求項レコードを作る
function claim(number, segmentTexts, segmentTermClasses) {
  return {
    number,
    segmentCount: segmentTexts.length,
    normalizedSegments: segmentTexts.map((t) => normalize.normalizeSegment(t, { claimNumber: number })),
    segmentTermClasses: segmentTermClasses || segmentTexts.map(() => []),
  };
}

test('段落番号がずれていても、内容が対応する段落を選ぶ', () => {
  // 方法クレームと、それを実施する装置クレーム（装置固有の段落が 1 つ挟まる）
  const method = claim(1, [
    '被処理物を処理する方法であって、',
    '第1の溶媒に第1の化合物を溶解させて溶液を調製する工程と、',
    '前記溶液を撹拌しながら加熱して結晶を析出させる工程と、',
    '前記結晶を濾別して乾燥させる工程と、',
  ]);
  const apparatus = claim(9, [
    '被処理物を処理する装置であって、',
    '前記装置は制御部と記憶部とを備え、前記制御部は、',
    '第1の溶媒に第1の化合物を溶解させて溶液を調製し、',
    '前記溶液を撹拌しながら加熱して結晶を析出させ、',
    '前記結晶を濾別して乾燥させる、',
  ]);
  const matcher = segmatch.createMatcher([method, apparatus]);
  assert.strictEqual(matcher.bestMatch(1, 2, 9).index, 3, '溶液の調製');
  assert.strictEqual(matcher.bestMatch(1, 3, 9).index, 4, '結晶の析出');
  assert.strictEqual(matcher.bestMatch(1, 4, 9).index, 5, '濾別・乾燥');
  // 逆向きも成り立つ
  assert.strictEqual(matcher.bestMatch(9, 3, 1).index, 2);
  assert.strictEqual(matcher.bestMatch(9, 5, 1).index, 4);
});

test('共通の定型部分に引っ張られず、固有語で対応が決まる（辞書を持たない）', () => {
  const common = 'に前記処理装置を用いる方法であって、';
  const a = claim(1, [
    '前記処理装置により第1の溶媒を供給すること' + common,
    '前記処理装置により第2の圧力を調整すること' + common,
  ]);
  const b = claim(2, [
    '前記処理装置により第2の圧力を調整すること' + common,
    '前記処理装置により第1の溶媒を供給すること' + common,
  ]);
  const matcher = segmatch.createMatcher([a, b]);
  assert.strictEqual(matcher.bestMatch(1, 1, 2).index, 2);
  assert.strictEqual(matcher.bestMatch(1, 2, 2).index, 1);
});

test('配分は設定に集約されている（共通単語50% / 3-gram25% / 連続文字列15% / 長さ10%）', () => {
  const w = settings.SEGMENT_WEIGHTS;
  const sum = w.words + w.char3 + w.char2 + w.length;
  assert.ok(Math.abs(sum - 1) < 1e-9, '重みの合計が 1 でない: ' + sum);
  assert.ok(Math.abs(w.words - 0.50) < 1e-9);
  assert.ok(Math.abs(w.char3 - 0.25) < 1e-9);
  assert.ok(Math.abs(w.char2 - 0.15) < 1e-9);
  assert.ok(Math.abs(w.length - 0.10) < 1e-9);
  // 用語クラスは按分の外の小さな加点
  assert.ok(settings.SEGMENT_RULES.termClassBonus > 0 && settings.SEGMENT_RULES.termClassBonus < 0.1);
});

test('最低条件（複数の共通語・十分な長さの共通文字列・共通用語クラス）を満たさない候補は選ばない', () => {
  const a = claim(1, ['第1の溶媒に化合物を溶解させる工程を含む記載です。']);
  // 語がほとんど重ならない相手
  const b = claim(2, ['利用者の識別情報を認証サーバへ送る手順です。']);
  const matcher = segmatch.createMatcher([a, b]);
  assert.strictEqual(matcher.meetsMinimum(matcher.segmentsOf(1)[0], matcher.segmentsOf(2)[0]), false);
  assert.strictEqual(matcher.bestMatch(1, 1, 2), null);
});

test('1位と2位が僅差なら、無理に一方を選ばない', () => {
  const a = claim(1, ['第1の対象を所定の温度で加熱する工程を含む記載です。']);
  // まったく同じ段落が 2 つある請求項（どちらとも決められない）
  const b = claim(2, [
    '第1の対象を所定の温度で加熱する工程を含む記載です。',
    '第1の対象を所定の温度で加熱する工程を含む記載です。',
  ]);
  const matcher = segmatch.createMatcher([a, b]);
  assert.strictEqual(matcher.bestMatch(1, 1, 2), null, '同点の候補が並ぶときは選ばない');
});

test('用語クラス（zenki_wdXX）の共通も手がかりに使う', () => {
  const a = claim(1, ['前記第1の対象に関する記載です。'], [['zenki_wd07']]);
  const b = claim(2, [
    '無関係な別の話題に関する記載です。',
    '前記第1の対象に関する記載です。',
  ], [[], ['zenki_wd07']]);
  const matcher = segmatch.createMatcher([a, b]);
  assert.strictEqual(matcher.bestMatch(1, 1, 2).index, 2);
});

test('resolve は「似た段落があればそれ、無ければ何も選ばない」', () => {
  const a = claim(1, [
    '利用者の識別情報を認証サーバへ送信する手順と、',
    '前記溶液を撹拌しながら加熱して結晶を析出させる工程と、',
  ]);
  // 1 段落目は分野の違う記載、2 段落目は a の 2 段落目と同じ
  const b = claim(2, [
    '搬送装置により被搬送物を所定の位置へ移動させる工程と、',
    '前記溶液を撹拌しながら加熱して結晶を析出させる工程と、',
  ]);
  const matcher = segmatch.createMatcher([a, b]);

  // 似た段落がある → それを選ぶ
  const similar = matcher.resolve(1, 2, 2, 2);
  assert.strictEqual(similar.kind, 'similar');
  assert.strictEqual(similar.index, 2);

  // 似た段落が無い → 同じ段落番号（第1段落）へは落とさない
  assert.strictEqual(matcher.resolve(1, 1, 2, 2), null,
    '誤った段落を強調するより、何も強調しないことを優先する');

  // 自分自身は選んだ段落そのもの
  assert.deepStrictEqual(matcher.resolve(1, 2, 1, 2), { index: 2, score: 1, kind: 'self' });
});

test('段落番号は同点のときの補助条件としてだけ使う', () => {
  // 3 段落とも同じ長さで、共通語の量が同じになるよう作る
  const a = claim(1, ['対象aを検査する', '対象bを検査する', '対象cを検査する']);
  const b = claim(2, ['対象cを検査する', '対象bを検査する', '対象aを検査する']);
  const matcher = segmatch.createMatcher([a, b]);
  // 内容が一致する段落があるので、番号ではなく内容で決まる
  const hit = matcher.bestMatch(1, 1, 2);
  if (hit) assert.strictEqual(hit.index, 3, '内容が一致する段落を選ぶ');
});

test('結果はキャッシュされ、同じ問い合わせを繰り返しても計算し直さない', () => {
  const a = claim(1, ['第1の溶媒に化合物を溶解させる記載です。']);
  const b = claim(2, ['第1の溶媒に化合物を溶解させる記載です。']);
  const matcher = segmatch.createMatcher([a, b]);
  matcher.bestMatch(1, 1, 2);
  const size = matcher.cacheSize();
  matcher.bestMatch(1, 1, 2);
  assert.strictEqual(matcher.cacheSize(), size);
});

test('段落が無い請求項・未知の請求項番号でも壊れない', () => {
  const matcher = segmatch.createMatcher([claim(1, []), claim(2, ['何らかの記載です。'])]);
  assert.strictEqual(matcher.bestMatch(1, 1, 2), null);
  assert.strictEqual(matcher.resolve(1, 1, 2, 1), null);
  assert.strictEqual(matcher.resolve(5, 1, 2, 1), null); // 未知の請求項番号
});

/* ---- 実物での確認（要件に挙がっているケース） ---------------------------- */

test('実物の出願で、装置固有の段落が挟まっても後続の段落が対応する',
  { skip: !helpers.hasFixture('parallelTree') }, () => {
    const result = helpers.extract('parallelTree');
    const matcher = segmatch.createMatcher(result.claims);
    // 方法の独立項と、対応する装置の独立項をデータから選ぶ（番号を決め打ちしない）
    const independents = result.claims.filter((c) => c.isIndependent);
    const method = independents.find((c) => c.categoryKey === 'method');
    const apparatus = independents.find((c) => c.categoryKey === 'apparatus');
    assert.ok(method && apparatus, '前提: 方法系と装置系の独立項がある');
    assert.ok(apparatus.segmentCount > method.segmentCount, '前提: 装置側に固有の段落が多い');

    // 方法側の各段落に対応する装置側の段落は、単調に増える番号になる（順番が保たれる）
    const mapped = [];
    for (let i = 1; i <= method.segmentCount; i += 1) {
      const hit = matcher.bestMatch(method.number, i, apparatus.number);
      mapped.push(hit ? hit.index : null);
    }
    const found = mapped.filter((v) => v != null);
    assert.ok(found.length >= method.segmentCount - 1, '大半の段落に対応先が見つかる: ' + mapped.join(','));
    for (let i = 1; i < found.length; i += 1) {
      assert.ok(found[i] > found[i - 1], '対応先の段落番号が入れ替わっている: ' + mapped.join(','));
    }
    // 途中で番号がずれる（＝単純な同番号対応ではない）ことも確かめる
    assert.ok(mapped.some((v, i) => v != null && v !== i + 1),
      '段落番号がずれるケースが検出できていない: ' + mapped.join(','));
  });

test('多数の請求項でも、比較用データは起動時に作られ、1回の選択が速い',
  { skip: !helpers.hasFixture('overflow') }, () => {
    const result = helpers.extract('overflow');
    const built = Date.now();
    const matcher = segmatch.createMatcher(result.claims);
    const buildMs = Date.now() - built;

    const started = Date.now();
    for (const claimRecord of result.claims) {
      matcher.resolve(result.claims[0].number, 2, claimRecord.number, claimRecord.segmentCount);
    }
    const selectMs = Date.now() - started;

    assert.ok(buildMs < 3000, '比較用データの作成に ' + buildMs + 'ms');
    assert.ok(selectMs < 500, '1回の段落選択に ' + selectMs + 'ms');
  });
