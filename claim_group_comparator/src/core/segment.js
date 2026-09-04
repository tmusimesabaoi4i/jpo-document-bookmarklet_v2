/*
 * segment.js — 請求項本文の段落（構成要件）分割（DOM 非依存）
 *
 * 重要: **正規化する前の原文** から段落境界を取る。空白を潰してから分割しようとすると
 * 境界が消えるため（要件どおり、抽出 → 分割 → 正規化 の順を守る）。
 *
 * 優先順位:
 *   1. 元の改行（<br> 由来の \n）
 *   2. 全角空白（U+3000）の連なり = 構成要件区切り。連なりの長さをインデント深さとして持つ
 *   3. 行頭の半角インデント
 *   （ここまでで区切れたら、これ以上は分けない）
 *   4. どれも取れないときだけ、句点・読点によるフォールバック分割
 *
 * 極端に短い断片（MIN_LENGTH 未満）は直前（無ければ直後）の段落へ結合する。
 * 「方法。」「装置。」のような末尾のカテゴリー宣言はこれで前の段落に吸収され、
 * 請求項どうしの段落数が比べやすくなる。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.segment = factory();
  }
})(globalThis, function () {
  'use strict';

  // これ未満の断片は前後へ結合する（文字数）
  const MIN_LENGTH = 8;
  // フォールバック分割で読点を区切りとみなす最小の蓄積長
  const FALLBACK_MIN_LENGTH = 60;

  const IDEOGRAPHIC_SPACE = '　';

  function isBlank(s) {
    return String(s).replace(/[\s　]/g, '') === '';
  }

  // 区切り文字列 → インデント深さ（全角空白の個数。半角インデントだけなら 1）
  function depthOf(sep) {
    let full = 0;
    for (const ch of sep) if (ch === IDEOGRAPHIC_SPACE) full += 1;
    if (full > 0) return full;
    return /[ \t]{2,}/.test(sep) ? 1 : 0;
  }

  /*
   * 原文を「素片（piece）」へ割る。piece = { text, sep, depth }
   *   sep   … その素片の直前にあった区切り文字列（結合時に復元するため保持）
   *   depth … 全角空白の連なりの長さ（0 = 行頭）
   */
  function splitPieces(text) {
    const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const pieces = [];
    const lines = src.split('\n');

    for (let li = 0; li < lines.length; li += 1) {
      const line = lines[li];
      // 行頭の半角インデントも区切りとして扱う
      const re = /[　]+|^[ \t]{2,}/g;
      let cursor = 0;
      let pendingSep = li === 0 ? '' : '\n';
      let m;
      while ((m = re.exec(line)) !== null) {
        const chunk = line.slice(cursor, m.index);
        if (isBlank(chunk)) {
          // 素片が空なら区切りを繋いで持ち越す（連なりの長さがそのまま深さになる）
          pendingSep += chunk + m[0];
        } else {
          pieces.push({ text: chunk, sep: pendingSep, depth: depthOf(pendingSep) });
          pendingSep = m[0];
        }
        cursor = m.index + m[0].length;
      }
      const tail = line.slice(cursor);
      if (!isBlank(tail)) pieces.push({ text: tail, sep: pendingSep, depth: depthOf(pendingSep) });
    }

    return pieces;
  }

  /*
   * 区切りが 1 つも取れなかったときのフォールバック。
   * 句点で必ず切り、読点は蓄積が FALLBACK_MIN_LENGTH 以上のときだけ切る。
   */
  function fallbackSplit(text) {
    const src = String(text == null ? '' : text);
    const out = [];
    let buf = '';
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      buf += ch;
      if (ch === '。') {
        out.push(buf);
        buf = '';
      } else if ((ch === '、' || ch === '，') && buf.length >= FALLBACK_MIN_LENGTH) {
        out.push(buf);
        buf = '';
      }
    }
    if (!isBlank(buf)) out.push(buf);
    return out.filter((s) => !isBlank(s)).map((s, i) => ({ text: s, sep: i === 0 ? '' : '', depth: 0 }));
  }

  // 短すぎる素片を前（無ければ後ろ）へ結合する
  function mergeShort(pieces, minLength) {
    const limit = minLength == null ? MIN_LENGTH : minLength;
    const out = [];
    for (const piece of pieces) {
      const len = piece.text.replace(/[\s　]/g, '').length;
      if (len < limit && out.length > 0) {
        const prev = out[out.length - 1];
        prev.text = prev.text + piece.sep + piece.text;
        continue;
      }
      out.push({ text: piece.text, sep: piece.sep, depth: piece.depth });
    }
    // 先頭が短いままなら次へ吸収させる
    if (out.length > 1) {
      const firstLen = out[0].text.replace(/[\s　]/g, '').length;
      if (firstLen < limit) {
        out[1].text = out[0].text + out[1].sep + out[1].text;
        out[1].depth = out[0].depth;
        out.shift();
      }
    }
    return out;
  }

  /*
   * 請求項本文 → 段落配列
   * options: { minLength }
   * → [{ index, text, depth, source }]（index は 1 始まりの表示用番号）
   */
  function splitSegments(text, options) {
    const opts = options || {};
    let pieces = splitPieces(text);
    let source = 'structural';
    if (pieces.length <= 1) {
      const fallback = fallbackSplit(pieces.length === 1 ? pieces[0].text : text);
      if (fallback.length > 1) {
        pieces = fallback;
        source = 'fallback';
      }
    }
    const merged = mergeShort(pieces, opts.minLength);
    return merged.map((p, i) => ({
      index: i + 1,
      text: p.text.replace(/^[\s　]+|[\s　]+$/g, ''),
      depth: p.depth,
      source,
    })).filter((s) => s.text !== '');
  }

  return { splitSegments, splitPieces, fallbackSplit, mergeShort, MIN_LENGTH };
});
