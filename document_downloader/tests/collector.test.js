'use strict';
/*
 * collector.test.js — fixtures の実 HTML に対する CORE の検証（依存ゼロ）
 * 実行: node --test document_downloader/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('./minidom');
const CORE = require('../src/bookmarklet/collector');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'document-list');
const load = (rel) => parseHTML(fs.readFileSync(path.join(FIXTURES, rel), 'utf8'));

const F_2023 = 'new/経過_特願2023-170613.html';   // 他庁公開情報なし
const F_2022 = 'new/経過_特願2022-122252.html';   // 他庁公開情報あり + ダミー行あり
const F_BETA = 'legacy/特願2024-563143_beta.html'; // 旧世代（meta[LappnumStr] が残っている）
const F_GEM  = 'legacy/特願2024-563143.html';      // 旧版ページ（gem.prototype）

const names = (items) => items.map((it) => it.name);

/* ============================================================
 * _特願2023-170613.html（OPD なし）
 * ============================================================ */
test('2023-170613: 出願番号が 特願2023-170613 として取得される', () => {
  const doc = load(F_2023);
  const got = CORE.resolveAppNo(doc, { href: '', pathname: '' });
  assert.equal(got.appNo, '特願2023-170613');
  assert.equal(got.source, '本願番号セル', '新版では #lappnum ではなくセル表示から取得する');
});

test('2023-170613: 請求の範囲・明細書・図面が検出され、日付が 20230929 になる', () => {
  const { items } = CORE.collectDocRows(load(F_2023));
  for (const want of ['請求の範囲', '明細書', '図面']) {
    assert.ok(names(items).includes(want), want + ' が検出されない');
  }
  for (const want of ['請求の範囲', '明細書', '図面']) {
    const it = items.find((x) => x.name === want);
    assert.equal(it.date, '20230929');
  }
});

test('2023-170613: 期待どおりのファイル名が生成される', () => {
  const doc = load(F_2023);
  const appNo = CORE.resolveAppNo(doc, {}).appNo;
  const { items } = CORE.collectDocRows(doc);
  const made = ['請求の範囲', '明細書', '図面'].map((n) => {
    const it = items.find((x) => x.name === n);
    return CORE.buildFileName(CORE.buildBaseName({ appNo, docName: it.name, date: it.date }), 'html');
  });
  assert.deepEqual(made, [
    '特願2023-170613_請求の範囲(20230929).html',
    '特願2023-170613_明細書(20230929).html',
    '特願2023-170613_図面(20230929).html',
  ]);
});

test('2023-170613: OPD 対象なしでも例外にならず「対象なし」を返す', () => {
  const opd = CORE.collectOpdRows(load(F_2023));
  assert.equal(opd.sectionFound, true);
  assert.equal(opd.available, false);
  assert.equal(opd.items.length, 0);
  assert.match(opd.message, /他庁公開情報はありません/);
});

/* ============================================================
 * _特願2022-122252.html（OPD あり）
 * ============================================================ */
test('2022-122252: 出願番号が 特願2022-122252 として取得される', () => {
  const got = CORE.resolveAppNo(load(F_2022), {});
  assert.equal(got.appNo, '特願2022-122252');
});

test('2022-122252: 国内書類が検出され、ダミー行 BBBBBBBBBBB_0000_ が除外される', () => {
  const { items, skipped, scanned } = CORE.collectDocRows(load(F_2022));
  assert.ok(items.length >= 5, '国内書類が検出されない');
  assert.ok(names(items).includes('請求の範囲'));
  assert.ok(names(items).includes('拒絶理由通知書'));

  // ダミー行は 1 件も残っていない
  assert.equal(items.filter((it) => /^B+_/.test(it.id)).length, 0);
  assert.equal(items.filter((it) => CORE.isDummyContentId(it.id)).length, 0);
  assert.ok(skipped.some((s) => /^B+_/.test(s.id)), 'BBBB… 行が除外一覧に入っていない');
  assert.ok(scanned > items.length, '除外が発生していない');

  // 除外理由に「実体なし（_0000_）」と「チェックボックス disabled」が含まれる
  assert.ok(skipped.every((s) => ['dummy', 'disabled', 'no-link', 'no-name-or-date', 'duplicate'].includes(s.reason)));
});

test('2022-122252: OPD 公開番号 3 件が原表記のまま検出される', () => {
  const opd = CORE.collectOpdRows(load(F_2022));
  assert.equal(opd.available, true);
  assert.deepEqual(opd.items.map((x) => x.pubnum), ['EP4312460A1', 'US20240040620A1', 'US20260181694A1']);
  assert.deepEqual(opd.items.map((x) => x.display), ['EP4312460A1', 'US20240040620A1', 'US20260181694A1']);
  assert.deepEqual(opd.items.map((x) => x.date), ['20240131', '20240201', '20260625']);
});

test('2022-122252: OPD は individual / consolidated の両方が選択できる', () => {
  const opd = CORE.collectOpdRows(load(F_2022));
  for (const it of opd.items) {
    assert.equal(it.hasIndividual, true, it.pubnum + ' に individual ボタンがない');
    assert.equal(it.hasConsolidated, true, it.pubnum + ' に consolidated ボタンがない');
  }
  // 送信値は必ずこの 2 つ
  assert.equal(CORE.OPD_MODE.INDIVIDUAL, 'individual');
  assert.equal(CORE.OPD_MODE.CONSOLIDATED, 'consolidated');
});

test('2022-122252: 重複公開番号は正規化して除外される', () => {
  assert.equal(CORE.normalizePubnum('EP 4312460 A1'), 'EP4312460A1');
  assert.equal(CORE.normalizePubnum('ep4312460a1'), 'EP4312460A1');
  const opd = CORE.collectOpdRows(load(F_2022));
  const keys = opd.items.map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length);
});

/* ============================================================
 * 旧世代 / 旧版ページ
 * ============================================================ */
test('旧世代（meta 残存）と旧版ページでも出願番号と文書行を取得できる', () => {
  for (const f of [F_BETA, F_GEM]) {
    const doc = load(f);
    assert.equal(CORE.resolveAppNo(doc, {}).appNo, '特願2024-563143', f);
    const { items } = CORE.collectDocRows(doc);
    assert.ok(items.length > 0, f + ' の文書行が空');
    assert.ok(names(items).includes('請求の範囲'), f);
  }
});

test('ページ種別の検出: new / legacy を URL ヒントから判別できる', () => {
  assert.equal(CORE.detectPage(load(F_2022), {}).generation, 'new');
  assert.equal(CORE.detectPage(load(F_GEM), {}).generation, 'legacy');
  assert.equal(CORE.detectPage(load(F_2022), {}).hasOpdSection, true);
  assert.equal(CORE.detectPage(load(F_2022), {}).hasDoclist, true);
  assert.equal(
    CORE.detectPage(null, { hostname: 'www.beta.jpo.go.jp', pathname: '/main/core/jsv/doclist/exam/12022122252/' }).generation,
    'new'
  );
});

/* ============================================================
 * ファイル名まわり
 * ============================================================ */
test('Windows 禁止文字 \\ / : * ? " < > | が安全な文字へ置換される', () => {
  const name = CORE.buildFileName(CORE.buildBaseName({
    appNo: '特願2023-170613',
    docName: 'A\\B/C:D*E?F"G<H>I|J',
    date: '20230929',
  }), 'txt');
  assert.equal(name, '特願2023-170613_A_B_C_D_E_F_G_H_I_J(20230929).txt');
  assert.equal(/[\\/:*?"<>|]/.test(name.replace(/^[^_]*/, '')), false);
});

test('複数ページ画像の名前が衝突しない（1 ページなら番号なし）', () => {
  const base = CORE.buildBaseName({ appNo: '特願2023-170613', docName: '図面', date: '20230929' });
  assert.equal(CORE.buildFileName(base, 'png', { page: 1, pageCount: 1 }), '特願2023-170613_図面(20230929).png');
  assert.deepEqual(
    [1, 2, 3].map((p) => CORE.buildFileName(base, 'png', { page: p, pageCount: 3 })),
    [
      '特願2023-170613_図面(20230929)_p001.png',
      '特願2023-170613_図面(20230929)_p002.png',
      '特願2023-170613_図面(20230929)_p003.png',
    ]
  );
});

test('同名ファイルは連番になり上書きされない', () => {
  const reg = CORE.createNameRegistry();
  assert.equal(reg.take('特願2023-170613_図面(20230929).png'), '特願2023-170613_図面(20230929).png');
  assert.equal(reg.take('特願2023-170613_図面(20230929).png'), '特願2023-170613_図面(20230929)_2.png');
  assert.equal(reg.take('特願2023-170613_図面(20230929).png'), '特願2023-170613_図面(20230929)_3.png');
  // 大文字小文字は Windows 同様に同一視する
  assert.equal(reg.take('LOG.TXT'), 'LOG.TXT');
  assert.equal(reg.take('log.txt'), 'log_2.txt');
});

test('ラベル指定時だけ先頭に付く', () => {
  assert.equal(
    CORE.buildBaseName({ appNo: '特願2023-170613', docName: '図面', date: '20230929', label: '案件A' }),
    '案件A_特願2023-170613_図面(20230929)'
  );
});

/* ============================================================
 * 出願番号・ダミー判定・HTTP メッセージ・Content-Disposition
 * ============================================================ */
test('数値形式の出願番号を種別つきで変換する', () => {
  assert.equal(CORE.lappnumToAppNo('12023170613'), '特願2023-170613');
  assert.equal(CORE.lappnumToAppNo('22023170613'), '実願2023-170613');
  assert.equal(CORE.lappnumToAppNo('32023170613'), '意願2023-170613');
  assert.equal(CORE.lappnumToAppNo('42023170613'), '商願2023-170613');
  assert.equal(CORE.lappnumToAppNo('92023170613'), '');
  assert.equal(CORE.lappnumToAppNo('123'), '');
});

test('全角・区切り違いの表記も正規化して取り出す', () => {
  assert.equal(CORE.parseAppNoFromText('特願２０２３－１７０６１３'), '特願2023-170613');
  assert.equal(CORE.parseAppNoFromText('経過:特願2022-122252'), '特願2022-122252');
  assert.equal(CORE.parseAppNoFromText('特願2023-170613:請求の範囲(20230929)'), '特願2023-170613');
  assert.equal(CORE.parseAppNoFromText('何もなし'), '');
});

test('ダミー / 実体なしの書類実体番号を判定する', () => {
  assert.equal(CORE.isDummyContentId('BBBBBBBBBBB_0000_ '), true);
  assert.equal(CORE.isDummyContentId('06126043618_0000_ '), true);
  assert.equal(CORE.isDummyContentId(''), true);
  assert.equal(CORE.isDummyContentId(null), true);
  assert.equal(CORE.isDummyContentId('52302116503_0001_L'), false);
  assert.equal(CORE.isDummyContentId('96622043622_0001_C'), false);
});

test('HTTP ステータスを認証切れ / 失効 / サーバエラーに区別する', () => {
  assert.match(CORE.httpErrorMessage(401), /認証切れ|権限不足/);
  assert.match(CORE.httpErrorMessage(403), /認証切れ|権限不足/);
  assert.match(CORE.httpErrorMessage(404), /見つかりません/);
  assert.match(CORE.httpErrorMessage(500), /サーバエラー/);
  assert.match(CORE.httpErrorMessage(418), /HTTP 418/);
});

test('Content-Disposition からファイル名を安全に取り出す', () => {
  assert.equal(CORE.parseContentDispositionFilename('attachment; filename="opd_EP4312460A1.zip"'), 'opd_EP4312460A1.zip');
  assert.equal(
    CORE.parseContentDispositionFilename("attachment; filename*=UTF-8''%E5%9B%B3%E9%9D%A2.pdf"),
    '図面.pdf'
  );
  // パス区切りを含む値でもディレクトリを外して安全化する
  assert.equal(CORE.parseContentDispositionFilename('attachment; filename="../../etc/passwd"'), 'passwd');
  assert.equal(CORE.parseContentDispositionFilename(''), '');
  assert.equal(CORE.parseContentDispositionFilename(null), '');
});

/* ============================================================
 * URL 解決（推測を固定しないこと）
 * ============================================================ */
test('書類実体 URL はページ定数 → pathname → 既定 の順で解決する', () => {
  assert.equal(
    CORE.resolveContentUrlTemplate({ URL_JSV_CONTENT: '/x/{content_id}/' }, {}, {}).template,
    '/x/{content_id}/'
  );
  assert.equal(
    CORE.resolveContentUrlTemplate({}, { pathname: '/main/core/jsv/doclist/exam/12022122252/' }, {}).template,
    '/main/core/jsv/content/{content_id}/'
  );
  assert.equal(
    CORE.resolveContentUrlTemplate({}, { pathname: '/core/docs/jsv/doclist/exam/12024563143/' }, {}).template,
    '/core/docs/jsv/content/{content_id}/'
  );
  assert.equal(
    CORE.resolveContentUrlTemplate({}, {}, { generation: 'legacy' }).template,
    '/core/docs/jsv/content/{content_id}/'
  );
});

test('OPD の URL 定数は見つからなければ空（推測値を返さない）', () => {
  const none = CORE.opdUrlsFromGlobals({});
  assert.equal(none.statusUrl, '');
  assert.equal(none.downloadTemplate, '');

  const got = CORE.opdUrlsFromGlobals({
    URL_OPD_BULK_STATUS: '/main/core/opd/bulk/status/',
    URL_OPD_BULK_DOWNLOAD: '/main/core/opd/bulk/{hashkey}/',
  });
  assert.equal(got.statusUrl, '/main/core/opd/bulk/status/');
  assert.equal(got.downloadTemplate, '/main/core/opd/bulk/{hashkey}/');

  // {hashkey} を含まないダウンロード定数は採用しない
  assert.equal(CORE.opdUrlsFromGlobals({ URL_OPD_BULK_DOWNLOAD: '/main/core/opd/bulk/' }).downloadTemplate, '');
});

test('共通 JS のソースから URL 定数を実測できる', () => {
  const src = "const URL_OPD_BULK_STATUS = '/main/core/opd/bulk/status/';\n" +
    'const URL_OPD_BULK_DOWNLOAD = "/main/core/opd/bulk/{hashkey}/";';
  assert.deepEqual(CORE.extractOpdUrlsFromSource(src), {
    statusUrl: '/main/core/opd/bulk/status/',
    downloadTemplate: '/main/core/opd/bulk/{hashkey}/',
  });
  assert.deepEqual(CORE.extractOpdUrlsFromSource('無関係なJS'), { statusUrl: '', downloadTemplate: '' });
});

/* ============================================================
 * OPD 状態モデル
 * ============================================================ */
test('OPD の内部状態と表示文言が 1 対 1 で対応している', () => {
  const keys = Object.keys(CORE.OPD_STATE);
  assert.deepEqual(keys.sort(), ['CANCELED', 'DOWNLOAD_STARTED', 'FAILED', 'GENERATING', 'NO_TARGET', 'WAITING']);
  for (const k of keys) {
    assert.equal(CORE.OPD_STATE[k], k);
    assert.ok(CORE.OPD_STATE_META[k], k + ' の表示定義がない');
    assert.ok(CORE.OPD_STATE_META[k].label);
    assert.ok(CORE.OPD_STATE_META[k].cls);
  }
  assert.equal(CORE.OPD_STATE_META.WAITING.label, '待機中');
  assert.equal(CORE.OPD_STATE_META.GENERATING.label, '生成中');
  assert.equal(CORE.OPD_STATE_META.DOWNLOAD_STARTED.label, 'ダウンロード開始');
  assert.equal(CORE.OPD_STATE_META.NO_TARGET.label, '対象なし');
  assert.equal(CORE.OPD_STATE_META.FAILED.label, '失敗');
  assert.equal(CORE.OPD_STATE_META.CANCELED.label, 'キャンセル');
  // 無限ポーリング防止の上限が設定されている
  assert.ok(CORE.OPD_MAX_WAIT_MS > 0 && CORE.OPD_MAX_WAIT_MS <= 600000);
  assert.equal(CORE.OPD_POLL_INTERVAL_MS, 1000); // doclist.js の INTERVAL_BULK_STATUS = 1*1000
});

/* ============================================================
 * HTML → テキスト
 * ============================================================ */
test('HTML をブロック単位で改行したテキストに変換する', () => {
  const doc = parseHTML('<body><h1>題</h1><p>あ<br>い</p><script>x=1</script><table><tr><td>A</td><td>B</td></tr></table></body>');
  const text = CORE.htmlToText(doc.body);
  assert.match(text, /題/);
  assert.match(text, /あ\nい/);
  assert.equal(text.includes('x=1'), false, 'script の中身が混ざっている');
  assert.match(text, /A\tB/);
});
