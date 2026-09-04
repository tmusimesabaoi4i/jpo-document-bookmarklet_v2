/*
 * normalize.js — 比較用の文字列正規化（DOM 非依存）
 *
 * 「表示は原文のまま、比較だけ正規化」が原則。ここで作るのは **比較専用** の文字列で、
 * 画面に出す本文は絶対にこれを使わない（原文がそのまま読めることが要件）。
 *
 * 正規化するもの:
 *   - Unicode 正規化（NFKC）＝ 全角・半角の統一もこれで済む
 *   - 英字の大文字・小文字の統一（小文字へ）
 *   - 連続する空白・改行・全角空白の整理（比較用は完全除去）
 *     ※段落分割は正規化より **先に** 済ませておくこと
 *   - 句読点・括弧などの装飾文字の除去
 *   - 解析表示用の番号（[1-1] 等）の除去
 *   - 数字表記（漢数字 → 算用数字）
 *   - 「前記」の削除（「前記◯◯」と「◯◯」を同じ語として扱うため）
 *
 * **辞書を持たない。** 定型語の一覧・ストップワード辞書・技術用語辞書・案件別辞書は作らない。
 * 例外は「前記」だけで、これは日本語クレームの参照表現そのものなので単独で扱う。
 *
 * 引用表現（「請求項◯に記載の…」）だけは citation.js が本文から見つけた範囲を丸ごと落とす。
 * これは語の一覧ではなく、その文書の記載から求めた位置に対する構造的な処理で、
 * 「引用先が違うだけ」の請求項を遠ざけないために必要（引用関係は補助情報として別に使う）。
 *
 * 正規化しないもの（意図的）:
 *   - 送信/受信、同じ/異なる のような意味的な違い。まさにそれを人が見つけるための道具なので、
 *     機械的に潰してはいけない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./citation'));
  } else {
    root.JCGC = root.JCGC || {};
    if (!root.JCGC.citation) throw new Error('JCGC.citation が未読み込みです（連結順を確認）');
    root.JCGC.normalize = factory(root.JCGC.citation);
  }
})(globalThis, function (citation) {
  'use strict';

  const KANJI_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  // 日本語クレームの参照表現。唯一これだけを個別に落とす（辞書ではない）
  const REFERENCE_PREFIX = /前記/g;

  /*
   * 句読点・括弧・記号。**長音符（ー）とダッシュ類は落とさない**
   * ——「レポート」が「レポト」になるなど、カタカナ語そのものを壊してしまうため。
   */
  const PUNCTUATION = /[、。，．・：；「」『』（）()［］[\]【】〔〕｛｝{}"'`,.:;!?！？…]/g;

  // 表示用番号 [12-3] を落とす。claimNumber を渡したときはその請求項の番号だけを対象にする
  function stripDisplayNumbers(text, claimNumber) {
    const src = String(text == null ? '' : text);
    if (claimNumber == null) return src.replace(/\[\d+-\d+\]/g, '');
    const re = new RegExp('\\[' + String(claimNumber) + '-\\d+\\]', 'g');
    return src.replace(re, '');
  }

  // 漢数字 → 算用数字（十の位まで。比較用なので厳密な数詞解析はしない）
  function kanjiDigitsToArabic(text) {
    let out = String(text == null ? '' : text);
    out = out.replace(/([一二三四五六七八九])?十([一二三四五六七八九])?/g, (m, tens, ones) => {
      const t = tens ? KANJI_DIGIT[tens] : 1;
      const o = ones ? KANJI_DIGIT[ones] : 0;
      return String(t * 10 + o);
    });
    out = out.replace(/[〇零一二三四五六七八九]/g, (c) => String(KANJI_DIGIT[c]));
    return out;
  }

  function toNfkc(text) {
    const src = String(text == null ? '' : text);
    return typeof src.normalize === 'function' ? src.normalize('NFKC') : src;
  }

  /*
   * 比較用文字列を作る。請求項全文にも段落にも同じものを使う。
   * options: { claimNumber, keepCitations }
   */
  function normalizeForCompare(text, options) {
    const opts = options || {};
    let out = String(text == null ? '' : text);
    out = stripDisplayNumbers(out, opts.claimNumber);
    if (!opts.keepCitations) out = citation.stripCitations(out);
    out = toNfkc(out);
    out = out.toLowerCase();
    out = kanjiDigitsToArabic(out);
    out = out.replace(/[\s　]+/g, '');
    out = out.replace(PUNCTUATION, '');
    out = out.replace(REFERENCE_PREFIX, '');
    return out;
  }

  // 段落 1 つ分の比較用文字列（請求項全文と同じ正規化）
  function normalizeSegment(text, options) {
    return normalizeForCompare(text, options);
  }

  /*
   * 単語の切り出し。漢字・カタカナ・英数の連なり（2文字以上）を語とみなす。
   * ひらがなが自然な区切りになるので、形態素解析も辞書も要らない。
   */
  // 長音符（ー）はカタカナ語の一部なので語に含める（「レポート」を割らない）
  const TERM_RE = /[一-鿿々ァ-ヺーｦ-ﾝa-z0-9]{2,}/g;

  function keyTerms(normalized) {
    const out = new Set();
    const src = String(normalized == null ? '' : normalized);
    let m;
    TERM_RE.lastIndex = 0;
    while ((m = TERM_RE.exec(src)) !== null) {
      const w = m[0];
      out.add(w);
      // 長い連なりは 3 文字の部分語にも割る（複合語の部分一致を拾うため）
      if (w.length > 4) {
        for (let i = 0; i + 3 <= w.length; i += 1) out.add(w.slice(i, i + 3));
      }
    }
    return out;
  }

  return {
    stripDisplayNumbers,
    kanjiDigitsToArabic,
    toNfkc,
    normalizeForCompare,
    normalizeSegment,
    keyTerms,
    REFERENCE_PREFIX,
  };
});
