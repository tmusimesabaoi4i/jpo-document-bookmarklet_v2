'use strict';
/*
 * build-bookmarklets.js — ブックマークレット生成（依存ゼロ・決定論）
 *
 * コアモジュール + sample-data + report-template + analyzer-app を外殻IIFEで連結し、
 *   collector.js             … 改行・コメントそのままの読みやすい版
 *   collector.bookmarklet.js … javascript: プレフィックス付き1行版
 * を生成する。
 *
 * 1行化は「コメント除去・改行削除」ではなく最小URLエンコードで行う:
 *   % → %25、# → %23、改行 → %0A（この順）
 * javascript: URL 中の生の # はフラグメント区切りと解釈されコードが切断されるため
 * このエンコードは必須。デコード後に改行が復活するので、ASI・行コメント・
 * 正規表現・テンプレートリテラルは壊れない。
 *
 * 決定論のため、バナーに日付・バージョン等の可変要素を入れないこと。
 * 注意: new Function はここ（ビルド時の構文検証）だけで使う。実行時のコードは
 * 対象ページの CSP（script-src 'self'）下で動くため eval 系を一切含まない。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 連結順はここで一元管理（依存されるモジュールが前）。
// 他プロジェクトのファイルは参照しない（ルート README.md「プロジェクト間の独立性」の規約）。
const SOURCE_ORDER = [
  'src/core/normalizer.js',
  'src/core/claims.js',
  'src/core/splitter.js',
  'src/core/clarity-support.js',
  'src/core/article29.js',
  'src/core/summarizer.js',
  'src/core/validator.js',
  'src/core/claim-tree.js',
  'src/core/claim-structure.js',
  'src/core/consistency.js',
  'src/core/analyzer.js',
  'src/bookmarklet/common/page-claims.js',
  'src/bookmarklet/common/sample-data.js',
  'src/bookmarklet/common/report-template.js',
  'src/bookmarklet/common/analyzer-app.js',
];

// 解析はページ DOM に依存しない（入力はモーダルへの貼り付け／TXT 読み込み）ため
// ターゲットは 1 つ。新旧どちらの「書類比較・クレームチェッカー」上でも動作する。
const TARGETS = {
  new: { label: '拒絶理由分析' },
};

const BANNER = [
  '/*',
  ' * このファイルは自動生成です — 直接編集しないでください (DO NOT EDIT)。',
  ' * 生成元: src/core/*.js + src/bookmarklet/common/*.js',
  ' * 再生成: npm run build:bookmarklets',
  ' */',
].join('\n');

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n?/g, '\n');
}

// コア + アプリの連結部（外殻なし）。連結スモークテストからも使う
function coreAndAppSource() {
  return SOURCE_ORDER.map(readSource).join('\n');
}

// 実行形の本体（javascript: の後ろに来るコードそのもの）
function buildBody(targetKey) {
  const target = TARGETS[targetKey];
  if (!target) throw new Error('不明なターゲット: ' + targetKey);
  const launchCall = 'globalThis.RRB.analyzerApp.launch(' +
    JSON.stringify({ target: targetKey, label: target.label }) + ');';
  return [
    '(function () {',
    "var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */",
    'try {',
    coreAndAppSource(),
    launchCall,
    '} catch (e) {',
    "alert('拒絶理由分析: 起動に失敗しました: ' + ((e && e.message) || e));",
    '}',
    '})();',
  ].join('\n');
}

// 最小URLエンコード（順序厳守: % を最初に潰す）
function encodeBookmarklet(body) {
  return 'javascript:' + body
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\r\n|\r|\n/g, '%0A');
}

// ターゲット1つ分の成果物（ファイル末尾は改行1つ）
function buildArtifacts(targetKey) {
  const body = buildBody(targetKey);
  const url = encodeBookmarklet(body);
  const payload = url.slice('javascript:'.length);

  // 書き出す前の自己検証
  if (payload.indexOf('\n') !== -1) throw new Error(targetKey + ': 1行化に失敗（改行が残存）');
  if (payload.indexOf('#') !== -1) throw new Error(targetKey + ': 生の # が残存');
  if (/%(?![0-9A-Fa-f]{2})/.test(payload)) throw new Error(targetKey + ': 不正な % エスケープ');
  if (decodeURIComponent(payload) !== body) throw new Error(targetKey + ': エンコードのラウンドトリップ不一致');
  new Function(body); // デコード後の実行形に対する構文検証（ここでは実行しない）

  return {
    collector: BANNER + '\n' + body + '\n',
    bookmarklet: url + '\n',
    urlBytes: Buffer.byteLength(url, 'utf8'),
  };
}

function buildAll(outRoot) {
  const base = outRoot || ROOT;
  const results = [];
  for (const targetKey of Object.keys(TARGETS)) {
    const dir = path.join(base, 'src', 'bookmarklet', targetKey);
    fs.mkdirSync(dir, { recursive: true });
    const artifacts = buildArtifacts(targetKey);
    fs.writeFileSync(path.join(dir, 'collector.js'), artifacts.collector);
    fs.writeFileSync(path.join(dir, 'collector.bookmarklet.js'), artifacts.bookmarklet);
    results.push({ targetKey, urlBytes: artifacts.urlBytes });
  }
  return results;
}

module.exports = { SOURCE_ORDER, TARGETS, coreAndAppSource, buildBody, encodeBookmarklet, buildArtifacts, buildAll };

if (require.main === module) {
  const results = buildAll();
  for (const r of results) {
    console.log(
      'src/bookmarklet/' + r.targetKey + '/collector.bookmarklet.js: ' +
      r.urlBytes + ' bytes' +
      (r.urlBytes > 100000 ? '（警告: 100KB 超。ブラウザによっては保存できない可能性）' : '')
    );
  }
  console.log('完了: npm test で生成物の鮮度テストも実行してください。');
}
