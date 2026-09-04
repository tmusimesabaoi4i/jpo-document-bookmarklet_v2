'use strict';
const test = require('node:test');
const assert = require('node:assert');
const segment = require('../src/core/segment');
const normalize = require('../src/core/normalize');
const helpers = require('./helpers');

test('全角空白の連なりを構成要件の区切りとして分割する', () => {
  const text = '　無線通信ネットワークに対して信号を送受信する中継通信デバイスを動作させる方法であって、'
    + '　前記中継通信デバイスと通信チャネルの測定を示す複数の測定レポートを蓄積し、'
    + '　前記蓄積した複数の測定レポートに関する指標から成る蓄積測定レポートを生成し、';
  const segs = segment.splitSegments(text);
  assert.strictEqual(segs.length, 3);
  assert.strictEqual(segs[0].index, 1);
  assert.ok(segs[0].text.startsWith('無線通信ネットワーク'));
  assert.ok(segs[2].text.endsWith('生成し、'));
  // 先頭の全角空白は表示テキストに残さない
  assert.ok(!/^[　]/.test(segs[0].text));
});

test('全角空白の連なりの長さをインデント深さとして持つ', () => {
  const text = '　前記蓄積測定レポートは、'
    + '　　前記リモート通信デバイスのそれぞれに関係付けられた識別子、'
    + '　　前記リモート通信デバイス数に関する指標、'
    + '　のうちの1つ又は複数に関する指標から成る';
  const segs = segment.splitSegments(text);
  assert.deepStrictEqual(segs.map((s) => s.depth), [1, 2, 2, 1]);
});

test('改行（<br> 由来）でも分割する', () => {
  const segs = segment.splitSegments('前段の記載が十分に長い場合の一行目です。\n二行目も十分に長い記載になっています。');
  assert.strictEqual(segs.length, 2);
});

test('極端に短い断片は直前の段落へ結合する（末尾の「方法。」など）', () => {
  const text = '　請求項1に記載の方法であって、　前記他の中継通信デバイスは同じセル内に存在する　方法。　　';
  const segs = segment.splitSegments(text);
  assert.strictEqual(segs.length, 2);
  assert.ok(segs[1].text.endsWith('方法。'), '「方法。」は前の段落に吸収される: ' + segs[1].text);
});

test('区切りが無いときだけ句読点でフォールバック分割する', () => {
  const long = 'あ'.repeat(70);
  const segs = segment.splitSegments(long + '、' + long + '。');
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].source, 'fallback');
});

test('短い一文はフォールバックでも分割しない', () => {
  const segs = segment.splitSegments('請求項42に記載のコンピュータプログラムを記憶された記録媒体。');
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].source, 'structural');
});

test('正規化する前に段落を取ること（正規化後は境界が消える）', () => {
  const text = '　第1の記載が十分に長い一段落目です。　第2の記載が十分に長い二段落目です。';
  assert.strictEqual(segment.splitSegments(text).length, 2);
  // 正規化してからでは 1 段落にしかならない = 順序を守る必要がある
  assert.strictEqual(segment.splitSegments(normalize.normalizeForCompare(text)).length, 1);
});

test('実物の請求項でも段落境界が取れている', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const result = helpers.extract('parallelTree');
  const claim1 = result.claims.find((c) => c.number === 1);
  assert.ok(claim1.segments.length >= 4, '請求項1が複数の構成要件に割れている');
  assert.ok(claim1.segments.every((s) => s.text.trim() !== ''), '空の段落が残っていない');
  assert.ok(claim1.segments.every((s) => !/\[\d+-\d+\]/.test(s.text)), '表示用番号が残っていない');
});

test('並行ツリーの対応する請求項は段落数もそろう', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const result = helpers.extract('parallelTree');
  const counts = (n) => result.claims.find((c) => c.number === n).segmentCount;
  // 1・8・15 系列の同じ位置どうしは、独立して抽出しても同じ段落数になる
  assert.strictEqual(counts(2), counts(9));
  assert.strictEqual(counts(9), counts(16));
  assert.strictEqual(counts(7), counts(14));
  assert.strictEqual(counts(14), counts(21));
});
