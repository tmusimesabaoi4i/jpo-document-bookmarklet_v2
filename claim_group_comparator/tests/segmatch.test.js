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

test('配分は設定に集約されている（共通単語35% / 末尾25% / 3-gram20% / 連続文字列10% / 長さ10%）', () => {
  const w = settings.SEGMENT_WEIGHTS;
  const sum = w.words + w.tail + w.char3 + w.char2 + w.length;
  assert.ok(Math.abs(sum - 1) < 1e-9, '重みの合計が 1 でない: ' + sum);
  assert.ok(Math.abs(w.words - 0.35) < 1e-9);
  assert.ok(Math.abs(w.tail - 0.25) < 1e-9, '末尾（述語）の重みが設定にない');
  assert.ok(Math.abs(w.char3 - 0.20) < 1e-9);
  assert.ok(Math.abs(w.char2 - 0.10) < 1e-9);
  assert.ok(Math.abs(w.length - 0.10) < 1e-9);
  // 用語クラスは按分の外の小さな加点
  assert.ok(settings.SEGMENT_RULES.termClassBonus > 0 && settings.SEGMENT_RULES.termClassBonus < 0.1);
});

test('前半が同じで末尾の動作だけが違う段落を取り違えない（述語は末尾に来る）', () => {
  const common = '前記中継装置と、前記端末との間の通信路の測定をそれぞれ示す複数の測定記録を';
  const a = claim(1, [common + '蓄積し、']);
  const b = claim(2, [
    common + '蓄積し、',
    '前記蓄積した複数の測定記録のうちの選択される1つに関する指標から成る集約記録を生成し、',
    '前記生成した集約記録を前記無線網に対して送信し、',
  ]);
  const matcher = segmatch.createMatcher([a, b]);
  assert.strictEqual(matcher.bestMatch(1, 1, 2).index, 1, '末尾の動作が同じ段落を選ぶべき');
});

test('最低条件（複数の共通語・十分な長さの共通文字列・共通用語クラス）を満たさない候補は選ばない', () => {
  const a = claim(1, ['第1の溶媒に化合物を溶解させる工程を含む記載です。']);
  // 語がほとんど重ならない相手
  const b = claim(2, ['利用者の識別情報を認証サーバへ送る手順です。']);
  const matcher = segmatch.createMatcher([a, b]);
  assert.strictEqual(matcher.meetsMinimum(matcher.segmentsOf(1)[0], matcher.segmentsOf(2)[0]), false);
  assert.strictEqual(matcher.bestMatch(1, 1, 2), null);
});

test('向きが逆なだけの段落（送信／受信）を対応させる', () => {
  // 主体が入れ替わり、送信 ↔ 受信 になっているだけの、対応するはずの段落
  const sender = claim(1, [
    '前記第1の装置において、前記第2の装置へ測定レポートを送信することと、',
    '前記第1の装置において、設定値を保持することと、',
  ]);
  const receiver = claim(8, [
    '前記第2の装置において、判定結果を記録することと、',
    '前記第2の装置において、前記第1の装置から測定レポートを受信することと、',
  ]);
  const matcher = segmatch.createMatcher([sender, receiver]);
  assert.strictEqual(matcher.bestMatch(1, 1, 8).index, 2, '送信 → 受信 が対応しない');
  assert.strictEqual(matcher.bestMatch(8, 2, 1).index, 1, '受信 → 送信 が対応しない');

  // 畳み込みは対応付けの計算だけ。向きの語は同じトークンへ寄る
  assert.strictEqual(
    segmatch.foldDirections('レポートを送信する'),
    segmatch.foldDirections('レポートを受信する'));
  // 素の正規化（表示・グルーピング側）は今までどおり送信と受信を区別する
  assert.notStrictEqual(
    normalize.normalizeForCompare('レポートを送信する'),
    normalize.normalizeForCompare('レポートを受信する'));
});

test('向きが同じ段落があれば、そちらが優先される（畳み込みが誤対応を増やさない）', () => {
  const a = claim(1, ['前記装置において、測定レポートを送信することと、']);
  const b = claim(8, [
    '前記装置において、測定レポートを受信することと、',
    '前記装置において、測定レポートを送信することと、',
  ]);
  const matcher = segmatch.createMatcher([a, b]);
  assert.strictEqual(matcher.bestMatch(1, 1, 8).index, 2, '向きが同じ第2段落が最上位になるべき');
});

test('1つの段落に複数の段落が対応するときは、まとめて拾う（1対多）', () => {
  // 請求項1 の第2・第3段落が、請求項8 では第2段落 1 つにまとまっている
  const split = claim(1, [
    '前記装置において、基準信号を受信することと、',
    '前記装置において、前記基準信号に基づいて第1の値を算出することと、',
    '前記装置において、前記基準信号に基づいて第2の値を算出することと、',
  ]);
  const merged = claim(8, [
    '前記装置において、基準信号を受信することと、',
    '前記装置において、前記基準信号に基づいて第1の値と第2の値とを算出することと、',
  ]);
  const matcher = segmatch.createMatcher([split, merged]);

  // まとめた側（第2段落）を選ぶと、割れている側の両方が反応する
  const back = matcher.matchAll(8, 2, 1).map((m) => m.index).sort();
  assert.deepStrictEqual(back, [2, 3],
    'まとめた段落を選んだとき、対応する両方の段落が反応しない: ' + JSON.stringify(matcher.matchAll(8, 2, 1)));

  // 割れている側のどちらを選んでも、まとめた段落が反応する
  assert.ok(matcher.matchAll(1, 2, 8).some((m) => m.index === 2));
  assert.ok(matcher.matchAll(1, 3, 8).some((m) => m.index === 2));
});

test('相互対応（逆向きに引くと戻ってくる段落）も拾う', () => {
  const a = claim(1, [
    '前記装置において、基準信号を受信することと、',
    '前記装置において、前記基準信号に基づいて第1の値を算出することと、',
    '前記装置において、前記基準信号に基づいて第2の値を算出することと、',
  ]);
  const b = claim(8, [
    '前記装置において、基準信号を受信することと、',
    '前記装置において、前記基準信号に基づいて第1の値と第2の値とを算出することと、',
  ]);
  const matcher = segmatch.createMatcher([a, b]);
  const matches = matcher.matchAll(8, 2, 1);
  assert.ok(matches.length >= 2);
  assert.ok(matches.some((m) => m.mutual), '相互対応の印が付いていない');
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

test('resolve は「対応する段落があればそれら、無ければ何も選ばない」', () => {
  const a = claim(1, [
    '利用者の識別情報を認証サーバへ送る手順と、',
    '前記溶液を撹拌しながら加熱して結晶を析出させる工程と、',
  ]);
  // 1 段落目は分野の違う記載、2 段落目は a の 2 段落目と同じ
  const b = claim(2, [
    '搬送装置により被搬送物を所定の位置へ移動させる工程と、',
    '前記溶液を撹拌しながら加熱して結晶を析出させる工程と、',
  ]);
  const matcher = segmatch.createMatcher([a, b]);

  // 対応する段落がある → それを返す（1 対多なので配列）
  const similar = matcher.resolve(1, 2, 2, 2);
  assert.strictEqual(similar.kind, 'similar');
  assert.deepStrictEqual(similar.indexes, [2]);

  // 対応する段落が無い → 同じ段落番号（第1段落）へは落とさない
  assert.strictEqual(matcher.resolve(1, 1, 2, 2), null,
    '誤った段落を強調するより、何も強調しないことを優先する');

  // 自分自身は選んだ段落そのもの
  assert.deepStrictEqual(matcher.resolve(1, 2, 1, 2), { indexes: [2], scores: [1], kind: 'self' });
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
  assert.deepStrictEqual(matcher.matchAll(1, 1, 2), []);
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

/* ---- 一般則の検証（塊・向き・1対多・相対位置） -------------------------- */

test('接続語で続く段落を1つの塊にまとめる（又は・及び…）', () => {
  const segments = [
    { index: 1, text: '対象を処理する方法であって、', depth: 1 },
    { index: 2, text: '第1の条件に基づいて選択するか、又は、', depth: 1 },
    { index: 3, text: '第2の条件に基づいて選択する', depth: 1 },
    { index: 4, text: '前記選択した対象を搬送する', depth: 1 },
  ];
  assert.deepStrictEqual(segmatch.buildBlocks(segments), [[1], [2, 3], [4]]);
});

test('述語が来ていない段落（…は、／…として、）を次の段落と1つの塊にする', () => {
  const segments = [
    { index: 1, text: '対象を処理する方法であって、', depth: 1 },
    { index: 2, text: '前記処理装置は、前記測定記録として、', depth: 1 },
    { index: 3, text: '第1の指標から成る記録を用いる', depth: 1 },
  ];
  assert.deepStrictEqual(segmatch.buildBlocks(segments), [[1], [2, 3]]);
});

test('インデントが深い段落（列挙の入れ子）を親の段落と1つの塊にする', () => {
  const segments = [
    { index: 1, text: '前記記録は、', depth: 1 },
    { index: 2, text: '第1の識別子、', depth: 2 },
    { index: 3, text: '第2の識別子', depth: 2 },
    { index: 4, text: 'のうちの1つ又は複数から成る', depth: 1 },
  ];
  assert.deepStrictEqual(segmatch.buildBlocks(segments), [[1, 2, 3], [4]]);
});

test('塊にまとめたせいで対応が消えないよう、段落単位でも当てる', () => {
  // 相手側では 2 段落が 1 つの塊になっているが、片方だけが対応する
  const a = claim(1, ['第1の溶媒に化合物を溶解させて溶液を調製する工程と、']);
  const b = {
    number: 2,
    segmentCount: 2,
    segments: [
      { index: 1, text: '前記反応容器は、次の工程として、', depth: 1 },
      { index: 2, text: '第1の溶媒に化合物を溶解させて溶液を調製する工程と、', depth: 1 },
    ],
    normalizedSegments: [
      normalize.normalizeSegment('前記反応容器は、次の工程として、'),
      normalize.normalizeSegment('第1の溶媒に化合物を溶解させて溶液を調製する工程と、'),
    ],
    segmentTermClasses: [[], []],
  };
  const matcher = segmatch.createMatcher([a, b]);
  assert.deepStrictEqual(segmatch.buildBlocks(b.segments), [[1, 2]], '前提: 相手側は1つの塊');
  const hit = matcher.bestMatch(1, 1, 2);
  assert.ok(hit, '塊にまとめたせいで対応が消えている');
  assert.deepStrictEqual(hit.indexes, [2], '対応する段落だけを選ぶべき');
});

test('実物の出願で、選択肢に割れた構成要件どうしが塊として対応する',
  { skip: !helpers.hasFixture('multiIndependent') }, () => {
    const result = helpers.extract('multiIndependent');
    const matcher = segmatch.createMatcher(result.claims);

    // 「又は、」で段落が割れている独立項を、番号ではなくデータから探す
    const withAlternatives = result.claims.filter((claim) => claim.isIndependent
      && matcher.blocksOf(claim.number).some((b) => b.indexes.length > 1));
    assert.ok(withAlternatives.length >= 2,
      '前提: 選択肢が段落に割れた独立項が複数ある: ' + withAlternatives.map((c) => c.number).join(','));

    const [first, second] = withAlternatives;
    const firstBlock = matcher.blocksOf(first.number).find((b) => b.indexes.length > 1);
    const secondBlock = matcher.blocksOf(second.number).find((b) => b.indexes.length > 1);

    // 割れた選択肢のどの段落を選んでも、相手の割れた選択肢が丸ごと反応する
    for (const index of firstBlock.indexes) {
      const hit = matcher.resolve(first.number, index, second.number, second.segmentCount);
      assert.ok(hit, '請求項' + first.number + ' 第' + index + '段落に対応先が無い');
      for (const expected of secondBlock.indexes) {
        assert.ok(hit.indexes.indexOf(expected) !== -1,
          '請求項' + second.number + ' 第' + expected + '段落が反応しない: ' + hit.indexes.join(','));
      }
    }
    // 逆向きも同じ組が反応する
    for (const index of secondBlock.indexes) {
      const hit = matcher.resolve(second.number, index, first.number, first.segmentCount);
      assert.ok(hit && firstBlock.indexes.every((n) => hit.indexes.indexOf(n) !== -1),
        '逆向きの反応が対応していない: ' + (hit ? hit.indexes.join(',') : 'なし'));
    }
  });

test('実物の出願で、段落数の違う独立項どうしが順序を保って対応する',
  { skip: !helpers.hasFixture('categoryTrio') }, () => {
    const result = helpers.extract('categoryTrio');
    const matcher = segmatch.createMatcher(result.claims);
    const independents = result.claims.filter((c) => c.isIndependent);
    assert.ok(independents.length >= 2);
    const [a, b] = independents;
    assert.notStrictEqual(a.segmentCount, b.segmentCount, '前提: 段落数が違う');

    // 対応先の段落番号が単調に増える（順序が入れ替わらない）
    const mapped = [];
    for (let i = 1; i <= a.segmentCount; i += 1) {
      const hit = matcher.bestMatch(a.number, i, b.number);
      if (hit) mapped.push({ from: i, to: hit.index });
    }
    const shown = mapped.map((m) => m.from + '→' + m.to).join(' ');
    assert.ok(mapped.length >= a.segmentCount - 2, '大半の段落に対応先がある: ' + shown);
    for (let i = 1; i < mapped.length; i += 1) {
      assert.ok(mapped[i].to >= mapped[i - 1].to, '対応先の順序が入れ替わっている: ' + shown);
    }
    // 段落番号がずれる（＝単純な同番号対応ではない）ことも確かめる
    assert.ok(mapped.some((m) => m.from !== m.to), '番号のずれが検出できていない: ' + shown);
  });
