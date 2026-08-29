'use strict';
/*
 * bookmarklet.test.js — collector.js と collector.bookmarklet.js が同期していることの検証
 *
 * このプロジェクトにはビルド工程がない（軽量版プロファイル）。1 行版は README の
 * 手順どおり「% → %25、# → %23、改行 → %0A」の最小 URL エンコードで作る決定論的な
 * 変換なので、ここで同じ変換を再現して差分を検出する。
 * 「collector.js だけ直して collector.bookmarklet.js が古い」状態はこのテストで落ちる。
 *
 * 実行: node --test "blank_note_printer/tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'bookmarklet', 'collector.js');
const OUT = path.join(__dirname, '..', 'src', 'bookmarklet', 'collector.bookmarklet.js');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

/* 最小 URL エンコード（順序厳守: % を最初に潰す） */
function encodeBookmarklet(source) {
  return 'javascript:' + source
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\r\n|\r|\n/g, '%0A');
}

test('collector.bookmarklet.js は javascript: で始まる 1 行になっている', () => {
  const text = read(OUT);
  const url = text.trimEnd();
  assert.ok(url.startsWith('javascript:'), 'javascript: で始まっていない');
  assert.equal(url.indexOf('\n'), -1, '改行が残っている');
  assert.equal(text.split('\n').filter((l) => l.length > 0).length, 1, '1 行ではない');
});

test('エンコードの不変条件とラウンドトリップ', () => {
  const payload = read(OUT).trimEnd().slice('javascript:'.length);
  assert.equal(payload.indexOf('\n'), -1);
  assert.equal(payload.indexOf('#'), -1, '生の # はフラグメント区切りになるため残してはいけない');
  assert.ok(!/%(?![0-9A-Fa-f]{2})/.test(payload), '不正な % エスケープがある');
  assert.equal(decodeURIComponent(payload), read(SRC), 'デコードして collector.js に戻らない');
});

test('生成物がソースと同期している（手動反映の漏れ検出）', () => {
  assert.equal(
    read(OUT).trimEnd(),
    encodeBookmarklet(read(SRC)).trimEnd(),
    'collector.bookmarklet.js が collector.js と同期していません。' +
    ' README「開発（ビルドなし）」の手順で 1 行版を作り直してください。'
  );
});

test('対象ページの CSP（script-src self）に合わせて eval / new Function を含まない', () => {
  const code = read(SRC).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\beval\s*\(/.test(code), false, 'eval( を含んでいる');
  assert.equal(/\bnew\s+Function\s*\(/.test(code), false, 'new Function( を含んでいる');
});

test('ブックマークレットのサイズがブラウザの実用上限に収まっている', () => {
  assert.ok(Buffer.byteLength(read(OUT).trimEnd(), 'utf8') < 100000, 'URL が 100KB を超えている');
});
