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
