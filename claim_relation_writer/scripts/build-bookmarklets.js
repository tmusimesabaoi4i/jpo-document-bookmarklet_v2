'use strict';
/*
 * build-bookmarklets.js — ブックマークレット生成（依存ゼロ・決定論）
 *
 * コア5モジュール + collector-app.js を外殻IIFEで連結し、ターゲットごとに
 *   collector.js             … 改行・コメントそのままの読みやすい版
 *   collector.bookmarklet.js … javascript: プレフィックス付き1行版
 * を生成する。
 *
 * 1行化は「コメント除去・改行削除」ではなく最小URLエンコードで行う:
 *   % → %25、# → %23、改行 → %0A（この順）
 * javascript: URL 中の生の # はフラグメント区切りと解釈されコードが切断されるため
 * （#claim_tree 等のセレクタで必ず出現する）、このエンコードは必須。デコード後に
 * 改行が復活するので、ASI・行コメント・正規表現・テンプレートリテラルは壊れない。
 *
 * 決定論のため、バナーに日付・バージョン等の可変要素を入れないこと。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 連結順はここで一元管理（cite は parser に、structure は parser/cite に、generator は
// formatter に、session は parser/resolver/generator/structure に、collector-app は
// formatter/session/structure に依存する）
const SOURCE_ORDER = [
  'src/core/parser.js',
  'src/core/cite.js',
  'src/core/structure.js',
  'src/core/formatter.js',
  'src/core/resolver.js',
  'src/core/generator.js',
  'src/core/session.js',
  'src/bookmarklet/common/collector-app.js',
];

const TARGETS = {
  new: { label: '書類比較・クレームチェッカー（新版）' },
  legacy: { label: '書類比較・クレームチェッカー（旧版）' },
};

const BANNER = [
  '/*',
  ' * このファイルは自動生成です — 直接編集しないでください (DO NOT EDIT)。',
  ' * 生成元: src/core/*.js + src/bookmarklet/common/collector-app.js',
  ' * 再生成: npm run build:bookmarklets',
  ' */',
].join('\n');

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n?/g, '\n');
}

// コア + collector-app の連結部（外殻なし）。連結スモークテストからも使う
function coreAndAppSource() {
  return SOURCE_ORDER.map(readSource).join('\n');
}

// 実行形の本体（javascript: の後ろに来るコードそのもの）
function buildBody(targetKey) {
  const target = TARGETS[targetKey];
  if (!target) throw new Error('不明なターゲット: ' + targetKey);
  const launchCall = 'globalThis.CRW.collectorApp.launch(' +
    JSON.stringify({ target: targetKey, label: target.label }) + ');';
  return [
    '(function () {',
    "var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */",
    'try {',
    coreAndAppSource(),
    launchCall,
    '} catch (e) {',
    "alert('Claim Relation Writer: 起動に失敗しました: ' + ((e && e.message) || e));",
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
