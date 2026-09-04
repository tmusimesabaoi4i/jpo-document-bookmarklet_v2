'use strict';
/*
 * build-bookmarklets.js — ブックマークレット生成（依存ゼロ・決定論）
 *
 * templates/full の雛形（= claim_relation_writer の実績あるスクリプト）と同じ仕組み。
 * **2 つのバージョン**を別々の生成物として作る。
 *
 *   comparator … 段落の関連付けを **自動推定** する版（段落の類似度計算 segmatch.js を含む）
 *   relations  … 段落の関連付けを **利用者が手動で設定** する版（segmatch.js を含めない）
 *
 * どちらも
 *   src/bookmarklet/<名前>.js             … 改行・コメントそのままの読みやすい版
 *   src/bookmarklet/<名前>.bookmarklet.js … javascript: プレフィックス付き 1 行版
 * を生成する。共有するのはコア（抽出・段落分割・請求項グルーピング・状態・レイアウト）と
 * 画面の基本部品で、段落の対応付けに関わる部分だけが分かれている。
 *
 * 1 行化は「コメント除去・改行削除」ではなく最小 URL エンコードで行う:
 *   % → %25、# → %23、改行 → %0A（この順）
 * javascript: URL 中の生の # はフラグメント区切りと解釈されコードが切断されるため必須。
 * デコード後に改行が復活するので、ASI・行コメント・正規表現は壊れない。
 *
 * 決定論のため、バナーに日付・バージョン等の可変要素を入れないこと。
 *
 * 対象ページは 1 種類（書類比較・クレームチェッカー）。新版・旧版で DOM 構造が同じ
 * （fixtures/README.md の機械比較結果）なので、対象ページごとのターゲット分けはしない。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 両方の版が共有する部分（依存されるモジュールが前）。UMD の分岐でグローバル JCGC に載る
const SHARED_HEAD = [
  'src/core/settings.js',
  'src/core/citation.js',
  'src/core/normalize.js',
  'src/core/segment.js',
  'src/core/tree.js',
  'src/core/similarity.js',
  'src/core/grouping.js',
];

const SHARED_TAIL = [
  'src/core/groupstate.js',
  'src/core/layout.js',
  'src/extract/extractor.js',
  'src/view/dom.js',
  'src/view/styles.js',
  'src/view/editor.js',
];

/*
 * 版ごとの定義。連結順は SHARED_HEAD → extra → SHARED_TAIL → tail。
 */
const TARGETS = {
  comparator: {
    label: '請求項グループ比較（段落関連 自動）',
    // 段落の類似度計算はこの版だけ
    extra: ['src/core/segmatch.js'],
    tail: ['src/view/workspace.js', 'src/bookmarklet/common/launcher-app.js'],
    launch: 'globalThis.JCGC.launcherApp.launch({});',
    errorLabel: '請求項グループ比較',
  },
  relations: {
    label: '請求項グループ比較（段落関連 手動設定）',
    // segmatch.js を **含めない**（手動版が類似段落計算を内部で実行しないことの保証）
    extra: ['src/core/relations.js'],
    tail: [
      'src/view/relation-styles.js',
      'src/view/relation-workspace.js',
      'src/bookmarklet/common/relation-launcher-app.js',
    ],
    launch: 'globalThis.JCGC.relationLauncherApp.launch({});',
    errorLabel: '請求項グループ比較（段落関連 手動設定）',
  },
};

const OUT_DIR = 'src/bookmarklet';

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

function sourceOrder(targetKey) {
  const target = TARGETS[targetKey];
  if (!target) throw new Error('不明なターゲット: ' + targetKey);
  return SHARED_HEAD.concat(target.extra, SHARED_TAIL, target.tail);
}

// コア + ビュー + 起動口の連結部（外殻なし）。連結スモークテストからも使う
function coreAndAppSource(targetKey) {
  return sourceOrder(targetKey || 'comparator').map(readSource).join('\n');
}

// 実行形の本体（javascript: の後ろに来るコードそのもの）
function buildBody(targetKey) {
  const key = targetKey || 'comparator';
  const target = TARGETS[key];
  if (!target) throw new Error('不明なターゲット: ' + key);
  return [
    '(function () {',
    'var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */',
    'try {',
    coreAndAppSource(key),
    target.launch,
    '} catch (e) {',
    "alert('" + target.errorLabel + ": 起動に失敗しました: ' + ((e && e.message) || e));",
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

function buildArtifacts(targetKey) {
  const key = targetKey || 'comparator';
  const body = buildBody(key);
  const url = encodeBookmarklet(body);
  const payload = url.slice('javascript:'.length);

  // 書き出す前の自己検証
  if (payload.indexOf('\n') !== -1) throw new Error(key + ': 1行化に失敗（改行が残存）');
  if (payload.indexOf('#') !== -1) throw new Error(key + ': 生の # が残存');
  if (/%(?![0-9A-Fa-f]{2})/.test(payload)) throw new Error(key + ': 不正な % エスケープ');
  if (decodeURIComponent(payload) !== body) throw new Error(key + ': エンコードのラウンドトリップ不一致');
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
  const results = [];
  for (const targetKey of Object.keys(TARGETS)) {
    const artifacts = buildArtifacts(targetKey);
    fs.writeFileSync(path.join(dir, targetKey + '.js'), artifacts.collector);
    fs.writeFileSync(path.join(dir, targetKey + '.bookmarklet.js'), artifacts.bookmarklet);
    results.push({ target: targetKey, urlBytes: artifacts.urlBytes });
  }
  return results;
}

module.exports = {
  TARGETS, SHARED_HEAD, SHARED_TAIL, OUT_DIR, BANNER,
  sourceOrder, coreAndAppSource, buildBody, encodeBookmarklet, buildArtifacts, buildAll,
};

if (require.main === module) {
  const results = buildAll();
  for (const r of results) {
    process.stdout.write(`${OUT_DIR}/${r.target}.bookmarklet.js を生成しました (${r.urlBytes} バイト)\n`);
  }
}
