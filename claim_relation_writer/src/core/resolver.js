/*
 * resolver.js — 指摘・関連請求項から影響範囲を計算する（DOM非依存の純粋モジュール）
 *
 * 文ごとに使用する請求項集合が異なるため、結果は1つの配列に統合せず、
 * issueClaims / relatedClaims / dependentClaims / allAffectedClaims / citedSeeds を
 * 意味ごとに分けて返す。
 *
 * 探索は「引用してくる方向」（from → to）への幅優先探索で、訪問済み集合により
 * 多重経路・多項従属・循環があっても重複や無限ループは起きない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.CRW = root.CRW || {};
    root.CRW.resolver = factory();
  }
})(globalThis, function () {
  'use strict';

  function uniqueSorted(arr) {
    return [...new Set(arr)].sort((a, b) => a - b);
  }

  /**
   * @param graph parser.parseClaimTree が返す { nodes, edges, roots }
   * @param issueClaims 指摘する請求項（1つ以上必須）
   * @param relatedClaims 関連する請求項（空可）
   * @returns {ok:true, issueClaims, relatedClaims, dependentClaims, allAffectedClaims, citedSeeds}
   *        | {ok:false, error:string}
   */
  function resolveAffectedClaims(graph, issueClaims, relatedClaims) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return { ok: false, error: 'クレーム構造が解析されていません' };
    }
    const issue = uniqueSorted(issueClaims || []);
    if (issue.length === 0) {
      return { ok: false, error: '指摘する請求項を1つ以上指定してください' };
    }
    const issueSet = new Set(issue);
    // 指摘と関連の両方に書かれた番号は指摘側を優先する（関連からは除去）
    const related = uniqueSorted((relatedClaims || []).filter((n) => !issueSet.has(n)));

    const nodeSet = new Set(graph.nodes);
    const unknown = uniqueSorted([...issue, ...related].filter((n) => !nodeSet.has(n)));
    if (unknown.length > 0) {
      return { ok: false, error: '請求項' + unknown.join('、') + 'は入力されたクレーム構造に存在しません' };
    }

    // from → to（引用してくる側）の隣接マップ
    const children = new Map();
    for (const [from, to] of graph.edges) {
      if (!children.has(from)) children.set(from, new Set());
      children.get(from).add(to);
    }

    const seeds = uniqueSorted([...issue, ...related]);
    const seedSet = new Set(seeds);

    // 訪問済み集合付きBFS: 既に訪れた請求項は再探索しない
    const visited = new Set(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
      const n = queue.shift();
      const next = children.get(n);
      if (!next) continue;
      for (const c of next) {
        if (!visited.has(c)) {
          visited.add(c);
          queue.push(c);
        }
      }
    }

    const dependentClaims = uniqueSorted([...visited].filter((n) => !seedSet.has(n)));
    // 2文目「請求項Xを引用する請求項…」の主語X: 従属項（直接引用してくる項）を
    // 1つ以上持つ請求項のみ（誰からも引用されていない項は主語に載せない）
    const citedSeeds = seeds.filter((s) => {
      const c = children.get(s);
      return !!c && c.size > 0;
    });
    const allAffectedClaims = uniqueSorted([...seeds, ...dependentClaims]);

    return {
      ok: true,
      issueClaims: issue,
      relatedClaims: related,
      dependentClaims,
      allAffectedClaims,
      citedSeeds,
    };
  }

  return { resolveAffectedClaims };
});
