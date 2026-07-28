'use strict';
/*
 * claim-tree.test.js — 罫線ツリー解析（取り込んだ機構）の検証
 *
 * claim_relation_writer の parser.js からアルゴリズムを取り込んだモジュールなので、
 * 取り込みが忠実であることを確かめるため、同等のケース（正常系・不変条件違反・循環）を
 * 本プロジェクト側でも独立に検証する。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const claimTree = require('../src/core/claim-tree');

const CLAIM_HTML = path.join(__dirname, '..', '..', 'fixtures', 'claim-checker', 'new',
  '書類比較・クレームチェッカー_特願2024-203064.html');

const edgeKeys = (graph) => graph.edges.map(([f, t]) => f + '>' + t).sort();
const toKeys = (pairs) => pairs.map(([f, t]) => f + '>' + t).sort();

function parseOk(text) {
  const r = claimTree.parseClaimTree(text);
  assert.equal(r.ok, true, '解析成功を期待: ' + JSON.stringify(r.ok ? null : r.errors));
  return r.graph;
}
function parseErrors(text) {
  const r = claimTree.parseClaimTree(text);
  assert.equal(r.ok, false, 'エラーを期待したが解析成功した');
  return r.errors;
}
function assertError(errors, line, fragment) {
  assert.ok(
    errors.some((e) => e.line === line && e.message.includes(fragment)),
    `line=${line} message⊇「${fragment}」を期待: ` + JSON.stringify(errors)
  );
}

// ---- 正常系 ---------------------------------------------------------------

test('単一の独立請求項', () => {
  const g = parseOk(' 1 \n');
  assert.deepEqual(g.nodes, [1]);
  assert.deepEqual(g.edges, []);
  assert.deepEqual(g.roots, [1]);
});

test('直列（━）は連鎖する引用になる', () => {
  const g = parseOk(' 1 ━ 2 ━ 3 \n');
  assert.deepEqual(g.nodes, [1, 2, 3]);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [2, 3]]));
  assert.deepEqual(g.roots, [1]);
});

test('分岐（┳ ┣ ┗）と入れ子', () => {
  const text = [
    ' 1 ┳ 2 ┳ 3 ',
    '   ┃   ┣ 4 ━ 5 ',
    '   ┃   ┗ 6 ',
    '   ┗ 7 ',
    '',
  ].join('\n');
  const g = parseOk(text);
  assert.deepEqual(g.nodes, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [2, 3], [2, 4], [4, 5], [2, 6], [1, 7]]));
  assert.deepEqual(g.roots, [1]);
});

test('複数のツリー（行頭が数字なら前のツリーは終了）', () => {
  const g = parseOk(' 1 ┳ 2 \n   ┗ 3 \n 4 ━ 5 \n 6 \n');
  assert.deepEqual(g.nodes, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3], [4, 5]]));
  assert.deepEqual(g.roots, [1, 4, 6]);
});

test('多項従属: 同じ番号が複数箇所に現れても同一ノード', () => {
  const g = parseOk(' 1 ┳ 2 ━ 4 \n   ┗ 3 ━ 4 \n');
  assert.deepEqual(g.nodes, [1, 2, 3, 4]);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [2, 4], [1, 3], [3, 4]]));
  assert.deepEqual(g.roots, [1]);
});

test('全角数字・罫線異体字・空白の混在を正規化する', () => {
  const g = parseOk('　１ ┬　２\n　　└　３\n');
  assert.deepEqual(g.nodes, [1, 2, 3]);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3]]));
});

test('空行と ┃ だけの行はスキップされる', () => {
  const g = parseOk(' 1 ┳ 2 \n   ┃ \n\n   ┗ 3 \n');
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3]]));
});

test('重複する辺は1本にまとめられる', () => {
  const g = parseOk(' 1 ━ 2 \n 1 ━ 2 \n');
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2]]));
});

// ---- 異常系（誤った関係を黙って作らないこと） -----------------------------

test('空入力はエラー', () => {
  assertError(parseErrors(''), null, 'クレーム構造が入力されていません');
  assertError(parseErrors('   \n\n'), null, 'クレーム構造が入力されていません');
});

test('┃ の数が多い（内側の分岐が閉じられていない）', () => {
  assertError(parseErrors(' 1 ┳ 2 ┳ 3 \n   ┣ 4 \n'), 2, '┗ で閉じられていない');
});

test('┃ の数が足りない（対応する分岐がない）', () => {
  assertError(parseErrors(' 1 ━ 2 \n   ┃ ┣ 3 \n'), 2, '対応する分岐');
});

test('┃ の直後に数字は置けない', () => {
  assertError(parseErrors(' 1 ┳ 2 \n   ┃ 3 \n'), 2, '┣ または ┗ が必要');
});

test('行頭に ┳ や ━ は置けない', () => {
  assertError(parseErrors(' ┳ 1 \n'), 1, '行頭に ┳ は置けません');
  assertError(parseErrors(' ━ 1 \n'), 1, '行頭に ━ は置けません');
});

test('連結記号の直後に番号がない／番号が連続している', () => {
  assertError(parseErrors(' 1 ━ \n'), 1, '直後に請求項番号がありません');
  assertError(parseErrors(' 1 2 \n'), 1, '請求項番号が連続しています');
});

test('自己引用はエラー', () => {
  assertError(parseErrors(' 1 ━ 1 \n'), 1, '自分自身を引用');
});

test('解釈できない文字はエラー（黙って無視しない）', () => {
  assertError(parseErrors(' 1 ━ 2 あ \n'), 1, '解釈できない文字');
});

test('循環は経路つきで報告される', () => {
  const errors = parseErrors(' 1 ━ 2 ━ 3 \n 3 ━ 1 \n');
  assertError(errors, null, '循環する引用関係');
});

// ---- 実データ -------------------------------------------------------------

test('実 fixture: #claim_tree から 26 節点・独立請求項 1,25,26 を得る', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const html = fs.readFileSync(CLAIM_HTML, 'utf8');
  const i = html.indexOf('id="claim_tree"');
  const j = html.indexOf('class="div_tree', i);
  const gt = html.indexOf('>', j);
  const inner = html.slice(gt + 1, html.indexOf('</div>', gt));
  const text = inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  const g = parseOk(text);
  assert.deepEqual(g.nodes, Array.from({ length: 26 }, (_, k) => k + 1));
  assert.deepEqual(g.roots, [1, 25, 26]);
  assert.deepEqual(edgeKeys(g), toKeys([
    [1, 2], [2, 3], [2, 4], [4, 5], [2, 6], [2, 7],
    [1, 8], [1, 9], [1, 10], [1, 11], [1, 12], [1, 13], [13, 14],
    [1, 15], [1, 16], [1, 17], [17, 18], [1, 19], [1, 20],
    [1, 21], [1, 22], [1, 23], [1, 24],
  ]));
});
