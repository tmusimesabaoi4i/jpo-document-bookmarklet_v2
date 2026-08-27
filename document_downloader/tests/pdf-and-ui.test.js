'use strict';
/*
 * pdf-and-ui.test.js
 *  - 自前 PDF ライタ（外部ライブラリなし）の構造検証
 *  - モーダルの DOM 配線（id の定義漏れ / 参照漏れ）の静的検証
 * 実行: node --test document_downloader/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CORE = require('../src/bookmarklet/collector');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'bookmarklet', 'collector.js'), 'utf8');

/* ============================================================
 * PDF ライタ
 * ============================================================ */
function fakePage(w, h, n) {
  return { bytes: new Uint8Array(n).fill(0x41), filter: '/DCTDecode', width: w, height: h, lossless: false };
}

async function pdfText(blob) {
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}

test('PDF: 1 ページの構造（ヘッダ / xref / trailer / EOF）が正しい', async () => {
  const blob = CORE.buildImagePdf([fakePage(1000, 1400, 128)]);
  assert.equal(blob.type, 'application/pdf');
  const text = await pdfText(blob);
  assert.ok(text.startsWith('%PDF-1.4\n'), 'PDF ヘッダがない');
  assert.ok(text.endsWith('%%EOF\n'), 'EOF がない');
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/Type \/Pages \/Kids \[3 0 R\] \/Count 1/);
  assert.match(text, /\/Type \/Page /);
  assert.match(text, /\/Subtype \/Image \/Width 1000 \/Height 1400/);
  assert.match(text, /\/Filter \/DCTDecode \/Length 128/);
  assert.match(text, /trailer\n<< \/Size 6 \/Root 1 0 R >>/);
});

test('PDF: xref のオフセットが実際のオブジェクト位置を指している', async () => {
  const blob = CORE.buildImagePdf([fakePage(800, 600, 64), fakePage(600, 800, 32)]);
  const text = await pdfText(blob);

  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.ok(text.startsWith('xref\n', startxref), 'startxref が xref を指していない');

  const table = text.slice(startxref);
  const head = /^xref\n0 (\d+)\n/.exec(table);
  const size = Number(head[1]);
  assert.equal(size, 9, '2 ページ = 空きエントリ 1 + オブジェクト (2 + 3*2)');

  const entries = table.slice(head[0].length).split('\n').slice(0, size);
  assert.equal(entries[0], '0000000000 65535 f ');
  for (let id = 1; id < size; id++) {
    const entry = entries[id];
    assert.equal(entry.length, 19, 'xref エントリは 20 バイト固定（改行込み）');
    const offset = Number(entry.slice(0, 10));
    assert.ok(text.startsWith(id + ' 0 obj\n', offset), 'オブジェクト ' + id + ' のオフセットがずれている');
  }
});

test('PDF: 画像はアスペクト比を保って A4 内に収まる', async () => {
  const text = await pdfText(CORE.buildImagePdf([fakePage(2000, 1000, 16)]));
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const cm = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im0 Do Q/.exec(text);
  assert.ok(cm, '描画コマンドがない');
  const [w, h, x, y] = cm.slice(1).map(Number);
  assert.ok(w <= 595.28 + 0.01 && h <= 841.89 + 0.01, 'A4 をはみ出している');
  assert.ok(Math.abs(w / h - 2000 / 1000) < 0.01, 'アスペクト比が崩れている');
  assert.ok(x >= 0 && y >= 0, '配置が負の座標になっている');
});

/* ============================================================
 * モーダルの DOM 配線
 * ============================================================ */
test('UI: qs("#__…") で参照する id がすべてテンプレートに存在する', () => {
  const defined = new Set();
  for (const m of SRC.matchAll(/\bid="(__[A-Za-z0-9_]+)"/g)) defined.add(m[1]);
  const referenced = new Set();
  for (const m of SRC.matchAll(/\bqs\('#(__[A-Za-z0-9_]+)'/g)) referenced.add(m[1]);

  assert.ok(referenced.size > 15, '参照の抽出に失敗している（正規表現を見直すこと）');
  const missing = [...referenced].filter((id) => !defined.has(id));
  assert.deepEqual(missing, [], 'テンプレートに存在しない id を参照している: ' + missing.join(', '));
});

test('UI: 国内書類と OPD の一覧・全選択ボタンが分離されている', () => {
  for (const id of ['__domlist', '__opdlist', '__selall', '__clear', '__opdall', '__opdnone']) {
    assert.ok(SRC.includes('id="' + id + '"'), id + ' がテンプレートにない');
  }
  // OPD の状態表示は aria-live で読み上げられる
  assert.match(SRC, /id="__opdlist" aria-live="polite"/);
  // OPD 形式はラジオ（排他）で、送信値は individual / consolidated ちょうど
  assert.match(SRC, /type="radio" name="__opdmode" value="individual" checked/);
  assert.match(SRC, /type="radio" name="__opdmode" value="consolidated"/);
  // OPD ダウンロードは既定で有効
  assert.match(SRC, /id="__opdon" checked/);
});

test('UI: 国内書類の出力形式に PDF と印刷が両方ある（印刷の名前だけ変えていない）', () => {
  assert.match(SRC, /name="__mode" value="pdf"/);
  assert.match(SRC, /name="__mode" value="print">印刷画面を開く/);
  // PDF は実装を伴う（画像ページを結合する）
  assert.equal(typeof CORE.buildImagePdf, 'function');
});

test('UI: 状態バッジの CSS クラスが状態モデルと 1 対 1 で存在する', () => {
  for (const key of Object.keys(CORE.OPD_STATE)) {
    const cls = CORE.OPD_STATE_META[key].cls;
    assert.ok(SRC.includes('.' + cls + '{'), cls + ' の色定義が CSS にない');
  }
});
