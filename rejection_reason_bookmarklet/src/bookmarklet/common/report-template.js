/*
 * report-template.js — 別タブ用 JS フリー HTML レポート生成（純関数・DOM非依存）
 *
 * 対象ページの CSP は別タブへも継承されるため、生成する HTML には <script> ・
 * on* 属性・javascript: URL を一切含めない。展開 UI は <details>/<summary> のみで
 * 実現する（ブラウザネイティブ機能なので JS 無しで動く）。
 *
 * 依存について: このモジュールは意図的に他の RRB.* モジュールへ依存しない
 * （factory() に引数を取らない）。請求項番号の圧縮表示（compressClaimNumbers 相当）は
 * 仕様書のアルゴリズムをこのファイル内に再実装している。src/core/claims.js は
 * 別エージェントが並行実装中で、このファイル単体を node --test で検証したいときに
 * require 解決エラーで壊れないようにするための設計判断。アルゴリズムは仕様書の
 * 例（[2..7]→"2-7"、[3,4,19,20]→"3-4、19-20"）と一致させてある。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.reportTemplate = factory();
  }
})(globalThis, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 共通ヘルパ
  // ---------------------------------------------------------------------

  // HTML エスケープ（動的値はすべてこれを通す。& を最初に処理すること）
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 請求項番号配列を "2-7" "3-4、19-20" のような圧縮表記へ（RRB.claims.compressClaimNumbers と同一仕様）
  function compressClaimNumbers(nums) {
    const uniq = Array.isArray(nums)
      ? [...new Set(nums.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
      : [];
    if (uniq.length === 0) return '';
    const parts = [];
    let start = uniq[0];
    let prev = uniq[0];
    for (let i = 1; i <= uniq.length; i++) {
      const cur = uniq[i];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = cur;
      prev = cur;
    }
    return parts.join('、');
  }

  // 複数の請求項番号配列の和集合（昇順・重複なし）
  function unionClaims(...arrays) {
    const set = new Set();
    for (const arr of arrays) {
      for (const n of arr || []) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }

  function warningMessages(warnings) {
    return (warnings || []).map((w) => w.message).filter(Boolean);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  // 請求項番号配列を圧縮せず「、」区切りでそのまま並べる（請求項構造タブの直接下位／全下位用。
  // 引用元側は compressClaimNumbers による範囲圧縮を使うのに対し、下位側は個々の番号を
  // そのまま確認したいという要件のため意図的に非圧縮にしている）
  function joinPlain(arr) {
    return asArray(arr).join('、');
  }

  // consistencyChecks・omittedClaimCandidates の severity 表記ゆれ（'warn' と 'warning' の
  // 両方が実際に使われる）を吸収して統一ラベルを返す
  function severityLabel(sev) {
    if (sev === 'error') return 'エラー';
    if (sev === 'warn' || sev === 'warning') return '要確認';
    return '参考';
  }

  const STATUS_LABEL = { ok: '整合', warning: '要確認', error: '不一致' };

  function severityBadgeClass(sev) {
    if (sev === 'error') return 'rpt-badge-red';
    if (sev === 'warn' || sev === 'warning') return 'rpt-badge-yellow';
    return 'rpt-badge-gray';
  }

  // reasonNumber・itemNumber から元の ITEM を引く（consistencyChecks は直接指摘／同様指摘／
  // 引用による指摘の請求項配列を保持していないため、詳細表示のために逆引きする）
  function findSourceItem(result, reasonNumber, itemNumber) {
    const reason = asArray(result && result.reasons).find((r) => r.reasonNumber === reasonNumber);
    if (!reason) return null;
    return asArray(reason.items).find((it) => it.itemNumber === itemNumber) || null;
  }

  // 差分セル: 非空の項目だけを「見出し−結論: 2-7」のように列挙する
  function buildDiffSummary(check) {
    const parts = [];
    const push = (label, arr) => {
      if (asArray(arr).length > 0) parts.push(label + ': ' + compressClaimNumbers(arr));
    };
    push('見出し−結論', check.missingFromConclusion);
    push('結論−見出し', check.unexpectedInConclusion);
    push('本文−結論', check.bodyMissingFromConclusion);
    push('結論−本文', check.conclusionMissingFromBody);
    push('本文−見出し', check.missingFromHeading);
    push('見出し−本文', check.missingFromBody);
    return parts.join(' ／ ');
  }

  // ---------------------------------------------------------------------
  // CSV / TSV 共通: 行データの抽出
  // ---------------------------------------------------------------------

  // 仕様書「CSV / TSV 列」の並び（20列固定）
  const CSV_COLUMNS = [
    '区分', '理由No', '項目No', '見出し請求項(原文)', '見出し請求項(修正後)',
    '直接指摘', '同様指摘', '引用元', '引用による指摘', '最終指摘',
    '引用文献番号', '引用文献名', '適用関係', '問題となる記載', '比較対象の記載',
    '問題の要約', '備考', '確度', '警告', '原文',
  ];

  // 明確性・サポート要件・その他の ITEM 1件を1行に変換する。
  // 引用文献系（11〜13列目）は 29 条系専用のため常に空欄にする。
  function itemToRow(reason, item) {
    const citedParents = unionClaims(
      item.citedParentClaims,
      ...asArray(item.dependencyRelations).map((d) => d.parentClaims)
    );
    const affected = unionClaims(...asArray(item.dependencyRelations).map((d) => d.affectedClaims));
    const problemText = asArray(item.problematicPhrases)
      .filter((p) => p.role === 'problem')
      .map((p) => p.text)
      .join(' / ');
    const comparisonText = asArray(item.problematicPhrases)
      .filter((p) => p.role === 'comparison')
      .map((p) => p.text)
      .join(' / ');
    const finalCell = asArray(item.finalClaims).length
      ? compressClaimNumbers(item.finalClaims)
      : (item.finalClaimsRaw || '');
    return [
      reason.categoryLabel || '',
      reason.reasonNumber != null ? String(reason.reasonNumber) : '',
      item.itemNumber != null ? String(item.itemNumber) : '',
      item.headingClaimsRaw || '',
      compressClaimNumbers(item.effectiveHeadingClaims),
      compressClaimNumbers(item.directClaims),
      compressClaimNumbers(item.sameIssueClaims),
      compressClaimNumbers(citedParents),
      compressClaimNumbers(affected),
      finalCell,
      '', '', '',
      problemText,
      comparisonText,
      item.issueSummary || '',
      '',
      item.confidence || '',
      warningMessages(item.warnings).join(' / '),
      item.sourceText || '',
    ];
  }

  // 29 条系 MAPPING 1件を1行に変換する。指摘系（4〜10列目・14〜16列目）は
  // ITEM 固有の概念（見出し請求項の修正注記・引用関係の段階など）を持たないため
  // 常に空欄にする（原文全文は 20 列目にそのまま残るため情報は失われない）。
  function mappingToRow(mapping) {
    const referenceNames = asArray(mapping.referenceNames).map((n) => n || '(不明)').join('、');
    return [
      mapping.subCategoryLabel || '',
      mapping.reasonNumber != null ? String(mapping.reasonNumber) : '',
      '',
      '', '',
      '', '', '', '', '',
      mapping.referenceNumbersRaw || compressClaimNumbers(mapping.referenceNumbers),
      referenceNames,
      mapping.application || '',
      '', '',
      '',
      mapping.remarks || '',
      mapping.confidence || '',
      warningMessages(mapping.warnings).join(' / '),
      mapping.sourceText || '',
    ];
  }

  function collectItemEntries(result) {
    const entries = [];
    for (const reason of asArray(result.reasons)) {
      for (const item of asArray(reason.items)) {
        entries.push({ reason, item });
      }
    }
    return entries;
  }

  function collectMappingEntries(result) {
    const novelty = (result && result.noveltyInventiveStep) || {};
    return asArray(novelty.mappings).map((mapping) => ({ mapping }));
  }

  function collectRows(result) {
    const res = result || {};
    const rows = collectItemEntries(res).map(({ reason, item }) => itemToRow(reason, item));
    const mappingRows = collectMappingEntries(res).map(({ mapping }) => mappingToRow(mapping));
    return rows.concat(mappingRows);
  }

  // ---------------------------------------------------------------------
  // CSV / TSV 追加セクション: 整合性チェック・指摘漏れ候補
  // （既存20列はそのまま。空行＋見出し行を挟んで別セクションとして追記する方式）
  // ---------------------------------------------------------------------

  const CONSISTENCY_COLUMNS = [
    '理由No', '項目No', '区分', '見出し請求項(原文)', '見出し請求項(修正後)',
    '本文上の対象', '結論請求項', '判定', '差分', 'エラー内容',
  ];

  const OMITTED_COLUMNS = [
    '理由No', '項目No', '区分', '問題請求項', '漏れている可能性のある請求項',
    '引用経路', '判定', '他項目で指摘済', '根拠',
  ];

  function consistencyToRow(check) {
    return [
      check.reasonNumber != null ? String(check.reasonNumber) : '',
      check.itemNumber != null ? String(check.itemNumber) : '',
      check.categoryLabel || '',
      compressClaimNumbers(check.headingClaims),
      compressClaimNumbers(check.effectiveHeadingClaims),
      compressClaimNumbers(check.bodyAffectedClaims),
      compressClaimNumbers(check.finalClaims),
      STATUS_LABEL[check.status] || check.status || '',
      buildDiffSummary(check),
      asArray(check.messages).join(' / '),
    ];
  }

  function omittedToRow(candidate) {
    return [
      candidate.reasonNumber != null ? String(candidate.reasonNumber) : '',
      candidate.itemNumber != null ? String(candidate.itemNumber) : '',
      candidate.categoryLabel || '',
      candidate.sourceClaim != null ? String(candidate.sourceClaim) : '',
      candidate.omittedClaim != null ? String(candidate.omittedClaim) : '',
      candidate.dependencyPathText || '',
      severityLabel(candidate.severity),
      candidate.coveredElsewhereInReason ? 'はい' : '',
      candidate.basis || '',
    ];
  }

  // ---------------------------------------------------------------------
  // CSV（RFC4180 準拠。BOM はここでは付与しない＝呼び出し側で保存時に付与）
  // ---------------------------------------------------------------------

  function toCsvField(value) {
    const s = value == null ? '' : String(value);
    if (/["\r\n,]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCsv(result) {
    const res = result || {};
    const rows = collectRows(res);
    const lines = [CSV_COLUMNS.map(toCsvField).join(',')];
    for (const row of rows) {
      lines.push(row.map(toCsvField).join(','));
    }

    lines.push('');
    lines.push(toCsvField('[整合性チェック]'));
    lines.push(CONSISTENCY_COLUMNS.map(toCsvField).join(','));
    for (const check of asArray(res.consistencyChecks)) {
      lines.push(consistencyToRow(check).map(toCsvField).join(','));
    }

    lines.push('');
    lines.push(toCsvField('[指摘漏れ候補]'));
    lines.push(OMITTED_COLUMNS.map(toCsvField).join(','));
    for (const candidate of asArray(res.omittedClaimCandidates)) {
      lines.push(omittedToRow(candidate).map(toCsvField).join(','));
    }

    return lines.join('\r\n');
  }

  // ---------------------------------------------------------------------
  // TSV（タブ区切り・LF・値中のタブ/改行は半角スペースへ）
  // ---------------------------------------------------------------------

  function toTsvField(value) {
    const s = value == null ? '' : String(value);
    return s.replace(/[\t\r\n]+/g, ' ');
  }

  function buildTsv(result) {
    const res = result || {};
    const rows = collectRows(res);
    const lines = [CSV_COLUMNS.map(toTsvField).join('\t')];
    for (const row of rows) {
      lines.push(row.map(toTsvField).join('\t'));
    }

    lines.push('');
    lines.push(toTsvField('[整合性チェック]'));
    lines.push(CONSISTENCY_COLUMNS.map(toTsvField).join('\t'));
    for (const check of asArray(res.consistencyChecks)) {
      lines.push(consistencyToRow(check).map(toTsvField).join('\t'));
    }

    lines.push('');
    lines.push(toTsvField('[指摘漏れ候補]'));
    lines.push(OMITTED_COLUMNS.map(toTsvField).join('\t'));
    for (const candidate of asArray(res.omittedClaimCandidates)) {
      lines.push(omittedToRow(candidate).map(toTsvField).join('\t'));
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------
  // HTML レポート（JS フリー・完全な単一 HTML 文書）
  // ---------------------------------------------------------------------

  const REPORT_STYLE = [
    '*,*::before,*::after{box-sizing:border-box;}',
    'body{font-family:"Segoe UI","Yu Gothic UI",Meiryo,system-ui,sans-serif;font-size:14px;' +
      'line-height:1.7;color:#1f2430;background:#fff;margin:0;padding:24px;}',
    'h1{font-size:1.35rem;margin:0 0 6px;}',
    'h2{font-size:1.1rem;margin:30px 0 10px;padding-top:14px;border-top:1px solid #d8dde3;}',
    'h3{font-size:1rem;margin:18px 0 8px;}',
    'h4{font-size:.85rem;margin:10px 0 4px;color:#454d59;}',
    '.rpt-header{margin-bottom:10px;}',
    '.rpt-meta{color:#626b78;font-size:.85rem;}',
    '.rpt-empty{color:#8a93a0;font-size:.9rem;}',
    '.rpt-table-wrap{overflow-x:auto;margin:0 0 14px;}',
    'table.rpt-table{border-collapse:collapse;width:100%;font-size:.83rem;}',
    'table.rpt-table caption{caption-side:top;text-align:left;font-weight:700;margin-bottom:4px;}',
    '.rpt-table th,.rpt-table td{border:1px solid #d8dde3;padding:5px 8px;text-align:left;vertical-align:top;}',
    '.rpt-table thead th{background:#eef1f5;}',
    '.rpt-detail-row td{background:#f7f8fa;}',
    '.rpt-detail-block{margin:4px 0;}',
    '.rpt-pre{white-space:pre-wrap;word-break:break-word;background:#f2f4f7;border:1px solid #d8dde3;' +
      'border-radius:4px;padding:8px;font-family:"MS Gothic","ＭＳ ゴシック",Consolas,monospace;}',
    '.rpt-sub{color:#626b78;font-size:.78rem;}',
    '.rpt-badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:.72rem;font-weight:700;margin-left:4px;white-space:nowrap;}',
    '.rpt-badge-blue{background:#e6edf7;color:#1d4e89;}',
    '.rpt-badge-teal{background:#e1f3f0;color:#1d7a70;}',
    '.rpt-badge-purple{background:#f0e6f7;color:#6a2fa0;}',
    '.rpt-badge-yellow{background:#fff6e5;color:#8a5a00;}',
    '.rpt-badge-red{background:#fbeae9;color:#a4302a;}',
    '.rpt-badge-gray{background:#eef1f5;color:#626b78;}',
    '.rpt-badge-green{background:#e7f5ea;color:#226a3b;}',
    'details summary{cursor:pointer;color:#1d4e89;font-size:.85rem;}',
    '@media print{',
    'body{padding:8mm;}',
    '.rpt-table-wrap{overflow-x:visible;}',
    'table.rpt-table,.rpt-detail-block,.rpt-pre{break-inside:avoid;page-break-inside:avoid;}',
    'details{break-inside:avoid;}',
    '}',
  ].join('\n');

  function buildWarningBadge(warnings) {
    const list = warnings || [];
    if (list.length === 0) return '';
    const hasError = list.some((w) => w.severity === 'error');
    const cls = hasError ? 'rpt-badge-red' : 'rpt-badge-yellow';
    return '<span class="rpt-badge ' + cls + '">警告 ' + list.length + '</span>';
  }

  function groupPhrasesByRole(phrases) {
    const order = ['problem', 'comparison', 'spec', 'unknown'];
    const map = new Map();
    for (const p of asArray(phrases)) {
      const key = p.role || 'unknown';
      if (!map.has(key)) map.set(key, { role: key, roleLabel: p.roleLabel || key, phrases: [] });
      map.get(key).phrases.push(p);
    }
    return order.filter((r) => map.has(r)).map((r) => map.get(r));
  }

  // 「請求項Pを引用する請求項Aにも同様の点が指摘される」の内訳を文章化する
  function describeDependencyRelation(rel) {
    return '請求項' + compressClaimNumbers(rel.parentClaims) +
      'を引用する請求項' + compressClaimNumbers(rel.affectedClaims);
  }

  function buildItemDetail(item) {
    const parts = [];
    parts.push(
      '<div class="rpt-detail-block"><h4>原文全文</h4><pre class="rpt-pre">' +
      escapeHtml(item.sourceText || '') + '</pre></div>'
    );
    const groups = groupPhrasesByRole(item.problematicPhrases);
    if (groups.length > 0) {
      const items = [];
      for (const group of groups) {
        for (const phrase of group.phrases) {
          const claimNote = asArray(phrase.claimNumbers).length
            ? '（請求項' + escapeHtml(compressClaimNumbers(phrase.claimNumbers)) + '）'
            : '';
          items.push(
            '<li><strong>' + escapeHtml(group.roleLabel) + '</strong>: ' +
            escapeHtml(phrase.text) + claimNote + '</li>'
          );
        }
      }
      parts.push('<div class="rpt-detail-block"><h4>抽出された記載</h4><ul>' + items.join('') + '</ul></div>');
    }
    const relations = asArray(item.dependencyRelations);
    if (relations.length > 0) {
      const items = relations.map((rel) => '<li>' + escapeHtml(describeDependencyRelation(rel)) + '</li>');
      parts.push('<div class="rpt-detail-block"><h4>引用関係</h4><ul>' + items.join('') + '</ul></div>');
    }
    parts.push(
      '<div class="rpt-detail-block"><h4>結論文</h4><p>' + escapeHtml(item.conclusionText || 'なし') + '</p></div>'
    );
    parts.push(
      '<div class="rpt-detail-block"><h4>確度</h4><p>' + escapeHtml(item.confidence || '') + '</p></div>'
    );
    const warnings = asArray(item.warnings);
    if (warnings.length > 0) {
      const items = warnings.map((w) => '<li>[' + escapeHtml(w.severity || '') + '] ' + escapeHtml(w.message || '') + '</li>');
      parts.push('<div class="rpt-detail-block"><h4>警告</h4><ul>' + items.join('') + '</ul></div>');
    }
    const unmatched = asArray(item.unmatchedSentences);
    if (unmatched.length > 0) {
      const items = unmatched.map((s) => '<li>' + escapeHtml(s) + '</li>');
      parts.push('<div class="rpt-detail-block"><h4>未解析の文</h4><ul>' + items.join('') + '</ul></div>');
    }
    return parts.join('\n');
  }

  function buildItemRow(item) {
    const citedParents = unionClaims(
      item.citedParentClaims,
      ...asArray(item.dependencyRelations).map((d) => d.parentClaims)
    );
    const affected = unionClaims(...asArray(item.dependencyRelations).map((d) => d.affectedClaims));
    const headingMain = compressClaimNumbers(item.effectiveHeadingClaims);
    const headingCell = item.correctionNote
      ? escapeHtml(headingMain) + '<br><span class="rpt-sub">原文: ' + escapeHtml(item.headingClaimsRaw || '') + '</span>'
      : escapeHtml(headingMain);
    const problemPhrase = asArray(item.problematicPhrases).find((p) => p.role === 'problem');
    const problemCell = problemPhrase ? escapeHtml(problemPhrase.text) : '';
    const finalCell = asArray(item.finalClaims).length
      ? compressClaimNumbers(item.finalClaims)
      : (item.finalClaimsRaw || '');
    const summaryCell = escapeHtml(item.issueSummary || '') +
      (item.summaryReliable === false ? '<span class="rpt-badge rpt-badge-gray">自動要約の確度が低い</span>' : '');

    const mainRow = '<tr>' +
      '<td>' + escapeHtml(item.itemNumber != null ? String(item.itemNumber) : '') + '</td>' +
      '<td>' + headingCell + '</td>' +
      '<td>' + problemCell + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(item.directClaims)) + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(item.sameIssueClaims)) + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(citedParents)) + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(affected)) + '</td>' +
      '<td>' + escapeHtml(finalCell) + '</td>' +
      '<td>' + summaryCell + '</td>' +
      '<td>' + buildWarningBadge(item.warnings) + '</td>' +
      '</tr>';
    const detailRow = '<tr class="rpt-detail-row"><td colspan="10"><details><summary>詳細</summary>' +
      buildItemDetail(item) + '</details></td></tr>';
    return mainRow + '\n' + detailRow;
  }

  function buildReasonBlock(reason) {
    const items = asArray(reason.items);
    const parts = [];
    parts.push(
      '<h3>理由' + escapeHtml(String(reason.reasonNumber)) + '（' + escapeHtml(reason.categoryLabel || '') + '）' +
      (reason.legalBasis ? ' - ' + escapeHtml(reason.legalBasis) : '') + '</h3>'
    );
    if (items.length === 0) {
      parts.push('<p class="rpt-empty">項目なし</p>');
      return parts.join('\n');
    }
    parts.push('<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>' +
      '<th>No.</th><th>見出し請求項</th><th>問題となる記載</th><th>直接指摘</th><th>同様指摘</th>' +
      '<th>引用元</th><th>引用による指摘</th><th>最終指摘</th><th>問題の要約</th><th>警告</th>' +
      '</tr></thead><tbody>');
    for (const item of items) parts.push(buildItemRow(item));
    parts.push('</tbody></table></div>');
    return parts.join('\n');
  }

  function buildCategorySection(label, categoryKey, reasons) {
    const matched = asArray(reasons).filter((r) => r.category === categoryKey);
    const parts = ['<section class="rpt-category"><h2>' + escapeHtml(label) + '</h2>'];
    if (matched.length === 0) {
      parts.push('<p class="rpt-empty">該当なし</p>');
    } else {
      for (const reason of matched) parts.push(buildReasonBlock(reason));
    }
    parts.push('</section>');
    return parts.join('\n');
  }

  function buildReferenceListTable(references) {
    const rows = asArray(references).map((ref) =>
      '<tr><td>' + escapeHtml(ref.number != null ? String(ref.number) : '') + '</td>' +
      '<td>' + escapeHtml(ref.name || '') + '</td>' +
      '<td>' + (ref.matched
        ? '対応済み'
        : '<span class="rpt-badge rpt-badge-yellow">未対応</span>') + '</td></tr>'
    ).join('\n');
    return '<div class="rpt-table-wrap"><table class="rpt-table">' +
      '<caption>引用文献一覧</caption>' +
      '<thead><tr><th>番号</th><th>名称</th><th>対応</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function buildMappingDetail(mapping) {
    const parts = [];
    parts.push(
      '<div class="rpt-detail-block"><h4>原文全文</h4><pre class="rpt-pre">' +
      escapeHtml(mapping.sourceText || '') + '</pre></div>'
    );
    parts.push(
      '<div class="rpt-detail-block"><h4>確度</h4><p>' + escapeHtml(mapping.confidence || '') + '</p></div>'
    );
    const warnings = asArray(mapping.warnings);
    if (warnings.length > 0) {
      const items = warnings.map((w) => '<li>[' + escapeHtml(w.severity || '') + '] ' + escapeHtml(w.message || '') + '</li>');
      parts.push('<div class="rpt-detail-block"><h4>警告</h4><ul>' + items.join('') + '</ul></div>');
    }
    return parts.join('\n');
  }

  function buildMappingRow(mapping) {
    const referenceNames = asArray(mapping.referenceNames).map((n) => n || '(不明)').join('、');
    const mainRow = '<tr>' +
      '<td>' + escapeHtml(mapping.claimsRaw || compressClaimNumbers(mapping.claims)) + '</td>' +
      '<td>' + escapeHtml(mapping.referenceNumbersRaw || compressClaimNumbers(mapping.referenceNumbers)) + '</td>' +
      '<td>' + escapeHtml(referenceNames) + '</td>' +
      '<td>' + escapeHtml(mapping.application || '') + '</td>' +
      '<td>' + escapeHtml(mapping.remarks || '') + '</td>' +
      '<td>' + buildWarningBadge(mapping.warnings) + '</td>' +
      '</tr>';
    const detailRow = '<tr class="rpt-detail-row"><td colspan="6"><details><summary>詳細</summary>' +
      buildMappingDetail(mapping) + '</details></td></tr>';
    return mainRow + '\n' + detailRow;
  }

  function buildMappingTable(mappings) {
    const parts = ['<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>' +
      '<th>請求項</th><th>引用文献番号</th><th>引用文献名</th><th>適用関係</th><th>備考</th><th>警告</th>' +
      '</tr></thead><tbody>'];
    for (const mapping of mappings) parts.push(buildMappingRow(mapping));
    parts.push('</tbody></table></div>');
    return parts.join('\n');
  }

  const ARTICLE29_GROUPS = [
    ['novelty', '新規性'],
    ['inventiveStep', '進歩性'],
    ['article29-unknown', '29条系（区分不明）'],
  ];

  function buildArticle29Section(novelty) {
    const references = asArray(novelty && novelty.references);
    const mappings = asArray(novelty && novelty.mappings);
    const parts = ['<section class="rpt-category"><h2>29条系（新規性・進歩性）</h2>'];
    if (references.length === 0 && mappings.length === 0) {
      parts.push('<p class="rpt-empty">該当なし</p></section>');
      return parts.join('\n');
    }
    if (references.length > 0) parts.push(buildReferenceListTable(references));
    for (const [key, label] of ARTICLE29_GROUPS) {
      const matched = mappings.filter((m) => m.subCategory === key);
      parts.push('<h3>' + escapeHtml(label) + '</h3>');
      parts.push(matched.length === 0
        ? '<p class="rpt-empty">該当なし</p>'
        : buildMappingTable(matched));
    }
    parts.push('</section>');
    return parts.join('\n');
  }

  // ---- 請求項構造 ----

  const DEPENDENCY_TYPE_LABEL = { single: '単独', selective: '選択的', cumulative: '累積的' };

  function buildClaimRow(claim) {
    const typeBadge = claim.type === 'independent'
      ? '<span class="rpt-badge rpt-badge-blue">独立</span>'
      : '<span class="rpt-badge rpt-badge-gray">従属</span>';
    const typeLabel = claim.dependencyType ? (DEPENDENCY_TYPE_LABEL[claim.dependencyType] || claim.dependencyType) : '—';
    return '<tr>' +
      '<td><details><summary>' + escapeHtml(String(claim.claimNumber)) + '</summary>' +
      '<pre class="rpt-pre">' + escapeHtml(claim.text || '') + '</pre></details></td>' +
      '<td>' + typeBadge + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(claim.directParents)) + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(claim.allAncestors)) + '</td>' +
      '<td>' + escapeHtml(joinPlain(claim.directChildren)) + '</td>' +
      '<td>' + escapeHtml(joinPlain(claim.allDescendants)) + '</td>' +
      '<td>' + escapeHtml(typeLabel) + '</td>' +
      '<td>' + buildWarningBadge(claim.warnings) + '</td>' +
      '</tr>';
  }

  function buildClaimStructureSection(structure) {
    const parts = ['<section class="rpt-category"><h2>請求項構造</h2>'];
    if (!structure) {
      parts.push('<p class="rpt-empty">該当なし（請求項が未取得です）</p></section>');
      return parts.join('\n');
    }
    const structIssues = asArray(structure.warnings).concat(asArray(structure.crossChecks));
    parts.push(
      '<p class="rpt-meta">総数: ' + escapeHtml(String(structure.totalClaimCount)) +
      ' ／ 独立請求項: ' + escapeHtml(joinPlain(structure.independentClaims) || 'なし') +
      ' ／ 取得元: ' + escapeHtml(structure.sourceLabel || structure.source || '不明') +
      ' ／ 構造警告: ' + structIssues.length + '件</p>'
    );
    if (structIssues.length > 0) {
      const items = structIssues.map((w) =>
        '<li>' + buildWarningBadge([w]) + ' ' + escapeHtml(w.message) + '</li>'
      );
      parts.push('<div class="rpt-detail-block"><ul>' + items.join('') + '</ul></div>');
    }
    parts.push('<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>' +
      '<th>請求項</th><th>種別</th><th>直接引用元</th><th>全引用元</th>' +
      '<th>直接下位</th><th>全下位</th><th>引用種別</th><th>警告</th>' +
      '</tr></thead><tbody>');
    for (const claim of asArray(structure.claims)) parts.push(buildClaimRow(claim));
    parts.push('</tbody></table></div>');
    parts.push('</section>');
    return parts.join('\n');
  }

  // ---- 整合性チェック ----

  function buildConsistencyDetail(result, check) {
    const item = findSourceItem(result, check.reasonNumber, check.itemNumber);
    const directClaims = item ? item.directClaims : [];
    const sameIssueClaims = item ? item.sameIssueClaims : [];
    const citedInfluence = item ? unionClaims(...asArray(item.dependencyRelations).map((d) => d.affectedClaims)) : [];
    const rows = [
      ['見出し請求項', compressClaimNumbers(check.headingClaims)],
      ['修正後見出し請求項', compressClaimNumbers(check.effectiveHeadingClaims)],
      ['直接指摘請求項', compressClaimNumbers(directClaims)],
      ['同様指摘請求項', compressClaimNumbers(sameIssueClaims)],
      ['引用による指摘請求項', compressClaimNumbers(citedInfluence)],
      ['本文上の指摘集合', compressClaimNumbers(check.bodyAffectedClaims)],
      ['結論請求項', compressClaimNumbers(check.finalClaims)],
      ['クレーム構造上の承継候補', compressClaimNumbers(check.inheritedCandidates)],
      ['指摘漏れ候補', compressClaimNumbers(check.omittedClaims)],
    ];
    const trs = rows.map(([k, v]) =>
      '<tr><th>' + escapeHtml(k) + '</th><td>' + escapeHtml(v || 'なし') + '</td></tr>'
    ).join('');
    const parts = [];
    parts.push('<div class="rpt-detail-block"><h4>請求項の比較（§8）</h4>' +
      '<div class="rpt-table-wrap"><table class="rpt-table">' + trs + '</table></div></div>');
    const issues = asArray(check.issues);
    if (issues.length > 0) {
      const items = issues.map((i) =>
        '<li>[' + escapeHtml(severityLabel(i.severity)) + '] ' + escapeHtml(i.text) + '</li>'
      );
      parts.push('<div class="rpt-detail-block"><h4>検出された不整合</h4><ul>' + items.join('') + '</ul></div>');
    }
    return parts.join('\n');
  }

  function buildConsistencyRow(result, check, index) {
    const headingRaw = compressClaimNumbers(check.headingClaims);
    const headingFixed = compressClaimNumbers(check.effectiveHeadingClaims);
    const headingCell = headingRaw !== headingFixed
      ? escapeHtml(headingFixed) + '<br><span class="rpt-sub">原文: ' + escapeHtml(headingRaw) + '</span>'
      : escapeHtml(headingFixed);
    const statusLabel = STATUS_LABEL[check.status] || check.status || '';
    const statusCls = check.status === 'error' ? 'rpt-badge-red'
      : (check.status === 'warning' ? 'rpt-badge-yellow' : 'rpt-badge-green');
    const issues = asArray(check.issues);
    const errorCell = issues.length > 0
      ? '<span class="rpt-badge ' + (issues.some((i) => i.severity === 'error') ? 'rpt-badge-red' : 'rpt-badge-yellow') +
        '">' + issues.length + '件</span>'
      : '';
    const mainRow = '<tr>' +
      '<td>' + (index + 1) + '</td>' +
      '<td>理由' + escapeHtml(String(check.reasonNumber)) + ' 項目' + escapeHtml(String(check.itemNumber)) +
        '（' + escapeHtml(check.categoryLabel || '') + '）</td>' +
      '<td>' + headingCell + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(check.bodyAffectedClaims)) + '</td>' +
      '<td>' + escapeHtml(compressClaimNumbers(check.finalClaims)) + '</td>' +
      '<td><span class="rpt-badge ' + statusCls + '">' + escapeHtml(statusLabel) + '</span></td>' +
      '<td>' + escapeHtml(buildDiffSummary(check)) + '</td>' +
      '<td>' + errorCell + '</td>' +
      '</tr>';
    const detailRow = '<tr class="rpt-detail-row"><td colspan="8"><details><summary>詳細</summary>' +
      buildConsistencyDetail(result, check) + '</details></td></tr>';
    return mainRow + '\n' + detailRow;
  }

  function buildConsistencySection(result) {
    const checks = asArray(result.consistencyChecks);
    const parts = ['<section class="rpt-category"><h2>整合性チェック</h2>'];
    if (checks.length === 0) {
      parts.push('<p class="rpt-empty">該当なし</p></section>');
      return parts.join('\n');
    }
    parts.push('<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>' +
      '<th>No.</th><th>理由</th><th>見出し</th><th>本文上の対象</th><th>結論</th>' +
      '<th>一致判定</th><th>差分</th><th>エラー</th></tr></thead><tbody>');
    checks.forEach((check, index) => parts.push(buildConsistencyRow(result, check, index)));
    parts.push('</tbody></table></div></section>');
    return parts.join('\n');
  }

  // ---- 指摘漏れ候補 ----

  function buildOmittedRow(candidate) {
    const coveredBadge = candidate.coveredElsewhereInReason
      ? '<span class="rpt-badge rpt-badge-blue">他項目で指摘済</span>' : '';
    return '<tr>' +
      '<td>理由' + escapeHtml(String(candidate.reasonNumber)) + ' 項目' + escapeHtml(String(candidate.itemNumber)) +
        '（' + escapeHtml(candidate.categoryLabel || '') + '）</td>' +
      '<td>' + escapeHtml(String(candidate.sourceClaim)) + '</td>' +
      '<td>' + escapeHtml(String(candidate.omittedClaim)) + ' ' + coveredBadge + '</td>' +
      '<td>' + escapeHtml(candidate.dependencyPathText || '') + '</td>' +
      '<td><span class="rpt-badge ' + severityBadgeClass(candidate.severity) + '">' +
        escapeHtml(severityLabel(candidate.severity)) + '</span></td>' +
      '<td>' + escapeHtml(candidate.basis || '') + '</td>' +
      '</tr>';
  }

  function buildOmittedSection(candidates) {
    const list = asArray(candidates);
    const parts = ['<section class="rpt-category"><h2>指摘漏れ候補</h2>'];
    if (list.length === 0) {
      parts.push('<p class="rpt-empty">指摘漏れ候補は検出されませんでした。</p></section>');
      return parts.join('\n');
    }
    parts.push('<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>' +
      '<th>理由項目</th><th>問題請求項</th><th>漏れている可能性のある請求項</th>' +
      '<th>引用経路</th><th>判定</th><th>根拠</th></tr></thead><tbody>');
    for (const candidate of list) parts.push(buildOmittedRow(candidate));
    parts.push('</tbody></table></div></section>');
    return parts.join('\n');
  }

  // 文書全体・理由・項目・29条マッピングの警告を「箇所」ラベル付きでフラット化する
  function collectAllWarnings(result) {
    const res = result || {};
    const metadata = res.metadata || {};
    const out = [];
    for (const w of asArray(metadata.warnings)) {
      out.push({ location: '文書全体', code: w.code, message: w.message, severity: w.severity });
    }
    for (const reason of asArray(res.reasons)) {
      for (const w of asArray(reason.warnings)) {
        out.push({ location: '理由' + reason.reasonNumber, code: w.code, message: w.message, severity: w.severity });
      }
      for (const item of asArray(reason.items)) {
        for (const w of asArray(item.warnings)) {
          out.push({
            location: '理由' + reason.reasonNumber + ' 項目' + item.itemNumber,
            code: w.code, message: w.message, severity: w.severity,
          });
        }
      }
    }
    const mappings = asArray(res.noveltyInventiveStep && res.noveltyInventiveStep.mappings);
    for (const m of mappings) {
      for (const w of asArray(m.warnings)) {
        out.push({
          location: '理由' + m.reasonNumber + ' ' + (m.subCategoryLabel || '29条系'),
          code: w.code, message: w.message, severity: w.severity,
        });
      }
    }
    return out;
  }

  function buildWarningsSection(allWarnings) {
    const parts = ['<section class="rpt-warnings"><h2>警告一覧</h2>'];
    if (allWarnings.length === 0) {
      parts.push('<p class="rpt-empty">該当なし</p></section>');
      return parts.join('\n');
    }
    parts.push('<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>' +
      '<th>箇所</th><th>コード</th><th>重大度</th><th>内容</th></tr></thead><tbody>');
    for (const w of allWarnings) {
      parts.push(
        '<tr><td>' + escapeHtml(w.location) + '</td><td>' + escapeHtml(w.code || '') + '</td>' +
        '<td>' + escapeHtml(w.severity || '') + '</td><td>' + escapeHtml(w.message || '') + '</td></tr>'
      );
    }
    parts.push('</tbody></table></div></section>');
    return parts.join('\n');
  }

  function buildUnparsedSection(unparsed) {
    const parts = ['<section class="rpt-unparsed"><h2>未解析原文</h2>'];
    const list = asArray(unparsed);
    if (list.length === 0) {
      parts.push('<p class="rpt-empty">該当なし</p></section>');
      return parts.join('\n');
    }
    for (const u of list) {
      parts.push(
        '<div class="rpt-detail-block"><p class="rpt-sub">' + escapeHtml(u.location || '') +
        (u.note ? '（' + escapeHtml(u.note) + '）' : '') + '</p>' +
        '<pre class="rpt-pre">' + escapeHtml(u.text || '') + '</pre></div>'
      );
    }
    parts.push('</section>');
    return parts.join('\n');
  }

  function buildSummarySection(result) {
    const res = result || {};
    const metadata = res.metadata || {};
    const claimStats = metadata.claimStats || {};
    const reasons = asArray(res.reasons);
    const clarityCount = reasons.filter((r) => r.category === 'clarity')
      .reduce((n, r) => n + asArray(r.items).length, 0);
    const supportCount = reasons.filter((r) => r.category === 'support')
      .reduce((n, r) => n + asArray(r.items).length, 0);
    const article29Count = asArray(res.noveltyInventiveStep && res.noveltyInventiveStep.mappings).length;
    const warningsCount = collectAllWarnings(res).length;
    const issueCounts = metadata.issueCounts || { error: 0, warning: 0, info: 0 };
    const totalClaimCountSourceLabel = {
      claimStructure: '特許請求の範囲から取得',
      manual: '手動設定',
      estimated: '本文からの推定',
    }[claimStats.totalClaimCountSource] || '';
    const rows = [
      ['理由数', String(metadata.totalReasonCount != null ? metadata.totalReasonCount : reasons.length)],
      ['明確性 件数', String(clarityCount)],
      ['サポート要件 件数', String(supportCount)],
      ['29条系 件数', String(article29Count)],
      ['警告件数', String(warningsCount)],
      ['エラー件数（整合性チェック）', String(issueCounts.error || 0)],
      ['警告件数（整合性チェック）', String(issueCounts.warning || 0)],
      ['情報件数（整合性チェック）', String(issueCounts.info || 0)],
      ['全請求項数', String(claimStats.totalClaimCount != null ? claimStats.totalClaimCount : '') +
        (totalClaimCountSourceLabel ? '（' + totalClaimCountSourceLabel + '）' : '')],
      ['最終指摘された請求項', compressClaimNumbers(claimStats.allFinalClaims) || 'なし'],
      ['未指摘の請求項', compressClaimNumbers(claimStats.unflaggedClaims) || 'なし'],
    ];
    const trs = rows.map(([k, v]) =>
      '<tr><th>' + escapeHtml(k) + '</th><td>' + escapeHtml(v) + '</td></tr>'
    ).join('\n');
    return '<section class="rpt-summary"><h2>サマリ</h2>' +
      '<div class="rpt-table-wrap"><table class="rpt-table">' + trs + '</table></div></section>';
  }

  function buildHeaderSection(title, analyzedAt, warningCount) {
    return [
      '<header class="rpt-header">',
      '<h1>' + escapeHtml(title) + '</h1>',
      '<p class="rpt-meta">解析日時: ' + escapeHtml(analyzedAt || '不明') + ' ／ 警告件数: ' + warningCount + '</p>',
      '</header>',
    ].join('\n');
  }

  // 完全な HTML 文書を返す（<script> ・ on* 属性・javascript: URL を一切含まない）
  function build(result, options) {
    const opts = options || {};
    const res = result || {};
    const metadata = res.metadata || {};
    const title = opts.title || '拒絶理由分析レポート';
    const allWarnings = collectAllWarnings(res);

    const parts = [];
    parts.push('<!doctype html>');
    parts.push('<html lang="ja">');
    parts.push('<head>');
    parts.push('<meta charset="utf-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    parts.push('<title>' + escapeHtml(title) + '</title>');
    parts.push('<style>' + REPORT_STYLE + '</style>');
    parts.push('</head>');
    parts.push('<body>');
    parts.push(buildHeaderSection(title, metadata.analyzedAt, allWarnings.length));
    parts.push(buildSummarySection(res));
    parts.push(buildCategorySection('明確性', 'clarity', res.reasons));
    parts.push(buildCategorySection('サポート要件', 'support', res.reasons));
    parts.push(buildArticle29Section(res.noveltyInventiveStep));
    parts.push(buildCategorySection('その他', 'other', res.reasons));
    parts.push(buildClaimStructureSection(res.claimStructure));
    parts.push(buildConsistencySection(res));
    parts.push(buildOmittedSection(res.omittedClaimCandidates));
    parts.push(buildWarningsSection(allWarnings));
    parts.push(buildUnparsedSection(res.unparsedSections));
    parts.push('</body>');
    parts.push('</html>');
    return parts.join('\n');
  }

  return {
    build,
    buildCsv,
    buildTsv,
    CSV_COLUMNS,
    CONSISTENCY_COLUMNS,
    OMITTED_COLUMNS,
    escapeHtml,
    compressClaimNumbers,
  };
});
