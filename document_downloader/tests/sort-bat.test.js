'use strict';
/*
 * sort-bat.test.js — src/sort_jpo_downloads.bat の振る舞い検証（依存ゼロ）
 *
 * 本物のダウンロードフォルダは絶対に触らない。毎回 OS の一時ディレクトリに
 * ダウンロードフォルダを模した作業用フォルダを作り、そこへ BAT をコピーして実行する。
 * Windows 以外では BAT を実行できないのでスキップする。
 *
 * 実行: node --test "document_downloader/tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BAT = path.join(__dirname, '..', 'src', 'sort_jpo_downloads.bat');
const BAT_NAME = 'sort_jpo_downloads.bat';
const WINDOWS = process.platform === 'win32';
const skip = WINDOWS ? false : 'Windows 以外では cmd.exe を実行できないためスキップ';

/* 作業用フォルダを作り、files（名前 → 更新時刻の相対分）を並べて BAT をコピーする。
 * 更新時刻は「直近＝分の値が大きい」となるように基準時刻からの分数で指定する。 */
function makeDownloadsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpo-sort-'));
  const base = Date.now() - 3600 * 1000;
  for (const [name, minutes] of files) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'dummy');
    const t = new Date(base + minutes * 60 * 1000);
    fs.utimesSync(p, t, t);
  }
  fs.copyFileSync(BAT, path.join(dir, BAT_NAME));
  return dir;
}

function runBat(dir, arg) {
  const args = ['/c', path.join(dir, BAT_NAME)];
  if (arg) args.push(arg);
  const res = spawnSync('cmd.exe', args, {
    cwd: dir,
    env: Object.assign({}, process.env, { JPO_SORT_NOPAUSE: '1' }),
    encoding: 'buffer',
    windowsHide: true,
  });
  return {
    status: res.status,
    stdout: (res.stdout || Buffer.alloc(0)).toString('utf8'),
    stderr: (res.stderr || Buffer.alloc(0)).toString('utf8'),
  };
}

/* dir 以下の相対パス一覧（フォルダは末尾 \ 付き）をソートして返す */
function listTree(dir) {
  const out = [];
  (function walk(cur, prefix) {
    for (const e of fs.readdirSync(cur, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory()) {
        out.push(prefix + e.name + '/');
        walk(path.join(cur, e.name), prefix + e.name + '/');
      } else {
        out.push(prefix + e.name);
      }
    }
  })(dir, '');
  return out;
}

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/* ============================================================
 * 新命名の一括仕分け（HTML / TXT / PDF / IMG / OPD）
 * ============================================================ */
test('新命名: 拡張子別に仕分けし、他出願・非対象ファイル・BAT 自身は動かさない', { skip }, () => {
  const dir = makeDownloadsDir([
    ['特願2022-122252_20260602_手続補正書（自発・内容）.pdf', 1],
    ['特願2022-122252_20260602_手続補正書（自発・内容）.html', 2],
    ['特願2022-122252_20260602_手続補正書（自発・内容）.txt', 3],
    ['特願2022-122252_20220729_図面_p004.png', 4],
    ['特願2023-170613_20260727_意見書.pdf', 5],   // 別出願（直近ではない）
    ['特願2022-122252_EP4312460A1.zip', 6],       // これが直近 → 対象は 特願2022-122252
    ['特願2022-122252_note.pdf', 0],              // blank_note_printer の出力
    ['メモ.txt', 3],                              // 出願番号なし → 動かさない
    ['特願2022-122252_20260602_応対記録.docx', 4],// 対象外拡張子 → 動かさない
  ]);
  try {
    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Newest file : 特願2022-122252_EP4312460A1\.zip/);
    assert.match(r.stdout, /Target      : 特願2022-122252/);

    assert.deepEqual(listTree(dir), [
      'sort_jpo_downloads.bat',
      'メモ.txt',
      '特願2022-122252/',
      '特願2022-122252/HTML/',
      '特願2022-122252/HTML/特願2022-122252_20260602_手続補正書（自発・内容）.html',
      '特願2022-122252/IMG/',
      '特願2022-122252/IMG/特願2022-122252_20220729_図面_p004.png',
      '特願2022-122252/OPD/',
      '特願2022-122252/OPD/特願2022-122252_EP4312460A1.zip',
      '特願2022-122252/PDF/',
      '特願2022-122252/PDF/特願2022-122252_20260602_手続補正書（自発・内容）.pdf',
      '特願2022-122252/PDF/特願2022-122252_note.pdf',
      '特願2022-122252/TXT/',
      '特願2022-122252/TXT/特願2022-122252_20260602_手続補正書（自発・内容）.txt',
      '特願2022-122252_20260602_応対記録.docx',
      '特願2023-170613_20260727_意見書.pdf',
    ]);
    // 日本語ファイル名が壊れていない（全角括弧・中点をそのまま保持）
    assert.ok(fs.existsSync(path.join(dir, '特願2022-122252', 'PDF', '特願2022-122252_20260602_手続補正書（自発・内容）.pdf')));
  } finally {
    cleanup(dir);
  }
});

/* ============================================================
 * 旧命名との互換
 * ============================================================ */
test('旧命名（出願番号_文書名(YYYYMMDD)）も同じ出願番号として仕分ける', { skip }, () => {
  const dir = makeDownloadsDir([
    ['特願2022-122252_手続補正書（自発・内容）(20260602).pdf', 1],
    ['特願2022-122252_手続補正書（自発・内容）(20260602).html', 2],
    ['特願2022-122252_手続補正書（自発・内容）(20260602).txt', 3],
    ['特願2022-122252_図面(20220729)_p004.png', 4],
    ['特願2022-122252_20260602_意見書.pdf', 5],   // 新命名が混在していても同じ出願番号
  ]);
  try {
    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(listTree(dir), [
      'sort_jpo_downloads.bat',
      '特願2022-122252/',
      '特願2022-122252/HTML/',
      '特願2022-122252/HTML/特願2022-122252_手続補正書（自発・内容）(20260602).html',
      '特願2022-122252/IMG/',
      '特願2022-122252/IMG/特願2022-122252_図面(20220729)_p004.png',
      '特願2022-122252/PDF/',
      '特願2022-122252/PDF/特願2022-122252_20260602_意見書.pdf',
      '特願2022-122252/PDF/特願2022-122252_手続補正書（自発・内容）(20260602).pdf',
      '特願2022-122252/TXT/',
      '特願2022-122252/TXT/特願2022-122252_手続補正書（自発・内容）(20260602).txt',
    ]);
    // ZIP が無いので OPD フォルダは作らない
    assert.equal(fs.existsSync(path.join(dir, '特願2022-122252', 'OPD')), false);
  } finally {
    cleanup(dir);
  }
});

/* ============================================================
 * 直近判定 — 別出願を巻き込まない
 * ============================================================ */
test('直近ファイルが別出願なら、その別出願だけが対象になる', { skip }, () => {
  const dir = makeDownloadsDir([
    ['特願2022-122252_20260602_手続補正書.pdf', 1],
    ['特願2023-170613_20260727_意見書.pdf', 9],   // 直近
    ['特願2022-122252_EP4312460A1.zip', 2],
  ]);
  try {
    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Target      : 特願2023-170613/);
    assert.deepEqual(listTree(dir), [
      'sort_jpo_downloads.bat',
      '特願2022-122252_20260602_手続補正書.pdf',
      '特願2022-122252_EP4312460A1.zip',
      '特願2023-170613/',
      '特願2023-170613/PDF/',
      '特願2023-170613/PDF/特願2023-170613_20260727_意見書.pdf',
    ]);
  } finally {
    cleanup(dir);
  }
});

test('直近が対象外ファイルでも、有効な候補の中の直近で判定する', { skip }, () => {
  const dir = makeDownloadsDir([
    ['特願2022-122252_20260602_手続補正書.pdf', 1],
    ['setup.exe', 99],       // 対象外拡張子（判定に使わない）
    ['領収書.pdf', 98],       // 出願番号なし（判定に使わない）
  ]);
  try {
    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Target      : 特願2022-122252/);
    assert.deepEqual(listTree(dir), [
      'setup.exe',
      'sort_jpo_downloads.bat',
      '特願2022-122252/',
      '特願2022-122252/PDF/',
      '特願2022-122252/PDF/特願2022-122252_20260602_手続補正書.pdf',
      '領収書.pdf',
    ]);
  } finally {
    cleanup(dir);
  }
});

/* ============================================================
 * 引数による明示指定
 * ============================================================ */
test('引数を指定すると、直近が別出願でも指定した出願番号だけを仕分ける', { skip }, () => {
  const dir = makeDownloadsDir([
    ['特願2022-122252_20260602_手続補正書.pdf', 1],
    ['特願2022-122252_EP4312460A1.zip', 2],
    ['特願2023-170613_20260727_意見書.pdf', 9],   // 直近だが対象外
  ]);
  try {
    const r = runBat(dir, '特願2022-122252');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Target      : 特願2022-122252  \(from argument\)/);
    assert.deepEqual(listTree(dir), [
      'sort_jpo_downloads.bat',
      '特願2022-122252/',
      '特願2022-122252/OPD/',
      '特願2022-122252/OPD/特願2022-122252_EP4312460A1.zip',
      '特願2022-122252/PDF/',
      '特願2022-122252/PDF/特願2022-122252_20260602_手続補正書.pdf',
      '特願2023-170613_20260727_意見書.pdf',
    ]);
  } finally {
    cleanup(dir);
  }
});

test('出願番号として不正な引数はエラーにして 1 件も動かさない', { skip }, () => {
  const dir = makeDownloadsDir([['特願2022-122252_20260602_手続補正書.pdf', 1]]);
  try {
    const r = runBat(dir, 'とりあえず全部');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR: not a JPO application number/);
    assert.deepEqual(listTree(dir), ['sort_jpo_downloads.bat', '特願2022-122252_20260602_手続補正書.pdf']);
  } finally {
    cleanup(dir);
  }
});

/* ============================================================
 * 安全性
 * ============================================================ */
test('移動先に同名があっても上書きせず _2 / _3 を付ける', { skip }, () => {
  const dir = makeDownloadsDir([['特願2022-122252_20220729_図面_p004.png', 1]]);
  try {
    const img = path.join(dir, '特願2022-122252', 'IMG');
    fs.mkdirSync(img, { recursive: true });
    fs.writeFileSync(path.join(img, '特願2022-122252_20220729_図面_p004.png'), 'OLD-1');
    fs.writeFileSync(path.join(img, '特願2022-122252_20220729_図面_p004_2.png'), 'OLD-2');

    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // 既存 2 件はそのまま、新しいものが _3 になる
    assert.equal(fs.readFileSync(path.join(img, '特願2022-122252_20220729_図面_p004.png'), 'utf8'), 'OLD-1');
    assert.equal(fs.readFileSync(path.join(img, '特願2022-122252_20220729_図面_p004_2.png'), 'utf8'), 'OLD-2');
    assert.equal(fs.readFileSync(path.join(img, '特願2022-122252_20220729_図面_p004_3.png'), 'utf8'), 'dummy');
  } finally {
    cleanup(dir);
  }
});

test('仕分け済みフォルダの中は再処理しない（直下のファイルだけが対象）', { skip }, () => {
  const dir = makeDownloadsDir([['特願2022-122252_EP4312460A1.zip', 1]]);
  try {
    const pdfDir = path.join(dir, '特願2023-170613', 'PDF');
    fs.mkdirSync(pdfDir, { recursive: true });
    fs.writeFileSync(path.join(pdfDir, '特願2023-170613_20260727_意見書.pdf'), 'kept');

    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // 既存の別出願フォルダは一切変化しない
    assert.deepEqual(listTree(path.join(dir, '特願2023-170613')), [
      'PDF/',
      'PDF/特願2023-170613_20260727_意見書.pdf',
    ]);
    assert.ok(fs.existsSync(path.join(dir, '特願2022-122252', 'OPD', '特願2022-122252_EP4312460A1.zip')));
  } finally {
    cleanup(dir);
  }
});

test('対象になるファイルが 1 件も無ければ何も作らず正常終了する', { skip }, () => {
  const dir = makeDownloadsDir([['請求書.pdf', 1], ['メモ.txt', 2]]);
  try {
    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /No JPO file with a leading application number/);
    assert.deepEqual(listTree(dir), ['sort_jpo_downloads.bat', 'メモ.txt', '請求書.pdf']);
  } finally {
    cleanup(dir);
  }
});

/* ============================================================
 * 出願番号の抽出仕様（BAT 側の regex を固定する）
 * ============================================================ */
test('特願以外の種別（実願 / 意願 / 商願）も認識する', { skip }, () => {
  const dir = makeDownloadsDir([
    ['実願2022-000123_20260602_明細書.txt', 1],
    ['意願2022-000123_20260602_図面.png', 2],
    ['商願2022-000123_20260602_商標登録願.pdf', 3],  // 直近
  ]);
  try {
    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Target      : 商願2022-000123/);
    assert.deepEqual(listTree(dir), [
      'sort_jpo_downloads.bat',
      '商願2022-000123/',
      '商願2022-000123/PDF/',
      '商願2022-000123/PDF/商願2022-000123_20260602_商標登録願.pdf',
      '実願2022-000123_20260602_明細書.txt',
      '意願2022-000123_20260602_図面.png',
    ]);
  } finally {
    cleanup(dir);
  }
});

test('出願番号に見えるが形が違う名前は動かさない（fail-safe）', { skip }, () => {
  const dir = makeDownloadsDir([
    ['特願2022-12225_20260602_桁不足.pdf', 1],       // 連番 5 桁
    ['参考_特願2022-122252_20260602.pdf', 2],        // 先頭が出願番号でない
    ['特願2022-122252X_20260602_区切り違い.pdf', 3], // 直後が _ でも . でもない
    ['特願2022-122252_20260602_正しい.pdf', 4],
  ]);
  try {
    const r = runBat(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(listTree(dir), [
      'sort_jpo_downloads.bat',
      '参考_特願2022-122252_20260602.pdf',
      '特願2022-122252/',
      '特願2022-122252/PDF/',
      '特願2022-122252/PDF/特願2022-122252_20260602_正しい.pdf',
      '特願2022-122252X_20260602_区切り違い.pdf',
      '特願2022-12225_20260602_桁不足.pdf',
    ]);
  } finally {
    cleanup(dir);
  }
});

/* ============================================================
 * 旧仕様が残っていないこと
 * ============================================================ */
test('BAT に旧仕様（HTML_INI / 1時間フィルタ / PDF・ZIP 除外）が残っていない', () => {
  const src = fs.readFileSync(BAT, 'utf8');
  assert.equal(src.includes('HTML_INI'), false, 'HTML_INI は廃止した');
  assert.equal(/AddHours\(-1\)/.test(src), false, '直近1時間フィルタは廃止した');
  for (const bucket of ['HTML', 'TXT', 'PDF', 'IMG', 'OPD']) {
    assert.ok(new RegExp("'" + bucket + "'").test(src), bucket + ' フォルダの定義がない');
  }
  for (const ext of ['.pdf', '.zip', '.html', '.htm', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']) {
    assert.ok(src.includes("'" + ext + "'"), ext + ' が対象拡張子に入っていない');
  }
  // 日付の位置を前提にした抽出はしない（先頭の出願番号だけを見る）
  assert.ok(src.includes("'^(特願|実願|意願|商願)[0-9]{4}-[0-9]{6}(?=[_.]|$)'"), '出願番号の抽出パターンが変わっている');
});
