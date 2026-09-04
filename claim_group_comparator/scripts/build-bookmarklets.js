'use strict';
/*
 * build-bookmarklets.js — ブックマークレット生成（依存ゼロ・決定論）
 *
 * templates/full の雛形（= claim_relation_writer の実績あるスクリプト）と同じ仕組み。
 * コアモジュール + ビュー + 起動口を外殻 IIFE で連結し、
 *   src/bookmarklet/comparator.js             … 改行・コメントそのままの読みやすい版
 *   src/bookmarklet/comparator.bookmarklet.js … javascript: プレフィックス付き 1 行版
 * を生成する。
 *
 * 1 行化は「コメント除去・改行削除」ではなく最小 URL エンコードで行う:
 *   % → %25、# → %23、改行 → %0A（この順）
 * javascript: URL 中の生の # はフラグメント区切りと解釈されコードが切断されるため必須。
 * デコード後に改行が復活するので、ASI・行コメント・正規表現は壊れない。
 *
 * 決定論のため、バナーに日付・バージョン等の可変要素を入れないこと。
 *
 * 対象ページは 1 種類（書類比較・クレームチェッカー）。新版・旧版で DOM 構造が同じ
 * （fixtures/README.md の機械比較結果）なので、ターゲット分けはしない。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 連結順（依存されるモジュールが前）。UMD の分岐でグローバル JCGC に載る
const SOURCE_ORDER = [
  'src/core/settings.js',
  'src/core/citation.js',
  'src/core/normalize.js',
  'src/core/segment.js',
  'src/core/tree.js',
  'src/core/similarity.js',
  'src/core/grouping.js',
  'src/core/segmatch.js',
  'src/core/groupstate.js',
  'src/core/layout.js',
  'src/extract/extractor.js',
  'src/view/dom.js',
  'src/view/styles.js',
  'src/view/editor.js',
  'src/view/workspace.js',
  'src/bookmarklet/common/launcher-app.js',
];

const OUT_DIR = 'src/bookmarklet';
const OUT_NAME = 'comparator';

const BANNER = [
  '/*',
  ' * このファイルは自動生成です — 直接編集しないでください (DO NOT EDIT)。',
  ' * 生成元: src/core/*.js + src/extract/*.js + src/view/*.js + src/bookmarklet/common/launcher-app.js',
  ' * 再生成: npm run build:bookmarklets',
  ' */',
].join('\n');

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n?/g, '\n');
}

// コア + ビュー + 起動口の連結部（外殻なし）。連結スモークテストからも使う
function coreAndAppSource() {
  return SOURCE_ORDER.map(readSource).join('\n');
}

// 実行形の本体（javascript: の後ろに来るコードそのもの）
function buildBody() {
  return [
    '(function () {',
    'var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */',
    'try {',
    coreAndAppSource(),
    'globalThis.JCGC.launcherApp.launch({});',
    '} catch (e) {',
    "alert('請求項グループ比較: 起動に失敗しました: ' + ((e && e.message) || e));",
    '}',
    '})();',
  ].join('\n');
}

// 最小 URL エンコード（順序厳守: % を最初に潰す）
function encodeBookmarklet(body) {
  return 'javascript:' + body
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\r\n|\r|\n/g, '%0A');
}

function buildArtifacts() {
  const body = buildBody();
  const url = encodeBookmarklet(body);
  const payload = url.slice('javascript:'.length);

  // 書き出す前の自己検証
  if (payload.indexOf('\n') !== -1) throw new Error('1行化に失敗（改行が残存）');
  if (payload.indexOf('#') !== -1) throw new Error('生の # が残存');
  if (/%(?![0-9A-Fa-f]{2})/.test(payload)) throw new Error('不正な % エスケープ');
  if (decodeURIComponent(payload) !== body) throw new Error('エンコードのラウンドトリップ不一致');
  new Function(body); // デコード後の実行形に対する構文検証（ここでは実行しない）

  return {
    collector: BANNER + '\n' + body + '\n',
    bookmarklet: url + '\n',
    urlBytes: Buffer.byteLength(url, 'utf8'),
  };
}

function buildAll(outRoot) {
  const base = outRoot || ROOT;
  const dir = path.join(base, OUT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const artifacts = buildArtifacts();
  fs.writeFileSync(path.join(dir, OUT_NAME + '.js'), artifacts.collector);
  fs.writeFileSync(path.join(dir, OUT_NAME + '.bookmarklet.js'), artifacts.bookmarklet);
  return [{ target: OUT_NAME, urlBytes: artifacts.urlBytes }];
}

module.exports = {
  SOURCE_ORDER, OUT_DIR, OUT_NAME, BANNER,
  coreAndAppSource, buildBody, encodeBookmarklet, buildArtifacts, buildAll,
};

if (require.main === module) {
  const results = buildAll();
  for (const r of results) {
    process.stdout.write(`${OUT_DIR}/${r.target}.bookmarklet.js を生成しました (${r.urlBytes} バイト)\n`);
  }
}
