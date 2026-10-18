'use strict';
/*
 * collector.test.js — fixtures の実 HTML に対する出願番号取得の検証（依存ゼロ）
 * 実行: node --test "blank_note_printer/tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('./minidom');
const CORE = require('../src/bookmarklet/collector');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'document-list');
const load = (rel) => parseHTML(fs.readFileSync(path.join(FIXTURES, rel), 'utf8'));

const F_2022 = 'new/経過_特願2022-122252.html';   // 新版（#lappnum は「Evrikaでスクリーニング」）
const F_2023 = 'new/経過_特願2023-170613.html';   // 新版
const F_2025 = 'new/経過_特願2025-557197.html';   // 新 UI（2026）
const F_BETA = 'legacy/特願2024-563143_beta.html'; // 旧世代（meta[LappnumStr] 残存 / #lappnum に出願番号）
const F_GEM = 'legacy/特願2024-563143.html';       // 旧版ページ（gem.prototype）

/* ============================================================
 * 新 JPO ページ（2026）
 * ============================================================ */
test('新ページ: 経過_特願2022-122252.html から 特願2022-122252 を取得する', () => {
  const got = CORE.resolveAppNo(load(F_2022), {});
  assert.equal(got.appNo, '特願2022-122252');
});

test('新ページ: 経過_特願2023-170613.html から 特願2023-170613 を取得する', () => {
  const got = CORE.resolveAppNo(load(F_2023), {});
  assert.equal(got.appNo, '特願2023-170613');
});

test('新ページ: #lappnum の「Evrikaでスクリーニング」を出願番号にしない', () => {
  const doc = load(F_2022);
  // fixture の #lappnum は出願番号ではない文言である（前提の固定）
  assert.equal(doc.querySelector('#lappnum').textContent.trim(), 'Evrikaでスクリーニング');
  // その文言からは出願番号を取り出さない
  assert.equal(CORE.parseAppNoFromText('Evrikaでスクリーニング'), '');
  // 実際の解決も #lappnum 以外（本願番号セル）から行われる
  const got = CORE.resolveAppNo(doc, {});
  assert.equal(got.source, '本願番号セル');
  assert.ok(got.tried.includes('#lappnum'), '#lappnum を試したうえで空振りしているはず');
  assert.equal(got.appNo.includes('Evrika'), false);
});

test('新ページ: 保存されるファイル名が 出願番号_note になる', () => {
  assert.equal(CORE.buildNoteTitle(CORE.resolveAppNo(load(F_2022), {}).appNo), '特願2022-122252_note');
  assert.equal(CORE.buildNoteTitle(CORE.resolveAppNo(load(F_2023), {}).appNo), '特願2023-170613_note');
  assert.equal(CORE.buildNoteTitle(CORE.resolveAppNo(load(F_2025), {}).appNo), '特願2025-557197_note');
});

/* ============================================================
 * 旧世代 / 旧版ページ（従来動作の維持）
 * ============================================================ */
test('旧世代ページでも従来どおり出願番号を取得できる', () => {
  for (const f of [F_BETA, F_GEM]) {
    const got = CORE.resolveAppNo(load(f), {});
    assert.equal(got.appNo, '特願2024-563143', f);
    assert.equal(CORE.buildNoteTitle(got.appNo), '特願2024-563143_note', f);
  }
});

test('DOM から取れないときは URL の 11 桁出願番号にフォールバックする', () => {
  const doc = parseHTML('<html><head><title>経過</title></head><body></body></html>');
  const got = CORE.resolveAppNo(doc, { href: 'https://www.beta.jpo.go.jp/main/core/jsv/doclist/exam/12022122252/' });
  assert.equal(got.appNo, '特願2022-122252');
  assert.equal(got.source, 'URL');
});

test('どこからも取れないときは空を返す（誤った名前で保存しない）', () => {
  const doc = parseHTML('<html><head><title>なにか</title></head><body><a id="lappnum">Evrikaでスクリーニング</a></body></html>');
  const got = CORE.resolveAppNo(doc, {});
  assert.equal(got.appNo, '');
  assert.ok(got.tried.length >= 5, '各フォールバックを試した記録が残る');
});

/* ============================================================
 * 文字列ユーティリティ
 * ============================================================ */
test('数値形式の出願番号を種別つきで変換する', () => {
  assert.equal(CORE.lappnumToAppNo('12023170613'), '特願2023-170613');
  assert.equal(CORE.lappnumToAppNo('22023170613'), '実願2023-170613');
  assert.equal(CORE.lappnumToAppNo('32023170613'), '意願2023-170613');
  assert.equal(CORE.lappnumToAppNo('42023170613'), '商願2023-170613');
  assert.equal(CORE.lappnumToAppNo('92023170613'), '');
});

test('全角・区切り違いの表記も正規化して取り出す', () => {
  assert.equal(CORE.parseAppNoFromText('特願２０２２－１２２２５２'), '特願2022-122252');
  assert.equal(CORE.parseAppNoFromText('経過:特願2022-122252'), '特願2022-122252');
  assert.equal(CORE.parseAppNoFromText('特願2022-122252 (20220729) [ Evrikaでスクリーニング ]'), '特願2022-122252');
  assert.equal(CORE.parseAppNoFromText('何もなし'), '');
});

test('Windows で使えない文字はファイル名から除去される', () => {
  assert.equal(CORE.buildNoteTitle('特願2022-122252'), '特願2022-122252_note');
  assert.equal(CORE.buildNoteTitle('A\\B/C:D*E?F"G<H>I|J'), 'A_B_C_D_E_F_G_H_I_J_note');
  assert.equal(CORE.buildNoteTitle(''), 'noname_note');
});

/* ============================================================
 * 空白 A4 の生成仕様（今回変更していないことの確認）
 * ============================================================ */
test('空白 A4 は PAGE_COUNT 枚・完全な白紙で、<title> が保存名になる', () => {
  const html = CORE.buildNoteHTML('特願2022-122252_note', CORE.PAGE_COUNT);
  assert.equal(CORE.PAGE_COUNT, 30);
  assert.equal((html.match(/<div class="page"><\/div>/g) || []).length, 30);
  assert.match(html, /<title>特願2022-122252_note<\/title>/);
  assert.match(html, /@page\{size:A4;margin:0;\}/);
  assert.equal(/<body>(<div class="page"><\/div>)+<\/body>/.test(html), true, 'ページ箱以外の中身が入っている');
});
