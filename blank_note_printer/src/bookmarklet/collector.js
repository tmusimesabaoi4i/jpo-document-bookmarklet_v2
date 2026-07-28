/*
 * collector.js — 編集用ソース（手編集。自動生成バナーは付けない）
 *
 * JPO 文書一覧ページから出願番号（#lappnum）を取得し、完全に空白の A4 ページを
 * PAGE_COUNT 枚並べた印刷用ウィンドウを開いて print() する。ブラウザの
 * 「PDF に保存」で初期ファイル名が「出願番号_note.pdf」になることを狙う。
 *
 * 反映手順: 編集後、collector.bookmarklet.js へ手動で 1 行化して反映する。
 *   1. 全体を javascript: プレフィックス付きの 1 行にする
 *   2. エンコード順序: % → %25、# → %23、改行 → %0A（% を最初に潰すこと）
 */
(function () {
  'use strict';

  const PAGE_COUNT = 30; // 空白ページの枚数（ここを変えるとページ数が変わる）
  const VIEWER_NAME = 'JPO_NOTE_VIEWER';

  const txt = (s) => { const e = document.querySelector(s); return e ? (e.innerText || '').trim() : ''; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const sanitize = (s) => (s == null || s === '' ? 'noname' : String(s)).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();

  const appNo = txt('#lappnum');
  if (!appNo) {
    alert('出願番号（#lappnum）が見つかりません。\nJPO の文書一覧ページで実行してください。');
    return;
  }

  const title = sanitize(appNo) + '_note';
  if (!confirm(title + '（空白A4×' + PAGE_COUNT + '枚）を印刷します。よろしいですか？')) return;

  // 中身が完全に空のページ箱を並べ、CSS の改ページだけで PAGE_COUNT 枚に区切る。
  // margin:0 のためブラウザのヘッダ/フッタ（URL・日付）も印字されない。
  function buildNoteHTML() {
    const pages = new Array(PAGE_COUNT).fill('<div class="page"></div>').join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>' +
      '@page{size:A4;margin:0;}' +
      'html,body{margin:0;padding:0;}' +
      '.page{height:100vh;break-after:page;page-break-after:always;}' +
      '.page:last-child{break-after:auto;page-break-after:auto;}' + // 末尾に余分な空白ページを増やさない
      '</style></head><body>' + pages + '</body></html>';
  }

  function waitReady(win) {
    return new Promise((resolve) => {
      const tick = () => {
        try {
          if (win.document && win.document.readyState === 'complete') { resolve(); return; }
        } catch (_) { /* noop */ }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  // 名前付きウィンドウを再利用するため、二重実行してもウィンドウは増えない
  if (!window.__JPO_NOTE_VIEWER || window.__JPO_NOTE_VIEWER.closed) {
    window.__JPO_NOTE_VIEWER = window.open('', VIEWER_NAME);
    if (!window.__JPO_NOTE_VIEWER) {
      alert('ポップアップがブロックされています。\nこのサイトのポップアップを許可してから再実行してください。');
      return;
    }
  }
  const v = window.__JPO_NOTE_VIEWER;
  v.document.open();
  v.document.write(buildNoteHTML());
  v.document.close();
  waitReady(v).then(() => {
    v.focus();
    v.print(); // 保存後もウィンドウは開いたまま（閉じるのはユーザー操作）
  });
})();
