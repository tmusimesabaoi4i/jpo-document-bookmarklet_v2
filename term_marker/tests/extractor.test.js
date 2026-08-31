'use strict';
/*
 * extractor.test.js — 「前記XXXX」自動抽出と論理テキスト生成の検証（fixture の実 HTML を使用）
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
const loadDoc = () => parseHTML(fs.readFileSync(FIXTURE, 'utf8'));
const logicalText = () => CORE.buildTextMap(loadDoc().body).text;

/* 課題 22-A で列挙された、候補化されるべき語句 */
const EXPECTED_TERMS = [
  '固定ルート', '第１の他の通信装置', '第２の他の通信装置', '受信完了通知', '通信データ', '自装置',
  'オーバーヒアルート', '送信元アドレス', '宛先アドレス', '第３の他の通信装置',
  '第１通信装置', '第２通信装置', '第３通信装置',
];

/* ============================================================
 * 論理テキスト
 * ============================================================ */
test('論理テキスト: 改行を含まず、改行で分断された語が連結されている', { skip: !hasFixture && 'fixture がありません' }, () => {
  const map = CORE.buildTextMap(loadDoc().body);
  assert.equal(map.text.indexOf('\n'), -1);
  assert.equal(map.text.indexOf('\r'), -1);
  assert.equal(map.text.length, map.length);
  assert.ok(map.text.includes('複数の通信装置に含まれる通信装置であって'), '「通\\n信装置」が連結されていない');
  assert.ok(map.text.includes('前記固定ルート内の第２の他の通信装置'), '「固定\\nルート」が連結されていない');
  assert.ok(map.text.includes('前記受信完了通知が、前記第２の他の通信装置'), '「前\\n記」が連結されていない');
  assert.ok(map.text.includes('前記第１通信装置から前記受信完了通知'), '<u>…</u>\\n<u>…</u> をまたぐ「第１通信装置」が連結されていない');
});

test('論理テキスト: 位置マップが元のテキストノードと 1 文字ずつ対応している', { skip: !hasFixture && 'fixture がありません' }, () => {
  const map = CORE.buildTextMap(loadDoc().body);
  for (let i = 0; i < map.length; i++) {
    const ch = map.nodes[map.nodeIdx[i]].nodeValue.charAt(map.offs[i]);
    assert.equal(ch, map.text.charAt(i), 'index ' + i + ' の写像が一致しない');
  }
  // 除外した文字（改行）以外はすべて論理テキストに含まれる
  let expected = 0;
  for (const n of map.nodes) expected += n.nodeValue.replace(/[\r\n]/g, '').length;
  assert.equal(map.length, expected);
});

test('論理テキスト: script / style / 本ツールの UI・対応表 の内側は対象外', () => {
  const doc = parseHTML(
    '<div>本文<script>var x = "前記スクリプト";</script><style>.a{}</style>' +
    '<div data-jpo-marker-ui="panel">前記パネル</div><div data-jpo-marker-legend="1">前記凡例</div>' +
    '<textarea>前記入力</textarea><u>前記下線</u></div>'
  );
  const map = CORE.buildTextMap(doc.body);
  assert.equal(map.text, '本文前記下線');
});

/* ============================================================
 * 自動抽出（fixture）
 * ============================================================ */
test('抽出: 期待する 13 語がすべて候補化される', { skip: !hasFixture && 'fixture がありません' }, () => {
  const terms = CORE.extractTerms(logicalText()).map((t) => t.term);
  for (const want of EXPECTED_TERMS) assert.ok(terms.includes(want), '「' + want + '」が候補化されていない: ' + terms.join(' / '));
});

test('抽出: 誤抽出がない（助詞・句読点・「前記」・修飾語だけの候補がなく、長すぎない）', { skip: !hasFixture && 'fixture がありません' }, () => {
  const terms = CORE.extractTerms(logicalText());
  assert.ok(terms.length > 0);
  assert.ok(terms.length <= CORE.MAX_COLORS, '候補が ' + CORE.MAX_COLORS + ' を超えた: ' + terms.length);
  for (const t of terms) {
    assert.ok(!/[をにがはとへでも、。，．]/.test(t.term), '助詞や句読点を含む: ' + t.term);
    assert.ok(!t.term.includes('前記'), '「前記」を含む: ' + t.term);
    assert.ok(!/^第[０-９0-9]+$/.test(t.term), '序数だけ: ' + t.term);
    assert.ok(!t.term.endsWith('の') && !t.term.startsWith('の'), '「の」で始まる/終わる: ' + t.term);
    assert.ok(t.term.length <= 12, '長すぎる: ' + t.term);
    assert.ok(!/(に対して|によって|に基づいて|の場合|である)/.test(t.term), '接続表現を含む: ' + t.term);
  }
});

test('抽出: fixture の全候補（ゴールデン。初出順・前記付き出現数）', { skip: !hasFixture && 'fixture がありません' }, () => {
  const got = CORE.extractTerms(logicalText()).map((t) => t.term + ':' + t.count);
  assert.deepEqual(got, [
    '固定ルート:3', '第１の他の通信装置:1', '通信データ:5', '受信完了通知:17', '第２の他の通信装置:7',
    '判定部:3', '自装置:5', '受信部:2', '他の通信データ:3', '送信部:3', 'オーバーヒアルート:3',
    '更新部:1', 'ルーティングテーブル:1', '送信元アドレス:3', '宛先アドレス:3', '生成部:1',
    '第３の他の通信装置:2', '第２通信装置:8', '第１通信装置:6', '第３通信装置:2',
  ]);
});

test('抽出: fixture 中の「前記」79 箇所すべてが何らかの語句に対応する', { skip: !hasFixture && 'fixture がありません' }, () => {
  const text = logicalText();
  const occurrences = (text.match(/前記/g) || []).length;
  const sum = CORE.extractTerms(text).reduce((a, t) => a + t.count, 0);
  assert.equal(occurrences, 79);
  assert.equal(sum, occurrences);
});

/* ============================================================
 * 自動抽出（合成テキストでヒューリスティックの個々の規則を固定する）
 * ============================================================ */
const scan = (s) => CORE.scanTerm(s, 2, CORE.PREFIXES); // 「前記」の直後から
const extract = (s) => CORE.extractTerms(s).map((t) => t.term);

test('scanTerm: 助詞・句読点・接続表現で止まる', () => {
  assert.equal(scan('前記固定ルート内の第１の他の通信装置に対して'), '固定ルート');
  assert.equal(scan('前記第１の他の通信装置に対して、'), '第１の他の通信装置');
  assert.equal(scan('前記受信完了通知は、前記第２の他の通信装置によって'), '受信完了通知');
  assert.equal(scan('前記通信装置であって'), '通信装置');
  assert.equal(scan('前記通信装置、'), '通信装置');
  assert.equal(scan('前記通信装置'), '通信装置');
  assert.equal(scan('前記ルーティングテーブルから'), 'ルーティングテーブル');
  assert.equal(scan('前記オーバーヒアルートを介して'), 'オーバーヒアルート');
  assert.equal(scan('前記送信元アドレス及び前記宛先アドレスに'), '送信元アドレス');
  assert.equal(scan('前記第１及び第２の部材'), '第１'); // 受理判定で捨てられる（下のテスト）
});

test('scanTerm: 「の」は左が修飾語（第N／他／複数…）のときだけ連結する', () => {
  assert.equal(scan('前記第１の他の通信装置から'), '第１の他の通信装置');
  assert.equal(scan('前記他の通信データの通信経路の送信先側に'), '他の通信データ');
  assert.equal(scan('前記受信完了通知の前記送信元アドレス'), '受信完了通知');
  assert.equal(scan('前記受信完了通知の受信に基づいて'), '受信完了通知');
  assert.equal(scan('前記第３の他の通信装置のアドレスを'), '第３の他の通信装置');
  assert.equal(scan('前記複数の通信装置から'), '複数の通信装置');
  assert.equal(scan('前記シャフトの端部に'), 'シャフト');
  assert.equal(scan('前記の通信装置は'), '通信装置');
});

test('scanTerm: 接尾語（内・宛・以上…）は直後が境界のときだけ切る', () => {
  assert.equal(scan('前記自装置宛であると'), '自装置');
  assert.equal(scan('前記第２通信装置宛であるか'), '第２通信装置');
  assert.equal(scan('前記筐体内に'), '筐体');
  assert.equal(scan('前記案内部に'), '案内部');
  assert.equal(scan('前記閾値以上である'), '閾値');
  assert.equal(scan('前記時間が'), '時間');
  assert.equal(scan('前記内側に'), '内側');
  assert.equal(scan('前記送信先側に'), '送信先');
  assert.equal(scan('前記宛先アドレスに'), '宛先アドレス');
  assert.equal(scan('前記使用時に'), '使用');
  // 特許文書に多い「名詞＋接尾語」は例外表に載せていないので切る
  assert.equal(scan('前記反応炉内の'), '反応炉');
  assert.equal(scan('前記燃焼室内に'), '燃焼室');
  assert.equal(scan('前記表面上に'), '表面');
  assert.equal(scan('前記設定時に'), '設定');
  assert.equal(scan('前記通信用に'), '通信');
  assert.equal(scan('前記所定時間が'), '所定時間');
  assert.equal(scan('前記中央部に'), '中央部'); // 接尾語が語頭・語中なら切らない
  assert.equal(scan('前記時刻を'), '時刻');
});

test('scanTerm: 送り仮名を含む語と英数字', () => {
  assert.equal(scan('前記取り付け部材を'), '取り付け部材');
  assert.equal(scan('前記組み合わせを'), '組み合わせ');
  assert.equal(scan('前記読み出し回路が'), '読み出し回路');
  assert.equal(scan('前記ＣＰＵが'), 'ＣＰＵ');
  assert.equal(scan('前記LED素子を'), 'LED素子');
  assert.equal(scan('前記第２ＡＰに'), '第２ＡＰ');
  assert.equal(scan('前記処理した'), '処理');
});

test('extractTerms: 受理判定・重複除去・初出順・出現数', () => {
  assert.deepEqual(extract('前記第１及び第２の部材'), []);
  assert.deepEqual(extract('前記した後、前記より'), []);
  assert.deepEqual(extract('前記Ｂを前記Ａに、前記Ｂへ'), ['Ｂ', 'Ａ']);
  const r = CORE.extractTerms('前記Ｂを前記Ａに、前記Ｂへ');
  assert.equal(r[0].count, 2);
  assert.equal(r[1].count, 1);
  assert.ok(r[0].first < r[1].first);
  assert.equal(CORE.acceptTerm('他'), false);
  assert.equal(CORE.acceptTerm('第１０'), false);
  assert.equal(CORE.acceptTerm('あ'.repeat(31)), false);
  assert.equal(CORE.acceptTerm('通信装置'), true);
});

test('extractTerms: prefixes オプションで起点語を差し替えられる', () => {
  assert.deepEqual(CORE.extractTerms('当該通信装置は前記受信部を', { prefixes: ['当該'] }).map((t) => t.term), ['通信装置']);
  assert.deepEqual(CORE.extractTerms('当該通信装置は前記受信部を', { prefixes: ['前記', '当該'] }).map((t) => t.term), ['通信装置', '受信部']);
});
