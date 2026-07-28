/*
 * page-claims.js — 対象ページから特許請求の範囲を取得する（DOM に触る唯一のクレーム系モジュール）
 *
 * 「書類比較・クレームチェッカー」ページで「クレーム解析」を実行すると次の要素が埋まる。
 * それぞれ役割を分けて読み取り、純粋モジュール（RRB.claimStructure）へ渡す。
 *   #claim_tree .div_tree … 罫線ツリー   → **引用関係**（claim_relation_writer の解析器を流用）
 *   #claim_cite           … 引用関係一覧 → **合計請求項数**と独立請求項
 *   #claim_mark           … 請求項全文   → 全文表示・引用表現（引用種別の判定）
 * どれも「クレーム解析」未実行だと空なので、その場合はユーザーに貼り付けを促す。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('../../core/claim-structure'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.pageClaims = factory(root.RRB.claimStructure);
  }
})(globalThis, function (claimStructure) {
  'use strict';

  // 罫線ツリー（#claim_tree は常駐の hidden、ダイアログ表示中は #claim_dialog 側にも現れる）
  const TREE_SELECTORS = ['#claim_tree .div_tree', '#claim_dialog .div_tree', '.div_tree'];
  const MARK_SELECTORS = ['#claim_mark'];
  const CITE_SELECTORS = ['#claim_cite'];

  function firstNonEmptyHtml(doc, selectors) {
    for (const selector of selectors) {
      const nodes = doc.querySelectorAll(selector);
      for (const el of nodes) {
        if (el && String(el.innerHTML).trim() !== '') return el.innerHTML;
      }
    }
    return null;
  }

  // ページから請求項構造を取得する。
  // 戻り値: { ok: true, structure, citeInfo, sources } または { ok: false, error }
  function collect(doc) {
    const d = doc || document;
    const sources = { tree: false, cite: false, mark: false };

    // ---- 合計請求項数と独立請求項（#claim_cite）----
    let cite = null;
    const citeHtml = firstNonEmptyHtml(d, CITE_SELECTORS);
    if (citeHtml !== null) {
      cite = claimStructure.parseClaimCiteText(claimStructure.claimHtmlToText(citeHtml));
      if (cite !== null) sources.cite = true;
    }

    // ---- 引用関係（#claim_tree）----
    let tree = null;
    let treeError = null;
    const treeHtml = firstNonEmptyHtml(d, TREE_SELECTORS);
    if (treeHtml !== null) {
      const parsed = claimStructure.parseClaimTree(claimStructure.claimHtmlToText(treeHtml));
      if (parsed.ok) {
        tree = parsed;
        sources.tree = true;
      } else {
        treeError = parsed.error;
      }
    }

    // ---- 請求項全文（#claim_mark）----
    let markItems = [];
    const markHtml = firstNonEmptyHtml(d, MARK_SELECTORS);
    if (markHtml !== null) {
      markItems = claimStructure.parseClaimTexts(claimStructure.claimHtmlToText(markHtml));
      if (markItems.length > 0) sources.mark = true;
    }

    if (tree === null && markItems.length === 0) {
      return {
        ok: false,
        error: 'ページから請求項を取得できませんでした。対象ページで「クレーム解析」を実行してから' +
          '「ページから請求項を取得」を押すか、下の欄に請求項全文（【請求項1】…）を貼り付けてください。' +
          (treeError === null ? '' : '（' + treeError + '）'),
      };
    }

    // 請求項の一覧は、全文（#claim_mark）とツリーの節点の和集合とする。
    // ツリーにしか現れない請求項は全文が空のまま構造に含める（関係だけは判る）。
    const byNumber = new Map();
    for (const it of markItems) byNumber.set(it.claimNumber, { claimNumber: it.claimNumber, text: it.text });
    if (tree !== null) {
      for (const n of tree.nodes) {
        if (!byNumber.has(n)) byNumber.set(n, { claimNumber: n, text: '' });
      }
    }
    const claimList = Array.from(byNumber.values()).sort((a, b) => a.claimNumber - b.claimNumber);

    const labelParts = [];
    if (sources.tree) labelParts.push('構造: 罫線ツリー（#claim_tree）');
    if (sources.cite) labelParts.push('総数: 引用関係一覧（#claim_cite）');
    if (sources.mark) labelParts.push('全文: #claim_mark');

    const structure = claimStructure.build(claimList, {
      source: sources.tree ? 'claim_tree' : 'claim_mark',
      sourceLabel: 'ページの「クレーム解析」結果（' + labelParts.join(' ／ ') + '）',
      dependencies: tree === null ? null : tree.dependencies,
      totalClaimCount: cite === null ? undefined : cite.totalClaimCount,
      independentClaims: cite === null ? undefined : cite.independentClaims,
    });

    if (treeError !== null) {
      structure.warnings.push({
        code: 'CLAIM_TREE_PARSE_ERROR',
        message: treeError + ' 引用関係は請求項本文の引用表現から推定しました。',
        severity: 'warn',
      });
    }
    // ページ側の計算結果（#claim_cite）との照合
    if (cite !== null && cite.entries.length > 0) {
      structure.crossChecks = claimStructure.crossCheckWithCite(structure, cite);
    }
    return { ok: true, structure, citeInfo: cite, sources };
  }

  // 貼り付けテキスト（【請求項1】…）から請求項構造を作る（ページから取得できない場合の経路）
  function fromText(text, source, sourceLabel) {
    const items = claimStructure.parseClaimTexts(text);
    if (items.length === 0) {
      return {
        ok: false,
        error: '請求項を検出できませんでした。「【請求項1】」のような見出しを含む形式で貼り付けてください。',
      };
    }
    const structure = claimStructure.build(items, {
      source: source || 'pasted',
      sourceLabel: sourceLabel || '貼り付けられた請求項全文（引用関係は本文の引用表現から解析）',
    });
    return { ok: true, structure, citeInfo: null, sources: { tree: false, cite: false, mark: true } };
  }

  return { collect, fromText };
});
