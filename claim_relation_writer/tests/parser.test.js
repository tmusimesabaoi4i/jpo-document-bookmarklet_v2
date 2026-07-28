'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../src/core/parser');
const examples = require('../examples/examples');

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const edgeKeys = (graph) => graph.edges.map(([f, t]) => f + '>' + t).sort();
const toKeys = (pairs) => pairs.map(([f, t]) => f + '>' + t).sort();

function parseOk(text) {
  const r = parser.parseClaimTree(text);
  assert.equal(r.ok, true, '解析成功を期待: ' + JSON.stringify(r.ok ? null : r.errors));
  return r.graph;
}
function parseErrors(text) {
  const r = parser.parseClaimTree(text);
  assert.equal(r.ok, false, 'エラーを期待したが解析成功した');
  return r.errors;
}
function assertError(errors, line, fragment) {
  assert.ok(
    errors.some((e) => e.line === line && e.message.includes(fragment)),
    `line=${line} message⊇「${fragment}」を期待: ` + JSON.stringify(errors)
  );
}

// ---------- 正常系: 提供された木構造1〜5の完全一致 ----------

test('木構造1: ノード・辺集合・独立請求項の完全一致', () => {
  const g = parseOk(examples.trees.tree1.text);
  assert.deepEqual(g.nodes, range(1, 30));
  assert.deepEqual(edgeKeys(g), toKeys([
    [1, 2], [2, 3], [1, 4], [4, 5], [4, 6], [4, 7], [1, 8], [1, 9], [9, 10], [9, 11],
    [1, 12], [1, 13], [13, 14], [13, 15], [13, 16], [13, 17], [13, 18], [13, 19], [13, 20],
    [21, 22], [21, 23], [21, 24], [21, 25], [25, 26], [27, 28], [27, 29],
  ]));
  assert.deepEqual(g.roots, [1, 21, 27, 30]);
});

test('木構造2: 多項従属（12の引用先=1〜11）・同一番号は1ノード', () => {
  const g = parseOk(examples.trees.tree2.text);
  assert.deepEqual(g.nodes, range(1, 12));
  const parentsOf12 = g.edges.filter((e) => e[1] === 12).map((e) => e[0]).sort((a, b) => a - b);
  assert.deepEqual(parentsOf12, range(1, 11));
  assert.deepEqual(edgeKeys(g), toKeys([
    [1, 2], [2, 4], [4, 12], [2, 12], [1, 3], [3, 12], [1, 5], [5, 12], [1, 6], [6, 12],
    [1, 7], [7, 12], [1, 12], [8, 9], [9, 10], [10, 12], [9, 11], [11, 12], [9, 12], [8, 12],
  ]));
  assert.deepEqual(g.roots, [1, 8]);
});

test('木構造3: 単一の独立請求項', () => {
  const g = parseOk(examples.trees.tree3.text);
  assert.deepEqual(g.nodes, [1]);
  assert.deepEqual(g.edges, []);
  assert.deepEqual(g.roots, [1]);
});

test('木構造4: 独立請求項3つ', () => {
  const g = parseOk(examples.trees.tree4.text);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3], [4, 5], [4, 6], [7, 8], [7, 9]]));
  assert.deepEqual(g.roots, [1, 4, 7]);
});

test('木構造5: 多項従属12 + 独立項13', () => {
  const g = parseOk(examples.trees.tree5.text);
  assert.deepEqual(g.nodes, range(1, 13));
  const parentsOf12 = g.edges.filter((e) => e[1] === 12).map((e) => e[0]).sort((a, b) => a - b);
  assert.deepEqual(parentsOf12, range(1, 11));
  assert.deepEqual(g.roots, [1, 13]);
});

// ---------- 正常系: 正規化・表記ゆれ ----------

test('空白バリエーション: タブ・CRLF・全角スペース・全角数字', () => {
  const g = parseOk('\t1 ┳\t２\r\n\t\t┗ ３\r\n　 4');
  assert.deepEqual(g.nodes, [1, 2, 3, 4]);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3]]));
  assert.deepEqual(g.roots, [1, 4]);
});

test('異体字罫線（細線 ┬ ├ │ └ ─）も解析できる', () => {
  const g = parseOk('1 ┬ 2\n  ├ 3\n  │\n  └ 4 ─ 5');
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3], [1, 4], [4, 5]]));
});

test('同一番号の行頭再掲はノードを統合し、独立請求項と誤認しない', () => {
  const g = parseOk('1 ┳ 2\n  ┗ 3\n2 ━ 4');
  assert.deepEqual(g.nodes, [1, 2, 3, 4]);
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3], [2, 4]]));
  assert.deepEqual(g.roots, [1]); // 2 は行頭に再掲されているが独立請求項ではない
});

test('┃だけの行・空行はスキップされる', () => {
  const g = parseOk('1 ┳ 2\n┃\n\n  ┗ 3');
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2], [1, 3]]));
});

test('同一の辺が重複入力されても1つに統合される', () => {
  const g = parseOk('1 ━ 2\n1 ━ 2');
  assert.deepEqual(edgeKeys(g), toKeys([[1, 2]]));
});

// ---------- 異常系: 不変条件（黙殺誤解析の防止） ----------

test('内側の分岐の┗閉じ忘れは行番号付きエラー（推測で救済しない）', () => {
  const errors = parseErrors('1 ┳ 2 ┳ 3\n  ┣ 8 ┳ 9');
  assertError(errors, 2, '┗ で閉じられていない');
});

test('┃の数が不足した┗も同じ不変条件エラー', () => {
  const errors = parseErrors('1 ┳ 2 ┳ 3\n  ┗ 4');
  assertError(errors, 2, '┗ で閉じられていない');
});

test('対応する分岐（┳）がない┣はエラー', () => {
  const errors = parseErrors('┣ 5');
  assertError(errors, 1, '対応する分岐');
});

test('┃が多すぎる行はエラー', () => {
  const errors = parseErrors('1 ┳ 2\n┃ ┃ ┗ 3');
  assertError(errors, 2, '対応する分岐');
});

// ---------- 異常系: 構文 ----------

test('接続記号なしで請求項番号が連続するとエラー', () => {
  assertError(parseErrors('1 2'), 1, '連続');
});

test('行頭の ━ / ┳ はエラー', () => {
  assertError(parseErrors('━ 5'), 1, '行頭に ━');
  assertError(parseErrors('┳ 5'), 1, '行頭に ┳');
});

test('接続記号の直後に番号がない（行末で途切れる）とエラー', () => {
  assertError(parseErrors('1 ┳'), 1, '┳ の直後に請求項番号がありません');
  assertError(parseErrors('1 ━'), 1, '━ の直後に請求項番号がありません');
});

test('┣ / ┗ の直後に番号がないとエラー', () => {
  assertError(parseErrors('1 ┳ 2\n┗'), 2, '┗ の直後に請求項番号がありません');
});

test('┃の直後に番号は置けない', () => {
  assertError(parseErrors('1 ┳ 2\n┃ 3'), 2, '┃ の直後に請求項番号は置けません');
});

test('解釈できない文字は行番号+文字付きエラー', () => {
  assertError(parseErrors('1 ┳ 2\n※'), 2, '※');
  assertError(parseErrors('1 ═ 2'), 1, '═'); // 対応表にない罫線は黙殺しない
});

test('請求項番号0はエラー', () => {
  assertError(parseErrors('0'), 1, '1以上');
  assertError(parseErrors('1 ━ 0'), 1, '1以上');
});

test('自己ループ（n ━ n）はエラー', () => {
  assertError(parseErrors('1 ━ 1'), 1, '自分自身');
});

test('循環する引用関係は経路付きエラーで、無限ループしない', () => {
  const errors = parseErrors('1 ━ 2\n2 ━ 3\n3 ━ 1');
  assertError(errors, null, '循環する引用関係');
  assert.ok(errors.some((e) => e.message.includes('1 → 2 → 3 → 1')), JSON.stringify(errors));
});

test('空入力はエラー', () => {
  assertError(parseErrors(''), null, '入力されていません');
  assertError(parseErrors('  \n　\n'), null, '入力されていません');
});

test('複数行のエラーはまとめて返る', () => {
  const errors = parseErrors('1 2\n━ 5');
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((e) => e.line), [1, 2]);
});

// ---------- parseClaimNumberList（Step3 入力の解析） ----------

test('parseClaimNumberList: 区切り・全角・範囲を許容', () => {
  assert.deepEqual(parser.parseClaimNumberList('２、４'), { ok: true, claims: [2, 4] });
  assert.deepEqual(parser.parseClaimNumberList('2, 4 7-9'), { ok: true, claims: [2, 4, 7, 8, 9] });
  assert.deepEqual(parser.parseClaimNumberList('14-20'), { ok: true, claims: range(14, 20) });
  assert.deepEqual(parser.parseClaimNumberList('１４－２０'), { ok: true, claims: range(14, 20) });
  assert.deepEqual(parser.parseClaimNumberList('3、3、3'), { ok: true, claims: [3] });
  assert.deepEqual(parser.parseClaimNumberList(''), { ok: true, claims: [] });
  assert.deepEqual(parser.parseClaimNumberList('  　'), { ok: true, claims: [] });
});

test('parseClaimNumberList: 不正入力はエラー', () => {
  assert.equal(parser.parseClaimNumberList('9-7').ok, false);
  assert.ok(parser.parseClaimNumberList('9-7').error.includes('順'));
  assert.equal(parser.parseClaimNumberList('abc').ok, false);
  assert.ok(parser.parseClaimNumberList('abc').error.includes('abc'));
  assert.equal(parser.parseClaimNumberList('0').ok, false);
  assert.ok(parser.parseClaimNumberList('0').error.includes('1以上'));
  assert.equal(parser.parseClaimNumberList('1-999999').ok, false);
});
