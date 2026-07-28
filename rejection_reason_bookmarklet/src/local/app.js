'use strict';
/*
 * app.js — ローカル版 UI の初期化。
 *
 * ロジック・モーダル本体はすべて src/bookmarklet/common/analyzer-app.js（RRB.analyzerApp）に
 * 委譲し、このファイルは「モーダルを起動」ボタンの配線だけを担当する。
 *
 * src/core/ のコアモジュールは別エージェントが並行実装中で未整備の場合があるため、
 * ここでは analyzer-app.js の有無だけを確認する（コア不足時のエラー表示は
 * analyzer-app.js 側が launch() 実行時に日本語アラートで行う）。
 */
(function () {
  const btn = document.getElementById('launch-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!globalThis.RRB || !globalThis.RRB.analyzerApp) {
      window.alert('analyzer-app.js の読み込みに失敗しました。ファイル構成と読み込み順を確認してください。');
      return;
    }
    globalThis.RRB.analyzerApp.launch({ label: '拒絶理由分析（ローカル開発版）' });
  });
})();
