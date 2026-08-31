'use strict';
/*
 * highlighter.test.js — 一致範囲の算出・優先順位による重複排除・DOM 適用/解除 の検証
 * （fixture の実 HTML を使用。課題 22 の B〜H に対応）
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

let seq = 1;
const row = (term, extra) => Object.assign({ id: seq++, term, color: '#fff176', enabled: true }, extra || {});

/* パネルの「実行」と同じ手順: 解除 → 論理テキスト → 範囲算出 → 適用 */
function run(doc, rows, options) {
  CORE.unmarkAll(doc.body);
  const map = CORE.buildTextMap(doc.body);
  const res = CORE.computeRanges(map.text, rows, options || { mode: 'all' });
  const spans = CORE.applyMarks(doc, map, res.ranges, rows, { underline: true });
  return { map, ranges: res.ranges, stats: res.stats, spans };
}

const marks = (doc) => doc.body.querySelectorAll('[' + CORE.ATTR_MARK + ']');
const marksOf = (doc, r) => marks(doc).filter((s) => s.getAttribute(CORE.ATTR_TERM) === String(r.id));
const textNodeCount = (node) => CORE.collectTextNodes(node).length;

/* ============================================================
 * 基本
 * ============================================================ */
test('基本: 自動抽出した全語句がマーキングされ、本文テキストは 1 文字も変わらない', { skip }, () => {
  const doc = loadDoc();
  const before = doc.body.textContent;
  const map0 = CORE.buildTextMap(doc.body);
  const made = CORE.createRows(CORE.extractTerms(map0.text), 1);
  const r = run(doc, made.rows);
  assert.ok(r.ranges.length >= 100, '範囲が少なすぎる: ' + r.ranges.length);
  for (const rw of made.rows) assert.ok(r.stats[rw.id].applied > 0, rw.term + ' が 0 件');
  assert.equal(doc.body.textContent, before);
  // 初期状態は文字数の長い順（表の順序＝優先順位）
  const lens = made.rows.map((x) => x.term.length);
  for (let i = 1; i < lens.length; i++) assert.ok(lens[i - 1] >= lens[i], '長い順に並んでいない');
  // 色は上から順にパレット
  made.rows.forEach((x, i) => assert.equal(x.color, CORE.PALETTE[i % CORE.PALETTE.length]));
});

test('基本: 改行を含む span でも本文の改行は保持され、span は span の内側に入らない', { skip }, () => {
  const doc = loadDoc();
  const made = CORE.createRows(CORE.extractTerms(CORE.buildTextMap(doc.body).text), 1);
  run(doc, made.rows);
  const nested = doc.body.querySelectorAll('[' + CORE.ATTR_MARK + '] [' + CORE.ATTR_MARK + ']');
  assert.equal(nested.length, 0);
  const withNewline = marks(doc).filter((s) => s.textContent.includes('\n'));
  assert.ok(withNewline.length > 0, '改行をまたぐ span がない');
  const newlinesBefore = (loadDoc().body.textContent.match(/\n/g) || []).length;
  assert.equal((doc.body.textContent.match(/\n/g) || []).length, newlinesBefore, '改行の数が変わった');
});

/* ============================================================
 * B. 重複（包含）
 * ============================================================ */
test('B: 「第１通信装置」が上位なら、その内部の「通信装置」は別色にならない', { skip }, () => {
  const doc = loadDoc();
  const long = row('第１通信装置', { color: '#ef9a9a' });
  const short = row('通信装置', { color: '#90caf9' });
  const r = run(doc, [long, short]);
  assert.equal(r.stats[long.id].applied, r.stats[long.id].raw, '第１通信装置が全件マーキングされていない');
  assert.ok(r.stats[long.id].applied >= 6);
  // 「通信装置」の範囲のうち、直前が「第１」のものは 1 つもない
  const t = r.map.text;
  for (const rg of r.ranges) {
    if (rg.row !== 1) continue;
    assert.notEqual(t.substring(rg.start - 2, rg.start), '第１', '第１通信装置の内部が通信装置としてマーキングされた');
  }
  // 範囲同士は重ならない
  for (let i = 1; i < r.ranges.length; i++) assert.ok(r.ranges[i].start >= r.ranges[i - 1].end);
  // DOM 上でも、赤 span の直後に青 span が「通信装置」として続くことはない
  for (const s of marksOf(doc, long)) {
    let next = s.nextSibling;
    if (next && next.nodeType === 1 && next.getAttribute(CORE.ATTR_TERM) === String(short.id)) {
      assert.fail('第１通信装置の直後に通信装置 span が続いている: ' + s.textContent + '|' + next.textContent);
    }
  }
});

test('B: 逆順（短い語が上位）だと長い語が隠れる → 文字数↓ソートで解決し、包含警告が出る', { skip }, () => {
  const doc = loadDoc();
  const short = row('通信装置');
  const long = row('第１通信装置');
  const r1 = run(doc, [short, long]);
  assert.equal(r1.stats[long.id].applied, 0);
  assert.ok(r1.stats[long.id].raw > 0);
  const info1 = CORE.containmentInfo([short, long]);
  assert.deepEqual(info1[1].shadowedBy, ['通信装置']);
  assert.deepEqual(info1[0].contains, []);

  const sorted = CORE.sortRowsByLength([short, long]);
  assert.deepEqual(sorted.map((x) => x.term), ['第１通信装置', '通信装置']);
  const r2 = run(doc, sorted);
  assert.equal(r2.stats[long.id].applied, r2.stats[long.id].raw);
  const info2 = CORE.containmentInfo(sorted);
  assert.deepEqual(info2[0].shadowedBy, []);
  assert.deepEqual(info2[0].contains, ['通信装置']);
  assert.deepEqual(info2[1].shadowedBy, []);
});

test('B: 同じ語句が 2 行あれば下の行は重複として無視される', { skip }, () => {
  const doc = loadDoc();
  const a = row('受信完了通知');
  const b = row('受信完了通知');
  const r = run(doc, [a, b]);
  assert.ok(r.stats[a.id].applied > 0);
  assert.equal(r.stats[b.id].applied, 0);
  assert.equal(CORE.containmentInfo([a, b])[1].duplicate, true);
});

/* ============================================================
 * C. 修正 / D. 削除 / E. 追加
 * ============================================================ */
test('C: 「宛先」→「宛先アドレス」に修正して再実行すると、マーキングが置き換わる', { skip }, () => {
  const doc = loadDoc();
  const before = doc.body.textContent;
  const rw = row('宛先');
  const r1 = run(doc, [rw]);
  assert.ok(r1.stats[rw.id].applied >= 4);
  for (const s of marksOf(doc, rw)) assert.equal(s.textContent, '宛先');

  rw.term = '宛先アドレス';
  const r2 = run(doc, [rw]);
  assert.equal(r2.stats[rw.id].applied, 4);
  const texts = marksOf(doc, rw).map((s) => s.textContent);
  assert.equal(texts.join('').length, '宛先アドレス'.length * 4);
  assert.ok(texts.every((t) => '宛先アドレス'.includes(t.replace(/\n/g, ''))));
  assert.equal(marks(doc).length, marksOf(doc, rw).length, '古い「宛先」の span が残っている');
  assert.equal(doc.body.textContent, before);
});

test('D: 行を削除して再実行すると、その語句のマーキングだけ消える', { skip }, () => {
  const doc = loadDoc();
  const a = row('受信完了通知');
  const b = row('固定ルート');
  const r1 = run(doc, [a, b]);
  const countA = r1.stats[a.id].applied;
  assert.ok(countA > 0 && r1.stats[b.id].applied > 0);
  const r2 = run(doc, [a]);
  assert.equal(r2.stats[a.id].applied, countA);
  assert.equal(marksOf(doc, b).length, 0);
  assert.equal(marks(doc).length, marksOf(doc, a).length);
});

test('E: 任意の語句を追加して実行するとマーキングされる（自動抽出できない語も可）', { skip }, () => {
  const doc = loadDoc();
  const added = row('アドホックネットワーク');
  const r = run(doc, [added]);
  assert.equal(r.stats[added.id].applied, 2);
  assert.equal(marksOf(doc, added).length, 2);
  // 空行・空白だけの行は無視される
  const empty = row('   ');
  const r2 = run(doc, [empty, added]);
  assert.equal(r2.stats[empty.id].raw, 0);
  assert.equal(r2.stats[added.id].applied, 2);
});

test('無効行（チェックオフ）はマーキングされないが出現数は数える', { skip }, () => {
  const doc = loadDoc();
  const off = row('受信完了通知', { enabled: false });
  const on = row('固定ルート');
  const r = run(doc, [off, on]);
  assert.equal(r.stats[off.id].applied, 0);
  assert.ok(r.stats[off.id].raw > 10);
  assert.equal(marksOf(doc, off).length, 0);
  assert.ok(marksOf(doc, on).length > 0);
});

/* ============================================================
 * F. 改行をまたぐ語句
 * ============================================================ */
test('F: 「通\\n信装置」のように改行で分断された語も 1 つの一致として検出・マーキングされる', { skip }, () => {
  const doc = loadDoc();
  const before = doc.body.textContent;
  const rw = row('通信装置');
  const r = run(doc, [rw]);
  const spans = marksOf(doc, rw);
  const split = spans.filter((s) => s.textContent === '通\n信装置');
  assert.equal(split.length, 1, '改行を内包した span が 1 つあるはず');
  assert.equal(doc.body.textContent, before, '元の改行が失われた');
  // 論理テキスト上の一致数 = 元 HTML から改行を除いた文字列での一致数
  const plain = before.replace(/[\r\n]/g, '');
  assert.equal(r.stats[rw.id].raw, plain.split('通信装置').length - 1);
});

test('F: <u>…</u>\\n<u>…</u> をまたぐ「第１通信装置」は複数 span に分かれて両方 <u> の内側に入る', { skip }, () => {
  const doc = loadDoc();
  const rw = row('第１通信装置');
  const r = run(doc, [rw]);
  const spans = marksOf(doc, rw);
  const head = spans.find((s) => s.textContent === '第１通');
  const tail = spans.find((s) => s.textContent === '信装置');
  assert.ok(head && tail, '分割 span（第１通 / 信装置）が見つからない');
  assert.ok(head.closest('u') && tail.closest('u'), '分割 span が <u> の内側にない');
  assert.notEqual(head.closest('u'), tail.closest('u'), '別々の <u> に属するはず');
  assert.equal(r.stats[rw.id].applied, 7);
  assert.equal(spans.length, 8, '7 一致のうち 1 つが 2 span に分かれて計 8 span');
});

/* ============================================================
 * G. 下線 <u> の保持
 * ============================================================ */
test('G: <u> の数・テキストが保持され、<u> 内の語句もマーキングされる', { skip }, () => {
  const doc = loadDoc();
  const uBefore = doc.body.querySelectorAll('u').map((u) => u.textContent);
  assert.equal(uBefore.length, 7);
  const made = CORE.createRows(CORE.extractTerms(CORE.buildTextMap(doc.body).text), 1);
  run(doc, made.rows);
  const uAfter = doc.body.querySelectorAll('u');
  assert.deepEqual(uAfter.map((u) => u.textContent), uBefore);
  const inU = marks(doc).filter((s) => s.closest('u'));
  assert.ok(inU.length >= 10, '<u> 内のマーキングが少なすぎる: ' + inU.length);
  for (const u of uAfter) {
    // <u> は span の親であって、span の子ではない（構造が反転していない）
    assert.equal(u.closest('[' + CORE.ATTR_MARK + ']'), null);
  }
});

/* ============================================================
 * H. 再実行
 * ============================================================ */
test('H: 10 回再実行しても span 数・件数・本文が変わらず、ネストせず、極端に遅くならない', { skip }, () => {
  const doc = loadDoc();
  const before = doc.body.textContent;
  const beforeNodes = textNodeCount(doc.body);
  const made = CORE.createRows(CORE.extractTerms(CORE.buildTextMap(doc.body).text), 1);
  let first = null;
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t0 = process.hrtime.bigint();
    const r = run(doc, made.rows);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    const snapshot = { spans: r.spans, ranges: r.ranges.length, marks: marks(doc).length, stats: JSON.stringify(r.stats) };
    if (!first) first = snapshot;
    else assert.deepEqual(snapshot, first, '実行 ' + (i + 1) + ' 回目で結果が変わった');
    assert.equal(doc.body.querySelectorAll('[' + CORE.ATTR_MARK + '] [' + CORE.ATTR_MARK + ']').length, 0, 'span がネストした');
    assert.equal(doc.body.textContent, before);
  }
  assert.ok(Math.max(...times) < 500, '遅すぎる: ' + times.map((t) => t.toFixed(1)).join(', ') + ' ms');
  // 解除すると元のテキストノード構成に戻る
  CORE.unmarkAll(doc.body);
  assert.equal(marks(doc).length, 0);
  assert.equal(textNodeCount(doc.body), beforeNodes);
});

test('性能: fixture を 100 倍（約 21 万文字）にしても 1 回の実行が実用的な時間で終わる', { skip }, () => {
  const doc = loadDoc();
  const pre = doc.body.querySelector('pre');
  for (let i = 0; i < 99; i++) doc.body.appendChild(pre.cloneNode(true));
  const made = CORE.createRows(CORE.extractTerms(CORE.buildTextMap(doc.body).text), 1);
  assert.equal(made.rows.length, 20, '複製しても候補は増えない（重複除去）');
  const t0 = process.hrtime.bigint();
  const r = run(doc, made.rows);
  const first = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(r.map.text.length > 200000, '論理テキスト長: ' + r.map.text.length);
  assert.equal(r.ranges.length, 113 * 100);
  const t1 = process.hrtime.bigint();
  run(doc, made.rows); // 解除を含む再実行
  const second = Number(process.hrtime.bigint() - t1) / 1e6;
  // ブラウザ実測は約 130 ms。最小 DOM は遅いので余裕を見て 3 秒
  assert.ok(first < 3000 && second < 3000, '遅すぎる: ' + first.toFixed(0) + ' ms / ' + second.toFixed(0) + ' ms');
});

test('H: マーキング → 解除 で DOM のシリアライズ結果が完全に元に戻る', { skip }, () => {
  const doc = loadDoc();
  const original = doc.body.outerHTML;
  const made = CORE.createRows(CORE.extractTerms(CORE.buildTextMap(doc.body).text), 1);
  run(doc, made.rows);
  assert.notEqual(doc.body.outerHTML, original);
  assert.equal(CORE.unmarkAll(doc.body) > 0, true);
  assert.equal(doc.body.outerHTML, original);
});

/* ============================================================
 * 一致方法（全文一致 / 前記付きのみ）
 * ============================================================ */
test('mode=prefixed: 直前が「前記」の箇所だけマーキングし、「前記」自体は色付けしない', { skip }, () => {
  const doc = loadDoc();
  const text = CORE.buildTextMap(doc.body).text;
  const rw = row('受信完了通知');
  const all = run(doc, [rw], { mode: 'all' });
  const pre = run(doc, [rw], { mode: 'prefixed' });
  assert.equal(pre.stats[rw.id].applied, (text.match(/前記受信完了通知/g) || []).length);
  assert.ok(all.stats[rw.id].applied > pre.stats[rw.id].applied);
  for (const s of marksOf(doc, rw)) assert.ok(!s.textContent.includes('前記'));
  // 「前記通信装置」は文書にないので prefixed では 0 件
  const bare = row('通信装置');
  assert.equal(run(doc, [bare], { mode: 'prefixed' }).stats[bare.id].applied, 0);
  assert.ok(run(doc, [bare], { mode: 'all' }).stats[bare.id].applied > 0);
});

/* ============================================================
 * 状態ユーティリティ
 * ============================================================ */
test('createRows / assignColors / nextFreeColor / sortRowsByLength', () => {
  const made = CORE.createRows([{ term: 'ab' }, { term: 'abcd' }, { term: 'abc' }, { term: 'xy' }], 5);
  assert.deepEqual(made.rows.map((r) => r.term), ['abcd', 'abc', 'ab', 'xy']); // 同じ長さは元の順（安定）
  assert.deepEqual(made.rows.map((r) => r.id), [6, 7, 5, 8]);
  assert.equal(made.nextId, 9);
  assert.equal(CORE.nextFreeColor(made.rows), CORE.PALETTE[4]);
  const many = CORE.assignColors(Array.from({ length: 30 }, (_, i) => ({ id: i, term: 't' + i })));
  assert.equal(many[25].color, CORE.PALETTE[0], '26 語目はパレットを循環する');
  assert.equal(CORE.nextFreeColor(many), CORE.PALETTE[30 % 25]);
});

test('markStyle: 背景色・黒文字・任意の下線', () => {
  assert.equal(CORE.markStyle('#FFF176'), 'background-color:#fff176;color:#000;border-bottom:2px solid #8c8541;');
  assert.equal(CORE.markStyle('#fff176', { underline: false }), 'background-color:#fff176;color:#000;');
  assert.equal(CORE.markStyle('garbage'), 'background-color:' + CORE.PALETTE[0] + ';color:#000;border-bottom:2px solid ' + CORE.accentColor(CORE.PALETTE[0]) + ';');
});
