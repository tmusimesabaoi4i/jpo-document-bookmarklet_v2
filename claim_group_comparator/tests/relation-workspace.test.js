'use strict';
/*
 * relation-workspace.test.js — 比較タブの画面（手動関連付け版）
 *
 * 「自動で関連付かないこと」「利用者の操作だけで関連が作られること」を中心に確かめる。
 */
const test = require('node:test');
const assert = require('node:assert');
const relationWorkspace = require('../src/view/relation-workspace');
const relationsCore = require('../src/core/relations');
const helpers = require('./helpers');

function makeClaims(count, segmentsPerClaim) {
  const normalize = require('../src/core/normalize');
  const segment = require('../src/core/segment');
  const claims = [];
  for (let i = 1; i <= count; i += 1) {
    const segCount = segmentsPerClaim ? segmentsPerClaim(i) : 4;
    const parts = [];
    for (let s = 1; s <= segCount; s += 1) {
      parts.push('　請求項' + i + 'の第' + s + '段落として十分な長さの記載がここに入ります。');
    }
    const text = parts.join('');
    const segments = segment.splitSegments(text);
    claims.push({
      number: i, rawText: text, segments, segmentCount: segments.length,
      citations: i === 1 ? [] : [1], textCitations: i === 1 ? [] : [1], citationSource: 'test',
      isIndependent: i === 1, categoryLabel: '方法', categoryKey: 'method', categoryGroupLabel: '方法',
      termClasses: [], terms: [],
      normalized: normalize.normalizeForCompare(text, { claimNumber: i }),
      normalizedSegments: segments.map((s) => normalize.normalizeSegment(s.text, { claimNumber: i })),
      segmentTermClasses: segments.map(() => []),
    });
  }
  return claims;
}

function setup(options) {
  const opts = options || {};
  const doc = helpers.blankDocument();
  const win = helpers.fakeWindow(doc, opts.width || 1920);
  const claims = opts.claims || makeClaims(opts.count || 3);
  const groups = opts.groups || [
    {
      id: 'g1', name: '比較グループ1', claimNumbers: claims.map((c) => c.number),
      candidateNumbers: [], source: 'auto', strategy: 'text', score: 0.8,
      reasons: ['字面が部分的に一致'], manuallyEdited: false, order: 1,
    },
  ];
  const handle = relationWorkspace.createWorkspace({
    doc, win, claims, autoGroups: groups, preset: 'broad',
    meta: { lappnum: '特願0000-000000', title: '書類比較・クレームチェッカー' },
    regroup: opts.regroup || (() => groups),
  });
  return { doc, win, claims, handle, store: handle.store, relationStore: handle.relationStore };
}

function findButton(scope, label) {
  return scope.querySelectorAll('button').find((el) => el.textContent === label) || null;
}
function click(el) { el.dispatchEvent({ type: 'click' }); }
function segOf(doc, claimNumber, index) {
  const card = doc.querySelectorAll('.jcgc-card').find((c) => c.getAttribute('data-claim') === String(claimNumber));
  return card.querySelectorAll('.jcgc-seg')[index - 1];
}
function highlighted(doc) {
  return doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1)
    .map((el) => el.closest('.jcgc-card').getAttribute('data-claim') + ':' + el.getAttribute('data-seg'));
}
function checkedRows(doc) {
  return doc.querySelectorAll('.jcgc-seg')
    .filter((el) => el.getAttribute('class').indexOf('is-checked') !== -1)
    .map((el) => el.closest('.jcgc-card').getAttribute('data-claim') + ':' + el.getAttribute('data-seg'));
}

/* ---- 初期状態 ----------------------------------------------------------- */

test('初期状態は関連 0 件で、どの段落も関連付いていない', () => {
  const { doc, relationStore } = setup({ count: 3 });
  assert.strictEqual(relationStore.countRelations('g1'), 0);
  assert.deepStrictEqual(highlighted(doc), [], '勝手に強調される段落があってはいけない');
  assert.deepStrictEqual(checkedRows(doc), []);
  assert.ok(doc.querySelector('#jcgcr-bar').textContent.indexOf('まだ関連はありません') !== -1);
});

test('段落にチェックボックスが付き、関連バーは「関連なし」だけ', () => {
  const { doc } = setup({ count: 2 });
  const boxes = doc.querySelectorAll('.jcgcr-check');
  const segs = doc.querySelectorAll('.jcgc-seg');
  assert.strictEqual(boxes.length, segs.length, 'すべての段落にチェックボックスがある');
  const buttons = doc.querySelectorAll('[data-relation]').map((el) => el.textContent);
  assert.deepStrictEqual(buttons, ['関連なし']);
});

test('段落番号の自動関連付けをしない（同じ番号でも強調されない）', () => {
  const { doc, handle } = setup({ count: 3 });
  handle.toggleParagraph(1, 2);
  // 選択した段落だけがチェック状態。他の請求項の第2段落は無関係
  assert.deepStrictEqual(checkedRows(doc), ['1:2']);
  assert.deepStrictEqual(highlighted(doc), []);
});

/* ---- 選択と関連の作成 --------------------------------------------------- */

test('複数請求項・同一請求項から複数段落を選べる', () => {
  const { doc, handle } = setup({ count: 3 });
  handle.toggleParagraph(1, 1);
  handle.toggleParagraph(1, 2);
  handle.toggleParagraph(2, 4);
  handle.toggleParagraph(3, 4);
  assert.strictEqual(handle.selectionCount(), 4);
  assert.deepStrictEqual(checkedRows(doc).sort(), ['1:1', '1:2', '2:4', '3:4']);
});

test('段落をクリックしても選択できる（チェックボックス以外の場所でも）', () => {
  const { doc, handle } = setup({ count: 2 });
  segOf(doc, 2, 3).dispatchEvent({ type: 'click' });
  assert.strictEqual(handle.selectionCount(), 1);
  assert.deepStrictEqual(checkedRows(doc), ['2:3']);
  // もう一度押すと外れる
  segOf(doc, 2, 3).dispatchEvent({ type: 'click' });
  assert.strictEqual(handle.selectionCount(), 0);
});

test('選択中は固定領域に内容が出る（スクロールしても確認できる）', () => {
  const { doc, handle } = setup({ count: 3 });
  handle.toggleParagraph(1, 1);
  handle.toggleParagraph(1, 2);
  handle.toggleParagraph(2, 4);
  const tray = doc.querySelector('#jcgcr-tray');
  assert.ok(tray.getAttribute('class').indexOf('jcgc-hidden') === -1, '選択中は表示される');
  assert.ok(tray.textContent.indexOf('3段落を選択中') !== -1, tray.textContent);
  const lines = tray.querySelectorAll('.jcgcr-tray-list li').map((el) => el.textContent);
  assert.deepStrictEqual(lines, ['請求項1：段落1、2', '請求項2：段落4']);
  assert.ok(findButton(tray, '関連を作成'));
  assert.ok(findButton(tray, '選択解除'));
  // 画面下に固定
  assert.ok(doc.querySelector('#jcgc-style').textContent.indexOf('.jcgcr-tray{position:fixed') !== -1);
});

test('選択した段落から関連を作れる', () => {
  const { doc, handle, relationStore } = setup({ count: 3 });
  handle.toggleParagraph(1, 1);
  handle.toggleParagraph(1, 2);
  handle.toggleParagraph(2, 4);
  click(findButton(doc.querySelector('#jcgcr-tray'), '関連を作成'));

  assert.strictEqual(relationStore.countRelations('g1'), 1);
  const relation = relationStore.getRelations('g1')[0];
  assert.strictEqual(relation.name, '関連1');
  assert.deepStrictEqual(relation.items, [
    { claimNumber: 1, paragraphIndexes: [1, 2] },
    { claimNumber: 2, paragraphIndexes: [4] },
  ]);
  // 作成後は選択が解除され、作った関連が表示される
  assert.strictEqual(handle.selectionCount(), 0);
  assert.deepStrictEqual(highlighted(doc).sort(), ['1:1', '1:2', '2:4']);
});

test('関連名とメモを付けて作成できる', () => {
  const { doc, handle, relationStore } = setup({ count: 2 });
  handle.toggleParagraph(1, 1);
  const tray = doc.querySelector('#jcgcr-tray');
  const inputs = tray.querySelectorAll('input');
  inputs[0].value = '信号受信部分';
  inputs[0].dispatchEvent({ type: 'input', target: inputs[0] });
  inputs[1].value = '主体が違う';
  inputs[1].dispatchEvent({ type: 'input', target: inputs[1] });
  click(findButton(doc.querySelector('#jcgcr-tray'), '関連を作成'));

  const relation = relationStore.getRelations('g1')[0];
  assert.strictEqual(relation.name, '信号受信部分');
  assert.strictEqual(relation.note, '主体が違う');
});

test('選択解除で選択が消える', () => {
  const { doc, handle } = setup({ count: 2 });
  handle.toggleParagraph(1, 1);
  click(findButton(doc.querySelector('#jcgcr-tray'), '選択解除'));
  assert.strictEqual(handle.selectionCount(), 0);
  assert.ok(doc.querySelector('#jcgcr-tray').getAttribute('class').indexOf('jcgc-hidden') !== -1);
});

/* ---- 関連の表示 --------------------------------------------------------- */

test('関連を選ぶと、登録された段落だけが強調される', () => {
  const { doc, handle, relationStore } = setup({ count: 3 });
  relationStore.createRelation('g1', { selection: new Map([[1, new Set([2])], [3, new Set([4])]]) });
  handle.render();

  const buttons = doc.querySelectorAll('[data-relation]');
  assert.deepStrictEqual(buttons.map((el) => el.textContent), ['関連なし', '関連1（2段落）']);

  click(buttons[1]);
  assert.deepStrictEqual(highlighted(doc).sort(), ['1:2', '3:4']);
  // 登録されていない段落は薄く表示する
  assert.ok(doc.querySelector('#jcgc-grid').getAttribute('class').indexOf('is-dim') !== -1);

  // 「関連なし」に戻すと通常表示
  click(doc.querySelectorAll('[data-relation]')[0]);
  assert.deepStrictEqual(highlighted(doc), []);
  assert.ok(doc.querySelector('#jcgc-grid').getAttribute('class').indexOf('is-dim') === -1);
});

test('関連を選ぶと、名前・段落数・請求項番号・段落番号・メモを確認できる', () => {
  const { doc, handle, relationStore } = setup({ count: 3 });
  relationStore.createRelation('g1', {
    name: '報告情報の生成', note: '装置側は手段表現',
    selection: new Map([[1, new Set([1, 3])], [2, new Set([4])]]),
  });
  handle.render();
  click(doc.querySelectorAll('[data-relation]')[1]);

  const info = doc.querySelector('#jcgcr-info');
  assert.ok(info.getAttribute('class').indexOf('jcgc-hidden') === -1);
  assert.ok(info.textContent.indexOf('報告情報の生成') !== -1);
  assert.ok(info.textContent.indexOf('3段落') !== -1);
  assert.ok(info.textContent.indexOf('請求項1・2') !== -1);
  assert.ok(info.textContent.indexOf('請求項1：段落1、3 / 請求項2：段落4') !== -1);
  assert.ok(info.textContent.indexOf('装置側は手段表現') !== -1);
});

/* ---- 関連の編集 --------------------------------------------------------- */

test('関連を編集すると、登録済みの段落がチェック済みで開く', () => {
  const { doc, handle, relationStore } = setup({ count: 3 });
  const relation = relationStore.createRelation('g1', {
    selection: new Map([[1, new Set([1])], [2, new Set([2])]]),
  });
  handle.render();
  handle.startEditRelation(relation.id);

  assert.deepStrictEqual(checkedRows(doc).sort(), ['1:1', '2:2']);
  const tray = doc.querySelector('#jcgcr-tray');
  assert.ok(tray.textContent.indexOf('を編集中') !== -1);
  assert.ok(findButton(tray, '保存'));
  assert.ok(findButton(tray, 'キャンセル'));
});

test('編集で段落を追加・削除して保存できる', () => {
  const { doc, handle, relationStore } = setup({ count: 3 });
  const relation = relationStore.createRelation('g1', { selection: new Map([[1, new Set([1])]]) });
  handle.render();
  handle.startEditRelation(relation.id);

  handle.toggleParagraph(3, 4);   // 追加
  handle.toggleParagraph(1, 1);   // 解除
  click(findButton(doc.querySelector('#jcgcr-tray'), '保存'));

  assert.deepStrictEqual(relationStore.getRelation('g1', relation.id).items,
    [{ claimNumber: 3, paragraphIndexes: [4] }]);
});

test('編集をキャンセルすると元のまま', () => {
  const { doc, handle, relationStore } = setup({ count: 3 });
  const relation = relationStore.createRelation('g1', { selection: new Map([[1, new Set([1])]]) });
  handle.render();
  handle.startEditRelation(relation.id);
  handle.toggleParagraph(2, 2);
  click(findButton(doc.querySelector('#jcgcr-tray'), 'キャンセル'));

  assert.deepStrictEqual(relationStore.getRelation('g1', relation.id).items,
    [{ claimNumber: 1, paragraphIndexes: [1] }]);
});

test('関連名とメモを後から変更できる', () => {
  const { doc, handle, relationStore } = setup({ count: 2 });
  const relation = relationStore.createRelation('g1', { selection: new Map([[1, new Set([1])]]) });
  handle.render();
  click(doc.querySelectorAll('[data-relation]')[1]);

  const info = doc.querySelector('#jcgcr-info');
  const inputs = info.querySelectorAll('input');
  inputs[0].value = '送信処理';
  inputs[1].value = 'ここが違う';
  click(findButton(info, '名前とメモを保存'));

  const updated = relationStore.getRelation('g1', relation.id);
  assert.strictEqual(updated.name, '送信処理');
  assert.strictEqual(updated.note, 'ここが違う');
});

test('関連を複製・削除できる（削除は確認してから）', () => {
  const { doc, handle, relationStore } = setup({ count: 2 });
  relationStore.createRelation('g1', { selection: new Map([[1, new Set([1])]]) });
  handle.render();
  click(doc.querySelectorAll('[data-relation]')[1]);

  click(findButton(doc.querySelector('#jcgcr-info'), '複製'));
  assert.strictEqual(relationStore.countRelations('g1'), 2);

  click(findButton(doc.querySelector('#jcgcr-info'), '削除'));
  assert.strictEqual(relationStore.countRelations('g1'), 2, '確認前は削除しない');
  click(handle.ui.bannerButtons.yes);
  assert.strictEqual(relationStore.countRelations('g1'), 1);
});

test('同じ段落を複数の関連へ登録できる', () => {
  const { doc, handle, relationStore } = setup({ count: 2 });
  handle.toggleParagraph(1, 1);
  click(findButton(doc.querySelector('#jcgcr-tray'), '関連を作成'));
  handle.toggleParagraph(1, 1);
  handle.toggleParagraph(2, 1);
  click(findButton(doc.querySelector('#jcgcr-tray'), '関連を作成'));

  const list = relationStore.getRelations('g1');
  assert.strictEqual(list.length, 2);
  assert.ok(list.every((r) => r.items.some((i) => i.claimNumber === 1 && i.paragraphIndexes.indexOf(1) !== -1)));
});

/* ---- グループごとの分離 -------------------------------------------------- */

test('請求項グループごとに関連が分離される', () => {
  const claims = makeClaims(4);
  const groups = [
    { id: 'g1', name: 'A', claimNumbers: [1, 2], candidateNumbers: [], source: 'auto', reasons: [], manuallyEdited: false, order: 1 },
    { id: 'g2', name: 'B', claimNumbers: [3, 4], candidateNumbers: [], source: 'auto', reasons: [], manuallyEdited: false, order: 2 },
  ];
  const { doc, handle, store, relationStore } = setup({ claims, groups });

  handle.toggleParagraph(1, 1);
  click(findButton(doc.querySelector('#jcgcr-tray'), '関連を作成'));
  assert.strictEqual(relationStore.countRelations('g1'), 1);

  store.selectGroup('g2');
  assert.strictEqual(relationStore.countRelations('g2'), 0);
  assert.deepStrictEqual(doc.querySelectorAll('[data-relation]').map((el) => el.textContent), ['関連なし']);
  assert.deepStrictEqual(highlighted(doc), [], '別グループの関連が漏れてはいけない');

  handle.toggleParagraph(3, 2);
  click(findButton(doc.querySelector('#jcgcr-tray'), '関連を作成'));
  assert.strictEqual(relationStore.countRelations('g1'), 1);
  assert.strictEqual(relationStore.countRelations('g2'), 1);
});

/* ---- 書き出し・読み込み -------------------------------------------------- */

test('JSON へ書き出せる（グループ・関連・段落原文・メモを含む）', () => {
  const { handle, relationStore, claims } = setup({ count: 3 });
  relationStore.createRelation('g1', {
    name: '信号受信部分', note: 'メモ',
    selection: new Map([[1, new Set([1, 2])], [2, new Set([4])]]),
  });
  const payload = handle.exportPayload();
  assert.strictEqual(payload.format, 'claim-paragraph-relations');
  assert.strictEqual(payload.source.applicationNumber, '特願0000-000000');
  assert.strictEqual(payload.groups[0].relations[0].name, '信号受信部分');
  assert.deepStrictEqual(payload.groups[0].relations[0].items[0].paragraphTexts,
    [claims[0].segments[0].text, claims[0].segments[1].text]);
});

test('書き出した JSON を置換で読み戻せる', () => {
  const first = setup({ count: 3 });
  first.relationStore.createRelation('g1', {
    name: '信号受信部分', selection: new Map([[1, new Set([1, 2])], [2, new Set([4])]]),
  });
  const json = JSON.stringify(first.handle.exportPayload());

  const second = setup({ count: 3 });
  second.handle.setImportText(json);
  second.handle.validateImportText();
  assert.strictEqual(second.handle.view.importResult.ok, true);
  second.handle.applyImport('replace');

  const groups = second.store.getGroups();
  assert.strictEqual(groups.length, 1);
  assert.deepStrictEqual(groups[0].claimNumbers, [1, 2, 3]);
  const restored = second.relationStore.getRelations(groups[0].id);
  assert.strictEqual(restored.length, 1);
  assert.strictEqual(restored[0].name, '信号受信部分');
  assert.deepStrictEqual(restored[0].items, [
    { claimNumber: 1, paragraphIndexes: [1, 2] },
    { claimNumber: 2, paragraphIndexes: [4] },
  ]);
});

test('追加インポートは既存のグループを残す', () => {
  const first = setup({ count: 3 });
  first.relationStore.createRelation('g1', { name: '元からある関連', selection: new Map([[1, new Set([1])]]) });
  const json = JSON.stringify(first.handle.exportPayload());

  const second = setup({ count: 3 });
  second.relationStore.createRelation('g1', { name: '手元の関連', selection: new Map([[3, new Set([1])]]) });
  const before = second.store.getGroups().length;

  second.handle.setImportText(json);
  second.handle.validateImportText();
  second.handle.applyImport('merge');

  assert.strictEqual(second.store.getGroups().length, before + 1, 'グループが増える');
  assert.strictEqual(second.relationStore.countRelations('g1'), 1, '元のグループの関連は残る');
  const added = second.store.getGroups()[before];
  assert.strictEqual(second.relationStore.countRelations(added.id), 1);
  assert.strictEqual(second.relationStore.getRelations(added.id)[0].name, '元からある関連');
});

test('存在しない請求項・段落は未解決として示し、勝手に別段落へ割り当てない', () => {
  const big = setup({ count: 5 });
  big.relationStore.createRelation('g1', { selection: new Map([[5, new Set([4])], [1, new Set([1])]]) });
  const json = JSON.stringify(big.handle.exportPayload());

  // 請求項が 2 件しかない案件へ読み込む
  const small = setup({ count: 2 });
  small.handle.setImportText(json);
  small.handle.validateImportText();
  const result = small.handle.view.importResult;
  assert.strictEqual(result.ok, true);
  assert.ok(result.unresolved.some((m) => m.indexOf('請求項5 が見つかりません') !== -1),
    result.unresolved.join(' / '));

  small.handle.applyImport('replace');
  const groups = small.store.getGroups();
  const restored = small.relationStore.getRelations(groups[0].id);
  assert.deepStrictEqual(restored[0].items, [{ claimNumber: 1, paragraphIndexes: [1] }],
    '見つからない請求項の段落を別の段落へ割り当ててはいけない');
});

test('壊れた JSON はエラーとして示し、何も取り込まない', () => {
  const { handle, store } = setup({ count: 2 });
  const before = store.getGroups().length;
  handle.setImportText('{ これは JSON ではない');
  handle.validateImportText();
  assert.strictEqual(handle.view.importResult.ok, false);
  assert.ok(handle.view.importResult.errors.length);
  handle.applyImport('replace');
  assert.strictEqual(store.getGroups().length, before, '検証に失敗したら取り込まない');
});

/* ---- 維持している機能 ---------------------------------------------------- */

test('カード・レイアウト・グループ編集タブは自動版と同じように使える', () => {
  const claims = makeClaims(30, () => 3);
  const groups = [{
    id: 'g1', name: '30枚', claimNumbers: claims.map((c) => c.number),
    candidateNumbers: [], source: 'auto', reasons: [], manuallyEdited: false, order: 1,
  }];
  const { doc, handle, store } = setup({ claims, groups, width: 1920 });
  assert.strictEqual(doc.querySelectorAll('.jcgc-card').length, 30);
  assert.ok(handle.ui.lastLayout.columns >= 4 && handle.ui.lastLayout.columns <= 6);
  assert.ok(doc.querySelector('.jcgc-toolbar'));
  assert.ok(doc.querySelector('#jcgc-group-select'));

  store.setViewMode('edit');
  assert.ok(doc.querySelector('.jcgc-grouplist'), 'グループ編集が使える');
  assert.ok(doc.querySelector('#jcgcr-tray').getAttribute('class').indexOf('jcgc-hidden') !== -1);
});

test('100枚のカードでも表示できる', () => {
  const claims = makeClaims(100, () => 3);
  const groups = [{
    id: 'g1', name: '100枚', claimNumbers: claims.map((c) => c.number),
    candidateNumbers: [], source: 'auto', reasons: [], manuallyEdited: false, order: 1,
  }];
  const { doc } = setup({ claims, groups });
  assert.strictEqual(doc.querySelectorAll('.jcgc-card').length, 100);
  assert.strictEqual(doc.querySelectorAll('.jcgcr-check').length, doc.querySelectorAll('.jcgc-seg').length);
});

test('実物の出願でも、初期状態で関連 0 件のまま描画できる',
  { skip: !helpers.hasFixture('multiIndependent') }, () => {
    const grouping = require('../src/core/grouping');
    const result = helpers.extract('multiIndependent');
    const auto = grouping.autoGroup(result.claims, { preset: 'broad' });
    const doc = helpers.blankDocument();
    const win = helpers.fakeWindow(doc, 1920);
    const handle = relationWorkspace.createWorkspace({
      doc, win, claims: result.claims, autoGroups: auto.groups, preset: 'broad',
      meta: {}, regroup: (p) => grouping.autoGroup(result.claims, { preset: p }).groups,
    });
    // 請求項のグループ分けは自動、段落の関連は 0 件
    assert.ok(handle.store.getGroups().length > 0);
    for (const group of handle.store.getGroups()) {
      assert.strictEqual(handle.relationStore.countRelations(group.id), 0);
    }
    assert.deepStrictEqual(highlighted(doc), []);
  });

test('関連の状態は汎用データで、案件固有の値を持たない', () => {
  const { handle, relationStore } = setup({ count: 2 });
  relationStore.createRelation('g1', { selection: new Map([[2, new Set([1])]]) });
  const payload = handle.exportPayload();
  const json = JSON.stringify(payload);
  // 数値と利用者の入力だけ。実装が用意する固定の技術用語は無い
  assert.ok(json.indexOf('claimNumber') !== -1);
  assert.ok(json.indexOf('paragraphIndexes') !== -1);
  assert.strictEqual(relationsCore.FORMAT, 'claim-paragraph-relations');
});

/* ---- 起動口の分離（既存の自動版に影響しない） ---------------------------- */

test('手動版の起動ボタンは、自動版と別 ID・別文言で共存できる', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const autoLauncher = require('../src/bookmarklet/common/launcher-app');
  const manualLauncher = require('../src/bookmarklet/common/relation-launcher-app');
  const doc = helpers.loadDocument('parallelTree');
  const opened = [];
  const win = {
    document: doc, innerWidth: 1920, location: { search: '' },
    open() {
      const childDoc = helpers.blankDocument();
      const child = {
        document: childDoc, innerWidth: 1920,
        addEventListener() {}, setTimeout(fn) { fn(); return 0; },
      };
      opened.push(child);
      return child;
    },
    addEventListener() {}, setTimeout(fn) { fn(); return 0; },
  };

  // 同じページで両方を起動しても互いに干渉しない
  autoLauncher.launch({ document: doc, window: win });
  manualLauncher.launch({ document: doc, window: win });
  assert.ok(doc.getElementById('jcgc-launcher'), '自動版のボタンが消えている');
  assert.ok(doc.getElementById('jcgcr-launcher'), '手動版のボタンが無い');
  assert.notStrictEqual(
    doc.querySelector('#jcgc-launcher button').textContent,
    doc.querySelector('#jcgcr-launcher button').textContent);

  // 手動版のタブは、段落の関連が 0 件で開く
  doc.querySelector('#jcgcr-launcher button').dispatchEvent({ type: 'click' });
  assert.strictEqual(opened.length, 1);
  const childDoc = opened[0].document;
  assert.ok(childDoc.querySelector('.jcgc-title').textContent.indexOf('段落関連 手動設定') !== -1);
  assert.ok(childDoc.querySelectorAll('.jcgcr-check').length > 0, 'チェックボックスが無い');
  assert.deepStrictEqual(
    childDoc.querySelectorAll('.jcgc-seg').filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1),
    [], '初期状態で関連付いている段落があってはいけない');
  assert.deepStrictEqual(
    childDoc.querySelectorAll('[data-relation]').map((el) => el.textContent), ['関連なし']);

  // 多重実行してもボタンは増えない
  manualLauncher.launch({ document: doc, window: win });
  assert.strictEqual(doc.querySelectorAll('#jcgcr-launcher').length, 1);
});

test('手動版は元ページの DOM を書き換えない', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const manualLauncher = require('../src/bookmarklet/common/relation-launcher-app');
  const doc = helpers.loadDocument('parallelTree');
  const before = {
    mark: doc.querySelector('#claim_mark').innerHTML,
    cite: doc.querySelector('#claim_cite').innerHTML,
  };
  const win = {
    document: doc, innerWidth: 1920, location: { search: '' },
    open() {
      return {
        document: helpers.blankDocument(), innerWidth: 1920,
        addEventListener() {}, setTimeout(fn) { fn(); return 0; },
      };
    },
    addEventListener() {}, setTimeout(fn) { fn(); return 0; },
  };
  manualLauncher.launch({ document: doc, window: win });
  doc.querySelector('#jcgcr-launcher button').dispatchEvent({ type: 'click' });

  assert.strictEqual(doc.querySelector('#claim_mark').innerHTML, before.mark);
  assert.strictEqual(doc.querySelector('#claim_cite').innerHTML, before.cite);
  const added = [];
  const walk = (node) => {
    if (node.nodeType === 1 && String(node.id).indexOf('jcgcr') === 0) added.push(node.id);
    for (const child of node.childNodes) walk(child);
  };
  walk(doc.documentElement);
  assert.deepStrictEqual(added.sort(), ['jcgcr-launcher', 'jcgcr-launcher-style']);
});

test('置換インポートで、グループが元の姿のまま戻る（自動/手動の別・根拠・追加候補）', () => {
  const first = setup({ count: 3 });
  // 自動グループらしい属性を持たせる
  first.store.applyAutoGroups([{
    id: 'g1', name: '独立項・方法', claimNumbers: [1, 2, 3], candidateNumbers: [],
    source: 'auto', strategy: 'category', score: 0.66,
    reasons: ['すべて独立項', '方法カテゴリー'], manuallyEdited: false, order: 1,
  }], { overwriteManual: true });
  first.relationStore.createRelation('g1', { name: '関連A', selection: new Map([[1, new Set([1])]]) });
  const json = JSON.stringify(first.handle.exportPayload());

  const second = setup({ count: 3 });
  second.handle.setImportText(json);
  second.handle.validateImportText();
  second.handle.applyImport('replace');

  const restored = second.store.getGroups();
  assert.strictEqual(restored.length, 1);
  assert.strictEqual(restored[0].name, '独立項・方法');
  assert.deepStrictEqual(restored[0].claimNumbers, [1, 2, 3]);
  assert.strictEqual(restored[0].source, 'auto', '自動グループが手動に化けてはいけない');
  assert.deepStrictEqual(restored[0].reasons, ['すべて独立項', '方法カテゴリー'], '根拠が失われてはいけない');
  assert.strictEqual(restored[0].score, 0.66);
  assert.strictEqual(second.relationStore.countRelations(restored[0].id), 1);
});

test('置換インポートで、関連を持たないグループも消えずに戻る', () => {
  const claims = makeClaims(4);
  const groups = [
    { id: 'g1', name: 'A', claimNumbers: [1, 2], candidateNumbers: [], source: 'auto', strategy: 'text', score: 0.7, reasons: ['字面'], manuallyEdited: false, order: 1 },
    { id: 'g2', name: 'B', claimNumbers: [3, 4], candidateNumbers: [], source: 'auto', strategy: 'text', score: 0.6, reasons: ['字面'], manuallyEdited: false, order: 2 },
    { id: 'g3', name: 'C', claimNumbers: [1, 4], candidateNumbers: [], source: 'auto', strategy: 'cite', score: 0.5, reasons: ['引用'], manuallyEdited: false, order: 3 },
  ];
  const first = setup({ claims, groups });
  // 関連は 1 グループにしか作らない
  first.relationStore.createRelation('g2', { selection: new Map([[3, new Set([1])]]) });
  const json = JSON.stringify(first.handle.exportPayload());

  const second = setup({ claims, groups: [groups[0]] });
  second.handle.setImportText(json);
  second.handle.validateImportText();
  second.handle.applyImport('replace');

  assert.deepStrictEqual(second.store.getGroups().map((g) => g.name), ['A', 'B', 'C'],
    '関連を持たないグループも書き出し・読み戻しの対象');
  assert.strictEqual(second.relationStore.countRelations('g2'), 1);
  assert.strictEqual(second.relationStore.countRelations('g1'), 0);
});

test('空のまま検証したら、分かりやすい案内を出す', () => {
  const { handle } = setup({ count: 2 });
  handle.setImportText('');
  handle.validateImportText();
  assert.strictEqual(handle.view.importResult.ok, false);
  assert.ok(handle.view.importResult.errors[0].indexOf('読み込む内容がありません') !== -1);
});
