'use strict';
const test = require('node:test');
const assert = require('node:assert');
const grouping = require('../src/core/grouping');
const treeModule = require('../src/core/tree');
const helpers = require('./helpers');

function groupsOf(key, preset) {
  const result = helpers.extract(key);
  return grouping.autoGroup(result.claims, { preset: preset || 'broad' }).groups;
}

// 比較候補として並ぶペアの数。「未グループの請求項」の束は候補ではないので数えない
function candidatePairs(groups) {
  const pairs = new Set();
  for (const g of groups) {
    if (g.strategy === 'ungrouped') continue;
    for (let i = 0; i < g.claimNumbers.length; i += 1) {
      for (let j = i + 1; j < g.claimNumbers.length; j += 1) {
        pairs.add(g.claimNumbers[i] + ':' + g.claimNumbers[j]);
      }
    }
  }
  return pairs;
}

/* ---- 並行ツリー（サブツリー形状からの相対位置対応） -------------------- */

test('並行する3本のサブツリーを、番号差ではなく形と相対位置から対応付ける',
  { skip: !helpers.hasFixture('parallelTree') }, () => {
    const groups = groupsOf('parallelTree', 'broad');
    const tree = groups.filter((g) => g.strategy === 'tree').map((g) => g.claimNumbers.join(','));
    // 起点（独立項）と、その下の各段が対応する
    for (const expected of ['1,8,15', '2,9,16', '3,10,17', '4,11,18', '5,12,19', '6,13,20', '7,14,21']) {
      assert.ok(tree.indexOf(expected) !== -1, expected + ' が並行ツリーとして検出されない: ' + tree.join(' / '));
    }
  });

test('並行ツリーの検出は請求項番号の固定加算ではない（番号を飛ばしても成立する）', () => {
  // 1 → (2 → 3), 4 → (7 → 9) という、間隔の異なる2本の同形サブツリー
  const claims = [
    makeClaim(1, [], '無線通信ネットワークに対して信号を送受信する中継通信デバイスを動作させる方法'),
    makeClaim(2, [1], '前記中継通信デバイスは測定レポートを蓄積する方法'),
    makeClaim(3, [2], '前記測定レポートは識別子を含む方法'),
    makeClaim(4, [], '無線通信ネットワークに対して信号を送受信する中継通信デバイスを動作させる装置'),
    makeClaim(7, [4], '前記中継通信デバイスは測定レポートを蓄積する装置'),
    makeClaim(9, [7], '前記測定レポートは識別子を含む装置'),
  ];
  const groups = grouping.autoGroup(claims, { preset: 'broad' }).groups;
  const tree = groups.filter((g) => g.strategy === 'tree').map((g) => g.claimNumbers.join(','));
  assert.ok(tree.indexOf('1,4') !== -1, '起点どうしが対応しない: ' + tree.join(' / '));
  assert.ok(tree.indexOf('2,7') !== -1, '2段目が対応しない: ' + tree.join(' / '));
  assert.ok(tree.indexOf('3,9') !== -1, '3段目が対応しない: ' + tree.join(' / '));
});

test('多項従属は主ツリーの枝に載せない（サブツリーの形が崩れないように）',
  { skip: !helpers.hasFixture('parallelTree') }, () => {
    const result = helpers.extract('parallelTree');
    const tree = treeModule.buildTree(result.claims);
    // 22・23・24 は 1〜14 を引く多項従属
    for (const n of [22, 23, 24]) {
      assert.strictEqual(tree.get(n).multiDependent, true);
      assert.strictEqual(tree.get(n).primaryParent, null);
    }
    // そのため 1・8・15 のサブツリー形状は一致する
    assert.strictEqual(tree.get(1).shape, tree.get(8).shape);
    assert.strictEqual(tree.get(8).shape, tree.get(15).shape);
    assert.strictEqual(tree.get(1).size, 7);
  });

/* ---- 独立項どうしの比較 ------------------------------------------------ */

test('カテゴリーが違っても字面が近い独立項を比較候補にする（プログラム/方法/装置）',
  { skip: !helpers.hasFixture('categoryTrio') }, () => {
    const groups = groupsOf('categoryTrio', 'broad');
    assert.ok(helpers.hasGroupContaining(groups, [1, 29, 30]),
      '1・29・30 が同じグループに入らない: ' + groups.map((g) => g.claimNumbers.join(',')).join(' / '));
    const group = helpers.findGroupContaining(groups, [1, 29, 30]);
    assert.ok(group.reasons.length > 0);
  });

test('独立項をカテゴリーでまとめる（方法系・装置系・回路系）',
  { skip: !helpers.hasFixture('multiIndependent') }, () => {
    const groups = groupsOf('multiIndependent', 'broad');
    const byCategory = groups.filter((g) => g.strategy === 'category');
    assert.ok(helpers.hasGroupContaining(byCategory, [1, 26, 32, 35]), '方法系がまとまらない');
    assert.ok(helpers.hasGroupContaining(byCategory, [15, 30, 33, 39]), '装置系がまとまらない');
    assert.ok(helpers.hasGroupContaining(byCategory, [16, 31, 34, 40]), '回路系がまとまらない');
  });

test('引用先が違っても列挙内容が似ている従属項を比較候補にする',
  { skip: !helpers.hasFixture('multiIndependent') }, () => {
    const groups = groupsOf('multiIndependent', 'broad');
    // 2・18・28 は親がそれぞれ 1・17・26 と異なるが、蓄積測定レポートの列挙がほぼ同じ
    assert.ok(helpers.hasGroupContaining(groups, [2, 18, 28]),
      '2・18・28 が同じグループに入らない');
    const result = helpers.extract('multiIndependent');
    const parents = [2, 18, 28].map((n) => result.claims.find((c) => c.number === n).citations.join(','));
    assert.deepStrictEqual(parents, ['1', '17', '26'], '前提: 引用先は互いに異なる');
  });

test('意味は違うが字面が近い請求項も候補に出す（同じセル/異なるセル、トリガ条件）',
  { skip: !helpers.hasFixture('multiIndependent') }, () => {
    const groups = groupsOf('multiIndependent', 'broad');
    assert.ok(helpers.hasGroupContaining(groups, [13, 14]), '13・14 が候補にならない');
    assert.ok(helpers.hasGroupContaining(groups, [36, 37, 38]), '36・37・38 が候補にならない');
  });

/* ---- 強度プリセット ---------------------------------------------------- */

test('広め → 標準 → 厳密 の順に比較候補（ペア）が減る', () => {
  for (const key of ['parallelTree', 'categoryTrio', 'multiIndependent']) {
    if (!helpers.hasFixture(key)) continue;
    const broad = candidatePairs(groupsOf(key, 'broad')).size;
    const standard = candidatePairs(groupsOf(key, 'standard')).size;
    const strict = candidatePairs(groupsOf(key, 'strict')).size;
    assert.ok(broad >= standard, `${key}: 広め(${broad}) >= 標準(${standard})`);
    assert.ok(standard >= strict, `${key}: 標準(${standard}) >= 厳密(${strict})`);
  }
});

test('厳密では、広めより明らかに候補が絞られる（字面主体の出願で）', () => {
  for (const key of ['categoryTrio', 'multiIndependent']) {
    if (!helpers.hasFixture(key)) continue;
    const broad = candidatePairs(groupsOf(key, 'broad')).size;
    const strict = candidatePairs(groupsOf(key, 'strict')).size;
    assert.ok(strict < broad, `${key}: 厳密(${strict}) < 広め(${broad})`);
  }
});

test('厳密でも、カテゴリー変更だけの独立項の対応は残る',
  { skip: !helpers.hasFixture('categoryTrio') }, () => {
    const groups = groupsOf('categoryTrio', 'strict');
    assert.ok(helpers.hasGroupContaining(groups, [1, 29, 30]));
  });

/* ---- 出力の性質 -------------------------------------------------------- */

test('グループは任意個数を保持でき、上限は100請求項', () => {
  assert.strictEqual(grouping.MAX_GROUP_SIZE, 100);
  for (const key of ['parallelTree', 'categoryTrio', 'multiIndependent']) {
    if (!helpers.hasFixture(key)) continue;
    for (const group of groupsOf(key, 'broad')) {
      assert.ok(group.claimNumbers.length >= 2);
      assert.ok(group.claimNumbers.length <= grouping.MAX_GROUP_SIZE);
    }
  }
});

test('1つの請求項が複数のグループに属してよい', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const groups = groupsOf('parallelTree', 'broad');
  const counts = new Map();
  for (const g of groups) for (const n of g.claimNumbers) counts.set(n, (counts.get(n) || 0) + 1);
  assert.ok(Array.from(counts.values()).some((v) => v > 1), '複数グループに属する請求項が1つも無い');
});

test('自動グループには根拠が付く', { skip: !helpers.hasFixture('multiIndependent') }, () => {
  const groups = groupsOf('multiIndependent', 'broad');
  for (const group of groups) {
    assert.ok(Array.isArray(group.reasons) && group.reasons.length > 0, group.name + ' に根拠が無い');
    assert.strictEqual(group.source, 'auto');
    assert.strictEqual(group.manuallyEdited, false);
    assert.ok(Array.isArray(group.candidateNumbers), group.name + ' に追加候補の欄が無い');
    if (group.strategy === 'ungrouped') continue; // 未グループの束は類似度を持たない
    assert.ok(typeof group.score === 'number');
  }
});

test('チェーンだけでグループを膨らませない（全体との平均と最低値の両方を見る）', () => {
  // A-B は似ている、B-C も似ている、しかし A-C は似ていない、という並び
  const chain = [
    makeClaim(1, [], '第1の対象を搬送する搬送装置であって、搬送速度を検出する検出部を備える搬送装置。'),
    makeClaim(2, [], '第1の対象を搬送する搬送装置であって、搬送速度を検出する検出部と、'
      + '反応温度を測定する測定部と、を備える搬送装置。'),
    makeClaim(3, [], '反応温度を測定する測定部を備える反応容器であって、'
      + '前記反応容器は撹拌部を有する反応容器。'),
  ];
  const groups = grouping.autoGroup(chain, { preset: 'broad' }).groups
    .filter((g) => g.strategy === 'text');
  for (const group of groups) {
    assert.ok(!(group.claimNumbers.indexOf(1) !== -1 && group.claimNumbers.indexOf(3) !== -1),
      '似ていない 1 と 3 が、2 を経由して同じグループに入っている: ' + group.claimNumbers.join(','));
  }
});

test('確定しなかった請求項は「追加候補」として別に持つ', { skip: !helpers.hasFixture('categoryTrio') }, () => {
  const groups = groupsOf('categoryTrio', 'broad');
  const withCandidates = groups.filter((g) => g.candidateNumbers.length);
  assert.ok(withCandidates.length > 0, '追加候補がひとつも出ていない');
  for (const group of withCandidates) {
    // 追加候補は正式メンバーと重ならない
    for (const n of group.candidateNumbers) {
      assert.strictEqual(group.claimNumbers.indexOf(n), -1);
    }
  }
});

test('どのグループにも入らなかった請求項をまとめて出す', () => {
  // 互いに似ていない請求項だけの案件
  const unrelated = [
    makeClaim(1, [], '第1の対象を搬送する搬送装置であって、搬送速度を検出する検出部を備える搬送装置。'),
    makeClaim(2, [], '利用者の識別情報を認証する認証方法であって、応答を返す工程を含む認証方法。'),
    makeClaim(3, [], '反応容器の内部を撹拌する撹拌方法であって、結晶を析出させる工程を含む撹拌方法。'),
  ];
  const result = grouping.autoGroup(unrelated, { preset: 'strict' });
  assert.deepStrictEqual(result.ungrouped, [1, 2, 3]);
  const bucket = result.groups.find((g) => g.strategy === 'ungrouped');
  assert.ok(bucket, '未グループの束が出ていない');
  assert.deepStrictEqual(bucket.claimNumbers, [1, 2, 3]);
});

test('同じ入力からは同じ結果になる（決定論）', { skip: !helpers.hasFixture('multiIndependent') }, () => {
  const a = groupsOf('multiIndependent', 'broad').map((g) => g.strategy + ':' + g.claimNumbers.join(','));
  const b = groupsOf('multiIndependent', 'broad').map((g) => g.strategy + ':' + g.claimNumbers.join(','));
  assert.deepStrictEqual(a, b);
});

test('92請求項でも現実的な時間で終わる', { skip: !helpers.hasFixture('overflow') }, () => {
  const result = helpers.extract('overflow');
  const started = Date.now();
  const groups = grouping.autoGroup(result.claims, { preset: 'broad' }).groups;
  const elapsed = Date.now() - started;
  assert.ok(groups.length > 0);
  assert.ok(elapsed < 5000, '自動グルーピングに ' + elapsed + 'ms かかった');
});

test('請求項が1件以下ならグループを作らない', () => {
  assert.deepStrictEqual(grouping.autoGroup([], {}).groups, []);
  assert.deepStrictEqual(grouping.autoGroup([makeClaim(1, [], '装置')], {}).groups, []);
});

test('新 UI（用語クラスなし）でも字面とツリーから比較候補を作れる',
  { skip: !helpers.hasFixture('newClaimMark') }, () => {
    const groups = groupsOf('newClaimMark', 'broad');
    assert.ok(helpers.hasGroupContaining(groups, [1, 17]),
      '独立項 1・17 が比較候補にならない: ' + groups.map((g) => g.claimNumbers.join(',')).join(' / '));
    assert.ok(helpers.hasGroupContaining(groups, [19, 20]),
      '装置項 19・20 が比較候補にならない: ' + groups.map((g) => g.claimNumbers.join(',')).join(' / '));
  });

/* ---- テスト用の請求項レコード ------------------------------------------ */
function makeClaim(number, citations, text) {
  const normalize = require('../src/core/normalize');
  const segment = require('../src/core/segment');
  const extractor = require('../src/extract/extractor');
  const segments = segment.splitSegments(text);
  const label = extractor.deriveCategoryLabel(segments);
  const category = extractor.classifyCategory(label);
  return {
    number,
    rawText: text,
    segments,
    segmentCount: segments.length,
    citations,
    textCitations: citations,
    citationSource: 'test',
    isIndependent: citations.length === 0,
    categoryLabel: label,
    categoryKey: category.key,
    categoryGroupLabel: category.groupLabel,
    termClasses: [],
    terms: [],
    normalized: normalize.normalizeForCompare(text, { claimNumber: number, categoryLabel: label }),
    normalizedSegments: segments.map((s) => normalize.normalizeSegment(s.text, { claimNumber: number })),
  };
}
