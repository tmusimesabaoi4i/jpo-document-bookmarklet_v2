/*
 * layout.js — カードの列数と表示密度（DOM 非依存・純関数）
 *
 * 「カード数だけを見た if 文」で列数を決めない。使える画面幅・カードの最小幅・
 * カード数の 3 つから自然に決める。最大 4 枚のような上限は設けず、
 * 1 グループ 100 枚まで折り返して縦スクロールで読む。
 *
 * 決め方:
 *   幅から入る上限   maxByWidth = floor((width - padding + gap) / (minCardWidth + gap))
 *   読みやすさの上限 softCap(n)  … 少数枚では列を増やしすぎない
 *   列数 = clamp(1, min(cardCount, maxByWidth, softCap), …)
 *
 * softCap は「枚数に対して自然な列数」の緩い天井で、幅が足りなければ常に幅が勝つ。
 *   1〜4 枚 … その枚数まで（1枚なら1列＝中央に読みやすい幅で置く）
 *   5〜8 枚 … 4 列まで
 *   9 枚〜  … 6 列まで
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.layout = factory();
  }
})(globalThis, function () {
  'use strict';

  // 表示密度ごとの「カードがこれ以上細くなると読めない」幅（px）
  const DENSITIES = {
    compact: { key: 'compact', label: 'コンパクト', minCardWidth: 250, gap: 10, fontSize: 12.5, cardPadding: 8 },
    normal: { key: 'normal', label: '標準', minCardWidth: 300, gap: 16, fontSize: 13.5, cardPadding: 12 },
    roomy: { key: 'roomy', label: 'ゆったり', minCardWidth: 380, gap: 22, fontSize: 15, cardPadding: 16 },
  };

  const PAGE_PADDING = 32; // 本文左右の余白合計（styles.js と揃える）
  const SINGLE_CARD_MAX_WIDTH = 900; // 1 枚のときの読みやすい最大幅

  function getDensity(key) {
    return DENSITIES[key] || DENSITIES.normal;
  }

  function softCap(cardCount) {
    if (cardCount <= 4) return Math.max(1, cardCount);
    if (cardCount <= 8) return 4;
    return 6;
  }

  /*
   * options: { viewportWidth, cardCount, density, columns ('auto' | 数値) }
   * → { columns, minCardWidth, gap, maxByWidth, softCap, singleMaxWidth }
   */
  function computeLayout(options) {
    const opts = options || {};
    const density = getDensity(opts.density);
    const cardCount = Math.max(0, Number(opts.cardCount) || 0);
    const width = Math.max(320, Number(opts.viewportWidth) || 1280);
    const usable = Math.max(density.minCardWidth, width - PAGE_PADDING);
    const maxByWidth = Math.max(1, Math.floor((usable + density.gap) / (density.minCardWidth + density.gap)));

    let columns;
    const requested = Number(opts.columns);
    if (opts.columns && opts.columns !== 'auto' && Number.isFinite(requested) && requested >= 1) {
      // 明示指定でも、幅が足りないときは読めなくならないよう幅を優先する
      columns = Math.max(1, Math.min(requested, maxByWidth, Math.max(1, cardCount)));
    } else {
      columns = Math.max(1, Math.min(cardCount || 1, maxByWidth, softCap(cardCount)));
    }

    return {
      columns,
      minCardWidth: density.minCardWidth,
      gap: density.gap,
      fontSize: density.fontSize,
      cardPadding: density.cardPadding,
      maxByWidth,
      softCap: softCap(cardCount),
      densityKey: density.key,
      singleMaxWidth: SINGLE_CARD_MAX_WIDTH,
      // 1 枚だけのときは中央に読みやすい幅で置く
      centered: columns === 1 && cardCount === 1,
    };
  }

  return { computeLayout, getDensity, softCap, DENSITIES, PAGE_PADDING, SINGLE_CARD_MAX_WIDTH };
});
