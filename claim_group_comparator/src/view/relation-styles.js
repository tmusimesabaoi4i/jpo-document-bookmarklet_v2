/*
 * relation-styles.js — 手動関連付け版で足すスタイル
 *
 * 自動関連付け版の styles.js（WORKSPACE_CSS）はそのまま使い、この版だけで必要な分を
 * 後ろに足す。既存版の見た目を変えないよう、既存のクラスの定義は書き換えない。
 * 淡い青を基調とした配色・トークンは styles.js の :root をそのまま引き継ぐ。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.relationStyles = factory();
  }
})(globalThis, function () {
  'use strict';

  const RELATION_CSS = [
    /* ---- 関連バー（段落バーの位置に置く） ---- */
    '.jcgcr-bar{position:sticky;top:var(--jcgc-toolbar-h,96px);z-index:20;background:var(--jcgc-surface);',
    '  border-bottom:1px solid var(--jcgc-line-soft);padding:5px 16px;display:flex;flex-wrap:wrap;',
    '  align-items:center;gap:6px;}',
    '.jcgcr-relbtn{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);border-radius:3px;',
    '  padding:2px 9px;cursor:pointer;font-size:12.5px;}',
    '.jcgcr-relbtn.is-active{background:var(--jcgc-mark);border-color:var(--jcgc-mark-line);font-weight:700;}',
    '.jcgcr-relbtn.is-editing{background:var(--jcgc-accent);border-color:var(--jcgc-accent);color:#fff;}',

    /* ---- 段落のチェックボックス ---- */
    '.jcgcr-check{flex:0 0 auto;margin:.25em 0 0;cursor:pointer;}',
    '.jcgc-seg.is-checked{background:var(--jcgc-accent-weak);border-left-color:var(--jcgc-accent);}',
    '.jcgc-seg.is-checked.is-selected{background:var(--jcgc-mark);}',

    /* ---- 選択中バー（画面下に固定。スクロールしても見える） ---- */
    '.jcgcr-tray{position:fixed;left:0;right:0;bottom:0;z-index:40;background:var(--jcgc-header-2);',
    '  border-top:2px solid var(--jcgc-accent);padding:8px 16px;',
    '  box-shadow:0 -1px 4px rgba(31,111,178,.14);max-height:42vh;overflow-y:auto;}',
    '.jcgcr-tray-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;}',
    '.jcgcr-tray-count{font-weight:700;color:var(--jcgc-accent);}',
    '.jcgcr-tray-list{margin:4px 0 0;padding-left:1.2em;font-size:12.5px;color:var(--jcgc-text);}',
    '.jcgcr-tray-actions{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}',
    '.jcgcr-tray-fields{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:6px;}',
    '.jcgcr-spacer{height:120px;}',

    /* ---- 関連の詳細 ---- */
    '.jcgcr-info{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);',
    '  border-left:4px solid var(--jcgc-mark-line);padding:8px 12px;margin-bottom:12px;}',
    '.jcgcr-info h3{margin:0 0 4px;font-size:14px;}',
    '.jcgcr-info-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;}',
    '.jcgcr-info-list{margin:4px 0 0;padding-left:1.2em;color:var(--jcgc-muted);font-size:12.5px;}',

    /* ---- 書き出し・読み込み ---- */
    '.jcgcr-io{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);',
    '  padding:10px 12px;margin-bottom:12px;}',
    '.jcgcr-io h3{margin:0 0 6px;font-size:14px;}',
    '.jcgcr-io-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;}',
    '.jcgcr-unresolved{color:var(--jcgc-warn);font-size:12.5px;margin:4px 0 0;padding-left:1.2em;}',
    '.jcgcr-preview{margin:4px 0 0;padding-left:1.2em;color:var(--jcgc-muted);font-size:12.5px;}',
  ].join('\n');

  /* 元ページに置く起動ボタンのスタイル（自動版と見分けが付くよう色だけ変える） */
  const RELATION_LAUNCHER_CSS = [
    '#jcgcr-launcher{position:fixed;right:14px;bottom:14px;z-index:2147483000;',
    '  font-family:"Yu Gothic UI","Yu Gothic","Hiragino Kaku Gothic ProN","Meiryo",system-ui,sans-serif;',
    '  font-size:13px;line-height:1.6;}',
    '#jcgcr-launcher .jcgcr-launch-box{background:#eef6fc;border:1px solid #a9c9e2;border-radius:4px;',
    '  padding:8px 10px;box-shadow:0 1px 3px rgba(31,111,178,.18);max-width:340px;}',
    '#jcgcr-launcher button{background:#2f6f8f;color:#fff;border:1px solid #275d78;border-radius:3px;',
    '  padding:6px 14px;cursor:pointer;font:inherit;}',
    '#jcgcr-launcher button:hover{background:#275d78;}',
    '#jcgcr-launcher .jcgcr-launch-msg{margin-top:6px;color:#7a4a12;background:#fdf3e7;',
    '  border:1px solid #e6c9a3;padding:5px 7px;border-radius:3px;}',
    '#jcgcr-launcher .jcgcr-launch-msg:empty{display:none;}',
  ].join('\n');

  return { RELATION_CSS, RELATION_LAUNCHER_CSS };
});
