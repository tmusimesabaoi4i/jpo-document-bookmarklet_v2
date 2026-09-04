'use strict';
/*
 * relations.test.js — 段落の「関連」の管理（手動関連付け版のコア）
 *
 * 請求項番号も段落番号も技術用語も、実装側には無い。ここでの番号はテストデータの都合。
 */
const test = require('node:test');
const assert = require('node:assert');
const relations = require('../src/core/relations');

function claims(spec) {
  // spec: { 請求項番号: 段落数 }
  return Object.keys(spec).map((number) => ({
    number: Number(number),
    segmentCount: spec[number],
    segments: Array.from({ length: spec[number] }, (_, i) => ({
      index: i + 1, text: '請求項' + number + 'の第' + (i + 1) + '段落の原文', depth: 1,
    })),
  }));
}

function makeStore() {
  return relations.createRelationStore({ claims: claims({ 1: 4, 2: 5, 5: 4 }) });
}

test('初期状態は関連 0 件（自動生成しない）', () => {
  const store = makeStore();
  assert.deepStrictEqual(store.getRelations('group-1'), []);
  assert.strictEqual(store.countRelations('group-1'), 0);
  assert.strictEqual(store.hasAny(), false);
});

test('複数の請求項から複数の段落を選んで関連を作れる', () => {
  const store = makeStore();
  const selection = new Map([[1, new Set([1, 2])], [2, new Set([4])], [5, new Set([4])]]);
  const relation = store.createRelation('group-1', { selection });
  assert.strictEqual(relation.name, '関連1');
  assert.deepStrictEqual(relation.items, [
    { claimNumber: 1, paragraphIndexes: [1, 2] },
    { claimNumber: 2, paragraphIndexes: [4] },
    { claimNumber: 5, paragraphIndexes: [4] },
  ]);
  assert.strictEqual(relations.countParagraphs(relation), 4);
  assert.deepStrictEqual(relations.claimNumbersOf(relation), [1, 2, 5]);
  assert.strictEqual(relations.describeRelation(relation),
    '請求項1：段落1、2 / 請求項2：段落4 / 請求項5：段落4');
});

test('同じ請求項から複数段落を選べる', () => {
  const store = makeStore();
  const relation = store.createRelation('group-1', { selection: new Map([[2, new Set([1, 3, 5])]]) });
  assert.deepStrictEqual(relation.items, [{ claimNumber: 2, paragraphIndexes: [1, 3, 5] }]);
});

test('関連名は 関連1・関連2… と自動採番され、あとから変更できる', () => {
  const store = makeStore();
  const a = store.createRelation('group-1', { selection: new Map([[1, new Set([1])]]) });
  const b = store.createRelation('group-1', { selection: new Map([[1, new Set([2])]]) });
  assert.deepStrictEqual([a.name, b.name], ['関連1', '関連2']);

  const renamed = store.updateRelation('group-1', a.id, { name: '信号受信部分', note: '主体が違う' });
  assert.strictEqual(renamed.name, '信号受信部分');
  assert.strictEqual(renamed.note, '主体が違う');
  assert.strictEqual(store.getRelation('group-1', a.id).name, '信号受信部分');
});

test('作成済みの関連へ段落を追加・削除できる', () => {
  const store = makeStore();
  const relation = store.createRelation('group-1', { selection: new Map([[1, new Set([1])]]) });
  store.addParagraph('group-1', relation.id, 2, 3);
  assert.deepStrictEqual(store.getRelation('group-1', relation.id).items, [
    { claimNumber: 1, paragraphIndexes: [1] },
    { claimNumber: 2, paragraphIndexes: [3] },
  ]);
  store.removeParagraph('group-1', relation.id, 1, 1);
  assert.deepStrictEqual(store.getRelation('group-1', relation.id).items, [
    { claimNumber: 2, paragraphIndexes: [3] },
  ]);
  // 最後の 1 段落は消させない（関連ごと消すのは deleteRelation）
  assert.strictEqual(store.removeParagraph('group-1', relation.id, 2, 3), null);
  assert.strictEqual(relations.countParagraphs(store.getRelation('group-1', relation.id)), 1);
});

test('選択段落をまるごと入れ替えられる', () => {
  const store = makeStore();
  const relation = store.createRelation('group-1', { selection: new Map([[1, new Set([1, 2])]]) });
  store.updateRelation('group-1', relation.id, { selection: new Map([[5, new Set([4])]]) });
  assert.deepStrictEqual(store.getRelation('group-1', relation.id).items,
    [{ claimNumber: 5, paragraphIndexes: [4] }]);
  // 段落 0 件にはできない
  assert.strictEqual(store.updateRelation('group-1', relation.id, { selection: new Map() }), null);
});

test('関連を複製・削除できる', () => {
  const store = makeStore();
  const relation = store.createRelation('group-1', { selection: new Map([[1, new Set([1])]]) });
  const copy = store.duplicateRelation('group-1', relation.id);
  assert.strictEqual(copy.name, '関連1（複製）');
  assert.strictEqual(store.countRelations('group-1'), 2);
  assert.notStrictEqual(copy.id, relation.id);

  assert.strictEqual(store.deleteRelation('group-1', relation.id), true);
  assert.strictEqual(store.countRelations('group-1'), 1);
  assert.strictEqual(store.deleteRelation('group-1', 'ないid'), false);
});

test('同じ段落を複数の関連へ登録できる', () => {
  const store = makeStore();
  const a = store.createRelation('group-1', { selection: new Map([[1, new Set([1])]]) });
  const b = store.createRelation('group-1', { selection: new Map([[1, new Set([1])], [2, new Set([1])]]) });
  assert.ok(a.items.some((i) => i.claimNumber === 1 && i.paragraphIndexes.indexOf(1) !== -1));
  assert.ok(b.items.some((i) => i.claimNumber === 1 && i.paragraphIndexes.indexOf(1) !== -1));
});

test('請求項グループごとに関連が分離される', () => {
  const store = makeStore();
  store.createRelation('group-1', { selection: new Map([[1, new Set([1])]]) });
  store.createRelation('group-2', { selection: new Map([[2, new Set([2])]]) });
  assert.strictEqual(store.countRelations('group-1'), 1);
  assert.strictEqual(store.countRelations('group-2'), 1);
  assert.deepStrictEqual(store.getRelations('group-1')[0].items, [{ claimNumber: 1, paragraphIndexes: [1] }]);
  assert.deepStrictEqual(store.getRelations('group-2')[0].items, [{ claimNumber: 2, paragraphIndexes: [2] }]);
  // 別グループの関連名は独立して採番される
  assert.strictEqual(store.getRelations('group-2')[0].name, '関連1');
});

test('無くなったグループの関連は片付けられる', () => {
  const store = makeStore();
  store.createRelation('group-1', { selection: new Map([[1, new Set([1])]]) });
  store.createRelation('group-2', { selection: new Map([[2, new Set([2])]]) });
  store.dropGroups(['group-2']);
  assert.strictEqual(store.countRelations('group-1'), 0);
  assert.strictEqual(store.countRelations('group-2'), 1);
});

test('段落数の検証（この請求項にその段落があるか）', () => {
  const store = makeStore();
  assert.strictEqual(store.isValidParagraph(1, 4), true);
  assert.strictEqual(store.isValidParagraph(1, 5), false);
  assert.strictEqual(store.isValidParagraph(99, 1), false);
});

/* ---- 書き出し ----------------------------------------------------------- */

test('JSON へ書き出せる（グループ・関連・段落原文・メモを含む）', () => {
  const list = claims({ 1: 4, 2: 5, 5: 4 });
  const store = relations.createRelationStore({ claims: list });
  store.createRelation('group-1', {
    name: '信号受信部分',
    note: '主体が違う',
    selection: new Map([[1, new Set([1, 2])], [2, new Set([4])]]),
  });

  const payload = relations.buildExport({
    groups: [{ id: 'group-1', name: '比較グループ1', claimNumbers: [1, 2, 5] }],
    relationStore: store,
    claims: list,
    meta: { title: '書類比較・クレームチェッカー', lappnum: '特願0000-000000' },
    now: Date.UTC(2026, 0, 2, 3, 4, 5),
  });

  assert.strictEqual(payload.format, 'claim-paragraph-relations');
  assert.strictEqual(payload.version, 1);
  assert.strictEqual(payload.exportedAt, '2026-01-02T03:04:05.000Z');
  assert.strictEqual(payload.source.applicationNumber, '特願0000-000000');
  assert.strictEqual(payload.groups.length, 1);
  assert.deepStrictEqual(payload.groups[0].claimNumbers, [1, 2, 5]);

  const relation = payload.groups[0].relations[0];
  assert.strictEqual(relation.name, '信号受信部分');
  assert.strictEqual(relation.note, '主体が違う');
  assert.deepStrictEqual(relation.items[0].paragraphIndexes, [1, 2]);
  assert.deepStrictEqual(relation.items[0].paragraphTexts,
    ['請求項1の第1段落の原文', '請求項1の第2段落の原文']);

  // そのまま JSON にできる
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(payload)));
});

test('閲覧用のテキストも書き出せる（正式な読み戻し形式は JSON）', () => {
  const list = claims({ 1: 2 });
  const store = relations.createRelationStore({ claims: list });
  store.createRelation('group-1', { name: '報告情報の生成', selection: new Map([[1, new Set([2])]]) });
  const payload = relations.buildExport({
    groups: [{ id: 'group-1', name: 'グループA', claimNumbers: [1] }],
    relationStore: store, claims: list, meta: {},
  });
  const text = relations.buildTextReport(payload);
  assert.ok(text.indexOf('## グループA（請求項 1）') !== -1);
  assert.ok(text.indexOf('報告情報の生成') !== -1);
  assert.ok(text.indexOf('請求項1：段落2') !== -1);
});

/* ---- 読み込み ----------------------------------------------------------- */

function samplePayload() {
  const list = claims({ 1: 4, 2: 5, 5: 4 });
  const store = relations.createRelationStore({ claims: list });
  store.createRelation('group-1', {
    name: '信号受信部分', note: 'メモ',
    selection: new Map([[1, new Set([1, 2])], [2, new Set([4])]]),
  });
  return relations.buildExport({
    groups: [{ id: 'group-1', name: '比較グループ1', claimNumbers: [1, 2, 5] }],
    relationStore: store, claims: list, meta: {},
  });
}

test('書き出した JSON をそのまま読み戻せる', () => {
  const list = claims({ 1: 4, 2: 5, 5: 4 });
  const result = relations.validateImport(samplePayload(), list);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.unresolved, []);
  assert.strictEqual(result.groups.length, 1);
  assert.deepStrictEqual(result.groups[0].claimNumbers, [1, 2, 5]);
  assert.strictEqual(result.groups[0].relations[0].name, '信号受信部分');
  assert.deepStrictEqual(result.groups[0].relations[0].items, [
    { claimNumber: 1, paragraphIndexes: [1, 2] },
    { claimNumber: 2, paragraphIndexes: [4] },
  ]);
});

test('形式・版・必須項目を検証する', () => {
  const list = claims({ 1: 2 });
  assert.ok(relations.validateImport(null, list).errors.length);
  assert.ok(relations.validateImport({ format: 'other', version: 1, groups: [] }, list)
    .errors.some((e) => e.indexOf('対応していないファイル形式') !== -1));
  assert.ok(relations.validateImport({ format: 'claim-paragraph-relations', version: 99, groups: [] }, list)
    .errors.some((e) => e.indexOf('対応していないバージョン') !== -1));
  assert.ok(relations.validateImport({ format: 'claim-paragraph-relations', version: 1 }, list)
    .errors.some((e) => e.indexOf('groups がありません') !== -1));
});

test('存在しない請求項・段落は未解決として示し、勝手に別の段落へ割り当てない', () => {
  // 現在の文書には請求項1（3段落）しかない
  const list = claims({ 1: 3 });
  const result = relations.validateImport(samplePayload(), list);
  assert.strictEqual(result.ok, true, '形式は正しいので取り込み自体は可能');

  // 請求項2・5 は無い
  assert.ok(result.unresolved.some((m) => m.indexOf('請求項2 が見つかりません') !== -1), result.unresolved.join(' / '));
  assert.ok(result.unresolved.some((m) => m.indexOf('請求項5 が見つかりません') !== -1));
  // 解決できたのは請求項1 の段落だけ。別の段落へは動かさない
  assert.deepStrictEqual(result.groups[0].claimNumbers, [1]);
  assert.deepStrictEqual(result.groups[0].relations[0].items, [{ claimNumber: 1, paragraphIndexes: [1, 2] }]);
});

test('段落番号が範囲外なら「請求項Nの段落Mが見つかりません」と出す', () => {
  const list = claims({ 1: 1 });
  const result = relations.validateImport(samplePayload(), list);
  assert.ok(result.unresolved.some((m) => m.indexOf('請求項1の段落2が見つかりません') !== -1),
    result.unresolved.join(' / '));
  assert.deepStrictEqual(result.groups[0].relations[0].items, [{ claimNumber: 1, paragraphIndexes: [1] }]);
});

test('対応する段落が1つも残らない関連は取り込まず、未解決として知らせる', () => {
  const list = claims({ 9: 2 }); // まったく別の案件
  const result = relations.validateImport(samplePayload(), list);
  assert.strictEqual(result.groups[0].relations.length, 0);
  assert.ok(result.unresolved.some((m) => m.indexOf('対応する段落が現在の文書に見つかりませんでした') !== -1));
});

test('取り込み用に関連を差し込める（置換と追加）', () => {
  const store = makeStore();
  store.createRelation('group-1', { selection: new Map([[1, new Set([1])]]) });

  store.setRelations('group-1', [{ id: 'x', name: '読み込んだ関連', note: '', items: [{ claimNumber: 2, paragraphIndexes: [2] }] }]);
  assert.strictEqual(store.countRelations('group-1'), 1, '置換で入れ替わる');
  assert.strictEqual(store.getRelations('group-1')[0].name, '読み込んだ関連');

  store.appendRelations('group-1', [{ name: '追加した関連', items: [{ claimNumber: 5, paragraphIndexes: [1] }] }]);
  assert.strictEqual(store.countRelations('group-1'), 2, '追加では既存が残る');
});

test('選択状態と items を相互に変換できる', () => {
  const items = relations.selectionToItems(new Map([[2, new Set([3, 1])], [1, new Set([2])]]));
  assert.deepStrictEqual(items, [
    { claimNumber: 1, paragraphIndexes: [2] },
    { claimNumber: 2, paragraphIndexes: [1, 3] },
  ]);
  const selection = relations.itemsToSelection(items);
  assert.deepStrictEqual(Array.from(selection.get(2)).sort(), [1, 3]);
});

test('書き出しにグループの属性（自動/手動・根拠・追加候補）を含め、読み戻しで復元する', () => {
  const list = claims({ 1: 3, 2: 3 });
  const store = relations.createRelationStore({ claims: list });
  store.createRelation('g1', { selection: new Map([[1, new Set([1])]]) });

  const payload = relations.buildExport({
    groups: [{
      id: 'g1', name: '独立項・方法', claimNumbers: [1, 2], candidateNumbers: [2],
      source: 'auto', strategy: 'category', score: 0.66,
      reasons: ['すべて独立項', '方法カテゴリー'], manuallyEdited: false,
    }],
    relationStore: store, claims: list, meta: {},
  });

  const group = payload.groups[0];
  assert.strictEqual(group.source, 'auto');
  assert.strictEqual(group.strategy, 'category');
  assert.strictEqual(group.score, 0.66);
  assert.deepStrictEqual(group.reasons, ['すべて独立項', '方法カテゴリー']);
  assert.deepStrictEqual(group.candidateNumbers, [2]);

  const restored = relations.validateImport(payload, list).groups[0];
  assert.strictEqual(restored.source, 'auto', '自動グループが手動に化けてはいけない');
  assert.strictEqual(restored.strategy, 'category');
  assert.strictEqual(restored.score, 0.66);
  assert.deepStrictEqual(restored.reasons, ['すべて独立項', '方法カテゴリー']);
  assert.deepStrictEqual(restored.candidateNumbers, [2]);
});

test('属性の無い最小形式（要件の例）でも読める', () => {
  const list = claims({ 1: 2, 2: 5 });
  const minimal = {
    format: 'claim-paragraph-relations',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    source: { title: '元画面のタイトル' },
    groups: [{
      id: 'group-1', name: '比較グループ1', claimNumbers: [1, 2],
      relations: [{
        id: 'relation-1', name: '関連1', note: '',
        items: [
          { claimNumber: 1, paragraphIndexes: [1, 2], paragraphTexts: ['a', 'b'] },
          { claimNumber: 2, paragraphIndexes: [4], paragraphTexts: ['c'] },
        ],
      }],
    }],
  };
  const result = relations.validateImport(minimal, list);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.errors, []);
  const group = result.groups[0];
  assert.deepStrictEqual(group.claimNumbers, [1, 2]);
  assert.deepStrictEqual(group.candidateNumbers, []);
  assert.strictEqual(group.source, 'manual');
  assert.deepStrictEqual(group.reasons, ['読み込んだファイルから復元']);
  assert.strictEqual(group.relations[0].items.length, 2);
});
