'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cite = require('../src/core/cite');
const parser = require('../src/core/parser');
const structure = require('../src/core/structure');
const resolver = require('../src/core/resolver');
const collectorApp = require('../src/bookmarklet/common/collector-app');
const examples = require('../examples/examples');

const ROOT = path.join(__dirname, '..');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const edgeKey = (edges) => edges.map((e) => e.join('>')).sort().join('|');

// フィクスチャ（リポジトリ共有の fixtures/）から任意要素の innerHTML を取り出す。
// claim_cite / claim_tree の中身は入れ子 div を持たないので最初の </div> で閉じてよい
function fixtureElementText(file, id) {
  const html = fs.readFileSync(path.join(ROOT, '..', 'fixtures', 'claim-checker', 'new', file), 'utf8');
  const re = new RegExp('<div[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)<\\/div>');
  const m = re.exec(html);
  assert.ok(m, file + ': #' + id + ' が見つからない');
  return collectorApp.treeHtmlToText(m[1]);
}

const OVERFLOW_FIXTURE = '書類比較・クレームチェッカー_引用パターン上限到達.html';
const NORMAL_FIXTURE = '書類比較・クレームチェッカー.html';

// ---------------------------------------------------------------------------
// 等価性: 上限に達していないページでは「引用一覧」と「木構造」は同じグラフを表す。
// これが崩れたら引用一覧を主データ源にする前提そのものが壊れているので、最重要の回帰テスト。
// ---------------------------------------------------------------------------

test('等価性: 引用一覧サンプル cite1 のグラフが木構造 tree6 と完全一致', () => {
  const c = cite.parseClaimCite(examples.cites.cite1.text);
  assert.equal(c.ok, true);
  const t = parser.parseClaimTree(examples.trees.tree6.text);
  assert.equal(t.ok, true);
  assert.deepEqual(c.graph.nodes, t.graph.nodes);
  assert.equal(edgeKey(c.graph.edges), edgeKey(t.graph.edges));
  assert.deepEqual(c.graph.roots, t.graph.roots);
  assert.deepEqual(c.graph.roots, [1, 13, 22, 23, 24]);
  assert.deepEqual(c.warnings, [], '整合しているページで警告が出てはいけない');
});

test('等価性: 実ページ（上限未到達）の #claim_cite と #claim_tree が同じグラフになる', () => {
  const citeText = fixtureElementText(NORMAL_FIXTURE, 'claim_cite');
  const treeText = fixtureElementText(NORMAL_FIXTURE, 'claim_tree');
  const c = cite.parseClaimCite(citeText);
  const t = parser.parseClaimTree(treeText);
  assert.equal(c.ok, true);
  assert.equal(t.ok, true);
  assert.deepEqual(c.graph.nodes, t.graph.nodes);
  assert.equal(edgeKey(c.graph.edges), edgeKey(t.graph.edges));
  assert.deepEqual(c.graph.roots, t.graph.roots);
  assert.equal(c.meta.overflow, false);
  assert.equal(c.meta.declaredTotal, 24);
  assert.deepEqual(c.meta.declaredRoots, [1, 13, 22, 23, 24]);
  // サンプル cite1 は実ページからの抽出結果そのもの（ドリフト検出）
  assert.equal(citeText, examples.cites.cite1.text);
});

// ---------------------------------------------------------------------------
// 上限到達ケース（本修正の主目的）
// ---------------------------------------------------------------------------

test('上限到達: 木構造は22項に欠落するが、引用一覧からは92項すべて復元できる', () => {
  const treeText = fixtureElementText(OVERFLOW_FIXTURE, 'claim_tree');
  const t = parser.parseClaimTree(treeText);
  // 罫線としては正しいので「解析成功」してしまうのが厄介な点（黙って誤る）
  assert.equal(t.ok, true, '木構造は構文エラーにならない（だから危険）');
  assert.equal(t.graph.nodes.length, 22, '木構造からは22項しか取れない');
  assert.deepEqual(t.graph.roots, [1], '木構造からは独立請求項が1つしか見えない');

  const citeText = fixtureElementText(OVERFLOW_FIXTURE, 'claim_cite');
  const c = cite.parseClaimCite(citeText);
  assert.equal(c.ok, true);
  assert.deepEqual(c.graph.nodes, range(1, 92));
  assert.equal(c.graph.edges.length, 857);
  assert.deepEqual(c.graph.roots, [1, 22, 42, 43, 46, 68, 89, 90]);
  assert.equal(c.meta.overflow, true);
  assert.equal(c.meta.overflowLimit, 5000);
  assert.equal(c.meta.declaredTotal, 92);
  assert.deepEqual(c.meta.declaredRoots, c.graph.roots, 'ページ側の独立請求項と一致する');
  assert.deepEqual(c.warnings, [], '上限到達でも自己矛盾は無い');
});

test('上限到達: 木構造のエッジは引用一覧のエッジの真部分集合（矛盾せず、欠落しているだけ）', () => {
  const t = parser.parseClaimTree(fixtureElementText(OVERFLOW_FIXTURE, 'claim_tree'));
  const c = cite.parseClaimCite(fixtureElementText(OVERFLOW_FIXTURE, 'claim_cite'));
  const citeEdges = new Set(c.graph.edges.map((e) => e.join('>')));
  const treeEdges = t.graph.edges.map((e) => e.join('>'));
  assert.equal(treeEdges.length, 100);
  assert.deepEqual(treeEdges.filter((e) => !citeEdges.has(e)), [], '木構造にしか無いエッジは無い');
});

test('上限到達: エッジは「引用請求項」からのみ作る（「被引用請求項」からは219本しか取れない）', () => {
  const citeText = fixtureElementText(OVERFLOW_FIXTURE, 'claim_cite');
  const c = cite.parseClaimCite(citeText);

  // 「被引用請求項 − うち間接被引用」で逆方向に組み立てると、上限到達時は不完全になる。
  // 実装がうっかりこちらを使ったら 857 ではなく 219 に退化するので、その差を固定する。
  const revEdges = new Set();
  const blockRe = /\[(\d+)\][ \t　]*請求項[ \t　]*(\d+)([\s\S]*?)(?=\n[ \t　]*\[\d+\][ \t　]*請求項|$)/g;
  let m;
  while ((m = blockRe.exec(citeText)) !== null) {
    const claim = parseInt(m[2], 10);
    const all = /被引用請求項[ \t　]*:[ \t　]*([\d,、\s]+)/.exec(m[3]);
    if (!all) continue;
    const indirectM = /間接被引用[ \t　]*:[ \t　]*([\d,、\s]+)/.exec(m[3]);
    const indirect = new Set(cite.numList(indirectM ? indirectM[1] : ''));
    for (const child of cite.numList(all[1])) {
      if (!indirect.has(child)) revEdges.add(claim + '>' + child);
    }
  }
  assert.equal(revEdges.size, 219, '被引用請求項からは219本しか復元できない（＝使ってはいけない）');
  assert.equal(c.graph.edges.length, 857, '実装は引用請求項（順方向）を使っている');
});

test('上限到達: 従来エラーになっていた請求項50の影響範囲が正しく計算できる', () => {
  const c = cite.parseClaimCite(fixtureElementText(OVERFLOW_FIXTURE, 'claim_cite'));
  const resolved = resolver.resolveAffectedClaims(c.graph, [50], []);
  assert.equal(resolved.ok, true, '「請求項50は…存在しません」エラーが再発している');
  assert.deepEqual(resolved.allAffectedClaims, range(50, 67).concat([91]));

  // 木構造からは、そもそも請求項50が存在しないためエラーになる（修正前の症状）
  const t = parser.parseClaimTree(fixtureElementText(OVERFLOW_FIXTURE, 'claim_tree'));
  const broken = resolver.resolveAffectedClaims(t.graph, [50], []);
  assert.equal(broken.ok, false);
  assert.match(broken.error, /請求項50は入力されたクレーム構造に存在しません/);
});

test('上限到達: 木構造でも取れていた範囲（請求項2）は引用一覧でも同じ結果になる', () => {
  const c = cite.parseClaimCite(fixtureElementText(OVERFLOW_FIXTURE, 'claim_cite'));
  const resolved = resolver.resolveAffectedClaims(c.graph, [2], []);
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.allAffectedClaims, range(2, 21).concat([44]));
});

// ---------------------------------------------------------------------------
// 書式そのものの解釈
// ---------------------------------------------------------------------------

test('引用請求項は直接引用元のみ・(間接引用: …) は引用関係に含めない', () => {
  const text = [
    '合計請求項数: 6  (独立請求項: 1)',
    '[1]請求項1 『・・装置』 独立請求項',
    '[2]請求項2 『・・装置』 従属請求項',
    '　引用請求項: 1　引用パターンの数: 1',
    '[3]請求項3 『・・装置』 従属請求項',
    '　引用請求項: 1,2　引用パターンの数: 2',
    '[4]請求項4 『・・装置』 従属請求項',
    '　引用請求項: 3 (間接引用: 1,2)　引用パターンの数: 2',
    '[5]請求項5 『・・装置』 従属請求項',
    '　引用請求項: 4 (間接引用: 1,2,3)　引用パターンの数: 2',
    '[6]請求項6 『・・方法』 従属請求項',
    '　引用請求項: 1,2,3,4,5　引用パターンの数: 8',
  ].join('\n');
  const c = cite.parseClaimCite(text);
  assert.equal(c.ok, true);
  // 請求項4・5 は括弧内（間接引用）を引用元にしない
  assert.equal(edgeKey(c.graph.edges), edgeKey([
    [1, 2], [1, 3], [2, 3], [3, 4], [4, 5],
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  ]));
  assert.deepEqual(c.graph.roots, [1]);
  assert.deepEqual(c.meta.patternCounts, { 2: 1, 3: 2, 4: 2, 5: 2, 6: 8 });
});

test('全角数字・全角コロン・全角括弧を正規化して解析できる', () => {
  const text = [
    '合計請求項数： ３  （独立請求項： １）',
    '[1]請求項１ 『・・装置』 独立請求項',
    '[2]請求項２ 『・・装置』 従属請求項',
    '　引用請求項： １　引用パターンの数： １',
    '[3]請求項３ 『・・装置』 従属請求項',
    '　引用請求項： ２ （間接引用： １）　引用パターンの数： １',
  ].join('\n');
  const c = cite.parseClaimCite(text);
  assert.equal(c.ok, true);
  assert.deepEqual(c.graph.nodes, [1, 2, 3]);
  assert.equal(edgeKey(c.graph.edges), edgeKey([[1, 2], [2, 3]]));
  assert.equal(c.meta.declaredTotal, 3);
});

test('エラー: 空入力・引用一覧でないテキスト・自己引用・循環', () => {
  assert.equal(cite.parseClaimCite('').ok, false);
  assert.equal(cite.parseClaimCite('   \n  ').ok, false);

  const notCite = cite.parseClaimCite('合計請求項数: 3');
  assert.equal(notCite.ok, false);
  assert.match(notCite.errors[0].message, /\[1\]請求項1/);

  const selfCite = cite.parseClaimCite([
    '[1]請求項1 独立請求項',
    '[2]請求項2 従属請求項',
    '　引用請求項: 1,2',
  ].join('\n'));
  assert.equal(selfCite.ok, false);
  assert.match(selfCite.errors[0].message, /請求項2が自分自身を引用しています/);
  assert.equal(selfCite.errors[0].line, 2, 'ブロック開始行を行番号として報告する');

  const cyclic = cite.parseClaimCite([
    '[1]請求項1 従属請求項',
    '　引用請求項: 3',
    '[2]請求項2 従属請求項',
    '　引用請求項: 1',
    '[3]請求項3 従属請求項',
    '　引用請求項: 2',
  ].join('\n'));
  assert.equal(cyclic.ok, false);
  assert.match(cyclic.errors[0].message, /循環する引用関係/);
});

test('警告: ページ側の申告値と解析結果の不一致は警告にとどめ、解析は成功させる', () => {
  const c = cite.parseClaimCite([
    '合計請求項数: 9  (独立請求項: 1,5)',
    '[1]請求項1 独立請求項',
    '[2]請求項2 従属請求項',
    '　引用請求項: 1',
  ].join('\n'));
  assert.equal(c.ok, true, '不一致でも生成はブロックしない');
  assert.equal(c.warnings.length, 2);
  assert.ok(c.warnings.some((w) => w.includes('合計請求項数')));
  assert.ok(c.warnings.some((w) => w.includes('独立請求項')));
});

test('警告: 上限未到達なら「引用請求項」と「被引用請求項」の不一致を検出する', () => {
  const c = cite.parseClaimCite([
    '[1]請求項1 独立請求項',
    '　被引用請求項: 2,3',
    '[2]請求項2 従属請求項',
    '　引用請求項: 1',
    '[3]請求項3 独立請求項',
  ].join('\n'));
  assert.equal(c.ok, true);
  assert.ok(c.warnings.some((w) => w.includes('被引用請求項')), '逆方向の不一致を警告する');
});

test('警告なし: 上限到達時は「被引用請求項」との照合をしない（不完全な値のため）', () => {
  const c = cite.parseClaimCite([
    '★全請求項間引用パターン全展開上限数(5000)到達のため、上限数の引用パターンについて解析します。★',
    '[1]請求項1 独立請求項',
    '　被引用請求項: 2,3',
    '[2]請求項2 従属請求項',
    '　引用請求項: 1',
    '[3]請求項3 独立請求項',
  ].join('\n'));
  assert.equal(c.ok, true);
  assert.equal(c.meta.overflow, true);
  assert.deepEqual(c.warnings, []);
});

// ---------------------------------------------------------------------------
// 書式判定とディスパッチ
// ---------------------------------------------------------------------------

test('detectFormat: 引用一覧・木構造・判定不能', () => {
  assert.equal(structure.detectFormat(examples.cites.cite1.text), 'cite');
  assert.equal(structure.detectFormat(examples.trees.tree6.text), 'tree');
  assert.equal(structure.detectFormat('[1]請求項1 独立請求項'), 'cite');
  assert.equal(structure.detectFormat('　引用請求項: 1'), 'cite');
  assert.equal(structure.detectFormat('1 ┳ 2'), 'tree');
  assert.equal(structure.detectFormat(''), 'unknown');
  assert.equal(structure.detectFormat('   '), 'unknown');
  assert.equal(structure.detectFormat('あいうえお'), 'unknown');
  assert.equal(structure.detectFormat(null), 'unknown');
});

test('parseClaimStructure: 書式を自動判別し format を返す', () => {
  const c = structure.parseClaimStructure(examples.cites.cite1.text);
  assert.equal(c.ok, true);
  assert.equal(c.format, 'cite');
  assert.equal(c.meta.declaredTotal, 24);

  const t = structure.parseClaimStructure(examples.trees.tree6.text);
  assert.equal(t.ok, true);
  assert.equal(t.format, 'tree');
  assert.equal(t.meta, null);
  assert.deepEqual(t.warnings, []);

  // 判定不能なテキストは木構造として読み、従来どおり行番号付きエラーを返す
  const bad = structure.parseClaimStructure('あいうえお');
  assert.equal(bad.ok, false);
  assert.equal(bad.format, 'unknown');
  assert.equal(bad.errors[0].line, 1);

  const empty = structure.parseClaimStructure('');
  assert.equal(empty.ok, false);
  assert.equal(empty.format, 'unknown');
});

test('formatLabel: 収集元の表示名', () => {
  assert.equal(structure.formatLabel('cite'), '引用一覧');
  assert.equal(structure.formatLabel('tree'), '木構造');
  assert.equal(structure.formatLabel(null), '不明');
});
