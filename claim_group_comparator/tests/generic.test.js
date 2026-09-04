'use strict';
/*
 * generic.test.js — 案件に依存しないことの検証
 *
 * 添付の実案件は「実際の DOM と複雑な請求項」を確かめるための資料にすぎないので、
 * ここでは人工データだけを使い、
 *   請求項番号・技術分野の語彙・請求項の並び・独立項の数・従属項の有無・
 *   段落数・欠番・未知のカテゴリー・請求項数
 * を振っても、**同じ構造なら同じ結果**になり、想定外の形でも例外で止まらないことを確かめる。
 */
const test = require('node:test');
const assert = require('node:assert');
const synthetic = require('./synthetic');
const helpers = require('./helpers');
const grouping = require('../src/core/grouping');
const treeModule = require('../src/core/tree');
const segmatch = require('../src/core/segmatch');
const workspace = require('../src/view/workspace');

const SERIES_SIZE = 4; // parallelSeries が作る 1 系列あたりの請求項数

/*
 * グループを「請求項番号」ではなく「系列番号:系列内の位置」で表す。
 * 番号や語彙を変えても同じ文字列になるはずで、これが一致することが
 * 「案件固有の番号に依存していない」ことの証拠になる。
 */
function canonicalGroups(groups, startNumbers) {
  const position = (number) => {
    for (let i = 0; i < startNumbers.length; i += 1) {
      const offset = number - startNumbers[i];
      if (offset >= 0 && offset < SERIES_SIZE) return i + ':' + offset;
    }
    return '?:' + number;
  };
  return groups
    .filter((g) => g.strategy === 'tree')
    .map((g) => g.claimNumbers.map(position).join(','))
    .sort();
}

function autoGroupsOf(claims, preset) {
  const result = synthetic.extract(claims);
  assert.strictEqual(result.ok, true);
  return grouping.autoGroup(result.claims, { preset: preset || 'broad' }).groups;
}

/* ---- 請求項番号を変えても同じ結果 -------------------------------------- */

test('請求項番号を総入れ替えしても、同じ構造として処理できる', () => {
  const numberings = [
    [1, 10, 20],       // 元の並び
    [101, 250, 999],   // 大きな番号
    [7, 8, 9].map((n) => n * 100), // 桁の違う番号
  ];
  const canonical = numberings.map((startNumbers) =>
    canonicalGroups(autoGroupsOf(synthetic.parallelSeries({ startNumbers })), startNumbers));

  assert.ok(canonical[0].length >= SERIES_SIZE, '並行ツリーが検出されている: ' + canonical[0].join(' / '));
  assert.deepStrictEqual(canonical[1], canonical[0]);
  assert.deepStrictEqual(canonical[2], canonical[0]);
});

test('請求項番号に欠番があっても、番号が飛んだままで処理できる', () => {
  // 系列の先頭が 5・40・77（間が大きく空き、連番でもない）
  const startNumbers = [5, 40, 77];
  const groups = autoGroupsOf(synthetic.parallelSeries({ startNumbers }));
  assert.deepStrictEqual(
    canonicalGroups(groups, startNumbers),
    canonicalGroups(autoGroupsOf(synthetic.parallelSeries({ startNumbers: [1, 10, 20] })), [1, 10, 20]));
});

test('系列が交互に並んでいても（番号がブロックで固まっていなくても）対応が取れる', () => {
  // 1,3,5,7 と 2,4,6,8 の 2 系列を交互に配置する
  const interleaved = [
    { number: 1, cites: [], category: '方法', paragraphs: ['第1の対象を処理する方法であって、', '前記第1の対象から値を取得することと、'] },
    { number: 2, cites: [], category: '装置', paragraphs: ['第1の対象を処理する装置であって、', '前記第1の対象から値を取得する取得部と、'] },
    { number: 3, cites: [1], category: '方法', paragraphs: ['前記値は所定の周期で測定される'] },
    { number: 4, cites: [2], category: '装置', paragraphs: ['前記値は所定の周期で測定される'] },
    { number: 5, cites: [3], category: '方法', paragraphs: ['前記所定の周期は条件に応じて変更される'] },
    { number: 6, cites: [4], category: '装置', paragraphs: ['前記所定の周期は条件に応じて変更される'] },
  ];
  const groups = autoGroupsOf(interleaved);
  const tree = groups.filter((g) => g.strategy === 'tree').map((g) => g.claimNumbers.join(','));
  assert.ok(tree.indexOf('1,2') !== -1, '起点どうし: ' + tree.join(' / '));
  assert.ok(tree.indexOf('3,4') !== -1, '2段目: ' + tree.join(' / '));
  assert.ok(tree.indexOf('5,6') !== -1, '3段目: ' + tree.join(' / '));
});

test('DOM 上の並びが番号順でなくても、番号順に整えて処理できる', () => {
  const claims = synthetic.parallelSeries({ startNumbers: [1, 10, 20] });
  const shuffled = claims.slice().reverse();
  const inOrder = synthetic.extract(claims).claims.map((c) => c.number);
  const outOfOrder = synthetic.extract(shuffled).claims.map((c) => c.number);
  assert.deepStrictEqual(outOfOrder, inOrder);
  assert.deepStrictEqual(
    canonicalGroups(autoGroupsOf(shuffled), [1, 10, 20]),
    canonicalGroups(autoGroupsOf(claims), [1, 10, 20]));
});

/* ---- 技術分野を変えても同じ結果 ---------------------------------------- */

test('技術用語を別分野の語へ総入れ替えしても、同じ構造として処理できる', () => {
  const startNumbers = [1, 10, 20];
  const canonical = Object.keys(synthetic.DOMAINS).map((domain) =>
    canonicalGroups(autoGroupsOf(synthetic.parallelSeries({ startNumbers, domain })), startNumbers));
  assert.ok(canonical[0].length >= SERIES_SIZE);
  for (let i = 1; i < canonical.length; i += 1) {
    assert.deepStrictEqual(canonical[i], canonical[0],
      Object.keys(synthetic.DOMAINS)[i] + ' 分野で結果が変わった');
  }
});

test('段落の対応付けも分野に依存しない', () => {
  const startNumbers = [1, 10];
  for (const domain of Object.keys(synthetic.DOMAINS)) {
    // 2 系列目の独立項にだけ固有段落を挿す（段落番号が 1 つずれる）
    const claims = synthetic.parallelSeries({ startNumbers, domain, extraParagraphAt: 1 });
    const result = synthetic.extract(claims);
    const matcher = segmatch.createMatcher(result.claims);
    const first = result.claims.find((c) => c.number === 1);
    const second = result.claims.find((c) => c.number === 10);
    assert.strictEqual(second.segmentCount, first.segmentCount + 1, domain + ': 前提が崩れている');
    // 固有段落より後ろは 1 つずれた段落へ対応する
    for (let i = 2; i <= first.segmentCount; i += 1) {
      const hit = matcher.bestMatch(1, i, 10);
      assert.ok(hit, domain + ': 第' + i + '段落に対応先が無い');
      assert.strictEqual(hit.index, i + 1,
        domain + ': 第' + i + '段落 → 第' + hit.index + '段落（第' + (i + 1) + '段落のはず）');
    }
  }
});

/* ---- 独立項・従属項の構成が変わっても動く ------------------------------ */

test('独立項が1件だけの案件でも動く', () => {
  const claims = synthetic.parallelSeries({ startNumbers: [1] });
  const result = synthetic.extract(claims);
  assert.strictEqual(result.claims.filter((c) => c.isIndependent).length, 1);
  const groups = grouping.autoGroup(result.claims, { preset: 'broad' }).groups;
  // 並行ツリーは作れないが、他の観点でのグループ化は動く（例外にもならない）
  assert.strictEqual(groups.filter((g) => g.strategy === 'tree').length, 0);
  assert.ok(groups.every((g) => g.claimNumbers.length >= 2));
});

test('従属項が1件も無い案件でも動く', () => {
  const claims = [];
  for (let i = 1; i <= 6; i += 1) {
    claims.push({
      number: i, cites: [], category: i % 2 ? '方法' : '装置',
      paragraphs: ['第' + i + 'の対象を処理する構成であって、', '前記第' + i + 'の対象から値を取得すること、'],
    });
  }
  const result = synthetic.extract(claims);
  assert.strictEqual(result.claims.filter((c) => c.isIndependent).length, 6);
  const groups = grouping.autoGroup(result.claims, { preset: 'broad' }).groups;
  assert.ok(groups.length > 0, '独立項だけでも比較候補は作れる');
  assert.ok(groups.every((g) => g.claimNumbers.length <= 6));
});

test('独立項が多数ある案件でも動く', () => {
  const starts = [];
  for (let i = 0; i < 12; i += 1) starts.push(1 + i * 10);
  const groups = autoGroupsOf(synthetic.parallelSeries({ startNumbers: starts }));
  const tree = groups.filter((g) => g.strategy === 'tree');
  assert.ok(tree.length >= SERIES_SIZE, '12系列でも並行ツリーが取れる');
  assert.ok(tree.every((g) => g.claimNumbers.length === 12), '各段に12件そろう');
});

test('系列ごとに請求項数が違っても（従属項が欠けていても）壊れない', () => {
  const startNumbers = [1, 10, 20];
  const claims = synthetic.parallelSeries({ startNumbers, dropChildren: 1 }); // 2系列目は独立項だけ
  const result = synthetic.extract(claims);
  const tree = treeModule.buildTree(result.claims);
  assert.strictEqual(tree.get(10).size, 1);
  assert.strictEqual(tree.get(1).size, SERIES_SIZE);
  const groups = grouping.autoGroup(result.claims, { preset: 'broad' }).groups;
  // 形の残っている2系列は対応が取れる
  const treeGroups = groups.filter((g) => g.strategy === 'tree').map((g) => g.claimNumbers.join(','));
  assert.ok(treeGroups.indexOf('1,20') !== -1, '形の一致する系列だけ対応する: ' + treeGroups.join(' / '));
  // 従属項を失った系列の独立項も、別の観点で候補に残る
  assert.ok(groups.some((g) => g.claimNumbers.indexOf(10) !== -1), '請求項10がどのグループにも入らない');
});

test('非常に深い引用関係でも壊れない', () => {
  const claims = [{ number: 1, cites: [], category: '方法', paragraphs: ['対象を処理する方法であって、値を取得すること、'] }];
  for (let i = 2; i <= 25; i += 1) {
    claims.push({ number: i, cites: [i - 1], category: '方法', paragraphs: ['前記値は第' + i + 'の条件を満たす'] });
  }
  const result = synthetic.extract(claims);
  const tree = treeModule.buildTree(result.claims);
  assert.strictEqual(tree.get(25).depth, 24);
  assert.strictEqual(tree.get(1).size, 25);
  assert.doesNotThrow(() => grouping.autoGroup(result.claims, { preset: 'broad' }));
});

test('1つの請求項が多数の請求項を引用しても壊れない', () => {
  const claims = [];
  for (let i = 1; i <= 8; i += 1) {
    claims.push({ number: i, cites: [], category: '方法', paragraphs: ['第' + i + 'の対象を処理する方法であって、値を取得すること、'] });
  }
  claims.push({
    number: 9, cites: [1, 2, 3, 4, 5, 6, 7, 8], category: '装置',
    paragraphs: ['に記載の方法を実行する手段を備える'],
  });
  const result = synthetic.extract(claims);
  assert.deepStrictEqual(result.claims.find((c) => c.number === 9).citations, [1, 2, 3, 4, 5, 6, 7, 8]);
  const tree = treeModule.buildTree(result.claims);
  assert.strictEqual(tree.get(9).multiDependent, true);
  assert.doesNotThrow(() => grouping.autoGroup(result.claims, { preset: 'broad' }));
});

/* ---- カテゴリー -------------------------------------------------------- */

test('未知のカテゴリーが現れても処理を続ける', () => {
  const startNumbers = [1, 10, 20];
  const claims = synthetic.parallelSeries({
    startNumbers,
    categories: ['樹脂組成物', '多形結晶', '評価用アセンブリ'], // どれも既知の表に無い
    domain: 'chemical',
  });
  const result = synthetic.extract(claims);
  assert.ok(result.claims.every((c) => c.categoryKnown === false), '未知として扱われている');
  assert.ok(result.claims.every((c) => c.categoryLabel !== ''), 'ラベル自体は保持している');
  // 未知どうしが同じ系列に混ざらない
  const keys = new Set(result.claims.map((c) => c.categoryKey));
  assert.strictEqual(keys.size, 3);
  // 構造からの対応付けは既知カテゴリーのときと同じ
  assert.deepStrictEqual(
    canonicalGroups(grouping.autoGroup(result.claims, { preset: 'broad' }).groups, startNumbers),
    canonicalGroups(autoGroupsOf(synthetic.parallelSeries({ startNumbers })), startNumbers));
});

test('既知と未知のカテゴリーが混在しても処理を続ける', () => {
  const claims = synthetic.parallelSeries({
    startNumbers: [1, 10, 20],
    categories: ['方法', '樹脂組成物', 'プログラム'],
  });
  const result = synthetic.extract(claims);
  const keys = result.claims.filter((c) => c.isIndependent).map((c) => c.categoryKey);
  assert.strictEqual(new Set(keys).size, 3);
  assert.doesNotThrow(() => grouping.autoGroup(result.claims, { preset: 'broad' }));
});

/* ---- 規模 -------------------------------------------------------------- */

test('100請求項でも抽出・グルーピング・描画ができる', () => {
  const starts = [];
  for (let i = 0; i < 25; i += 1) starts.push(1 + i * 4); // 25系列 × 4 = 100請求項
  const claims = synthetic.parallelSeries({ startNumbers: starts });
  assert.strictEqual(claims.length, 100);

  const result = synthetic.extract(claims);
  assert.strictEqual(result.claims.length, 100);

  const started = Date.now();
  const auto = grouping.autoGroup(result.claims, { preset: 'broad' });
  const groupMs = Date.now() - started;
  assert.ok(groupMs < 15000, '自動グルーピングに ' + groupMs + 'ms');

  // 100件を1グループにまとめて描画できる
  const doc = helpers.blankDocument();
  const win = helpers.fakeWindow(doc, 1920);
  const handle = workspace.createWorkspace({
    doc, win, claims: result.claims, preset: 'broad', meta: {},
    autoGroups: [{
      id: 'all', name: '全請求項', claimNumbers: result.claims.map((c) => c.number),
      source: 'manual', reasons: [], manuallyEdited: false, order: 1,
    }],
    regroup: () => auto.groups,
  });
  assert.strictEqual(doc.querySelectorAll('.jcgc-card').length, 100);
  handle.store.selectSegment(2, result.claims[0].number);
  assert.ok(doc.querySelectorAll('.jcgc-seg').filter(
    (el) => el.getAttribute('class').indexOf('is-selected') !== -1).length > 0);
});

test('非常に長い請求項でも壊れない', () => {
  const long = '前記対象は、'.concat('所定の条件を満たす部材と、'.repeat(400)) + 'を備える';
  const claims = [
    { number: 1, cites: [], category: '装置', paragraphs: ['対象を処理する装置であって、', long] },
    { number: 2, cites: [], category: '方法', paragraphs: ['対象を処理する方法であって、', long] },
  ];
  const result = synthetic.extract(claims);
  assert.strictEqual(result.claims.length, 2);
  assert.ok(result.claims[0].rawText.length > 3000);
  assert.doesNotThrow(() => grouping.autoGroup(result.claims, { preset: 'broad' }));
});

/* ---- 壊れた入力でも止まらない ------------------------------------------ */

test('引用先が存在しない・自分自身・自分より大きい番号でも例外にしない', () => {
  const claims = [
    { number: 1, cites: [], category: '方法', paragraphs: ['対象を処理する方法であって、値を取得すること、'] },
    { number: 2, cites: [99], category: '方法', paragraphs: ['存在しない請求項を引用する記載'] },
    { number: 3, cites: [3], category: '方法', paragraphs: ['自分自身を引用する記載'] },
    { number: 4, cites: [9], category: '方法', paragraphs: ['自分より大きい番号を引用する記載'] },
  ];
  const result = synthetic.extract(claims);
  const tree = treeModule.buildTree(result.claims);
  for (const n of [2, 3, 4]) assert.deepStrictEqual(tree.get(n).parents, []);
  assert.doesNotThrow(() => grouping.autoGroup(result.claims, { preset: 'broad' }));
});

test('引用一覧が無くても、本文の引用表現だけで処理できる', () => {
  const claims = synthetic.parallelSeries({ startNumbers: [1, 10] });
  const result = synthetic.extract(claims, { withCite: false });
  assert.strictEqual(result.ok, true);
  // 引用は本文解析から復元される
  assert.strictEqual(result.claims.find((c) => c.number === 2).citationSource, 'text');
  assert.deepStrictEqual(result.claims.find((c) => c.number === 2).citations, [1]);
  assert.strictEqual(result.claims.find((c) => c.number === 1).isIndependent, true);
  assert.doesNotThrow(() => grouping.autoGroup(result.claims, { preset: 'broad' }));
});

test('段落が1つしか取れない請求項ばかりでも動く', () => {
  const claims = [];
  for (let i = 1; i <= 5; i += 1) {
    claims.push({ number: i, cites: [], category: '装置', paragraphs: ['第' + i + 'の対象を備える装置'] });
  }
  const result = synthetic.extract(claims);
  assert.ok(result.claims.every((c) => c.segmentCount >= 1));
  assert.doesNotThrow(() => grouping.autoGroup(result.claims, { preset: 'broad' }));
});

/* ---- 強度プリセットの効き方も案件に依存しない -------------------------- */

test('どの分野・どの番号でも、広め→標準→厳密で候補ペアが減る', () => {
  const countPairs = (groups) => {
    const pairs = new Set();
    for (const g of groups) {
      for (let i = 0; i < g.claimNumbers.length; i += 1) {
        for (let j = i + 1; j < g.claimNumbers.length; j += 1) pairs.add(g.claimNumbers[i] + ':' + g.claimNumbers[j]);
      }
    }
    return pairs.size;
  };
  for (const domain of Object.keys(synthetic.DOMAINS)) {
    const claims = synthetic.parallelSeries({ startNumbers: [3, 31, 64], domain });
    const broad = countPairs(autoGroupsOf(claims, 'broad'));
    const standard = countPairs(autoGroupsOf(claims, 'standard'));
    const strict = countPairs(autoGroupsOf(claims, 'strict'));
    assert.ok(broad >= standard, domain + ': 広め(' + broad + ') >= 標準(' + standard + ')');
    assert.ok(standard >= strict, domain + ': 標準(' + standard + ') >= 厳密(' + strict + ')');
  }
});
