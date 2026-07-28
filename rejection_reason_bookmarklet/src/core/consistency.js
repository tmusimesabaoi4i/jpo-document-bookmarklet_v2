/*
 * consistency.js — 指摘範囲の整合性検証と指摘漏れ候補の検出（DOM非依存の純粋モジュール）
 *
 * 検証は次の3系統に分かれる。
 *   A. 拒絶理由の文章内だけで完結する照合（クレーム構造が無くても実行できる）
 *      - 見出し請求項 vs 結論請求項          … §6
 *      - 本文上の指摘集合 vs 見出し／結論     … §7
 *   B. クレーム構造（特許請求の範囲）を要する検証
 *      - 拒絶理由に書かれた請求項が実在するか … §3
 *      - 問題請求項の下位請求項の指摘漏れ     … §5
 *      - 拒絶理由が述べる引用関係と実構造の照合 … §14
 *
 * 重要: 「拒絶理由文中に明示された引用関係」（item.dependencyRelations）と
 * 「特許請求の範囲そのものから把握した引用関係」（claimStructure）は別物として保持し、
 * 相互に照合する。前者で後者を上書きしない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./claims'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.consistency = factory(root.RRB.claims);
  }
})(globalThis, function (claims) {
  'use strict';

  const cmp = (nums) => claims.compressClaimNumbers(nums);
  const uniqueSorted = (arr) => Array.from(new Set(arr || [])).sort((a, b) => a - b);
  const diff = (a, b) => a.filter((n) => b.indexOf(n) === -1);

  function makeIssue(severity, code, text) {
    return { severity, code, text };
  }

  // ---- 承継性の判定（§5.1） ----------------------------------------------

  // 指摘の性質が下位請求項へ承継されるかを判定する。
  // 引用元請求項の文言自体の不明確性・矛盾・記載欠如は、下位請求項の限定追加では
  // 通常解消しないため「原則エラー」級（strong）として扱う。
  function assessInheritability(item, category) {
    const texts = [
      item.clarityCoreSentence || '',
      item.conclusionText || '',
      item.issueSummary || '',
      (item.specStatements || []).map((s) => s.sentence).join(''),
    ].join('\n');

    if (/整合しておらず|整合しない|矛盾/.test(texts)) {
      return {
        inheritable: true, strength: 'strong', kind: 'contradiction',
        kindLabel: '発明特定事項同士の矛盾',
        basis: '引用元請求項内の発明特定事項同士が整合しないという指摘であり、下位請求項の限定追加では通常解消しないため',
      };
    }
    if (category === 'support' || (item.specStatements || []).length > 0 ||
        item.conclusionCategory === 'support') {
      return {
        inheritable: true, strength: 'strong', kind: 'support-missing',
        kindLabel: '明細書に記載がない構成',
        basis: '引用元請求項の構成が明細書に記載されていないという指摘であり、その構成を含む下位請求項にも及ぶため',
      };
    }
    if (category === 'clarity' || /不明確|明確でない/.test(texts)) {
      return {
        inheritable: true, strength: 'strong', kind: 'clarity-wording',
        kindLabel: '請求項の文言自体の不明確性',
        basis: '引用元請求項の文言自体が不明確であるという指摘であり、その文言を引用する下位請求項にも及ぶため',
      };
    }
    return {
      inheritable: true, strength: 'weak', kind: 'other',
      kindLabel: '性質を特定できない指摘',
      basis: '指摘の性質を自動判定できなかったため、承継するかは原文の確認が必要',
    };
  }

  // ---- A. 文章内の整合性（§6・§7） ---------------------------------------

  // 本文から得られる指摘請求項の集合（§7 の計算式）
  function computeBodyAffectedClaims(item) {
    return uniqueSorted([]
      .concat(item.directClaims || [])
      .concat(item.sameIssueClaims || [])
      .concat((item.dependencyRelations || []).reduce((acc, d) => acc.concat(d.affectedClaims || []), [])));
  }

  // 1 指摘項目の整合性を検証する。claimStructure は無くてもよい（あれば §7.3 を精緻化）
  function checkItem(item, reasonContext, claimStructure) {
    const headingClaims = uniqueSorted(item.headingClaims || []);
    const effectiveHeadingClaims = uniqueSorted(item.effectiveHeadingClaims || []);
    const finalClaims = uniqueSorted(item.finalClaims || []);
    const bodyAffectedClaims = computeBodyAffectedClaims(item);
    // 比較の基準は修正注記適用後の見出し（§6.4）
    const missingFromConclusion = diff(effectiveHeadingClaims, finalClaims);
    const unexpectedInConclusion = diff(finalClaims, effectiveHeadingClaims);
    const missingFromHeading = diff(bodyAffectedClaims, effectiveHeadingClaims);
    const missingFromBody = diff(effectiveHeadingClaims, bodyAffectedClaims);
    const bodyMissingFromConclusion = diff(bodyAffectedClaims, finalClaims);
    const conclusionMissingFromBody = diff(finalClaims, bodyAffectedClaims);
    const issues = [];
    // 見出しから請求項番号を抽出できていない場合、見出しを基準にした比較は
    // すべて偽陽性になるため実施しない（結論と本文の比較だけを行う）
    const headingUsable = effectiveHeadingClaims.length > 0;
    if (!headingUsable) {
      issues.push(makeIssue('info', 'HEADING_CLAIMS_UNAVAILABLE',
        '項目見出しから請求項番号を抽出できなかったため、見出しとの照合は行っていません。'));
    }

    // §6.1 見出しにあるが結論にない
    if (headingUsable && missingFromConclusion.length > 0) {
      issues.push(makeIssue('error', 'HEADING_CLAIMS_MISSING_IN_CONCLUSION',
        '項目見出しでは請求項' + cmp(effectiveHeadingClaims) + 'が指摘対象ですが、結論文の指摘対象は請求項' +
        (finalClaims.length === 0 ? 'なし' : cmp(finalClaims)) + 'です。請求項' +
        cmp(missingFromConclusion) + 'が結論から欠落しています。'));
    }
    // §6.2 見出しにないが結論にある
    if (headingUsable && unexpectedInConclusion.length > 0) {
      issues.push(makeIssue('error', 'CONCLUSION_CLAIMS_NOT_IN_HEADING',
        '結論文に記載された請求項' + cmp(unexpectedInConclusion) + 'は、項目見出しの指摘対象に含まれていません。' +
        (item.correctionNote && (item.correctionNote.excluded || []).length > 0
          ? '（見出しの修正注記で請求項' + cmp(item.correctionNote.excluded) + 'が除外されています）' : '')));
    }
    // §7.1 本文にあるが結論にない
    if (bodyMissingFromConclusion.length > 0) {
      issues.push(makeIssue('error', 'BODY_CLAIMS_MISSING_IN_CONCLUSION',
        '本文では請求項' + cmp(bodyMissingFromConclusion) +
        'にも同様の点が指摘されていますが、結論文の指摘対象に含まれていません。'));
    }
    // §7.2 結論にあるが本文上の根拠がない
    if (conclusionMissingFromBody.length > 0) {
      issues.push(makeIssue('error', 'CONCLUSION_CLAIMS_WITHOUT_BODY_BASIS',
        '結論文では請求項' + cmp(conclusionMissingFromBody) +
        'が指摘されていますが、本文中にこれを指摘対象とする記載を確認できません。'));
    }
    // §7.4 本文にあるが見出しにない
    if (headingUsable && missingFromHeading.length > 0) {
      issues.push(makeIssue('error', 'BODY_CLAIMS_NOT_IN_HEADING',
        '本文では請求項' + cmp(missingFromHeading) +
        'にも同様の点が指摘されていますが、項目見出しの対象請求項に含まれていません。'));
    }
    // §7.3 見出しにあるが本文上の根拠がない（クレーム構造で下位関係が説明できる分は info）
    if (headingUsable && missingFromBody.length > 0) {
      let structurallyCovered = [];
      let unexplained = missingFromBody;
      if (claimStructure) {
        const byNum = new Map(claimStructure.claims.map((c) => [c.claimNumber, c]));
        structurallyCovered = missingFromBody.filter((n) => {
          const c = byNum.get(n);
          return c && c.allAncestors.some((a) => bodyAffectedClaims.indexOf(a) !== -1);
        });
        unexplained = diff(missingFromBody, structurallyCovered);
      }
      if (structurallyCovered.length > 0) {
        issues.push(makeIssue('info', 'HEADING_CLAIMS_COVERED_BY_STRUCTURE',
          '項目見出しの請求項' + cmp(structurallyCovered) + 'は本文で直接言及されていませんが、' +
          '本文で指摘された請求項の下位請求項であるため見出しに含まれることは妥当です。'));
      }
      if (unexplained.length > 0) {
        issues.push(makeIssue('warn', 'HEADING_CLAIMS_WITHOUT_BODY_BASIS',
          '項目見出しには請求項' + cmp(unexplained) +
          'が含まれていますが、本文中にこれに関する直接指摘、同様指摘又は引用関係の記載を確認できません。'));
      }
    }

    const hasError = issues.some((i) => i.severity === 'error');
    const hasWarn = issues.some((i) => i.severity === 'warn');
    return {
      reasonNumber: reasonContext.reasonNumber,
      itemNumber: item.itemNumber,
      category: reasonContext.category,
      categoryLabel: reasonContext.categoryLabel,
      headingClaims,
      effectiveHeadingClaims,
      bodyAffectedClaims,
      finalClaims,
      missingFromConclusion,
      unexpectedInConclusion,
      missingFromHeading,
      missingFromBody,
      bodyMissingFromConclusion,
      conclusionMissingFromBody,
      inheritedCandidates: [],      // run() が構造から埋める（§8 の表用）
      omittedClaims: [],            // run() が埋める
      status: hasError ? 'error' : (hasWarn ? 'warning' : 'ok'),
      issues,
      messages: issues.map((i) => i.text),
    };
  }

  // ---- B-1. 請求項の実在確認（§3） ---------------------------------------

  // 拒絶理由中に現れる全請求項番号を集める（どこに現れたかのラベルつき）
  function collectMentionedClaims(reasons) {
    const map = new Map();   // 番号 → 出現場所ラベルの配列
    const add = (nums, label) => {
      for (const n of nums || []) {
        if (!map.has(n)) map.set(n, []);
        if (map.get(n).indexOf(label) === -1) map.get(n).push(label);
      }
    };
    for (const reason of reasons || []) {
      for (const item of reason.items || []) {
        const at = '理由' + reason.reasonNumber + ' 項目' + item.itemNumber;
        add(item.headingClaims, at + ' 見出し');
        add(item.directClaims, at + ' 直接指摘');
        add(item.citedParentClaims, at + ' 引用元');
        add(item.sameIssueClaims, at + ' 同様指摘');
        for (const d of item.dependencyRelations || []) {
          add(d.parentClaims, at + ' 引用元');
          add(d.affectedClaims, at + ' 引用による指摘');
        }
        add(item.finalClaims, at + ' 結論');
      }
      if (reason.article29) {
        for (const mp of reason.article29.mappings || []) {
          add(mp.claims, '理由' + reason.reasonNumber + ' 29条系');
        }
      }
    }
    return map;
  }

  function validateClaimExistence(reasons, claimStructure) {
    const issues = [];
    if (!claimStructure || claimStructure.claimNumbers.length === 0) return issues;
    const exists = new Set(claimStructure.claimNumbers);
    const total = claimStructure.totalClaimCount;
    for (const [num, places] of collectMentionedClaims(reasons)) {
      if (exists.has(num)) continue;
      const overTotal = num > total;
      issues.push(makeIssue('error', 'CLAIM_NOT_IN_SCOPE',
        '拒絶理由に記載された請求項' + num + 'は、特許請求の範囲に存在しません' +
        (overTotal ? '（全請求項数: ' + total + '）' : '（欠番）') + '。出現箇所: ' + places.join('、')));
    }
    return issues;
  }

  // ---- B-2. 拒絶理由が述べる引用関係と実構造の照合（§14） ----------------

  function crossCheckStatedDependencies(item, reasonContext, claimStructure) {
    const issues = [];
    if (!claimStructure || claimStructure.claims.length === 0) return issues;
    const byNum = new Map(claimStructure.claims.map((c) => [c.claimNumber, c]));
    const at = '理由' + reasonContext.reasonNumber + ' 項目' + item.itemNumber;

    // 「請求項Ｐを引用する請求項Ａにも同様の点が指摘される」の照合。
    // Ａが実際に（直接又は間接に）Ｐを引用しているかを1件ずつ確かめる。
    for (const rel of item.dependencyRelations || []) {
      const bad = [];
      for (const a of rel.affectedClaims || []) {
        const c = byNum.get(a);
        if (!c) continue;   // 実在しない請求項は §3 で報告済み
        const hit = (rel.parentClaims || []).some((p) => c.allAncestors.indexOf(p) !== -1);
        if (!hit) bad.push(a);
      }
      if (bad.length > 0) {
        issues.push(makeIssue('error', 'STATED_DEPENDENCY_MISMATCH',
          at + '：拒絶理由では請求項' + cmp(rel.affectedClaims) + 'が請求項' + cmp(rel.parentClaims) +
          'を引用すると記載されていますが、特許請求の範囲から抽出した引用関係と一致しません（請求項' +
          cmp(bad) + 'は請求項' + cmp(rel.parentClaims) + 'を引用していません）。'));
      }
    }
    // 「請求項Ｐを引用する請求項Ｙには…」（直接指摘の引用元）の照合
    if ((item.citedParentClaims || []).length > 0 && (item.directClaims || []).length > 0) {
      const bad = [];
      for (const d of item.directClaims) {
        const c = byNum.get(d);
        if (!c) continue;
        const hit = item.citedParentClaims.some((p) => c.allAncestors.indexOf(p) !== -1);
        if (!hit) bad.push(d);
      }
      if (bad.length > 0) {
        issues.push(makeIssue('error', 'STATED_DEPENDENCY_MISMATCH',
          at + '：拒絶理由では請求項' + cmp(item.directClaims) + 'が請求項' + cmp(item.citedParentClaims) +
          'を引用すると記載されていますが、特許請求の範囲から抽出した引用関係と一致しません。'));
      }
    }
    return issues;
  }

  // ---- B-3. 指摘漏れ候補（§5） -------------------------------------------

  // 1 指摘項目について、問題が承継されうる下位請求項のうち指摘対象に含まれないものを返す。
  // reasonCoverage … 同一理由の全項目の最終指摘請求項の和集合（重複報告の抑制に使う）
  function findOmittedCandidatesForItem(item, reasonContext, claimStructure, reasonCoverage) {
    const out = [];
    if (!claimStructure || claimStructure.claims.length === 0) return out;
    const byNum = new Map(claimStructure.claims.map((c) => [c.claimNumber, c]));
    const inherit = assessInheritability(item, reasonContext.category);
    // 問題があるとされた請求項（本文上の指摘集合）
    const problemClaims = computeBodyAffectedClaims(item);
    // この項目が指摘対象としている請求項（結論＋見出し＋本文）
    const covered = new Set([]
      .concat(item.finalClaims || [])
      .concat(item.effectiveHeadingClaims || [])
      .concat(problemClaims));
    const seen = new Set();

    for (const src of problemClaims) {
      const c = byNum.get(src);
      if (!c) continue;
      for (const desc of c.allDescendants) {
        if (covered.has(desc)) continue;
        if (seen.has(desc)) continue;
        seen.add(desc);
        const path = claimStructure.findPath ? claimStructure.findPath(src, desc) : null;
        const isDirect = path !== null && path.length === 2;
        const coveredElsewhere = (reasonCoverage || []).indexOf(desc) !== -1;
        let severity;
        if (coveredElsewhere) severity = 'info';
        else if (inherit.strength === 'strong') severity = isDirect ? 'error' : 'warning';
        else severity = 'warning';
        const pathText = path === null ? String(src) + ' → ' + desc : path.join(' → ');
        let basis = '請求項' + desc + 'は、問題が指摘された請求項' + src +
          (isDirect ? 'を直接引用しています' : 'を請求項' + path.slice(1, -1).join('、') + '経由で間接的に引用しています') +
          '。' + inherit.basis + '。';
        if (inherit.strength !== 'strong') {
          basis += ' 追加された限定によって問題が解消される可能性があるため、原文を確認してください。';
        }
        if (coveredElsewhere) {
          basis += ' なお、同一理由の他の指摘項目では請求項' + desc + 'が指摘対象に含まれています。';
        }
        out.push({
          reasonNumber: reasonContext.reasonNumber,
          itemNumber: item.itemNumber,
          categoryLabel: reasonContext.categoryLabel,
          sourceClaim: src,
          omittedClaim: desc,
          dependencyPath: path === null ? [src, desc] : path,
          dependencyPathText: pathText,
          inDirectDependency: isDirect,
          inheritKind: inherit.kind,
          inheritKindLabel: inherit.kindLabel,
          inFinalClaims: false,
          coveredElsewhereInReason: coveredElsewhere,
          severity,
          basis,
        });
      }
    }
    out.sort((a, b) => a.omittedClaim - b.omittedClaim);
    return out;
  }

  // ---- 統合実行 -----------------------------------------------------------

  // 解析結果全体に整合性検証をかける。result は変更しない（戻り値を analyzer が格納する）。
  function run(result, claimStructure) {
    const consistencyChecks = [];
    const omittedClaimCandidates = [];
    const warnings = [];

    for (const issue of validateClaimExistence(result.reasons, claimStructure)) {
      warnings.push({ code: issue.code, message: issue.text, severity: issue.severity });
    }

    for (const reason of result.reasons || []) {
      const context = {
        reasonNumber: reason.reasonNumber,
        category: reason.category,
        categoryLabel: reason.categoryLabel,
      };
      // 同一理由内の指摘済み請求項（結論＋見出し＋本文の和集合）
      const reasonCoverage = uniqueSorted((reason.items || []).reduce((acc, it) => acc
        .concat(it.finalClaims || [])
        .concat(it.effectiveHeadingClaims || [])
        .concat(computeBodyAffectedClaims(it)), []));

      for (const item of reason.items || []) {
        const check = checkItem(item, context, claimStructure);
        for (const issue of crossCheckStatedDependencies(item, context, claimStructure)) {
          check.issues.push(issue);
          check.messages.push(issue.text);
          if (issue.severity === 'error') check.status = 'error';
          else if (check.status === 'ok') check.status = 'warning';
        }
        const omitted = findOmittedCandidatesForItem(item, context, claimStructure, reasonCoverage);
        check.omittedClaims = omitted.map((o) => o.omittedClaim);
        // §8 の「クレーム構造上の承継候補」= 本文上の指摘請求項の全下位請求項
        if (claimStructure) {
          const byNum = new Map(claimStructure.claims.map((c) => [c.claimNumber, c]));
          check.inheritedCandidates = uniqueSorted(computeBodyAffectedClaims(item)
            .reduce((acc, n) => acc.concat((byNum.get(n) || { allDescendants: [] }).allDescendants), []));
        }
        for (const o of omitted) {
          if (o.severity === 'error' && check.status !== 'error') check.status = 'error';
          omittedClaimCandidates.push(o);
        }
        consistencyChecks.push(check);
      }
    }

    const counts = { error: 0, warning: 0, info: 0 };
    const bump = (sev) => {
      if (sev === 'error') counts.error++;
      else if (sev === 'warn' || sev === 'warning') counts.warning++;
      else counts.info++;
    };
    for (const w of warnings) bump(w.severity);
    for (const c of consistencyChecks) for (const i of c.issues) bump(i.severity);
    for (const o of omittedClaimCandidates) bump(o.severity);
    if (claimStructure) {
      for (const w of claimStructure.warnings || []) bump(w.severity);
      for (const w of claimStructure.crossChecks || []) bump(w.severity);
      for (const c of claimStructure.claims || []) for (const w of c.warnings || []) bump(w.severity);
    }

    return { consistencyChecks, omittedClaimCandidates, warnings, counts };
  }

  return {
    assessInheritability,
    computeBodyAffectedClaims,
    checkItem,
    collectMentionedClaims,
    validateClaimExistence,
    crossCheckStatedDependencies,
    findOmittedCandidatesForItem,
    run,
  };
});
