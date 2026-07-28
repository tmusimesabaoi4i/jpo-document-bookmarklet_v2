/*
 * validator.js — 検証・警告付与・confidence 決定・請求項統計（DOM非依存の純粋モジュール）
 *
 * validateParsedItem は ITEM を破壊的に更新して同じオブジェクトを返す（warnings は追加のみ・
 * 既存の警告は消さない）。同じ ITEM に二重適用しても警告が重複しないよう code+message で
 * 重複排除する。
 * computeClaimStats は純関数。UI が「全請求項数」を変更した際の再計算にも使う。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./claims'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.validator = factory(root.RRB.claims);
  }
})(globalThis, function (claims) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  // 結論文の区分（conclusionCategory）→ 表示名
  const CONCLUSION_FAMILY_LABELS = {
    clarity: '明確性',
    support: 'サポート要件',
    article29: '新規性・進歩性等（29条）',
  };

  // 理由の区分 → 結論文の区分系統（新規性・進歩性はどちらも 29条系）
  function conclusionFamily(category) {
    if (category === 'clarity') return 'clarity';
    if (category === 'support') return 'support';
    if (category === 'novelty' || category === 'inventiveStep') return 'article29';
    return null;
  }

  function pushWarning(list, warning) {
    for (const w of list) {
      if (w && w.code === warning.code && w.message === warning.message) return;
    }
    list.push(warning);
  }

  function arr(value) {
    return Array.isArray(value) ? value : [];
  }

  function nums(list) {
    return claims.compressClaimNumbers(list);
  }

  // 見出しの修正注記で除外された請求項が本文・結論文に再出現していないか調べる
  function conflictingExcludedClaims(item) {
    const note = item.correctionNote;
    if (!note || arr(note.excluded).length === 0) return [];
    const dependency = [];
    for (const rel of arr(item.dependencyRelations)) {
      for (const n of arr(rel && rel.affectedClaims)) dependency.push(n);
    }
    const appearing = new Set(claims.unionClaims([
      arr(item.directClaims),
      arr(item.sameIssueClaims),
      dependency,
      arr(item.finalClaims),
    ]));
    return arr(note.excluded).filter((n) => appearing.has(n)).sort((a, b) => a - b);
  }

  // 結論文から請求項番号を取れず見出しを暫定使用しているか
  function isHeadingFallback(item) {
    if (item.finalClaimsSource === 'headingFallback') return true;
    if (item.finalClaimsSource === 'conclusion') return false;
    return item.finalClaimsRaw == null && arr(item.finalClaims).length > 0;
  }

  // ITEM を検証して警告と confidence を埋める（同じオブジェクトを返す）
  function validateParsedItem(item, reasonContext) {
    if (item == null) return item;
    if (!Array.isArray(item.warnings)) item.warnings = [];
    const context = reasonContext || {};

    // 1) 見出しの区分と結論文の区分が食い違う
    const family = conclusionFamily(context.category);
    const conclusionCategory = item.conclusionCategory;
    if (family !== null && conclusionCategory != null && conclusionCategory !== 'unknown' &&
        conclusionCategory !== family) {
      const label = CONCLUSION_FAMILY_LABELS[conclusionCategory] || conclusionCategory;
      pushWarning(item.warnings, makeWarning('HEADING_CONCLUSION_MISMATCH',
        '理由見出しは「' + (context.categoryLabel || context.category || '不明') + '」ですが、' +
        '結論文は' + label + 'に対応する表現です。原文を確認してください。'));
    }

    // 2) 修正注記で除外した請求項が本文・結論文に再出現
    const conflicting = conflictingExcludedClaims(item);
    if (conflicting.length > 0) {
      pushWarning(item.warnings, makeWarning('CORRECTION_NOTE_CONFLICT',
        '見出しの修正注記では請求項' + nums(arr(item.correctionNote.excluded)) + 'が除外されていますが、' +
        '本文又は結論文には請求項' + nums(conflicting) + 'が含まれています。'));
    }

    // 3) 結論文から請求項番号を取れず見出しを暫定使用
    const headingFallback = isHeadingFallback(item);
    if (headingFallback) {
      pushWarning(item.warnings, makeWarning('NO_FINAL_CLAIMS',
        '結論文から請求項番号を抽出できなかったため、見出し請求項を暫定値として使用しています。'));
    }

    // 4) 結論文そのものを特定できない
    if (item.conclusionText == null) {
      pushWarning(item.warnings, makeWarning('NO_CONCLUSION',
        '結論文（よって…）を特定できませんでした。原文を確認してください。'));
    }

    // 5) 解析できなかった文が残っている（情報）
    const unmatched = arr(item.unmatchedSentences);
    if (unmatched.length > 0) {
      pushWarning(item.warnings, makeWarning('UNPARSED_TEXT',
        '解析できなかった文が' + unmatched.length + '件あります。原文を確認してください。', 'info'));
    }

    // confidence
    const severe = item.warnings.filter((w) => w && (w.severity === 'warn' || w.severity === 'error'));
    const hasDirect = arr(item.directClaims).length > 0;
    const hasConclusion = item.conclusionText != null;
    const summaryUnreliable = item.summaryReliable === false;
    if (!hasDirect || !hasConclusion || severe.length >= 3) {
      item.confidence = 'low';
    } else if (severe.length === 0 && !headingFallback && !summaryUnreliable) {
      item.confidence = 'high';
    } else {
      item.confidence = 'medium';
    }
    return item;
  }

  // ---------------------------------------------------------------- 請求項統計

  const CATEGORY_KEYS = ['clarity', 'support', 'novelty', 'inventiveStep', 'other'];

  function categoryKey(category) {
    return CATEGORY_KEYS.indexOf(category) === -1 ? 'other' : category;
  }

  function subCategoryKey(subCategory) {
    if (subCategory === 'novelty' || subCategory === 'inventiveStep') return subCategory;
    return 'other';
  }

  // 29条系の MAPPING を集める（analyzer は noveltyInventiveStep に再掲するが、
  // reason.article29 しか持たない結果でも動くよう双方から集めて和集合を採る）
  function collectMappings(result) {
    const mappings = [];
    const nis = result && result.noveltyInventiveStep;
    for (const m of arr(nis && nis.mappings)) mappings.push(m);
    for (const reason of arr(result && result.reasons)) {
      for (const m of arr(reason && reason.article29 && reason.article29.mappings)) mappings.push(m);
    }
    return mappings;
  }

  // 未指摘請求項などの統計を計算する純関数。
  //   totalClaimCountOverride … UI が入力した全請求項数（未指定なら maxClaimNumber）
  //   allMentionedClaimsOverride … 呼び出し側が別途集計した「本文に登場した請求項」
  function computeClaimStats(result, totalClaimCountOverride, allMentionedClaimsOverride) {
    const byCategoryLists = { clarity: [], support: [], novelty: [], inventiveStep: [], other: [] };
    const mentioned = [];

    for (const reason of arr(result && result.reasons)) {
      const key = categoryKey(reason && reason.category);
      for (const item of arr(reason && reason.items)) {
        byCategoryLists[key].push(arr(item.finalClaims));
        mentioned.push(
          arr(item.headingClaims), arr(item.effectiveHeadingClaims), arr(item.directClaims),
          arr(item.citedParentClaims), arr(item.sameIssueClaims), arr(item.finalClaims)
        );
        for (const rel of arr(item.dependencyRelations)) {
          mentioned.push(arr(rel && rel.parentClaims), arr(rel && rel.affectedClaims));
        }
      }
    }
    for (const mapping of collectMappings(result)) {
      byCategoryLists[subCategoryKey(mapping && mapping.subCategory)].push(arr(mapping && mapping.claims));
      mentioned.push(arr(mapping && mapping.claims));
    }

    const byCategory = {};
    for (const key of CATEGORY_KEYS) byCategory[key] = claims.unionClaims(byCategoryLists[key]);
    const allFinalClaims = claims.unionClaims(CATEGORY_KEYS.map((key) => byCategory[key]));

    let allMentionedClaims;
    if (Array.isArray(allMentionedClaimsOverride)) {
      allMentionedClaims = claims.unionClaims([allMentionedClaimsOverride]);
    } else {
      const existing = result && result.metadata && result.metadata.claimStats &&
        result.metadata.claimStats.allMentionedClaims;
      allMentionedClaims = Array.isArray(existing)
        ? claims.unionClaims([existing])
        : claims.unionClaims(mentioned);
    }

    const all = claims.unionClaims([allMentionedClaims, allFinalClaims]);
    const maxClaimNumber = all.length > 0 ? all[all.length - 1] : 0;
    const totalCountRaw = Number(totalClaimCountOverride);
    const totalClaimCount = Number.isFinite(totalCountRaw) && totalCountRaw > 0
      ? Math.floor(totalCountRaw)
      : maxClaimNumber;
    const flagged = new Set(allFinalClaims);
    const unflaggedClaims = [];
    for (let n = 1; n <= totalClaimCount; n++) {
      if (!flagged.has(n)) unflaggedClaims.push(n);
    }

    return {
      maxClaimNumber,
      totalClaimCount,
      allFinalClaims,
      allMentionedClaims,
      unflaggedClaims,
      byCategory,
    };
  }

  return {
    conclusionFamily,
    validateParsedItem,
    computeClaimStats,
  };
});
