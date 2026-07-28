/*
 * このファイルは自動生成です — 直接編集しないでください (DO NOT EDIT)。
 * 生成元: src/core/*.js + src/bookmarklet/common/*.js
 * 再生成: npm run build:bookmarklets
 */
(function () {
var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */
try {
/*
 * normalizer.js — テキスト正規化と非拒絶理由部の除去（DOM非依存の純粋モジュール）
 *
 * 原文の完全保存のため「raw / match の対」方式を採る:
 *   rawText   … 改行正規化のみの原文。表示・sourceText・かぎ括弧内文言はここからスライスする
 *   matchText … rawText と同じ長さの照合用文字列（全角数字→半角、ダッシュ類→'-' 等、1:1置換のみ）
 * 長さが等しいためオフセットを共有でき、matchText でのマッチ位置で rawText を
 * スライスすれば元の表記を失わずに抽出できる。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.normalizer = factory();
  }
})(globalThis, function () {
  'use strict';

  // CRLF / CR → LF（これが rawText の基準形。以後の長さ計算はすべてこの形が前提）
  function normalizeLineEndings(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }

  function toHalfWidthDigits(text) {
    return String(text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  }

  // rawText と同じ長さの照合用文字列を作る（1:1 置換のみ行い、長さを変えない）。
  //   全角数字 → 半角 ／ ダッシュ・チルダ類（－ ‐ ‑ ‒ – — ― ～ 〜）→ '-'
  //   ，→ 、 ／ ：→ :
  // カタカナ長音「ー」は語中に現れるため変換しない（罫線判定側でケアする）。
  function normalizeForMatching(rawText) {
    return toHalfWidthDigits(String(rawText))
      .replace(/[－‐‑‒–—―～〜]/g, '-')
      .replace(/，/g, '、')
      .replace(/：/g, ':');
  }

  // 罫線行（－－－… 等。matchText では大半が '-' に潰れている）。
  // 行単位で照合するため行内空白 [ \t　] のみ許容する
  const RULED_LINE_RE = /^[ \t　]*[-ー─━]{8,}[ \t　]*$/;

  // 拒絶理由を構成しない末尾部分の開始位置を matchText 上で探す。
  // 優先順位はどれが先に現れるかで決める（最も早い開始位置を採用）:
  //   a) 罫線行の直後数行以内に「先行技術文献調査結果の記録」がある → 罫線行から
  //   b) 「＜先行技術文献調査結果の記録＞」の行から
  //   c) 「この拒絶理由通知の内容に関するお問合せ…」の連絡ブロックの行から
  // ＜引用文献等一覧＞は拒絶理由の一部なので、ここでは決して切らない。
  function findNonReasonStart(matchText) {
    const lines = matchText.split('\n');
    const offsets = [];
    let pos = 0;
    for (const line of lines) {
      offsets.push(pos);
      pos += line.length + 1;
    }
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (RULED_LINE_RE.test(line)) {
        for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
          if (lines[j].indexOf('先行技術文献調査結果の記録') !== -1 ||
              lines[j].indexOf('拒絶理由を構成するものではありません') !== -1) {
            candidates.push({ index: offsets[i], kind: 'surveyRecord' });
            break;
          }
        }
      }
      if (line.indexOf('先行技術文献調査結果の記録') !== -1) {
        candidates.push({ index: offsets[i], kind: 'surveyRecord' });
      }
      if (line.indexOf('お問合せ') !== -1 &&
          (line.indexOf('拒絶理由通知') !== -1 || line.indexOf('面接') !== -1)) {
        candidates.push({ index: offsets[i], kind: 'contact' });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.index - b.index);
    return candidates[0];
  }

  // 非拒絶理由部（調査結果の記録・問合せ/審査官連絡ブロック）を末尾から除去する。
  // 除去した本文は保持しない（仕様）。removedNote に何を除去したかの注記だけ残す。
  function removeNonReasonSections(rawText) {
    const raw = normalizeLineEndings(rawText);
    const match = normalizeForMatching(raw);
    const found = findNonReasonStart(match);
    if (found === null) {
      return { body: raw, matchBody: match, removedNote: null };
    }
    const note = found.kind === 'surveyRecord'
      ? '先行技術文献調査結果の記録および連絡先の記載を解析対象から除外しました。'
      : '問合せ・連絡先の記載を解析対象から除外しました。';
    return {
      body: raw.slice(0, found.index),
      matchBody: match.slice(0, found.index),
      removedNote: note,
    };
  }

  return {
    normalizeLineEndings,
    toHalfWidthDigits,
    normalizeForMatching,
    removeNonReasonSections,
  };
});

/*
 * claims.js — 請求項番号式の解析・圧縮表示・修正注記（DOM非依存の純粋モジュール）
 *
 * 請求項番号式（EXPR）の文法:
 *   ATOM := 数値 | 数値 (- | ないし) 数値        … 範囲
 *   EXPR := ATOM ((、 | 及び) ATOM)*             … 列挙
 * 表記揺れ（全角数字・ダッシュ類 8 種・～〜・，）は normalizer.normalizeForMatching が
 * '-' '、' 半角数字へ 1:1 で潰すため、本モジュールは正規化後の形だけを文法として扱う。
 * 内部表現は昇順・重複なしの整数配列。表示は compressClaimNumbers で範囲表記へ戻す。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.claims = factory(root.RRB.normalizer);
  }
})(globalThis, function (normalizer) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  // 請求項番号式（正規化後）。\s は U+3000（全角空白）も含む
  const ATOM_SRC = '\\d+(?:\\s*(?:-|ないし)\\s*\\d+)?';
  const EXPR_SRC = ATOM_SRC + '(?:\\s*(?:、|及び)\\s*' + ATOM_SRC + ')*';

  // 文中の「請求項<式>」を検出する共有正規表現（g フラグ・使うたびに新品を返す）
  function claimRefPattern() {
    return new RegExp('請求項\\s*(' + EXPR_SRC + ')', 'g');
  }

  // 請求項番号式を整数配列へ解析する。入力は正規化前の表記でもよい。
  // 戻り値: { ok, claims: number[]（昇順・重複なし）, raw, warnings }
  function parseClaimExpression(expr) {
    const raw = String(expr == null ? '' : expr);
    const norm = normalizer.normalizeForMatching(normalizer.normalizeLineEndings(raw));
    const warnings = [];
    const claims = [];
    // 字句: 数値 / 範囲演算子 / 区切り / 空白 / その他（その他が出たら以降は式ではないとみなす）
    const tokenRe = /(\d+)|(-|ないし)|(、|及び)|(\s+)|([\s\S])/g;
    let pending = null;   // 直前に読んだ数値（範囲起点または単独値の候補）
    let rangeOp = false;  // 範囲演算子を読んだ直後か
    let broken = false;   // 式として解釈できない並びに遭遇したか
    let m;
    while ((m = tokenRe.exec(norm)) !== null) {
      if (m[1] !== undefined) {
        const n = parseInt(m[1], 10);
        if (rangeOp) {
          if (pending === null || n < pending) {
            warnings.push(makeWarning('CLAIM_PARSE_UNCERTAIN', '範囲指定を解釈できません: ' + raw));
            broken = true;
            break;
          }
          if (n - pending > 999) {
            warnings.push(makeWarning('CLAIM_PARSE_UNCERTAIN', '範囲が広すぎます: ' + raw));
            broken = true;
            break;
          }
          for (let k = pending; k <= n; k++) claims.push(k);
          pending = null;
          rangeOp = false;
        } else {
          if (pending !== null) claims.push(pending);
          pending = n;
        }
      } else if (m[2] !== undefined) {
        if (pending === null || rangeOp) {
          warnings.push(makeWarning('CLAIM_PARSE_UNCERTAIN', '範囲演算子の位置を解釈できません: ' + raw));
          broken = true;
          break;
        }
        rangeOp = true;
      } else if (m[3] !== undefined) {
        if (rangeOp) {
          warnings.push(makeWarning('CLAIM_PARSE_UNCERTAIN', '範囲の終端がありません: ' + raw));
          broken = true;
          break;
        }
        if (pending !== null) {
          claims.push(pending);
          pending = null;
        }
      } else if (m[4] !== undefined) {
        // 空白は無視
      } else {
        // 式以外の文字 — ここで打ち切る（末尾ゴミの許容）
        if (rangeOp) {
          warnings.push(makeWarning('CLAIM_PARSE_UNCERTAIN', '範囲の終端がありません: ' + raw));
        }
        break;
      }
    }
    if (!broken && pending !== null && !rangeOp) claims.push(pending);
    if (!broken && rangeOp && pending !== null) claims.push(pending);
    const unique = Array.from(new Set(claims)).sort((a, b) => a - b);
    return { ok: unique.length > 0 && !broken, claims: unique, raw, warnings };
  }

  // 整数配列 → 範囲表記（[2..7] → "2-7"、[3,4,19,20] → "3-4、19-20"）。空配列は ''
  function compressClaimNumbers(nums) {
    const sorted = Array.from(new Set(nums || [])).sort((a, b) => a - b);
    const parts = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      parts.push(j > i ? sorted[i] + '-' + sorted[j] : String(sorted[i]));
      i = j + 1;
    }
    return parts.join('、');
  }

  // 文中の請求項参照を出現順にすべて返す。
  // matchText で照合し、rawText（同じ長さ）から元表記をスライスする。
  // 戻り値: [{ claims, raw（請求項…を含む）, exprRaw（番号式のみ）, index, length }]
  function extractClaimRefs(matchText, rawText) {
    const rawSrc = rawText == null ? String(matchText) : String(rawText);
    const refs = [];
    const re = claimRefPattern();
    let m;
    while ((m = re.exec(matchText)) !== null) {
      const parsed = parseClaimExpression(m[1]);
      if (!parsed.ok) continue;
      const exprStart = m.index + (m[0].length - m[1].length);
      refs.push({
        claims: parsed.claims,
        raw: rawSrc.slice(m.index, m.index + m[0].length),
        exprRaw: rawSrc.slice(exprStart, m.index + m[0].length),
        index: m.index,
        length: m[0].length,
      });
    }
    return refs;
  }

  // 全参照の和集合（昇順・重複なし）
  function unionClaims(arrays) {
    const set = new Set();
    for (const arr of arrays || []) {
      for (const n of arr || []) set.add(n);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  // 修正注記の中身（「修正：５を除く」等）を解析する。
  // 対応形: 修正[：:] <EXPR> を除く ／ 修正[：:] <EXPR> を追加
  function parseCorrectionNote(noteMatch, noteRaw) {
    const raw = String(noteRaw == null ? noteMatch : noteRaw);
    const norm = String(noteMatch == null ? '' : noteMatch);
    const excludeM = norm.match(new RegExp('^修正\\s*:?\\s*(' + EXPR_SRC + ')\\s*を除く$'));
    if (excludeM) {
      const parsed = parseClaimExpression(excludeM[1]);
      return { raw, excluded: parsed.claims, added: [], recognized: parsed.ok };
    }
    const addM = norm.match(new RegExp('^修正\\s*:?\\s*(' + EXPR_SRC + ')\\s*を追加$'));
    if (addM) {
      const parsed = parseClaimExpression(addM[1]);
      return { raw, excluded: [], added: parsed.claims, recognized: parsed.ok };
    }
    return { raw, excluded: [], added: [], recognized: false };
  }

  // 「・請求項 ３-５、１９-２０（修正：５を除く）」形式の見出し行を解析する。
  // 戻り値: { headingClaimsRaw, headingClaims, effectiveHeadingClaims, correctionNote, restRaw, warnings }
  function parseClaimHeading(headingLineRaw) {
    const raw = normalizer.normalizeLineEndings(String(headingLineRaw == null ? '' : headingLineRaw)).split('\n')[0];
    const match = normalizer.normalizeForMatching(raw);
    const warnings = [];
    // 見出し行: ・請求項 <式> （<注記>）? <残り>   ※ d フラグでキャプチャ位置を得て raw をスライス
    const re = new RegExp('^\\s*[・･]?\\s*請求項\\s*(' + EXPR_SRC + ')\\s*(?:（([^）]*)）)?\\s*(.*)$', 'd');
    const m = re.exec(match);
    if (!m) {
      warnings.push(makeWarning('CLAIM_PARSE_UNCERTAIN', '見出し行から請求項番号を抽出できません: ' + raw));
      return {
        headingClaimsRaw: null,
        headingClaims: [],
        effectiveHeadingClaims: [],
        correctionNote: null,
        restRaw: null,
        warnings,
      };
    }
    const exprRange = m.indices[1];
    const headingClaimsRaw = raw.slice(exprRange[0], exprRange[1]);
    const parsed = parseClaimExpression(headingClaimsRaw);
    for (const w of parsed.warnings) warnings.push(w);
    let correctionNote = null;
    let effective = parsed.claims;
    if (m[2] !== undefined) {
      const noteRange = m.indices[2];
      const noteRaw = raw.slice(noteRange[0], noteRange[1]);
      const note = parseCorrectionNote(m[2], noteRaw);
      correctionNote = note;
      if (note.recognized) {
        const excluded = new Set(note.excluded);
        effective = parsed.claims.filter((n) => !excluded.has(n));
        if (note.added.length > 0) effective = unionClaims([effective, note.added]);
      } else {
        warnings.push(makeWarning('UNKNOWN_HEADING_NOTE',
          '見出しの注記を解釈できませんでした（原文のまま保持します）: （' + noteRaw + '）'));
      }
    }
    const restRaw = m[3] ? raw.slice(m.indices[3][0], m.indices[3][1]) : '';
    if (restRaw.trim() !== '') {
      warnings.push(makeWarning('CLAIM_PARSE_UNCERTAIN',
        '見出し行に解釈していない記載があります: ' + restRaw, 'info'));
    }
    return {
      headingClaimsRaw,
      headingClaims: parsed.claims,
      effectiveHeadingClaims: effective,
      correctionNote,
      restRaw: restRaw.trim() === '' ? null : restRaw,
      warnings,
    };
  }

  return {
    EXPR_SRC,
    claimRefPattern,
    parseClaimExpression,
    compressClaimNumbers,
    extractClaimRefs,
    unionClaims,
    parseCorrectionNote,
    parseClaimHeading,
  };
});

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

/*
 * clarity-support.js — 明確性・サポート要件の指摘項目解析（DOM非依存の純粋モジュール）
 *
 * 1 ブロック（・請求項 … で始まる指摘項目）を文単位に分割し、文ごとに
 * 次のパターンを適用して ITEM（docs/specification.md）へ構造化する。
 *
 *   直接指摘:   請求項Ｐを引用する請求項Ｙには…（direct=Y, 引用元=P）
 *               請求項Ｘには… ／ 請求項Ｘに係る発明において…
 *               ※ Ｘが見出し請求項と交わらない場合（例: しかしながら、請求項１には…）は
 *                 直接指摘ではなく比較対象とみなす（接続詞のリストに依存しない汎用規則）
 *   引用文言:   「…」『…』。直前のアンカー（請求項…には／に係る発明において／明細書には）
 *               から役割（問題となる記載・比較対象の記載・明細書の記載）を決める
 *   同様指摘:   請求項Ａにも同様の点が指摘され(る)
 *   引用指摘:   請求項Ｐを引用する請求項Ａにも同様の点が指摘され(る)
 *               ※ 両者は一文に融合されうる（「…指摘され、…指摘される。」）ため、
 *                 引用元プレフィックスを任意項とする単一の正規表現で両対応する
 *   明細書文:   （本願）明細書には…（こと|点）は記載されていない → 要約素材
 *   結論文:     よって、請求項Ｘ…に係る発明は…
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./claims'), require('./splitter'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.claritySupport = factory(root.RRB.claims, root.RRB.splitter);
  }
})(globalThis, function (claims, splitter) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  const EXPR = claims.EXPR_SRC;

  // ---- 文分割 -------------------------------------------------------------

  // 開き括弧 → 閉じ括弧の対応（かぎ括弧内の句点では文を切らない）
  const OPEN_TO_CLOSE = { '「': '」', '『': '』', '（': '）', '〔': '〕' };
  const CLOSERS = { '」': '「', '』': '『', '）': '（', '〕': '〔' };

  // ブロック本文を論理文に分割する。各行の行頭字下げを除去して行を連結し、
  // 括弧深度 0 の「。」で区切る。raw / match は同じ長さのまま並走させる。
  // 戻り値: [{ raw, match, index }]
  function splitSentences(matchText, rawText) {
    const rawSrc = rawText == null ? String(matchText) : String(rawText);
    const matchLines = String(matchText).split('\n');
    const rawLines = rawSrc.split('\n');
    let joinedMatch = '';
    let joinedRaw = '';
    for (let i = 0; i < matchLines.length; i++) {
      // 行頭の字下げ（半角空白・タブ・全角空白）だけを除去する
      const stripped = matchLines[i].replace(/^[ \t　]+/, '');
      const cut = matchLines[i].length - stripped.length;
      joinedMatch += matchLines[i].slice(cut);
      joinedRaw += rawLines[i].slice(cut);
    }
    const sentences = [];
    const stack = [];
    let start = 0;
    for (let i = 0; i < joinedMatch.length; i++) {
      const ch = joinedMatch[i];
      if (OPEN_TO_CLOSE[ch]) {
        stack.push(ch);
      } else if (CLOSERS[ch]) {
        // 対応しない閉じ括弧は無視（深度を 0 未満にしない）
        if (stack.length > 0 && stack[stack.length - 1] === CLOSERS[ch]) stack.pop();
      } else if (ch === '。' && stack.length === 0) {
        sentences.push({
          raw: joinedRaw.slice(start, i + 1),
          match: joinedMatch.slice(start, i + 1),
          index: start,
        });
        start = i + 1;
      }
    }
    if (start < joinedMatch.length && joinedMatch.slice(start).trim() !== '') {
      sentences.push({
        raw: joinedRaw.slice(start),
        match: joinedMatch.slice(start),
        index: start,
      });
    }
    return sentences;
  }

  // ---- かぎ括弧スパン -----------------------------------------------------

  // 文中のトップレベルの「…」『…』スパンを返す（入れ子の内側は外側の一部）。
  // 戻り値: [{ start, end, innerStart, innerEnd }]（end は閉じ括弧の次）
  function scanQuotes(matchSentence) {
    const spans = [];
    const stack = [];
    for (let i = 0; i < matchSentence.length; i++) {
      const ch = matchSentence[i];
      if (ch === '「' || ch === '『') {
        stack.push({ ch, index: i });
      } else if (ch === '」' || ch === '』') {
        const opener = ch === '」' ? '「' : '『';
        if (stack.length > 0 && stack[stack.length - 1].ch === opener) {
          const top = stack.pop();
          if (stack.length === 0) {
            spans.push({ start: top.index, end: i + 1, innerStart: top.index + 1, innerEnd: i });
          }
        }
      }
    }
    return spans;
  }

  // ---- 文単位の抽出器 -----------------------------------------------------

  // 同様指摘・引用関係指摘（融合文対応の単一正規表現）。
  //   （請求項Ｐを引用する）? 請求項Ａ にも同様の点が指摘され
  // 連用形「指摘され、」でも終止形「指摘される。」でもマッチする。
  function sameOrDependencyRe() {
    return new RegExp(
      '(?:請求項\\s*(' + EXPR + ')\\s*を引用する\\s*)?請求項\\s*(' + EXPR + ')\\s*にも同様の点が指摘され',
      'gd'
    );
  }

  // 直接指摘 D1: 請求項Ｐを引用する請求項Ｙには
  function directWithParentRe() {
    return new RegExp('請求項\\s*(' + EXPR + ')\\s*を引用する\\s*請求項\\s*(' + EXPR + ')\\s*には', 'gd');
  }

  // 直接指摘 D2/D3: 請求項Ｘには ／ 請求項Ｘに係る発明において（結論文の「に係る発明は」も
  // D3 に含めるが、「よって」で始まる結論文はそもそも直接指摘の走査対象にしない）
  function directPlainRe() {
    return new RegExp('請求項\\s*(' + EXPR + ')\\s*(?:には|に係る発明(?:において|は))', 'gd');
  }

  // 引用文言の役割決定用アンカー:
  //   （請求項Ｐを引用する）? 請求項Ｘ（には|に係る発明において） … 請求項側
  //   （本願）?明細書には                                        … 明細書側
  function quoteAnchorRe() {
    return new RegExp(
      '(?:請求項\\s*(?:' + EXPR + ')\\s*を引用する\\s*)?請求項\\s*(' + EXPR + ')\\s*(?:には|に係る発明において)' +
      '|(?:本願)?明細書には',
      'gd'
    );
  }

  // 明細書文: （本願）明細書には <欠落記載> （こと|点）? は記載されていない
  function specStatementRe() {
    return new RegExp('(?:本願)?明細書には(.+?)(?:こと|点)?は記載されていない', 'd');
  }

  // 結論文: よって、（請求項Ｘ）? に係る発明は <述部>
  function conclusionRe() {
    return new RegExp('よって、?\\s*(?:請求項\\s*(' + EXPR + ')\\s*)?に係る発明は、?\\s*([\\s\\S]*)$', 'd');
  }

  // ---- ブロック解析本体 ---------------------------------------------------

  // 1 指摘項目（BLOCK）を ITEM へ構造化する。summarizer / validator 適用前の状態を返す。
  // reasonContext = { reasonNumber, category, categoryLabel, itemNumber }
  function parseIssueBlock(block, reasonContext) {
    const warnings = [];
    const heading = claims.parseClaimHeading(block.headingLineRaw);
    for (const w of heading.warnings) warnings.push(w);

    // 見出し行を除いた本文
    const nl = block.matchText.indexOf('\n');
    const bodyMatch = nl === -1 ? '' : block.matchText.slice(nl + 1);
    const bodyRaw = nl === -1 ? '' : block.rawText.slice(nl + 1);
    const sentences = splitSentences(bodyMatch, bodyRaw);

    const directSet = new Set();
    const citedParentSet = new Set();
    const sameIssueSet = new Set();
    const dependencyRelations = [];
    const problematicPhrases = [];
    const specStatements = [];
    let clarityCoreSentence = null;
    let finalClaims = [];
    let finalClaimsRaw = null;
    let finalClaimsSource = null;
    let conclusionText = null;
    let conclusionCategory = null;
    const unmatchedSentences = [];

    const headingSet = new Set(heading.headingClaims);
    // 見出しが解析できなかった場合は「見出しとの交差」判定を常に真とみなす
    const intersectsHeading = (nums) =>
      headingSet.size === 0 || nums.some((n) => headingSet.has(n));

    for (const s of sentences) {
      let consumed = false;

      // --- 結論文 ---
      if (/^[ \t　]*よって/.test(s.match)) {
        const m = conclusionRe().exec(s.match);
        conclusionText = s.raw;
        conclusionCategory = splitter.categoryFromConclusion(s.match);
        if (m && m[1] !== undefined) {
          const parsed = claims.parseClaimExpression(m[1]);
          if (parsed.ok) {
            finalClaims = parsed.claims;
            finalClaimsRaw = s.raw.slice(m.indices[1][0], m.indices[1][1]);
            finalClaimsSource = 'conclusion';
          }
        }
        continue;   // 結論文は他の抽出器に掛けない
      }

      // --- 同様指摘・引用関係指摘（融合文対応） ---
      const sdRe = sameOrDependencyRe();
      let sd;
      while ((sd = sdRe.exec(s.match)) !== null) {
        const affected = claims.parseClaimExpression(sd[2]);
        if (!affected.ok) continue;
        if (sd[1] !== undefined) {
          const parents = claims.parseClaimExpression(sd[1]);
          dependencyRelations.push({
            parentClaims: parents.claims,
            affectedClaims: affected.claims,
            raw: s.raw.slice(sd.index, sdRe.lastIndex),
          });
        } else {
          for (const n of affected.claims) sameIssueSet.add(n);
        }
        consumed = true;
      }

      // --- 直接指摘（D1: 引用元つき） ---
      const d1Spans = [];
      const d1Re = directWithParentRe();
      let d1;
      while ((d1 = d1Re.exec(s.match)) !== null) {
        const parents = claims.parseClaimExpression(d1[1]);
        const targets = claims.parseClaimExpression(d1[2]);
        if (!targets.ok) continue;
        d1Spans.push([d1.index, d1Re.lastIndex]);
        if (intersectsHeading(targets.claims)) {
          for (const n of targets.claims) directSet.add(n);
          if (parents.ok) for (const n of parents.claims) citedParentSet.add(n);
          consumed = true;
        }
      }

      // --- 直接指摘（D2/D3: 引用元なし。D1 と重なる位置は読み飛ばす） ---
      const d2Re = directPlainRe();
      let d2;
      while ((d2 = d2Re.exec(s.match)) !== null) {
        const overlapsD1 = d1Spans.some(([a, b]) => d2.index < b && d2Re.lastIndex > a);
        if (overlapsD1) continue;
        const targets = claims.parseClaimExpression(d2[1]);
        if (!targets.ok) continue;
        if (intersectsHeading(targets.claims)) {
          for (const n of targets.claims) directSet.add(n);
          consumed = true;
        }
        // 見出しと交わらない請求項（比較対象）は directClaims に入れない
      }

      // --- 引用文言と役割 ---
      const quotes = scanQuotes(s.match);
      if (quotes.length > 0) {
        // 文中のアンカーをすべて収集し、各引用文言の直前のものを対応付ける
        const anchors = [];
        const aRe = quoteAnchorRe();
        let a;
        while ((a = aRe.exec(s.match)) !== null) {
          anchors.push({
            end: aRe.lastIndex,
            claims: a[1] !== undefined ? claims.parseClaimExpression(a[1]).claims : null,
            isSpec: a[1] === undefined,
          });
        }
        for (const q of quotes) {
          let anchor = null;
          for (const cand of anchors) {
            if (cand.end <= q.start && (anchor === null || cand.end > anchor.end)) anchor = cand;
          }
          let role, roleLabel, claimNumbers;
          if (anchor === null) {
            role = 'unknown';
            roleLabel = '不明';
            claimNumbers = claims.unionClaims(
              claims.extractClaimRefs(s.match, s.raw).map((r) => r.claims));
          } else if (anchor.isSpec) {
            role = 'spec';
            roleLabel = '明細書の記載';
            claimNumbers = [];
          } else if (intersectsHeading(anchor.claims)) {
            role = 'problem';
            roleLabel = '問題となる記載';
            claimNumbers = anchor.claims;
          } else {
            role = 'comparison';
            roleLabel = '比較対象の記載';
            claimNumbers = anchor.claims;
          }
          problematicPhrases.push({
            text: s.raw.slice(q.innerStart, q.innerEnd),
            claimNumbers,
            role,
            roleLabel,
          });
        }
        consumed = true;
      }

      // --- 明細書文（要約素材） ---
      const specM = specStatementRe().exec(s.match);
      if (specM) {
        specStatements.push({
          sentence: s.raw,
          missing: s.raw.slice(specM.indices[1][0], specM.indices[1][1]),
        });
        consumed = true;
      }

      // --- 明確性の中核文（要約素材。結論文以外で「不明確／明確でない」を含む文） ---
      if (clarityCoreSentence === null && /不明確|明確でない/.test(s.match)) {
        clarityCoreSentence = s.raw;
        consumed = true;
      }

      if (!consumed && s.match.trim() !== '') unmatchedSentences.push(s.raw);
    }

    // 結論文に請求項番号が無い場合は見出し（修正注記適用後）を暫定値とする
    if (finalClaims.length === 0) {
      finalClaims = heading.effectiveHeadingClaims.slice();
      finalClaimsSource = 'headingFallback';
    }

    return {
      itemNumber: reasonContext && reasonContext.itemNumber ? reasonContext.itemNumber : 1,
      headingClaimsRaw: heading.headingClaimsRaw,
      headingClaims: heading.headingClaims,
      effectiveHeadingClaims: heading.effectiveHeadingClaims,
      correctionNote: heading.correctionNote,
      directClaims: Array.from(directSet).sort((a, b) => a - b),
      citedParentClaims: Array.from(citedParentSet).sort((a, b) => a - b),
      sameIssueClaims: Array.from(sameIssueSet).sort((a, b) => a - b),
      dependencyRelations,
      finalClaims,
      finalClaimsRaw,
      finalClaimsSource,
      problematicPhrases,
      issueSummary: null,
      summaryReliable: null,
      conclusionText,
      conclusionCategory,
      sourceText: block.rawText,
      specStatements,
      clarityCoreSentence,
      firstBodySentence: sentences.length > 0 ? sentences[0].raw : null,
      unmatchedSentences,
      confidence: null,
      warnings,
    };
  }

  return {
    splitSentences,
    scanQuotes,
    parseIssueBlock,
  };
});

/*
 * article29.js — 29条系（新規性・進歩性）の解析と引用文献の対応付け（DOM非依存の純粋モジュール）
 *
 * 29条系の理由は次のブロック構造を採る（1 ブロック = 1 MAPPING）:
 *   ・請求項 １、８          … 対象の請求項（claims.parseClaimHeading で解析）
 *   ・引用文献等 １、２       … 引用文献の番号（claims.parseClaimExpression で解析）
 *   ・備考                   … 以降ブロック末尾までが備考（原文のまま保持）
 * 引用文献の名称は本文全体から拾う一覧（`引用文献１：…` のインライン形式と
 * `＜引用文献等一覧＞` のリスト形式の両対応）と番号で突き合わせる。
 *
 * 備考には `（段落００１５－００２３、図３）` のような段落番号が現れる。これらは
 * 請求項番号ではないため、備考に対して裸の番号式解析を一切行わない（`請求項` 接頭辞の
 * ある表記だけが請求項参照）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'), require('./claims'), require('./splitter'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.article29 = factory(root.RRB.normalizer, root.RRB.claims, root.RRB.splitter);
  }
})(globalThis, function (normalizer, claims, splitter) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  // 行単位で走査するためのユーティリティ（各行の先頭・末尾オフセットを持つ）。
  // matchText と rawText は同じ長さなのでオフセットを共有できる。
  function toLines(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const result = [];
    let pos = 0;
    for (const line of lines) {
      result.push({ text: line, start: pos, end: pos + line.length });
      pos += line.length + 1;
    }
    return result;
  }

  // ※ 行頭アンカー付きの正規表現では [ \t　]（行内空白のみ）を使う。
  //    \s は改行も含むため、^\s* が直前の空行まで遡ってマッチ位置を狂わせる。

  // 引用文献一覧の見出し行。`＜引用文献等一覧＞` / `引用文献一覧` /
  // 字間に空白が入る `引　用　文　献　等　一　覧` / 括弧・「等」の欠落を許容する
  const REF_LIST_HEADING_RE =
    /^[ \t　]*[＜<【\[]?[ \t　]*引[ \t　]*用[ \t　]*文[ \t　]*献[ \t　]*等?[ \t　]*一[ \t　]*覧[ \t　]*[＞>】\]]?[ \t　]*$/;

  // 一覧の項目行: `１．特開２０２０－１２３４５６号公報`（番号＋句点＋文献名）
  const REF_ENTRY_RE = /^[ \t　]*(\d+)[．.][ \t　]*(.+)$/d;

  // インライン形式の引用文献定義: `引用文献１：特開２０２０－１２３４５６号公報`
  // （normalizeForMatching が `：` を `:` に潰しているため `:` のみを見る）
  const INLINE_REF_RE = /^[ \t　]*[・･]?[ \t　]*引用文献(\d+)[ \t　]*:[ \t　]*(.+)$/d;

  // 罫線行（一覧の終端）と空行
  const RULED_LINE_RE = /^[ \t　]*[-ー─━]{8,}[ \t　]*$/;
  const BLANK_LINE_RE = /^[ \t　]*$/;

  // 指摘項目内の引用文献行: `・引用文献等 １、２` / `・引用文献 １及び３` / `・引用文献等:１`
  const REF_LINE_RE = /^[ \t　]*[・･][ \t　]*引[ \t　]*用[ \t　]*文[ \t　]*献[ \t　]*等?[ \t　]*:?[ \t　]*(.+)$/d;

  // 備考行: `・備考`（同一行に本文が続く形式も許容）
  const REMARKS_RE = /^[ \t　]*[・･][ \t　]*備[ \t　]*考[ \t　]*:?[ \t　]*(.*)$/d;

  // ---------------------------------------------------------------- 引用文献一覧

  // 本文全体から引用文献一覧を作る。
  //   matchBody … 照合用テキスト（全角数字→半角済み）
  //   rawBody   … matchBody と同じ長さの原文（文献名はここからスライスする）
  // 戻り値: [REFERENCE]（出現順・番号で重複排除。同一番号は先に現れた方を採る）
  function parseReferenceList(matchBody, rawBody) {
    const match = String(matchBody == null ? '' : matchBody);
    const raw = rawBody == null ? match : String(rawBody);
    const lines = toLines(match);
    const references = [];
    const seen = new Set();
    let inList = false;      // 一覧ブロックの内側か
    let entrySeen = false;   // 当該一覧で 1 件以上の項目行を読んだか

    function push(number, nameRange, lineStart, lineText) {
      if (seen.has(number)) return;   // 重複番号は先着優先（クラッシュさせない）
      seen.add(number);
      references.push({
        number,
        name: raw.slice(lineStart + nameRange[0], lineStart + nameRange[1]).trim() || null,
        raw: raw.slice(lineStart, lineStart + lineText.length).trim(),
        matched: false,
      });
    }

    for (const line of lines) {
      if (inList) {
        const entry = REF_ENTRY_RE.exec(line.text);
        if (entry) {
          entrySeen = true;
          push(parseInt(entry[1], 10), entry.indices[2], line.start, line.text);
          continue;
        }
        // 空行・罫線・一覧形式でない行で一覧ブロックは終わる
        // （見出し直後の空行だけは項目前の装飾として読み飛ばす）
        if (BLANK_LINE_RE.test(line.text) && !entrySeen) continue;
        inList = false;
        entrySeen = false;
        if (RULED_LINE_RE.test(line.text)) continue;
      }
      if (REF_LIST_HEADING_RE.test(line.text)) {
        inList = true;
        entrySeen = false;
        continue;
      }
      const inline = INLINE_REF_RE.exec(line.text);
      if (inline) push(parseInt(inline[1], 10), inline.indices[2], line.start, line.text);
    }
    return references;
  }

  // 番号から一覧の要素を引く
  function findReference(references, number) {
    for (const ref of references || []) {
      if (ref && ref.number === number) return ref;
    }
    return null;
  }

  // 対応が取れた引用文献に matched フラグを立てる（見つからなかった番号を返す）
  function markReferencesMatched(references, numbers) {
    const unresolved = [];
    for (const n of numbers || []) {
      const ref = findReference(references, n);
      if (ref) ref.matched = true;
      else unresolved.push(n);
    }
    return unresolved;
  }

  // テキスト塊が「引用文献一覧そのもの」かを判定する。
  // 一覧は analyzer が本文全体に対して parseReferenceList で処理するため、
  // 前置き・末尾に一覧が現れても未解析扱いにはしない。
  function isReferenceListLike(matchText) {
    const lines = toLines(matchText);
    let significant = 0;
    for (const line of lines) {
      if (BLANK_LINE_RE.test(line.text) || RULED_LINE_RE.test(line.text)) continue;
      significant++;
      if (REF_LIST_HEADING_RE.test(line.text)) return true;
      if (!REF_ENTRY_RE.test(line.text) && !INLINE_REF_RE.test(line.text)) return false;
    }
    return significant > 0;
  }

  function isBlank(text) {
    return String(text == null ? '' : text).trim() === '';
  }

  // ---------------------------------------------------------------- 区分の判定

  // 29条系の下位区分を決める。
  // 優先順位: ①理由の区分（見出し由来） ②法条（reasonContext.legalBasis） ③セクション本文の法条
  function detectSubCategory(reasonContext, sectionMatchText) {
    const category = reasonContext ? reasonContext.category : null;
    if (category === 'novelty') return { subCategory: 'novelty', subCategoryLabel: '新規性' };
    if (category === 'inventiveStep') return { subCategory: 'inventiveStep', subCategoryLabel: '進歩性' };
    const basis = reasonContext && reasonContext.legalBasis
      ? normalizer.normalizeForMatching(String(reasonContext.legalBasis))
      : null;
    const article = splitter.parseArticle(basis) ||
      splitter.parseArticle(sectionMatchText == null ? '' : sectionMatchText);
    if (article && article.article === 29 && article.branch == null) {
      if (article.paragraph === 1) return { subCategory: 'novelty', subCategoryLabel: '新規性' };
      if (article.paragraph === 2) return { subCategory: 'inventiveStep', subCategoryLabel: '進歩性' };
    }
    return { subCategory: 'article29-unknown', subCategoryLabel: '29条系（区分不明）' };
  }

  // ---------------------------------------------------------------- 指摘項目の解析

  // 1 ブロック（`・請求項` 行から次の `・請求項` 行まで）を 1 MAPPING へ解析する。
  // ブロック内は行単位の状態機械で読む（・引用文献等 → ・備考 → 備考本文）。
  function parseMappingBlock(block, reasonNumber, sub, references) {
    const warnings = [];
    const lines = toLines(block.matchText);
    const heading = claims.parseClaimHeading(block.headingLineRaw);
    for (const w of heading.warnings) warnings.push(w);

    const refNumbers = [];
    const refRawParts = [];
    let refLineFound = false;
    let remarksStart = -1;      // 備考本文の開始オフセット（ブロック内相対）
    const extraLines = [];      // どの行種にも当てはまらなかった行

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (remarksStart >= 0) continue;   // 備考以降はブロック末尾まですべて備考
      const remarksM = REMARKS_RE.exec(line.text);
      if (remarksM) {
        remarksStart = line.start + remarksM.indices[1][0];
        continue;
      }
      const refM = REF_LINE_RE.exec(line.text);
      if (refM) {
        refLineFound = true;
        const exprMatch = refM[1];
        const exprRaw = block.rawText.slice(line.start + refM.indices[1][0], line.start + refM.indices[1][1]).trim();
        const parsed = claims.parseClaimExpression(exprMatch);
        if (parsed.ok) {
          for (const n of parsed.claims) refNumbers.push(n);
          refRawParts.push(exprRaw);
        } else {
          warnings.push(makeWarning('REFERENCE_PARSE_UNCERTAIN',
            '引用文献の番号表記を解釈できませんでした（原文のまま表示します）: ' + exprRaw));
          refRawParts.push(exprRaw);
        }
        continue;
      }
      if (!BLANK_LINE_RE.test(line.text)) extraLines.push(line);
    }

    const referenceNumbers = claims.unionClaims([refNumbers]);
    const referenceNames = [];
    let unresolvedCount = 0;
    for (const n of referenceNumbers) {
      const ref = findReference(references, n);
      if (ref) {
        ref.matched = true;
        referenceNames.push(ref.name);
      } else {
        unresolvedCount++;
        referenceNames.push(null);
        warnings.push(makeWarning('REFERENCE_UNRESOLVED',
          '引用文献' + n + 'が引用文献一覧に見つかりません。番号のみ表示します。'));
      }
    }
    if (!refLineFound) {
      warnings.push(makeWarning('MAPPING_REFERENCE_MISSING',
        '「・引用文献等」の記載が見つからないため、請求項と引用文献の対応関係が不明確です。'));
    }

    const remarks = remarksStart >= 0 ? (block.rawText.slice(remarksStart).trim() || null) : null;

    // 適用関係（適用の型）の簡易判定。備考に「周知」があれば周知技術が優先
    let application = null;
    if (referenceNumbers.length === 1) application = '単独引用';
    else if (referenceNumbers.length > 1) application = '組合せ';
    if (remarks !== null && remarks.indexOf('周知') !== -1) application = '周知技術';

    const headingOk = heading.headingClaimsRaw !== null && heading.headingClaims.length > 0;
    let confidence = 'high';
    if (!headingOk) confidence = 'low';
    else if (unresolvedCount > 0 || !refLineFound) confidence = 'medium';

    const mapping = {
      reasonNumber,
      subCategory: sub.subCategory,
      subCategoryLabel: sub.subCategoryLabel,
      claims: heading.effectiveHeadingClaims.length > 0 ? heading.effectiveHeadingClaims : heading.headingClaims,
      claimsRaw: heading.headingClaimsRaw,
      referenceNumbers,
      referenceNumbersRaw: refRawParts.length > 0 ? refRawParts.join('、') : null,
      referenceNames,
      application,
      remarks,
      sourceText: block.rawText.replace(/\s+$/, ''),
      confidence,
      warnings,
    };
    return { mapping, extraLines };
  }

  // 29条系の理由セクションを解析する。
  //   section        … splitter.splitReasonSections の要素
  //   reasonContext  … { reasonNumber, category, categoryLabel, legalBasis }
  //   references     … parseReferenceList の結果（対応が取れた要素に matched を立てる）
  // 戻り値: { mappings: [MAPPING], unparsed: [{ text, note }], warnings: [WARNING] }
  function parseArticle29Section(section, reasonContext, references) {
    const refs = references || [];
    const mappings = [];
    const unparsed = [];
    const warnings = [];
    const sub = detectSubCategory(reasonContext, section ? section.matchText : '');
    const reasonNumber = section && section.reasonNumber != null
      ? section.reasonNumber
      : (reasonContext && reasonContext.reasonNumber != null ? reasonContext.reasonNumber : null);
    const parts = splitter.splitIssueBlocks(section);

    for (const block of parts.blocks) {
      const parsed = parseMappingBlock(block, reasonNumber, sub, refs);
      mappings.push(parsed.mapping);
      if (parsed.extraLines.length > 0) {
        unparsed.push({
          text: parsed.extraLines.map((l) => block.rawText.slice(l.start, l.end)).join('\n').trim(),
          note: '指摘項目内の解析できなかった記載です。原文を確認してください。',
        });
      }
    }

    if (parts.blocks.length === 0) {
      warnings.push(makeWarning('NO_ISSUE_BLOCKS',
        '29条系の理由から「・請求項」で始まる指摘項目を検出できませんでした。原文を確認してください。'));
    }

    // 前置き（見出しと最初のブロックの間）— 引用文献一覧なら未解析にしない
    if (parts.preamble && !isBlank(parts.preamble.rawText) &&
        !isReferenceListLike(parts.preamble.matchText)) {
      unparsed.push({
        text: parts.preamble.rawText.trim(),
        note: '理由見出しと最初の指摘項目の間の記載を解析できませんでした。',
      });
    }
    // 末尾（引用文献一覧・罫線以降）— 一覧は analyzer が本文全体から解析するため未解析にしない
    if (parts.trailing && !isBlank(parts.trailing.rawText) &&
        !isReferenceListLike(parts.trailing.matchText)) {
      unparsed.push({
        text: parts.trailing.rawText.trim(),
        note: '理由セクション末尾の記載を解析できませんでした。',
      });
    }

    return { mappings, unparsed, warnings };
  }

  return {
    parseReferenceList,
    findReference,
    markReferencesMatched,
    isReferenceListLike,
    detectSubCategory,
    parseArticle29Section,
  };
});

/*
 * summarizer.js — 問題の要約（テンプレート方式・DOM非依存の純粋モジュール）
 *
 * 自然言語生成は行わない。ITEM から抽出済みの素材（clarityCoreSentence /
 * specStatements / firstBodySentence）を決まった型に流し込むだけで、
 * 素材が足りない場合は原文の主要文をそのまま要約として返し reliable: false を立てる。
 *
 * 素材は原文（raw）のスライスなので全角数字を含む（`請求項２に係る発明において…`）。
 * テンプレート照合と出力表記は normalizer.normalizeForMatching を通した形（半角数字）で行う。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.summarizer = factory(root.RRB.normalizer);
  }
})(globalThis, function (normalizer) {
  'use strict';

  // 要約の先頭に残ると読みにくい接続表現（原文の文頭から取り除く）
  const LEADING_CONNECTIVES = ['してみると、', 'したがって、', 'そうすると、', 'すると、'];

  // かぎ括弧で挟まれた 2 つの記載の異同を問う明確性の定型文。
  // 例: 請求項２に係る発明において「第1送信ステップ」と「第2接続設定処理」との異同が不明確である。
  const QUOTE_PAIR_RE =
    /請求項(\d+)に係る発明において「([^」]*)」と「([^」]*)」との(異同|関係|対応関係)が(?:不明確|明確でない)/;

  function norm(text) {
    if (text == null) return null;
    const s = normalizer.normalizeForMatching(normalizer.normalizeLineEndings(String(text)));
    return s;
  }

  // n 文字を超える場合だけ末尾を省略記号に置き換える
  function truncate(text, n) {
    const s = String(text == null ? '' : text);
    const limit = typeof n === 'number' && n > 0 ? n : 40;
    return s.length <= limit ? s : s.slice(0, limit) + '…';
  }

  function stripLeadingConnectives(sentence) {
    let s = String(sentence == null ? '' : sentence).trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of LEADING_CONNECTIVES) {
        if (s.indexOf(c) === 0) {
          s = s.slice(c.length).trim();
          changed = true;
        }
      }
    }
    return s;
  }

  function endWithPeriod(sentence) {
    const s = String(sentence == null ? '' : sentence).trim();
    if (s === '') return s;
    return /[。？！]$/.test(s) ? s : s + '。';
  }

  // 明細書の欠落記載（「…の記載がない」）用に末尾の句読点を落とす
  function trimTail(text) {
    return String(text == null ? '' : text).trim().replace(/[。、，,\.]+$/, '');
  }

  // ---- テンプレート ----

  // 1) かぎ括弧 2 記載の異同 → 請求項2の「A」と「B」の異同が不明確。
  function quotePair(item) {
    const core = norm(item.clarityCoreSentence);
    if (core === null) return null;
    const m = QUOTE_PAIR_RE.exec(core);
    if (!m) return null;
    return {
      summary: '請求項' + parseInt(m[1], 10) + 'の「' + m[2] + '」と「' + m[3] + '」の' + m[4] + 'が不明確。',
      reliable: true,
    };
  }

  // 2) 明細書に記載がない → 明細書に「…」の記載がない。
  function specMissing(item) {
    const statements = item.specStatements || [];
    if (statements.length === 0) return null;
    const first = statements[0] || {};
    const missing = trimTail(norm(first.missing != null ? first.missing : first.sentence));
    if (missing === '') return null;
    return { summary: '明細書に「' + missing + '」の記載がない。', reliable: true };
  }

  // 3) 明確性の中核文をそのまま（文頭の接続表現のみ除去）
  function coreClarity(item) {
    const core = norm(item.clarityCoreSentence);
    if (core === null) return null;
    const summary = endWithPeriod(stripLeadingConnectives(core));
    if (summary === '') return null;
    return { summary, reliable: true };
  }

  // 4) 素材不足 — 原文の最初の指摘文（無ければ原文冒頭）を要約とし確度を落とす
  function fallback(item) {
    const first = norm(item.firstBodySentence);
    if (first !== null && first.trim() !== '') {
      return { summary: first.trim(), reliable: false };
    }
    const source = norm(item.sourceText);
    if (source !== null && source.trim() !== '') {
      // 原文は改行を含むため 1 行に潰してから 40 文字で切る
      return { summary: truncate(source.trim().replace(/[\s　]+/g, ' '), 40), reliable: false };
    }
    return null;
  }

  // ITEM から要約を作る。テンプレートは区分ごとの優先順で試す。
  //   support  … 明細書の欠落記載が主論点なので specMissing を先に見る
  //   clarity  … かぎ括弧の異同／中核文を先に見る
  //   その他   … quotePair → specMissing → coreClarity
  function buildIssueSummary(item, category) {
    if (item == null) return { summary: null, reliable: false };
    let order;
    if (category === 'support') order = [specMissing, quotePair, coreClarity];
    else if (category === 'clarity') order = [quotePair, coreClarity, specMissing];
    else order = [quotePair, specMissing, coreClarity];
    for (const template of order) {
      const result = template(item);
      if (result) return result;
    }
    const fb = fallback(item);
    return fb || { summary: null, reliable: false };
  }

  // 29条系の MAPPING 用の一行要約（概要タブ向け。備考は UI が原文のまま表示する）
  function buildMappingSummary(mapping) {
    if (mapping == null) return { summary: null, reliable: false };
    const label = mapping.subCategoryLabel || '29条系';
    const numbers = (mapping.referenceNumbers || []).join('、');
    if (numbers === '') return { summary: label + 'の指摘。', reliable: true };
    return { summary: '引用文献' + numbers + 'に基づく' + label + 'の指摘。', reliable: true };
  }

  return {
    truncate,
    stripLeadingConnectives,
    buildIssueSummary,
    buildMappingSummary,
  };
});

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

/*
 * claim-tree.js — 罫線ツリー記法の解析（DOM非依存の純粋モジュール）
 *
 * 「書類比較・クレームチェッカー」の #claim_tree に入る罫線ツリー
 *     1 ┳  2 ┳  3
 *       ┃    ┣  4 ━  5
 *       ┗ 24
 * を有向グラフへ変換する。辺 [from, to] は「to が from を引用する」向き（from = 引用される側）。
 *
 * 解析はトークン列＋スタック方式で行う。列位置（インデント幅）には依存しないため、
 * 半角スペース・全角スペース・タブが混在していても正しく解析できる。正しい入力では
 * 「行頭の ┃ の個数 k に対し、開いている分岐スタックの深さが常に k+1」という不変条件が
 * 成り立つ。これが崩れた入力（┗ の閉じ忘れ・┃ の不足）は、意図を推測できないため
 * 誤解析せずエラーで停止する。同一の請求項番号はどこに何回現れても常に同一ノードとして
 * 扱う（多項従属対応）。
 *
 * 由来: 同リポジトリの claim_relation_writer/src/core/parser.js で実績のあるアルゴリズムを
 * **本プロジェクトへ取り込んだ独立実装**である（プロジェクト間で依存し合わないというリポジトリ
 * 規約に従い、相対パス参照はしない。ルートの README.md「プロジェクト間の独立性」を参照）。
 * 一方を直したらもう一方も直すか判断する必要があるため、変更時は両者のテストを確認すること。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.claimTree = factory();
  }
})(globalThis, function () {
  'use strict';

  // 細線などの異体字は太線の罫線に読み替える（表にない罫線文字は不明トークン扱い）
  const GLYPH_ALIASES = { '┬': '┳', '├': '┣', '│': '┃', '└': '┗', '─': '━', '｜': '┃' };

  function toHalfWidthDigits(text) {
    return String(text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  }

  // 改行コード・全角数字・罫線異体字を正規化する。空白はトークン区切りとしてのみ
  // 使うため、インデント（枝の深さ情報）を壊す変換は行わない。
  function normalizeTreeText(text) {
    return toHalfWidthDigits(String(text == null ? '' : text).replace(/\r\n?/g, '\n'))
      .replace(/[┬├│└─｜]/g, (c) => GLYPH_ALIASES[c]);
  }

  // 1行をトークン列にする。数字・罫線以外の非空白文字は 'bad' として報告する
  function tokenizeLine(line) {
    const tokens = [];
    const re = /(\d+)|([┳┣┗┃━])|(\S)/gu;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[1] !== undefined) tokens.push({ type: 'num', value: parseInt(m[1], 10) });
      else if (m[2] !== undefined) tokens.push({ type: m[2] });
      else tokens.push({ type: 'bad', raw: m[3] });
    }
    return tokens;
  }

  // 三色DFS（反復版・巨大入力でも再帰スタックを溢れさせない）で循環を検出し、
  // 循環している請求項の経路を返す（なければ null）
  function findCycle(nodes, edges) {
    const children = new Map();
    for (const [from, to] of edges) {
      if (!children.has(from)) children.set(from, []);
      children.get(from).push(to);
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map([...nodes].map((n) => [n, WHITE]));
    for (const start of nodes) {
      if (color.get(start) !== WHITE) continue;
      const stack = [{ node: start, next: 0 }];
      color.set(start, GRAY);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const kids = children.get(frame.node) || [];
        if (frame.next < kids.length) {
          const c = kids[frame.next++];
          const col = color.get(c);
          if (col === GRAY) {
            const path = stack.map((f) => f.node);
            return path.slice(path.indexOf(c)).concat(c);
          }
          if (col === WHITE) {
            color.set(c, GRAY);
            stack.push({ node: c, next: 0 });
          }
        } else {
          color.set(frame.node, BLACK);
          stack.pop();
        }
      }
    }
    return null;
  }

  // 罫線ツリーテキストを解析する。
  // 戻り値: { ok: true, graph: { nodes: number[], edges: [number, number][], roots: number[] } }
  //       | { ok: false, errors: [{ line: number|null, message: string }] }
  function parseClaimTree(text) {
    const lines = normalizeTreeText(text).split('\n');
    const errors = [];
    const nodes = new Set();
    const edges = [];
    const edgeKeys = new Set();
    let stack = [];   // 開いている分岐（┳）の親番号。添字 = 行頭の ┃ の個数

    const addError = (line, message) => errors.push({ line, message });
    const addEdge = (from, to) => {
      const key = from + '>' + to;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([from, to]);
      }
    };

    lines.forEach((line, index) => {
      const ln = index + 1;
      const tokens = tokenizeLine(line);
      if (tokens.length === 0) return;   // 空行はスキップ

      const bad = tokens.find((t) => t.type === 'bad');
      if (bad) {
        addError(ln, '解釈できない文字「' + bad.raw + '」があります');
        return;
      }

      let i = 0;
      while (i < tokens.length && tokens[i].type === '┃') i++;
      const k = i;   // 行頭の ┃ の個数
      if (i === tokens.length) return;   // ┃ だけの行（縦線の継続表示）はスキップ

      let parent = null;
      const head = tokens[i];
      if (head.type === '┣' || head.type === '┗') {
        // 不変条件チェック: 正しい入力では常に stack.length === k + 1。
        // 崩れている場合は「┗ の閉じ忘れ」か「┃ の不足」かを判別できないため、
        // 推測で救済せずエラーにする（誤った引用関係を黙って生成しない）。
        if (stack.length < k + 1) {
          addError(ln, head.type + ' に対応する分岐（┳）がありません（┃ の数を確認してください）');
          return;
        }
        if (stack.length > k + 1) {
          addError(ln, '内側の分岐が ┗ で閉じられていないか、┃ の数が不足しています');
          return;
        }
        parent = stack[k];
        if (head.type === '┗') stack = stack.slice(0, k);   // 分岐を閉じる
        i++;
        if (i >= tokens.length || tokens[i].type !== 'num') {
          addError(ln, head.type + ' の直後に請求項番号がありません');
          return;
        }
      } else if (head.type === 'num') {
        if (k > 0) {
          addError(ln, '┃ の直後に請求項番号は置けません（┣ または ┗ が必要です）');
          return;
        }
        stack = [];   // 行頭が数字 = 新しい最上位行（前のツリーは暗黙に終了）
      } else {
        addError(ln, '行頭に ' + head.type + ' は置けません');
        return;
      }

      let prev = tokens[i].value;
      if (prev < 1) {
        addError(ln, '請求項番号は1以上の整数にしてください');
        return;
      }
      nodes.add(prev);
      if (parent !== null) {
        if (parent === prev) {
          addError(ln, '請求項' + prev + 'が自分自身を引用しています');
          return;
        }
        addEdge(parent, prev);
      }
      i++;

      // 行の残り: (┳ または ━) と請求項番号の繰り返し
      while (i < tokens.length) {
        const conn = tokens[i];
        if (conn.type === 'num') {
          addError(ln, '請求項番号が連続しています（' + prev + ' と ' + conn.value + ' の間に ┳ か ━ が必要です）');
          return;
        }
        if (conn.type !== '┳' && conn.type !== '━') {
          addError(ln, '行の途中に ' + conn.type + ' は置けません');
          return;
        }
        if (conn.type === '┳') stack.push(prev);   // 分岐を開く
        i++;
        if (i >= tokens.length || tokens[i].type !== 'num') {
          addError(ln, conn.type + ' の直後に請求項番号がありません');
          return;
        }
        const child = tokens[i].value;
        if (child < 1) {
          addError(ln, '請求項番号は1以上の整数にしてください');
          return;
        }
        if (child === prev) {
          addError(ln, '請求項' + prev + 'が自分自身を引用しています');
          return;
        }
        nodes.add(child);
        addEdge(prev, child);
        prev = child;
        i++;
      }
    });

    if (nodes.size === 0 && errors.length === 0) {
      addError(null, 'クレーム構造が入力されていません');
    }

    // 構文エラーがない場合のみ循環を検査する（経路付きで報告）
    if (errors.length === 0) {
      const cycle = findCycle(nodes, edges);
      if (cycle) {
        addError(null, '循環する引用関係が検出されました: 請求項 ' + cycle.join(' → '));
      }
    }

    if (errors.length > 0) return { ok: false, errors };

    const sortedNodes = [...nodes].sort((a, b) => a - b);
    const dependentSet = new Set(edges.map((e) => e[1]));           // 何かを引用している項
    const roots = sortedNodes.filter((n) => !dependentSet.has(n));  // 独立請求項
    return { ok: true, graph: { nodes: sortedNodes, edges, roots } };
  }

  return { normalizeTreeText, tokenizeLine, parseClaimTree };
});

/*
 * claim-structure.js — 特許請求の範囲の構造解析（DOM非依存の純粋モジュール）
 *
 * 「書類比較・クレームチェッカー」ページのクレーム解析結果から請求項の構造を組み立てる。
 * データ源と役割は次のとおり（役割を分けており、どれかが欠けても縮退して動く）:
 *
 *   1. #claim_tree .div_tree … 罫線ツリー。**引用関係の一次情報**。
 *      記法の解析は本プロジェクト内の claim-tree.js（RRB.claimTree）が行う
 *   2. #claim_cite … **合計請求項数**と独立請求項の一次情報（「合計請求項数: 26
 *      (独立請求項: 1,25,26)」）。ツリー由来の構造との照合にも使う
 *   3. #claim_mark … 請求項全文（【請求項 N】区切り）。全文表示と、引用表現の文字列・
 *      引用種別（単独／選択的／累積的）の判定に使う。ツリーが無い場合は引用関係の
 *      フォールバック情報源にもなる
 *
 * 引用関係はツリーを優先し、本文の引用表現と食い違う場合は上書きせず警告する。
 *
 * 拒絶理由文中に書かれた引用関係（「請求項２、４を引用する請求項５-７」）とは別物であり、
 * 混同しないよう本モジュールは拒絶理由テキストを一切参照しない（照合は consistency.js）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'), require('./claims'), require('./claim-tree'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.claimStructure = factory(root.RRB.normalizer, root.RRB.claims, root.RRB.claimTree);
  }
})(globalThis, function (normalizer, claims, claimTree) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr || [])).sort((a, b) => a - b);
  }

  // ---- HTML → プレーンテキスト -------------------------------------------

  // クレーム解析結果の innerHTML をプレーンテキストにする。
  // ページ側が本文に挿入した通番マーカー（<span class="showCiteCited…">[1-7]</span>）は
  // 原文の一部ではないため取り除く。&amp; の復元は必ず最後。
  function claimHtmlToText(html) {
    let t = String(html == null ? '' : html);
    t = t.replace(/<br\s*\/?>/gi, '\n');
    // 通番マーカー（[1-7] 等）を span ごと除去する
    t = t.replace(/<span[^>]*class="[^"]*showCiteCited[^"]*"[^>]*>\[[^\]<]*\]<\/span>/gi, '');
    t = t.replace(/<[^>]*>/g, '');
    t = t.replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, '&');
    return t;
  }

  // ---- 請求項本文の分割 ---------------------------------------------------

  // 【請求項 N】 見出しで請求項全文を分割する。
  // 対応形: 【請求項 1】【請求項1】［請求項1］[請求項1] ／ 行が「請求項1」だけの場合
  function parseClaimTexts(plainText) {
    const raw = normalizer.normalizeLineEndings(plainText);
    const match = normalizer.normalizeForMatching(raw);
    // 見出し: 全角/半角の各種括弧つき、または行全体が「請求項N」
    const headingRe = /[【［\[][ \t　]*請求項[ \t　]*(\d+)[ \t　]*[】］\]]|^[ \t　]*請求項[ \t　]*(\d+)[ \t　]*$/gm;
    const heads = [];
    let m;
    while ((m = headingRe.exec(match)) !== null) {
      const num = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2], 10);
      heads.push({ claimNumber: num, start: m.index, end: m.index + m[0].length });
    }
    const items = [];
    for (let i = 0; i < heads.length; i++) {
      const bodyEnd = i + 1 < heads.length ? heads[i + 1].start : raw.length;
      items.push({
        claimNumber: heads[i].claimNumber,
        text: raw.slice(heads[i].end, bodyEnd).replace(/^[\s　]+|[\s　]+$/g, ''),
        headingRaw: raw.slice(heads[i].start, heads[i].end),
      });
    }
    return items;
  }

  // ---- 引用表現の解析 -----------------------------------------------------

  // 引用表現の番号列（例: 「1」「1又は2」「1から3のいずれか一項」「1、2又は4」「1ないし4」）を
  // 整数配列へ。範囲: から / ないし / - / ～、列挙: 、／又は／若しくは／及び／並びに
  function parseDependencyClaimList(numberListMatch) {
    const norm = String(numberListMatch == null ? '' : numberListMatch);
    const out = [];
    // 範囲: から / ないし / 乃至 / -（正規化でダッシュ類とチルダは - に統一済み）
    // 列挙: 、／又は／または／若しくは／もしくは／及び／および／並びに
    const tokenRe = /(\d+)|(から|ないし|乃至|-|至)|(、|又は|または|若しくは|もしくは|及び|および|並びに)|([\s\S])/g;
    let pending = null;
    let rangeOp = false;
    let sawSelective = false;
    let sawCumulative = false;
    let m;
    while ((m = tokenRe.exec(norm)) !== null) {
      if (m[1] !== undefined) {
        const n = parseInt(m[1], 10);
        if (rangeOp) {
          if (pending === null || n < pending || n - pending > 999) return null;
          for (let k = pending; k <= n; k++) out.push(k);
          pending = null;
          rangeOp = false;
        } else {
          if (pending !== null) out.push(pending);
          pending = n;
        }
      } else if (m[2] !== undefined) {
        if (pending === null || rangeOp) return null;
        rangeOp = true;
      } else if (m[3] !== undefined) {
        if (/又は|または|若しくは|もしくは/.test(m[3])) sawSelective = true;
        if (/及び|および|並びに/.test(m[3])) sawCumulative = true;
        if (pending !== null) { out.push(pending); pending = null; }
      } else {
        // 数値列以外の文字（「のいずれか一項」等）が来たら番号列は終わり
        break;
      }
    }
    if (rangeOp) return null;
    if (pending !== null) out.push(pending);
    if (out.length === 0) return null;
    return { claims: uniqueSorted(out), sawSelective, sawCumulative };
  }

  // 請求項本文から引用表現を解析する。
  // 例: 「ことを特徴とする請求項4に記載のプログラム。」
  //     「請求項1から3のいずれか一項に記載の情報処理装置において、」
  // 戻り値: { expression, claims, type, raw } または null（引用表現なし＝独立請求項）
  function parseDependencyExpression(claimText) {
    const raw = String(claimText == null ? '' : claimText);
    const match = normalizer.normalizeForMatching(raw);
    // 引用節: 請求項<番号列>[のいずれか(一項)](に記載|に係る|に規定|において|記載)
    // 番号列に許すのは、数字・空白・読点と、範囲語（から/ないし/乃至/-）および
    // 列挙語（又は/または/若しくは/もしくは/及び/および/並びに）を構成する文字のみ。
    // 非貪欲にして、直後の「に記載」等の終端で止める。
    const NUM_LIST = '[0-9\\s　、\\-又はまたも若しくび及お並にないしから乃至]{1,60}?';
    const re = new RegExp(
      '請求項[ \\t　]*(' + NUM_LIST + ')' +
      '(?:の(?:いずれか|うち)(?:一項|1項)?)?[ \\t　]*' +
      '(?:に記載|に係る|に規定|において|記載)', 'gd');
    let best = null;
    let m;
    while ((m = re.exec(match)) !== null) {
      const parsed = parseDependencyClaimList(m[1]);
      if (parsed === null) continue;
      const hasEither = /の(?:いずれか|うち)/.test(m[0]);
      let type;
      if (parsed.claims.length === 1) type = 'single';
      else if (hasEither || parsed.sawSelective) type = 'selective';
      else if (parsed.sawCumulative) type = 'cumulative';
      else type = 'selective';   // 複数番号で選択語が無い場合も選択的引用として扱う
      const cand = {
        expression: raw.slice(m.indices[0][0], m.indices[0][1]),
        claims: parsed.claims,
        type,
        index: m.index,
      };
      // 引用表現は文末に置かれるのが通例。最後に現れたものを採用する
      if (best === null || cand.index > best.index) best = cand;
    }
    if (best === null) return null;
    return { expression: best.expression, claims: best.claims, type: best.type };
  }

  // ---- 罫線ツリー（引用関係の一次情報） -----------------------------------

  // #claim_tree .div_tree のテキストを解析し、引用関係を得る。
  // 記法の解析は claim-tree.js（RRB.claimTree）に委譲する
  //   （グラフの辺 [from, to] は「to が from を引用する」向き）。
  // 戻り値: { ok: true, nodes, roots, dependencies: Map<number, number[]> }
  //         | { ok: false, error }
  function parseClaimTree(treeText) {
    if (!claimTree || typeof claimTree.parseClaimTree !== 'function') {
      return {
        ok: false,
        error: '罫線ツリーの解析モジュール（claim-tree.js）が読み込まれていません。',
      };
    }
    const text = String(treeText == null ? '' : treeText);
    if (text.trim() === '') return { ok: false, error: '罫線ツリーが空です。' };
    const parsed = claimTree.parseClaimTree(text);
    if (!parsed.ok) {
      const messages = (parsed.errors || []).map(
        (e) => (e.line === null || e.line === undefined ? '' : e.line + '行目: ') + e.message);
      return { ok: false, error: '罫線ツリーを解析できませんでした: ' + messages.join(' / ') };
    }
    const dependencies = new Map();
    for (const n of parsed.graph.nodes) dependencies.set(n, []);
    for (const [from, to] of parsed.graph.edges) {
      dependencies.get(to).push(from);   // to が from を引用する
    }
    for (const [k, v] of dependencies) dependencies.set(k, uniqueSorted(v));
    return {
      ok: true,
      nodes: parsed.graph.nodes.slice(),
      roots: parsed.graph.roots.slice(),
      dependencies,
    };
  }

  // ---- 構造の構築 ---------------------------------------------------------

  // 到達可能集合（推移閉包）。循環があっても停止する（訪問済み管理）
  function reachable(startList, adjacency) {
    const seen = new Set();
    const stack = (startList || []).slice();
    while (stack.length > 0) {
      const n = stack.pop();
      const next = adjacency.get(n) || [];
      for (const x of next) {
        if (!seen.has(x)) { seen.add(x); stack.push(x); }
      }
    }
    return uniqueSorted(Array.from(seen));
  }

  // 引用経路（from → to）を1本返す（幅優先。無ければ null）
  function findDependencyPath(from, to, childAdjacency) {
    if (from === to) return [from];
    const queue = [[from]];
    const visited = new Set([from]);
    while (queue.length > 0) {
      const path = queue.shift();
      const last = path[path.length - 1];
      for (const child of childAdjacency.get(last) || []) {
        if (visited.has(child)) continue;
        const next = path.concat([child]);
        if (child === to) return next;
        visited.add(child);
        queue.push(next);
      }
    }
    return null;
  }

  // 請求項配列（[{claimNumber, text}]）から構造を構築する。
  // options.source            … 由来ラベル（'claim_tree' | 'claim_mark' | 'pasted' | 'manual'）
  // options.dependencies      … 引用関係 Map<number, number[]>（罫線ツリー由来。**本文解析より優先**）
  // options.totalClaimCount   … 合計請求項数（#claim_cite 由来。あれば優先）
  // options.independentClaims … 独立請求項（#claim_cite 由来。照合用）
  function build(claimList, options) {
    const opts = options || {};
    const warnings = [];
    const seenNumbers = new Map();
    const entries = [];
    const hasTree = !!(opts.dependencies && opts.dependencies.size > 0);

    for (const c of claimList || []) {
      const num = c.claimNumber;
      if (seenNumbers.has(num)) {
        warnings.push(makeWarning('CLAIM_NUMBER_DUPLICATE',
          '請求項' + num + 'が重複しています。後の記載を無視しました。', 'error'));
        continue;
      }
      seenNumbers.set(num, true);
      const text = String(c.text == null ? '' : c.text);
      // 引用表現は「表現の文字列」と「引用種別（単独／選択的／累積的）」のために常に解析する
      const textDep = parseDependencyExpression(text);
      const itemWarnings = [];
      let directParents;
      let parentsSource;
      if (opts.dependencies && opts.dependencies.has(num)) {
        directParents = uniqueSorted(opts.dependencies.get(num));
        parentsSource = 'claim_tree';
        // ツリーと本文の引用表現が食い違う場合は上書きせず警告する（誤りの発見が目的）
        if (textDep !== null && textDep.claims.join(',') !== directParents.join(',')) {
          itemWarnings.push(makeWarning('TREE_TEXT_DEPENDENCY_MISMATCH',
            '請求項' + num + 'の引用元が、罫線ツリー（' +
            (directParents.length === 0 ? 'なし' : claims.compressClaimNumbers(directParents)) +
            '）と請求項本文の引用表現（' + claims.compressClaimNumbers(textDep.claims) +
            '）で一致しません。原文を確認してください。', 'warn'));
        }
        if (textDep === null && directParents.length > 0 && text !== '') {
          itemWarnings.push(makeWarning('TREE_TEXT_DEPENDENCY_MISMATCH',
            '請求項' + num + 'は罫線ツリーでは請求項' + claims.compressClaimNumbers(directParents) +
            'を引用していますが、請求項本文から引用表現を検出できませんでした。', 'warn'));
        }
      } else {
        directParents = textDep === null ? [] : textDep.claims.slice();
        parentsSource = hasTree ? 'text-fallback' : 'text';
        if (hasTree) {
          itemWarnings.push(makeWarning('CLAIM_NOT_IN_TREE',
            '請求項' + num + 'が罫線ツリーに現れないため、請求項本文の引用表現から引用関係を推定しました。', 'warn'));
        }
      }
      entries.push({
        claimNumber: num,
        text,
        type: directParents.length === 0 ? 'independent' : 'dependent',
        directParents,
        allAncestors: [],
        directChildren: [],
        allDescendants: [],
        dependencyExpression: textDep === null ? null : textDep.expression,
        dependencyType: textDep !== null ? textDep.type
          : (directParents.length > 1 ? 'selective' : (directParents.length === 1 ? 'single' : null)),
        parentsSource,
        warnings: itemWarnings,
      });
    }
    entries.sort((a, b) => a.claimNumber - b.claimNumber);

    const numbers = entries.map((e) => e.claimNumber);
    const numberSet = new Set(numbers);

    // 番号の連続性（1 から欠番なし）を確認する
    if (numbers.length > 0) {
      if (numbers[0] !== 1) {
        warnings.push(makeWarning('CLAIM_NUMBER_START',
          '請求項番号が1から始まっていません（最小: ' + numbers[0] + '）。', 'warn'));
      }
      const gaps = [];
      for (let n = 1; n <= numbers[numbers.length - 1]; n++) {
        if (!numberSet.has(n)) gaps.push(n);
      }
      if (gaps.length > 0) {
        warnings.push(makeWarning('CLAIM_NUMBER_GAP',
          '請求項番号に欠番があります: ' + claims.compressClaimNumbers(gaps), 'warn'));
      }
    }

    // 引用先の妥当性（存在・自己引用・後方引用）
    const byNumber = new Map(entries.map((e) => [e.claimNumber, e]));
    for (const e of entries) {
      const valid = [];
      for (const p of e.directParents) {
        if (p === e.claimNumber) {
          e.warnings.push(makeWarning('CLAIM_SELF_REFERENCE',
            '請求項' + e.claimNumber + 'が自身を引用しています。', 'error'));
          continue;
        }
        if (!numberSet.has(p)) {
          e.warnings.push(makeWarning('CLAIM_PARENT_NOT_FOUND',
            '請求項' + e.claimNumber + 'が引用する請求項' + p + 'は存在しません。', 'error'));
          continue;
        }
        if (p > e.claimNumber) {
          e.warnings.push(makeWarning('CLAIM_FORWARD_REFERENCE',
            '請求項' + e.claimNumber + 'が後方の請求項' + p + 'を引用しています（通常は前方の請求項を引用します）。', 'warn'));
        }
        valid.push(p);
      }
      e.directParents = uniqueSorted(valid);
      if (e.directParents.length === 0 && e.type === 'dependent') {
        // 引用先が全て無効だった場合は独立請求項として扱う
        e.type = 'independent';
      }
    }

    // 隣接リスト（親→子 / 子→親）
    const parentAdj = new Map();   // n → 直接引用元
    const childAdj = new Map();    // n → 直接下位
    for (const e of entries) {
      parentAdj.set(e.claimNumber, e.directParents.slice());
      if (!childAdj.has(e.claimNumber)) childAdj.set(e.claimNumber, []);
    }
    for (const e of entries) {
      for (const p of e.directParents) {
        if (!childAdj.has(p)) childAdj.set(p, []);
        childAdj.get(p).push(e.claimNumber);
      }
    }
    for (const [k, v] of childAdj) childAdj.set(k, uniqueSorted(v));

    // 推移閉包と循環検出
    for (const e of entries) {
      e.allAncestors = reachable([e.claimNumber], parentAdj);
      e.allDescendants = reachable([e.claimNumber], childAdj);
      e.directChildren = (childAdj.get(e.claimNumber) || []).slice();
      if (e.allAncestors.indexOf(e.claimNumber) !== -1) {
        e.warnings.push(makeWarning('CLAIM_CIRCULAR_REFERENCE',
          '請求項' + e.claimNumber + 'の引用関係が循環しています。', 'error'));
      }
    }

    const independentClaims = entries.filter((e) => e.type === 'independent').map((e) => e.claimNumber);
    if (entries.length > 0 && independentClaims.length === 0) {
      warnings.push(makeWarning('NO_INDEPENDENT_CLAIM',
        '独立請求項を検出できませんでした。引用関係の解析結果を確認してください。', 'error'));
    }
    // #claim_cite の独立請求項一覧と照合する
    if (Array.isArray(opts.independentClaims) && opts.independentClaims.length > 0) {
      const a = independentClaims.join(',');
      const b = uniqueSorted(opts.independentClaims).join(',');
      if (a !== b) {
        warnings.push(makeWarning('INDEPENDENT_CLAIMS_MISMATCH',
          '独立請求項が、引用関係の解析結果（' + (a === '' ? 'なし' : a) +
          '）とページ側の一覧（' + b + '）で一致しません。', 'warn'));
      }
    }

    // 合計請求項数は #claim_cite の値を優先する（無ければ検出した最大番号）
    const maxFound = numbers.length === 0 ? 0 : numbers[numbers.length - 1];
    let totalClaimCount = maxFound;
    let totalClaimCountSource = 'max-claim-number';
    if (typeof opts.totalClaimCount === 'number' && opts.totalClaimCount > 0) {
      totalClaimCount = opts.totalClaimCount;
      totalClaimCountSource = 'claim_cite';
      if (opts.totalClaimCount !== maxFound) {
        warnings.push(makeWarning('CLAIM_TOTAL_MISMATCH',
          'ページ側の合計請求項数（' + opts.totalClaimCount + '）と、抽出できた請求項の最大番号（' +
          maxFound + '）が一致しません。', 'warn'));
      }
    }

    return {
      source: opts.source || 'unknown',
      sourceLabel: opts.sourceLabel || null,
      totalClaimCount,
      totalClaimCountSource,
      claimNumbers: numbers,
      independentClaims,
      claims: entries,
      warnings,
      crossChecks: [],
      // 引用経路の探索（consistency.js が指摘漏れの根拠表示に使う）
      findPath: function (from, to) { return findDependencyPath(from, to, childAdj); },
    };
  }

  // ---- 照合用の別データ源 -------------------------------------------------

  // #claim_cite のプレーンテキストからページ側の計算結果を読む。
  // 形式: 「合計請求項数: 26  (独立請求項: 1,25,26)」
  //       「[2]請求項2 『…』 従属請求項」
  //       「　引用請求項: 1 (間接引用: 1,2)　引用パターンの数: 1」
  //       「　被引用請求項: 3,4,5,6,7(うち間接被引用: 5)」
  // 注意1: 「被引用請求項」は「引用請求項」を部分文字列として含むため、否定後読みで区別する。
  // 注意2: ページ側の「被引用請求項」は直接＋間接の**全下位**であり、そのうち間接分が
  //        「うち間接被引用」で示される（直接下位 = 全下位 − 間接下位）。同様に
  //        「引用請求項」は直接引用元、「間接引用」は間接の引用元。
  function parseClaimCiteText(plainText) {
    const text = normalizer.normalizeForMatching(normalizer.normalizeLineEndings(plainText));
    if (text.trim() === '') return null;
    const totalM = /合計請求項数[ \t　]*:[ \t　]*(\d+)/.exec(text);
    const indepM = /独立請求項[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(text);
    const numList = (s) => uniqueSorted(String(s || '').split(/[,、\s　]+/).filter((x) => x !== '').map(Number).filter((n) => !isNaN(n)));
    const diff = (a, b) => a.filter((n) => b.indexOf(n) === -1);
    const entries = [];
    // 各請求項の記載: [n]請求項n … 次の [n]請求項 まで
    const blockRe = /\[(\d+)\][ \t　]*請求項[ \t　]*(\d+)([\s\S]*?)(?=\n?\[\d+\][ \t　]*請求項|$)/g;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
      const body = m[3];
      const parentsM = /(?<!被)引用請求項[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const indirectParentsM = /(?<!被)間接引用[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const citedByM = /被引用請求項[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const indirectCitedByM = /間接被引用[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const patternM = /引用パターンの数[ \t　]*:[ \t　]*(\d+)/.exec(body);
      const directParents = parentsM ? numList(parentsM[1]) : [];
      const indirectAncestors = indirectParentsM ? numList(indirectParentsM[1]) : [];
      const allDescendants = citedByM ? numList(citedByM[1]) : [];
      const indirectDescendants = indirectCitedByM ? numList(indirectCitedByM[1]) : [];
      entries.push({
        claimNumber: parseInt(m[2], 10),
        type: /独立請求項/.test(body) ? 'independent' : 'dependent',
        directParents,
        indirectAncestors,
        allAncestors: uniqueSorted(directParents.concat(indirectAncestors)),
        allDescendants,
        indirectDescendants,
        directChildren: diff(allDescendants, indirectDescendants),
        patternCount: patternM ? parseInt(patternM[1], 10) : null,
      });
    }
    if (totalM === null && entries.length === 0) return null;
    return {
      totalClaimCount: totalM ? parseInt(totalM[1], 10) : null,
      independentClaims: indepM ? numList(indepM[1]) : [],
      entries,
    };
  }

  // 自前解析（structure）とページ側の計算結果（cite）を照合する。
  // 直接引用元・全引用元・直接下位・全下位の4集合すべてを突き合わせる。
  function crossCheckWithCite(structure, cite) {
    const results = [];
    if (structure === null || cite === null) return results;
    if (cite.totalClaimCount !== null && cite.totalClaimCount !== structure.totalClaimCount) {
      results.push(makeWarning('CLAIM_TOTAL_MISMATCH',
        'ページ側の合計請求項数（' + cite.totalClaimCount + '）と請求項本文から数えた総数（' +
        structure.totalClaimCount + '）が一致しません。', 'warn'));
    }
    const byNum = new Map(structure.claims.map((c) => [c.claimNumber, c]));
    const FIELDS = [
      ['directParents', '直接引用元'],
      ['allAncestors', '全引用元'],
      ['directChildren', '直接下位'],
      ['allDescendants', '全下位'],
    ];
    for (const e of cite.entries) {
      const mine = byNum.get(e.claimNumber);
      if (!mine) {
        results.push(makeWarning('CLAIM_CITE_UNKNOWN_CLAIM',
          'ページ側の引用関係一覧にある請求項' + e.claimNumber + 'が請求項本文から抽出できていません。', 'warn'));
        continue;
      }
      for (const [field, label] of FIELDS) {
        // 全引用元は自身を含めない形で比較する（自前解析は自身を含まない）
        const a = uniqueSorted(mine[field]).join(',');
        const b = uniqueSorted(e[field]).join(',');
        if (a !== b) {
          results.push(makeWarning('CLAIM_DEPENDENCY_MISMATCH',
            '請求項' + e.claimNumber + 'の' + label + 'が、請求項本文の解析（' + (a === '' ? 'なし' : a) +
            '）とページ側の一覧（' + (b === '' ? 'なし' : b) + '）で一致しません。', 'warn'));
        }
      }
    }
    return results;
  }

  return {
    claimHtmlToText,
    parseClaimTexts,
    parseDependencyClaimList,
    parseDependencyExpression,
    parseClaimTree,
    hasTreeParser: function () { return !!claimTree && typeof claimTree.parseClaimTree === 'function'; },
    build,
    parseClaimCiteText,
    crossCheckWithCite,
  };
});

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

/*
 * sample-data.js — サンプル拒絶理由通知（fixtures/rejection-reason/拒絶理由例.txt と同一内容）
 *
 * このファイルは fixture から機械生成した埋め込み用データ。手編集しないこと。
 * 同一性は tests/sample-data.test.js が fixture との比較で検証する。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.sampleData = factory();
  }
})(globalThis, function () {
  'use strict';
  const lines = [
    "",
    "１．（明確性）この出願は、特許請求の範囲の記載が下記の点で、特許法第３６条第６項第２号に規定する要件を満たしていない。",
    "",
    "２．（サポート要件）この出願は、特許請求の範囲の記載が下記の点で、特許法第３６条第６項第１号に規定する要件を満たしていない。",
    "",
    "　　　　　　　　　　　　　　　　　記",
    "",
    "●理由１（明確性）について",
    "",
    "・請求項 ２-７",
    "　請求項１を引用する請求項２には「前記所定の接続を介して前記設定情報を前記通信装置に送信するための第2接続設定処理」が記載されている。",
    "　しかしながら、請求項１には「前記情報処理装置の外部のアクセスポイントと接続するための設定情報を、前記所定の接続を介して、前記通信装置に送信する第1送信ステップ」が記載されている。",
    "　してみると、請求項２に係る発明において「第1送信ステップ」と「第2接続設定処理」との異同が不明確である。",
    "　請求項３-４にも同様の点が指摘される。",
    "　請求項２、４を引用する請求項５-７にも同様の点が指摘される。",
    "　よって、請求項２-７に係る発明は明確でない。",
    "",
    "・請求項 １９-２０",
    "　請求項１を引用する請求項１９には「前記設定情報を前記通信装置に送信する処理が実行され」ないことが記載されている。",
    "　しかしながら、請求項１には「前記情報処理装置の外部のアクセスポイントと接続するための設定情報を、前記所定の接続を介して、前記通信装置に送信する」ことが記載されている。",
    "　してみると、発明特定事項同士の関係が整合しておらず、請求項１９に係る発明は不明確である。",
    "　請求項２０にも同様の点が指摘される。",
    "　よって、請求項１９-２０に係る発明は、発明の詳細な説明に記載したものでない。",
    "",
    "●理由２（サポート要件）について",
    "",
    "・請求項 ２",
    "　請求項２には「前記所定の接続とは異なる他の接続を介して前記設定情報を前記通信装置に送信するための第1接続設定処理を実行するか、前記所定の接続を介して前記設定情報を前記通信装置に送信するための第2接続設定処理を実行するかを、所定の条件に基づいて制御する」ことが記載されている。",
    "　しかしながら、本願明細書には任意の条件に基づいて、第1接続設定処理を実行するか、第2接続設定処理を実行するかを制御することは記載されていない。",
    "　よって、請求項２に係る発明は、発明の詳細な説明に記載したものでない。",
    "",
    "・請求項 ３-５、１９-２０（修正：５を除く）",
    "　請求項３には「前記所定の条件は、前記情報処理装置が接続しているアクセスポイントである所定のアクセスポイントが2.4GHzの周波数帯に対応することであり、前記所定の条件が満たされたことに基づいて前記第2接続設定処理が実行され」ることが記載されている。",
    "　しかしながら、本願明細書にはOSのバージョンがAccessorySetupKitに対応しない場合にまで第2接続設定処理を実行することは記載されていない。",
    "　請求項４、１９-２０にも同様の点が指摘される。",
    "　請求項４を引用する請求項５にも同様の点が指摘される。",
    "　よって、請求項３-５、１９-２０に係る発明は、発明の詳細な説明に記載したものでない。",
    "",
    "・請求項 ２-７、１９-２０",
    "　請求項１を引用する請求項２には「前記所定の接続を介して前記設定情報を前記通信装置に送信する」ことが記載されている。",
    "　加えて、請求項１には「前記情報処理装置の外部のアクセスポイントと接続するための設定情報を、前記所定の接続を介して、前記通信装置に送信する」ことが記載されている。",
    "　しかしながら、本願明細書には設定情報を複数回送信することは記載されていないため、請求項２に係る発明は本願明細書に記載されていない。",
    "　請求項３-４、１９-２０にも同様の点が指摘される。",
    "　請求項２、４を引用する請求項５-７にも同様の点が指摘される。",
    "　よって、請求項２-７、１９-２０に係る発明は、発明の詳細な説明に記載したものでない。",
    "",
    "・請求項 １９-２０",
    "　請求項１９には「前記第1検索ステップによる検索、及び、前記OSに標準搭載されている接続設定機能に対応した前記通信装置の検索により前記通信装置が発見されなかった場合であって、且つ、前記情報処理装置のOSのバージョン、及び、前記情報処理装置が接続しているアクセスポイントの周波数帯が所定の条件を満たす場合に、前記AccessorySetupKitによる前記通信装置の検索及び、前記設定情報を前記通信装置に送信する処理が実行」されることが記載されている。",
    "　しかしながら、本願明細書には情報処理装置が接続しているアクセスポイントが2.4GHzの周波数帯に対応していない場合にまで第2接続設定処理を実行することは記載されていない。",
    "　請求項２０にも同様の点が指摘される。",
    "　よって、請求項１９-２０に係る発明は、発明の詳細な説明に記載したものでない。",
    "－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－",
    "　　　　　　　　　　＜先行技術文献調査結果の記録＞",
    "・調査した分野　　ＩＰＣ　　Ｈ０４Ｂ　７／　２４－　　７／　２６",
    "　　　　　　　　　　　　　　Ｈ０４Ｗ　４／　００－　９９／　００",
    "　この先行技術文献調査結果の記録は、拒絶理由を構成するものではありません。",
    "",
    "　この拒絶理由通知の内容に関するお問合せ又は面接のご希望がありましたら、次の連絡先までご連絡ください。補正案等の送付を希望される際は、その旨を事前にご連絡ください。",
    "　電子メールにて連絡する際は、氏名、所属、出願番号、電話番号、下記審査官(補)名を記載していただき、下記メールアドレス(※)までご連絡ください。電子メールの連絡内容について不明な点等がある場合、電話で確認させていただく場合があります。",
    "",
    "審査第四部伝送システム(PA5J) 飯星 陽平(いいほし ようへい)",
    "TEL.03-3581-1101 内線3534",
    "※●●●●@jpo.go.jp (上記「●●●●」に置き換えて、「PA5J」と入力ください。)",
    "",
  ];
  return { text: lines.join('\n') };
});

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

/*
 * analyzer-app.js — 拒絶理由分析のモーダル UI（namespace: RRB.analyzerApp）
 *
 * 対象ページの CSP（script-src 'self'）のもとで動くブックマークレット本体。
 * 実行時に eval・Function コンストラクタでの動的コード生成・<script> 挿入・
 * 外部リソース読込は一切行わない。
 * DOM は Shadow DOM (open) に隔離し、ページ側の DOM・グローバル・スタイルには
 * 一切影響を与えない（追加するグローバルは globalThis.RRB のみ、ページに触れる
 * DOM は #rrb-host 1 個のみ）。
 *
 * 依存モジュール（RRB.analyzer / RRB.validator / RRB.claims / RRB.reportTemplate /
 * RRB.sampleData / RRB.pageClaims）はビルド時にこのファイルより前に連結される想定だが、
 * Node/モジュール環境（テストなど）で require されても落ちないよう、依存は launch() 実行時に
 * globalThis.RRB から遅延取得する（factory() 自体は引数を取らない）。
 *
 * RRB.pageClaims は対象ページの特許請求の範囲（#claim_mark 等）を読む唯一の窓口。
 * 取得した claimStructure は分析（analyze）に渡すだけで、取得できなくても分析自体は
 * 可能（その場合は文章内だけの整合性検証に限定される旨を結果画面に info 表示する）。
 *
 * ユーザー入力・解析結果はすべて textContent / value 経由で DOM に注入し、動的な値を
 * innerHTML に渡すことはしない（静的テンプレート文字列（STYLE_TEXT・PANEL_HTML）の
 * innerHTML 代入のみ許可）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.analyzerApp = factory();
  }
})(globalThis, function () {
  'use strict';

  // =====================================================================
  // STYLE_TEXT — Shadow root 内 <style> にそのまま設定する（ユーザ由来データなし）
  // =====================================================================

  const STYLE_TEXT = [
    // [hidden] は最優先・!important で確実に効かせる（後続ルールとの詳細度勝負を避ける）
    '[hidden]{display:none!important;}',
    ':host{position:fixed;inset:0;z-index:2147483000;overflow:auto;' +
      'font-family:"Segoe UI","Yu Gothic UI",Meiryo,system-ui,sans-serif;font-size:14px;' +
      'line-height:1.6;color:#1f2430;text-align:left;letter-spacing:normal;word-spacing:normal;text-transform:none;}',
    '*,*::before,*::after{box-sizing:border-box;font-family:inherit;}',
    '.rrb-modal{position:static;}',
    '.rrb-backdrop{position:absolute;inset:0;background:rgba(15,20,30,.4);}',
    '.rrb-panel{position:absolute;top:3vh;left:50%;transform:translateX(-50%);' +
      'width:min(1150px,96vw);max-height:94vh;overflow:auto;background:#fff;color:#1f2430;' +
      'border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:18px 22px 22px;}',
    '.rrb-screen{display:block;}',
    '.rrb-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;}',
    '.rrb-head h2{margin:0;font-size:1.15rem;font-weight:700;}',
    'h3,h4,h5{margin:14px 0 6px;font-weight:700;color:#1f2430;}',
    'h4{font-size:.95rem;}',
    'h5{font-size:.85rem;color:#454d59;}',
    'p{margin:0 0 8px;}',
    'button{appearance:auto;font:inherit;font-size:13px;line-height:1.4;margin:0;padding:7px 14px;' +
      'border:1px solid #c7cdd6;border-radius:6px;background:#eef1f5;color:#1f2430;cursor:pointer;' +
      'text-transform:none;box-shadow:none;touch-action:manipulation;white-space:nowrap;}',
    'button:hover{background:#e1e6ec;}',
    'button:disabled{opacity:.5;cursor:not-allowed;}',
    'button:focus-visible{outline:2px solid #1d4e89;outline-offset:1px;}',
    'button.rrb-primary{background:#1d4e89;border-color:#1d4e89;color:#fff;}',
    'button.rrb-primary:hover{background:#163f6f;}',
    'button.rrb-x{padding:0 8px;font-size:20px;line-height:1.6;background:none;border:none;color:#626b78;}',
    'button.rrb-x:hover{background:none;color:#1f2430;}',
    '.rrb-msg{margin:0 0 10px;padding:8px 12px;border-radius:6px;font-size:.85rem;white-space:pre-wrap;border:1px solid transparent;}',
    '.rrb-msg.rrb-warn{background:#fff6e5;color:#8a5a00;border-color:#f0dca8;}',
    '.rrb-msg.rrb-error{background:#fbeae9;color:#a4302a;border-color:#f1c4c0;}',
    '.rrb-msg.rrb-success{background:#e7f5ea;color:#226a3b;border-color:#bfe2c8;}',
    '.rrb-msg.rrb-info{background:#e6edf7;color:#1d4e89;border-color:#c7d6ec;}',
    '.rrb-claim-source{border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin:0 0 12px;background:#fafbfc;}',
    '.rrb-claim-source h3{margin:0 0 6px;font-size:.9rem;}',
    '.rrb-claim-structure-preview{margin-top:10px;}',
    '.rrb-claim-structure-preview .rrb-table-wrap{margin:8px 0 0;}',
    '.rrb-details{margin:8px 0 0;border:1px solid #e3e6ea;border-radius:6px;padding:8px 12px;}',
    '.rrb-details summary{cursor:pointer;color:#454d59;font-size:.85rem;}',
    '.rrb-paste-textarea{display:block;width:100%;min-height:10em;margin:8px 0;padding:8px 10px;' +
      'border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;resize:vertical;' +
      'font:12.5px/1.6 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;white-space:pre;overflow:auto;}',
    '.rrb-input-textarea{display:block;width:100%;min-height:44vh;margin:0 0 10px;padding:10px 12px;' +
      'border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;resize:vertical;' +
      'font:13.5px/1.7 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;white-space:pre;overflow:auto;}',
    '.rrb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;}',
    '.rrb-input-actions{justify-content:flex-start;}',
    '.rrb-spacer{flex:1 1 auto;}',
    '.rrb-cards{display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 14px;}',
    '.rrb-card{flex:0 0 auto;min-width:120px;padding:8px 14px;border:1px solid #d8dde3;border-radius:8px;background:#f7f8fa;}',
    '.rrb-card-label{font-size:.72rem;color:#626b78;font-weight:600;margin-bottom:2px;}',
    '.rrb-card-value{font-size:1.05rem;font-weight:700;color:#1f2430;word-break:break-word;}',
    '.rrb-card-wide{flex:1 1 260px;}',
    '.rrb-card-highlight{background:#e7f5ea;border-color:#bfe2c8;}',
    '.rrb-card-highlight .rrb-card-value{color:#226a3b;}',
    // エラー件数カードは黄色（警告）に埋もれさせず、赤で明確に目立たせる（§10）
    '.rrb-card-error{background:#fbeae9;border-color:#e3a49e;border-width:2px;}',
    '.rrb-card-error .rrb-card-value{color:#a4302a;}',
    '.rrb-total-claims-row{align-items:center;}',
    '.rrb-total-claims-row label{font-size:.85rem;font-weight:600;}',
    'input[type="number"]{font:inherit;width:6em;padding:5px 8px;border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;}',
    'input[type="number"]:focus-visible{outline:2px solid #1d4e89;outline-offset:1px;}',
    '.rrb-sub-text{font-size:.78rem;color:#626b78;}',
    '.rrb-note-caution{color:#8a5a00;}',
    '.rrb-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px;border-bottom:1px solid #d8dde3;padding-bottom:8px;}',
    'button.rrb-tab-btn{background:none;border:1px solid transparent;border-radius:6px 6px 0 0;padding:7px 12px;color:#454d59;}',
    'button.rrb-tab-btn:hover{background:#eef1f5;}',
    'button.rrb-tab-btn[aria-selected="true"]{background:#e6edf7;border-color:#c7d6ec;color:#1d4e89;font-weight:700;}',
    '.rrb-tabpanel{min-height:120px;}',
    '.rrb-reason-heading{margin-top:18px;}',
    '.rrb-empty{color:#8a93a0;font-size:.85rem;margin:6px 0 14px;}',
    '.rrb-table-wrap{overflow-x:auto;margin:0 0 16px;border:1px solid #e3e6ea;border-radius:6px;}',
    'table.rrb-table{border-collapse:collapse;width:100%;font-size:.82rem;}',
    '.rrb-table th,.rrb-table td{border-bottom:1px solid #e3e6ea;border-right:1px solid #eef0f3;padding:6px 8px;text-align:left;vertical-align:top;}',
    '.rrb-table th:last-child,.rrb-table td:last-child{border-right:none;}',
    '.rrb-table thead th{background:#f2f4f7;position:sticky;top:0;font-weight:700;}',
    '.rrb-item-row{cursor:pointer;}',
    '.rrb-item-row:hover{background:#f7f9fc;}',
    '.rrb-detail-row td{background:#f7f8fa;cursor:default;}',
    '.rrb-detail-content{padding:4px 2px;}',
    '.rrb-detail-block{margin:0 0 10px;}',
    '.rrb-detail-block ul{margin:0;padding-left:1.3em;}',
    '.rrb-detail-block li{margin:0 0 4px;}',
    '.rrb-pre{white-space:pre-wrap;word-break:break-word;background:#f2f4f7;border:1px solid #d8dde3;' +
      'border-radius:4px;padding:8px;font:12.5px/1.6 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;margin:0;}',
    '.rrb-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:.72rem;font-weight:700;margin-right:4px;white-space:nowrap;}',
    '.rrb-badge-direct{background:#e6edf7;color:#1d4e89;font-weight:800;}',
    '.rrb-badge-same{background:#e1f3f0;color:#1d7a70;}',
    '.rrb-badge-cited{background:#f0e6f7;color:#6a2fa0;}',
    '.rrb-badge-warn{background:#fff6e5;color:#8a5a00;}',
    '.rrb-badge-error{background:#fbeae9;color:#a4302a;}',
    '.rrb-badge-low{background:#eef1f5;color:#626b78;}',
    '.rrb-badge-ok{background:#e7f5ea;color:#226a3b;}',
    'button.rrb-detail-toggle{padding:4px 10px;font-size:.75rem;}',
    '.rrb-footer{border-top:1px solid #e3e6ea;padding-top:12px;margin-top:8px;}',
    '.rrb-feedback{font-size:.8rem;font-weight:700;}',
    '.rrb-feedback.rrb-feedback-ok{color:#226a3b;}',
    '.rrb-feedback.rrb-feedback-ng{color:#a4302a;}',
    '#rrb-source-details{margin-top:10px;}',
    '.rrb-overview-list{margin:0 0 10px;padding-left:1.3em;}',
    '.rrb-overview-list li{margin:0 0 6px;}',
    '.rrb-copy-helper{position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0;pointer-events:none;}',
  ].join('\n');

  // =====================================================================
  // PANEL_HTML — 静的テンプレート（ユーザ由来データを一切含まない）
  // =====================================================================

  const PANEL_HTML = [
    '<div class="rrb-backdrop"></div>',
    '<div class="rrb-panel" role="dialog" aria-modal="true" aria-labelledby="rrb-title">',

    '  <section id="rrb-screen-input" class="rrb-screen">',
    '    <div class="rrb-head">',
    '      <h2 id="rrb-title">拒絶理由分析</h2>',
    '      <button type="button" id="rrb-close-input-btn" class="rrb-x" aria-label="閉じる">×</button>',
    '    </div>',
    '    <div id="rrb-input-warning" class="rrb-msg rrb-warn" hidden></div>',

    '    <div class="rrb-claim-source">',
    '      <h3>請求項の取得元（任意・指摘漏れ候補と請求項の実在確認に使用）</h3>',
    '      <div id="rrb-claim-source-message" class="rrb-msg" hidden></div>',
    '      <div class="rrb-row">',
    '        <button type="button" id="rrb-collect-claims-btn">ページから請求項を取得</button>',
    '      </div>',
    '      <details class="rrb-details" id="rrb-paste-claims-details">',
    '        <summary>請求項全文を貼り付けて使う</summary>',
    '        <textarea id="rrb-paste-claims-text" class="rrb-paste-textarea" spellcheck="false"',
    '          placeholder="【請求項1】…&#10;【請求項2】…（見出し形式で請求項全文を貼り付けてください）"></textarea>',
    '        <div class="rrb-row">',
    '          <button type="button" id="rrb-paste-claims-btn">貼り付けた請求項を使う</button>',
    '        </div>',
    '      </details>',

    '      <div id="rrb-claim-structure-preview" class="rrb-claim-structure-preview" hidden>',
    '        <p id="rrb-claim-structure-summary" class="rrb-sub-text"></p>',
    '        <details class="rrb-details" id="rrb-claim-structure-details">',
    '          <summary id="rrb-claim-structure-details-summary">請求項構造を表示</summary>',
    '          <div id="rrb-claim-structure-warnings"></div>',
    '          <div id="rrb-claim-structure-table-wrap" class="rrb-table-wrap"></div>',
    '        </details>',
    '      </div>',
    '    </div>',

    '    <textarea id="rrb-input-text" class="rrb-input-textarea" spellcheck="false"',
    '      placeholder="拒絶理由通知書の本文をここに貼り付けてください（「・請求項」「よって、」などの記載を含む全文を推奨します）。"></textarea>',
    '    <input type="file" id="rrb-file-input" accept=".txt,text/plain" hidden>',
    '    <div class="rrb-row rrb-input-actions">',
    '      <button type="button" id="rrb-load-file-btn">TXTファイルを読み込む</button>',
    '      <button type="button" id="rrb-load-sample-btn">サンプルを読み込む</button>',
    '      <button type="button" id="rrb-clear-btn">クリア</button>',
    '      <span class="rrb-spacer"></span>',
    '      <button type="button" id="rrb-analyze-btn" class="rrb-primary">分析する</button>',
    '      <button type="button" id="rrb-close-input-btn2">閉じる</button>',
    '    </div>',
    '  </section>',

    '  <section id="rrb-screen-result" class="rrb-screen" hidden>',
    '    <div class="rrb-head">',
    '      <h2>拒絶理由分析結果</h2>',
    '      <div class="rrb-row">',
    '        <button type="button" id="rrb-back-btn">入力へ戻る</button>',
    '        <button type="button" id="rrb-reanalyze-btn">再解析</button>',
    '        <button type="button" id="rrb-close-result-btn">閉じる</button>',
    '      </div>',
    '    </div>',

    '    <div id="rrb-claim-structure-info" class="rrb-msg rrb-info" hidden></div>',

    '    <div id="rrb-summary-cards" class="rrb-cards"></div>',

    '    <div class="rrb-row rrb-total-claims-row">',
    '      <label for="rrb-total-claims-input">全請求項数</label>',
    '      <input type="number" min="1" id="rrb-total-claims-input">',
    '      <span id="rrb-total-claims-note" class="rrb-sub-text"></span>',
    '    </div>',

    '    <div id="rrb-tabs" class="rrb-tabs" role="tablist"></div>',
    '    <div id="rrb-tabpanel" class="rrb-tabpanel" role="tabpanel"></div>',

    '    <div class="rrb-row rrb-footer">',
    '      <button type="button" id="rrb-copy-table-btn">表をコピー (TSV)</button>',
    '      <button type="button" id="rrb-copy-json-btn">JSONをコピー</button>',
    '      <button type="button" id="rrb-save-json-btn">JSON保存</button>',
    '      <button type="button" id="rrb-save-csv-btn">CSV保存</button>',
    '      <button type="button" id="rrb-open-report-btn">レポートを別タブで開く</button>',
    '      <button type="button" id="rrb-toggle-source-btn">原文全文を表示</button>',
    '      <span id="rrb-footer-feedback" class="rrb-feedback" role="status" aria-live="polite"></span>',
    '    </div>',
    '    <details id="rrb-source-details">',
    '      <summary>入力した原文全文</summary>',
    '      <pre id="rrb-source-pre" class="rrb-pre"></pre>',
    '    </details>',
    '  </section>',

    '  <textarea id="rrb-copy-helper" class="rrb-copy-helper" tabindex="-1" aria-hidden="true"></textarea>',
    '</div>',
  ].join('\n');

  // タブ定義（表示順・ラベルはここで一元管理する）
  const TAB_DEFS = [
    { id: 'overview', label: '概要' },
    { id: 'clarity', label: '明確性' },
    { id: 'support', label: 'サポート要件' },
    { id: 'article29', label: '29条系' },
    { id: 'other', label: 'その他' },
    { id: 'unparsed', label: '未解析・警告' },
    { id: 'claimStructure', label: '請求項構造' },
    { id: 'consistency', label: '整合性チェック' },
    { id: 'omitted', label: '指摘漏れ候補' },
  ];

  const ARTICLE29_GROUPS = [
    ['novelty', '新規性'],
    ['inventiveStep', '進歩性'],
    ['article29-unknown', '29条系（区分不明）'],
  ];

  // =====================================================================
  // 純粋ヘルパ（DOM構築を伴わないもの）
  // =====================================================================

  // 起動時に必要な依存モジュールを globalThis.RRB から遅延取得する
  function resolveDeps() {
    const ns = globalThis.RRB || {};
    const required = {
      analyzer: ns.analyzer,
      validator: ns.validator,
      claims: ns.claims,
      reportTemplate: ns.reportTemplate,
      sampleData: ns.sampleData,
      pageClaims: ns.pageClaims,
    };
    const missing = Object.keys(required).filter((k) => !required[k]);
    return Object.assign({ ok: missing.length === 0, missing }, required);
  }

  function truncateText(text, max) {
    const s = String(text == null ? '' : text);
    return s.length <= max ? s : s.slice(0, max) + '…';
  }

  // 複数の請求項番号配列の和集合（昇順・重複なし）
  function unionClaims(...arrays) {
    const set = new Set();
    for (const arr of arrays) {
      for (const n of arr || []) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }

  function sumItemsByCategory(reasons, category) {
    return (reasons || [])
      .filter((r) => r.category === category)
      .reduce((n, r) => n + ((r.items || []).length), 0);
  }

  function confidenceLabel(c) {
    if (c === 'high') return '高';
    if (c === 'medium') return '中';
    if (c === 'low') return '低';
    return c || '不明';
  }

  function groupPhrasesByRole(phrases) {
    const order = ['problem', 'comparison', 'spec', 'unknown'];
    const map = new Map();
    for (const p of phrases || []) {
      const key = p.role || 'unknown';
      if (!map.has(key)) map.set(key, { role: key, roleLabel: p.roleLabel || key, phrases: [] });
      map.get(key).phrases.push(p);
    }
    return order.filter((r) => map.has(r)).map((r) => map.get(r));
  }

  // 「請求項Pを引用する請求項Aにも同様の点が指摘される」の内訳を文章化する
  function describeDependencyRelation(claimsMod, rel) {
    return '請求項' + claimsMod.compressClaimNumbers(rel.parentClaims) +
      'を引用する請求項' + claimsMod.compressClaimNumbers(rel.affectedClaims);
  }

  // 請求項番号配列を圧縮せず「、」区切りでそのまま並べる（請求項構造タブの直接下位／全下位用。
  // 引用元側は範囲圧縮を使うのに対し、下位側は個々の番号をそのまま確認したいための意図的な区別）
  function joinPlain(arr) {
    return (arr || []).join('、');
  }

  // consistencyChecks.issues は severity 'warn' を、omittedClaimCandidates は 'warning' を使う
  // （コアモジュール間で表記が異なる）ため、UI 表示ではまとめて統一ラベルにする
  function severityLabel(sev) {
    if (sev === 'error') return 'エラー';
    if (sev === 'warn' || sev === 'warning') return '要確認';
    return '参考';
  }

  function severityBadgeClass(sev) {
    if (sev === 'error') return 'rrb-badge-error';
    if (sev === 'warn' || sev === 'warning') return 'rrb-badge-warn';
    return 'rrb-badge-low';
  }

  const STATUS_LABEL = { ok: '整合', warning: '要確認', error: '不一致' };

  // 全請求項数の由来ラベル（「全請求項数」欄の小さな注記に使う）
  const TOTAL_CLAIM_SOURCE_LABEL = {
    claimStructure: '特許請求の範囲から取得',
    manual: '手動設定',
    estimated: '本文からの推定',
  };

  function statusBadgeClass(status) {
    if (status === 'error') return 'rrb-badge-error';
    if (status === 'warning') return 'rrb-badge-warn';
    return 'rrb-badge-ok';
  }

  // 差分セル: 非空の項目だけを「見出し−結論: 2-7」のように列挙する（§7 の6集合の突き合わせ）
  function buildDiffSummary(claimsMod, check) {
    const parts = [];
    const push = (label, arr) => {
      if ((arr || []).length > 0) parts.push(label + ': ' + claimsMod.compressClaimNumbers(arr));
    };
    push('見出し−結論', check.missingFromConclusion);
    push('結論−見出し', check.unexpectedInConclusion);
    push('本文−結論', check.bodyMissingFromConclusion);
    push('結論−本文', check.conclusionMissingFromBody);
    push('本文−見出し', check.missingFromHeading);
    push('見出し−本文', check.missingFromBody);
    return parts.join(' ／ ');
  }

  // reasonNumber・itemNumber から元の ITEM を引く（consistencyChecks は直接指摘／同様指摘／
  // 引用による指摘の請求項配列を保持していないため、詳細表示のために逆引きする）
  function findSourceItem(result, reasonNumber, itemNumber) {
    const reason = (result.reasons || []).find((r) => r.reasonNumber === reasonNumber);
    if (!reason) return null;
    return (reason.items || []).find((it) => it.itemNumber === itemNumber) || null;
  }

  // 文書全体・理由・項目・29条マッピングの警告を「箇所」ラベル付きでフラット化する
  function collectAllWarnings(result) {
    const out = [];
    const metadata = result.metadata || {};
    for (const w of metadata.warnings || []) {
      out.push({ location: '文書全体', code: w.code, message: w.message, severity: w.severity });
    }
    for (const reason of result.reasons || []) {
      for (const w of reason.warnings || []) {
        out.push({ location: '理由' + reason.reasonNumber, code: w.code, message: w.message, severity: w.severity });
      }
      for (const item of reason.items || []) {
        for (const w of item.warnings || []) {
          out.push({
            location: '理由' + reason.reasonNumber + ' 項目' + item.itemNumber,
            code: w.code, message: w.message, severity: w.severity,
          });
        }
      }
    }
    const mappings = ((result.noveltyInventiveStep || {}).mappings) || [];
    for (const m of mappings) {
      for (const w of m.warnings || []) {
        out.push({
          location: '理由' + m.reasonNumber + ' ' + (m.subCategoryLabel || '29条系'),
          code: w.code, message: w.message, severity: w.severity,
        });
      }
    }
    return out;
  }

  // =====================================================================
  // DOM 構築ヘルパ（result → DOM の小さな写像関数）
  // =====================================================================

  function makeBadge(doc, className, text) {
    const span = doc.createElement('span');
    span.className = 'rrb-badge ' + className;
    span.textContent = text;
    return span;
  }

  function cellText(doc, text) {
    const td = doc.createElement('td');
    td.textContent = text;
    return td;
  }

  function claimBadgeCell(doc, className, label, arr, claimsMod) {
    const td = doc.createElement('td');
    const list = arr || [];
    if (list.length === 0) {
      td.textContent = '—';
      return td;
    }
    td.appendChild(makeBadge(doc, className, label));
    td.appendChild(doc.createTextNode(' ' + claimsMod.compressClaimNumbers(list)));
    return td;
  }

  function buildEmptyNotice(doc, text) {
    const p = doc.createElement('p');
    p.className = 'rrb-empty';
    p.textContent = text;
    return p;
  }

  function detailBlock(doc, label, contentEl) {
    const block = doc.createElement('div');
    block.className = 'rrb-detail-block';
    const h = doc.createElement('h5');
    h.textContent = label;
    block.appendChild(h);
    block.appendChild(contentEl);
    return block;
  }

  function preText(doc, text) {
    const pre = doc.createElement('pre');
    pre.className = 'rrb-pre';
    pre.textContent = text;
    return pre;
  }

  function buildCard(doc, label, value, extraClass) {
    const card = doc.createElement('div');
    card.className = 'rrb-card' + (extraClass ? ' ' + extraClass : '');
    const l = doc.createElement('div');
    l.className = 'rrb-card-label';
    l.textContent = label;
    const v = doc.createElement('div');
    v.className = 'rrb-card-value';
    v.textContent = value;
    card.appendChild(l);
    card.appendChild(v);
    return card;
  }

  function renderSummaryCards(doc, container, result, claimsMod) {
    container.textContent = '';
    const metadata = result.metadata || {};
    const claimStats = metadata.claimStats || {};
    const reasons = result.reasons || [];
    const clarityCount = sumItemsByCategory(reasons, 'clarity');
    const supportCount = sumItemsByCategory(reasons, 'support');
    const article29Count = ((result.noveltyInventiveStep || {}).mappings || []).length;
    const warningsCount = collectAllWarnings(result).length;

    container.appendChild(buildCard(doc, '理由数', String(metadata.totalReasonCount != null ? metadata.totalReasonCount : reasons.length)));
    container.appendChild(buildCard(doc, '明確性 件数', String(clarityCount)));
    container.appendChild(buildCard(doc, 'サポート要件 件数', String(supportCount)));
    container.appendChild(buildCard(doc, '29条系 件数', String(article29Count)));
    container.appendChild(buildCard(doc, '警告 件数', String(warningsCount)));

    // 整合性チェック（claim-structure・consistency 由来）のエラー/警告/情報件数。
    // エラーは黄色の警告カードに埋もれさせず赤で目立たせる（rrb-card-error）
    const issueCounts = metadata.issueCounts || { error: 0, warning: 0, info: 0 };
    container.appendChild(buildCard(doc, 'エラー', String(issueCounts.error || 0),
      issueCounts.error > 0 ? 'rrb-card-error' : ''));
    container.appendChild(buildCard(doc, '警告（整合性）', String(issueCounts.warning || 0)));
    container.appendChild(buildCard(doc, '情報', String(issueCounts.info || 0)));

    const finalClaimsText = claimsMod.compressClaimNumbers(claimStats.allFinalClaims || []) || 'なし';
    const unflaggedText = claimsMod.compressClaimNumbers(claimStats.unflaggedClaims || []) || 'なし';
    container.appendChild(buildCard(doc, '最終指摘された請求項', finalClaimsText, 'rrb-card-wide'));
    container.appendChild(buildCard(doc, '未指摘の請求項', unflaggedText, 'rrb-card-wide rrb-card-highlight'));
  }

  // ---- 明確性・サポート要件・その他 タブ ----

  function buildItemDetailContent(doc, item, claimsMod) {
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-detail-content';

    wrap.appendChild(detailBlock(doc, '原文全文', preText(doc, item.sourceText || '')));

    const groups = groupPhrasesByRole(item.problematicPhrases);
    if (groups.length > 0) {
      const ul = doc.createElement('ul');
      for (const g of groups) {
        for (const p of g.phrases) {
          const li = doc.createElement('li');
          const strong = doc.createElement('strong');
          strong.textContent = g.roleLabel;
          li.appendChild(strong);
          const claimNote = (p.claimNumbers && p.claimNumbers.length)
            ? '（請求項' + claimsMod.compressClaimNumbers(p.claimNumbers) + '）' : '';
          li.appendChild(doc.createTextNode(': ' + p.text + claimNote));
          ul.appendChild(li);
        }
      }
      wrap.appendChild(detailBlock(doc, '抽出された記載', ul));
    }

    const relations = item.dependencyRelations || [];
    if (relations.length > 0) {
      const ul = doc.createElement('ul');
      for (const rel of relations) {
        const li = doc.createElement('li');
        li.textContent = describeDependencyRelation(claimsMod, rel);
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '引用関係の内訳', ul));
    }

    const concl = doc.createElement('p');
    concl.textContent = item.conclusionText || 'なし';
    wrap.appendChild(detailBlock(doc, '結論文', concl));

    const conf = doc.createElement('p');
    conf.textContent = confidenceLabel(item.confidence);
    wrap.appendChild(detailBlock(doc, '確度', conf));

    const warnings = item.warnings || [];
    if (warnings.length > 0) {
      const ul = doc.createElement('ul');
      for (const w of warnings) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity === 'error' ? 'エラー' : '警告'));
        li.appendChild(doc.createTextNode(' ' + w.message));
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '警告', ul));
    }

    const unmatched = item.unmatchedSentences || [];
    if (unmatched.length > 0) {
      const ul = doc.createElement('ul');
      for (const s of unmatched) {
        const li = doc.createElement('li');
        li.textContent = s;
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '未解析の文', ul));
    }

    return wrap;
  }

  function appendItemRows(doc, tbody, item, claimsMod) {
    const citedParents = unionClaims(item.citedParentClaims, ...(item.dependencyRelations || []).map((d) => d.parentClaims));

    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';

    tr.appendChild(cellText(doc, item.itemNumber != null ? String(item.itemNumber) : ''));

    const headingCell = doc.createElement('td');
    const headingMain = doc.createElement('div');
    headingMain.textContent = claimsMod.compressClaimNumbers(item.effectiveHeadingClaims);
    headingCell.appendChild(headingMain);
    if (item.correctionNote) {
      const sub = doc.createElement('div');
      sub.className = 'rrb-sub-text';
      sub.textContent = '原文: ' + (item.headingClaimsRaw || '');
      headingCell.appendChild(sub);
    }
    tr.appendChild(headingCell);

    const problemPhrase = (item.problematicPhrases || []).find((p) => p.role === 'problem');
    const problemCell = doc.createElement('td');
    if (problemPhrase) {
      problemCell.textContent = truncateText(problemPhrase.text, 40);
      problemCell.title = problemPhrase.text;
    } else {
      problemCell.textContent = '—';
    }
    tr.appendChild(problemCell);

    tr.appendChild(claimBadgeCell(doc, 'rrb-badge-direct', '直接', item.directClaims, claimsMod));
    tr.appendChild(claimBadgeCell(doc, 'rrb-badge-same', '同様', item.sameIssueClaims, claimsMod));
    tr.appendChild(claimBadgeCell(doc, 'rrb-badge-cited', '引用先', citedParents, claimsMod));

    const affectedCell = doc.createElement('td');
    const relations = item.dependencyRelations || [];
    if (relations.length === 0) {
      affectedCell.textContent = '—';
    } else {
      for (const rel of relations) {
        const line = doc.createElement('div');
        line.appendChild(makeBadge(doc, 'rrb-badge-cited', '引用先'));
        line.appendChild(doc.createTextNode(
          ' ' + claimsMod.compressClaimNumbers(rel.parentClaims) + ' → ' + claimsMod.compressClaimNumbers(rel.affectedClaims)
        ));
        affectedCell.appendChild(line);
      }
    }
    tr.appendChild(affectedCell);

    const finalCell = doc.createElement('td');
    finalCell.textContent = (item.finalClaims && item.finalClaims.length)
      ? claimsMod.compressClaimNumbers(item.finalClaims) : (item.finalClaimsRaw || '—');
    tr.appendChild(finalCell);

    const summaryCell = doc.createElement('td');
    summaryCell.appendChild(doc.createTextNode(item.issueSummary || ''));
    if (item.summaryReliable === false) {
      const note = doc.createElement('div');
      note.className = 'rrb-sub-text rrb-note-caution';
      note.textContent = '自動要約の確度が低い';
      summaryCell.appendChild(note);
    }
    tr.appendChild(summaryCell);

    const warnCell = doc.createElement('td');
    const warnings = item.warnings || [];
    if (warnings.length > 0) {
      const hasError = warnings.some((w) => w.severity === 'error');
      warnCell.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', '警告 ' + warnings.length));
    }
    if (item.confidence === 'low') {
      warnCell.appendChild(makeBadge(doc, 'rrb-badge-low', '確度低'));
    }
    if (warnings.length === 0 && item.confidence !== 'low') warnCell.textContent = '—';
    tr.appendChild(warnCell);

    const toggleCell = doc.createElement('td');
    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'rrb-detail-toggle';
    toggleBtn.textContent = '詳細';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleCell.appendChild(toggleBtn);
    tr.appendChild(toggleCell);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 11;
    detailTd.appendChild(buildItemDetailContent(doc, item, claimsMod));
    detailTr.appendChild(detailTd);

    // 行クリック・「詳細」ボタンいずれからも開閉できる（ボタンのクリックは行へバブリングする）
    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      toggleBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function buildReasonItemTable(doc, reason, claimsMod) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['No.', '見出し請求項', '問題となる記載', '直接指摘', '同様指摘', '引用元', '引用による指摘', '最終指摘', '問題の要約', '警告', '詳細']
      .forEach((label) => {
        const th = doc.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
      });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const item of reason.items || []) appendItemRows(doc, tbody, item, claimsMod);
    table.appendChild(tbody);
    return table;
  }

  function renderItemCategoryTab(doc, container, result, category, claimsMod) {
    container.textContent = '';
    const reasons = (result.reasons || []).filter((r) => r.category === category);
    if (reasons.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    for (const reason of reasons) {
      const heading = doc.createElement('h4');
      heading.className = 'rrb-reason-heading';
      heading.textContent = '理由' + reason.reasonNumber + '（' + (reason.categoryLabel || '') + '）' +
        (reason.legalBasis ? ' - ' + reason.legalBasis : '');
      container.appendChild(heading);
      if (!reason.items || reason.items.length === 0) {
        container.appendChild(buildEmptyNotice(doc, '項目なし'));
        continue;
      }
      const wrap = doc.createElement('div');
      wrap.className = 'rrb-table-wrap';
      wrap.appendChild(buildReasonItemTable(doc, reason, claimsMod));
      container.appendChild(wrap);
    }
  }

  // ---- 29条系 タブ ----

  function buildReferenceListTable(doc, references) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['番号', '名称', '対応'].forEach((l) => {
      const th = doc.createElement('th');
      th.textContent = l;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const ref of references) {
      const tr = doc.createElement('tr');
      tr.appendChild(cellText(doc, ref.number != null ? String(ref.number) : ''));
      tr.appendChild(cellText(doc, ref.name || ''));
      const statusTd = doc.createElement('td');
      if (ref.matched) {
        statusTd.textContent = '対応済み';
      } else {
        statusTd.appendChild(makeBadge(doc, 'rrb-badge-warn', '未対応'));
      }
      tr.appendChild(statusTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function buildMappingDetailContent(doc, mapping) {
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-detail-content';
    wrap.appendChild(detailBlock(doc, '原文全文', preText(doc, mapping.sourceText || '')));
    const conf = doc.createElement('p');
    conf.textContent = confidenceLabel(mapping.confidence);
    wrap.appendChild(detailBlock(doc, '確度', conf));
    const warnings = mapping.warnings || [];
    if (warnings.length > 0) {
      const ul = doc.createElement('ul');
      for (const w of warnings) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity === 'error' ? 'エラー' : '警告'));
        li.appendChild(doc.createTextNode(' ' + w.message));
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '警告', ul));
    }
    return wrap;
  }

  function appendMappingRows(doc, tbody, mapping, claimsMod) {
    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';
    tr.appendChild(cellText(doc, mapping.claimsRaw || claimsMod.compressClaimNumbers(mapping.claims)));
    tr.appendChild(cellText(doc, mapping.referenceNumbersRaw || claimsMod.compressClaimNumbers(mapping.referenceNumbers)));
    const refNames = (mapping.referenceNames || []).map((n) => n || '(不明)').join('、');
    tr.appendChild(cellText(doc, refNames));
    tr.appendChild(cellText(doc, mapping.application || '—'));

    const remarksTd = doc.createElement('td');
    const remarks = mapping.remarks || '';
    remarksTd.textContent = remarks ? truncateText(remarks, 40) : '—';
    if (remarks) remarksTd.title = remarks;
    tr.appendChild(remarksTd);

    const warnTd = doc.createElement('td');
    const warnings = mapping.warnings || [];
    if (warnings.length > 0) {
      const hasError = warnings.some((w) => w.severity === 'error');
      warnTd.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', '警告 ' + warnings.length));
    } else {
      warnTd.textContent = '—';
    }
    tr.appendChild(warnTd);

    const toggleTd = doc.createElement('td');
    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'rrb-detail-toggle';
    toggleBtn.textContent = '詳細';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleTd.appendChild(toggleBtn);
    tr.appendChild(toggleTd);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 7;
    detailTd.appendChild(buildMappingDetailContent(doc, mapping));
    detailTr.appendChild(detailTd);

    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      toggleBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function buildMappingTable(doc, mappings, claimsMod) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['請求項', '引用文献番号', '引用文献名', '適用関係', '備考', '警告', '詳細'].forEach((l) => {
      const th = doc.createElement('th');
      th.textContent = l;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const mapping of mappings) appendMappingRows(doc, tbody, mapping, claimsMod);
    table.appendChild(tbody);
    return table;
  }

  function renderArticle29Tab(doc, container, result, claimsMod) {
    container.textContent = '';
    const novelty = result.noveltyInventiveStep || {};
    const references = novelty.references || [];
    const mappings = novelty.mappings || [];
    if (references.length === 0 && mappings.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    if (references.length > 0) {
      const heading = doc.createElement('h4');
      heading.textContent = '引用文献一覧';
      container.appendChild(heading);
      const wrap = doc.createElement('div');
      wrap.className = 'rrb-table-wrap';
      wrap.appendChild(buildReferenceListTable(doc, references));
      container.appendChild(wrap);
    }
    for (const [key, label] of ARTICLE29_GROUPS) {
      const matched = mappings.filter((m) => m.subCategory === key);
      if (matched.length === 0 && key === 'article29-unknown') continue; // 区分不明が無ければ表自体を省略
      const heading = doc.createElement('h4');
      heading.textContent = label;
      container.appendChild(heading);
      if (matched.length === 0) {
        container.appendChild(buildEmptyNotice(doc, '該当なし'));
        continue;
      }
      const wrap = doc.createElement('div');
      wrap.className = 'rrb-table-wrap';
      wrap.appendChild(buildMappingTable(doc, matched, claimsMod));
      container.appendChild(wrap);
    }
  }

  // ---- 概要 タブ ----

  function renderOverviewTab(doc, container, result) {
    container.textContent = '';
    const reasons = result.reasons || [];
    const heading1 = doc.createElement('h4');
    heading1.textContent = '理由一覧';
    container.appendChild(heading1);
    if (reasons.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
    } else {
      const ul = doc.createElement('ul');
      ul.className = 'rrb-overview-list';
      for (const reason of reasons) {
        const li = doc.createElement('li');
        const article29Count = ((reason.article29 && reason.article29.mappings) || []).length;
        const itemCount = (reason.items || []).length + article29Count;
        const warnCount = (reason.warnings || []).length;
        li.textContent = '理由' + reason.reasonNumber + '（' + (reason.categoryLabel || '') + '）' +
          (reason.legalBasis ? ' - ' + reason.legalBasis : '') +
          ' ／ 項目数: ' + itemCount + ' ／ 警告: ' + warnCount + '件';
        ul.appendChild(li);
      }
      container.appendChild(ul);
    }

    const heading2 = doc.createElement('h4');
    heading2.textContent = '文書全体の警告';
    container.appendChild(heading2);
    const docWarnings = (result.metadata && result.metadata.warnings) || [];
    if (docWarnings.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    const ul = doc.createElement('ul');
    ul.className = 'rrb-overview-list';
    for (const w of docWarnings) {
      const li = doc.createElement('li');
      li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity || ''));
      li.appendChild(doc.createTextNode(' ' + w.message));
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  // ---- 未解析・警告 タブ ----

  function renderUnparsedWarningsTab(doc, container, result) {
    container.textContent = '';
    const heading1 = doc.createElement('h4');
    heading1.textContent = '未解析原文';
    container.appendChild(heading1);
    const unparsed = result.unparsedSections || [];
    if (unparsed.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
    } else {
      for (const u of unparsed) {
        const block = doc.createElement('div');
        block.className = 'rrb-detail-block';
        const sub = doc.createElement('div');
        sub.className = 'rrb-sub-text';
        sub.textContent = (u.location || '') + (u.note ? '（' + u.note + '）' : '');
        block.appendChild(sub);
        block.appendChild(preText(doc, u.text || ''));
        container.appendChild(block);
      }
    }

    const heading2 = doc.createElement('h4');
    heading2.textContent = '警告一覧';
    container.appendChild(heading2);
    const allWarnings = collectAllWarnings(result);
    if (allWarnings.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['箇所', 'コード', '重大度', '内容'].forEach((l) => {
      const th = doc.createElement('th');
      th.textContent = l;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const w of allWarnings) {
      const tr = doc.createElement('tr');
      tr.appendChild(cellText(doc, w.location));
      tr.appendChild(cellText(doc, w.code || ''));
      tr.appendChild(cellText(doc, w.severity || ''));
      tr.appendChild(cellText(doc, w.message || ''));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // ---- 請求項構造 タブ ----

  const DEPENDENCY_TYPE_LABEL = { single: '単独', selective: '選択的', cumulative: '累積的' };

  function appendClaimRows(doc, tbody, claim, claimsMod) {
    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';

    // 請求項番号セルをクリック（またはボタン操作）すると請求項全文を展開する
    const numCell = doc.createElement('td');
    const numBtn = doc.createElement('button');
    numBtn.type = 'button';
    numBtn.className = 'rrb-detail-toggle';
    numBtn.textContent = String(claim.claimNumber);
    numBtn.setAttribute('aria-expanded', 'false');
    numCell.appendChild(numBtn);
    tr.appendChild(numCell);

    const typeCell = doc.createElement('td');
    typeCell.appendChild(makeBadge(doc,
      claim.type === 'independent' ? 'rrb-badge-direct' : 'rrb-badge-low',
      claim.type === 'independent' ? '独立' : '従属'));
    tr.appendChild(typeCell);

    // 引用元側は範囲圧縮、下位側は個々の番号をそのまま「、」区切りで表示する（joinPlain）
    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(claim.directParents) || '—'));
    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(claim.allAncestors) || '—'));
    tr.appendChild(cellText(doc, joinPlain(claim.directChildren) || '—'));
    tr.appendChild(cellText(doc, joinPlain(claim.allDescendants) || '—'));
    tr.appendChild(cellText(doc,
      claim.dependencyType ? (DEPENDENCY_TYPE_LABEL[claim.dependencyType] || claim.dependencyType) : '—'));

    const warnCell = doc.createElement('td');
    const warnings = claim.warnings || [];
    if (warnings.length > 0) {
      const hasError = warnings.some((w) => w.severity === 'error');
      warnCell.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', '警告 ' + warnings.length));
    } else {
      warnCell.textContent = '—';
    }
    tr.appendChild(warnCell);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 8;
    detailTd.appendChild(preText(doc, claim.text || ''));
    detailTr.appendChild(detailTd);

    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      numBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function buildClaimStructureTable(doc, structure, claimsMod) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['請求項', '種別', '直接引用元', '全引用元', '直接下位', '全下位', '引用種別', '警告'].forEach((label) => {
      const th = doc.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const claim of structure.claims || []) appendClaimRows(doc, tbody, claim, claimsMod);
    table.appendChild(tbody);
    return table;
  }

  function renderClaimStructureTab(doc, container, result, claimsMod) {
    container.textContent = '';
    const structure = result.claimStructure;
    if (!structure) {
      container.appendChild(buildEmptyNotice(doc, '該当なし（請求項が未取得です）'));
      return;
    }
    const structIssues = (structure.warnings || []).concat(structure.crossChecks || []);
    const info = doc.createElement('p');
    info.className = 'rrb-sub-text';
    info.textContent = '総数: ' + structure.totalClaimCount +
      ' ／ 独立請求項: ' + (joinPlain(structure.independentClaims) || 'なし') +
      ' ／ 取得元: ' + (structure.sourceLabel || structure.source || '不明') +
      ' ／ 構造警告: ' + structIssues.length + '件';
    container.appendChild(info);

    if (structIssues.length > 0) {
      const ul = doc.createElement('ul');
      ul.className = 'rrb-overview-list';
      for (const w of structIssues) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity === 'error' ? 'エラー' : '警告'));
        li.appendChild(doc.createTextNode(' ' + w.message));
        ul.appendChild(li);
      }
      container.appendChild(ul);
    }

    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    wrap.appendChild(buildClaimStructureTable(doc, structure, claimsMod));
    container.appendChild(wrap);
  }

  // ---- 整合性チェック タブ ----

  function buildConsistencyDetailContent(doc, result, check, claimsMod) {
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-detail-content';

    // consistencyChecks 自体は直接指摘／同様指摘／引用による指摘の請求項配列を持たないため、
    // 元の ITEM を逆引きして §8 の9行比較表を組み立てる
    const item = findSourceItem(result, check.reasonNumber, check.itemNumber);
    const directClaims = item ? item.directClaims : [];
    const sameIssueClaims = item ? item.sameIssueClaims : [];
    const citedInfluence = item ? unionClaims(...(item.dependencyRelations || []).map((d) => d.affectedClaims)) : [];

    const rows = [
      ['見出し請求項', check.headingClaims],
      ['修正後見出し請求項', check.effectiveHeadingClaims],
      ['直接指摘請求項', directClaims],
      ['同様指摘請求項', sameIssueClaims],
      ['引用による指摘請求項', citedInfluence],
      ['本文上の指摘集合', check.bodyAffectedClaims],
      ['結論請求項', check.finalClaims],
      ['クレーム構造上の承継候補', check.inheritedCandidates],
      ['指摘漏れ候補', check.omittedClaims],
    ];
    const ul = doc.createElement('ul');
    for (const [label, arr] of rows) {
      const li = doc.createElement('li');
      const strong = doc.createElement('strong');
      strong.textContent = label;
      li.appendChild(strong);
      li.appendChild(doc.createTextNode(': ' + (claimsMod.compressClaimNumbers(arr) || 'なし')));
      ul.appendChild(li);
    }
    wrap.appendChild(detailBlock(doc, '請求項の比較（§8）', ul));

    const issues = check.issues || [];
    if (issues.length > 0) {
      const issueUl = doc.createElement('ul');
      for (const i of issues) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, severityBadgeClass(i.severity), severityLabel(i.severity)));
        li.appendChild(doc.createTextNode(' ' + i.text));
        issueUl.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '検出された不整合', issueUl));
    }
    return wrap;
  }

  function appendConsistencyRows(doc, tbody, result, check, index, claimsMod) {
    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';

    tr.appendChild(cellText(doc, String(index + 1)));

    const reasonCell = doc.createElement('td');
    reasonCell.textContent = '理由' + check.reasonNumber + ' 項目' + check.itemNumber + '（' + (check.categoryLabel || '') + '）';
    tr.appendChild(reasonCell);

    const headingRaw = claimsMod.compressClaimNumbers(check.headingClaims);
    const headingFixed = claimsMod.compressClaimNumbers(check.effectiveHeadingClaims);
    const headingCell = doc.createElement('td');
    const headingMain = doc.createElement('div');
    headingMain.textContent = headingFixed;
    headingCell.appendChild(headingMain);
    if (headingRaw !== headingFixed) {
      const sub = doc.createElement('div');
      sub.className = 'rrb-sub-text';
      sub.textContent = '原文: ' + headingRaw;
      headingCell.appendChild(sub);
    }
    tr.appendChild(headingCell);

    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(check.bodyAffectedClaims) || '—'));
    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(check.finalClaims) || '—'));

    const statusCell = doc.createElement('td');
    statusCell.appendChild(makeBadge(doc, statusBadgeClass(check.status), STATUS_LABEL[check.status] || check.status));
    tr.appendChild(statusCell);

    tr.appendChild(cellText(doc, buildDiffSummary(claimsMod, check) || '—'));

    const errorCell = doc.createElement('td');
    const issues = check.issues || [];
    if (issues.length > 0) {
      const hasError = issues.some((i) => i.severity === 'error');
      errorCell.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', issues.length + '件'));
    } else {
      errorCell.textContent = '—';
    }
    tr.appendChild(errorCell);

    const toggleCell = doc.createElement('td');
    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'rrb-detail-toggle';
    toggleBtn.textContent = '詳細';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleCell.appendChild(toggleBtn);
    tr.appendChild(toggleCell);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 9;
    detailTd.appendChild(buildConsistencyDetailContent(doc, result, check, claimsMod));
    detailTr.appendChild(detailTd);

    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      toggleBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function renderConsistencyTab(doc, container, result, claimsMod) {
    container.textContent = '';
    const checks = result.consistencyChecks || [];
    if (checks.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['No.', '理由', '見出し', '本文上の対象', '結論', '一致判定', '差分', 'エラー', '詳細'].forEach((label) => {
      const th = doc.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    checks.forEach((check, index) => appendConsistencyRows(doc, tbody, result, check, index, claimsMod));
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // ---- 指摘漏れ候補 タブ ----

  function buildOmittedRow(doc, candidate) {
    const tr = doc.createElement('tr');

    const reasonCell = doc.createElement('td');
    reasonCell.textContent = '理由' + candidate.reasonNumber + ' 項目' + candidate.itemNumber +
      '（' + (candidate.categoryLabel || '') + '）';
    tr.appendChild(reasonCell);

    tr.appendChild(cellText(doc, String(candidate.sourceClaim)));

    const omittedCell = doc.createElement('td');
    omittedCell.appendChild(doc.createTextNode(String(candidate.omittedClaim) + ' '));
    if (candidate.coveredElsewhereInReason) {
      omittedCell.appendChild(makeBadge(doc, 'rrb-badge-direct', '他項目で指摘済'));
    }
    tr.appendChild(omittedCell);

    tr.appendChild(cellText(doc, candidate.dependencyPathText || ''));

    const sevCell = doc.createElement('td');
    sevCell.appendChild(makeBadge(doc, severityBadgeClass(candidate.severity), severityLabel(candidate.severity)));
    tr.appendChild(sevCell);

    tr.appendChild(cellText(doc, candidate.basis || ''));
    return tr;
  }

  function renderOmittedTab(doc, container, result) {
    container.textContent = '';
    const list = result.omittedClaimCandidates || [];
    if (list.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '指摘漏れ候補は検出されませんでした。'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['理由項目', '問題請求項', '漏れている可能性のある請求項', '引用経路', '判定', '根拠'].forEach((label) => {
      const th = doc.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const candidate of list) tbody.appendChild(buildOmittedRow(doc, candidate));
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // =====================================================================
  // 起動・イベント配線
  // =====================================================================

  let activeApp = null; // 開いているモーダルの再表示・後片付け窓口（再実行時の重複生成を防ぐ）

  function launch(config) {
    const cfg = config || {};
    const doc = document;
    const win = window;

    // 既に開いているモーダルがあれば再利用する（再実行で重複生成しない）。
    // ただしページ側の描き換え等でホストが文書から外れている場合は、
    // 再利用すると「押しても何も出ない」状態になるため、作り直す。
    if (activeApp) {
      if (activeApp.isAttached()) {
        activeApp.show(cfg);
        return;
      }
      activeApp.dispose();
    }
    const stale = doc.getElementById('rrb-host');
    if (stale) stale.remove(); // 前回の後片付けが不完全だった場合の保険

    const deps = resolveDeps();
    if (!deps.ok) {
      win.alert(
        '拒絶理由分析: 起動に必要なモジュールが読み込まれていません（連結順を確認してください）。\n' +
        '不足: ' + deps.missing.join(', ')
      );
      return;
    }

    const host = doc.createElement('div');
    host.id = 'rrb-host';
    doc.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = doc.createElement('style');
    styleEl.textContent = STYLE_TEXT;
    shadow.appendChild(styleEl);

    const rootEl = doc.createElement('div');
    rootEl.className = 'rrb-modal';
    rootEl.innerHTML = PANEL_HTML; // 静的テンプレートのみ（ユーザ由来データを含まない）
    shadow.appendChild(rootEl);

    const q = (id) => shadow.getElementById(id);
    const dom = {
      title: q('rrb-title'),
      screenInput: q('rrb-screen-input'),
      screenResult: q('rrb-screen-result'),
      closeInputBtn: q('rrb-close-input-btn'),
      closeInputBtn2: q('rrb-close-input-btn2'),
      inputWarning: q('rrb-input-warning'),
      claimSourceMessage: q('rrb-claim-source-message'),
      collectClaimsBtn: q('rrb-collect-claims-btn'),
      pasteClaimsDetails: q('rrb-paste-claims-details'),
      pasteClaimsText: q('rrb-paste-claims-text'),
      pasteClaimsBtn: q('rrb-paste-claims-btn'),
      claimStructurePreview: q('rrb-claim-structure-preview'),
      claimStructureSummary: q('rrb-claim-structure-summary'),
      claimStructureDetails: q('rrb-claim-structure-details'),
      claimStructureDetailsSummary: q('rrb-claim-structure-details-summary'),
      claimStructureWarnings: q('rrb-claim-structure-warnings'),
      claimStructureTableWrap: q('rrb-claim-structure-table-wrap'),
      claimStructureInfo: q('rrb-claim-structure-info'),
      inputText: q('rrb-input-text'),
      fileInput: q('rrb-file-input'),
      loadFileBtn: q('rrb-load-file-btn'),
      loadSampleBtn: q('rrb-load-sample-btn'),
      clearBtn: q('rrb-clear-btn'),
      analyzeBtn: q('rrb-analyze-btn'),
      backBtn: q('rrb-back-btn'),
      reanalyzeBtn: q('rrb-reanalyze-btn'),
      closeResultBtn: q('rrb-close-result-btn'),
      summaryCards: q('rrb-summary-cards'),
      totalClaimsInput: q('rrb-total-claims-input'),
      totalClaimsNote: q('rrb-total-claims-note'),
      tabs: q('rrb-tabs'),
      tabpanel: q('rrb-tabpanel'),
      copyTableBtn: q('rrb-copy-table-btn'),
      copyJsonBtn: q('rrb-copy-json-btn'),
      saveJsonBtn: q('rrb-save-json-btn'),
      saveCsvBtn: q('rrb-save-csv-btn'),
      openReportBtn: q('rrb-open-report-btn'),
      toggleSourceBtn: q('rrb-toggle-source-btn'),
      footerFeedback: q('rrb-footer-feedback'),
      sourceDetails: q('rrb-source-details'),
      sourcePre: q('rrb-source-pre'),
      copyHelper: q('rrb-copy-helper'),
    };

    const state = { result: null, sourceText: '', activeTab: 'overview', claimStructure: null };

    // ---- タイトル ----
    function applyLabel(c) {
      dom.title.textContent = (c && c.label) || '拒絶理由分析';
    }
    applyLabel(cfg);

    // ---- 入力画面の警告 ----
    function showInputWarning(message) {
      dom.inputWarning.textContent = message;
      dom.inputWarning.hidden = false;
    }
    function hideInputWarning() {
      dom.inputWarning.hidden = true;
      dom.inputWarning.textContent = '';
    }

    // ---- 請求項の取得元（任意。alert は使わずインライン表示のみ） ----
    function showClaimSourceMessage(kind, message) {
      dom.claimSourceMessage.className = 'rrb-msg rrb-' + kind;
      dom.claimSourceMessage.textContent = message;
      dom.claimSourceMessage.hidden = false;
    }

    // 入力画面に常時見えるサマリ行 + <details>（既定は閉じる）で請求項構造そのものを表示する。
    // 結果画面「請求項構造」タブと同じ描画関数（buildClaimStructureTable）を再利用する
    function renderClaimStructurePreview() {
      const structure = state.claimStructure;
      if (!structure) {
        dom.claimStructurePreview.hidden = true;
        return;
      }
      const structIssues = (structure.warnings || []).concat(structure.crossChecks || []);
      dom.claimStructureSummary.textContent =
        '総数: ' + structure.totalClaimCount +
        ' ／ 独立請求項: ' + (joinPlain(structure.independentClaims) || 'なし') +
        ' ／ 取得元: ' + (structure.sourceLabel || structure.source || '不明') +
        ' ／ 構造警告: ' + structIssues.length + '件';
      dom.claimStructureDetailsSummary.textContent =
        '請求項構造を表示（' + structure.totalClaimCount + '項）';
      // テキスト入力欄が下に押し出されないよう、取得（再取得）のたびに既定の閉状態へ戻す
      dom.claimStructureDetails.open = false;

      dom.claimStructureWarnings.textContent = '';
      if (structIssues.length > 0) {
        const ul = doc.createElement('ul');
        ul.className = 'rrb-overview-list';
        for (const w of structIssues) {
          const li = doc.createElement('li');
          li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn',
            w.severity === 'error' ? 'エラー' : '警告'));
          li.appendChild(doc.createTextNode(' ' + w.message));
          ul.appendChild(li);
        }
        dom.claimStructureWarnings.appendChild(ul);
      }

      dom.claimStructureTableWrap.textContent = '';
      dom.claimStructureTableWrap.appendChild(buildClaimStructureTable(doc, structure, deps.claims));

      dom.claimStructurePreview.hidden = false;
    }

    function applyClaimStructure(structure, auto) {
      state.claimStructure = structure;
      showClaimSourceMessage('success',
        (auto ? '自動取得: ' : '') +
        '請求項' + structure.totalClaimCount + '件を取得しました（独立請求項: ' +
        (joinPlain(structure.independentClaims) || 'なし') + '／取得元: ' +
        (structure.sourceLabel || structure.source || '不明') + '）。');
      renderClaimStructurePreview();
    }
    function handleCollectClaims() {
      const res = deps.pageClaims.collect(doc);
      if (!res.ok) {
        showClaimSourceMessage('warn', res.error);
        return;
      }
      applyClaimStructure(res.structure);
    }
    // 起動直後の自動取得。ボタン操作を経ないため、失敗してもエラー扱いにせず
    // 情報メッセージに留め、入力画面の表示を絶対に妨げない（例外は握りつぶす）
    function autoCollectClaimsOnLaunch() {
      if (state.claimStructure) return; // 既に取得済みなら上書きしない
      try {
        const res = deps.pageClaims.collect(doc);
        if (res && res.ok) {
          applyClaimStructure(res.structure, true);
        } else {
          showClaimSourceMessage('info',
            '自動取得: ' + ((res && res.error) || '請求項を自動取得できませんでした。'));
        }
      } catch (e) {
        showClaimSourceMessage('info',
          '自動取得: 請求項の取得中にエラーが発生しました。手動で取得するか、下欄に貼り付けてください。');
      }
    }
    function handlePasteClaims() {
      const text = dom.pasteClaimsText.value;
      if (text.trim() === '') {
        showClaimSourceMessage('warn', '請求項全文を貼り付けてください。');
        return;
      }
      const res = deps.pageClaims.fromText(text);
      if (!res.ok) {
        showClaimSourceMessage('warn', res.error);
        return;
      }
      applyClaimStructure(res.structure);
    }

    // ---- タブ ----
    function renderTabs() {
      dom.tabs.textContent = '';
      for (const def of TAB_DEFS) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'rrb-tab-btn';
        btn.textContent = def.label;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(state.activeTab === def.id));
        btn.addEventListener('click', () => {
          if (state.activeTab === def.id) return;
          state.activeTab = def.id;
          renderTabs();
          renderActiveTabPanel();
        });
        dom.tabs.appendChild(btn);
      }
    }

    function renderActiveTabPanel() {
      dom.tabpanel.textContent = '';
      const result = state.result;
      if (!result) return;
      switch (state.activeTab) {
        case 'overview': renderOverviewTab(doc, dom.tabpanel, result); break;
        case 'clarity': renderItemCategoryTab(doc, dom.tabpanel, result, 'clarity', deps.claims); break;
        case 'support': renderItemCategoryTab(doc, dom.tabpanel, result, 'support', deps.claims); break;
        case 'article29': renderArticle29Tab(doc, dom.tabpanel, result, deps.claims); break;
        case 'other': renderItemCategoryTab(doc, dom.tabpanel, result, 'other', deps.claims); break;
        case 'unparsed': renderUnparsedWarningsTab(doc, dom.tabpanel, result); break;
        case 'claimStructure': renderClaimStructureTab(doc, dom.tabpanel, result, deps.claims); break;
        case 'consistency': renderConsistencyTab(doc, dom.tabpanel, result, deps.claims); break;
        case 'omitted': renderOmittedTab(doc, dom.tabpanel, result); break;
        default: break;
      }
    }

    // ---- 画面切替 ----
    function showResultScreen() {
      const claimStats = state.result.metadata.claimStats || {};
      dom.totalClaimsInput.value = claimStats.totalClaimCount != null ? String(claimStats.totalClaimCount) : '';
      dom.totalClaimsNote.textContent = TOTAL_CLAIM_SOURCE_LABEL[claimStats.totalClaimCountSource] || '本文からの推定';
      if (state.result.claimStructure) {
        dom.claimStructureInfo.hidden = true;
        dom.claimStructureInfo.textContent = '';
      } else {
        dom.claimStructureInfo.textContent =
          '請求項構造が未取得のため、指摘漏れ候補と請求項の実在確認は実行されていません。';
        dom.claimStructureInfo.hidden = false;
      }
      renderSummaryCards(doc, dom.summaryCards, state.result, deps.claims);
      renderTabs();
      renderActiveTabPanel();
      dom.sourcePre.textContent = state.sourceText || '';
      dom.sourceDetails.open = false;
      dom.toggleSourceBtn.textContent = '原文全文を表示';
      dom.screenInput.hidden = true;
      dom.screenResult.hidden = false;
    }

    function showInputScreen() {
      dom.screenResult.hidden = true;
      dom.screenInput.hidden = false;
      dom.inputText.focus();
    }

    // ---- 解析 ----
    function runAnalyze() {
      const text = dom.inputText.value;
      if (text.trim() === '') {
        showInputWarning('本文を入力してください。');
        return;
      }
      hideInputWarning();
      let result;
      try {
        result = deps.analyzer.analyze(text, state.claimStructure ? { claimStructure: state.claimStructure } : undefined);
      } catch (e) {
        showInputWarning('解析中にエラーが発生しました: ' + ((e && e.message) || e));
        return;
      }
      result.metadata = result.metadata || {};
      result.metadata.analyzedAt = new Date().toISOString(); // UI側で確定（analyze()自体は空のまま返す決定論仕様）
      state.result = result;
      state.sourceText = text;
      state.activeTab = 'overview';
      showResultScreen();
    }

    // ---- 全請求項数の手動変更 ----
    function handleTotalClaimsChange() {
      const raw = parseInt(dom.totalClaimsInput.value, 10);
      const current = state.result.metadata.claimStats || {};
      if (!Number.isFinite(raw) || raw < 1) {
        dom.totalClaimsInput.value = current.totalClaimCount != null ? String(current.totalClaimCount) : '1';
        return;
      }
      const claimStats = deps.validator.computeClaimStats(state.result, raw);
      // computeClaimStats は純関数で totalClaimCountSource を持たないため、UI 側で明示する
      claimStats.totalClaimCountSource = 'manual';
      state.result.metadata.claimStats = claimStats;
      dom.totalClaimsNote.textContent = TOTAL_CLAIM_SOURCE_LABEL.manual;
      renderSummaryCards(doc, dom.summaryCards, state.result, deps.claims);
    }

    // ---- ファイル読み込み ----
    function handleFileChange() {
      const file = dom.fileInput.files && dom.fileInput.files[0];
      dom.fileInput.value = ''; // 同じファイルを連続で選び直せるようにする
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        dom.inputText.value = String(reader.result == null ? '' : reader.result);
        hideInputWarning();
      };
      reader.onerror = () => {
        showInputWarning('ファイルの読み込みに失敗しました。');
      };
      reader.readAsText(file, 'utf-8');
    }

    // ---- コピー・保存 ----
    let feedbackTimer = null;
    function flashFeedback(message, ok) {
      dom.footerFeedback.textContent = message;
      dom.footerFeedback.classList.toggle('rrb-feedback-ok', ok);
      dom.footerFeedback.classList.toggle('rrb-feedback-ng', !ok);
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        dom.footerFeedback.textContent = '';
        dom.footerFeedback.classList.remove('rrb-feedback-ok', 'rrb-feedback-ng');
      }, 2500);
    }

    function copyText(text) {
      if (!text) return;
      const fallback = () => {
        let ok = false;
        try {
          dom.copyHelper.value = text;
          dom.copyHelper.focus();
          dom.copyHelper.select();
          ok = doc.execCommand('copy');
        } catch (e) {
          ok = false;
        }
        if (win.getSelection) win.getSelection().removeAllRanges();
        flashFeedback(ok ? 'コピーしました ✓' : 'コピーできませんでした。手動でコピーしてください。', ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flashFeedback('コピーしました ✓', true), fallback);
      } else {
        fallback();
      }
    }

    function saveBlob(content, mime, filename) {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function handleCopyTable() {
      copyText(deps.reportTemplate.buildTsv(state.result));
    }
    function handleCopyJson() {
      copyText(JSON.stringify(state.result, null, 2));
    }
    function handleSaveJson() {
      saveBlob(JSON.stringify(state.result, null, 2), 'application/json', 'rejection-analysis.json');
    }
    function handleSaveCsv() {
      // Excel等での文字化けを避けるため UTF-8 BOM（U+FEFF）を付与する（BOM付与はUI側の責務。
      // report-template.buildCsv() 自体は BOM を付けない純関数のまま保つ）
      const BOM = String.fromCharCode(0xfeff);
      saveBlob(BOM + deps.reportTemplate.buildCsv(state.result), 'text/csv;charset=utf-8', 'rejection-analysis.csv');
    }
    function handleOpenReport() {
      const html = deps.reportTemplate.build(state.result);
      let w = null;
      try {
        w = win.open('', '_blank');
      } catch (e) {
        w = null;
      }
      if (w) {
        try {
          w.document.open();
          w.document.write(html);
          w.document.close();
          return;
        } catch (e) {
          // フォールバックへ
        }
      }
      saveBlob(html, 'text/html;charset=utf-8', 'rejection-analysis-report.html');
      flashFeedback('ポップアップがブロックされたため、HTMLファイルとして保存しました', true);
    }
    function handleToggleSource() {
      dom.sourceDetails.open = !dom.sourceDetails.open;
      dom.toggleSourceBtn.textContent = dom.sourceDetails.open ? '原文全文を隠す' : '原文全文を表示';
    }

    // ---- 終了処理 ----
    function onKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return; // IME 変換中の Escape は奪わない
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    }

    function close() {
      dispose();
      host.remove();
    }

    // ページに残した痕跡（イベントリスナ・タイマー）だけを片付ける。
    // ホスト要素が既に文書から外れている場合の作り直しでも使う。
    function dispose() {
      win.removeEventListener('keydown', onKeydown, true);
      clearTimeout(feedbackTimer);
      activeApp = null;
    }

    // ホストがまだ文書に繋がっているか（外れていたら再表示しても見えない）
    function isAttached() {
      return !!(host.isConnected && doc.contains(host));
    }

    function show(c) {
      applyLabel(c);
      (dom.screenResult.hidden ? dom.inputText : dom.totalClaimsInput).focus();
    }

    // ---- 配線 ----
    dom.closeInputBtn.addEventListener('click', close);
    dom.closeInputBtn2.addEventListener('click', close);
    dom.closeResultBtn.addEventListener('click', close);
    win.addEventListener('keydown', onKeydown, true);

    dom.collectClaimsBtn.addEventListener('click', handleCollectClaims);
    dom.pasteClaimsBtn.addEventListener('click', handlePasteClaims);

    dom.loadFileBtn.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', handleFileChange);
    dom.loadSampleBtn.addEventListener('click', () => {
      dom.inputText.value = deps.sampleData.text;
      hideInputWarning();
      dom.inputText.focus();
    });
    dom.clearBtn.addEventListener('click', () => {
      dom.inputText.value = '';
      hideInputWarning();
      dom.inputText.focus();
    });
    dom.analyzeBtn.addEventListener('click', runAnalyze);

    dom.backBtn.addEventListener('click', showInputScreen);
    dom.reanalyzeBtn.addEventListener('click', runAnalyze);

    dom.totalClaimsInput.addEventListener('change', handleTotalClaimsChange);

    dom.copyTableBtn.addEventListener('click', handleCopyTable);
    dom.copyJsonBtn.addEventListener('click', handleCopyJson);
    dom.saveJsonBtn.addEventListener('click', handleSaveJson);
    dom.saveCsvBtn.addEventListener('click', handleSaveCsv);
    dom.openReportBtn.addEventListener('click', handleOpenReport);
    dom.toggleSourceBtn.addEventListener('click', handleToggleSource);

    activeApp = { show, close, dispose, isAttached };

    // 起動直後に請求項構造を自動取得する（ボタンは手動の再取得手段として残す）。
    // 例外や取得失敗があっても入力画面の表示自体は必ず継続する
    autoCollectClaimsOnLaunch();

    dom.inputText.focus();
  }

  return { launch };
});

globalThis.RRB.analyzerApp.launch({"target":"new","label":"拒絶理由分析"});
} catch (e) {
alert('拒絶理由分析: 起動に失敗しました: ' + ((e && e.message) || e));
}
})();
