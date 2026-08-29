/*!
 * JPO Document Collector v4
 * --------------------------------------------------------------
 * 新版 JPO 文書一覧ページ（www.beta.jpo.go.jp /main/core/jsv/doclist/…）向け。
 * 1 つのモーダルで
 *   - 国内書類（#doclist の tr[data-content-id]）… テキスト / 元HTML / 画像 / PDF / 印刷
 *   - OPD 書類（他庁公開情報 div.tbl_others）  … 非同期生成 → ポーリング → ダウンロード
 * を選択して実行する。
 *
 * 編集用ソース: collector.js（このファイル。手編集する正本）
 * ブックマーク登録用: collector.bookmarklet.js
 *   → node document_downloader/scripts/build-bookmarklet.js で生成（1 行版）
 *
 * ファイル名の正式規則（ダウンロード後の仕分けもこれ前提）:
 *   国内書類: 出願番号_YYYYMMDD_文書名.拡張子（画像が複数ページのときのみ末尾 _p001…）
 *   OPD    : 出願番号_元のZIPファイル名（日付は付けない）
 *   いずれも先頭は出願番号。src/sort_jpo_downloads.bat はこの先頭だけを見て仕分ける。
 *
 * 責務分離（節番号）:
 *   1 文字列ユーティリティ / 2 ページ種別の検出 / 3 出願番号の取得
 *   4 国内文書行の収集 / 5 OPD 行の収集 / 6 URL 解決 / 7 ファイル名生成
 *   8 HTML→テキスト / 9 CORE 公開 / 10 通信層 / 11 文書内容の取得
 *   12 形式別の変換 / 13 ダウンロードキュー / 14 OPD 生成状況の監視
 *   15 UI / 16 main
 *
 * 実行時に eval / new Function を一切使わない（対象ページの CSP: script-src 'self'）。
 * --------------------------------------------------------------
 */
(function () {
  'use strict';

  var VERSION = 'v4';

  /* ============================================================
   * 0. 定数
   * ============================================================ */
  var ID = '__JPO_DOC_COLLECTOR__';
  var VIEWER_NAME = 'JPO_VIEWER';

  /* OPD 生成状況の内部状態モデル（表示文言との対応はここで一元管理） */
  var OPD_STATE = {
    WAITING: 'WAITING',
    GENERATING: 'GENERATING',
    DOWNLOAD_STARTED: 'DOWNLOAD_STARTED',
    NO_TARGET: 'NO_TARGET',
    FAILED: 'FAILED',
    CANCELED: 'CANCELED'
  };
  var OPD_STATE_META = {
    WAITING:          { label: '待機中',           cls: '__st_wait',   spinner: false },
    GENERATING:       { label: '生成中',           cls: '__st_gen',    spinner: true  },
    DOWNLOAD_STARTED: { label: 'ダウンロード開始', cls: '__st_dl',     spinner: false },
    NO_TARGET:        { label: '対象なし',         cls: '__st_none',   spinner: false },
    FAILED:           { label: '失敗',             cls: '__st_fail',   spinner: false },
    CANCELED:         { label: 'キャンセル',       cls: '__st_cancel', spinner: false }
  };

  var OPD_MODE = { INDIVIDUAL: 'individual', CONSOLIDATED: 'consolidated' };

  /* doclist.js の INTERVAL_BULK_STATUS = 1*1000 に合わせる（実ページ側があればそれを優先） */
  var OPD_POLL_INTERVAL_MS = 1000;
  /* 無限ポーリング防止の上限（生成要求からの総待ち時間） */
  var OPD_MAX_WAIT_MS = 180000;
  /* 一時的な通信失敗の再試行回数とバックオフ */
  var NET_TRIES = 3;
  var NET_BACKOFF_MS = [500, 1500];
  /* 連続ダウンロードの間隔（ブラウザの複数ファイルダウンロード抑止対策） */
  var DOWNLOAD_GAP_MS = 250;
  /* 出願番号の種別コード（先頭 1 桁） */
  var LAPPNUM_KIND = { '1': '特願', '2': '実願', '3': '意願', '4': '商願' };

  var DEFAULT_KEYS = ['請求の範囲', '明細書', '図面', '要約書', '手続補正書', '意見書', '拒絶理由通知書', '審判請求書', '補正の却下', '拒絶査定'];
  var PRESETS = [
    { id: 'audit',  label: '審査用セット', keys: ['請求の範囲', '明細書', '図面', '手続補正書', '意見書', '拒絶理由通知書'] },
    { id: 'main',   label: '主要書類',     keys: ['請求の範囲', '明細書', '図面', '要約書'] },
    { id: 'spec',   label: '明細書系',     keys: ['請求の範囲', '明細書', '図面'] },
    { id: 'mid',    label: '中間書類',     keys: ['手続補正書', '意見書', '拒絶理由通知書', '拒絶査定', '補正の却下'] },
    { id: 'reject', label: '拒絶理由',     keys: ['拒絶理由通知書', '拒絶査定', '補正の却下'] },
    { id: 'fig',    label: '図面',         keys: ['図面'] },
    { id: 'all',    label: '全件',         keys: '__ALL__' }
  ];

  /* ============================================================
   * 1. 文字列ユーティリティ（DOM 非依存）
   * ============================================================ */
  var WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

  /* Windows で使用できない文字 \ / : * ? " < > | と制御文字を安全な文字へ置換 */
  function sanitizeFileName(s) {
    var t = (s === null || s === undefined) ? '' : String(s);
    t = t.replace(/[\\/:*?"<>|]/g, '_');
    t = t.replace(/[\x00-\x1f\x7f]/g, '');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/[. ]+$/, '');
    if (!t) return 'noname';
    if (WIN_RESERVED.test(t)) t = '_' + t;
    return t;
  }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  /* '12023170613' → '特願2023-170613' */
  function lappnumToAppNo(lappnum) {
    var m = /^(\d)(\d{4})(\d{6})$/.exec(String(lappnum || '').trim());
    if (!m) return '';
    var kind = LAPPNUM_KIND[m[1]];
    if (!kind) return '';
    return kind + m[2] + '-' + m[3];
  }

  /* 任意のテキストから '特願2023-170613' 形式を取り出して正規化 */
  function parseAppNoFromText(text) {
    var t = String(text || '');
    var m = /(特願|実願|意願|商願)\s*([0-9０-９]{4})\s*[-‐‑–—―−ー－]?\s*([0-9０-９]{6})/.exec(t);
    if (m) return m[1] + toHalfWidth(m[2]) + '-' + toHalfWidth(m[3]);
    var n = /\b(\d{11})\b/.exec(t);
    if (n) return lappnumToAppNo(n[1]);
    return '';
  }

  function toHalfWidth(s) {
    return String(s).replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
  }

  /* 公開番号の正規化（重複排除キー用。表示は原表記を保持する） */
  function normalizePubnum(s) {
    return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  }

  function httpErrorMessage(status) {
    var s = Number(status);
    if (s === 401 || s === 403) return '認証切れまたは権限不足です（HTTP ' + s + '）。JPO に再ログインしてから実行してください';
    if (s === 404) return 'API または生成済みデータが見つかりません（HTTP 404。生成データの失効の可能性）';
    if (s === 408 || s === 429) return '混雑またはタイムアウトです（HTTP ' + s + '）';
    if (s >= 500) return 'サーバエラーです（HTTP ' + s + '）';
    return 'HTTP ' + s;
  }

  /* パス成分（ディレクトリトラバーサル含む）を落として最後の要素だけ残す */
  function baseNameOf(s) {
    return String(s === null || s === undefined ? '' : s).replace(/^.*[\\/]/, '').trim();
  }

  /* Content-Disposition から安全にファイル名を取り出す（取れなければ '' ）。
   * filename* / filename のどちらでも basename 化 → sanitize の順で処理する。 */
  function parseContentDispositionFilename(header) {
    var h = String(header || '');
    if (!h) return '';
    var star = /filename\*\s*=\s*([^;]+)/i.exec(h);
    if (star) {
      var v = star[1].trim().replace(/^"|"$/g, '');
      var mm = /^([^']*)'([^']*)'(.*)$/.exec(v);
      var raw = mm ? mm[3] : v;
      var decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch (e) { /* 壊れた % はそのまま扱う */ }
      var starName = baseNameOf(decoded);
      return starName ? sanitizeFileName(starName) : '';
    }
    var plain = /filename\s*=\s*("([^"]*)"|([^;]*))/i.exec(h);
    if (plain) {
      var val = baseNameOf((plain[2] !== undefined ? plain[2] : plain[3] || '').trim());
      if (val) return sanitizeFileName(val);
    }
    return '';
  }

  /* ============================================================
   * 2. ページ種別の検出
   * ============================================================ */
  function detectPage(doc, loc) {
    var href = (loc && loc.href) ? String(loc.href) : '';
    var host = (loc && loc.hostname) ? String(loc.hostname) : '';
    var path = (loc && loc.pathname) ? String(loc.pathname) : '';
    var generation = 'unknown';
    if (/beta\.jpo\.go\.jp$/i.test(host) || /^\/main\/core\//.test(path)) generation = 'new';
    else if (/gem\.prototype\.jpo\.go\.jp$/i.test(host) || /\/core\/docs\//.test(path)) generation = 'legacy';

    /* ローカル保存 HTML（file://）では URL から判別できないので DOM のヒントを使う */
    var hint = '';
    if (generation === 'unknown' && doc) {
      var a = doc.querySelector('a[href*="jpo.go.jp"]');
      hint = a ? String(a.getAttribute('href') || '') : '';
      if (/beta\.jpo\.go\.jp/i.test(hint) || /\/main\/core\//.test(hint)) generation = 'new';
      else if (/gem\.prototype/i.test(hint) || /\/core\/docs\//.test(hint)) generation = 'legacy';
    }

    var hasDoclist = !!(doc && (doc.querySelector('#doclist') || doc.querySelector('table.doclist')));
    var others = doc ? doc.querySelector('div.tbl_others') : null;

    return {
      generation: generation,
      hasDoclist: hasDoclist,
      hasOpdSection: !!others,
      href: href,
      hostname: host,
      pathname: path,
      urlHint: hint
    };
  }

  /* ============================================================
   * 3. 出願番号の取得（優先順位付きフォールバック）
   * ============================================================ */
  function resolveAppNo(doc, loc) {
    var tried = [];
    function ok(value, source) {
      if (value) return { appNo: value, source: source, tried: tried };
      tried.push(source);
      return null;
    }
    var r;

    /* (1) JPO 側 JS が読む meta（Doclist.init で削除されるため保存 HTML では欠落しうる） */
    var meta = doc.querySelector('meta[data-title="LappnumStr"]');
    r = ok(meta ? parseAppNoFromText(meta.getAttribute('data-value')) : '', 'meta[data-title=LappnumStr]');
    if (r) return r;

    /* (2) #lappnum の表示文字列（新版ではリンク文言が「Evrikaでスクリーニング」に変わったため空振りしうる） */
    var lap = doc.querySelector('#lappnum');
    r = ok(lap ? parseAppNoFromText(lap.textContent) : '', '#lappnum');
    if (r) return r;

    /* (3) 「本願番号」欄（#lappnum を含むセル）の表示文字列 */
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

    /* (5) meta[data-title=Lappnum]（数値形式） */
    var meta2 = doc.querySelector('meta[data-title="Lappnum"]');
    r = ok(meta2 ? lappnumToAppNo(meta2.getAttribute('data-value')) : '', 'meta[data-title=Lappnum]');
    if (r) return r;

    /* (6) data-content-evrika の 3 番目（'…|20230929_請求の範囲|12023170613'） */
    var ev = doc.querySelector('input[data-content-evrika]');
    var evParts = ev ? String(ev.getAttribute('data-content-evrika') || '').split('|') : [];
    r = ok(evParts.length > 2 ? lappnumToAppNo(evParts[2]) : '', 'data-content-evrika');
    if (r) return r;

    /* (7) 一族出願テーブルのチェックボックス値 */
    var lapCb = doc.querySelector('div.tbl_bunkatu input[name="lappnum"]');
    r = ok(lapCb ? lappnumToAppNo(lapCb.getAttribute('value')) : '', 'tbl_bunkatu input[name=lappnum]');
    if (r) return r;

    /* (8) URL 中の数値形式出願番号 */
    var url = (loc && (loc.href || loc.pathname)) ? String(loc.href || loc.pathname) : '';
    var um = /(\d{11})/.exec(url);
    r = ok(um ? lappnumToAppNo(um[1]) : '', 'URL');
    if (r) return r;

    /* (9) <title>（'経過:特願2022-122252'） */
    var title = doc.querySelector('title');
    r = ok(title ? parseAppNoFromText(title.textContent) : '', '<title>');
    if (r) return r;

    return { appNo: '', source: '', tried: tried };
  }

  /* ============================================================
   * 4. 国内文書行の収集
   * ============================================================ */
  /* 'BBBBBBBBBBB_0000_' のようなダミー行 / 実体のない行を判定 */
  function isDummyContentId(raw) {
    var id = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!id) return true;
    if (/^B+_/.test(id)) return true;
    if (/_0000_?$/.test(id)) return true;
    if (!/^[0-9A-Za-z]+_\d{4}_[0-9A-Za-z]+$/.test(id)) return true;
    return false;
  }

  function isDisabled(el) {
    if (!el) return false;
    if (el.disabled === true) return true;
    return typeof el.hasAttribute === 'function' && el.hasAttribute('disabled');
  }

  function cellText(row, sel) {
    var el = row.querySelector(sel);
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function collectDocRows(doc) {
    var rows = doc.querySelectorAll('#doclist tr[data-content-id]');
    if (!rows || !rows.length) rows = doc.querySelectorAll('table.doclist tbody tr[data-content-id]');
    if (!rows || !rows.length) rows = doc.querySelectorAll('tr[data-content-id]');

    var items = [];
    var skipped = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var link = row.querySelector('a[data-content-id]');
      var id = String(row.getAttribute('data-content-id') || '').trim();
      if (!id && link) id = String(link.getAttribute('data-content-id') || '').trim();
      var name = cellText(row, 'td.name');
      var date = cellText(row, 'td.date');
      var cb = row.querySelector('input[type="checkbox"]');

      if (isDummyContentId(id)) { skipped.push({ reason: 'dummy', id: id, name: name, date: date }); continue; }
      if (isDisabled(cb))       { skipped.push({ reason: 'disabled', id: id, name: name, date: date }); continue; }
      if (!link)                { skipped.push({ reason: 'no-link', id: id, name: name, date: date }); continue; }
      if (!name || !date)       { skipped.push({ reason: 'no-name-or-date', id: id, name: name, date: date }); continue; }
      if (seen[id])             { skipped.push({ reason: 'duplicate', id: id, name: name, date: date }); continue; }
      seen[id] = true;

      var code = cellText(row, 'td.code');
      var section = '';
      if (typeof row.closest === 'function') {
        var art = row.closest('article');
        var h = art ? art.querySelector('h5') : null;
        if (h) section = String(h.textContent || '').trim();
      }
      items.push({
        idx: items.length,
        row: row,
        id: id,
        name: name,
        date: date,
        code: code,
        section: section,
        title: link ? String(link.getAttribute('data-title') || '') : '',
        evrika: cb ? String(cb.getAttribute('data-content-evrika') || '') : ''
      });
    }
    return { items: items, skipped: skipped, scanned: rows.length };
  }

  /* ============================================================
   * 5. OPD 行の収集（他庁公開情報）
   * ============================================================ */
  function collectOpdRows(doc) {
    var section = doc.querySelector('div.tbl_others');
    var scope = section || doc;
    var cbs = scope.querySelectorAll('input[type="checkbox"][name="pubnum"]');
    var items = [];
    var seen = {};
    var skipped = [];

    for (var i = 0; i < cbs.length; i++) {
      var cb = cbs[i];
      var raw = String(cb.getAttribute('value') || '').trim();
      var key = normalizePubnum(raw);
      if (!key) { skipped.push({ reason: 'empty', pubnum: raw }); continue; }
      if (seen[key]) { skipped.push({ reason: 'duplicate', pubnum: raw }); continue; }
      seen[key] = true;

      var row = (typeof cb.closest === 'function') ? cb.closest('tr') : null;
      var linkEl = row ? row.querySelector('a[data-elm="link-evrika"]') : null;
      var display = linkEl ? String(linkEl.textContent || '').trim() : '';
      if (!display) display = raw;
      var dateEl = row ? row.querySelector('td.width-date') : null;
      items.push({
        idx: items.length,
        key: key,
        pubnum: raw,
        display: display,
        date: dateEl ? String(dateEl.textContent || '').trim() : '',
        hasIndividual: !!(row && row.querySelector('button[data-elm="opd_bulk_individual"]')),
        hasConsolidated: !!(row && row.querySelector('button[data-elm="opd_bulk_consolidated"]'))
      });
    }

    var message = '';
    if (!items.length && section) {
      message = String(section.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return {
      sectionFound: !!section,
      available: items.length > 0,
      items: items,
      skipped: skipped,
      message: message
    };
  }

  /* ============================================================
   * 6. URL 解決
   * ============================================================ */
  /* 書類実体参照 API。JPO 側 define_url.js の URL_JSV_CONTENT が最優先 */
  function resolveContentUrlTemplate(win, loc, page) {
    var g = win || {};
    var tpl = (typeof g.URL_JSV_CONTENT === 'string' && g.URL_JSV_CONTENT.indexOf('{content_id}') > -1) ? g.URL_JSV_CONTENT : '';
    if (tpl) return { template: tpl, source: 'URL_JSV_CONTENT' };
    var path = (loc && loc.pathname) ? String(loc.pathname) : '';
    var m = /^(.*\/jsv\/)/.exec(path);
    if (m) return { template: m[1] + 'content/{content_id}/', source: 'location.pathname' };
    var fallback = (page && page.generation === 'legacy') ? '/core/docs/jsv/content/{content_id}/' : '/main/core/jsv/content/{content_id}/';
    return { template: fallback, source: 'default(' + ((page && page.generation) || 'unknown') + ')' };
  }

  function pickUrlConst(v, needle) {
    if (typeof v !== 'string' || !v) return '';
    if (needle && v.indexOf(needle) === -1) return '';
    return v;
  }

  /* 実ページのグローバル定数 → 読み込み済み共通 JS の実ファイル、の順に確認する。
   * 見つからない場合は推測で固定せず、呼び出し側でエラー表示する。 */
  function opdUrlsFromGlobals(win) {
    var g = win || {};
    return {
      statusUrl: pickUrlConst(g.URL_OPD_BULK_STATUS, ''),
      downloadTemplate: pickUrlConst(g.URL_OPD_BULK_DOWNLOAD, '{hashkey}'),
      source: 'page-global'
    };
  }

  function extractOpdUrlsFromSource(src) {
    var text = String(src || '');
    var s = /URL_OPD_BULK_STATUS\s*=\s*['"`]([^'"`]+)['"`]/.exec(text);
    var d = /URL_OPD_BULK_DOWNLOAD\s*=\s*['"`]([^'"`]+)['"`]/.exec(text);
    return {
      statusUrl: s ? s[1] : '',
      downloadTemplate: d ? d[1] : ''
    };
  }

  /* ============================================================
   * 7. ファイル名生成
   * ============================================================ */
  /* 国内書類の基本形: 出願番号_YYYYMMDD_文書名 （ラベル指定時のみ先頭に付与）。
   * 出願番号を先頭に固定するのは、ダウンロードフォルダを出願番号で仕分ける
   * src/sort_jpo_downloads.bat が「ファイル名先頭の出願番号」だけを見るため。 */
  function buildBaseName(parts) {
    var p = parts || {};
    var stem = sanitizeFileName(p.appNo) + '_' + sanitizeFileName(p.date) + '_' + sanitizeFileName(p.docName);
    if (p.label) stem = sanitizeFileName(p.label) + '_' + stem;
    return stem;
  }

  /* OPD の基本形: 出願番号_元のZIPファイル名（国内書類と違い日付は付けない）。
   *   1. JPO が返した元ファイル名（Content-Disposition）を basename 化
   *   2. Windows で使えない文字を sanitize
   *   3. 先頭に「出願番号_」を付与（既に付いていれば二重付与しない）
   * 元ファイル名が取れないときは fallbackName（例: '公開番号.zip'）を使う。 */
  function buildOpdFileName(appNo, rawName, fallbackName) {
    var app = sanitizeFileName(appNo);
    var raw = baseNameOf(rawName);
    var name = raw ? sanitizeFileName(raw) : sanitizeFileName(baseNameOf(fallbackName) || 'OPD.zip');
    if (!app || app === 'noname') return name;
    var prefix = app + '_';
    if (name.toLowerCase().indexOf(prefix.toLowerCase()) === 0) return name; /* 二重付与の防止 */
    return prefix + name;
  }

  /* 基本形（出願番号_YYYYMMDD_文書名）に拡張子を付ける。
   * 画像が複数ページのときだけ末尾に _p001 形式のページ番号を足す
   * （1 ページだけの文書に無意味な _p001 を付けないための既存仕様）。 */
  function buildFileName(base, ext, opts) {
    var o = opts || {};
    var stem = String(base || 'document');
    if (o.pageCount && o.pageCount > 1 && o.page) stem += '_p' + pad(o.page, 3);
    return stem + '.' + String(ext || 'bin').replace(/^\./, '');
  }

  /* 同名ファイルの上書き防止（1 回の実行内で連番を振る） */
  function createNameRegistry() {
    var used = {};
    function take(name) {
      var key = String(name).toLowerCase();
      if (!used[key]) { used[key] = true; return name; }
      var dot = name.lastIndexOf('.');
      var stem = dot > 0 ? name.slice(0, dot) : name;
      var ext = dot > 0 ? name.slice(dot) : '';
      for (var i = 2; i < 100000; i++) {
        var cand = stem + '_' + i + ext;
        var ck = cand.toLowerCase();
        if (!used[ck]) { used[ck] = true; return cand; }
      }
      return stem + '_' + Date.now() + ext;
    }
    return { take: take, has: function (n) { return !!used[String(n).toLowerCase()]; } };
  }

  /* ============================================================
   * 8. HTML → プレーンテキスト
   * ============================================================ */
  var BLOCK_TAGS = {
    P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, ASIDE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, LI: 1, DL: 1, DT: 1, DD: 1,
    TABLE: 1, TR: 1, THEAD: 1, TBODY: 1, TFOOT: 1, PRE: 1, BLOCKQUOTE: 1, HR: 1, FIGURE: 1, FORM: 1
  };
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1 };

  function htmlToText(node) {
    var out = [];
    (function walk(n) {
      if (!n) return;
      if (n.nodeType === 3) { out.push(n.nodeValue || ''); return; }
      if (n.nodeType !== 1) return;
      var tag = String(n.tagName || '').toUpperCase();
      if (SKIP_TAGS[tag]) return;
      if (tag === 'BR') { out.push('\n'); return; }
      var block = !!BLOCK_TAGS[tag];
      if (block) out.push('\n');
      var kids = n.childNodes || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
      if (tag === 'TD' || tag === 'TH') out.push('\t');
      if (block) out.push('\n');
    })(node);
    return out.join('')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '') + '\n';
  }

  /* ============================================================
   * 9. CORE（DOM 非依存 / Document を引数に取る純粋処理）
   * ============================================================ */
  var CORE = {
    VERSION: VERSION,
    OPD_STATE: OPD_STATE,
    OPD_STATE_META: OPD_STATE_META,
    OPD_MODE: OPD_MODE,
    OPD_POLL_INTERVAL_MS: OPD_POLL_INTERVAL_MS,
    OPD_MAX_WAIT_MS: OPD_MAX_WAIT_MS,
    DEFAULT_KEYS: DEFAULT_KEYS,
    PRESETS: PRESETS,
    sanitizeFileName: sanitizeFileName,
    lappnumToAppNo: lappnumToAppNo,
    parseAppNoFromText: parseAppNoFromText,
    normalizePubnum: normalizePubnum,
    httpErrorMessage: httpErrorMessage,
    parseContentDispositionFilename: parseContentDispositionFilename,
    detectPage: detectPage,
    resolveAppNo: resolveAppNo,
    isDummyContentId: isDummyContentId,
    collectDocRows: collectDocRows,
    collectOpdRows: collectOpdRows,
    resolveContentUrlTemplate: resolveContentUrlTemplate,
    opdUrlsFromGlobals: opdUrlsFromGlobals,
    extractOpdUrlsFromSource: extractOpdUrlsFromSource,
    baseNameOf: baseNameOf,
    buildBaseName: buildBaseName,
    buildOpdFileName: buildOpdFileName,
    buildFileName: buildFileName,
    createNameRegistry: createNameRegistry,
    htmlToText: htmlToText,
    /* buildImagePdf は関数宣言のため巻き上げ済み（定義は 12 節） */
    buildImagePdf: buildImagePdf
  };

  /* ============================================================
   * 10. 通信層（同一オリジン・現在の認証セッションの範囲）
   * ============================================================ */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function CanceledError() {
    var e = new Error('CANCELED');
    e.name = 'CanceledError';
    return e;
  }
  function isCanceled(e) { return !!e && (e.name === 'CanceledError' || e.name === 'AbortError'); }

  function HttpError(status) {
    var e = new Error(httpErrorMessage(status));
    e.name = 'HttpError';
    e.status = status;
    return e;
  }

  /* 中断可能な待機。タイマは 1 本だけ張り、中断は abort イベントで即時に効かせる。
   * 細切れの setTimeout を並べるとバックグラウンドタブのタイマ抑制で
   * 待ち時間が数倍に伸びるため、分割しないこと。 */
  function sleepCancelable(ms, ctl) {
    return new Promise(function (resolve, reject) {
      if (ctl && ctl.canceled) { reject(CanceledError()); return; }
      var signal = ctl && ctl.controller ? ctl.controller.signal : null;
      var timer = setTimeout(function () { cleanup(); resolve(); }, ms);
      function cleanup() {
        clearTimeout(timer);
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
      }
      function onAbort() { cleanup(); reject(CanceledError()); }
      if (signal && signal.addEventListener) signal.addEventListener('abort', onAbort);
    });
  }

  function cookieValue(name) {
    try {
      var m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(document.cookie || '');
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  async function rawFetch(url, init, ctl) {
    var opts = {};
    var src = init || {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) opts[k] = src[k];
    if (!opts.credentials) opts.credentials = 'same-origin';
    if (!opts.cache) opts.cache = 'no-store';
    if (ctl && ctl.controller) opts.signal = ctl.controller.signal;
    return await fetch(url, opts);
  }

  /* 一時的な通信失敗（ネットワークエラー / 5xx）だけ回数を限定して再試行する */
  async function fetchWithRetry(url, init, ctl) {
    var lastErr = null;
    for (var i = 0; i < NET_TRIES; i++) {
      if (ctl && ctl.canceled) throw CanceledError();
      try {
        var res = await rawFetch(url, init, ctl);
        if (res.status >= 500 && i < NET_TRIES - 1) {
          await sleepCancelable(NET_BACKOFF_MS[i] || 1500, ctl);
          continue;
        }
        return res;
      } catch (e) {
        if (isCanceled(e)) throw e;
        lastErr = e;
        if (i < NET_TRIES - 1) await sleepCancelable(NET_BACKOFF_MS[i] || 1500, ctl);
      }
    }
    throw lastErr || new Error('通信に失敗しました');
  }

  function hasAPIFetch(method) {
    return typeof window !== 'undefined' &&
      window.APIFetch && typeof window.APIFetch[method] === 'function';
  }

  /* JPO 側 APIFetch は callback 形式。存在するときだけ Promise でくるんで再利用する */
  function apiFetchCall(method, args) {
    return new Promise(function (resolve, reject) {
      var cb = {
        done: function (res) { resolve(res); },
        fail: function (err) { reject(err instanceof Error ? err : new Error('APIFetch が失敗しました')); }
      };
      try {
        if (method === 'async_post') window.APIFetch.async_post(args.url, args.params, cb);
        else window.APIFetch.async_get(args.url, cb);
      } catch (e) { reject(e); }
    });
  }

  async function readJson(res) {
    if (!res) throw new Error('応答がありません');
    if (res.ok === false) throw HttpError(res.status);
    var text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error('JSON として解釈できない応答が返りました（' + text.slice(0, 80) + '…）'); }
  }

  async function postJson(url, params, ctl) {
    if (hasAPIFetch('async_post')) {
      var res = await apiFetchCall('async_post', { url: url, params: params });
      return await readJson(res);
    }
    var headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };
    var token = cookieValue('csrftoken');
    if (token) headers['X-CSRFToken'] = token;
    var r = await fetchWithRetry(url, { method: 'POST', headers: headers, body: JSON.stringify(params) }, ctl);
    if (r.status === 400 || r.status === 415) {
      /* JSON を受け付けない場合に備えたフォーム形式での再試行 */
      var form = new URLSearchParams();
      for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) form.append(k, params[k]);
      var h2 = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
      if (token) h2['X-CSRFToken'] = token;
      r = await fetchWithRetry(url, { method: 'POST', headers: h2, body: form.toString() }, ctl);
    }
    return await readJson(r);
  }

  async function getJson(url, ctl) {
    if (hasAPIFetch('async_get')) {
      var res = await apiFetchCall('async_get', { url: url });
      return await readJson(res);
    }
    var r = await fetchWithRetry(url, { method: 'GET', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } }, ctl);
    return await readJson(r);
  }

  /* ============================================================
   * 11. 文書内容の取得
   * ============================================================ */
  function absolute(url, base) {
    try { return new URL(url, base || location.href).toString(); }
    catch (e) { return url; }
  }

  function contentUrlFor(env, contentId) {
    return absolute(env.contentTemplate.replace(/\{content_id\}/g, encodeURIComponent(contentId)));
  }

  function pickImages(doc) {
    var imgs = Array.prototype.slice.call(doc.querySelectorAll('img.jsv_content_img'));
    if (!imgs.length) {
      imgs = Array.prototype.slice.call(doc.querySelectorAll('img[src]')).filter(function (im) {
        var src = String(im.getAttribute('src') || '');
        if (!src) return false;
        if (/\.svg(\?|$)/i.test(src)) return false;
        if (/icon|logo|spacer|blank/i.test(src)) return false;
        return true;
      });
    }
    return imgs.map(function (im) { return im.getAttribute('src'); }).filter(Boolean);
  }

  async function fetchDocument(env, item, ctl) {
    var url = contentUrlFor(env, item.id);
    var res = await fetchWithRetry(url, { method: 'GET' }, ctl);
    if (!res.ok && (res.status === 400 || res.status === 404 || res.status === 405)) {
      /* 新版の書類実体参照 API は POST（title 付き）で開かれる。GET が通らない場合に合わせる */
      var form = new URLSearchParams();
      form.append('title', item.title || '');
      res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString()
      }, ctl);
    }
    if (!res.ok) throw HttpError(res.status);
    var html = await res.text();
    var doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      item: item,
      baseUrl: url,
      html: html,
      doc: doc,
      text: htmlToText(doc.body || doc.documentElement),
      bodyHtml: doc.body ? doc.body.innerHTML : html,
      images: pickImages(doc)
    };
  }

  /* ============================================================
   * 12. 形式別の変換（画像 / PDF）
   * ============================================================ */
  async function loadImage(src, base, ctl) {
    var url = src;
    var revoke = null;
    if (!/^data:/i.test(src)) {
      var res = await fetchWithRetry(absolute(src, base), { method: 'GET' }, ctl);
      if (!res.ok) throw HttpError(res.status);
      var blob = await res.blob();
      url = URL.createObjectURL(blob);
      revoke = function () { URL.revokeObjectURL(url); };
    }
    try {
      return await new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { resolve(im); };
        im.onerror = function () { reject(new Error('画像の読み込みに失敗しました')); };
        im.src = url;
      });
    } finally {
      /* Image の decode 後に開放する（onload 後なので安全） */
      if (revoke) setTimeout(revoke, 0);
    }
  }

  function imageToCanvas(im) {
    var c = document.createElement('canvas');
    c.width = im.naturalWidth || im.width || 1;
    c.height = im.naturalHeight || im.height || 1;
    c.getContext('2d').drawImage(im, 0, 0);
    return c;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('画像の変換に失敗しました'));
      }, type, quality);
    });
  }

  async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* CompressionStream('deflate') は zlib 形式 = PDF の /FlateDecode と同じ */
  function hasCompressionStream() {
    return typeof CompressionStream === 'function';
  }

  async function deflate(bytes) {
    var cs = new CompressionStream('deflate');
    var stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* 1 ページ分の画像を PDF 用データにする。
   * 可逆（FlateDecode）を優先し、巨大画像やブラウザ未対応時は JPEG（DCTDecode）にする。 */
  async function canvasToPdfImage(canvas) {
    var w = canvas.width, h = canvas.height;
    if (hasCompressionStream() && w * h <= 4000000) {
      try {
        var data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
        var rgb = new Uint8Array(w * h * 3);
        for (var i = 0, j = 0; i < data.length; i += 4, j += 3) {
          rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
        }
        return { bytes: await deflate(rgb), filter: '/FlateDecode', width: w, height: h, lossless: true };
      } catch (e) { /* getImageData が失敗（tainted 等）→ JPEG にフォールバック */ }
    }
    var blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    return { bytes: await blobBytes(blob), filter: '/DCTDecode', width: w, height: h, lossless: false };
  }

  /* 画像ページを A4 に収めて並べた PDF を組み立てる（外部ライブラリ不使用） */
  function buildImagePdf(pages) {
    var A4W = 595.28, A4H = 841.89;
    var enc = new TextEncoder();
    var chunks = [];
    var length = 0;
    function push(u8) { chunks.push(u8); length += u8.length; }
    function pushStr(s) { push(enc.encode(s)); }

    var offsets = [0];
    function beginObj(id) { offsets[id] = length; pushStr(id + ' 0 obj\n'); }
    function endObj() { pushStr('endobj\n'); }

    pushStr('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    var n = pages.length;
    var kids = [];
    for (var k = 0; k < n; k++) kids.push((3 + k * 3) + ' 0 R');

    beginObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObj();

    beginObj(2);
    pushStr('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\n');
    endObj();

    for (var p = 0; p < n; p++) {
      var img = pages[p];
      var pageId = 3 + p * 3, contId = 4 + p * 3, imgId = 5 + p * 3;
      var scale = Math.min(A4W / img.width, A4H / img.height);
      var dw = img.width * scale, dh = img.height * scale;
      var dx = (A4W - dw) / 2, dy = (A4H - dh) / 2;

      beginObj(pageId);
      pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4W.toFixed(2) + ' ' + A4H.toFixed(2) + ']' +
        ' /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >> /Contents ' + contId + ' 0 R >>\n');
      endObj();

      var content = 'q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + dx.toFixed(2) + ' ' + dy.toFixed(2) + ' cm /Im0 Do Q\n';
      var contentBytes = enc.encode(content);
      beginObj(contId);
      pushStr('<< /Length ' + contentBytes.length + ' >>\nstream\n');
      push(contentBytes);
      pushStr('\nendstream\n');
      endObj();

      beginObj(imgId);
      pushStr('<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ' + img.filter + ' /Length ' + img.bytes.length + ' >>\nstream\n');
      push(img.bytes);
      pushStr('\nendstream\n');
      endObj();
    }

    var maxId = 2 + n * 3;
    var xrefPos = length;
    pushStr('xref\n0 ' + (maxId + 1) + '\n');
    pushStr('0000000000 65535 f \n');
    for (var id = 1; id <= maxId; id++) pushStr(pad(offsets[id] || 0, 10) + ' 00000 n \n');
    pushStr('trailer\n<< /Size ' + (maxId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    var out = new Uint8Array(length);
    var at = 0;
    for (var c = 0; c < chunks.length; c++) { out.set(chunks[c], at); at += chunks[c].length; }
    return new Blob([out], { type: 'application/pdf' });
  }

  /* ============================================================
   * 13. ダウンロードキュー
   * ============================================================ */
  function createSaver(cfg, log) {
    var lastAt = 0;
    async function gap() {
      var wait = DOWNLOAD_GAP_MS - (Date.now() - lastAt);
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
    }
    async function saveBlob(filename, blob) {
      await gap();
      if (cfg.mode === 'directory' && cfg.dirHandle) {
        try {
          var fh = await cfg.dirHandle.getFileHandle(filename, { create: true });
          var ws = await fh.createWritable();
          await ws.write(blob);
          await ws.close();
          return filename;
        } catch (e) {
          log('warn', 'フォルダ保存に失敗 → 通常ダウンロードへフォールバック: ' + (e && e.message));
        }
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return filename;
    }
    return { saveBlob: saveBlob };
  }

  /* ============================================================
   * 14. OPD 生成状況の監視（生成要求 → ポーリング → ダウンロード）
   * ============================================================ */
  function createOpdRunner(env, saver, log) {
    var active = {};

    async function requestGeneration(pubnum, mode, ctl) {
      return await postJson(env.opd.statusUrl, { pubnum: pubnum, mode: mode }, ctl);
    }

    async function pollStatus(hashkey, ctl) {
      var sep = env.opd.statusUrl.indexOf('?') > -1 ? '&' : '?';
      return await getJson(env.opd.statusUrl + sep + 'hashkey=' + encodeURIComponent(hashkey), ctl);
    }

    function downloadUrlFor(json) {
      if (json && typeof json.url === 'string' && json.url) return absolute(json.url);
      if (env.opd.downloadTemplate && json && json.hashkey) {
        return absolute(env.opd.downloadTemplate.replace(/\{hashkey\}/g, encodeURIComponent(json.hashkey)));
      }
      return '';
    }

    /* run: 1 公開番号ぶんのジョブ。hooks.state(state, message) で状態を通知する */
    async function run(target, mode, ctl, hooks) {
      var jobKey = target.key + '|' + mode;
      if (active[jobKey]) {
        hooks.state(OPD_STATE.FAILED, '同じジョブが実行中のため二重起動をスキップしました');
        return OPD_STATE.FAILED;
      }
      active[jobKey] = true;
      try {
        hooks.state(OPD_STATE.GENERATING, '生成要求を送信中');
        var json = await requestGeneration(target.pubnum, mode, ctl);
        var deadline = Date.now() + OPD_MAX_WAIT_MS;

        while (true) {
          if (ctl.canceled) throw CanceledError();
          var status = String((json && json.status) || '').toLowerCase();
          if (status === 'success') break;
          if (status === 'empty') {
            hooks.state(OPD_STATE.NO_TARGET, 'ダウンロード可能な書類がありません');
            return OPD_STATE.NO_TARGET;
          }
          if (status !== 'waiting' && status !== 'working') {
            hooks.state(OPD_STATE.FAILED, 'API が status=' + (status || '(なし)') + ' を返しました');
            return OPD_STATE.FAILED;
          }
          if (Date.now() > deadline) {
            hooks.state(OPD_STATE.FAILED, '生成待ちが上限（' + Math.round(OPD_MAX_WAIT_MS / 1000) + '秒）を超えました');
            return OPD_STATE.FAILED;
          }
          if (!json.hashkey) {
            hooks.state(OPD_STATE.FAILED, 'hashkey が返っていないため状況を確認できません');
            return OPD_STATE.FAILED;
          }
          hooks.state(OPD_STATE.GENERATING, '生成中（status=' + status + '）');
          await sleepCancelable(env.opd.interval, ctl);
          json = await pollStatus(json.hashkey, ctl);
        }

        var url = downloadUrlFor(json);
        if (!url) {
          hooks.state(OPD_STATE.FAILED, 'ダウンロード URL を組み立てられません（hashkey / URL_OPD_BULK_DOWNLOAD 不明）');
          return OPD_STATE.FAILED;
        }

        var res = await fetchWithRetry(url, { method: 'GET' }, ctl);
        if (!res.ok) throw HttpError(res.status);
        var cdName = parseContentDispositionFilename(res.headers.get('content-disposition'));
        var blob = await res.blob();
        /* Content-Disposition が無いときのフォールバックも「出願番号_公開番号.拡張子」で揃える */
        var ext = /pdf/i.test(blob.type) ? 'pdf' : 'zip';
        var name = buildOpdFileName(env.appNo, cdName, sanitizeFileName(target.pubnum) + '.' + ext);
        name = env.names.take(name);
        /* 「ダウンロード開始」は実際に保存を開始した時点で設定する（完了は検知できない） */
        hooks.state(OPD_STATE.DOWNLOAD_STARTED, name);
        await saver.saveBlob(name, blob);
        log('ok', 'OPD ' + target.display + '（' + mode + '）：ダウンロード開始 ' + name);
        return OPD_STATE.DOWNLOAD_STARTED;
      } catch (e) {
        if (isCanceled(e)) {
          hooks.state(OPD_STATE.CANCELED, '中断しました');
          return OPD_STATE.CANCELED;
        }
        hooks.state(OPD_STATE.FAILED, (e && e.message) || String(e));
        log('err', 'OPD ' + target.display + '：' + ((e && e.message) || e));
        return OPD_STATE.FAILED;
      } finally {
        delete active[jobKey];
      }
    }

    return { run: run };
  }

  /* ============================================================
   * 15. UI
   * ============================================================ */
  var STYLES = [
    ':root{color-scheme:light dark}',
    '#' + ID + '{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(10,25,61,.45);backdrop-filter:saturate(120%) blur(2px);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,"Noto Sans JP",sans-serif}',
    '#' + ID + ' *{box-sizing:border-box}',
    '#' + ID + ' .__panel{width:min(1040px,96vw);height:min(90vh,940px);background:#fff;color:#0f172a;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 24px 60px rgba(2,8,23,.30),0 8px 20px rgba(2,8,23,.18);display:flex;flex-direction:column;overflow:hidden;animation:__modalIn .16s ease-out}',
    '@keyframes __modalIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}',
    '#' + ID + ' .__hdr{display:flex;align-items:center;gap:10px;padding:12px 16px;background:linear-gradient(180deg,#eff6ff,#ffffff 60%);border-bottom:1px solid #e5e7eb}',
    '#' + ID + ' .__brand{display:flex;flex-direction:column;line-height:1.2}',
    '#' + ID + ' .__title{font-weight:800;font-size:16px;letter-spacing:.2px}',
    '#' + ID + ' .__sub{font-size:12px;color:#475569;margin-top:2px}',
    '#' + ID + ' .__close{margin-left:auto;border:1px solid #dbeafe;background:#fff;font-size:18px;line-height:1;border-radius:8px;cursor:pointer;padding:6px 10px}',
    '#' + ID + ' .__body{display:flex;flex:1;min-height:0}',
    '#' + ID + ' .__left{width:352px;border-right:1px solid #e5e7eb;background:#f8fbff;display:flex;flex-direction:column;overflow:auto;padding:14px;gap:14px}',
    '#' + ID + ' .__right{flex:1;display:flex;flex-direction:column;min-width:0}',
    '#' + ID + ' .__sec{display:flex;flex-direction:column;gap:6px}',
    '#' + ID + ' .__sectitle{font-size:11px;font-weight:700;color:#1e3a8a;letter-spacing:.5px;text-transform:uppercase}',
    '#' + ID + ' .__check{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;padding:3px 0}',
    '#' + ID + ' .__check input,#' + ID + ' .__radio input{margin:0}',
    '#' + ID + ' .__hint{font-size:11px;color:#64748b;line-height:1.5}',
    '#' + ID + ' .__chips{display:flex;flex-wrap:wrap;gap:6px}',
    '#' + ID + ' .__chip{padding:6px 10px;border-radius:999px;border:1px solid #cfe0ff;background:#fff;font-size:12px;cursor:pointer;color:#1e40af}',
    '#' + ID + ' .__chip:hover{background:#eff6ff}',
    '#' + ID + ' .__radio{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:2px 0}',
    '#' + ID + ' .__input{padding:7px 9px;border:1px solid #cfe0ff;border-radius:8px;font-size:13px;outline:none;background:#fff;color:#0f172a;width:100%}',
    '#' + ID + ' .__input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}',
    '#' + ID + ' .__btn{padding:7px 12px;font-size:12px;border-radius:10px;cursor:pointer;border:1px solid #cfe0ff;background:#fff;color:#0f172a}',
    '#' + ID + ' .__btn:hover{background:#eff6ff}',
    '#' + ID + ' .__pickdir{display:flex;flex-direction:column;gap:4px}',
    '#' + ID + ' .__dirinfo{font-size:11px;color:#475569;word-break:break-all}',
    '#' + ID + ' .__opdbox{border:1px solid #ffe1b3;background:#fffaf2;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px}',
    '#' + ID + ' .__opdbox.__off{opacity:.55}',
    '#' + ID + ' .__tools{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #e5e7eb;background:#f8fbff;flex-wrap:wrap}',
    '#' + ID + ' .__filter{flex:1;min-width:180px;padding:8px 10px;border:1px solid #cfe0ff;border-radius:10px;font-size:13px;outline:none}',
    '#' + ID + ' .__filter:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}',
    '#' + ID + ' .__scroll{flex:1;overflow:auto;background:#fff;min-height:120px}',
    '#' + ID + ' .__group{padding:6px 14px 12px}',
    '#' + ID + ' .__grouphd{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 0 6px;font-weight:800;font-size:13px;background:inherit}',
    '#' + ID + ' .__gdom{background:#fff}',
    '#' + ID + ' .__gdom .__grouphd{color:#1e3a8a;border-bottom:2px solid #dbeafe}',
    '#' + ID + ' .__gopd{background:#fffaf2;border-top:3px solid #fed7aa;margin-top:6px}',
    '#' + ID + ' .__gopd .__grouphd{color:#9a3412;border-bottom:2px solid #fed7aa}',
    '#' + ID + ' .__gopd.__off{opacity:.5}',
    '#' + ID + ' .__row{display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px dashed #eef2ff}',
    '#' + ID + ' .__gopd .__row{border-bottom-color:#fee9d2}',
    '#' + ID + ' .__row:hover{background:rgba(37,99,235,.05)}',
    '#' + ID + ' .__row label{display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;min-width:0;margin:0}',
    '#' + ID + ' .__row .__name{font-weight:600;font-size:13px}',
    '#' + ID + ' .__row .__meta{color:#5b6b8a;font-size:11px}',
    '#' + ID + ' .__empty{font-size:12px;color:#64748b;padding:8px 2px}',
    '#' + ID + ' .__badge{font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;white-space:nowrap;border:1px solid transparent}',
    '#' + ID + ' .__st_wait{background:#f1f5f9;color:#475569;border-color:#cbd5e1}',
    '#' + ID + ' .__st_gen{background:#dbeafe;color:#1d4ed8;border-color:#93c5fd}',
    '#' + ID + ' .__st_dl{background:#dcfce7;color:#15803d;border-color:#86efac}',
    '#' + ID + ' .__st_none{background:#fef9c3;color:#854d0e;border-color:#fde047}',
    '#' + ID + ' .__st_fail{background:#fee2e2;color:#b91c1c;border-color:#fca5a5}',
    '#' + ID + ' .__st_cancel{background:#ffedd5;color:#9a3412;border-color:#fdba74}',
    '#' + ID + ' .__spin{display:inline-block;width:9px;height:9px;margin-right:5px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:__spin .8s linear infinite;vertical-align:-1px}',
    '@keyframes __spin{to{transform:rotate(360deg)}}',
    '#' + ID + ' .__stmsg{font-size:11px;color:#7c2d12;max-width:22em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#' + ID + ' .__progress{padding:8px 14px;border-top:1px solid #e5e7eb;background:#f8fbff;display:none}',
    '#' + ID + ' .__progress.__on{display:block}',
    '#' + ID + ' .__pinfo{display:flex;justify-content:space-between;font-size:12px;color:#0f172a;margin-bottom:4px}',
    '#' + ID + ' .__pbar{height:8px;background:#e0e7ff;border-radius:4px;overflow:hidden}',
    '#' + ID + ' .__pfill{height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);width:0%;transition:width .25s}',
    '#' + ID + ' .__logbox{max-height:130px;overflow:auto;border-top:1px solid #e5e7eb;padding:6px 14px;background:#0b1220;color:#cbd5e1;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;display:none;line-height:1.5}',
    '#' + ID + ' .__logbox.__on{display:block}',
    '#' + ID + ' .__logitem.__ok{color:#86efac}',
    '#' + ID + ' .__logitem.__warn{color:#fde047}',
    '#' + ID + ' .__logitem.__err{color:#fca5a5}',
    '#' + ID + ' .__logitem.__info{color:#93c5fd}',
    '#' + ID + ' .__ft{display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid #e5e7eb;background:#f8fbff;flex-wrap:wrap}',
    '#' + ID + ' .__count{font-size:12px;color:#475569}',
    '#' + ID + ' .__spacer{flex:1}',
    '#' + ID + ' .__start{background:#2563eb;color:#fff;border:1px solid #1d4ed8;font-weight:700;padding:10px 16px;border-radius:10px;cursor:pointer;min-height:40px;min-width:15em;font-size:13px}',
    '#' + ID + ' .__start:hover{filter:brightness(1.05)}',
    '#' + ID + ' .__start:disabled{opacity:.6;cursor:not-allowed}',
    '#' + ID + ' .__cancel{background:#fff;color:#0f172a;border:1px solid #cfe0ff;padding:10px 14px;border-radius:10px;cursor:pointer}',
    '#' + ID + ' .__stop{background:#dc2626;color:#fff;border:1px solid #b91c1c;padding:10px 14px;border-radius:10px;cursor:pointer;display:none}',
    '#' + ID + ' .__stop.__on{display:inline-block}',
    '#' + ID + ' .__savelog{background:#fff;color:#0f172a;border:1px solid #cfe0ff;padding:8px 12px;border-radius:10px;cursor:pointer;font-size:12px;display:none}',
    '#' + ID + ' .__savelog.__on{display:inline-block}',
    '#' + ID + ' button:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:2px}',
    '@media (prefers-color-scheme:dark){',
    '  #' + ID + '{background:rgba(2,6,23,.6)}',
    '  #' + ID + ' .__panel{background:#0b1220;color:#e5e7eb;border-color:#1e293b}',
    '  #' + ID + ' .__hdr{background:linear-gradient(180deg,#0b172f,#0b1220 70%);border-bottom-color:#1e293b}',
    '  #' + ID + ' .__sub,#' + ID + ' .__count,#' + ID + ' .__dirinfo,#' + ID + ' .__hint,#' + ID + ' .__empty{color:#94a3b8}',
    '  #' + ID + ' .__sectitle{color:#93c5fd}',
    '  #' + ID + ' .__left,#' + ID + ' .__tools,#' + ID + ' .__progress,#' + ID + ' .__ft{background:#0b1220;border-color:#1e293b}',
    '  #' + ID + ' .__filter,#' + ID + ' .__input,#' + ID + ' .__btn,#' + ID + ' .__chip,#' + ID + ' .__cancel,#' + ID + ' .__savelog{background:#0b1220;color:#e5e7eb;border-color:#334155}',
    '  #' + ID + ' .__chip{color:#93c5fd}',
    '  #' + ID + ' .__row{border-bottom-color:#172033}',
    '  #' + ID + ' .__scroll,#' + ID + ' .__gdom{background:#0b1220}',
    '  #' + ID + ' .__gopd{background:#1a1206;border-top-color:#7c2d12}',
    '  #' + ID + ' .__gopd .__row{border-bottom-color:#3b2410}',
    '  #' + ID + ' .__gdom .__grouphd{color:#93c5fd;border-bottom-color:#1e3a8a}',
    '  #' + ID + ' .__gopd .__grouphd{color:#fdba74;border-bottom-color:#7c2d12}',
    '  #' + ID + ' .__opdbox{background:#1a1206;border-color:#7c2d12}',
    '  #' + ID + ' .__stmsg{color:#fdba74}',
    '  #' + ID + ' .__close{background:#0b1220;border-color:#334155;color:#e5e7eb}',
    '  #' + ID + ' .__pbar{background:#1e293b}',
    '}',
    '@media (max-width:820px){',
    '  #' + ID + ' .__body{flex-direction:column}',
    '  #' + ID + ' .__left{width:auto;border-right:none;border-bottom:1px solid #e5e7eb;max-height:44vh}',
    '}'
  ].join('\n');

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ログ名やラベル例に使う YYYYMMDD（ファイル名中の日付はすべてこの形式に揃える） */
  function todayYmd() {
    var d = new Date();
    return String(d.getFullYear()) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2);
  }

  /* ============================================================
   * 16. main
   * ============================================================ */
  async function main() {
    var qs = function (s, r) { return (r || document).querySelector(s); };
    var qsa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

    /* ---- 16.1 ページ解析 ---------------------------------- */
    var page = detectPage(document, location);
    var appInfo = resolveAppNo(document, location);
    var appNo = appInfo.appNo;
    var docs = collectDocRows(document);
    var opd = collectOpdRows(document);

    if (!appNo && !docs.items.length && !opd.items.length) {
      alert('JPO の文書一覧ページを認識できませんでした。\n' +
        '出願番号・文書行・他庁公開情報のいずれも取得できません。\n' +
        '（対象: 経過情報／書類一覧ページで実行してください）');
      return;
    }
    if (!appNo) appNo = 'noappno';

    /* ---- 16.2 実行環境（URL・状態） ------------------------ */
    var contentInfo = resolveContentUrlTemplate(window, location, page);
    var env = {
      page: page,
      appNo: appNo,
      contentTemplate: contentInfo.template,
      contentSource: contentInfo.source,
      names: createNameRegistry(),
      opd: {
        statusUrl: '',
        downloadTemplate: '',
        source: '',
        interval: OPD_POLL_INTERVAL_MS
      }
    };
    if (window.Doclist && Number(window.Doclist.INTERVAL_BULK_STATUS) > 0) {
      env.opd.interval = Number(window.Doclist.INTERVAL_BULK_STATUS);
    }

    /* ---- 16.3 モーダル構築 -------------------------------- */
    var oldRoot = document.getElementById(ID);
    if (oldRoot) oldRoot.remove();

    var root = document.createElement('div');
    root.id = ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = [
      '<div class="__panel" role="document" aria-labelledby="__modal_title">',
      '  <div class="__hdr">',
      '    <div class="__brand">',
      '      <div class="__title" id="__modal_title">JPO Document Collector ' + VERSION + '</div>',
      '      <div class="__sub">出願番号: ' + esc(appNo) + ' ／ 国内書類: ' + docs.items.length + '件 ／ OPD公開番号: ' + opd.items.length + '件</div>',
      '    </div>',
      '    <button class="__close" type="button" title="閉じる" aria-label="閉じる">×</button>',
      '  </div>',
      '  <div class="__body">',
      '    <div class="__left">',
      '      <div class="__sec">',
      '        <div class="__sectitle">国内書類の出力形式（複数選択可）</div>',
      '        <label class="__check"><input type="checkbox" name="__mode" value="text" checked>テキスト（.txt）</label>',
      '        <label class="__check"><input type="checkbox" name="__mode" value="html" checked>元HTML（.html）</label>',
      '        <label class="__check"><input type="checkbox" name="__mode" value="image" checked>画像（.png）</label>',
      '        <label class="__check"><input type="checkbox" name="__mode" value="pdf">PDF（.pdf・画像ページを結合）</label>',
      '        <label class="__check"><input type="checkbox" name="__mode" value="print">印刷画面を開く</label>',
      '        <div class="__hint">PDF は文書内の画像ページを A4 に収めて結合します。画像を持たない文書は PDF 化できません（印刷から「PDFとして保存」を使ってください）。</div>',
      '      </div>',
      '      <div class="__sec">',
      '        <div class="__opdbox" id="__opdbox">',
      '          <div class="__sectitle">OPD書類（他庁公開情報）</div>',
      '          <label class="__check"><input type="checkbox" id="__opdon" checked>OPDをダウンロードする</label>',
      '          <div class="__sectitle">OPDファイル形式</div>',
      '          <label class="__radio"><input type="radio" name="__opdmode" value="individual" checked>複数ファイル（individual）</label>',
      '          <label class="__radio"><input type="radio" name="__opdmode" value="consolidated">単一ファイル（consolidated）</label>',
      '          <div class="__hint" id="__opdnotice">OPD API の URL を確認しています…</div>',
      '        </div>',
      '      </div>',
      '      <div class="__sec">',
      '        <div class="__sectitle">プリセット（国内書類）</div>',
      '        <div class="__chips" id="__presets"></div>',
      '      </div>',
      '      <div class="__sec">',
      '        <div class="__sectitle">保存方式</div>',
      '        <label class="__radio"><input type="radio" name="__savemode" value="download" checked>通常ダウンロード</label>',
      '        <label class="__radio"><input type="radio" name="__savemode" value="directory">フォルダを選択して直接保存</label>',
      '        <div class="__pickdir">',
      '          <button class="__btn" id="__pickdir" type="button">保存先フォルダを選択</button>',
      '          <div class="__dirinfo" id="__dirinfo">未選択（通常ダウンロードを使用）</div>',
      '        </div>',
      '        <div class="__hint">複数ファイルの連続ダウンロードは、ブラウザ側で許可（「複数のファイルのダウンロード」）が必要な場合があります。ブロックされたらアドレスバーの通知から許可してください。</div>',
      '      </div>',
      '      <div class="__sec">',
      '        <div class="__sectitle">ファイル名の先頭ラベル（任意）</div>',
      '        <input class="__input" id="__label" type="text" placeholder="例: ' + todayYmd() + '_案件A">',
      '        <div class="__hint">ファイル名は国内書類が「出願番号_YYYYMMDD_文書名.拡張子」、OPD が「出願番号_元のZIPファイル名」。同名は自動で連番。ラベルを入れると先頭が出願番号でなくなり sort_jpo_downloads.bat の対象外になります。</div>',
      '      </div>',
      '    </div>',
      '    <div class="__right">',
      '      <div class="__tools">',
      '        <input class="__filter" type="text" placeholder="国内書類のフィルタ（部分一致 / 正規表現:/pattern/i）" aria-label="国内書類のフィルタ">',
      '        <button class="__btn" id="__selall" type="button">全選択</button>',
      '        <button class="__btn" id="__clear" type="button">全解除</button>',
      '        <button class="__btn" id="__selvis" type="button">表示中を選択</button>',
      '      </div>',
      '      <div class="__scroll" tabindex="0">',
      '        <div class="__group __gdom">',
      '          <div class="__grouphd">国内書類 <span class="__count" id="__domcount"></span></div>',
      '          <div id="__domlist"></div>',
      '        </div>',
      '        <div class="__group __gopd" id="__opdgroup">',
      '          <div class="__grouphd">OPD書類（他庁公開情報）',
      '            <span class="__spacer"></span>',
      '            <button class="__btn" id="__opdall" type="button">OPD全選択</button>',
      '            <button class="__btn" id="__opdnone" type="button">OPD全解除</button>',
      '          </div>',
      '          <div id="__opdlist" aria-live="polite"></div>',
      '        </div>',
      '      </div>',
      '      <div class="__progress" id="__progress">',
      '        <div class="__pinfo"><span id="__pcur">準備中...</span><span id="__ppct">0 / 0</span></div>',
      '        <div class="__pbar"><div class="__pfill" id="__pfill"></div></div>',
      '      </div>',
      '      <div class="__logbox" id="__logbox" aria-live="polite"></div>',
      '      <div class="__ft">',
      '        <span class="__count" id="__count"></span>',
      '        <button class="__savelog" id="__savelog" type="button">ログを保存</button>',
      '        <div class="__spacer"></div>',
      '        <button class="__cancel" id="__cancel" type="button">閉じる</button>',
      '        <button class="__stop" id="__stop" type="button">中断</button>',
      '        <button class="__start" id="__start" type="button">処理開始</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
      '<style>' + STYLES + '</style>'
    ].join('\n');

    var prevOverflow = document.body.style.overflow;
    var prevPR = document.body.style.paddingRight;
    var scw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scw > 0) document.body.style.paddingRight = scw + 'px';
    var inertTargets = Array.prototype.slice.call(document.body.children);
    inertTargets.forEach(function (el) {
      try { el.inert = true; } catch (e) { /* 未対応ブラウザは aria-hidden のみ */ }
      el.setAttribute('aria-hidden', 'true');
    });
    document.body.appendChild(root);

    var panel = qs('.__panel', root);
    var filter = qs('.__filter', root);
    var domList = qs('#__domlist', root);
    var opdList = qs('#__opdlist', root);
    var opdGroup = qs('#__opdgroup', root);
    var opdBox = qs('#__opdbox', root);
    var opdOn = qs('#__opdon', root);
    var opdNotice = qs('#__opdnotice', root);
    var domCount = qs('#__domcount', root);
    var count = qs('#__count', root);
    var startBtn = qs('#__start', root);
    var stopBtn = qs('#__stop', root);
    var progress = qs('#__progress', root);
    var pCur = qs('#__pcur', root);
    var pPct = qs('#__ppct', root);
    var pFill = qs('#__pfill', root);
    var logBox = qs('#__logbox', root);
    var saveLogBtn = qs('#__savelog', root);
    var dirInfo = qs('#__dirinfo', root);
    var labelEl = qs('#__label', root);

    /* ---- 16.4 状態 ---------------------------------------- */
    var saveCfg = { mode: 'download', dirHandle: null, label: '' };
    var domSelected = {};
    docs.items.forEach(function (it) {
      if (DEFAULT_KEYS.some(function (k) { return (it.name || '').indexOf(k) > -1; })) domSelected[it.idx] = true;
    });
    var opdSelected = {};
    opd.items.forEach(function (it) { opdSelected[it.key] = true; });
    var opdStates = {};
    var logs = [];
    var ctl = { canceled: false, controller: (typeof AbortController === 'function') ? new AbortController() : null };
    var running = false;

    /* ---- 16.5 ログ / 進捗 ---------------------------------- */
    function log(level, msg) {
      var ts = new Date();
      logs.push({ level: level, msg: msg, ts: ts });
      var line = document.createElement('div');
      line.className = '__logitem __' + level;
      var sym = level === 'ok' ? '✓' : level === 'warn' ? '⚠' : level === 'err' ? '✗' : '·';
      line.textContent = '[' + pad(ts.getHours(), 2) + ':' + pad(ts.getMinutes(), 2) + ':' + pad(ts.getSeconds(), 2) + '] ' + sym + ' ' + msg;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
      logBox.classList.add('__on');
      saveLogBtn.classList.add('__on');
    }

    function setProgress(cur, total, label) {
      progress.classList.add('__on');
      var pct = total > 0 ? Math.round((cur / total) * 100) : 0;
      pFill.style.width = pct + '%';
      pPct.textContent = cur + ' / ' + total + '（' + pct + '%）';
      pCur.textContent = label || '';
    }

    var saver = createSaver(saveCfg, log);

    /* ---- 16.6 国内書類リスト ------------------------------- */
    function visibleItems(filterStr) {
      var s = String(filterStr || '').trim();
      var re = null;
      if (s && s.charAt(0) === '/' && s.lastIndexOf('/') > 0) {
        var last = s.lastIndexOf('/');
        try { re = new RegExp(s.slice(1, last), s.slice(last + 1)); } catch (e) { re = null; }
      }
      var q = s.toLowerCase();
      return docs.items.filter(function (it) {
        var text = (it.name + ' ' + it.date + ' ' + it.code + ' ' + it.section).toLowerCase();
        return re ? re.test(text) : (!q || text.indexOf(q) > -1);
      });
    }

    function renderDom() {
      var shown = visibleItems(filter.value);
      domList.innerHTML = '';
      if (!docs.items.length) {
        domList.innerHTML = '<div class="__empty">取得可能な国内書類がありません（ダミー行・実体なし行は除外しています）。</div>';
      } else if (!shown.length) {
        domList.innerHTML = '<div class="__empty">フィルタに一致する書類がありません。</div>';
      } else {
        var html = shown.map(function (it) {
          var id = '__pick_' + it.idx;
          return '<div class="__row"><label for="' + id + '">' +
            '<input type="checkbox" id="' + id + '" data-idx="' + it.idx + '"' + (domSelected[it.idx] ? ' checked' : '') + '>' +
            '<span class="__name">' + esc(it.name) + '</span>' +
            '<span class="__meta">（' + esc(it.date) + (it.code ? ' / ' + esc(it.code) : '') + '）</span>' +
            '</label></div>';
        }).join('');
        domList.innerHTML = html;
      }
      var sel = Object.keys(domSelected).filter(function (k) { return domSelected[k]; }).length;
      domCount.textContent = '選択 ' + sel + ' / 表示 ' + shown.length + ' / 全 ' + docs.items.length;
      updateStartLabel();
    }

    /* ---- 16.7 OPD リスト ---------------------------------- */
    function badgeHtml(state, message) {
      var meta = OPD_STATE_META[state] || OPD_STATE_META.WAITING;
      return '<span class="__badge ' + meta.cls + '">' + (meta.spinner ? '<span class="__spin"></span>' : '') + esc(meta.label) + '</span>' +
        (message ? '<span class="__stmsg" title="' + esc(message) + '">' + esc(message) + '</span>' : '');
    }

    function renderOpd() {
      opdList.innerHTML = '';
      if (!opd.items.length) {
        var why = opd.sectionFound
          ? '利用可能なOPD公開番号はありません' + (/ありません/.test(opd.message) ? '（ページ表示: 他庁公開情報はありません）' : '')
          : '利用可能なOPD公開番号はありません（他庁公開情報の欄がページにありません）';
        opdList.innerHTML = '<div class="__empty">' + esc(why) + '</div>';
        return;
      }
      opdList.innerHTML = opd.items.map(function (it) {
        var id = '__opdpick_' + it.idx;
        var st = opdStates[it.key] || { state: OPD_STATE.WAITING, message: '' };
        return '<div class="__row" data-key="' + esc(it.key) + '">' +
          '<label for="' + id + '">' +
          '<input type="checkbox" id="' + id + '" data-key="' + esc(it.key) + '"' + (opdSelected[it.key] ? ' checked' : '') + '>' +
          '<span class="__name">' + esc(it.display) + '</span>' +
          (it.date ? '<span class="__meta">（' + esc(it.date) + '）</span>' : '') +
          '</label>' +
          '<span class="__stwrap">' + badgeHtml(st.state, st.message) + '</span>' +
          '</div>';
      }).join('');
    }

    function setOpdState(key, state, message) {
      opdStates[key] = { state: state, message: message || '' };
      var row = opdList.querySelector('.__row[data-key="' + key + '"] .__stwrap');
      if (row) row.innerHTML = badgeHtml(state, message);
    }

    function opdEnabled() {
      return !!(opdOn.checked && opd.items.length && env.opd.statusUrl);
    }

    function syncOpdEnabled() {
      var on = opdOn.checked && !!env.opd.statusUrl;
      opdGroup.classList.toggle('__off', !on);
      opdBox.classList.toggle('__off', !on);
      qsa('input[name=__opdmode]', root).forEach(function (rb) { rb.disabled = !on; });
      /* 選択状態は保持したまま操作だけ止める（再有効化で復元される） */
      qsa('input[type=checkbox]', opdList).forEach(function (cb) { cb.disabled = !on; });
      qs('#__opdall', root).disabled = !on;
      qs('#__opdnone', root).disabled = !on;
      updateStartLabel();
    }

    /* ---- 16.8 選択の取得 ---------------------------------- */
    function getSelectedDocs() {
      return docs.items.filter(function (it) { return !!domSelected[it.idx]; });
    }
    function getSelectedOpd() {
      if (!opdEnabled()) return [];
      return opd.items.filter(function (it) { return !!opdSelected[it.key]; });
    }
    function getModes() {
      var m = qsa('input[name=__mode]:checked', root).map(function (cb) { return cb.value; });
      return {
        text: m.indexOf('text') > -1,
        html: m.indexOf('html') > -1,
        image: m.indexOf('image') > -1,
        pdf: m.indexOf('pdf') > -1,
        print: m.indexOf('print') > -1
      };
    }
    function anyMode(modes) {
      return modes.text || modes.html || modes.image || modes.pdf || modes.print;
    }
    function getOpdMode() {
      var r = qs('input[name=__opdmode]:checked', root);
      var v = r ? r.value : OPD_MODE.INDIVIDUAL;
      return (v === OPD_MODE.CONSOLIDATED) ? OPD_MODE.CONSOLIDATED : OPD_MODE.INDIVIDUAL;
    }

    function getPlan() {
      var modes = getModes();
      var picked = getSelectedDocs();
      var opdPicked = getSelectedOpd();
      var domReady = picked.length > 0 && anyMode(modes);
      var opdReady = opdPicked.length > 0;
      return { modes: modes, picked: picked, opdPicked: opdPicked, domReady: domReady, opdReady: opdReady };
    }

    function updateStartLabel() {
      if (running) return;
      var plan = getPlan();
      var n = plan.picked.length, m = plan.opdPicked.length;
      if (plan.domReady && plan.opdReady) {
        startBtn.textContent = '国内' + n + '件＋OPD' + m + '番号を処理';
        startBtn.disabled = false;
      } else if (plan.domReady) {
        startBtn.textContent = '国内' + n + '件を処理';
        startBtn.disabled = false;
      } else if (plan.opdReady) {
        startBtn.textContent = 'OPD' + m + '番号をダウンロード';
        startBtn.disabled = false;
      } else if (n > 0 && !anyMode(plan.modes)) {
        startBtn.textContent = '国内書類の出力形式を選択';
        startBtn.disabled = true;
      } else {
        startBtn.textContent = '対象を選択してください';
        startBtn.disabled = true;
      }
      count.textContent = '国内 ' + n + '件選択 ／ OPD ' + m + '番号選択';
    }

    /* ---- 16.9 国内書類の処理 ------------------------------ */
    async function actionText(d, base) {
      var name = env.names.take(buildFileName(base, 'txt'));
      await saver.saveBlob(name, new Blob([d.text], { type: 'text/plain;charset=utf-8' }));
      log('ok', d.item.name + '：テキスト保存（' + name + '）');
    }

    async function actionHtml(d, base) {
      var name = env.names.take(buildFileName(base, 'html'));
      await saver.saveBlob(name, new Blob([d.html], { type: 'text/html;charset=utf-8' }));
      log('ok', d.item.name + '：元HTML保存（' + name + '）');
    }

    async function actionImages(d, base) {
      if (!d.images.length) { log('warn', d.item.name + '：画像なし'); return; }
      var total = d.images.length, saved = 0;
      for (var i = 0; i < total; i++) {
        if (ctl.canceled) break;
        try {
          var im = await loadImage(d.images[i], d.baseUrl, ctl);
          var canvas = imageToCanvas(im);
          var blob = await canvasToBlob(canvas, 'image/png');
          var name = env.names.take(buildFileName(base, 'png', { page: i + 1, pageCount: total }));
          await saver.saveBlob(name, blob);
          saved++;
        } catch (e) {
          if (isCanceled(e)) break;
          log('err', d.item.name + '：画像 ' + (i + 1) + ' 失敗 - ' + ((e && e.message) || e));
        }
      }
      log('ok', d.item.name + '：画像 ' + saved + '/' + total + ' 件保存');
    }

    async function actionPdf(d, base) {
      if (!d.images.length) {
        log('warn', d.item.name + '：画像ページがないため PDF 化をスキップ（印刷からPDF保存してください）');
        return;
      }
      var pages = [];
      for (var i = 0; i < d.images.length; i++) {
        if (ctl.canceled) break;
        var im = await loadImage(d.images[i], d.baseUrl, ctl);
        pages.push(await canvasToPdfImage(imageToCanvas(im)));
      }
      if (!pages.length) return;
      var name = env.names.take(buildFileName(base, 'pdf'));
      await saver.saveBlob(name, buildImagePdf(pages));
      log('ok', d.item.name + '：PDF保存（' + name + ' / ' + pages.length + 'ページ' + (pages[0].lossless ? '・可逆' : '・JPEG') + '）');
    }

    /* 印刷用ウィンドウの準備待ち。ユーザーが閉じた場合に無限ループしないよう上限を設ける */
    function waitReady(win, limitMs) {
      var deadline = Date.now() + (limitMs || 10000);
      return new Promise(function (resolve) {
        (function tick() {
          try {
            if (win.closed) { resolve(); return; }
            if (win.document && win.document.readyState === 'complete') { resolve(); return; }
          } catch (e) { resolve(); return; }
          if (Date.now() > deadline) { resolve(); return; }
          setTimeout(tick, 80);
        })();
      });
    }

    async function actionPrint(d, base) {
      if (!window.__JPO_VIEWER || window.__JPO_VIEWER.closed) {
        window.__JPO_VIEWER = window.open('', VIEWER_NAME);
        if (!window.__JPO_VIEWER) throw new Error('ポップアップがブロックされています（印刷にはポップアップの許可が必要です）');
      }
      var v = window.__JPO_VIEWER;
      var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(base) + '</title>' +
        '<base href="' + esc(d.baseUrl) + '">' +
        '<style>:root{color-scheme:light dark}body{font-size:12pt;line-height:1.5}@page{size:A4;margin:12mm}' +
        '@media print{a[href]::after{content:""}}</style></head><body>' + d.bodyHtml + '</body></html>';
      v.document.open();
      v.document.write(html);
      v.document.close();
      await waitReady(v);
      if (v.closed) throw new Error('印刷用ウィンドウが閉じられました');
      v.focus();
      v.print();
      log('ok', d.item.name + '：印刷ダイアログ表示');
      await sleep(300);
    }

    /* ---- 16.10 実行 --------------------------------------- */
    async function run() {
      var plan = getPlan();
      running = true;
      ctl.canceled = false;
      ctl.controller = (typeof AbortController === 'function') ? new AbortController() : null;
      stopBtn.classList.add('__on');
      startBtn.disabled = true;
      startBtn.textContent = '処理中…';
      env.names = createNameRegistry();

      var modeNames = Object.keys(plan.modes).filter(function (k) { return plan.modes[k]; });
      log('info', '処理開始：国内 ' + plan.picked.length + '件（' + (modeNames.join('+') || 'なし') + '） / OPD ' + plan.opdPicked.length + '番号（' + getOpdMode() + '）');
      if (plan.picked.length && !anyMode(plan.modes)) log('warn', '国内書類の出力形式が未選択のため、国内書類はスキップします');
      if (plan.picked.length * modeNames.length > 10 || plan.opdPicked.length > 1) {
        log('info', 'ヒント: 連続ダウンロードがブロックされる場合は、ブラウザの「複数のファイルのダウンロード」を許可してください');
      }

      var total = (plan.domReady ? plan.picked.length : 0) + plan.opdPicked.length;
      var done = 0, okCount = 0, errCount = 0;

      if (plan.domReady) {
        for (var i = 0; i < plan.picked.length; i++) {
          if (ctl.canceled) { log('warn', 'ユーザー操作により中断しました'); break; }
          var it = plan.picked[i];
          var base = buildBaseName({ appNo: env.appNo, docName: it.name, date: it.date, label: saveCfg.label });
          setProgress(done, total, '取得中：' + it.name);
          var d = null;
          try {
            d = await fetchDocument(env, it, ctl);
          } catch (e) {
            if (isCanceled(e)) { log('warn', '中断しました'); break; }
            log('err', it.name + '：取得失敗 - ' + ((e && e.message) || e));
            errCount++; done++; setProgress(done, total, '取得失敗：' + it.name);
            continue;
          }
          try {
            if (plan.modes.text)  { setProgress(done, total, 'テキスト保存中：' + it.name); await actionText(d, base); }
            if (ctl.canceled) break;
            if (plan.modes.html)  { setProgress(done, total, '元HTML保存中：' + it.name);   await actionHtml(d, base); }
            if (ctl.canceled) break;
            if (plan.modes.image) { setProgress(done, total, '画像保存中：' + it.name);     await actionImages(d, base); }
            if (ctl.canceled) break;
            if (plan.modes.pdf)   { setProgress(done, total, 'PDF作成中：' + it.name);      await actionPdf(d, base); }
            if (ctl.canceled) break;
            if (plan.modes.print) { setProgress(done, total, '印刷準備中：' + it.name);     await actionPrint(d, base); }
            okCount++;
          } catch (e) {
            if (isCanceled(e)) { log('warn', '中断しました'); break; }
            log('err', it.name + '：処理失敗 - ' + ((e && e.message) || e));
            errCount++;
          }
          done++;
          setProgress(done, total, '完了：' + it.name);
        }
      }

      if (plan.opdPicked.length) {
        var runner = createOpdRunner(env, saver, log);
        var mode = getOpdMode();
        for (var j = 0; j < plan.opdPicked.length; j++) {
          var target = plan.opdPicked[j];
          if (ctl.canceled) {
            setOpdState(target.key, OPD_STATE.CANCELED, '開始前に中断されました');
            done++; continue;
          }
          setProgress(done, total, 'OPD生成中：' + target.display);
          var st = await runner.run(target, mode, ctl, {
            state: function (state, message) { setOpdState(target.key, state, message); }
          });
          if (st === OPD_STATE.DOWNLOAD_STARTED) okCount++;
          else if (st === OPD_STATE.FAILED) errCount++;
          done++;
          setProgress(done, total, 'OPD完了：' + target.display);
        }
      }

      setProgress(total, total, ctl.canceled ? '中断' : '完了');
      log('info', '全処理終了：成功 ' + okCount + ' / 失敗 ' + errCount + ' / 対象 ' + total);

      running = false;
      stopBtn.classList.remove('__on');
      updateStartLabel();
    }

    /* ---- 16.11 OPD API URL の検出 -------------------------- */
    async function discoverOpdUrls() {
      var got = opdUrlsFromGlobals(window);
      if (got.statusUrl) {
        env.opd.statusUrl = got.statusUrl;
        env.opd.downloadTemplate = got.downloadTemplate;
        env.opd.source = 'ページの URL 定数（define_url.js）';
        return;
      }
      /* 2 段目: 読み込み済みの共通 JS を同一オリジンで読み、定数値を確認する（推測で固定しない） */
      var scripts = qsa('script[src]').map(function (s) { return s.getAttribute('src'); })
        .filter(function (src) { return src && /define_url|common|url/i.test(src); })
        .slice(0, 4);
      for (var i = 0; i < scripts.length; i++) {
        try {
          var res = await fetch(absolute(scripts[i]), { credentials: 'same-origin' });
          if (!res.ok) continue;
          var found = extractOpdUrlsFromSource(await res.text());
          if (found.statusUrl) {
            env.opd.statusUrl = found.statusUrl;
            env.opd.downloadTemplate = found.downloadTemplate;
            env.opd.source = scripts[i];
            return;
          }
        } catch (e) { /* 取得できないスクリプトは無視 */ }
      }
    }

    async function initOpdUrls() {
      if (!opd.items.length) {
        opdNotice.textContent = 'このページに他庁公開情報（OPD対象）はありません。国内書類の処理はそのまま利用できます。';
        syncOpdEnabled();
        return;
      }
      try { await discoverOpdUrls(); } catch (e) { /* 失敗は下の分岐で表示 */ }
      if (env.opd.statusUrl) {
        opdNotice.textContent = 'OPD API を検出しました（' + env.opd.source + '）。ポーリング間隔 ' + env.opd.interval + 'ms / 上限 ' + Math.round(OPD_MAX_WAIT_MS / 1000) + '秒。';
        log('info', 'OPD API: status=' + env.opd.statusUrl + ' / download=' + (env.opd.downloadTemplate || '(応答の url を使用)'));
      } else {
        opdNotice.textContent = 'OPD API の URL（URL_OPD_BULK_STATUS）を検出できませんでした。JPO の実ページ上で実行してください（保存済みHTMLやログイン切れでは利用できません）。';
        log('warn', 'OPD: URL_OPD_BULK_STATUS を検出できないため OPD ダウンロードを無効化しました');
      }
      syncOpdEnabled();
    }

    /* ---- 16.12 クローズ / キー操作 ------------------------ */
    function closeModal() {
      ctl.canceled = true;
      if (ctl.controller) { try { ctl.controller.abort(); } catch (e) { /* 未対応環境は無視 */ } }
      root.removeEventListener('keydown', trapKey);
      root.remove();
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPR;
      inertTargets.forEach(function (el) {
        try { el.inert = false; } catch (e) { /* noop */ }
        el.removeAttribute('aria-hidden');
      });
    }

    function trapKey(e) {
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key === 'Tab') {
        var f = qsa('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', panel)
          .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      } else if (e.key === 'Enter' && document.activeElement === filter) {
        if (!startBtn.disabled) startBtn.click();
      }
    }

    /* ---- 16.13 イベント ----------------------------------- */
    var presetWrap = qs('#__presets', root);
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = '__chip';
      b.textContent = p.label;
      b.addEventListener('click', function () {
        docs.items.forEach(function (it) {
          domSelected[it.idx] = (p.keys === '__ALL__') || p.keys.some(function (k) { return (it.name || '').indexOf(k) > -1; });
        });
        renderDom();
      });
      presetWrap.appendChild(b);
    });

    filter.addEventListener('input', renderDom);
    qs('#__selall', root).addEventListener('click', function () {
      docs.items.forEach(function (it) { domSelected[it.idx] = true; });
      renderDom();
    });
    qs('#__clear', root).addEventListener('click', function () {
      docs.items.forEach(function (it) { domSelected[it.idx] = false; });
      renderDom();
    });
    qs('#__selvis', root).addEventListener('click', function () {
      visibleItems(filter.value).forEach(function (it) { domSelected[it.idx] = true; });
      renderDom();
    });
    domList.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input[type=checkbox][data-idx]')) {
        domSelected[Number(t.dataset.idx)] = t.checked;
        var sel = Object.keys(domSelected).filter(function (k) { return domSelected[k]; }).length;
        domCount.textContent = '選択 ' + sel + ' / 表示 ' + visibleItems(filter.value).length + ' / 全 ' + docs.items.length;
        updateStartLabel();
      }
    });

    /* OPD の全選択・全解除は国内書類の操作と完全に独立 */
    qs('#__opdall', root).addEventListener('click', function () {
      opd.items.forEach(function (it) { opdSelected[it.key] = true; });
      qsa('input[type=checkbox][data-key]', opdList).forEach(function (cb) { cb.checked = true; });
      updateStartLabel();
    });
    qs('#__opdnone', root).addEventListener('click', function () {
      opd.items.forEach(function (it) { opdSelected[it.key] = false; });
      qsa('input[type=checkbox][data-key]', opdList).forEach(function (cb) { cb.checked = false; });
      updateStartLabel();
    });
    opdList.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input[type=checkbox][data-key]')) {
        opdSelected[t.dataset.key] = t.checked;
        updateStartLabel();
      }
    });
    opdOn.addEventListener('change', syncOpdEnabled);
    qsa('input[name=__mode]', root).forEach(function (cb) { cb.addEventListener('change', updateStartLabel); });
    qsa('input[name=__opdmode]', root).forEach(function (rb) { rb.addEventListener('change', updateStartLabel); });

    qsa('input[name=__savemode]', root).forEach(function (rb) {
      rb.addEventListener('change', function () {
        if (!rb.checked) return;
        saveCfg.mode = rb.value;
        if (saveCfg.mode === 'directory' && !saveCfg.dirHandle) dirInfo.textContent = '未選択 — 「保存先フォルダを選択」を押してください';
        else if (saveCfg.mode === 'download') dirInfo.textContent = '通常ダウンロードを使用';
      });
    });

    labelEl.addEventListener('input', function () { saveCfg.label = labelEl.value.trim(); });

    qs('#__pickdir', root).addEventListener('click', async function () {
      if (!window.showDirectoryPicker) {
        alert('このブラウザはフォルダ選択保存（File System Access API）に未対応です。\n通常ダウンロード方式を使用してください。');
        qs('input[name=__savemode][value=download]', root).checked = true;
        saveCfg.mode = 'download';
        return;
      }
      try {
        var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        saveCfg.dirHandle = handle;
        saveCfg.mode = 'directory';
        qs('input[name=__savemode][value=directory]', root).checked = true;
        dirInfo.textContent = '選択中: ' + (handle.name || '(フォルダ)');
        log('info', '保存先フォルダを選択: ' + (handle.name || '(フォルダ)'));
      } catch (e) {
        if (e && e.name !== 'AbortError') log('err', 'フォルダ選択失敗: ' + ((e && e.message) || e));
      }
    });

    qs('.__close', root).addEventListener('click', closeModal);
    qs('#__cancel', root).addEventListener('click', closeModal);
    root.addEventListener('mousedown', function (e) { if (e.target === root) closeModal(); });
    root.addEventListener('keydown', trapKey);

    stopBtn.addEventListener('click', function () {
      ctl.canceled = true;
      if (ctl.controller) { try { ctl.controller.abort(); } catch (e) { /* noop */ } }
      log('warn', '中断要求を受け付けました（進行中の処理を停止します）');
    });

    startBtn.addEventListener('click', async function () {
      if (running) return;
      var plan = getPlan();
      if (!plan.domReady && !plan.opdReady) { alert('処理対象がありません。国内書類とOPDのいずれかを選択してください。'); return; }
      if (saveCfg.mode === 'directory' && !saveCfg.dirHandle) {
        if (!confirm('保存先フォルダが未選択です。通常ダウンロード方式で続行しますか？')) return;
        saveCfg.mode = 'download';
      }
      await run();
    });

    saveLogBtn.addEventListener('click', async function () {
      var lines = logs.map(function (l) {
        var t = l.ts;
        return '[' + t.getFullYear() + '-' + pad(t.getMonth() + 1, 2) + '-' + pad(t.getDate(), 2) + ' ' +
          pad(t.getHours(), 2) + ':' + pad(t.getMinutes(), 2) + ':' + pad(t.getSeconds(), 2) + '] ' +
          l.level.toUpperCase() + ' ' + l.msg;
      });
      var name = (saveCfg.label ? sanitizeFileName(saveCfg.label) + '_' : '') + sanitizeFileName(env.appNo) + '_' + todayYmd() + '_log.txt';
      await saver.saveBlob(name, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    });

    /* ---- 16.14 初期表示 ----------------------------------- */
    renderDom();
    renderOpd();
    syncOpdEnabled();
    setTimeout(function () { filter.focus(); }, 30);

    log('info', 'ページ種別: ' + page.generation + ' / 出願番号: ' + appNo + '（取得元: ' + (appInfo.source || '不明') + '）');
    log('info', '書類実体URL: ' + env.contentTemplate + '（取得元: ' + env.contentSource + '）');
    if (docs.skipped.length) {
      var reasons = {};
      docs.skipped.forEach(function (s) { reasons[s.reason] = (reasons[s.reason] || 0) + 1; });
      log('info', '除外した行: ' + Object.keys(reasons).map(function (k) { return k + '×' + reasons[k]; }).join(' / '));
    }
    if (!docs.items.length) log('warn', '取得可能な国内書類がありません');

    await initOpdUrls();
  }

  /* ============================================================
   * 起動 / エクスポート
   * ============================================================ */
  if (typeof module === 'object' && module !== null && typeof module.exports === 'object') {
    /* Node（自動テスト）からは CORE だけを読む。UI は起動しない */
    module.exports = CORE;
  } else if (typeof window !== 'undefined' && window.document) {
    window.__JPO_DOC_COLLECTOR_CORE__ = CORE;
    if (!window.__JPO_DOC_COLLECTOR_NO_AUTORUN__) {
      main().catch(function (e) {
        alert('JPO Document Collector: 起動に失敗しました\n' + ((e && e.message) || e));
      });
    }
  }
})();
