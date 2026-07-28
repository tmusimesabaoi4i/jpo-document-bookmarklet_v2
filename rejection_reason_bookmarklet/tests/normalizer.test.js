'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const normalizer = require('../src/core/normalizer');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'rejection-reason', '拒絶理由例.txt');

test('改行正規化: CRLF/CR → LF', () => {
  assert.equal(normalizer.normalizeLineEndings('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  assert.equal(normalizer.normalizeLineEndings(null), '');
});

test('全角数字 → 半角', () => {
  assert.equal(normalizer.toHalfWidthDigits('請求項２０と19'), '請求項20と19');
});

test('照合用正規化: 長さを変えない 1:1 置換', () => {
  const raw = '請求項２－７、３‐５及び１９～２０（，：）ー';
  const m = normalizer.normalizeForMatching(raw);
  assert.equal(m.length, raw.length);
  assert.equal(m, '請求項2-7、3-5及び19-20（、:）ー');
});

test('照合用正規化: ダッシュ類 8 種とチルダ 2 種がすべて - になる', () => {
  const dashes = ['－', '‐', '‑', '‒', '–', '—', '―', '～', '〜'];
  for (const d of dashes) {
    assert.equal(normalizer.normalizeForMatching('2' + d + '7'), '2-7', 'dash: U+' + d.charCodeAt(0).toString(16));
  }
});

test('除外: fixture の調査結果記録・連絡先が除去され、最後の結論文は残る', (t) => {
  if (!fs.existsSync(FIXTURE)) {
    t.skip('fixtures が見つからないため skip（プロジェクト単独コピー環境）');
    return;
  }
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const { body, matchBody, removedNote } = normalizer.removeNonReasonSections(text);
  assert.equal(body.length, matchBody.length);
  assert.notEqual(removedNote, null);
  assert.equal(body.indexOf('先行技術文献調査結果の記録'), -1);
  assert.equal(body.indexOf('調査した分野'), -1);
  assert.equal(body.indexOf('お問合せ'), -1);
  assert.equal(body.indexOf('TEL'), -1);
  assert.ok(body.indexOf('よって、請求項１９-２０に係る発明は、発明の詳細な説明に記載したものでない。') !== -1);
});

test('除外: マーカーが無ければ何も除去しない', () => {
  const text = '●理由１（明確性）について\n・請求項 １\n　よって、請求項１に係る発明は明確でない。\n';
  const r = normalizer.removeNonReasonSections(text);
  assert.equal(r.body, text);
  assert.equal(r.removedNote, null);
});

test('除外: 罫線なしの連絡ブロック（お問合せ＋面接）でも切れる', () => {
  const text = '本文です。\n　この拒絶理由通知の内容に関するお問合せ又は面接のご希望がありましたら、次の連絡先までご連絡ください。\nTEL.03-0000-0000\n';
  const r = normalizer.removeNonReasonSections(text);
  assert.equal(r.body, '本文です。\n');
  assert.notEqual(r.removedNote, null);
});

test('除外: ＜引用文献等一覧＞は除去されない（罫線＋調査記録より前にある場合）', () => {
  const text = [
    '・請求項 １',
    '・引用文献等 １',
    '　　＜引用文献等一覧＞',
    '１．特開２０２０－１２３４５６号公報',
    '－－－－－－－－－－－－－－－－－－－－',
    '　　＜先行技術文献調査結果の記録＞',
    '　この先行技術文献調査結果の記録は、拒絶理由を構成するものではありません。',
  ].join('\n');
  const r = normalizer.removeNonReasonSections(text);
  assert.ok(r.body.indexOf('引用文献等一覧') !== -1);
  assert.ok(r.body.indexOf('特開２０２０－１２３４５６号公報') !== -1);
  assert.equal(r.body.indexOf('先行技術文献調査結果の記録'), -1);
});
