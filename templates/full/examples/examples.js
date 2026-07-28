'use strict';
/*
 * examples.js — ロジックのゴールデンケース（入力と期待出力）
 * 対象ページのスナップショットはここではなく、リポジトリ共有の fixtures/ に置く。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    // TODO(template): プロジェクトの名前空間に合わせる
    root.TODO_NS = root.TODO_NS || {};
    root.TODO_NS.examples = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {
    // TODO(template): 入力データと期待出力（ゴールデンケース）を定義する
    cases: [],
  };
});
