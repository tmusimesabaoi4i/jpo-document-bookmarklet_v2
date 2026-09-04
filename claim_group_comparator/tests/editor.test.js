'use strict';
const test = require('node:test');
const assert = require('node:assert');
const workspace = require('../src/view/workspace');
const helpers = require('./helpers');

function makeClaims(count) {
  const normalize = require('../src/core/normalize');
  const segment = require('../src/core/segment');
  const claims = [];
  for (let i = 1; i <= count; i += 1) {
    const text = '　請求項' + i + 'の第1段落として十分な長さの記載です。　第2段落も十分な長さの記載です。';
    const segments = segment.splitSegments(text);
    claims.push({
      number: i, rawText: text, segments, segmentCount: segments.length,
      citations: i === 1 ? [] : [1], textCitations: i === 1 ? [] : [1], citationSource: 'test',
      isIndependent: i === 1, categoryLabel: '方法', categoryKey: 'method', categoryGroupLabel: '方法',
      termClasses: [], terms: [],
      normalized: normalize.normalizeForCompare(text, { claimNumber: i }),
      normalizedSegments: segments.map((s) => normalize.normalizeSegment(s.text, { claimNumber: i })),
    });
  }
  return claims;
}

function setup(groups) {
  const doc = helpers.blankDocument();
  const win = helpers.fakeWindow(doc, 1920);
  const claims = makeClaims(8);
  const handle = workspace.createWorkspace({
    doc, win, claims,
    autoGroups: groups || [
      { id: 'g1', name: '独立方法クレーム', claimNumbers: [1, 2, 3, 4], source: 'auto', strategy: 'category', score: 0.8, reasons: ['すべて独立項'], manuallyEdited: false, order: 1 },
      { id: 'g2', name: '装置クレーム', claimNumbers: [5, 6], source: 'auto', strategy: 'text', score: 0.7, reasons: ['字面'], manuallyEdited: false, order: 2 },
    ],
    preset: 'broad', meta: {},
    regroup: () => [{ id: 'auto-new', name: '再生成', claimNumbers: [1, 2], source: 'auto', reasons: [], manuallyEdited: false, order: 1 }],
  });
  handle.store.setViewMode('edit');
  return { doc, handle, store: handle.store, claims };
}

// 表示テキストでボタンを探す（UI の文言そのものを検証に使う）
function findButton(scope, label) {
  return scope.querySelectorAll('button').find((el) => el.textContent === label) || null;
}
function groupRow(doc, name) {
  return doc.querySelectorAll('.jcgc-grouprow')
    .find((row) => row.querySelector('.jcgc-grouprow-name').textContent === name) || null;
}
function click(el) { el.dispatchEvent({ type: 'click' }); }

test('グループ編集タブに、全グループの行と編集ボタンが並ぶ', () => {
  const { doc } = setup();
  const rows = doc.querySelectorAll('.jcgc-grouprow');
  assert.strictEqual(rows.length, 2);
  assert.ok(findButton(rows[0], '編集'), '自動生成済みのグループにも編集ボタンがある');
  assert.ok(findButton(rows[0], '複製'));
  assert.ok(findButton(rows[0], '削除'));
  assert.ok(findButton(rows[0], '比較で開く'));
  assert.ok(rows[0].textContent.indexOf('4項｜1・2・3・4') !== -1);
});

test('編集を開くと、名前・所属請求項・一括編集欄・追加候補が出る', () => {
  const { doc } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  const panel = doc.querySelector('.jcgc-editor');
  assert.ok(panel, '編集領域が開かない');
  const labels = panel.querySelectorAll('.jcgc-editor-label').map((el) => el.textContent);
  assert.deepStrictEqual(labels,
    ['グループ名', '所属する請求項', '一括編集', '追加できる請求項', '別グループへ', 'グループの分割']);
  assert.strictEqual(panel.querySelectorAll('.jcgc-chips .jcgc-chip').length, 4);
  assert.ok(findButton(panel, '保存'));
  assert.ok(findButton(panel, 'キャンセル'));
});

test('チップの ← → で並べ替え、× で外せる（ドラッグ＆ドロップに頼らない）', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  const chips = () => doc.querySelectorAll('.jcgc-chips .jcgc-chip');
  // 2 番目のチップ（請求項2）を先頭へ
  click(findButton(chips()[1], '←'));
  assert.deepStrictEqual(
    chips().map((c) => Number(c.getAttribute('data-number'))), [2, 1, 3, 4]);
  click(findButton(chips()[3], '×'));
  assert.deepStrictEqual(
    chips().map((c) => Number(c.getAttribute('data-number'))), [2, 1, 3]);
  // 保存するまでストアは変わらない
  assert.deepStrictEqual(store.getGroup('g1').claimNumbers, [1, 2, 3, 4]);
  click(findButton(doc.querySelector('.jcgc-editor'), '保存'));
  assert.deepStrictEqual(store.getGroup('g1').claimNumbers, [2, 1, 3]);
  assert.strictEqual(store.getGroup('g1').manuallyEdited, true);
});

test('キャンセルすると編集内容を捨てる', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  click(findButton(doc.querySelectorAll('.jcgc-chips .jcgc-chip')[0], '×'));
  click(findButton(doc.querySelector('.jcgc-editor'), 'キャンセル'));
  assert.deepStrictEqual(store.getGroup('g1').claimNumbers, [1, 2, 3, 4]);
  assert.strictEqual(doc.querySelector('.jcgc-editor'), null);
});

test('一括編集欄「1,5,12,20」形式で所属請求項を置き換えられる', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  const panel = doc.querySelector('.jcgc-editor');
  const input = panel.querySelectorAll('input').find((el) => el.getAttribute('title') === '例: 1,5,12,20');
  input.value = '5,7,8';
  click(findButton(panel, '反映'));
  const chips = doc.querySelectorAll('.jcgc-chips .jcgc-chip').map((c) => Number(c.getAttribute('data-number')));
  assert.deepStrictEqual(chips, [5, 7, 8]);
  click(findButton(doc.querySelector('.jcgc-editor'), '保存'));
  assert.deepStrictEqual(store.getGroup('g1').claimNumbers, [5, 7, 8]);
});

test('一括編集欄の誤りは保存前にエラーとして出す', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  const panel = doc.querySelector('.jcgc-editor');
  const input = panel.querySelectorAll('input').find((el) => el.getAttribute('title') === '例: 1,5,12,20');
  input.value = '1,1,999';
  click(findButton(panel, '反映'));
  const errors = doc.querySelectorAll('.jcgc-errors li').map((el) => el.textContent);
  assert.ok(errors.some((e) => e.indexOf('存在しない') !== -1), errors.join(' / '));
  assert.ok(errors.some((e) => e.indexOf('重複') !== -1), errors.join(' / '));
  assert.deepStrictEqual(store.getGroup('g1').claimNumbers, [1, 2, 3, 4]);
});

test('追加できる請求項から ＋ で追加できる', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  const pool = doc.querySelector('.jcgc-pool');
  // 所属していない請求項だけが候補に出る
  const candidates = pool.querySelectorAll('.jcgc-chip').map((c) => c.textContent.replace('＋', ''));
  assert.deepStrictEqual(candidates, ['請求項5', '請求項6', '請求項7', '請求項8']);
  click(findButton(pool.querySelectorAll('.jcgc-chip')[0], '＋'));
  click(findButton(doc.querySelector('.jcgc-editor'), '保存'));
  assert.deepStrictEqual(store.getGroup('g1').claimNumbers, [1, 2, 3, 4, 5]);
});

test('別グループへ「移動」と「複製」を選べる', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  let panel = doc.querySelector('.jcgc-editor');
  let selects = panel.querySelectorAll('select');
  selects[0].value = '3';       // 請求項3
  selects[1].value = 'g2';      // 装置クレームへ
  click(findButton(panel, '複製'));
  assert.ok(store.getGroup('g1').claimNumbers.indexOf(3) !== -1, '複製では元に残る');
  assert.deepStrictEqual(store.getGroup('g2').claimNumbers, [5, 6, 3]);

  panel = doc.querySelector('.jcgc-editor');
  selects = panel.querySelectorAll('select');
  selects[0].value = '4';
  selects[1].value = 'g2';
  click(findButton(panel, '移動'));
  assert.strictEqual(store.getGroup('g1').claimNumbers.indexOf(4), -1, '移動では元から外れる');
  assert.ok(store.getGroup('g2').claimNumbers.indexOf(4) !== -1);
});

test('グループの分割は確認してから実行する', () => {
  const { doc, store, handle } = setup();
  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  const panel = doc.querySelector('.jcgc-editor');
  panel.querySelectorAll('input').find((el) => el.getAttribute('type') === 'number').value = '2';
  click(findButton(panel, '分割'));
  assert.strictEqual(store.getGroups().length, 2, '確認前は分割しない');
  click(handle.ui.bannerButtons.yes);
  assert.strictEqual(store.getGroups().length, 3);
  assert.deepStrictEqual(store.getGroups()[0].claimNumbers, [1, 2]);
  assert.deepStrictEqual(store.getGroups()[1].claimNumbers, [3, 4]);
});

test('複数グループの統合は確認してから実行する', () => {
  const { doc, store, handle } = setup();
  const boxes = doc.querySelectorAll('.jcgc-grouprow input');
  boxes[0].dispatchEvent({ type: 'change' });
  boxes[1].dispatchEvent({ type: 'change' });
  click(findButton(doc.querySelector('.jcgc-section'), '選択したグループを統合'));
  assert.strictEqual(store.getGroups().length, 2, '確認前は統合しない');
  click(handle.ui.bannerButtons.yes);
  assert.strictEqual(store.getGroups().length, 1);
  assert.deepStrictEqual(store.getGroups()[0].claimNumbers, [1, 2, 3, 4, 5, 6]);
});

test('グループの削除は確認してから実行する', () => {
  const { doc, store, handle } = setup();
  click(findButton(groupRow(doc, '装置クレーム'), '削除'));
  assert.strictEqual(store.getGroups().length, 2, '確認前は削除しない');
  click(handle.ui.bannerButtons.yes);
  assert.deepStrictEqual(store.getGroups().map((g) => g.id), ['g1']);
});

test('自動生成時の状態へ戻すのも確認してから', () => {
  const { doc, store, handle } = setup();
  store.addGroup({ name: '自分用', claimNumbers: [7] });
  click(findButton(doc.querySelector('.jcgc-section'), '自動生成時の状態へ戻す'));
  assert.strictEqual(store.getGroups().length, 3, '確認前は戻さない');
  click(handle.ui.bannerButtons.yes);
  assert.deepStrictEqual(store.getGroups().map((g) => g.id), ['g1', 'g2']);
});

test('新規グループを作るとそのまま編集状態になる', () => {
  const { doc, store } = setup();
  click(findButton(doc.querySelector('.jcgc-section'), '新規グループ作成'));
  assert.strictEqual(store.getGroups().length, 3);
  assert.ok(doc.querySelector('.jcgc-grouprow.is-editing'), '新規グループが編集状態で開かない');
  assert.strictEqual(store.getGroups()[2].source, 'manual');
});

test('直前操作の取り消しができる', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '装置クレーム'), '複製'));
  assert.strictEqual(store.getGroups().length, 3);
  click(findButton(doc.querySelector('.jcgc-section'), '元に戻す（直前操作の取り消し）'));
  assert.strictEqual(store.getGroups().length, 2);
});

test('複数グループの一括テキストを書き出して読み込める', () => {
  const { doc, store, handle } = setup();
  const area = doc.querySelector('#jcgc-bulk-groups');
  assert.ok(area.value.indexOf('# 独立方法クレーム') !== -1);
  assert.ok(area.value.indexOf('1,2,3,4') !== -1);

  area.value = '# 方法系\n1,2\n\n# 装置系\n5,6,7\n';
  area.dispatchEvent({ type: 'input', target: area });
  click(findButton(doc.querySelectorAll('.jcgc-section')[1], 'このテキストでグループを置き換える'));
  assert.strictEqual(store.getGroups().length, 2, '確認前は置き換えない');
  click(handle.ui.bannerButtons.yes);
  assert.deepStrictEqual(store.getGroups().map((g) => g.name), ['方法系', '装置系']);
  assert.deepStrictEqual(store.getGroups()[1].claimNumbers, [5, 6, 7]);
});

test('一括テキストの誤りは置き換え前に一覧で示す', () => {
  const { doc, store } = setup();
  const area = doc.querySelector('#jcgc-bulk-groups');
  area.value = '# だめな例\n1,1,999\n';
  area.dispatchEvent({ type: 'input', target: area });
  click(findButton(doc.querySelectorAll('.jcgc-section')[1], 'このテキストでグループを置き換える'));
  const errors = doc.querySelectorAll('.jcgc-section .jcgc-errors li').map((el) => el.textContent);
  assert.ok(errors.length >= 2, errors.join(' / '));
  assert.strictEqual(store.getGroups().length, 2);
});

test('編集後に「比較で開く」で比較タブへ戻れる', () => {
  const { doc, store } = setup();
  click(findButton(groupRow(doc, '装置クレーム'), '比較で開く'));
  assert.strictEqual(store.getState().viewMode, 'compare');
  assert.strictEqual(store.getState().selectedGroupId, 'g2');
  assert.deepStrictEqual(helpers.cardNumbers(doc), [5, 6]);
});

test('手動編集済みのグループにはバッジが出る', () => {
  const { doc, store } = setup();
  store.addMemberToGroup('g1', 5);
  assert.ok(groupRow(doc, '独立方法クレーム').textContent.indexOf('手動編集済み') !== -1);
});

test('追加候補を編集領域から昇格・除外できる', () => {
  const { doc, store } = setup([
    {
      id: 'g1', name: '独立方法クレーム', claimNumbers: [1, 2], candidateNumbers: [3, 4],
      source: 'auto', strategy: 'text', score: 0.8, reasons: ['字面'], manuallyEdited: false, order: 1,
    },
  ]);
  // 一覧に候補の数が出る
  assert.ok(groupRow(doc, '独立方法クレーム').textContent.indexOf('追加候補 3・4') !== -1);

  click(findButton(groupRow(doc, '独立方法クレーム'), '編集'));
  const chips = () => doc.querySelectorAll('#jcgc-candidate-chips .jcgc-chip');
  assert.deepStrictEqual(chips().map((c) => c.getAttribute('data-candidate')), ['3', '4']);

  click(findButton(chips()[0], '昇格'));
  assert.deepStrictEqual(store.getGroup('g1').claimNumbers, [1, 2, 3]);
  assert.deepStrictEqual(store.getGroup('g1').candidateNumbers, ['4'].map(Number));

  click(findButton(doc.querySelectorAll('#jcgc-candidate-chips .jcgc-chip')[0], '×'));
  assert.deepStrictEqual(store.getGroup('g1').candidateNumbers, []);
});
