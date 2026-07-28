/*
 * formatter.js — 請求項番号リストを起案文向けの表記に整形する（DOM非依存の純粋モジュール）
 *
 * 表記規則:
 *   - 重複を除去し昇順に並べる
 *   - 2つ以上連続する番号は「先頭-末尾」（ハイフンは半角 U+002D）
 *   - 連続しないまとまり同士は読点「、」（U+3001）で区切る
 *   - 数字は全角（U+FF10〜U+FF19）
 * 例: [2,3,4,5,6,7,9,10,11] → "２-７、９-１１"
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.CRW = root.CRW || {};
    root.CRW.formatter = factory();
  }
})(globalThis, function () {
  'use strict';

  function toFullWidthDigits(text) {
    return String(text).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  }

  function formatClaimNumbers(numbers) {
    const sorted = [...new Set(numbers || [])].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      parts.push(j > i ? sorted[i] + '-' + sorted[j] : String(sorted[i]));
      i = j + 1;
    }
    return toFullWidthDigits(parts.join('、'));
  }

  return { toFullWidthDigits, formatClaimNumbers };
});
