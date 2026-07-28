/*
 * analyzer.js — 解析パイプラインの統合（DOM非依存の純粋モジュール）
 *
 * テキスト → docs/specification.md の RESULT 構造へ変換する。
 *   normalizeText → removeNonReasonSections → parseLeadingReasonList →
 *   parseReferenceList → splitReasonSections → （各理由）classifyReason →
 *   29条系: parseArticle29Section ／ 36条系: splitIssueBlocks → parseIssueBlock →
 *   buildIssueSummary → validateParsedItem → computeClaimStats
 *
 * 解析不能な入力でも throw せず、metadata.warnings と unparsedSections に残す。
 * metadata.analyzedAt は決定論のため空のまま返し、UI 側が設定する。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('./normalizer'),
      require('./claims'),
      require('./splitter'),
      require('./clarity-support'),
      require('./article29'),
      require('./summarizer'),
      require('./validator'),
      require('./consistency')
    );
  } else {
    root.RRB = root.RRB || {};
    root.RRB.analyzer = factory(
      root.RRB.normalizer,
      root.RRB.claims,
      root.RRB.splitter,
      root.RRB.claritySupport,
      root.RRB.article29,
      root.RRB.summarizer,
      root.RRB.validator,
      root.RRB.consistency
    );
  }
})(globalThis, function (normalizer, claims, splitter, claritySupport, article29, summarizer, validator, consistency) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  function emptyResult() {
    return {
      metadata: {
        analyzedAt: '',
        totalReasonCount: 0,
        warnings: [],
        issueCounts: { error: 0, warning: 0, info: 0 },
        claimStats: {
          maxClaimNumber: 0,
          totalClaimCount: 0,
          allFinalClaims: [],
          allMentionedClaims: [],
          unflaggedClaims: [],
          byCategory: { clarity: [], support: [], novelty: [], inventiveStep: [], other: [] },
        },
      },
      reasons: [],
      noveltyInventiveStep: { references: [], mappings: [] },
      unparsedSections: [],
      claimStructure: null,
      consistencyChecks: [],
      omittedClaimCandidates: [],
    };
  }

  // 29条系セクションか（分類が新規性/進歩性、または ・引用文献等 行を含む）
  function isArticle29Section(category, section) {
    if (category === 'novelty' || category === 'inventiveStep') return true;
    return /^[ \t　]*[・･][ \t　]*引用文献/m.test(section.matchText);
  }

  function analyze(text, options) {
    const opts = options || {};
    const result = emptyResult();
    const input = String(text == null ? '' : text);
    if (input.trim() === '') {
      result.metadata.warnings.push(makeWarning('EMPTY_INPUT', '入力が空です。拒絶理由通知の全文を貼り付けてください。', 'error'));
      return result;
    }

    const { body, matchBody, removedNote } = normalizer.removeNonReasonSections(input);
    if (removedNote) {
      result.metadata.warnings.push(makeWarning('NON_REASON_REMOVED', removedNote, 'info'));
    }

    const leading = splitter.parseLeadingReasonList(matchBody, body);
    const references = article29.parseReferenceList(matchBody, body);
    const { sections } = splitter.splitReasonSections(body, matchBody);

    const allMappings = [];
    sections.forEach((section, sectionIndex) => {
      const cls = splitter.classifyReason(section, leading);
      const reasonNumber = section.reasonNumber === null ? sectionIndex + 1 : section.reasonNumber;
      const reason = {
        reasonNumber,
        category: cls.category,
        categoryLabel: cls.categoryLabel,
        legalBasis: cls.legalBasis,
        headingRaw: section.headingRaw,
        confidence: cls.confidence,
        warnings: cls.warnings.slice(),
        items: [],
        article29: null,
      };
      if (section.headingRaw === null) {
        reason.warnings.push(makeWarning('NO_REASON_HEADING',
          '理由見出し（●理由Ｘ…）が見つからないため、全体を1つの理由として解析しています。', 'info'));
      }
      const context = {
        reasonNumber,
        category: cls.category,
        categoryLabel: cls.categoryLabel,
        legalBasis: cls.legalBasis,
      };

      if (isArticle29Section(cls.category, section)) {
        // ---- 29条系（新規性・進歩性）----
        const parsed = article29.parseArticle29Section(section, context, references);
        reason.article29 = { references, mappings: parsed.mappings };
        for (const w of parsed.warnings || []) reason.warnings.push(w);
        for (const mp of parsed.mappings) allMappings.push(mp);
        for (const up of parsed.unparsed || []) {
          result.unparsedSections.push({
            text: up.text,
            location: '理由' + reasonNumber,
            note: up.note || '29条系セクション内で解析できなかった記載',
          });
        }
      } else {
        // ---- 36条系（明確性・サポート要件・その他）----
        const split = splitter.splitIssueBlocks(section);
        if (split.preamble.rawText.trim() !== '') {
          result.unparsedSections.push({
            text: split.preamble.rawText.trim(),
            location: '理由' + reasonNumber + ' 冒頭',
            note: '指摘項目（・請求項 …）より前の記載',
          });
        }
        split.blocks.forEach((block, blockIndex) => {
          const item = claritySupport.parseIssueBlock(block, {
            reasonNumber,
            category: cls.category,
            categoryLabel: cls.categoryLabel,
            itemNumber: blockIndex + 1,
          });
          const summary = summarizer.buildIssueSummary(item, cls.category);
          item.issueSummary = summary.summary;
          item.summaryReliable = summary.reliable;
          validator.validateParsedItem(item, context);
          reason.items.push(item);
        });
        if (split.trailing !== null && split.trailing.rawText.trim() !== '') {
          // 末尾が引用文献一覧なら既に parseReferenceList が解析済みなので未解析扱いにしない
          const refs = article29.parseReferenceList(split.trailing.matchText, split.trailing.rawText);
          if (refs.length === 0) {
            result.unparsedSections.push({
              text: split.trailing.rawText.trim(),
              location: '理由' + reasonNumber + ' 末尾',
              note: '指摘項目の後に続く解析できなかった記載',
            });
          }
        }
        if (split.blocks.length === 0) {
          reason.warnings.push(makeWarning('NO_ISSUE_BLOCKS',
            '指摘項目（・請求項 …）を検出できませんでした。', 'warn'));
        }
      }
      result.reasons.push(reason);
    });

    result.noveltyInventiveStep = { references, mappings: allMappings };
    result.metadata.totalReasonCount = result.reasons.length;

    const hasAnyContent = result.reasons.some((r) => r.items.length > 0 || (r.article29 && r.article29.mappings.length > 0));
    if (!hasAnyContent) {
      result.metadata.warnings.push(makeWarning('NO_REASONS_FOUND',
        '拒絶理由の指摘項目を1件も検出できませんでした。原文の形式を確認してください。', 'error'));
    }

    // ---- クレーム構造との照合（§3・§5・§6・§7・§14）----
    // クレーム構造が無くても文章内の整合性検証（見出し／本文／結論）は実行する。
    const claimStructure = opts.claimStructure || null;
    result.claimStructure = claimStructure;
    const checked = consistency.run(result, claimStructure);
    result.consistencyChecks = checked.consistencyChecks;
    result.omittedClaimCandidates = checked.omittedClaimCandidates;
    for (const w of checked.warnings) result.metadata.warnings.push(w);
    result.metadata.issueCounts = checked.counts;

    // 本文に登場した全請求項（引用元・比較対象を含む）
    const allMentioned = claims.unionClaims(
      claims.extractClaimRefs(matchBody, body).map((r) => r.claims));
    // 全請求項数はクレーム構造があればそれを優先する（無ければ本文中の最大番号を推定値とする）
    const totalOverride = opts.totalClaimCount ||
      (claimStructure && claimStructure.totalClaimCount > 0 ? claimStructure.totalClaimCount : undefined);
    result.metadata.claimStats = validator.computeClaimStats(result, totalOverride, allMentioned);
    result.metadata.claimStats.totalClaimCountSource = opts.totalClaimCount ? 'manual'
      : (claimStructure && claimStructure.totalClaimCount > 0 ? 'claimStructure' : 'estimated');
    return result;
  }

  return { analyze };
});
