'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const build = require('../scripts/build-bookmarklets');

const ROOT = path.join(__dirname, '..');

function readArtifact(name) {
  return fs.readFileSync(path.join(ROOT, build.OUT_DIR, name), 'utf8');
}

test('生成物が最新のソースと同期している（要 npm run build:bookmarklets）', () => {
  const artifacts = build.buildArtifacts();
  assert.strictEqual(readArtifact(build.OUT_NAME + '.js'), artifacts.collector,
    'comparator.js が古い。npm run build:bookmarklets を実行すること');
  assert.strictEqual(readArtifact(build.OUT_NAME + '.bookmarklet.js'), artifacts.bookmarklet,
    'comparator.bookmarklet.js が古い。npm run build:bookmarklets を実行すること');
});

test('1行版は javascript: で始まり、改行と生の # を含まない', () => {
  const url = readArtifact(build.OUT_NAME + '.bookmarklet.js').replace(/\n$/, '');
  assert.ok(url.startsWith('javascript:'));
  const payload = url.slice('javascript:'.length);
  assert.strictEqual(payload.indexOf('\n'), -1);
  assert.strictEqual(payload.indexOf('#'), -1);
  assert.ok(!/%(?![0-9A-Fa-f]{2})/.test(payload), '不正な % エスケープ');
});

test('1行版をデコードすると読みやすい版の本体に戻る', () => {
  const url = readArtifact(build.OUT_NAME + '.bookmarklet.js').replace(/\n$/, '');
  const decoded = decodeURIComponent(url.slice('javascript:'.length));
  assert.strictEqual(decoded, build.buildBody());
  // 構文として妥当（ここでは実行しない）
  assert.doesNotThrow(() => new Function(decoded));
});

test('読みやすい版には DO NOT EDIT バナーが付く', () => {
  const source = readArtifact(build.OUT_NAME + '.js');
  assert.ok(source.startsWith('/*\n * このファイルは自動生成です'));
  assert.ok(source.indexOf('npm run build:bookmarklets') !== -1);
});

test('生成は決定論（同じソースから同じ出力）', () => {
  assert.strictEqual(build.buildArtifacts().bookmarklet, build.buildArtifacts().bookmarklet);
});

test('連結順にすべてのソースが含まれ、UMD の誤分岐を遮断している', () => {
  const body = build.buildBody();
  for (const relPath of build.SOURCE_ORDER) {
    const marker = path.basename(relPath).replace('.js', '.js —');
    assert.ok(body.indexOf(marker) !== -1, relPath + ' が連結されていない');
  }
  assert.ok(body.indexOf('var module, exports;') !== -1);
  assert.ok(body.indexOf('globalThis.JCGC.launcherApp.launch({});') !== -1);
});

// コメントを落としたコード部分だけを見る（禁止語は設計メモの中には出てくるため）
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[\s;{}(),])\/\/.*$/, '$1'))
    .join('\n');
}

test('禁止している実行経路（eval・document.write・script 注入）を含まない', () => {
  const body = codeOnly(build.buildBody());
  for (const forbidden of ['document.write', 'new Function(', 'eval(', 'innerHTML =', '.innerHTML=', 'setAttribute("srcdoc"', 'insertAdjacentHTML']) {
    assert.strictEqual(body.indexOf(forbidden), -1, forbidden + ' を使ってはいけない');
  }
  // script 要素の生成もしない（新タブは DOM API で組み立てる）
  assert.strictEqual(body.indexOf("createElement('script')"), -1);
  assert.strictEqual(body.indexOf('createElement("script")'), -1);
});

test('外部サーバ・外部ライブラリに依存しない', () => {
  const body = codeOnly(build.buildBody());
  for (const forbidden of ['http://', 'https://', 'fetch(', 'XMLHttpRequest', 'importScripts', 'cdn.', 'navigator.sendBeacon']) {
    assert.strictEqual(body.indexOf(forbidden), -1, forbidden + ' を含んではいけない（完全ローカル）');
  }
});

test('localStorage 等の永続化に依存していない（最初の実装はタブを閉じるまで）', () => {
  const body = codeOnly(build.buildBody());
  assert.strictEqual(body.indexOf('localStorage'), -1);
  assert.strictEqual(body.indexOf('sessionStorage'), -1);
  // ただし状態は JSON で出し入れできる形にしてある（後から保存を足せる）
  assert.ok(build.buildBody().indexOf('toJSON()') !== -1);
  assert.ok(build.buildBody().indexOf('loadJSON(') !== -1);
});

test('一時フォルダへ生成しても同じ結果になる（本物の src を汚さない）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jcgc-build-'));
  try {
    const results = build.buildAll(tmp);
    assert.strictEqual(results.length, 1);
    const generated = fs.readFileSync(path.join(tmp, build.OUT_DIR, build.OUT_NAME + '.bookmarklet.js'), 'utf8');
    assert.strictEqual(generated, readArtifact(build.OUT_NAME + '.bookmarklet.js'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
