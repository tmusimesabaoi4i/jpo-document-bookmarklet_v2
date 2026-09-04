'use strict';
const test = require('node:test');
const assert = require('node:assert');
const groupstate = require('../src/core/groupstate');

function claims(n) {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, rawText: '請求項' + (i + 1) + 'の本文' }));
}

function autoGroups() {
  return [
    { id: 'auto-1', name: '独立方法クレーム', claimNumbers: [1, 26, 32, 35], source: 'auto', strategy: 'category', score: 0.82, reasons: ['独立項'], manuallyEdited: false, order: 1 },
    { id: 'auto-2', name: '装置クレーム', claimNumbers: [15, 30, 33, 39], source: 'auto', strategy: 'category', score: 0.7, reasons: ['独立項'], manuallyEdited: false, order: 2 },
  ];
}

function makeStore() {
  return groupstate.createStore({ claims: claims(40), autoGroups: autoGroups(), preset: 'broad' });
}

test('初期状態は自動グループを保持し、最初のグループが選ばれている', () => {
  const store = makeStore();
  assert.strictEqual(store.getGroups().length, 2);
  assert.strictEqual(store.getState().selectedGroupId, 'auto-1');
  assert.strictEqual(store.getState().selectedSegment, 0);
});

test('自動グループを編集すると manuallyEdited が立つ', () => {
  const store = makeStore();
  store.addMemberToGroup('auto-1', 2);
  const group = store.getGroup('auto-1');
  assert.deepStrictEqual(group.claimNumbers, [1, 26, 32, 35, 2]);
  assert.strictEqual(group.manuallyEdited, true);
  assert.strictEqual(group.source, 'auto');
});

test('手動グループを追加できる（1請求項が複数グループに属してよい）', () => {
  const store = makeStore();
  const group = store.addGroup({ name: '自分用', claimNumbers: [1, 15] });
  assert.strictEqual(group.source, 'manual');
  assert.strictEqual(store.getGroups().length, 3);
  // 1 は auto-1 にも残っている
  assert.ok(store.getGroup('auto-1').claimNumbers.indexOf(1) !== -1);
});

test('請求項の追加・削除・並べ替えができる', () => {
  const store = makeStore();
  store.removeMemberFromGroup('auto-1', 26);
  assert.deepStrictEqual(store.getGroup('auto-1').claimNumbers, [1, 32, 35]);
  store.moveMemberWithin('auto-1', 35, -1);
  assert.deepStrictEqual(store.getGroup('auto-1').claimNumbers, [1, 35, 32]);
  store.moveMemberTo('auto-1', 1, 2);
  assert.deepStrictEqual(store.getGroup('auto-1').claimNumbers, [35, 32, 1]);
});

test('別グループへ移動と複製を選べる', () => {
  const store = makeStore();
  store.transferMember({ fromId: 'auto-1', toId: 'auto-2', number: 1, copy: true });
  assert.ok(store.getGroup('auto-1').claimNumbers.indexOf(1) !== -1, '複製では元に残る');
  assert.ok(store.getGroup('auto-2').claimNumbers.indexOf(1) !== -1);

  store.transferMember({ fromId: 'auto-1', toId: 'auto-2', number: 26, copy: false });
  assert.strictEqual(store.getGroup('auto-1').claimNumbers.indexOf(26), -1, '移動では元から外れる');
  assert.ok(store.getGroup('auto-2').claimNumbers.indexOf(26) !== -1);
});

test('グループを分割・統合・複製・削除できる', () => {
  const store = makeStore();
  const [head, tail] = store.splitGroup('auto-1', 2);
  assert.deepStrictEqual(head.claimNumbers, [1, 26]);
  assert.deepStrictEqual(tail.claimNumbers, [32, 35]);
  assert.strictEqual(store.getGroups().length, 3);

  const merged = store.mergeGroups([head.id, tail.id]);
  assert.deepStrictEqual(merged.claimNumbers, [1, 26, 32, 35]);
  assert.strictEqual(store.getGroups().length, 2);

  store.duplicateGroup(merged.id);
  assert.strictEqual(store.getGroups().length, 3);

  store.deleteGroup(merged.id);
  assert.strictEqual(store.getGroups().length, 2);
});

test('直前の操作を取り消せる', () => {
  const store = makeStore();
  store.removeMemberFromGroup('auto-1', 26);
  assert.strictEqual(store.getGroup('auto-1').claimNumbers.length, 3);
  assert.strictEqual(store.undo(), true);
  assert.deepStrictEqual(store.getGroup('auto-1').claimNumbers, [1, 26, 32, 35]);
  assert.strictEqual(store.getGroup('auto-1').manuallyEdited, false);
});

test('自動再グルーピングは手動グループ・手動編集済みグループを勝手に消さない', () => {
  const store = makeStore();
  const manual = store.addGroup({ name: '自分用', claimNumbers: [1, 2] });
  store.addMemberToGroup('auto-2', 3); // auto-2 を手動編集済みにする

  const next = [
    { id: 'auto-x', name: '新しい自動', claimNumbers: [5, 6], source: 'auto', strategy: 'text', score: 0.5, reasons: ['字面'], manuallyEdited: false, order: 1 },
  ];
  const info = store.applyAutoGroups(next, {});
  const ids = store.getGroups().map((g) => g.id);
  assert.ok(ids.indexOf(manual.id) !== -1, '手動グループが消えた');
  assert.ok(ids.indexOf('auto-2') !== -1, '手動編集済みの自動グループが消えた');
  assert.ok(ids.indexOf('auto-1') === -1, '未編集の自動グループは作り直される');
  assert.ok(ids.indexOf('auto-x') !== -1);
  assert.strictEqual(info.kept, 2);
});

test('明示的に指示したときだけ手動グループを上書きする', () => {
  const store = makeStore();
  store.addGroup({ name: '自分用', claimNumbers: [1, 2] });
  store.applyAutoGroups([{ id: 'auto-x', name: '新', claimNumbers: [5, 6], source: 'auto', reasons: [], manuallyEdited: false, order: 1 }], { overwriteManual: true });
  assert.deepStrictEqual(store.getGroups().map((g) => g.id), ['auto-x']);
});

test('自動生成時の状態へ戻せる', () => {
  const store = makeStore();
  store.addGroup({ name: '自分用', claimNumbers: [1, 2] });
  store.removeMemberFromGroup('auto-1', 26);
  store.resetToAuto();
  assert.deepStrictEqual(store.getGroups().map((g) => g.id), ['auto-1', 'auto-2']);
  assert.deepStrictEqual(store.getGroup('auto-1').claimNumbers, [1, 26, 32, 35]);
});

test('一括入力欄の検証（重複・存在しない番号・不正な書式）', () => {
  const store = makeStore();
  assert.deepStrictEqual(store.parseNumberList('1,26,32,35').numbers, [1, 26, 32, 35]);
  assert.deepStrictEqual(store.parseNumberList('１，２６').numbers, [1, 26]);

  const dup = store.parseNumberList('1,1,2');
  assert.deepStrictEqual(dup.duplicates, [1]);
  assert.ok(dup.errors.some((e) => e.indexOf('重複') !== -1));

  const unknown = store.parseNumberList('1,999');
  assert.deepStrictEqual(unknown.unknown, [999]);
  assert.ok(unknown.errors.some((e) => e.indexOf('存在しない') !== -1));

  const bad = store.parseNumberList('1,あ,3');
  assert.ok(bad.errors.length > 0);
});

test('1グループの上限（100請求項）を検証する', () => {
  const store = groupstate.createStore({ claims: claims(150), autoGroups: [] });
  const many = Array.from({ length: 101 }, (_, i) => i + 1).join(',');
  const parsed = store.parseNumberList(many);
  assert.ok(parsed.errors.some((e) => e.indexOf('上限') !== -1));
  const group = store.addGroup({ name: '大きいグループ', claimNumbers: Array.from({ length: 120 }, (_, i) => i + 1) });
  assert.strictEqual(group.claimNumbers.length, 100);
});

test('複数グループのテキスト形式を読み書きできる', () => {
  const store = makeStore();
  const text = '# 独立方法クレーム\n1,26,32,35\n\n# 装置クレーム\n15,30,33,39\n\n# 回路クレーム\n16,31,34,40\n';
  const parsed = store.parseGroupsText(text);
  assert.strictEqual(parsed.errors.length, 0);
  assert.deepStrictEqual(parsed.groups.map((g) => g.name), ['独立方法クレーム', '装置クレーム', '回路クレーム']);
  assert.deepStrictEqual(parsed.groups[2].claimNumbers, [16, 31, 34, 40]);

  store.replaceGroupsFromText(text);
  assert.strictEqual(store.getGroups().length, 3);
  assert.ok(store.getGroups().every((g) => g.source === 'manual'));

  // 書き出したテキストを読み直しても同じ
  const round = store.parseGroupsText(store.formatGroupsText());
  assert.deepStrictEqual(round.groups.map((g) => g.claimNumbers), parsed.groups.map((g) => g.claimNumbers));
});

test('テキスト形式の誤りは置き換え前にエラーで返す', () => {
  const store = makeStore();
  const parsed = store.parseGroupsText('# だめな例\n1,999\n');
  assert.ok(parsed.errors.length > 0);
  const before = store.getGroups().length;
  store.replaceGroupsFromText('# だめな例\n1,999\n');
  assert.strictEqual(store.getGroups().length, before, 'エラー時は置き換えない');
});

test('状態を JSON で保存・復元できる（後から localStorage を足せる形）', () => {
  const store = makeStore();
  store.addGroup({ name: '自分用', claimNumbers: [1, 2] });
  store.setDensity('compact');
  store.setColumns('4');
  const json = JSON.parse(JSON.stringify(store.toJSON()));

  const restored = groupstate.createStore({ claims: claims(40), autoGroups: [] });
  assert.strictEqual(restored.loadJSON(json), true);
  assert.strictEqual(restored.getGroups().length, 3);
  assert.strictEqual(restored.getState().density, 'compact');
  assert.strictEqual(restored.getState().columns, '4');
  restored.resetToAuto();
  assert.deepStrictEqual(restored.getGroups().map((g) => g.id), ['auto-1', 'auto-2']);
});

test('購読者に通知される', () => {
  const store = makeStore();
  let count = 0;
  const unsubscribe = store.subscribe(() => { count += 1; });
  store.selectSegment(3);
  store.addGroup({ name: 'x', claimNumbers: [1] });
  assert.strictEqual(count, 2);
  unsubscribe();
  store.selectSegment(1);
  assert.strictEqual(count, 2);
});

test('表示状態の変更は履歴に積まない', () => {
  const store = makeStore();
  store.selectSegment(2);
  store.setDensity('roomy');
  assert.strictEqual(store.canUndo(), false);
  store.renameGroup('auto-1', '別名');
  assert.strictEqual(store.canUndo(), true);
});

test('追加候補を保持し、昇格・除外できる', () => {
  const store = groupstate.createStore({
    claims: claims(40),
    autoGroups: [{
      id: 'auto-1', name: '独立方法クレーム', claimNumbers: [1, 26], candidateNumbers: [32, 35],
      source: 'auto', strategy: 'text', score: 0.8, reasons: ['字面'], manuallyEdited: false, order: 1,
    }],
  });
  assert.deepStrictEqual(store.getGroup('auto-1').candidateNumbers, [32, 35]);

  store.promoteCandidate('auto-1', 32);
  assert.deepStrictEqual(store.getGroup('auto-1').claimNumbers, [1, 26, 32]);
  assert.deepStrictEqual(store.getGroup('auto-1').candidateNumbers, [35]);
  assert.strictEqual(store.getGroup('auto-1').manuallyEdited, true);

  store.dismissCandidate('auto-1', 35);
  assert.deepStrictEqual(store.getGroup('auto-1').candidateNumbers, []);

  // 取り消せる
  assert.strictEqual(store.undo(), true);
  assert.deepStrictEqual(store.getGroup('auto-1').candidateNumbers, [35]);
});

test('正式メンバーにした請求項は追加候補から外れる', () => {
  const store = groupstate.createStore({
    claims: claims(40),
    autoGroups: [{
      id: 'auto-1', name: 'x', claimNumbers: [1], candidateNumbers: [2, 3],
      source: 'auto', reasons: [], manuallyEdited: false, order: 1,
    }],
  });
  store.addMemberToGroup('auto-1', 2);
  assert.deepStrictEqual(store.getGroup('auto-1').candidateNumbers, [3]);
  store.setGroupMembers('auto-1', [1, 2, 3]);
  assert.deepStrictEqual(store.getGroup('auto-1').candidateNumbers, []);
});

test('追加候補は保存・復元でも失われない', () => {
  const store = groupstate.createStore({
    claims: claims(40),
    autoGroups: [{
      id: 'auto-1', name: 'x', claimNumbers: [1], candidateNumbers: [2, 3],
      source: 'auto', reasons: [], manuallyEdited: false, order: 1,
    }],
  });
  const json = JSON.parse(JSON.stringify(store.toJSON()));
  const restored = groupstate.createStore({ claims: claims(40), autoGroups: [] });
  restored.loadJSON(json);
  assert.deepStrictEqual(restored.getGroup('auto-1').candidateNumbers, [2, 3]);
});
