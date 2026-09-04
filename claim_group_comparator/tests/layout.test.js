'use strict';
const test = require('node:test');
const assert = require('node:assert');
const layout = require('../src/core/layout');

const WIDTHS = [768, 1366, 1920, 2560];
const COUNTS = [1, 2, 4, 6, 8, 9, 16, 30, 100];

function cols(width, cardCount, density, columns) {
  return layout.computeLayout({ viewportWidth: width, cardCount, density, columns }).columns;
}

test('カード数の目安どおりに列が決まる（標準密度・広い画面）', () => {
  assert.strictEqual(cols(1920, 1), 1);
  assert.strictEqual(cols(1920, 2), 2);
  assert.strictEqual(cols(1920, 3), 3);
  assert.strictEqual(cols(1920, 4), 4);
});

test('5〜8枚は3〜4列、9枚以上は4〜6列に収まる', () => {
  for (const width of [1366, 1920, 2560]) {
    for (const n of [5, 6, 7, 8]) {
      const c = cols(width, n);
      assert.ok(c >= 3 && c <= 4, `${width}px / ${n}枚 → ${c}列`);
    }
    for (const n of [9, 16, 30, 100]) {
      const c = cols(width, n);
      assert.ok(c >= 4 && c <= 6, `${width}px / ${n}枚 → ${c}列`);
    }
  }
});

test('画面幅が狭いときは自動的に列数が減る', () => {
  for (const n of COUNTS) {
    assert.ok(cols(768, n) <= cols(1366, n), `${n}枚: 768px は 1366px 以下の列数`);
    assert.ok(cols(1366, n) <= cols(1920, n), `${n}枚: 1366px は 1920px 以下の列数`);
  }
  assert.strictEqual(cols(768, 4), 2, '4枚は狭い画面で2列');
});

test('どの幅・枚数でもカードは最小幅を下回らない', () => {
  for (const density of ['compact', 'normal', 'roomy']) {
    for (const width of WIDTHS) {
      for (const n of COUNTS) {
        const result = layout.computeLayout({ viewportWidth: width, cardCount: n, density });
        const usable = Math.max(result.minCardWidth, width - layout.PAGE_PADDING);
        const cardWidth = (usable - result.gap * (result.columns - 1)) / result.columns;
        assert.ok(
          cardWidth >= result.minCardWidth - 1,
          `${density}/${width}px/${n}枚 → ${result.columns}列でカード幅 ${Math.round(cardWidth)}px`
        );
      }
    }
  }
});

test('列数を明示しても、幅が足りなければ幅を優先する（横スクロールを出さない）', () => {
  assert.strictEqual(cols(768, 30, 'normal', '6'), 2);
  assert.strictEqual(cols(2560, 30, 'normal', '6'), 6);
  assert.strictEqual(cols(2560, 30, 'normal', '3'), 3);
  // カード数より多い列は作らない
  assert.strictEqual(cols(2560, 2, 'normal', '6'), 2);
});

test('表示密度でカードの最小幅と余白が変わる', () => {
  const compact = layout.computeLayout({ viewportWidth: 1920, cardCount: 30, density: 'compact' });
  const normal = layout.computeLayout({ viewportWidth: 1920, cardCount: 30, density: 'normal' });
  const roomy = layout.computeLayout({ viewportWidth: 1920, cardCount: 30, density: 'roomy' });
  assert.ok(compact.minCardWidth < normal.minCardWidth);
  assert.ok(normal.minCardWidth < roomy.minCardWidth);
  assert.ok(compact.columns >= normal.columns);
  assert.ok(normal.columns >= roomy.columns);
});

test('1枚のときは中央に読みやすい幅で置く', () => {
  const result = layout.computeLayout({ viewportWidth: 2560, cardCount: 1 });
  assert.strictEqual(result.columns, 1);
  assert.strictEqual(result.centered, true);
  assert.ok(result.singleMaxWidth > 0);
});

test('0枚でも壊れない', () => {
  const result = layout.computeLayout({ viewportWidth: 1366, cardCount: 0 });
  assert.strictEqual(result.columns, 1);
});
