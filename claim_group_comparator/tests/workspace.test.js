'use strict';
const test = require('node:test');
const assert = require('node:assert');
const workspace = require('../src/view/workspace');
const grouping = require('../src/core/grouping');
const helpers = require('./helpers');

/* ---- テスト用の請求項レコードを組み立てる ------------------------------ */
function makeClaims(count, segmentsPerClaim) {
  const normalize = require('../src/core/normalize');
  const segment = require('../src/core/segment');
  const claims = [];
  for (let i = 1; i <= count; i += 1) {
    // 段落数をわざと不揃いにして「対応する第n段落なし」を出せるようにする
    const segCount = segmentsPerClaim ? segmentsPerClaim(i) : (3 + (i % 3));
    const parts = [];
    for (let s = 1; s <= segCount; s += 1) {
      parts.push('　請求項' + i + 'の第' + s + '段落として十分な長さの記載がここに入ります。');
    }
    const text = parts.join('');
    const segments = segment.splitSegments(text);
    claims.push({
      number: i,
      rawText: text,
      segments,
      segmentCount: segments.length,
      citations: i === 1 ? [] : [1],
      textCitations: i === 1 ? [] : [1],
      citationSource: 'test',
      isIndependent: i === 1,
      categoryLabel: '方法',
      categoryKey: 'method',
      categoryGroupLabel: '方法',
      termClasses: [],
      terms: [],
      normalized: normalize.normalizeForCompare(text, { claimNumber: i }),
      normalizedSegments: segments.map((s) => normalize.normalizeSegment(s.text, { claimNumber: i })),
    });
  }
  return claims;
}

// 段落ごとに内容の違う請求項レコードを作る（段落対応の検証用）
function makeDistinctClaim(number, segmentTexts) {
  const normalize = require('../src/core/normalize');
  const segments = segmentTexts.map((text, i) => ({ index: i + 1, text, depth: 1, source: 'test' }));
  return {
    number,
    rawText: segmentTexts.join('　'),
    segments,
    segmentCount: segments.length,
    citations: number === 1 ? [] : [1],
    textCitations: number === 1 ? [] : [1],
    citationSource: 'test',
    isIndependent: number === 1,
    categoryLabel: '方法',
    categoryKey: 'method',
    categoryGroupLabel: '方法',
    termClasses: [],
    terms: [],
    normalized: normalize.normalizeForCompare(segmentTexts.join(''), { claimNumber: number }),
    normalizedSegments: segments.map((s) => normalize.normalizeSegment(s.text, { claimNumber: number })),
    segmentTermClasses: segments.map(() => []),
  };
}

function setup(options) {
  const opts = options || {};
  const doc = helpers.blankDocument();
  const win = helpers.fakeWindow(doc, opts.width || 1920);
  const claims = opts.claims || makeClaims(opts.count || 4);
  const groups = opts.groups || [{
    id: 'g1',
    name: 'テストグループ',
    claimNumbers: claims.map((c) => c.number),
    source: 'auto',
    strategy: 'text',
    score: 0.8,
    reasons: ['すべて独立項', '字面が部分的に一致'],
    manuallyEdited: false,
    order: 1,
  }];
  const handle = workspace.createWorkspace({
    doc, win, claims,
    autoGroups: groups,
    preset: 'broad',
    meta: { lappnum: '特願2025-557557', sourceLabel: 'クレーム解析結果' },
    regroup: opts.regroup || (() => groups),
  });
  return { doc, win, claims, handle, store: handle.store };
}

/* ---- 骨組み ------------------------------------------------------------ */

test('比較タブの骨組みを組み立てる（ヘッダー・操作バー・段落バー・グリッド）', () => {
  const { doc } = setup({ count: 3 });
  assert.ok(doc.querySelector('.jcgc-header'), 'ヘッダーが無い');
  assert.ok(doc.querySelector('.jcgc-toolbar'), '操作バーが無い');
  assert.ok(doc.querySelector('#jcgc-segbar'), '段落選択バーが無い');
  assert.ok(doc.querySelector('#jcgc-grid'), 'カードグリッドが無い');
  assert.ok(doc.querySelector('#jcgc-style'), 'スタイルが無い');
  assert.strictEqual(doc.querySelector('.jcgc-title').textContent, '請求項グループ比較');
  // ヘッダーとツールバーは sticky（縦スクロールしても残る）
  assert.ok(doc.querySelector('#jcgc-style').textContent.indexOf('.jcgc-header{position:sticky') !== -1);
});

test('必要な操作（グループ選択・再グルーピング・強度・列数・密度）が置かれている', () => {
  const { doc } = setup({ count: 3 });
  assert.ok(doc.querySelector('#jcgc-group-select'));
  assert.ok(doc.querySelector('#jcgc-columns'));
  assert.ok(doc.querySelector('#jcgc-density'));
  const labels = doc.querySelectorAll('.jcgc-toolbar label').map((el) => el.textContent);
  assert.deepStrictEqual(labels, ['グループ選択', 'グルーピング強度', '列数', '表示密度', '強調']);
  const presets = doc.querySelectorAll('[data-preset]').map((el) => el.textContent);
  assert.deepStrictEqual(presets, ['広め', '標準', '厳密']);
});

test('既定のグルーピング強度は「広め」', () => {
  const { store, doc } = setup({ count: 3 });
  assert.strictEqual(store.getState().preset, 'broad');
  assert.strictEqual(grouping.DEFAULT_PRESET, 'broad');
  const active = doc.querySelectorAll('[data-preset]').filter((el) => el.getAttribute('class').indexOf('is-active') !== -1);
  assert.deepStrictEqual(active.map((el) => el.getAttribute('data-preset')), ['broad']);
});

/* ---- カード ------------------------------------------------------------ */

test('カードに請求項番号・独立/従属・引用請求項・カテゴリーを出す', () => {
  const { doc } = setup({ count: 3 });
  const cards = doc.querySelectorAll('.jcgc-card');
  assert.strictEqual(cards.length, 3);
  assert.strictEqual(cards[0].querySelector('.jcgc-card-no').textContent, '請求項1');
  assert.strictEqual(cards[0].querySelector('.jcgc-card-tags').textContent, '独立項｜方法');
  assert.strictEqual(cards[1].querySelector('.jcgc-card-tags').textContent, '従属項｜←請求項1｜方法');
});

test('多数の引用はまとめて表示する', () => {
  assert.strictEqual(workspace.formatCitations([1]), '←請求項1');
  assert.strictEqual(workspace.formatCitations([11, 12]), '←請求項11・請求項12');
  const many = Array.from({ length: 14 }, (_, i) => i + 1);
  assert.strictEqual(workspace.formatCitations(many), '←請求項1〜14（14件）');
});

test('本文は段落ごとに表示され、表示用の段落番号が付く', () => {
  const { doc, claims } = setup({ count: 2 });
  const items = doc.querySelectorAll('.jcgc-card')[0].querySelectorAll('.jcgc-seg');
  assert.strictEqual(items.length, claims[0].segmentCount);
  assert.strictEqual(items[0].querySelector('.jcgc-seg-no').textContent, '1');
  assert.strictEqual(items[0].getAttribute('data-seg'), '1');
  // 段落番号は表示専用で、本文には混ぜない
  assert.strictEqual(items[0].querySelector('.jcgc-seg-text').textContent, claims[0].segments[0].text);
});

test('本文は textContent で入れる（HTML を解釈させない）', () => {
  const claims = makeClaims(1);
  claims[0].segments = [{ index: 1, text: '<img src=x onerror="alert(1)">を含む記載', depth: 1 }];
  claims[0].segmentCount = 1;
  const { doc } = setup({ claims, groups: [{ id: 'g1', name: 'x', claimNumbers: [1], source: 'auto', reasons: [], manuallyEdited: false, order: 1 }] });
  const textEl = doc.querySelector('.jcgc-seg-text');
  assert.strictEqual(textEl.textContent, '<img src=x onerror="alert(1)">を含む記載');
  assert.strictEqual(textEl.querySelectorAll('img').length, 0, 'HTML として解釈されてはいけない');
  assert.ok(doc.querySelector('#jcgc-grid').innerHTML.indexOf('&lt;img') !== -1, 'エスケープされて出力される');
});

/* ---- 段落の同期選択 ---------------------------------------------------- */

test('段落をクリックすると、同じグループの全カードの同じ段落が強調される', () => {
  const { doc, store } = setup({ count: 6, claims: makeClaims(6, () => 5) });
  const firstCard = doc.querySelectorAll('.jcgc-card')[0];
  firstCard.querySelectorAll('.jcgc-seg')[2].dispatchEvent({ type: 'click' });

  assert.strictEqual(store.getState().selectedSegment, 3);
  const selected = doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1);
  assert.strictEqual(selected.length, 6, '6枚すべての第3段落が強調される');
  assert.ok(selected.every((el) => el.getAttribute('data-seg') === '3'));
});

test('上部の段落ボタンからも選択できる', () => {
  const { doc, store } = setup({ count: 4, claims: makeClaims(4, () => 4) });
  const buttons = doc.querySelectorAll('[data-segbtn]');
  assert.strictEqual(buttons[0].textContent, '全体');
  assert.strictEqual(buttons[2].textContent, '段落2');
  buttons[2].dispatchEvent({ type: 'click' });
  assert.strictEqual(store.getState().selectedSegment, 2);
  const selected = doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1);
  assert.strictEqual(selected.length, 4);
});

test('十分に似た段落が無いカードには、同じ段落番号へ落とさず「類似段落なし」と出す', () => {
  // 内容が互いに無関係な 2 請求項（同じ段落番号は存在する）
  const claims = [
    makeDistinctClaim(1, ['第1の溶媒に化合物を溶解させて溶液を調製する記載です。',
      '前記溶液を撹拌しながら加熱して結晶を析出させる記載です。']),
    makeDistinctClaim(2, ['利用者の識別情報を認証サーバへ送信する記載です。',
      '前記認証サーバから応答を受信して画面へ表示する記載です。']),
  ];
  const { doc, store } = setup({ claims, groups: [{ id: 'g1', name: 'x', claimNumbers: [1, 2], source: 'auto', reasons: [], manuallyEdited: false, order: 1 }] });
  store.selectSegment(2, 1);

  const selected = doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1);
  assert.deepStrictEqual(
    selected.map((el) => el.closest('.jcgc-card').getAttribute('data-claim')), ['1'],
    '似ていない請求項2で、同じ段落番号を強調してはいけない');

  const notes = doc.querySelectorAll('.jcgc-missing')
    .filter((el) => el.getAttribute('class').indexOf('jcgc-hidden') === -1);
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].textContent, '類似段落なし');
});

test('追加候補の請求項もカードとして並べ、印を付ける', () => {
  const claims = makeClaims(3, () => 3);
  const { doc } = setup({
    claims,
    groups: [{
      id: 'g1', name: 'x', claimNumbers: [1, 2], candidateNumbers: [3],
      source: 'auto', reasons: ['字面'], manuallyEdited: false, order: 1,
    }],
  });
  assert.deepStrictEqual(helpers.cardNumbers(doc), [1, 2, 3]);
  const candidateCards = doc.querySelectorAll('.jcgc-card')
    .filter((el) => el.getAttribute('class').indexOf('is-candidate') !== -1);
  assert.deepStrictEqual(candidateCards.map((el) => el.getAttribute('data-claim')), ['3']);
  assert.ok(doc.querySelector('.jcgc-groupinfo').textContent.indexOf('追加候補 3') !== -1);
});

test('段落番号がずれていても、内容が対応する段落を強調する', () => {
  // 請求項2 には装置固有の段落が 1 つ余分に挟まっている
  const claims = [
    makeDistinctClaim(1, [
      'ユーザ機器を動作させるための方法であって、',
      '複数の送信及び受信ポイントから信号を受信することと、',
      '前記信号に基づいてアップリンク制御情報ＵＣＩを決定することと、',
      '線形結合係数情報を第1のグループと第2のグループとに分割することと、']),
    makeDistinctClaim(2, [
      'ユーザ機器であって、',
      '複数の送信及び受信ポイントから信号を受信するための送受信機と、',
      '1つ以上のプロセッサと、を備え、前記1つ以上のプロセッサは、',
      '前記信号に基づいてアップリンク制御情報ＵＣＩを決定し、',
      '線形結合係数情報を第1のグループと第2のグループとに分割し、']),
  ];
  const { doc, store } = setup({ claims, groups: [{ id: 'g1', name: 'x', claimNumbers: [1, 2], source: 'auto', reasons: [], manuallyEdited: false, order: 1 }] });

  // 請求項1 の第3段落（ＵＣＩの決定）を選ぶと、請求項2 では第4段落が光る
  store.selectSegment(3, 1);
  let selected = doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1);
  assert.deepStrictEqual(
    selected.map((el) => el.closest('.jcgc-card').getAttribute('data-claim') + ':' + el.getAttribute('data-seg')),
    ['1:3', '2:4']);

  // 逆向き（請求項2 の第5段落を選ぶと請求項1 では第4段落）も成り立つ
  store.selectSegment(5, 2);
  selected = doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1);
  assert.deepStrictEqual(
    selected.map((el) => el.closest('.jcgc-card').getAttribute('data-claim') + ':' + el.getAttribute('data-seg')),
    ['1:4', '2:5']);
});

test('上部の段落ボタンからの選択は、グループ先頭の請求項を基準にする', () => {
  const claims = [
    makeDistinctClaim(1, [
      'ユーザ機器を動作させるための方法であって、',
      '前記信号に基づいてアップリンク制御情報ＵＣＩを決定することと、']),
    makeDistinctClaim(2, [
      'ユーザ機器であって、',
      '1つ以上のプロセッサと、を備え、前記1つ以上のプロセッサは、',
      '前記信号に基づいてアップリンク制御情報ＵＣＩを決定し、']),
  ];
  const { doc, store } = setup({ claims, groups: [{ id: 'g1', name: 'x', claimNumbers: [1, 2], source: 'auto', reasons: [], manuallyEdited: false, order: 1 }] });
  store.selectSegment(2, null);
  const selected = doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1);
  assert.deepStrictEqual(
    selected.map((el) => el.closest('.jcgc-card').getAttribute('data-claim') + ':' + el.getAttribute('data-seg')),
    ['1:2', '2:3']);
});

test('「選択段落を強調」と「選択段落のみ」を切り替えられる', () => {
  const { doc, store } = setup({ count: 3, claims: makeClaims(3, () => 4) });
  const grid = doc.querySelector('#jcgc-grid');
  store.selectSegment(2);
  assert.ok(grid.getAttribute('class').indexOf('is-dim') !== -1);
  store.setHighlightMode('only');
  assert.ok(grid.getAttribute('class').indexOf('is-only') !== -1);
  assert.ok(grid.getAttribute('class').indexOf('is-dim') === -1);
  // 「全体」に戻すとどちらのモードも外れる
  store.selectSegment(0);
  assert.ok(grid.getAttribute('class').indexOf('is-only') === -1);
});

test('段落選択ではカードを作り直さない（同じ要素が残る）', () => {
  const { doc, store } = setup({ count: 4, claims: makeClaims(4, () => 4) });
  const before = doc.querySelectorAll('.jcgc-card')[0];
  store.selectSegment(2);
  store.selectSegment(3);
  const after = doc.querySelectorAll('.jcgc-card')[0];
  assert.strictEqual(before, after, '段落選択のたびに DOM を作り直してはいけない');
});

/* ---- 100 カード -------------------------------------------------------- */

for (const count of [1, 2, 4, 6, 8, 9, 16, 30, 100]) {
  test(`${count}枚のカードを表示できる`, () => {
    const claims = makeClaims(count, () => 4);
    const { doc, handle } = setup({
      claims,
      groups: [{ id: 'g1', name: String(count) + '枚', claimNumbers: claims.map((c) => c.number), source: 'auto', reasons: [], manuallyEdited: false, order: 1 }],
    });
    assert.strictEqual(doc.querySelectorAll('.jcgc-card').length, count);
    const style = doc.querySelector('#jcgc-grid').getAttribute('style');
    assert.ok(/--jcgc-cols:\d+/.test(style), 'グリッドの列数が設定される');
    assert.ok(handle.ui.lastLayout.columns >= 1);
  });
}

test('100枚でも段落選択が全カードへ反映され、遅くならない', () => {
  const claims = makeClaims(100, () => 6);
  const { doc, store } = setup({
    claims,
    groups: [{ id: 'g1', name: '100枚', claimNumbers: claims.map((c) => c.number), source: 'auto', reasons: [], manuallyEdited: false, order: 1 }],
  });
  assert.strictEqual(doc.querySelectorAll('.jcgc-card').length, 100);
  const started = Date.now();
  store.selectSegment(4);
  const elapsed = Date.now() - started;
  const selected = doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1);
  assert.strictEqual(selected.length, 100);
  assert.ok(elapsed < 500, '段落選択に ' + elapsed + 'ms かかった（索引を使っていない可能性）');
});

/* ---- レイアウト --------------------------------------------------------- */

test('画面幅に応じて列数が変わる', () => {
  const claims = makeClaims(30, () => 3);
  const groups = [{ id: 'g1', name: '30枚', claimNumbers: claims.map((c) => c.number), source: 'auto', reasons: [], manuallyEdited: false, order: 1 }];
  const wide = setup({ claims, groups, width: 2560 });
  const narrow = setup({ claims, groups, width: 768 });
  assert.ok(wide.handle.ui.lastLayout.columns > narrow.handle.ui.lastLayout.columns);
  assert.strictEqual(narrow.handle.ui.lastLayout.columns, 2);
});

test('表示密度を変えると body のクラスと列数が変わる', () => {
  const claims = makeClaims(30, () => 3);
  const { doc, store, handle } = setup({
    claims,
    groups: [{ id: 'g1', name: '30枚', claimNumbers: claims.map((c) => c.number), source: 'auto', reasons: [], manuallyEdited: false, order: 1 }],
    width: 1920,
  });
  const before = handle.ui.lastLayout.columns;
  store.setDensity('roomy');
  assert.strictEqual(doc.body.getAttribute('class'), 'jcgc-density-roomy');
  assert.ok(handle.ui.lastLayout.columns < before);
});

/* ---- グループ切替と根拠表示 --------------------------------------------- */

test('グループ一覧に名前・所属数・請求項番号・自動/手動を出す', () => {
  const { doc } = setup({ count: 3 });
  const option = doc.querySelector('#jcgc-group-select').querySelectorAll('option')[0];
  assert.ok(option.textContent.indexOf('テストグループ') !== -1);
  assert.ok(option.textContent.indexOf('3項') !== -1);
  assert.ok(option.textContent.indexOf('1・2・3') !== -1);
  assert.ok(option.textContent.indexOf('自動') !== -1);
});

test('自動グループの根拠と、法的判断ではない旨の注記を出す', () => {
  const { doc } = setup({ count: 3 });
  const reasons = doc.querySelectorAll('.jcgc-reasons li').map((el) => el.textContent);
  assert.deepStrictEqual(reasons, ['すべて独立項', '字面が部分的に一致']);
  const note = doc.querySelector('.jcgc-note').textContent;
  assert.ok(note.indexOf('法的な同一性の判定ではありません') !== -1);
});

test('グループを切り替えるとカードが入れ替わる', () => {
  const claims = makeClaims(6, () => 3);
  const groups = [
    { id: 'g1', name: 'A', claimNumbers: [1, 2, 3], source: 'auto', reasons: ['x'], manuallyEdited: false, order: 1 },
    { id: 'g2', name: 'B', claimNumbers: [4, 5], source: 'manual', reasons: ['y'], manuallyEdited: false, order: 2 },
  ];
  const { doc, store } = setup({ claims, groups });
  assert.deepStrictEqual(helpers.cardNumbers(doc), [1, 2, 3]);
  store.selectGroup('g2');
  assert.deepStrictEqual(helpers.cardNumbers(doc), [4, 5]);
  assert.ok(doc.querySelector('.jcgc-groupinfo').textContent.indexOf('手動') !== -1);
});

test('グループ編集の結果が比較画面へ直ちに反映される', () => {
  const { doc, store } = setup({ count: 4 });
  assert.strictEqual(doc.querySelectorAll('.jcgc-card').length, 4);
  store.setGroupMembers('g1', [1, 3]);
  assert.deepStrictEqual(helpers.cardNumbers(doc), [1, 3]);
  assert.ok(doc.querySelector('.jcgc-groupinfo').textContent.indexOf('手動編集済み') !== -1);
});

/* ---- 再グルーピングの確認 ----------------------------------------------- */

test('手動編集があるとき、再グルーピングは確認してから実行する', () => {
  const nextGroups = [{ id: 'auto-new', name: '新しい自動', claimNumbers: [1, 2], source: 'auto', reasons: ['字面'], manuallyEdited: false, order: 1 }];
  const { doc, store, handle } = setup({ count: 4, regroup: () => nextGroups });
  store.addGroup({ name: '自分用', claimNumbers: [1] });

  const regroupButton = handle.ui.regroupButton;
  regroupButton.dispatchEvent({ type: 'click' });
  // まだ実行されていない（確認バーが出ている）
  assert.ok(doc.querySelector('#jcgc-banner').getAttribute('class').indexOf('jcgc-hidden') === -1);
  assert.ok(store.getGroups().some((g) => g.id === 'g1'), '確認前に自動グループを差し替えない');

  handle.ui.bannerButtons.yes.dispatchEvent({ type: 'click' });
  const ids = store.getGroups().map((g) => g.id);
  assert.ok(ids.indexOf('auto-new') !== -1, '確認後は再グルーピングされる');
  assert.ok(store.getGroups().some((g) => g.name === '自分用'), '手動グループは残る');
});

test('手動編集が無ければ、再グルーピングは確認なしで実行する', () => {
  const nextGroups = [{ id: 'auto-new', name: '新しい自動', claimNumbers: [1, 2], source: 'auto', reasons: ['字面'], manuallyEdited: false, order: 1 }];
  const { store, handle } = setup({ count: 4, regroup: () => nextGroups });
  handle.ui.regroupButton.dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(store.getGroups().map((g) => g.id), ['auto-new']);
});

test('グルーピング強度を変えると再グルーピングされる', () => {
  const calls = [];
  const { handle, store } = setup({
    count: 4,
    regroup(presetKey) {
      calls.push(presetKey);
      return [{ id: 'auto-' + presetKey, name: presetKey, claimNumbers: [1, 2], source: 'auto', reasons: [], manuallyEdited: false, order: 1 }];
    },
  });
  handle.ui.presetButtons.strict.dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(calls, ['strict']);
  assert.strictEqual(store.getState().preset, 'strict');
});

/* ---- 実データでの通し確認 ----------------------------------------------- */

test('実物の出願で、自動グループのカードが描画できる',
  { skip: !helpers.hasFixture('multiIndependent') }, () => {
    const result = helpers.extract('multiIndependent');
    const auto = grouping.autoGroup(result.claims, { preset: 'broad' });
    const doc = helpers.blankDocument();
    const win = helpers.fakeWindow(doc, 1920);
    const handle = workspace.createWorkspace({
      doc, win, claims: result.claims, autoGroups: auto.groups, preset: 'broad',
      meta: { lappnum: '特願2024-536222' },
      regroup: (p) => grouping.autoGroup(result.claims, { preset: p }).groups,
    });
    // カードは「正式メンバー → 追加候補」の順に並ぶ
    const expected = (g) => g.claimNumbers.concat(
      g.candidateNumbers.filter((n) => g.claimNumbers.indexOf(n) === -1));
    assert.deepStrictEqual(helpers.cardNumbers(doc), expected(handle.store.getSelectedGroup()));
    // どのグループへ切り替えても描画できる
    for (const g of handle.store.getGroups()) {
      handle.store.selectGroup(g.id);
      assert.deepStrictEqual(helpers.cardNumbers(doc), expected(g), g.name);
    }
  });

test('元タブが閉じられたことを知らせる案内を出せる', () => {
  const { doc, handle } = setup({ count: 2 });
  handle.markDetached();
  const banner = doc.querySelector('#jcgc-banner');
  assert.ok(banner.getAttribute('class').indexOf('jcgc-hidden') === -1);
  assert.ok(banner.textContent.indexOf('元のクレームチェッカーのタブが閉じられました') !== -1);
});
