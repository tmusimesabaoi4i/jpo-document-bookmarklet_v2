'use strict';
/*
 * build.test.js — marker.js と marker.bookmarklet.js が同期していることの検証
 * 実行: node --test term_marker/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const build = require('../scripts/build-bookmarklet');

const ROOT = path.join(__dirname, '..');
const readNormalized = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

test('marker.bookmarklet.js は javascript: で始まる 1 行になっている', () => {
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
    'marker.bookmarklet.js が marker.js と同期していません。' +
    ' node term_marker/scripts/build-bookmarklet.js を実行してください。'
  );
});

test('marker.js に構文エラーがない（デコード後の実行形も含む）と CORE の公開 API', () => {
  assert.doesNotThrow(() => build.buildArtifact());
  const CORE = require('../src/bookmarklet/marker');
  for (const fn of ['buildTextMap', 'extractTerms', 'computeRanges', 'applyMarks', 'unmarkAll', 'buildExportHtml', 'exportFileName']) {
    assert.equal(typeof CORE[fn], 'function', fn);
  }
  assert.equal(CORE.PALETTE.length, 25);
});

test('実行時コードに eval / new Function / 外部通信を含まない', () => {
  const src = readNormalized(build.SOURCE);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\beval\s*\(/.test(code), false, 'eval( を含んでいる');
  assert.equal(/\bnew\s+Function\s*\(/.test(code), false, 'new Function( を含んでいる');
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(code), false, '外部通信 API を含んでいる');
  assert.equal(/<script[^>]*src=|https?:\/\/cdn/.test(code), false, '外部スクリプトを参照している');
  assert.equal(/\.innerHTML\s*=/.test(code), false, 'innerHTML 代入を含んでいる（本文破壊の温床）');
  assert.equal(/document\.write/.test(code), false);
});

test('二重起動対策: window 上の名前空間は 1 つだけ', () => {
  const src = readNormalized(build.SOURCE);
  const globals = new Set((src.match(/win(?:dow)?\[NS\]|window\.__\w+/g) || []));
  assert.ok(src.includes("const NS = '__jpoTermMarker'"));
  for (const g of globals) assert.ok(/NS\]|__jpoTermMarker/.test(g), '想定外のグローバル: ' + g);
});

test('ブックマークレットのサイズがブラウザの実用上限に収まっている', () => {
  const artifact = build.buildArtifact();
  assert.ok(artifact.urlBytes < 100000, artifact.urlBytes + ' bytes は大きすぎる');
});
