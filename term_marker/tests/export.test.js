'use strict';
/*
 * export.test.js — 出力 HTML（対応表・状態 JSON・元本文の保持）とファイル名の検証
 * 実行: node --test term_marker/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('./minidom');
const CORE = require('../src/bookmarklet/marker');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'document-html', 'new',
  '特願2022-164196_20260520_手続補正書（自発・内容）_html.html');
const hasFixture = fs.existsSync(FIXTURE);
const skip = !hasFixture && 'fixture がありません';
const loadDoc = () => parseHTML(fs.readFileSync(FIXTURE, 'utf8'));

function markedDoc() {
  const doc = loadDoc();
  CORE.ensurePageStyle(doc);
  const map = CORE.buildTextMap(doc.body);
  const made = CORE.createRows(CORE.extractTerms(map.text), 1);
  const res = CORE.computeRanges(map.text, made.rows, { mode: 'all' });
  CORE.applyMarks(doc, map, res.ranges, made.rows, { underline: true });
  const state = { mode: 'all', underline: true, rows: made.rows, nextId: made.nextId };
  // パネル相当のホスト要素も置いておき、出力から除かれることを確かめる
  const host = doc.createElement('div');
  host.setAttribute(CORE.ATTR_UI, 'panel');
  host.appendChild(doc.createTextNode('前記パネル'));
  doc.body.appendChild(host);
  return { doc, state, stats: res.stats, ranges: res.ranges };
}

test('出力 HTML: charset・スタイル・対応表・状態 JSON を含み、UI は含まない', { skip }, () => {
  const { doc, state, stats } = markedDoc();
  const html = CORE.buildExportHtml(doc, state, stats, { now: new Date(2026, 7, 31, 20, 40, 0) });
  assert.ok(html.startsWith('<html>'), 'doctype の無い元文書には doctype を足さない（表示モードを変えない）');
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<style data-jpo-marker-style="1">'));
  assert.ok(html.includes('print-color-adjust:exact'));
  assert.ok(html.includes('<div data-jpo-marker-legend="1"'));
  assert.ok(html.includes('生成: 2026-08-31 20:40'));
  assert.ok(html.includes('<script type="application/json" data-jpo-marker-state="1">'));
  assert.ok(!html.includes('data-jpo-marker-ui="'), 'パネルのホスト要素が出力に残っている');
  assert.ok(html.includes('[data-jpo-marker-ui]{display:none !important;}'), '印刷時に UI を隠す規則（属性名は CSS としてのみ現れる）');
  assert.ok(!html.includes('前記パネル'));
  // 対応表には有効な全語句が自身の色で載る
  for (const r of state.rows) {
    assert.ok(html.includes('background-color:' + r.color + ';color:#000;border-bottom:2px solid ' + CORE.accentColor(r.color) + ';padding:0 4px;">' + r.term + '</span>'), r.term + ' が対応表にない');
    assert.ok(html.includes(stats[r.id].applied + '件'));
  }
  // 元文書の DOM は変更されていない（複製にだけ手を入れる）
  assert.equal(doc.body.querySelectorAll('[' + CORE.ATTR_LEGEND + ']').length, 0);
  assert.equal(doc.body.querySelectorAll('script').length, 0);
  assert.equal(doc.body.querySelectorAll('[' + CORE.ATTR_UI + ']').length, 1);
});

test('出力 HTML: 元本文・<u>・マーキングがそのまま保持され、単独で開いても状態を復元できる', { skip }, () => {
  const { doc, state, stats, ranges } = markedDoc();
  const html = CORE.buildExportHtml(doc, state, stats, {});
  const out = parseHTML(html);
  // 本文（<pre>）のテキストは元と完全一致
  assert.equal(out.body.querySelector('pre').textContent, loadDoc().body.querySelector('pre').textContent);
  assert.equal(out.body.querySelectorAll('u').length, 7);
  assert.equal(out.body.querySelectorAll('[' + CORE.ATTR_MARK + ']').length, doc.body.querySelectorAll('[' + CORE.ATTR_MARK + ']').length);
  assert.ok(ranges.length > 0);
  // 状態 JSON が復元でき、行が一致する
  const restored = CORE.readEmbeddedState(out);
  assert.ok(restored);
  assert.equal(restored.mode, 'all');
  assert.equal(restored.underline, true);
  assert.deepEqual(restored.rows.map((r) => [r.id, r.term, r.color, r.enabled]), state.rows.map((r) => [r.id, r.term, r.color, true]));
  assert.equal(restored.nextId, state.nextId);
  // 出力 HTML 上で再実行しても（対応表・JSON は対象外なので）論理テキストは元と同じ
  CORE.unmarkAll(out.body);
  assert.equal(CORE.buildTextMap(out.body).text, CORE.buildTextMap(loadDoc().body).text);
  // 再出力しても対応表・JSON が二重にならない
  const again = parseHTML(CORE.buildExportHtml(out, restored, stats, {}));
  assert.equal(again.querySelectorAll('[' + CORE.ATTR_LEGEND + ']').length, 1);
  assert.equal(again.querySelectorAll('script[' + CORE.ATTR_STATE + ']').length, 1);
  assert.equal(again.querySelectorAll('meta[charset]').length, 1);
});

test('状態 JSON: </script> を含む語句でも script が閉じない・不正な入力は捨てる', () => {
  const s = CORE.serializeState({ mode: 'prefixed', underline: false, rows: [{ id: 1, term: 'a</script><b>', color: '#FFF176', enabled: false }] });
  assert.ok(!s.includes('</script'));
  const parsed = JSON.parse(s);
  assert.equal(parsed.rows[0].term, 'a</script><b>');
  assert.equal(parsed.version, CORE.VERSION);
  const st = CORE.sanitizeState({ mode: 'weird', rows: [{ id: 'x', term: ' 通信装置\n', color: 'red' }, { id: 7, term: 'b', color: '#abcdef', enabled: false }] });
  assert.equal(st.mode, 'all');
  assert.equal(st.underline, true);
  assert.deepEqual(st.rows[0], { id: 1, term: '通信装置', color: CORE.PALETTE[0], enabled: true });
  assert.deepEqual(st.rows[1], { id: 7, term: 'b', color: '#abcdef', enabled: false });
  assert.equal(st.nextId, 8);
  assert.equal(CORE.sanitizeState(null), null);
  assert.equal(CORE.sanitizeState({ rows: 'no' }), null);
});

test('ファイル名: 元ファイル名_marked.html、取得できなければ jpo_marked_YYYYMMDD_HHMMSS.html', () => {
  const now = new Date(2026, 7, 31, 9, 5, 7);
  const enc = encodeURIComponent('特願2022-164196_20260520_手続補正書（自発・内容）_html.html');
  assert.equal(CORE.exportFileName({ pathname: '/C:/Users/x/Downloads/' + enc }, now), '特願2022-164196_20260520_手続補正書（自発・内容）_html_marked.html');
  assert.equal(CORE.exportFileName({ pathname: '/docs/claims.HTM' }, now), 'claims_marked.html');
  assert.equal(CORE.exportFileName({ pathname: '/docs/claims_marked.html' }, now), 'claims_marked.html');
  assert.equal(CORE.exportFileName({ pathname: '/main/core/jsv/docviewer/' }, now), 'jpo_marked_20260831_090507.html');
  assert.equal(CORE.exportFileName({ pathname: '' }, now), 'jpo_marked_20260831_090507.html');
  assert.equal(CORE.exportFileName({ pathname: '/bad%E0%A4%A.html' }, now), 'jpo_marked_20260831_090507.html');
  assert.equal(CORE.exportFileName(null, now), 'jpo_marked_20260831_090507.html');
});

test('ensurePageStyle は 1 回だけ注入し、印刷時に UI を隠す規則を含む', () => {
  const doc = parseHTML('<html><head><title>t</title></head><body><pre>x</pre></body></html>');
  CORE.ensurePageStyle(doc);
  CORE.ensurePageStyle(doc);
  const styles = doc.querySelectorAll('style[' + CORE.ATTR_STYLE + ']');
  assert.equal(styles.length, 1);
  assert.equal(styles[0].parentNode.tagName, 'HEAD');
  assert.ok(styles[0].textContent.includes('@media print{[data-jpo-marker-ui]{display:none !important;}}'));
  assert.ok(styles[0].textContent.includes('.jpo-mk{print-color-adjust:exact;-webkit-print-color-adjust:exact;}'));
});
