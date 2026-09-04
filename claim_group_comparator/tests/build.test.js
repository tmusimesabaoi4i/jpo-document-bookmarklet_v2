'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const build = require('../scripts/build-bookmarklets');

const ROOT = path.join(__dirname, '..');
const TARGETS = Object.keys(build.TARGETS);

function readArtifact(name) {
  return fs.readFileSync(path.join(ROOT, build.OUT_DIR, name), 'utf8');
}

// コメントを落としたコード部分だけを見る（禁止語は設計メモの中には出てくるため）
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[\s;{}(),])\/\/.*$/, '$1'))
    .join('\n');
}

test('2つの版（自動関連付け・手動関連付け）を別々の生成物として作る', () => {
  assert.deepStrictEqual(TARGETS.sort(), ['comparator', 'relations']);
  for (const target of TARGETS) {
    assert.ok(fs.existsSync(path.join(ROOT, build.OUT_DIR, target + '.js')));
    assert.ok(fs.existsSync(path.join(ROOT, build.OUT_DIR, target + '.bookmarklet.js')));
  }
});

for (const target of TARGETS) {
  test(`${target}: 生成物が最新のソースと同期している（要 npm run build:bookmarklets）`, () => {
    const artifacts = build.buildArtifacts(target);
    assert.strictEqual(readArtifact(target + '.js'), artifacts.collector,
      target + '.js が古い。npm run build:bookmarklets を実行すること');
    assert.strictEqual(readArtifact(target + '.bookmarklet.js'), artifacts.bookmarklet,
      target + '.bookmarklet.js が古い。npm run build:bookmarklets を実行すること');
  });

  test(`${target}: 1行版は javascript: で始まり、改行と生の # を含まない`, () => {
    const url = readArtifact(target + '.bookmarklet.js').replace(/\n$/, '');
    assert.ok(url.startsWith('javascript:'));
    const payload = url.slice('javascript:'.length);
    assert.strictEqual(payload.indexOf('\n'), -1);
    assert.strictEqual(payload.indexOf('#'), -1);
    assert.ok(!/%(?![0-9A-Fa-f]{2})/.test(payload), '不正な % エスケープ');
  });

  test(`${target}: 1行版をデコードすると読みやすい版の本体に戻る`, () => {
    const url = readArtifact(target + '.bookmarklet.js').replace(/\n$/, '');
    const decoded = decodeURIComponent(url.slice('javascript:'.length));
    assert.strictEqual(decoded, build.buildBody(target));
    assert.doesNotThrow(() => new Function(decoded));
  });

  test(`${target}: 読みやすい版には DO NOT EDIT バナーが付く`, () => {
    const source = readArtifact(target + '.js');
    assert.ok(source.startsWith('/*\n * このファイルは自動生成です'));
    assert.ok(source.indexOf('npm run build:bookmarklets') !== -1);
  });

  test(`${target}: 禁止している実行経路（eval・document.write・script 注入）を含まない`, () => {
    const body = codeOnly(build.buildBody(target));
    for (const forbidden of ['document.write', 'new Function(', 'eval(', 'innerHTML =', '.innerHTML=', 'insertAdjacentHTML']) {
      assert.strictEqual(body.indexOf(forbidden), -1, forbidden + ' を使ってはいけない');
    }
    assert.strictEqual(body.indexOf("createElement('script')"), -1);
    assert.strictEqual(body.indexOf('createElement("script")'), -1);
  });

  test(`${target}: 外部サーバ・外部ライブラリに依存しない`, () => {
    const body = codeOnly(build.buildBody(target));
    for (const forbidden of ['http://', 'https://', 'fetch(', 'XMLHttpRequest', 'importScripts', 'cdn.', 'navigator.sendBeacon']) {
      assert.strictEqual(body.indexOf(forbidden), -1, forbidden + ' を含んではいけない（完全ローカル）');
    }
  });

  test(`${target}: localStorage 等の永続化に依存していない（保持はタブを閉じるまで）`, () => {
    const body = codeOnly(build.buildBody(target));
    assert.strictEqual(body.indexOf('localStorage'), -1);
    assert.strictEqual(body.indexOf('sessionStorage'), -1);
  });
}

test('自動関連付け版だけが段落の類似度計算（segmatch）を含む', () => {
  const auto = codeOnly(build.buildBody('comparator'));
  const manual = codeOnly(build.buildBody('relations'));
  assert.ok(auto.indexOf('root.JCGC.segmatch = factory') !== -1, '自動版に segmatch が入っていない');
  assert.strictEqual(manual.indexOf('root.JCGC.segmatch = factory'), -1,
    '手動版に segmatch が混ざっている（内部で類似段落計算が走ってしまう）');
  assert.strictEqual(manual.indexOf('segmatch.createMatcher'), -1,
    '手動版が段落の類似度計算を呼んでいる');
  // 手動版は関連の管理を持つ
  assert.ok(manual.indexOf('root.JCGC.relations = factory') !== -1);
  assert.strictEqual(auto.indexOf('root.JCGC.relations = factory'), -1,
    '自動版に手動版の関連管理が混ざっている');
});

test('両版が共有するのはコアと画面の基本部品だけ', () => {
  const shared = build.SHARED_HEAD.concat(build.SHARED_TAIL);
  for (const target of TARGETS) {
    const order = build.sourceOrder(target);
    for (const file of shared) assert.ok(order.indexOf(file) !== -1, target + ' に ' + file + ' が無い');
  }
  // 版ごとに違うのは、段落の対応付けまわりと画面・起動口だけ
  const auto = build.sourceOrder('comparator');
  const manual = build.sourceOrder('relations');
  assert.deepStrictEqual(auto.filter((f) => manual.indexOf(f) === -1), [
    'src/core/segmatch.js', 'src/view/workspace.js', 'src/bookmarklet/common/launcher-app.js',
  ]);
  assert.deepStrictEqual(manual.filter((f) => auto.indexOf(f) === -1), [
    'src/core/relations.js', 'src/view/relation-styles.js', 'src/view/relation-workspace.js',
    'src/bookmarklet/common/relation-launcher-app.js',
  ]);
});

test('起動口とボタン文言が版ごとに分かれている', () => {
  assert.ok(build.buildBody('comparator').indexOf('globalThis.JCGC.launcherApp.launch({});') !== -1);
  assert.ok(build.buildBody('relations').indexOf('globalThis.JCGC.relationLauncherApp.launch({});') !== -1);

  const autoLauncher = require('../src/bookmarklet/common/launcher-app');
  const manualLauncher = require('../src/bookmarklet/common/relation-launcher-app');
  assert.notStrictEqual(autoLauncher.BUTTON_LABEL, manualLauncher.BUTTON_LABEL);
  assert.notStrictEqual(autoLauncher.LAUNCHER_ID, manualLauncher.LAUNCHER_ID);
  assert.notStrictEqual(autoLauncher.STYLE_ID, manualLauncher.STYLE_ID);
});

test('生成は決定論（同じソースから同じ出力）', () => {
  for (const target of TARGETS) {
    assert.strictEqual(build.buildArtifacts(target).bookmarklet, build.buildArtifacts(target).bookmarklet);
  }
});

test('連結順にすべてのソースが含まれる', () => {
  for (const target of TARGETS) {
    const body = build.buildBody(target);
    for (const relPath of build.sourceOrder(target)) {
      const marker = path.basename(relPath).replace('.js', '.js —');
      assert.ok(body.indexOf(marker) !== -1, target + ': ' + relPath + ' が連結されていない');
    }
    assert.ok(body.indexOf('var module, exports;') !== -1);
  }
});

test('一時フォルダへ生成しても同じ結果になる（本物の src を汚さない）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jcgc-build-'));
  try {
    const results = build.buildAll(tmp);
    assert.strictEqual(results.length, TARGETS.length);
    for (const target of TARGETS) {
      const generated = fs.readFileSync(path.join(tmp, build.OUT_DIR, target + '.bookmarklet.js'), 'utf8');
      assert.strictEqual(generated, readArtifact(target + '.bookmarklet.js'));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
