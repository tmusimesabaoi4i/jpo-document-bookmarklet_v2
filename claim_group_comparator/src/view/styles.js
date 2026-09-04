/*
 * styles.js — 比較タブのスタイル（1 本の CSS 文字列）
 *
 * 白と淡い青を基調にした業務用ツールの見た目。濃紺ヘッダー・強い影・過度な角丸は使わない。
 * すべてのクラス・ID に jcgc- 接頭辞を付け、元ページにも他のタブにも干渉しないようにする。
 * 外部フォント・CDN は使わない（オフラインで完結）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.styles = factory();
  }
})(globalThis, function () {
  'use strict';

  const WORKSPACE_CSS = [
    /* ---- 基本 ---- */
    ':root{',
    '  --jcgc-bg:#f7fafd; --jcgc-surface:#ffffff; --jcgc-header:#dfeefb; --jcgc-header-2:#eef6fc;',
    '  --jcgc-line:#c3d6e4; --jcgc-line-soft:#dce8f1; --jcgc-text:#1d2b36; --jcgc-muted:#5b7488;',
    '  --jcgc-accent:#1f6fb2; --jcgc-accent-weak:#e4f0fa; --jcgc-mark:#fff3bf; --jcgc-mark-line:#e8c95a;',
    '  --jcgc-warn:#a4442c; --jcgc-manual:#7a4fb5;',
    '}',
    '*{box-sizing:border-box;}',
    'html,body{margin:0;padding:0;}',
    'body{background:var(--jcgc-bg);color:var(--jcgc-text);',
    '  font-family:"Yu Gothic UI","Yu Gothic","Hiragino Kaku Gothic ProN","Meiryo",system-ui,sans-serif;',
    '  font-size:13.5px;line-height:1.7;-webkit-text-size-adjust:100%;}',
    'button,select,input,textarea{font:inherit;color:inherit;}',

    /* ---- ヘッダー（縦スクロールしても残る） ---- */
    '.jcgc-header{position:sticky;top:0;z-index:30;background:var(--jcgc-header);',
    '  border-bottom:1px solid var(--jcgc-line);padding:8px 16px;}',
    '.jcgc-header-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}',
    '.jcgc-title{font-size:16px;font-weight:700;margin:0;letter-spacing:.02em;}',
    '.jcgc-meta{color:var(--jcgc-muted);font-size:12px;}',
    '.jcgc-tabs{display:flex;gap:4px;margin-left:auto;}',
    '.jcgc-tab{background:var(--jcgc-header-2);border:1px solid var(--jcgc-line);',
    '  border-bottom-color:transparent;padding:4px 14px;cursor:pointer;border-radius:3px 3px 0 0;}',
    '.jcgc-tab.is-active{background:var(--jcgc-surface);font-weight:700;color:var(--jcgc-accent);}',

    /* ---- 操作バー ---- */
    '.jcgc-toolbar{position:sticky;top:var(--jcgc-header-h,48px);z-index:25;background:var(--jcgc-header-2);',
    '  border-bottom:1px solid var(--jcgc-line);padding:6px 16px;display:flex;flex-wrap:wrap;',
    '  align-items:center;gap:8px 14px;}',
    '.jcgc-field{display:flex;align-items:center;gap:5px;}',
    '.jcgc-field > label{color:var(--jcgc-muted);font-size:12px;white-space:nowrap;}',
    '.jcgc-select,.jcgc-input,.jcgc-textarea{background:var(--jcgc-surface);border:1px solid var(--jcgc-line);',
    '  border-radius:3px;padding:3px 6px;max-width:100%;}',
    '.jcgc-select{max-width:min(46vw,560px);}',
    '.jcgc-textarea{width:100%;min-height:84px;font-family:ui-monospace,Consolas,"Courier New",monospace;',
    '  font-size:12.5px;line-height:1.6;resize:vertical;}',
    '.jcgc-btn{background:var(--jcgc-surface);border:1px solid var(--jcgc-line);border-radius:3px;',
    '  padding:3px 10px;cursor:pointer;white-space:nowrap;}',
    '.jcgc-btn:hover{background:var(--jcgc-accent-weak);}',
    '.jcgc-btn.is-primary{background:var(--jcgc-accent);border-color:var(--jcgc-accent);color:#fff;}',
    '.jcgc-btn.is-primary:hover{background:#1a5f99;}',
    '.jcgc-btn.is-active{background:var(--jcgc-accent);border-color:var(--jcgc-accent);color:#fff;}',
    '.jcgc-btn.is-danger{color:var(--jcgc-warn);border-color:#e0bcb2;}',
    '.jcgc-btn[disabled]{opacity:.45;cursor:default;}',
    '.jcgc-btn-group{display:flex;gap:0;}',
    '.jcgc-btn-group .jcgc-btn{border-radius:0;margin-left:-1px;}',
    '.jcgc-btn-group .jcgc-btn:first-child{border-radius:3px 0 0 3px;margin-left:0;}',
    '.jcgc-btn-group .jcgc-btn:last-child{border-radius:0 3px 3px 0;}',

    /* ---- 段落選択バー ---- */
    '.jcgc-segbar{position:sticky;top:var(--jcgc-toolbar-h,96px);z-index:20;background:var(--jcgc-surface);',
    '  border-bottom:1px solid var(--jcgc-line-soft);padding:5px 16px;display:flex;flex-wrap:wrap;',
    '  align-items:center;gap:6px;}',
    '.jcgc-segbtn{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);border-radius:3px;',
    '  padding:2px 9px;cursor:pointer;font-size:12.5px;}',
    '.jcgc-segbtn.is-active{background:var(--jcgc-mark);border-color:var(--jcgc-mark-line);font-weight:700;}',

    /* ---- 本文 ---- */
    '.jcgc-main{padding:12px 16px 64px;}',
    '.jcgc-groupinfo{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);',
    '  border-left:4px solid var(--jcgc-accent);padding:8px 12px;margin-bottom:12px;}',
    '.jcgc-groupinfo h2{margin:0 0 4px;font-size:14px;}',
    '.jcgc-badge{display:inline-block;border:1px solid var(--jcgc-line);border-radius:2px;',
    '  padding:0 6px;font-size:11.5px;color:var(--jcgc-muted);background:var(--jcgc-header-2);',
    '  margin-left:6px;overflow-wrap:anywhere;}',
    '.jcgc-badge.is-manual{color:var(--jcgc-manual);border-color:#d6c6ea;background:#f5eefc;}',
    '.jcgc-badge.is-candidate{color:#7a5a12;border-color:#e6d3a3;background:#fdf7e7;}',
    '.jcgc-reasons{margin:4px 0 0;padding-left:1.2em;color:var(--jcgc-muted);font-size:12.5px;}',
    '.jcgc-note{color:var(--jcgc-muted);font-size:11.5px;margin-top:4px;}',
    '.jcgc-empty{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);padding:24px;text-align:center;',
    '  color:var(--jcgc-muted);}',

    /* ---- カードグリッド（列数は JS が --jcgc-cols で与える） ---- */
    '.jcgc-grid{display:grid;grid-template-columns:repeat(var(--jcgc-cols,3),minmax(0,1fr));',
    '  gap:var(--jcgc-gap,16px);align-items:start;}',
    '.jcgc-grid.is-single{max-width:900px;margin:0 auto;}',
    '.jcgc-card{background:var(--jcgc-surface);border:1px solid var(--jcgc-line);border-radius:3px;',
    '  overflow-wrap:anywhere;}',
    // 追加候補のカードは、正式メンバーと見分けが付くように破線＋淡い地色にする
    '.jcgc-card.is-candidate{border-style:dashed;border-color:#e0c48f;background:#fffdf7;}',
    '.jcgc-card.is-candidate .jcgc-card-head{background:#fdf7e7;}',
    // カード見出しは、上のバー群の下で止まるように sticky の基準をずらす
    '.jcgc-card-head{background:var(--jcgc-header-2);border-bottom:1px solid var(--jcgc-line-soft);',
    '  padding:5px 10px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;',
    '  position:sticky;top:var(--jcgc-segbar-h,136px);z-index:5;}',
    '.jcgc-card-no{font-weight:700;font-size:14px;color:var(--jcgc-accent);}',
    '.jcgc-card-tags{color:var(--jcgc-muted);font-size:12px;}',
    '.jcgc-segs{list-style:none;margin:0;padding:4px 0;}',
    '.jcgc-seg{display:flex;gap:8px;padding:3px 10px;cursor:pointer;border-left:3px solid transparent;}',
    '.jcgc-seg:hover{background:#f2f8fd;}',
    '.jcgc-seg-no{flex:0 0 1.6em;color:var(--jcgc-muted);font-size:11.5px;text-align:right;',
    '  padding-top:.15em;user-select:none;}',
    '.jcgc-seg-text{flex:1 1 auto;white-space:pre-wrap;}',
    '.jcgc-seg[data-depth="2"] .jcgc-seg-text{padding-left:1.2em;}',
    '.jcgc-seg[data-depth="3"] .jcgc-seg-text{padding-left:2.4em;}',
    '.jcgc-seg.is-selected{background:var(--jcgc-mark);border-left-color:var(--jcgc-mark-line);}',
    '.jcgc-missing{margin:0;padding:3px 10px 6px;color:var(--jcgc-muted);font-size:12px;font-style:normal;}',

    /* 選択段落を強調 / 選択段落のみ */
    '.jcgc-grid.is-dim .jcgc-seg:not(.is-selected){opacity:.32;}',
    '.jcgc-grid.is-only .jcgc-seg:not(.is-selected){display:none;}',
    '.jcgc-grid.is-only .jcgc-card-head{position:static;}',

    /* 密度 */
    '.jcgc-density-compact .jcgc-grid{--jcgc-gap:10px;}',
    '.jcgc-density-compact .jcgc-seg-text{font-size:12.5px;}',
    '.jcgc-density-normal .jcgc-grid{--jcgc-gap:16px;}',
    '.jcgc-density-roomy .jcgc-grid{--jcgc-gap:22px;}',
    '.jcgc-density-roomy .jcgc-seg{padding:6px 14px;}',
    '.jcgc-density-roomy .jcgc-seg-text{font-size:15px;}',

    /* ---- グループ編集 ---- */
    '.jcgc-grouplist{display:flex;flex-direction:column;gap:8px;}',
    '.jcgc-grouprow{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);padding:8px 12px;}',
    '.jcgc-grouprow.is-editing{border-color:var(--jcgc-accent);border-left:4px solid var(--jcgc-accent);}',
    '.jcgc-grouprow-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;}',
    '.jcgc-grouprow-name{font-weight:700;}',
    '.jcgc-grouprow-nums{color:var(--jcgc-muted);font-size:12.5px;overflow-wrap:anywhere;}',
    '.jcgc-grouprow-actions{margin-left:auto;display:flex;flex-wrap:wrap;gap:4px;}',
    '.jcgc-editor{border-top:1px dashed var(--jcgc-line-soft);margin-top:8px;padding-top:8px;',
    '  display:flex;flex-direction:column;gap:8px;}',
    '.jcgc-editor-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;}',
    '.jcgc-editor-label{color:var(--jcgc-muted);font-size:12px;min-width:7em;}',
    // チップ置き場は行の残り幅いっぱいを使って内部で折り返す（横へはみ出させない）
    '.jcgc-chips{display:flex;flex-wrap:wrap;gap:5px;min-height:30px;padding:3px;',
    '  flex:1 1 320px;min-width:0;border:1px dashed var(--jcgc-line-soft);border-radius:3px;}',
    '.jcgc-chip{display:inline-flex;align-items:center;gap:4px;background:var(--jcgc-accent-weak);',
    '  border:1px solid var(--jcgc-line);border-radius:3px;padding:1px 4px 1px 8px;cursor:grab;}',
    '.jcgc-chip.is-dragging{opacity:.45;}',
    '.jcgc-chip.is-candidate{background:#fdf7e7;border-color:#e0c48f;border-style:dashed;cursor:default;}',
    '.jcgc-chip.is-dropbefore{box-shadow:-3px 0 0 var(--jcgc-accent);}',
    '.jcgc-chip-x{border:0;background:transparent;cursor:pointer;color:var(--jcgc-warn);padding:0 3px;}',
    '.jcgc-chip-move{border:0;background:transparent;cursor:pointer;color:var(--jcgc-muted);padding:0 1px;}',
    '.jcgc-pool{display:flex;flex-wrap:wrap;gap:5px;max-height:170px;overflow-y:auto;padding:3px;',
    '  flex:1 1 100%;min-width:0;border:1px solid var(--jcgc-line-soft);border-radius:3px;background:#fbfdff;}',
    '.jcgc-pool .jcgc-chip{cursor:pointer;background:var(--jcgc-surface);}',
    '.jcgc-errors{color:var(--jcgc-warn);font-size:12.5px;margin:0;padding-left:1.2em;}',
    '.jcgc-ok{color:#1f6f4a;font-size:12.5px;}',
    '.jcgc-section{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);',
    '  padding:10px 12px;margin-bottom:12px;}',
    '.jcgc-section h2{margin:0 0 6px;font-size:14px;}',
    '.jcgc-hidden{display:none !important;}',
    '.jcgc-banner{background:#fdf3e7;border:1px solid #e6c9a3;color:#7a4a12;padding:6px 16px;font-size:12.5px;}',

    /* 狭い画面 */
    '@media (max-width:820px){',
    '  .jcgc-header,.jcgc-toolbar,.jcgc-segbar,.jcgc-main{padding-left:10px;padding-right:10px;}',
    '  .jcgc-select{max-width:70vw;}',
    '}',
    '@media print{',
    '  .jcgc-toolbar,.jcgc-segbar,.jcgc-tabs{display:none;}',
    '  .jcgc-header{position:static;}',
    '  .jcgc-card{break-inside:avoid;}',
    '}',
  ].join('\n');

  /* 元ページに置く起動ボタンのスタイル（最小限・接頭辞つき） */
  const LAUNCHER_CSS = [
    '#jcgc-launcher{position:fixed;right:14px;bottom:14px;z-index:2147483000;',
    '  font-family:"Yu Gothic UI","Yu Gothic","Hiragino Kaku Gothic ProN","Meiryo",system-ui,sans-serif;',
    '  font-size:13px;line-height:1.6;}',
    '#jcgc-launcher .jcgc-launch-box{background:#eef6fc;border:1px solid #a9c9e2;border-radius:4px;',
    '  padding:8px 10px;box-shadow:0 1px 3px rgba(31,111,178,.18);max-width:320px;}',
    '#jcgc-launcher button{background:#1f6fb2;color:#fff;border:1px solid #1a5f99;border-radius:3px;',
    '  padding:6px 14px;cursor:pointer;font:inherit;}',
    '#jcgc-launcher button:hover{background:#1a5f99;}',
    '#jcgc-launcher .jcgc-launch-msg{margin-top:6px;color:#7a4a12;background:#fdf3e7;',
    '  border:1px solid #e6c9a3;padding:5px 7px;border-radius:3px;}',
    '#jcgc-launcher .jcgc-launch-msg:empty{display:none;}',
  ].join('\n');

  return { WORKSPACE_CSS, LAUNCHER_CSS };
});
