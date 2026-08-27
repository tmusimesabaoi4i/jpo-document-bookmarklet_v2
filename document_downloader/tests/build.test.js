'use strict';
/*
 * build.test.js — collector.js と collector.bookmarklet.js が同期していることの検証
 * 実行: node --test document_downloader/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const build = require('../scripts/build-bookmarklet');

const ROOT = path.join(__dirname, '..');
const readNormalized = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

test('collector.bookmarklet.js は javascript: で始まる 1 行になっている', () => {
  const text = readNormalized(build.OUTPUT);
  const url = text.trimEnd();
  assert.ok(url.startsWith('javascript:'), 'javascript: で始まっていない');
  assert.equal(url.indexOf('\n'), -1, '改行が残っている');
  assert.equal(text.split('\n').filter((l) => l.length > 0).length, 1, '1 行ではない');
});

test('エンコードの不変条件とラウンドトリップ', () => {
  const artifact = build.buildArtifact();
  const payload = artifact.bookmarklet.trimEnd().slice('javascript:'.length);
  assert.equal(payload.indexOf('\n'), -1);
  assert.equal(payload.indexOf('#'), -1, '生の # はフラグメント区切りになるため残してはいけない');
  assert.ok(!/%(?![0-9A-Fa-f]{2})/.test(payload), '不正な % エスケープがある');
  assert.equal(decodeURIComponent(payload), artifact.body, 'デコードして元に戻らない');
});

test('生成物がソースと同期している（ロジックのずれ検出）', () => {
  const expected = build.buildArtifact().bookmarklet.replace(/\r\n?/g, '\n');
  const actual = readNormalized(build.OUTPUT);
  assert.equal(
    actual,
    expected,
    'collector.bookmarklet.js が collector.js と同期していません。' +
    ' node document_downloader/scripts/build-bookmarklet.js を実行してください。'
  );
});

test('collector.js に構文エラーがない（デコード後の実行形も含む）', () => {
  // buildArtifact() 内で new Function(body) による構文検証が走る
  assert.doesNotThrow(() => build.buildArtifact());
  // ソース単体としても読み込める（CORE を module.exports 経由で取得できる）
  const CORE = require('../src/bookmarklet/collector');
  assert.equal(typeof CORE.collectDocRows, 'function');
  assert.equal(typeof CORE.collectOpdRows, 'function');
});

test('実行時コードに eval / new Function を含まない（対象ページの CSP: script-src self）', () => {
  const src = readNormalized(build.SOURCE);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\beval\s*\(/.test(code), false, 'eval( を含んでいる');
  assert.equal(/\bnew\s+Function\s*\(/.test(code), false, 'new Function( を含んでいる');
});

test('ブックマークレットのサイズがブラウザの実用上限に収まっている', () => {
  const artifact = build.buildArtifact();
  assert.ok(artifact.urlBytes < 100000, 'URL が 100KB を超えている: ' + artifact.urlBytes);
});
