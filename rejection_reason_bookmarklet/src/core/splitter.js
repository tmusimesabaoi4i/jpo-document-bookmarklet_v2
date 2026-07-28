/*
 * splitter.js — 理由分割・理由分類・指摘項目分割（DOM非依存の純粋モジュール）
 *
 * 理由の分類は次の優先順位で決める（本文の結論文との照合は項目単位で validator が行う）:
 *   1. ●理由Ｘ（理由名）について の見出し
 *   2. 冒頭の理由一覧（１．（明確性）この出願は、…）
 *   3. 法条（特許法第36条第6項第2号 等）
 * 下位の情報が上位と矛盾しても分類は変えず、警告として報告する。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'), require('./claims'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.splitter = factory(root.RRB.normalizer, root.RRB.claims);
  }
})(globalThis, function (normalizer, claims) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  const CATEGORY_LABELS = {
    clarity: '明確性',
    support: 'サポート要件',
    novelty: '新規性',
    inventiveStep: '進歩性',
    other: 'その他',
  };

  // 理由名（見出し・冒頭一覧のラベル）→ カテゴリ
  function categoryFromLabel(label) {
    if (label == null) return null;
    const s = String(label);
    if (s.indexOf('明確性') !== -1) return 'clarity';
    if (s.indexOf('サポート要件') !== -1) return 'support';
    if (s.indexOf('新規性') !== -1) return 'novelty';
    if (s.indexOf('進歩性') !== -1) return 'inventiveStep';
    return null;
  }

  // 法条の記載を解析する。matchText（半角数字）上で照合すること。
  // 例: 特許法第36条第6項第2号 / 特許法第29条第1項第3号 / 特許法第29条第2項 / 特許法第29条の2
  const ARTICLE_RE = /特許法第(\d+)条(?:の(\d+))?(?:第(\d+)項)?(?:第(\d+)号)?/;

  function parseArticle(matchText) {
    const m = ARTICLE_RE.exec(String(matchText == null ? '' : matchText));
    if (!m) return null;
    return {
      raw: m[0],
      article: parseInt(m[1], 10),
      branch: m[2] ? parseInt(m[2], 10) : null,   // 「29条の2」の 2
      paragraph: m[3] ? parseInt(m[3], 10) : null,
      item: m[4] ? parseInt(m[4], 10) : null,
    };
  }

  // 法条 → カテゴリ
  function categoryFromArticle(article) {
    if (!article) return null;
    if (article.article === 36 && article.paragraph === 6 && article.item === 2) return 'clarity';
    if (article.article === 36 && article.paragraph === 6 && article.item === 1) return 'support';
    if (article.article === 29 && article.branch == null && article.paragraph === 1) return 'novelty';
    if (article.article === 29 && article.branch == null && article.paragraph === 2) return 'inventiveStep';
    return null;
  }

  // 結論文の表現 → カテゴリ系統（validator が見出しとの不一致検出に使う）
  function categoryFromConclusion(sentence) {
    if (sentence == null) return null;
    const s = String(sentence);
    if (/明確でない|不明確/.test(s)) return 'clarity';
    if (s.indexOf('発明の詳細な説明に記載したものでない') !== -1) return 'support';
    if (s.indexOf('特許を受けることができない') !== -1) return 'article29';
    return 'unknown';
  }

  // 行単位で走査するためのユーティリティ（各行の先頭オフセットを持つ）
  function toLines(text) {
    const lines = String(text).split('\n');
    const result = [];
    let pos = 0;
    for (const line of lines) {
      result.push({ text: line, start: pos, end: pos + line.length });
      pos += line.length + 1;
    }
    return result;
  }

  // 冒頭の理由一覧（「記」より前の「１．（明確性）この出願は、…」）を解析する
  function parseLeadingReasonList(matchBody, rawBody) {
    const match = String(matchBody == null ? '' : matchBody);
    const raw = String(rawBody == null ? match : rawBody);
    // ※ 行頭アンカー付きの正規表現では [ \t　]（行内空白のみ）を使う。
    //    \s は改行も含むため、^\s* が前の空行まで遡ってマッチ位置を狂わせる
    const kiM = /^[ \t　]*記[ \t　]*$/m.exec(match);
    const regionEnd = kiM ? kiM.index : match.length;
    const lines = toLines(match.slice(0, regionEnd));
    // 一覧エントリの開始行: 「１．（明確性）…」（番号＋句点＋丸括弧ラベル）
    const entryRe = /^[ \t　]*(\d+)[．.][ \t　]*（([^）]+)）/d;
    const starts = [];
    for (const line of lines) {
      const m = entryRe.exec(line.text);
      if (m) starts.push({ line, m });
    }
    const items = [];
    for (let i = 0; i < starts.length; i++) {
      const { line, m } = starts[i];
      const entryStart = line.start;
      const entryEnd = i + 1 < starts.length ? starts[i + 1].line.start : regionEnd;
      const entryMatch = match.slice(entryStart, entryEnd);
      const labelRange = m.indices[2];
      const label = raw.slice(entryStart + labelRange[0], entryStart + labelRange[1]);
      const article = parseArticle(entryMatch);
      items.push({
        num: parseInt(m[1], 10),
        label,
        category: categoryFromLabel(label) || (categoryFromArticle(article) || 'other'),
        legalBasis: article ? article.raw : null,
        article,
        raw: raw.slice(entryStart, entryEnd).trim(),
      });
    }
    return items;
  }

  // 「●理由Ｘ（理由名）について」見出しで理由単位に分割する。
  // 見出しが無い場合は全体を 1 セクションとして返す（headingLabel: null）。
  function splitReasonSections(rawBody, matchBody) {
    const match = String(matchBody == null ? '' : matchBody);
    const raw = String(rawBody == null ? match : rawBody);
    // 理由見出し: ●理由１（明確性）について（「について」は省略も許容）
    const headingRe = /^[ \t　]*●[ \t　]*理由[ \t　]*(\d+)[ \t　]*(?:（([^）]+)）)?[ \t　]*(?:について)?.*$/gmd;
    const headings = [];
    let m;
    while ((m = headingRe.exec(match)) !== null) {
      headings.push({
        index: m.index,
        lineEnd: m.index + m[0].length,
        reasonNumber: parseInt(m[1], 10),
        labelRange: m[2] !== undefined ? m.indices[2] : null,
        headingRaw: raw.slice(m.index, m.index + m[0].length).trim(),
      });
    }
    if (headings.length === 0) {
      // 見出しなし: 「記」以降（あれば）を単一セクションとする
      const kiM = /^[ \t　]*記[ \t　]*$/m.exec(match);
      const bodyStart = kiM ? kiM.index + kiM[0].length + 1 : 0;
      return {
        preambleRaw: raw.slice(0, bodyStart),
        preambleMatch: match.slice(0, bodyStart),
        sections: [{
          reasonNumber: null,
          headingLabel: null,
          headingRaw: null,
          rawText: raw.slice(bodyStart),
          matchText: match.slice(bodyStart),
        }],
      };
    }
    const sections = [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const end = i + 1 < headings.length ? headings[i + 1].index : match.length;
      sections.push({
        reasonNumber: h.reasonNumber,
        headingLabel: h.labelRange ? raw.slice(h.labelRange[0], h.labelRange[1]) : null,
        headingRaw: h.headingRaw,
        rawText: raw.slice(h.index, end),
        matchText: match.slice(h.index, end),
      });
    }
    return {
      preambleRaw: raw.slice(0, headings[0].index),
      preambleMatch: match.slice(0, headings[0].index),
      sections,
    };
  }

  // 理由を分類する。優先順位: 見出しラベル > 冒頭一覧 > 法条。
  // 下位情報の矛盾は警告のみ（分類は変えない）。
  function classifyReason(section, leadingList) {
    const warnings = [];
    const headingCat = categoryFromLabel(section.headingLabel);
    let listItem = null;
    if (leadingList && leadingList.length > 0) {
      listItem = leadingList.find((it) => it.num === section.reasonNumber) || null;
      if (!listItem && section.headingLabel) {
        listItem = leadingList.find((it) => it.label === section.headingLabel) || null;
      }
    }
    const listCat = listItem ? listItem.category : null;
    const sectionArticle = parseArticle(section.matchText);
    const articleCat = categoryFromArticle(listItem ? listItem.article : sectionArticle);

    const category = headingCat || listCat || articleCat || 'other';
    let categoryLabel = CATEGORY_LABELS[category];
    if (category === 'other' && section.headingLabel) categoryLabel = section.headingLabel;

    if (headingCat && listCat && headingCat !== listCat) {
      warnings.push(makeWarning('REASON_LIST_MISMATCH',
        '理由見出し「' + section.headingLabel + '」と冒頭の理由一覧の区分が一致しません。原文を確認してください。'));
    }
    let legalBasis = listItem ? listItem.legalBasis : null;
    if (!legalBasis && sectionArticle) legalBasis = sectionArticle.raw;

    let confidence;
    if (headingCat && (!listCat || listCat === headingCat)) confidence = 'high';
    else if (headingCat || listCat || articleCat) confidence = 'medium';
    else {
      confidence = 'low';
      warnings.push(makeWarning('NO_CATEGORY',
        '理由の区分を特定できませんでした（見出し・理由一覧・法条のいずれも判別不能）。', 'warn'));
    }
    return { category, categoryLabel, legalBasis, confidence, warnings };
  }

  // 指摘項目境界: ・請求項 で始まる行。29条系の ・引用文献等 / ・備考 は同一項目の
  // 構成要素なので境界にしない。＜引用文献等一覧＞や罫線行は項目の終端とする。
  const BLOCK_START_RE = /^[ \t　]*[・･][ \t　]*請求項/;
  const LIST_HEADING_RE = /^[ \t　]*[＜<]?[ \t　]*引[ \t　]*用[ \t　]*文[ \t　]*献[ \t　]*等?[ \t　]*一[ \t　]*覧[ \t　]*[＞>]?[ \t　]*$/;
  const RULED_LINE_RE = /^[ \t　]*[-ー─━]{8,}[ \t　]*$/;

  // 理由セクション内を指摘項目（ブロック）へ分割する。
  // 戻り値: { preamble, blocks: [BLOCK], trailing }
  //   preamble … 見出し行と最初のブロックの間のテキスト（29条系では説明文などが入る）
  //   trailing … ＜引用文献等一覧＞・罫線以降のテキスト（引用文献一覧の解析は article29 が行う）
  function splitIssueBlocks(section) {
    const match = section.matchText;
    const raw = section.rawText;
    const lines = toLines(match);
    // 見出し行（●理由…）はブロック走査から除く
    let scanStartLine = 0;
    if (section.headingRaw !== null && lines.length > 0 && /^[ \t　]*●/.test(lines[0].text)) {
      scanStartLine = 1;
    }
    const blockStarts = [];
    let terminator = null;   // ＜引用文献等一覧＞または罫線の行頭オフセット
    for (let i = scanStartLine; i < lines.length; i++) {
      const line = lines[i];
      if (terminator === null && (LIST_HEADING_RE.test(line.text) || RULED_LINE_RE.test(line.text))) {
        terminator = line.start;
        break;
      }
      if (BLOCK_START_RE.test(line.text)) blockStarts.push(line);
    }
    const bodyEnd = terminator === null ? match.length : terminator;
    const preambleStart = scanStartLine < lines.length ? lines[scanStartLine].start : match.length;
    const preambleEnd = blockStarts.length > 0 ? blockStarts[0].start : bodyEnd;
    const blocks = [];
    for (let i = 0; i < blockStarts.length; i++) {
      const start = blockStarts[i].start;
      const end = i + 1 < blockStarts.length ? blockStarts[i + 1].start : bodyEnd;
      blocks.push({
        headingLineRaw: raw.slice(blockStarts[i].start, blockStarts[i].end),
        headingLineMatch: match.slice(blockStarts[i].start, blockStarts[i].end),
        rawText: raw.slice(start, end),
        matchText: match.slice(start, end),
      });
    }
    return {
      preamble: {
        rawText: raw.slice(preambleStart, preambleEnd),
        matchText: match.slice(preambleStart, preambleEnd),
      },
      blocks,
      trailing: terminator === null ? null : {
        rawText: raw.slice(terminator),
        matchText: match.slice(terminator),
      },
    };
  }

  return {
    CATEGORY_LABELS,
    categoryFromLabel,
    categoryFromArticle,
    categoryFromConclusion,
    parseArticle,
    parseLeadingReasonList,
    splitReasonSections,
    classifyReason,
    splitIssueBlocks,
  };
});
