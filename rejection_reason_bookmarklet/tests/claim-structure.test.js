'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const claimStructure = require('../src/core/claim-structure');

const CLAIM_HTML = path.join(__dirname, '..', '..', 'fixtures', 'claim-checker', 'new',
  '書類比較・クレームチェッカー_特願2024-203064.html');

// node には DOM が無いため、fixture の <div id="…"> の innerHTML だけを素朴に切り出す。
// テスト専用のヘルパーであり src には置かない（本番は要素から innerHTML を取る）。
function innerHtmlById(html, id) {
  const i = html.indexOf('id="' + id + '"');
  if (i === -1) return null;
  const gt = html.indexOf('>', i);
  return html.slice(gt + 1, html.indexOf('</div>', gt));
}

// 手作りの請求項リスト（build の入力）を短く書くための補助
const claim = (claimNumber, text) => ({ claimNumber, text });
const byNumber = (structure) => new Map(structure.claims.map((c) => [c.claimNumber, c]));

// #claim_tree の中の .div_tree だけを切り出す（id ではなく class で入る子要素）
function treeInnerHtml(html) {
  const i = html.indexOf('id="claim_tree"');
  if (i === -1) return null;
  const j = html.indexOf('class="div_tree', i);
  if (j === -1) return null;
  const gt = html.indexOf('>', j);
  return html.slice(gt + 1, html.indexOf('</div>', gt));
}

// fixture の HTML から3つのデータ源を作る。
//   #claim_tree … 引用関係（一次情報） ／ #claim_cite … 合計請求項数 ／ #claim_mark … 全文
// 破壊的な検証（構造の改竄）があるため毎回作り直す。
function loadFixture() {
  const html = fs.readFileSync(CLAIM_HTML, 'utf8');
  const claimTexts = claimStructure.parseClaimTexts(
    claimStructure.claimHtmlToText(innerHtmlById(html, 'claim_mark')));
  const tree = claimStructure.parseClaimTree(
    claimStructure.claimHtmlToText(treeInnerHtml(html)));
  const cite = claimStructure.parseClaimCiteText(
    claimStructure.claimHtmlToText(innerHtmlById(html, 'claim_cite')));
  return {
    html,
    claimTexts,
    tree,
    cite,
    // 本番（page-claims）と同じ組み立て: 構造はツリー、総数と独立請求項は cite
    structure: claimStructure.build(claimTexts, {
      source: 'claim_tree',
      dependencies: tree.ok ? tree.dependencies : null,
      totalClaimCount: cite === null ? undefined : cite.totalClaimCount,
      independentClaims: cite === null ? undefined : cite.independentClaims,
    }),
    // 本文の引用表現だけから組み立てた構造（ツリーが無い場合のフォールバック経路）
    structureFromText: claimStructure.build(claimTexts, { source: 'claim_mark' }),
  };
}

// ---- claimHtmlToText ------------------------------------------------------

test('claimHtmlToText: <br> は改行になり、その他のタグは剥がされる', () => {
  assert.equal(claimStructure.claimHtmlToText('A<br>B<br/>C<BR />D'), 'A\nB\nC\nD');
  assert.equal(claimStructure.claimHtmlToText('<b>太字</b>と<span class="zenki_wd18">通常</span>'), '太字と通常');
  assert.equal(claimStructure.claimHtmlToText(null), '');
  assert.equal(claimStructure.claimHtmlToText(undefined), '');
});

test('claimHtmlToText: ツールが挿入した通番マーカーは span ごと消える', () => {
  const withOnclick = '前<span id="SN1-7" class="showCiteCitedNum" ' +
    'onclick="jumpToBlink(&#39;R-SN1-7&#39;,&#39;blue&#39;)">[1-7]</span>後';
  assert.equal(claimStructure.claimHtmlToText(withOnclick), '前後');
  assert.equal(
    claimStructure.claimHtmlToText('前<span id="SN1-1" class="showCiteCitedNoUL">[1-1]</span>後'),
    '前後');
  // マーカーではない span の中身は残す（[…] の形でも class が違えば本文）
  assert.equal(claimStructure.claimHtmlToText('前<span class="innyou_wd">[注]</span>後'), '前[注]後');
});

test('claimHtmlToText: 実体参照を復元する（&amp; は必ず最後）', () => {
  assert.equal(
    claimStructure.claimHtmlToText('A&amp;B &lt;tag&gt; &quot;q&quot; &#39;s&#39;&nbsp;end'),
    'A&B <tag> "q" \'s\' end');
  // 順序が正しければ &amp;lt; は &lt; という文字列に戻る（< にはならない）
  assert.equal(claimStructure.claimHtmlToText('&amp;lt;'), '&lt;');
  assert.equal(claimStructure.claimHtmlToText('&amp;amp;'), '&amp;');
});

// ---- parseClaimTexts ------------------------------------------------------

test('parseClaimTexts: 4 種の括弧つき見出しと「請求項N」だけの行に対応する', () => {
  const items = claimStructure.parseClaimTexts([
    '【請求項 1】', '本文1。',
    '【請求項2】', '本文2。',
    '［請求項3］', '本文3。',
    '[請求項4]', '本文4。',
    '請求項5', '本文5。',
  ].join('\n'));
  assert.deepEqual(items.map((c) => c.claimNumber), [1, 2, 3, 4, 5]);
  assert.deepEqual(items.map((c) => c.text), ['本文1。', '本文2。', '本文3。', '本文4。', '本文5。']);
  assert.deepEqual(items.map((c) => c.headingRaw),
    ['【請求項 1】', '【請求項2】', '［請求項3］', '[請求項4]', '請求項5']);
});

test('parseClaimTexts: 本文は前後の空白を落とし、次の見出しを含まない', () => {
  const items = claimStructure.parseClaimTexts(
    '【請求項 1】\n　　装置。　\n\n【請求項 2】\n　請求項1に記載の装置。\n');
  assert.equal(items.length, 2);
  assert.equal(items[0].text, '装置。');
  assert.equal(items[0].text.indexOf('請求項 2'), -1);
  assert.equal(items[1].text, '請求項1に記載の装置。');
});

test('parseClaimTexts: 全角数字の見出しも番号として取れる', () => {
  const items = claimStructure.parseClaimTexts('【請求項　１０】\n本文。');
  assert.deepEqual(items.map((c) => c.claimNumber), [10]);
  assert.equal(items[0].text, '本文。');
});

test('parseClaimTexts: 見出しが無ければ空配列', () => {
  assert.deepEqual(claimStructure.parseClaimTexts('見出しの無いテキスト。'), []);
  assert.deepEqual(claimStructure.parseClaimTexts(''), []);
});

// ---- parseDependencyExpression -------------------------------------------

test('引用表現: 「請求項1に記載の」→ 単一引用', () => {
  const d = claimStructure.parseDependencyExpression('請求項1に記載の情報処理装置。');
  assert.deepEqual(d.claims, [1]);
  assert.equal(d.type, 'single');
  assert.equal(d.expression, '請求項1に記載');
});

test('引用表現: 「請求項1又は2に記載の」→ 選択的引用', () => {
  const d = claimStructure.parseDependencyExpression('請求項1又は2に記載の装置。');
  assert.deepEqual(d.claims, [1, 2]);
  assert.equal(d.type, 'selective');
});

test('引用表現: 「請求項1から3のいずれか一項に記載の」→ 1,2,3 の選択的引用', () => {
  const d = claimStructure.parseDependencyExpression('請求項1から3のいずれか一項に記載の装置。');
  assert.deepEqual(d.claims, [1, 2, 3]);
  assert.equal(d.type, 'selective');
});

test('引用表現: 「請求項1ないし4のいずれか一項に記載の」→ 1-4 の選択的引用', () => {
  const d = claimStructure.parseDependencyExpression('請求項1ないし4のいずれか一項に記載の装置。');
  assert.deepEqual(d.claims, [1, 2, 3, 4]);
  assert.equal(d.type, 'selective');
});

test('引用表現: 「請求項1、2又は4に記載の」→ 列挙の選択的引用', () => {
  const d = claimStructure.parseDependencyExpression('請求項1、2又は4に記載の装置。');
  assert.deepEqual(d.claims, [1, 2, 4]);
  assert.equal(d.type, 'selective');
});

test('引用表現: 「請求項1から3のいずれかに記載の」（一項なし）も範囲展開する', () => {
  const d = claimStructure.parseDependencyExpression('請求項1から3のいずれかに記載の装置。');
  assert.deepEqual(d.claims, [1, 2, 3]);
  assert.equal(d.type, 'selective');
});

test('引用表現: 全角数字（請求項１又は２／請求項１０）', () => {
  const d1 = claimStructure.parseDependencyExpression('請求項１又は２に記載の装置。');
  assert.deepEqual(d1.claims, [1, 2]);
  assert.equal(d1.type, 'selective');
  // expression は原文の表記のまま返す（照合用に潰した形ではない）
  assert.equal(d1.expression, '請求項１又は２に記載');
  const d2 = claimStructure.parseDependencyExpression('請求項１０に記載の装置。');
  assert.deepEqual(d2.claims, [10]);
  assert.equal(d2.type, 'single');
});

test('引用表現: 「請求項2及び3に記載の」→ 累積的引用（cumulative）', () => {
  const d = claimStructure.parseDependencyExpression('請求項2及び3に記載の装置。');
  assert.deepEqual(d.claims, [2, 3]);
  assert.equal(d.type, 'cumulative');
});

test('引用表現: 「…に記載の情報処理装置において、」形式も引用として拾う', () => {
  const d = claimStructure.parseDependencyExpression('請求項1に記載の情報処理装置において、さらに制御する装置。');
  assert.deepEqual(d.claims, [1]);
  assert.equal(d.type, 'single');
});

test('引用表現: 引用表現の無い本文は null（＝独立請求項）', () => {
  assert.equal(claimStructure.parseDependencyExpression('通信装置と通信するためのプログラム。'), null);
  assert.equal(claimStructure.parseDependencyExpression(''), null);
  assert.equal(claimStructure.parseDependencyExpression(null), null);
  // 「請求項」の語があっても引用節の形でなければ引用ではない
  assert.equal(claimStructure.parseDependencyExpression('請求項という語を含むが引用節ではない本文。'), null);
});

test('引用表現: 本文中に引用表現が2回現れる場合は末尾側を採用する', () => {
  const d = claimStructure.parseDependencyExpression(
    '請求項1に記載の装置を用いて処理する方法であって、請求項3に記載の方法。');
  assert.deepEqual(d.claims, [3]);
  assert.equal(d.expression, '請求項3に記載');
});

test('parseDependencyClaimList: 番号列の展開と破綻時の null', () => {
  assert.deepEqual(claimStructure.parseDependencyClaimList('1から3').claims, [1, 2, 3]);
  assert.equal(claimStructure.parseDependencyClaimList('1又は2').sawSelective, true);
  assert.equal(claimStructure.parseDependencyClaimList('2及び3').sawCumulative, true);
  assert.equal(claimStructure.parseDependencyClaimList('5から3'), null);   // 逆順の範囲
  assert.equal(claimStructure.parseDependencyClaimList('から3'), null);    // 起点なし
  assert.equal(claimStructure.parseDependencyClaimList(''), null);
});

// ---- build（手作りの請求項リスト） ----------------------------------------

test('build: 直列の引用（1←2←3←4）で推移閉包が求まる', () => {
  const st = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '請求項2に記載の装置。'),
    claim(4, '請求項3に記載の装置。'),
  ]);
  const by = byNumber(st);
  assert.deepEqual(by.get(4).allAncestors, [1, 2, 3]);
  assert.deepEqual(by.get(4).directParents, [3]);
  assert.deepEqual(by.get(1).allDescendants, [2, 3, 4]);
  assert.deepEqual(by.get(1).directChildren, [2]);
  assert.deepEqual(st.independentClaims, [1]);
  assert.equal(st.totalClaimCount, 4);
  assert.deepEqual(st.warnings, []);
});

test('build: 多項従属（請求項5が1又は2を引用）は双方の下位になる', () => {
  const st = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '請求項1に記載の装置。'),
    claim(4, '請求項1に記載の装置。'),
    claim(5, '請求項1又は2に記載の装置。'),
  ]);
  const by = byNumber(st);
  assert.deepEqual(by.get(5).directParents, [1, 2]);
  assert.equal(by.get(5).dependencyType, 'selective');
  assert.ok(by.get(1).directChildren.indexOf(5) !== -1);
  assert.ok(by.get(2).directChildren.indexOf(5) !== -1);
  assert.deepEqual(by.get(5).allAncestors, [1, 2]);
});

test('build 警告: 欠番（CLAIM_NUMBER_GAP）', () => {
  const st = claimStructure.build([claim(1, '装置。'), claim(3, '請求項1に記載の装置。')]);
  const gap = st.warnings.find((w) => w.code === 'CLAIM_NUMBER_GAP');
  assert.ok(gap, '欠番の警告が出ていない');
  assert.ok(gap.message.indexOf('2') !== -1);
});

test('build 警告: 番号の重複（CLAIM_NUMBER_DUPLICATE・後の記載は無視）', () => {
  const st = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(2, '請求項1に記載の別の装置。'),
  ]);
  const dup = st.warnings.find((w) => w.code === 'CLAIM_NUMBER_DUPLICATE');
  assert.ok(dup);
  assert.equal(dup.severity, 'error');
  assert.equal(st.claims.length, 2);
  assert.equal(byNumber(st).get(2).text, '請求項1に記載の装置。');
});

test('build 警告: 自己引用（CLAIM_SELF_REFERENCE）は無効化され独立扱いになる', () => {
  const st = claimStructure.build([claim(1, '装置。'), claim(2, '請求項2に記載の装置。')]);
  const c2 = byNumber(st).get(2);
  assert.equal(c2.warnings.length, 1);
  assert.equal(c2.warnings[0].code, 'CLAIM_SELF_REFERENCE');
  assert.equal(c2.warnings[0].severity, 'error');
  assert.deepEqual(c2.directParents, []);
  assert.equal(c2.type, 'independent');
});

test('build 警告: 存在しない引用先（CLAIM_PARENT_NOT_FOUND）', () => {
  const st = claimStructure.build([claim(1, '装置。'), claim(2, '請求項9に記載の装置。')]);
  const c2 = byNumber(st).get(2);
  assert.equal(c2.warnings[0].code, 'CLAIM_PARENT_NOT_FOUND');
  assert.equal(c2.warnings[0].severity, 'error');
  assert.ok(c2.warnings[0].message.indexOf('請求項9') !== -1);
  // 引用先が全て無効なら独立請求項として扱う
  assert.equal(c2.type, 'independent');
  assert.deepEqual(st.independentClaims, [1, 2]);
});

test('build 警告: 後方引用（CLAIM_FORWARD_REFERENCE）は警告のうえ関係は保持する', () => {
  const st = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項5に記載の装置。'),
    claim(3, '装置。'),
    claim(4, '装置。'),
    claim(5, '請求項1に記載の装置。'),
  ]);
  const c2 = byNumber(st).get(2);
  assert.equal(c2.warnings[0].code, 'CLAIM_FORWARD_REFERENCE');
  assert.equal(c2.warnings[0].severity, 'warn');
  assert.equal(c2.type, 'dependent');
  assert.deepEqual(c2.directParents, [5]);
  assert.deepEqual(c2.allAncestors, [1, 5]);
});

test('build 警告: 循環参照（CLAIM_CIRCULAR_REFERENCE）でも停止し、両者に警告が付く', () => {
  const st = claimStructure.build(
    [claim(1, '装置。'), claim(2, '本文2。'), claim(3, '本文3。')],
    { dependencies: new Map([[2, [3]], [3, [2]]]) }
  );
  const by = byNumber(st);
  const codes = (n) => by.get(n).warnings.map((w) => w.code);
  assert.ok(codes(2).indexOf('CLAIM_CIRCULAR_REFERENCE') !== -1);
  assert.ok(codes(3).indexOf('CLAIM_CIRCULAR_REFERENCE') !== -1);
  assert.equal(by.get(2).warnings.find((w) => w.code === 'CLAIM_CIRCULAR_REFERENCE').severity, 'error');
  // 到達可能集合は自分自身を含む形で停止している（無限ループしない）
  assert.deepEqual(by.get(2).allAncestors, [2, 3]);
  assert.deepEqual(by.get(2).allDescendants, [2, 3]);
  assert.deepEqual(st.findPath(2, 3), [2, 3]);
});

test('build: options.dependencies（罫線ツリー由来）は本文の引用表現より優先される', () => {
  const list = [claim(1, '装置。'), claim(2, '請求項1に記載の装置。'), claim(3, '装置。')];
  const st = claimStructure.build(list, { dependencies: new Map([[1, []], [2, [3]], [3, []]]) });
  const c2 = byNumber(st).get(2);
  assert.deepEqual(c2.directParents, [3], '引用関係はツリーを採用する');
  assert.equal(c2.parentsSource, 'claim_tree');
  // 引用表現の文字列と引用種別は本文から取り続ける（選択的／累積的の判定に必要）
  assert.equal(c2.dependencyExpression, '請求項1に記載');
  assert.equal(c2.dependencyType, 'single');
  // ツリーと本文が食い違うので、上書きせずに警告する
  assert.ok(c2.warnings.some((w) => w.code === 'TREE_TEXT_DEPENDENCY_MISMATCH'),
    JSON.stringify(c2.warnings));
  // 空配列を与えれば独立請求項になる
  const st2 = claimStructure.build(list, { dependencies: new Map([[1, []], [2, []], [3, []]]) });
  assert.equal(byNumber(st2).get(2).type, 'independent');
  assert.deepEqual(byNumber(st2).get(2).directParents, []);
});

test('build: ツリーに現れない請求項は本文の引用表現から推定し警告する', () => {
  const list = [claim(1, '装置。'), claim(2, '請求項1に記載の装置。'), claim(3, '請求項2に記載の装置。')];
  // 請求項3 がツリーに無い状態
  const st = claimStructure.build(list, { dependencies: new Map([[1, []], [2, [1]]]) });
  const c3 = byNumber(st).get(3);
  assert.deepEqual(c3.directParents, [2]);
  assert.equal(c3.parentsSource, 'text-fallback');
  assert.ok(c3.warnings.some((w) => w.code === 'CLAIM_NOT_IN_TREE'));
  // ツリーどおりの請求項2 には警告を出さない
  assert.deepEqual(byNumber(st).get(2).warnings, []);
});

test('build: 合計請求項数と独立請求項は #claim_cite 由来の値を優先する', () => {
  const list = [claim(1, '装置。'), claim(2, '請求項1に記載の装置。')];
  const deps = new Map([[1, []], [2, [1]]]);
  const st = claimStructure.build(list, { dependencies: deps, totalClaimCount: 5, independentClaims: [1] });
  assert.equal(st.totalClaimCount, 5);
  assert.equal(st.totalClaimCountSource, 'claim_cite');
  // 抽出できた最大番号（2）と食い違うので警告する
  assert.ok(st.warnings.some((w) => w.code === 'CLAIM_TOTAL_MISMATCH'), JSON.stringify(st.warnings));
  // 指定が無ければ最大番号を使う
  const st2 = claimStructure.build(list, { dependencies: deps });
  assert.equal(st2.totalClaimCount, 2);
  assert.equal(st2.totalClaimCountSource, 'max-claim-number');
  // 独立請求項が一覧と食い違えば警告する
  const st3 = claimStructure.build(list, { dependencies: deps, independentClaims: [1, 2] });
  assert.ok(st3.warnings.some((w) => w.code === 'INDEPENDENT_CLAIMS_MISMATCH'));
});

test('build: source ラベルと空入力の扱い', () => {
  const st = claimStructure.build([], { source: 'pasted', sourceLabel: '貼り付け' });
  assert.equal(st.source, 'pasted');
  assert.equal(st.sourceLabel, '貼り付け');
  assert.equal(st.totalClaimCount, 0);
  assert.deepEqual(st.claimNumbers, []);
  assert.deepEqual(st.warnings, []);   // 空入力では独立請求項なしの警告も出さない
  assert.equal(claimStructure.build(null).source, 'unknown');
});

test('build: 独立請求項が1つも無ければ NO_INDEPENDENT_CLAIM', () => {
  const st = claimStructure.build(
    [claim(1, '本文1。'), claim(2, '本文2。')],
    { dependencies: new Map([[1, [2]], [2, [1]]]) }
  );
  assert.ok(st.warnings.some((w) => w.code === 'NO_INDEPENDENT_CLAIM' && w.severity === 'error'));
});

// ---- parseClaimCiteText（実 fixture） -------------------------------------

test('parseClaimCiteText: fixture のページ側一覧を読む（総数26・独立1,25,26）', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const { cite } = loadFixture();
  assert.equal(cite.totalClaimCount, 26);
  assert.deepEqual(cite.independentClaims, [1, 25, 26]);
  assert.equal(cite.entries.length, 26);
  assert.deepEqual(cite.entries.map((e) => e.claimNumber),
    Array.from({ length: 26 }, (_, i) => i + 1));
});

test('parseClaimCiteText: 請求項2の項目（全下位・間接被引用から直接下位を導く）', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const e2 = loadFixture().cite.entries.find((e) => e.claimNumber === 2);
  assert.equal(e2.type, 'dependent');
  assert.deepEqual(e2.directParents, [1]);
  assert.deepEqual(e2.allDescendants, [3, 4, 5, 6, 7]);
  assert.deepEqual(e2.indirectDescendants, [5]);
  assert.deepEqual(e2.directChildren, [3, 4, 6, 7]);   // 全下位 − 間接被引用
  assert.equal(e2.patternCount, 1);
});

test('parseClaimCiteText: 請求項5の項目（間接引用から全引用元を導く）', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const e5 = loadFixture().cite.entries.find((e) => e.claimNumber === 5);
  assert.deepEqual(e5.directParents, [4]);
  assert.deepEqual(e5.indirectAncestors, [1, 2]);
  assert.deepEqual(e5.allAncestors, [1, 2, 4]);
  assert.deepEqual(e5.allDescendants, []);
});

test('parseClaimCiteText 回帰: 「被引用請求項」を「引用請求項」と読み違えない', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const e1 = loadFixture().cite.entries.find((e) => e.claimNumber === 1);
  // 請求項1のブロックには「被引用請求項: 2,3,…」があるが、引用元は空でなければならない
  assert.equal(e1.type, 'independent');
  assert.deepEqual(e1.directParents, []);
  assert.deepEqual(e1.allAncestors, []);
  assert.deepEqual(e1.indirectAncestors, []);
  assert.equal(e1.allDescendants.length, 23);
  assert.deepEqual(e1.directChildren,
    [2, 8, 9, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21, 22, 23, 24]);
});

test('parseClaimCiteText: 単体の合成テキストでも「被引用」を分離する', () => {
  const cite = claimStructure.parseClaimCiteText([
    '合計請求項数: 3  (独立請求項: 1)',
    '[1]請求項1 『・・装置』 独立請求項',
    '　被引用請求項: 2,3(うち間接被引用: 3)',
    '[2]請求項2 『・・装置』 従属請求項',
    '　引用請求項: 1　引用パターンの数: 1',
    '　被引用請求項: 3',
    '[3]請求項3 『・・装置』 従属請求項',
    '　引用請求項: 2 (間接引用: 1)　引用パターンの数: 1',
  ].join('\n'));
  assert.equal(cite.totalClaimCount, 3);
  assert.deepEqual(cite.independentClaims, [1]);
  assert.deepEqual(cite.entries[0].directParents, []);
  assert.deepEqual(cite.entries[0].directChildren, [2]);
  assert.deepEqual(cite.entries[2].allAncestors, [1, 2]);
});

test('parseClaimCiteText: 空文字・非該当テキストは null', () => {
  assert.equal(claimStructure.parseClaimCiteText(''), null);
  assert.equal(claimStructure.parseClaimCiteText('　 \n '), null);
  assert.equal(claimStructure.parseClaimCiteText('関係のない文章です。'), null);
});

// ---- crossCheckWithCite ---------------------------------------------------

test('crossCheckWithCite: fixture では自前解析とページ側一覧が完全一致する', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const { structure, cite } = loadFixture();
  assert.deepEqual(claimStructure.crossCheckWithCite(structure, cite), []);
});

test('crossCheckWithCite: 構造を1箇所壊すと CLAIM_DEPENDENCY_MISMATCH が出る', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const { structure, cite } = loadFixture();
  structure.claims.find((c) => c.claimNumber === 2).directParents = [3];
  const results = claimStructure.crossCheckWithCite(structure, cite);
  assert.equal(results.length, 1);
  assert.equal(results[0].code, 'CLAIM_DEPENDENCY_MISMATCH');
  assert.ok(results[0].message.indexOf('請求項2') !== -1);
  assert.ok(results[0].message.indexOf('直接引用元') !== -1);
});

test('crossCheckWithCite: 総数の不一致と片側 null の扱い', () => {
  const st = claimStructure.build([claim(1, '装置。'), claim(2, '請求項1に記載の装置。')]);
  const cite = claimStructure.parseClaimCiteText([
    '合計請求項数: 3  (独立請求項: 1)',
    '[1]請求項1 『・・装置』 独立請求項',
    '　被引用請求項: 2',
    '[2]請求項2 『・・装置』 従属請求項',
    '　引用請求項: 1　引用パターンの数: 1',
    '[3]請求項3 『・・装置』 独立請求項',
  ].join('\n'));
  const results = claimStructure.crossCheckWithCite(st, cite);
  assert.ok(results.some((r) => r.code === 'CLAIM_TOTAL_MISMATCH'));
  assert.ok(results.some((r) => r.code === 'CLAIM_CITE_UNKNOWN_CLAIM' && r.message.indexOf('請求項3') !== -1));
  assert.deepEqual(claimStructure.crossCheckWithCite(null, cite), []);
  assert.deepEqual(claimStructure.crossCheckWithCite(st, null), []);
});

// ---- 実 fixture の統合検証 ------------------------------------------------

test('実 fixture: 3つのデータ源から 26 項（1-26・欠番なし）の構造を組み立てる', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const { claimTexts, structure } = loadFixture();
  assert.equal(claimTexts.length, 26, '#claim_mark から26項の全文');
  assert.deepEqual(structure.claimNumbers, Array.from({ length: 26 }, (_, i) => i + 1));
  assert.equal(structure.totalClaimCount, 26);
  assert.equal(structure.totalClaimCountSource, 'claim_cite', '総数は #claim_cite 由来');
  assert.deepEqual(structure.independentClaims, [1, 25, 26]);
  assert.equal(structure.source, 'claim_tree', '引用関係は罫線ツリー由来');
  assert.deepEqual(structure.warnings, []);
  for (const c of structure.claims) {
    assert.deepEqual(c.warnings, [], '請求項' + c.claimNumber + 'に警告');
    assert.equal(c.parentsSource, 'claim_tree', '請求項' + c.claimNumber + 'の引用元の由来');
    assert.notEqual(c.text, '', '請求項' + c.claimNumber + 'の全文');
  }
});

// ---- 罫線ツリー（claim_relation_writer の解析器を流用） --------------------

test('parseClaimTree: 解析器が利用できる', () => {
  assert.equal(claimStructure.hasTreeParser(), true,
    'claim_relation_writer/src/core/parser.js を読み込めていない（モノレポのチェックアウトが必要）');
});

test('parseClaimTree: 実 fixture の #claim_tree から 26 節点・独立請求項 1,25,26 を得る', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const { tree } = loadFixture();
  assert.equal(tree.ok, true, tree.ok ? '' : tree.error);
  assert.deepEqual(tree.nodes, Array.from({ length: 26 }, (_, i) => i + 1));
  assert.deepEqual(tree.roots, [1, 25, 26]);
  // 引用関係（to が from を引用する）
  const expected = {
    1: [], 2: [1], 3: [2], 4: [2], 5: [4], 6: [2], 7: [2], 8: [1], 9: [1], 10: [1],
    11: [1], 12: [1], 13: [1], 14: [13], 15: [1], 16: [1], 17: [1], 18: [17],
    19: [1], 20: [1], 21: [1], 22: [1], 23: [1], 24: [1], 25: [], 26: [],
  };
  for (const n of tree.nodes) {
    assert.deepEqual(tree.dependencies.get(n), expected[n], '請求項' + n + 'の引用元');
  }
});

test('parseClaimTree: 罫線ツリー由来と本文の引用表現由来の引用関係が一致する', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const { structure, structureFromText } = loadFixture();
  const a = byNumber(structure);
  const b = byNumber(structureFromText);
  for (const n of structure.claimNumbers) {
    assert.deepEqual(a.get(n).directParents, b.get(n).directParents,
      '請求項' + n + ': ツリー=' + a.get(n).directParents + ' / 本文=' + b.get(n).directParents);
  }
});

test('parseClaimTree: 空・不正なツリーはエラーを返す（誤った関係を作らない）', () => {
  assert.equal(claimStructure.parseClaimTree('').ok, false);
  assert.equal(claimStructure.parseClaimTree('   \n  ').ok, false);
  // ┃ の数が合わない（分岐の閉じ忘れ）入力は救済せずエラーにする
  const bad = claimStructure.parseClaimTree(' 1 ┳ 2\n ┃ ┃ ┣ 3\n');
  assert.equal(bad.ok, false);
  assert.ok(bad.error.indexOf('罫線ツリー') !== -1, bad.error);
});

test('parseClaimTree: 多項従属（1つの請求項が複数を引用）を扱える', () => {
  //  1 ┳ 2 ━ 4
  //    ┗ 3 ━ 4   … 請求項4 が 2 と 3 の両方を引用する
  const r = claimStructure.parseClaimTree(' 1 ┳ 2 ━ 4\n   ┗ 3 ━ 4\n');
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  assert.deepEqual(r.dependencies.get(4), [2, 3]);
  assert.deepEqual(r.roots, [1]);
});

test('実 fixture: 請求項1（独立）の直接下位と全下位', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const c1 = byNumber(loadFixture().structure).get(1);
  assert.equal(c1.type, 'independent');
  assert.deepEqual(c1.directParents, []);
  assert.equal(c1.dependencyExpression, null);
  assert.deepEqual(c1.directChildren,
    [2, 8, 9, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21, 22, 23, 24]);
  assert.deepEqual(c1.allDescendants, Array.from({ length: 23 }, (_, i) => i + 2));   // 2-24
});

test('実 fixture: 請求項2の系列（2←3,4,6,7／4←5）', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const by = byNumber(loadFixture().structure);
  assert.deepEqual(by.get(2).directParents, [1]);
  assert.deepEqual(by.get(2).directChildren, [3, 4, 6, 7]);
  assert.deepEqual(by.get(2).allDescendants, [3, 4, 5, 6, 7]);
  for (const n of [3, 4, 6, 7]) assert.deepEqual(by.get(n).directParents, [2], '請求項' + n);
  assert.deepEqual(by.get(5).directParents, [4]);
  assert.deepEqual(by.get(5).allAncestors, [1, 2, 4]);
  assert.equal(by.get(5).dependencyExpression, '請求項4に記載');
  assert.equal(by.get(5).dependencyType, 'single');
});

test('実 fixture: 請求項13-14・19-20・25-26', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const by = byNumber(loadFixture().structure);
  assert.deepEqual(by.get(13).directParents, [1]);
  assert.deepEqual(by.get(13).directChildren, [14]);
  assert.deepEqual(by.get(13).allDescendants, [14]);
  assert.deepEqual(by.get(14).directParents, [13]);
  assert.deepEqual(by.get(14).allAncestors, [1, 13]);
  for (const n of [19, 20]) {
    assert.deepEqual(by.get(n).directParents, [1], '請求項' + n);
    assert.deepEqual(by.get(n).directChildren, [], '請求項' + n);
    assert.deepEqual(by.get(n).allDescendants, [], '請求項' + n);
  }
  for (const n of [25, 26]) {
    assert.equal(by.get(n).type, 'independent', '請求項' + n);
    assert.deepEqual(by.get(n).directParents, [], '請求項' + n);
    assert.deepEqual(by.get(n).allAncestors, [], '請求項' + n);
  }
  // 8-13,15-17,19-24 は請求項1の直接下位
  for (const n of [8, 9, 10, 11, 12, 15, 16, 17, 21, 22, 23, 24]) {
    assert.deepEqual(by.get(n).directParents, [1], '請求項' + n);
  }
  assert.deepEqual(by.get(18).directParents, [17]);
});

test('実 fixture: findPath は引用経路を返し、無関係な組では null', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const st = loadFixture().structure;
  assert.deepEqual(st.findPath(2, 5), [2, 4, 5]);
  assert.deepEqual(st.findPath(2, 6), [2, 6]);
  assert.equal(st.findPath(19, 20), null);
  assert.deepEqual(st.findPath(1, 18), [1, 17, 18]);
  assert.deepEqual(st.findPath(3, 3), [3]);
  assert.equal(st.findPath(5, 2), null);   // 逆向きの経路は無い
});
