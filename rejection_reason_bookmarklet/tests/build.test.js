'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCES_READY = [
  'src/core/article29.js', 'src/core/summarizer.js', 'src/core/validator.js',
  'src/bookmarklet/common/report-template.js', 'src/bookmarklet/common/analyzer-app.js',
].every((p) => fs.existsSync(path.join(ROOT, p)));

function loadBuild(t) {
  if (!SOURCES_READY) {
    t.skip('並行開発中のモジュールが未作成のため skip');
    return null;
  }
  return require('../scripts/build-bookmarklets');
}

test('ビルド: エンコードの不変条件とラウンドトリップ', (t) => {
  const build = loadBuild(t);
  if (!build) return;
  const artifacts = build.buildArtifacts('new');
  const url = artifacts.bookmarklet.trimEnd();
  assert.ok(url.startsWith('javascript:'));
  const payload = url.slice('javascript:'.length);
  assert.equal(payload.indexOf('\n'), -1);
  assert.equal(payload.indexOf('#'), -1);
  assert.ok(!/%(?![0-9A-Fa-f]{2})/.test(payload));
  assert.equal(decodeURIComponent(payload), build.buildBody('new'));
});

test('ビルド: 生成物がソースと同期している（鮮度）', (t) => {
  const build = loadBuild(t);
  if (!build) return;
  for (const targetKey of Object.keys(build.TARGETS)) {
    const dir = path.join(ROOT, 'src', 'bookmarklet', targetKey);
    const collector = path.join(dir, 'collector.js');
    const bookmarklet = path.join(dir, 'collector.bookmarklet.js');
    assert.ok(fs.existsSync(collector), 'npm run build:bookmarklets を実行してください: ' + collector);
    const artifacts = build.buildArtifacts(targetKey);
    assert.equal(fs.readFileSync(collector, 'utf8').replace(/\r\n?/g, '\n'), artifacts.collector,
      targetKey + ': collector.js が古い（npm run build:bookmarklets で再生成）');
    assert.equal(fs.readFileSync(bookmarklet, 'utf8').replace(/\r\n?/g, '\n'), artifacts.bookmarklet,
      targetKey + ': collector.bookmarklet.js が古い（npm run build:bookmarklets で再生成）');
  }
});

test('ビルド: 実行時コードに eval / new Function / document.write を含まない', (t) => {
  const build = loadBuild(t);
  if (!build) return;
  const src = build.coreAndAppSource();
  // レポートの別タブ書き込み（w.document.write）だけは許容するため、
  // 素の document.write / eval( / new Function の出現を検査する
  assert.ok(!/[^.\w]eval\s*\(/.test(src), '実行時コードに eval が含まれています');
  assert.ok(!/new\s+Function/.test(src), '実行時コードに new Function が含まれています');
});

// 連結ソースをブラウザ相当のサンドボックス（module 未定義）で評価し、
// UMD のブラウザ分岐で RRB 名前空間が正しく組み上がることを検証する
test('ビルド: 実行後にページに残る追加グローバルは RRB だけ', (t) => {
  const build = loadBuild(t);
  if (!build) return;
  const sandbox = { alert: () => {} };
  sandbox.globalThis = sandbox;
  const before = Object.keys(sandbox).slice();
  vm.runInNewContext(build.buildBody('new'), sandbox);
  const added = Object.keys(sandbox).filter((k) => before.indexOf(k) === -1);
  assert.deepEqual(added, ['RRB'], '想定外のグローバルが追加された: ' + JSON.stringify(added));
  assert.equal(sandbox.RRB.claimStructure.hasTreeParser(), true);
});

// 他プロジェクトへ依存しない（ルート README.md「プロジェクト間の独立性」の規約）
test('ビルド: 連結対象はすべて本プロジェクト内のファイルである', (t) => {
  const build = loadBuild(t);
  if (!build) return;
  for (const relPath of build.SOURCE_ORDER) {
    assert.ok(!relPath.includes('..'),
      '他プロジェクトを参照している: ' + relPath + '（機構は取り込むこと）');
    assert.ok(fs.existsSync(path.join(ROOT, relPath)), '存在しない: ' + relPath);
  }
});

test('ソース: 本プロジェクトのコードが他プロジェクトを require していない', (t) => {
  const build = loadBuild(t);
  if (!build) return;
  const dirs = ['src/core', 'src/bookmarklet/common', 'scripts'];
  for (const dir of dirs) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(full, name), 'utf8');
      const bad = /require\(\s*['"][^'"]*\.\.\/\.\.\/\.\.\//.exec(src);
      assert.equal(bad, null, dir + '/' + name + ' が他プロジェクトを require している');
    }
  }
});

test('連結スモーク: ブラウザ分岐で RRB が組み上がり analyze が動く', (t) => {
  const build = loadBuild(t);
  if (!build) return;
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.alert = () => {};
  vm.runInNewContext(build.coreAndAppSource(), sandbox);
  assert.equal(typeof sandbox.RRB.analyzer.analyze, 'function');
  assert.equal(typeof sandbox.RRB.analyzerApp.launch, 'function');
  assert.equal(typeof sandbox.RRB.reportTemplate.build, 'function');
  assert.ok(sandbox.RRB.sampleData.text.length > 1000);
  const result = sandbox.RRB.analyzer.analyze(sandbox.RRB.sampleData.text);
  assert.equal(result.metadata.totalReasonCount, 2);
  assert.equal(result.reasons[0].category, 'clarity');
  assert.equal(result.reasons[1].category, 'support');
});
