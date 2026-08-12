'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const build = require('../scripts/build-bookmarklets');
const collectorApp = require('../src/bookmarklet/common/collector-app');
const parser = require('../src/core/parser');
const structure = require('../src/core/structure');
const examples = require('../examples/examples');

const ROOT = path.join(__dirname, '..');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const readNormalized = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

test('生成物の鮮度: コミット済み4ファイルが再ビルド結果と一致（EOL正規化）', () => {
  for (const targetKey of Object.keys(build.TARGETS)) {
    const artifacts = build.buildArtifacts(targetKey);
    const dir = path.join(ROOT, 'src', 'bookmarklet', targetKey);
    const pairs = [
      ['collector.js', artifacts.collector],
      ['collector.bookmarklet.js', artifacts.bookmarklet],
    ];
    for (const [file, expected] of pairs) {
      const actual = readNormalized(path.join(dir, file));
      assert.equal(
        actual,
        expected,
        'src/bookmarklet/' + targetKey + '/' + file +
        ' が古い可能性があります。npm run build:bookmarklets で再生成してください。'
      );
    }
  }
});

test('1行版: javascript:開始・1行・生#なし・%は正しいエスケープのみ・ラウンドトリップ・構文OK', () => {
  for (const targetKey of Object.keys(build.TARGETS)) {
    const body = build.buildBody(targetKey);
    const url = build.encodeBookmarklet(body);
    assert.ok(url.startsWith('javascript:'), targetKey);
    const payload = url.slice('javascript:'.length);
    assert.equal(payload.includes('\n'), false, targetKey + ': 改行が残っている');
    assert.equal(payload.includes('#'), false, targetKey + ': 生の # が残っている');
    assert.equal(/%(?![0-9A-Fa-f]{2})/.test(payload), false, targetKey + ': 不正な % エスケープ');
    assert.equal(decodeURIComponent(payload), body, targetKey + ': ラウンドトリップ不一致');
    assert.doesNotThrow(() => new Function(body), targetKey + ': デコード後の構文エラー');

    // ファイルとしても1行（末尾改行のみ許容）
    const fileContent = readNormalized(path.join(ROOT, 'src', 'bookmarklet', targetKey, 'collector.bookmarklet.js'));
    assert.equal(fileContent.trim().includes('\n'), false, targetKey + ': ファイルが複数行');
  }
});

test('CSP衛生: バンドルに実行時評価・script挿入の構造が含まれない', () => {
  const body = build.buildBody('new');
  for (const forbidden of ['eval(', 'new Function(', 'document.write', '<script']) {
    assert.equal(body.includes(forbidden), false, '「' + forbidden + '」が含まれている');
  }
});

test('連結スモーク: コア+app を連結順どおり評価すると CRW.* が揃う', () => {
  const src = build.coreAndAppSource();
  // new Function のスコープでは module/exports が見えないため各UMDはブラウザ分岐に入り、
  // globalThis.CRW に登録される（連結順ミスは各UMDの依存ガードが throw して検出される）
  const run = new Function(src + '\nreturn globalThis.CRW;');
  const CRW = run();
  const modules = [
    'parser', 'cite', 'structure', 'formatter', 'resolver', 'generator', 'session', 'collectorApp',
  ];
  for (const m of modules) {
    assert.ok(CRW && CRW[m], 'CRW.' + m + ' が登録されていない');
  }
});

test('SOURCE_ORDER: 依存が前に来る順序になっている', () => {
  const order = build.SOURCE_ORDER.map((p) => path.basename(p));
  const idx = (name) => order.indexOf(name);
  assert.ok(idx('formatter.js') < idx('generator.js'));
  assert.ok(idx('parser.js') < idx('cite.js'));
  assert.ok(idx('cite.js') < idx('structure.js'));
  assert.ok(idx('parser.js') < idx('structure.js'));
  assert.ok(idx('structure.js') < idx('session.js'));
  assert.ok(idx('parser.js') < idx('session.js'));
  assert.ok(idx('resolver.js') < idx('session.js'));
  assert.ok(idx('generator.js') < idx('session.js'));
  assert.ok(idx('session.js') < idx('collector-app.js'));
});

test('treeHtmlToText: 実ページ（new/legacy）の innerHTML から tree6 とバイト一致で抽出できる', () => {
  // スナップショットはリポジトリ共有の fixtures/（このテストのみリポジトリ全体のチェックアウトが前提）
  for (const gen of ['new', 'legacy']) {
    const file = path.join('fixtures', 'claim-checker', gen, '書類比較・クレームチェッカー.html');
    const html = fs.readFileSync(path.join(ROOT, '..', file), 'utf8');
    const m = /<div id="claim_tree"[^>]*><div class="div_tree div_textarea">([\s\S]*?)<\/div>/.exec(html);
    assert.ok(m, file + ': #claim_tree 内の div_tree が見つからない');
    const text = collectorApp.treeHtmlToText(m[1]);
    assert.equal(text, examples.trees.tree6.text, file + ': 抽出テキストが tree6 と不一致');

    const parsed = parser.parseClaimTree(text);
    assert.equal(parsed.ok, true, file + ': 抽出テキストの解析に失敗');
    assert.deepEqual(parsed.graph.nodes, range(1, 24), file);
    assert.deepEqual(parsed.graph.roots, [1, 13, 22, 23, 24], file);
  }
});

test('treeHtmlToText: タグ除去・エンティティ復元・境界', () => {
  assert.equal(collectorApp.treeHtmlToText('1 ┳ 2 <br>'), '1 ┳ 2 \n');
  assert.equal(collectorApp.treeHtmlToText('1 ┳ 2 <BR/><br >3'), '1 ┳ 2 \n\n3');
  assert.equal(collectorApp.treeHtmlToText('<span>1</span> ━ 2<br>'), '1 ━ 2\n');
  assert.equal(collectorApp.treeHtmlToText('1&nbsp;━&nbsp;2<br>'), '1 ━ 2\n');
  assert.equal(collectorApp.treeHtmlToText('&amp;lt;'), '&lt;'); // &amp; の復元は最後（二重復元しない）
  assert.equal(collectorApp.treeHtmlToText(''), '');
  assert.equal(collectorApp.treeHtmlToText(null), '');
});

test('extractTreeText: セレクタ優先順・空スキップ・全滅時の救済メッセージ', () => {
  const el = (html) => ({ innerHTML: html });
  const docStub = (map) => ({ querySelectorAll: (sel) => map[sel] || [] });

  // #claim_tree 側が最優先で選ばれる
  let r = collectorApp.extractTreeText(docStub({
    '#claim_tree .div_tree': [el('1 ━ 2 <br>')],
    '#claim_dialog .div_tree': [el('9 ━ 9 <br>')],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.text, '1 ━ 2 \n');
  assert.equal(r.selector, '#claim_tree .div_tree');

  // 空要素はスキップして次の候補セレクタへ
  r = collectorApp.extractTreeText(docStub({
    '#claim_tree .div_tree': [el('  <br>  ')],
    '#claim_dialog .div_tree': [el('3 ━ 4 <br>')],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.selector, '#claim_dialog .div_tree');
  assert.equal(r.text, '3 ━ 4 \n');

  // 同一セレクタ内でも空要素はスキップして次の要素へ
  r = collectorApp.extractTreeText(docStub({
    '.div_tree': [el(''), el('5 ━ 6 <br>')],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.selector, '.div_tree');
  assert.equal(r.text, '5 ━ 6 \n');

  // 全滅 → ok:false + 手貼り誘導メッセージ
  r = collectorApp.extractTreeText(docStub({}));
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('クレーム解析'));
  assert.ok(r.error.includes('手動で貼り付け'));
});

test('TREE_SELECTORS: #claim_tree 起点が最優先で汎用クラス単独は最後', () => {
  assert.deepEqual(collectorApp.TREE_SELECTORS, [
    '#claim_tree .div_tree',
    '#claim_dialog .div_tree',
    '.div_tree',
  ]);
  assert.deepEqual(collectorApp.CITE_SELECTORS, ['#claim_cite', '#claim_dialog #claim_cite']);
});

// ---------------------------------------------------------------------------
// extractStructureText: 引用一覧を最優先で収集する（引用パターン上限到達対策の要）
// ---------------------------------------------------------------------------

const el = (html) => ({ innerHTML: html });
const docStub = (map, single) => ({
  querySelectorAll: (sel) => map[sel] || [],
  querySelector: (sel) => (single && single[sel]) || (map[sel] && map[sel][0]) || null,
});

test('extractStructureText: 引用一覧があれば木構造より優先する', () => {
  const r = collectorApp.extractStructureText(docStub({
    '#claim_cite': [el('[1]請求項1 独立請求項<br>')],
    '#claim_tree .div_tree': [el('1 ━ 2 <br>')],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.format, 'cite');
  assert.equal(r.selector, '#claim_cite');
  assert.equal(r.text, '[1]請求項1 独立請求項\n');
});

test('extractStructureText: 引用一覧が空なら木構造へフォールバックする', () => {
  const r = collectorApp.extractStructureText(docStub({
    '#claim_cite': [el('  <br> ')],
    '#claim_tree .div_tree': [el('1 ━ 2 <br>')],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.format, 'tree');
  assert.equal(r.selector, '#claim_tree .div_tree');
  assert.equal(r.truncatedTree, false);
});

test('extractStructureText: 木構造フォールバック時に上限到達を検出して伝える', () => {
  const overflowEl = el('★全請求項間引用パターン全展開上限数(5000)到達のため、…★<br>');
  overflowEl.className = ''; // ページ側は到達時に hidden クラスを外す
  const r = collectorApp.extractStructureText(docStub(
    { '#claim_tree .div_tree': [el('1 ━ 2 <br>')] },
    { '#claim_warn_overflow': overflowEl }
  ));
  assert.equal(r.ok, true);
  assert.equal(r.format, 'tree');
  assert.equal(r.truncatedTree, true, '上限到達を検出できていない（黙って欠落する）');
});

test('pageHasOverflowWarning: hidden クラス付き・空要素は到達扱いにしない', () => {
  const hiddenEl = el('★…上限数(5000)到達…★');
  hiddenEl.className = 'hidden';
  assert.equal(
    collectorApp.pageHasOverflowWarning(docStub({}, { '#claim_warn_overflow': hiddenEl })),
    false
  );
  const emptyEl = el('');
  emptyEl.className = '';
  assert.equal(
    collectorApp.pageHasOverflowWarning(docStub({}, { '#claim_warn_overflow': emptyEl })),
    false
  );
  assert.equal(collectorApp.pageHasOverflowWarning(docStub({})), false);
});

test('extractStructureText: 全滅時は引用一覧の手貼りも案内する', () => {
  const r = collectorApp.extractStructureText(docStub({}));
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('引用一覧'));
  assert.ok(r.error.includes('手動で貼り付け'));
});

test('実ページ: 上限到達スナップショットから引用一覧が選ばれ92項すべて解析できる', () => {
  const file = path.join(
    ROOT, '..', 'fixtures', 'claim-checker', 'new',
    '書類比較・クレームチェッカー_引用パターン上限到達.html'
  );
  const html = fs.readFileSync(file, 'utf8');
  const citeM = /<div[^>]*id="claim_cite"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  assert.ok(citeM, '#claim_cite が見つからない');
  const text = collectorApp.treeHtmlToText(citeM[1]);

  const parsed = structure.parseClaimStructure(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.format, 'cite');
  assert.equal(parsed.graph.nodes.length, 92);
  assert.deepEqual(parsed.graph.roots, [1, 22, 42, 43, 46, 68, 89, 90]);
  assert.equal(parsed.meta.overflow, true);
});
