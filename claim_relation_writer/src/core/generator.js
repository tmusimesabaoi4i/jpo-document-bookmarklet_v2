/*
 * generator.js — 影響範囲の計算結果を拒絶理由の定型文に整形する（DOM非依存の純粋モジュール）
 *
 * 文章構成（各文の行頭は全角スペース、文は \n 区切り）:
 *   1文目: 関連する請求項への同様の指摘        … 関連が空なら文ごと省略
 *   2文目: 引用してくる請求項（従属項）への波及 … 従属項が空なら文ごと省略
 *   3文目: 結論（明確性 / サポート要件で文末が変わる）
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./formatter'));
  } else {
    root.CRW = root.CRW || {};
    if (!root.CRW.formatter) {
      throw new Error('CRW.formatter が読み込まれていません。script の読み込み順を確認してください。');
    }
    root.CRW.generator = factory(root.CRW.formatter);
  }
})(globalThis, function (formatter) {
  'use strict';

  const ISSUE_TYPES = {
    clarity: {
      label: '明確性',
      conclusion: 'に係る発明は明確でない。',
    },
    support: {
      label: 'サポート要件',
      conclusion: 'に係る発明は、発明の詳細な説明に記載したものでない。',
    },
  };

  /**
   * @param options.issueType 'clarity' | 'support'
   * @param options.resolved  resolver.resolveAffectedClaims の戻り値（ok:true のもの）
   * @returns 生成された文章（string）
   */
  function generateStatement(options) {
    const { issueType, resolved } = options || {};
    const type = ISSUE_TYPES[issueType];
    if (!type) {
      throw new Error('不明な指摘事項です: ' + issueType);
    }
    if (
      !resolved ||
      !Array.isArray(resolved.allAffectedClaims) ||
      !Array.isArray(resolved.relatedClaims) ||
      !Array.isArray(resolved.dependentClaims) ||
      !Array.isArray(resolved.citedSeeds)
    ) {
      throw new Error('影響範囲の計算結果（resolver の戻り値）が必要です');
    }

    const f = formatter.formatClaimNumbers;
    const lines = [];
    if (resolved.relatedClaims.length > 0) {
      lines.push('　請求項' + f(resolved.relatedClaims) + 'にも同様の点が指摘される。');
    }
    if (resolved.dependentClaims.length > 0) {
      lines.push(
        '　請求項' + f(resolved.citedSeeds) + 'を引用する請求項' + f(resolved.dependentClaims) +
        'にも同様の点が指摘される。'
      );
    }
    lines.push('　よって、請求項' + f(resolved.allAffectedClaims) + type.conclusion);
    return lines.join('\n');
  }

  return { ISSUE_TYPES, generateStatement };
});
