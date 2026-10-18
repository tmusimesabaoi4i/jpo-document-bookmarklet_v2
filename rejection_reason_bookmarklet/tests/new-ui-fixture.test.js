'use strict';
/*
 * new-ui-fixture.test.js — 新 UI（2026 年〜）の「書類比較・クレームチェッカー」スナップショット
 *
 * 旧 UI との違い:
 *   - #claim_mark の請求項境界が span#CLMNM<n> から span.claim_num#claim<n> に変わった
 *   - 表示用番号が span.showCiteCited から span.cited_word / span.jump_link.show_word に変わった
 *   - #claim_cite の「引用請求項」が直接引用元だけから **直接＋間接** の全引用元に変わり、
 *     括弧内の「うち間接引用」が間接分を示す
 *   - #claim_cite のレコードが <div> で区切られる（<br> ではない）
 * このファイルは、それらの変化で解析が壊れないことを実物 HTML で固定する。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const claimStructure = require('../src/core/claim-structure');
const pageClaims = require('../src/bookmarklet/common/page-claims');

const FIXTURE = path.join(
  __dirname, '..', '..', 'fixtures', 'claim-checker', 'new',
  '書類比較・クレームチェッカー_特願2025-557197.html'
);

// fixture 内の <div id="…"> の中身を取り出す（入れ子の div を数えて対応を取る）
function innerHtmlById(html, id) {
  const attr = html.indexOf('id="' + id + '"');
  if (attr === -1) return null;
  const open = html.lastIndexOf('<', attr);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(open));
  if (!tag) return null;
  const openEnd = html.indexOf('>', attr) + 1;
  let depth = 1;
  const re = new RegExp('<(/?)' + tag[1] + '\\b[^>]*>', 'gi');
  re.lastIndex = openEnd;
  let m;
  while ((m = re.exec(html)) !== null) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(openEnd, m.index);
  }
  return null;
}

function treeInnerHtml(html) {
  const i = html.indexOf('id="claim_tree"');
  if (i === -1) return null;
  const j = html.indexOf('class="div_tree', i);
  if (j === -1) return null;
  const gt = html.indexOf('>', j);
  return html.slice(gt + 1, html.indexOf('</div>', gt));
}

function load() {
  if (!fs.existsSync(FIXTURE)) return null;
  const html = fs.readFileSync(FIXTURE, 'utf8');
  return {
    markHtml: innerHtmlById(html, 'claim_mark'),
    citeHtml: innerHtmlById(html, 'claim_cite'),
    treeHtml: treeInnerHtml(html),
  };
}

test('新 UI: 表示用番号（[n-m]）を請求項本文から取り除く', (t) => {
  const f = load();
  if (!f) { t.skip('fixtures なし'); return; }
  const text = claimStructure.claimHtmlToText(f.markHtml);
  assert.ok(text.indexOf('[1-1]') === -1, 'cited_word の表示番号が残っている');
  assert.ok(text.indexOf('[7-11]') === -1, 'jump_link show_word の表示番号が残っている');

  const claims = claimStructure.parseClaimTexts(text);
  assert.equal(claims.length, 20);
  for (const c of claims) {
    assert.ok(!/\[\d+-\d+\]/.test(c.text), '請求項' + c.claimNumber + ' に表示番号が残っている');
  }
  // span.claim_num 見出しは本文に含めない
  assert.ok(claims[0].text.indexOf('【請求項') === -1);
  assert.match(claims[0].text, /ネットワーク選択方法/);
});

test('新 UI: 罫線ツリーから 20 請求項・独立項 1,17 を読む', (t) => {
  const f = load();
  if (!f) { t.skip('fixtures なし'); return; }
  const tree = claimStructure.parseClaimTree(claimStructure.claimHtmlToText(f.treeHtml));
  assert.equal(tree.ok, true, tree.error);
  assert.deepEqual(tree.nodes, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(tree.roots, [1, 17]);
});

test('新 UI: 引用一覧の全引用元リストから間接引用を差し引く', (t) => {
  const f = load();
  if (!f) { t.skip('fixtures なし'); return; }
  const cite = claimStructure.parseClaimCiteText(claimStructure.claimHtmlToText(f.citeHtml));
  assert.ok(cite, '引用一覧を解析できない');
  assert.equal(cite.totalClaimCount, 20);
  assert.deepEqual(cite.independentClaims, [1, 17]);
  assert.equal(cite.entries.length, 20);

  const byNumber = new Map(cite.entries.map((e) => [e.claimNumber, e]));
  // 「引用請求項： 1,2（うち間接引用: 1）」→ 直接引用元は 2 だけ
  assert.deepEqual(byNumber.get(4).directParents, [2]);
  assert.deepEqual(byNumber.get(4).indirectAncestors, [1]);
  assert.deepEqual(byNumber.get(7).directParents, [6]);
  assert.deepEqual(byNumber.get(13).directParents, [9]);
  // 間接表示の無い多項従属は全件が直接引用元
  assert.deepEqual(byNumber.get(19).directParents,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(byNumber.get(20).directParents, [17, 18]);
});

test('新 UI: page-claims が 3 つのデータ源を読み、引用一覧との照合で警告を出さない', (t) => {
  const f = load();
  if (!f) { t.skip('fixtures なし'); return; }
  const doc = {
    querySelectorAll(sel) {
      if (sel === '#claim_mark') return [{ innerHTML: f.markHtml }];
      if (sel === '#claim_cite') return [{ innerHTML: f.citeHtml }];
      if (sel === '#claim_tree .div_tree') return [{ innerHTML: f.treeHtml }];
      return [];
    },
  };
  const result = pageClaims.collect(doc);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.sources, { tree: true, cite: true, mark: true });
  assert.equal(result.structure.claims.length, 20);
  assert.equal(result.structure.totalClaimCount, 20);
  assert.deepEqual(result.structure.independentClaims, [1, 17]);
  assert.deepEqual(result.structure.crossChecks, []);
  assert.deepEqual(result.structure.warnings, []);
});
