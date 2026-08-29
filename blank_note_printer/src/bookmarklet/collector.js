/*
 * collector.js — 編集用ソース（手編集。自動生成バナーは付けない）
 *
 * JPO 文書一覧ページから出願番号を取得し、完全に空白の A4 ページを PAGE_COUNT 枚
 * 並べた印刷用ウィンドウを開いて print() する。ブラウザの「PDF に保存」で
 * 初期ファイル名が「出願番号_note.pdf」になることを狙う。
 *
 * 出願番号の取得（3 節）は #lappnum の表示文字列だけに頼らない。2026 年の新 JPO
 * ページでは #lappnum のリンク文言が「Evrikaでスクリーニング」に変わっており、
 * これをファイル名に使うと誤名になるため、優先順位付きのフォールバックで解決する。
 *
 * この解決ロジックの考え方は document_downloader/src/bookmarklet/collector.js の
 * resolveAppNo() から取り込んだ（コピー）。ルート README「プロジェクト間の独立性」に
 * 従い実行時参照はしない。JPO ページの DOM が変わったときは、どちらも直すか判断すること。
 *
 * 反映手順: 編集後、collector.bookmarklet.js へ手動で 1 行化して反映する。
 *   1. 全体を javascript: プレフィックス付きの 1 行にする
 *   2. エンコード順序: % → %25、# → %23、改行 → %0A（% を最初に潰すこと）
 *   ずれていれば tests/bookmarklet.test.js が失敗する。
 */
(function () {
  'use strict';

  var PAGE_COUNT = 30; // 空白ページの枚数（ここを変えるとページ数が変わる）
  var VIEWER_NAME = 'JPO_NOTE_VIEWER';

  /* ============================================================
   * 1. 文字列ユーティリティ（DOM 非依存）
   * ============================================================ */
  /* 11 桁数値形式の先頭 1 桁 → 出願種別 */
  var LAPPNUM_KIND = { 1: '特願', 2: '実願', 3: '意願', 4: '商願' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* Windows で使えない文字 \ / : * ? " < > | を _ に置換する */
  function sanitizeFileName(s) {
    var t = (s === null || s === undefined || s === '') ? 'noname' : String(s);
    t = t.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
    return t || 'noname';
  }

  function toHalfWidth(s) {
    return String(s).replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
  }

  /* '12023170613' → '特願2023-170613' */
  function lappnumToAppNo(lappnum) {
    var m = /^(\d)(\d{4})(\d{6})$/.exec(String(lappnum || '').trim());
    if (!m) return '';
    var kind = LAPPNUM_KIND[m[1]];
    if (!kind) return '';
    return kind + m[2] + '-' + m[3];
  }

  /* 任意のテキストから '特願2023-170613' 形式を取り出して正規化する。
   * 「Evrikaでスクリーニング」のような無関係な文言は '' を返す。 */
  function parseAppNoFromText(text) {
    var t = String(text || '');
    var m = /(特願|実願|意願|商願)\s*([0-9０-９]{4})\s*[-‐‑–—―−ー－]?\s*([0-9０-９]{6})/.exec(t);
    if (m) return m[1] + toHalfWidth(m[2]) + '-' + toHalfWidth(m[3]);
    var n = /\b(\d{11})\b/.exec(t);
    if (n) return lappnumToAppNo(n[1]);
    return '';
  }

  /* ============================================================
   * 2. DOM ヘルパ
   * ============================================================ */
  /* innerText はテスト用の最小 DOM に無いので textContent を正とする */
  function textOf(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* ============================================================
   * 3. 出願番号の取得（優先順位付きフォールバック）
   *   新版ページ（2026）: #lappnum の文言は出願番号ではないので (2) は空振りし、
   *   「本願番号」欄の地の文（(3)）で解決する。
   *   旧世代ページ: meta[LappnumStr]（(1)）や #lappnum（(2)）で解決する。
   * ============================================================ */
  function resolveAppNo(doc, loc) {
    var tried = [];
    function ok(value, source) {
      if (value) return { appNo: value, source: source, tried: tried };
      tried.push(source);
      return null;
    }
    var r;

    /* (1) JPO 側 JS が読む meta（新版では起動時に削除されるため空振りしうる） */
    var meta = doc.querySelector('meta[data-title="LappnumStr"]');
    r = ok(meta ? parseAppNoFromText(meta.getAttribute('data-value')) : '', 'meta[data-title=LappnumStr]');
    if (r) return r;

    /* (2) #lappnum の表示文字列（新版では「Evrikaでスクリーニング」なので採用されない） */
    var lap = doc.querySelector('#lappnum');
    r = ok(lap ? parseAppNoFromText(textOf(lap)) : '', '#lappnum');
    if (r) return r;

    /* (3) 「本願番号」欄の表示文字列（新版の主経路） */
    var cellText = '';
    var ths = doc.querySelectorAll('th');
    for (var i = 0; i < ths.length; i++) {
      if (String(ths[i].textContent || '').indexOf('本願番号') > -1) {
        var td = ths[i].nextElementSibling;
        if (td) { cellText = td.textContent || ''; break; }
      }
    }
    if (!cellText && lap && lap.parentElement) cellText = lap.parentElement.textContent || '';
    r = ok(parseAppNoFromText(cellText), '本願番号セル');
    if (r) return r;

    /* (4) 文書リンクの data-title（'特願2023-170613:請求の範囲(20230929)'） */
    var link = doc.querySelector('a[data-content-id][data-title]');
    r = ok(link ? parseAppNoFromText(String(link.getAttribute('data-title') || '').split(':')[0]) : '', 'a[data-title]');
    if (r) return r;

    /* (5) meta[data-title=Lappnum]（11 桁の数値形式） */
    var meta2 = doc.querySelector('meta[data-title="Lappnum"]');
    r = ok(meta2 ? lappnumToAppNo(meta2.getAttribute('data-value')) : '', 'meta[data-title=Lappnum]');
    if (r) return r;

    /* (6) 一族出願テーブルのチェックボックス値（11 桁） */
    var lapCb = doc.querySelector('input[name="lappnum"]');
    r = ok(lapCb ? lappnumToAppNo(lapCb.getAttribute('value')) : '', 'input[name=lappnum]');
    if (r) return r;

    /* (7) URL 中の 11 桁出願番号 */
    var url = (loc && (loc.href || loc.pathname)) ? String(loc.href || loc.pathname) : '';
    var um = /(\d{11})/.exec(url);
    r = ok(um ? lappnumToAppNo(um[1]) : '', 'URL');
    if (r) return r;

    /* (8) <title>（'経過:特願2022-122252'） */
    var title = doc.querySelector('title');
    r = ok(title ? parseAppNoFromText(title.textContent) : '', '<title>');
    if (r) return r;

    return { appNo: '', source: '', tried: tried };
  }

  /* 印刷用 HTML の <title>（＝「PDF に保存」時の初期ファイル名）を作る */
  function buildNoteTitle(appNo) {
    return sanitizeFileName(appNo) + '_note';
  }

  /* ============================================================
   * 4. CORE（DOM 非依存 / Document を引数に取る純粋処理）
   * ============================================================ */
  var CORE = {
    PAGE_COUNT: PAGE_COUNT,
    sanitizeFileName: sanitizeFileName,
    lappnumToAppNo: lappnumToAppNo,
    parseAppNoFromText: parseAppNoFromText,
    resolveAppNo: resolveAppNo,
    buildNoteTitle: buildNoteTitle,
    buildNoteHTML: buildNoteHTML
  };

  /* ============================================================
   * 5. 空白 A4 の組み立て
   * ============================================================ */
  /* 中身が完全に空のページ箱を並べ、CSS の改ページだけで PAGE_COUNT 枚に区切る。
   * margin:0 のためブラウザのヘッダ/フッタ（URL・日付）も印字されない。 */
  function buildNoteHTML(title, pageCount) {
    var n = pageCount || PAGE_COUNT;
    var pages = new Array(n).fill('<div class="page"></div>').join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>' +
      '@page{size:A4;margin:0;}' +
      'html,body{margin:0;padding:0;}' +
      '.page{height:100vh;break-after:page;page-break-after:always;}' +
      '.page:last-child{break-after:auto;page-break-after:auto;}' + // 末尾に余分な空白ページを増やさない
      '</style></head><body>' + pages + '</body></html>';
  }

  function waitReady(win) {
    return new Promise(function (resolve) {
      var tick = function () {
        try {
          if (win.document && win.document.readyState === 'complete') { resolve(); return; }
        } catch (e) { /* noop */ }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  /* ============================================================
   * 6. main
   * ============================================================ */
  function main() {
    var found = resolveAppNo(document, window.location);
    if (!found.appNo) {
      alert('出願番号を取得できません。\nJPO の文書一覧（経過情報）ページで実行してください。\n（確認した箇所: ' + found.tried.join(' / ') + '）');
      return;
    }

    var title = buildNoteTitle(found.appNo);
    if (!confirm(title + '（空白A4×' + PAGE_COUNT + '枚）を印刷します。よろしいですか？')) return;

    // 名前付きウィンドウを再利用するため、二重実行してもウィンドウは増えない
    if (!window.__JPO_NOTE_VIEWER || window.__JPO_NOTE_VIEWER.closed) {
      window.__JPO_NOTE_VIEWER = window.open('', VIEWER_NAME);
      if (!window.__JPO_NOTE_VIEWER) {
        alert('ポップアップがブロックされています。\nこのサイトのポップアップを許可してから再実行してください。');
        return;
      }
    }
    var v = window.__JPO_NOTE_VIEWER;
    v.document.open();
    v.document.write(buildNoteHTML(title, PAGE_COUNT));
    v.document.close();
    waitReady(v).then(function () {
      v.focus();
      v.print(); // 保存後もウィンドウは開いたまま（閉じるのはユーザー操作）
    });
  }

  /* ============================================================
   * 起動 / エクスポート
   * ============================================================ */
  if (typeof window === 'undefined') {
    /* Node（自動テスト）からは CORE だけを読む。UI は起動しない。
     * window の有無で分岐するので、ページ側に window.module があっても誤動作しない。 */
    if (typeof module === 'object' && module !== null) module.exports = CORE;
  } else {
    window.__JPO_NOTE_PRINTER_CORE__ = CORE;
    main();
  }
})();
