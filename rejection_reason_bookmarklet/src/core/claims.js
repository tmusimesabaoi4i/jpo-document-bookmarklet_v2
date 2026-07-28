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
