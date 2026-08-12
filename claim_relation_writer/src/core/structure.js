/*
 * structure.js — クレーム構造テキストの書式判定とディスパッチ（DOM非依存の純粋モジュール）
 *
 * 本ツールは2種類の入力を受け付ける:
 *   1. 引用一覧（#claim_cite） … 「合計請求項数: …」「[1]請求項1 …」形式。**推奨**。
 *      ページ側が引用パターン上限に達しても全請求項が列挙されるため欠落しない。
 *   2. 罫線ツリー（#claim_tree） … 「1 ┳ 2 ┳ 3」形式。従来からの入力で、手書きにも使える。
 *      ただしページ側が上限に達すると先頭の上限数分しか描画されず**黙って欠落する**。
 *
 * UI 層（ローカル版・ブックマークレット版）はどちらの書式かを意識せず
 * parseClaimStructure() だけを呼ぶ。戻り値の format で「どちらとして読んだか」を確認できる。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./parser'), require('./cite'));
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'cite']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。script の読み込み順を確認してください。');
      }
    }
    root.CRW.structure = factory(root.CRW.parser, root.CRW.cite);
  }
})(globalThis, function (parser, cite) {
  'use strict';

  // 引用一覧に固有の見出し（罫線ツリーには決して現れない）
  const CITE_MARKERS = [/合計請求項数[ \t　]*[:：]/, /引用請求項[ \t　]*[:：]/, /\[\d+\][ \t　]*請求項[ \t　]*\d+/];
  const TREE_GLYPHS = /[┳┣┗┃━┬├└│─｜]/;

  /**
   * 入力テキストの書式を判定する。
   * @returns {'cite'|'tree'|'unknown'}
   */
  function detectFormat(text) {
    const t = String(text == null ? '' : text);
    if (t.trim() === '') return 'unknown';
    // 引用一覧の判定を先に行う。引用一覧に罫線文字が混ざることはないが、
    // 逆に手書きツリーへ注記として「引用請求項:」と書く可能性は低いため誤判定しにくい。
    for (const re of CITE_MARKERS) {
      if (re.test(t)) return 'cite';
    }
    if (TREE_GLYPHS.test(t)) return 'tree';
    return 'unknown';
  }

  /**
   * 書式を自動判定して解析する。
   * @returns {ok:true, graph, format, meta, warnings}
   *        | {ok:false, errors:[{line,message}], format}
   */
  function parseClaimStructure(text) {
    const format = detectFormat(text);
    if (format === 'cite') {
      const result = cite.parseClaimCite(text);
      return result.ok
        ? { ok: true, graph: result.graph, format: 'cite', meta: result.meta, warnings: result.warnings }
        : { ok: false, errors: result.errors, format: 'cite' };
    }
    // 'tree' と 'unknown' はどちらも罫線ツリーとして読む（unknown の場合は
    // parseClaimTree が行番号付きの具体的なエラーを返すので、そちらに委ねる）
    const result = parser.parseClaimTree(text);
    return result.ok
      ? { ok: true, graph: result.graph, format: 'tree', meta: null, warnings: [] }
      : { ok: false, errors: result.errors, format: format === 'tree' ? 'tree' : 'unknown' };
  }

  // 収集元・書式を人間向けに1語で表す（ステータス表示用）
  function formatLabel(format) {
    if (format === 'cite') return '引用一覧';
    if (format === 'tree') return '木構造';
    return '不明';
  }

  return { detectFormat, parseClaimStructure, formatLabel };
});
