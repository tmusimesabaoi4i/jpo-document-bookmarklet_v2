'use strict';
/*
 * palette.test.js — 25 色パレットの品質（黒文字の可読性・隣接色の判別性・重複なし）
 * 実行: node --test term_marker/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CORE = require('../src/bookmarklet/marker');

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/* WCAG 相対輝度 / コントラスト比 */
function luminance(rgb) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const [r, g, b] = rgb.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastWithBlack = (rgb) => (luminance(rgb) + 0.05) / 0.05;

/* CIE76 ΔE（sRGB → Lab） */
function rgbToLab(rgb) {
  const lin = rgb.map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  const [r, g, b] = lin;
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function deltaE(a, b) {
  const la = rgbToLab(hexToRgb(a));
  const lb = rgbToLab(hexToRgb(b));
  return Math.sqrt(la.reduce((s, v, i) => s + (v - lb[i]) ** 2, 0));
}

test('25 色・小文字 #rrggbb・重複なし', () => {
  assert.equal(CORE.PALETTE.length, 25);
  assert.equal(CORE.MAX_COLORS, 25);
  for (const c of CORE.PALETTE) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(CORE.PALETTE).size, 25);
});

test('すべての色で黒文字のコントラスト比が 7:1 以上（明るく、暗すぎない）', () => {
  for (const c of CORE.PALETTE) {
    const ratio = contrastWithBlack(hexToRgb(c));
    assert.ok(ratio >= 7, c + ' の黒文字コントラスト比が低い: ' + ratio.toFixed(2));
    assert.ok(luminance(hexToRgb(c)) <= 0.93, c + ' は白に近すぎて見分けにくい');
  }
});

test('隣接する色同士は十分に異なる（ΔE76 ≥ 20）、全ペアでも ΔE76 ≥ 9', () => {
  const p = CORE.PALETTE;
  for (let i = 1; i < p.length; i++) {
    const d = deltaE(p[i - 1], p[i]);
    assert.ok(d >= 20, p[i - 1] + ' と ' + p[i] + ' が似すぎている: ΔE=' + d.toFixed(1));
  }
  let min = Infinity;
  let pair = null;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const d = deltaE(p[i], p[j]);
      if (d < min) { min = d; pair = [p[i], p[j]]; }
    }
  }
  assert.ok(min >= 9, '最も近いペア ' + pair.join(' / ') + ' の ΔE=' + min.toFixed(1));
});

test('accentColor は同系色でより暗い（下線用）', () => {
  for (const c of CORE.PALETTE) {
    const a = CORE.accentColor(c);
    assert.match(a, /^#[0-9a-f]{6}$/);
    assert.ok(luminance(hexToRgb(a)) < luminance(hexToRgb(c)) * 0.5);
  }
  assert.equal(CORE.accentColor('#ffffff'), '#8c8c8c');
  assert.equal(CORE.accentColor('not-a-color'), CORE.accentColor('#c8c8c8'));
});

test('normalizeColor は #RRGGBB を小文字に正規化し、不正値はフォールバック', () => {
  assert.equal(CORE.normalizeColor('#ABCDEF'), '#abcdef');
  assert.equal(CORE.normalizeColor(' abcdef '), '#abcdef');
  assert.equal(CORE.normalizeColor('red', '#111111'), '#111111');
  assert.equal(CORE.normalizeColor(null), CORE.PALETTE[0]);
});
