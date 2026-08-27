'use strict';
/*
 * build-bookmarklet.js — collector.js から 1 行版ブックマークレットを生成（依存ゼロ・決定論）
 *
 * 正本は src/bookmarklet/collector.js（手編集ソース）。
 * このスクリプトは src/bookmarklet/collector.bookmarklet.js だけを生成する。
 *
 * 1 行化は「コメント除去・改行削除」ではなく最小 URL エンコードで行う:
 *   % → %25、# → %23、改行 → %0A（この順）
 * javascript: URL 中の生の # はフラグメント区切りと解釈されコードが切断されるため
 * このエンコードは必須。デコード後に改行が復活するので、ASI・行コメント・
 * 正規表現・テンプレートリテラルは壊れない。この方式のおかげで
 * collector.js と collector.bookmarklet.js のロジックは構造的にずれない。
 *
 * 仕組みは rejection_reason_bookmarklet/scripts/build-bookmarklets.js から取り込んだ。
 * ルート README「プロジェクト間の独立性」に従い参照ではなくコピーしている。
 * どちらかを直したらもう一方も直すか判断すること。
 *
 * 注意: new Function はここ（ビルド時の構文検証）だけで使う。実行時のコードは
 * 対象ページの CSP（script-src 'self'）下で動くため eval 系を一切含まない。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = 'src/bookmarklet/collector.js';
const OUTPUT = 'src/bookmarklet/collector.bookmarklet.js';

function readSource() {
  return fs.readFileSync(path.join(ROOT, SOURCE), 'utf8').replace(/\r\n?/g, '\n');
}

/* 実行形の本体（javascript: の後ろに来るコードそのもの）。
 * var module, exports; は、ページ側に偶発的な window.module があるときに
 * collector.js のテスト用エクスポート分岐へ誤って入るのを防ぐための遮断。 */
function buildBody() {
  return [
    '(function () {',
    'var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */',
    'try {',
    readSource(),
    '} catch (e) {',
    "alert('JPO Document Collector: 起動に失敗しました: ' + ((e && e.message) || e));",
    '}',
    '})();',
  ].join('\n');
}

/* 最小 URL エンコード（順序厳守: % を最初に潰す） */
function encodeBookmarklet(body) {
  return 'javascript:' + body
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\r\n|\r|\n/g, '%0A');
}

function buildArtifact() {
  const body = buildBody();
  const url = encodeBookmarklet(body);
  const payload = url.slice('javascript:'.length);

  // 書き出す前の自己検証
  if (payload.indexOf('\n') !== -1) throw new Error('1行化に失敗（改行が残存）');
  if (payload.indexOf('#') !== -1) throw new Error('生の # が残存');
  if (/%(?![0-9A-Fa-f]{2})/.test(payload)) throw new Error('不正な % エスケープ');
  if (decodeURIComponent(payload) !== body) throw new Error('エンコードのラウンドトリップ不一致');
  new Function(body); // デコード後の実行形に対する構文検証（ここでは実行しない）

  return { body, bookmarklet: url + '\n', urlBytes: Buffer.byteLength(url, 'utf8') };
}

function build() {
  const artifact = buildArtifact();
  fs.writeFileSync(path.join(ROOT, OUTPUT), artifact.bookmarklet);
  return artifact;
}

module.exports = { SOURCE, OUTPUT, readSource, buildBody, encodeBookmarklet, buildArtifact, build };

if (require.main === module) {
  const artifact = build();
  console.log(
    OUTPUT + ': ' + artifact.urlBytes + ' bytes' +
    (artifact.urlBytes > 100000 ? '（警告: 100KB 超。ブラウザによっては保存できない可能性）' : '')
  );
  console.log('完了: node --test document_downloader/tests/ で生成物の鮮度テストも実行してください。');
}
