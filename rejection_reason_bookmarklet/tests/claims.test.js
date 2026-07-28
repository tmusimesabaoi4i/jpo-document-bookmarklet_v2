'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const claims = require('../src/core/claims');

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function parsed(expr) {
  const r = claims.parseClaimExpression(expr);
  assert.equal(r.ok, true, '解析成功を期待: ' + JSON.stringify(expr) + ' -> ' + JSON.stringify(r.warnings));
  return r.claims;
}

test('請求項式: 単独・空白・全半角', () => {
  assert.deepEqual(parsed('２'), [2]);
  assert.deepEqual(parsed(' ２ '), [2]);
  assert.deepEqual(parsed('2'), [2]);
  assert.deepEqual(parsed('　２０　'), [20]);
});

test('請求項式: 範囲（ダッシュ類・チルダ・ないし）', () => {
  for (const e of ['２-７', '２－７', '２‐７', '２‒７', '２–７', '２—７', '２～７', '２〜７', '２ないし７', '2 - 7']) {
    assert.deepEqual(parsed(e), range(2, 7), 'expr: ' + e);
  }
});

test('請求項式: 列挙（読点・及び・混在）', () => {
  assert.deepEqual(parsed('２、４'), [2, 4]);
  assert.deepEqual(parsed('３-５、１９-２０'), [3, 4, 5, 19, 20]);
  assert.deepEqual(parsed('３－５及び１９－２０'), [3, 4, 5, 19, 20]);
  assert.deepEqual(parsed('４、１９-２０'), [4, 19, 20]);
  assert.deepEqual(parsed('１，３'), [1, 3]);
});

test('請求項式: 逆転範囲・空はエラー', () => {
  assert.equal(claims.parseClaimExpression('５-３').ok, false);
  assert.equal(claims.parseClaimExpression('').ok, false);
  assert.equal(claims.parseClaimExpression('あ').ok, false);
});

test('圧縮表示: 連続番号を範囲表記へ戻す', () => {
  assert.equal(claims.compressClaimNumbers(range(2, 7)), '2-7');
  assert.equal(claims.compressClaimNumbers([3, 4, 19, 20]), '3-4、19-20');
  assert.equal(claims.compressClaimNumbers([5]), '5');
  assert.equal(claims.compressClaimNumbers([1, 3, 5]), '1、3、5');
  assert.equal(claims.compressClaimNumbers([]), '');
  assert.equal(claims.compressClaimNumbers([7, 2, 3, 4, 5, 6]), '2-7');
});

test('往復: parse(compress(x)) === x', () => {
  for (const x of [[2, 3, 4, 5, 6, 7], [3, 4, 19, 20], [1], [1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]]) {
    assert.deepEqual(parsed(claims.compressClaimNumbers(x)), x);
  }
});

test('参照抽出: 融合文から 3 参照（原文スライスは全角のまま）', () => {
  const raw = '請求項３-４、１９-２０にも同様の点が指摘され、請求項２、４を引用する請求項５-７にも同様の点が指摘される。';
  // matchText は normalizer 相当（この文はダッシュ・数字とも全半角が既に正規形なので手動生成）
  const match = raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const refs = claims.extractClaimRefs(match, raw);
  assert.equal(refs.length, 3);
  assert.deepEqual(refs[0].claims, [3, 4, 19, 20]);
  assert.deepEqual(refs[1].claims, [2, 4]);
  assert.deepEqual(refs[2].claims, [5, 6, 7]);
  assert.equal(refs[0].raw, '請求項３-４、１９-２０');
  assert.equal(refs[2].exprRaw, '５-７');
});

test('参照抽出: 請求項の接頭辞が無い数値（段落番号等）は拾わない', () => {
  const s = '（段落0015-0023、図3）に記載されている。';
  assert.deepEqual(claims.extractClaimRefs(s), []);
});

test('修正注記: 除く・追加・不明', () => {
  assert.deepEqual(claims.parseCorrectionNote('修正:5を除く', '修正：５を除く').excluded, [5]);
  assert.deepEqual(claims.parseCorrectionNote('修正:5、7を除く').excluded, [5, 7]);
  assert.deepEqual(claims.parseCorrectionNote('修正:8を追加').added, [8]);
  assert.equal(claims.parseCorrectionNote('補正で削除').recognized, false);
});

test('見出し行: 修正注記つき（原文表記の保持を含む）', () => {
  const h = claims.parseClaimHeading('・請求項 ３-５、１９-２０（修正：５を除く）');
  assert.equal(h.headingClaimsRaw, '３-５、１９-２０');
  assert.deepEqual(h.headingClaims, [3, 4, 5, 19, 20]);
  assert.deepEqual(h.effectiveHeadingClaims, [3, 4, 19, 20]);
  assert.equal(h.correctionNote.raw, '修正：５を除く');
  assert.deepEqual(h.correctionNote.excluded, [5]);
});

test('見出し行: 注記なし・解釈不能な注記', () => {
  const plain = claims.parseClaimHeading('・請求項 ２-７');
  assert.deepEqual(plain.headingClaims, [2, 3, 4, 5, 6, 7]);
  assert.equal(plain.correctionNote, null);
  assert.equal(plain.warnings.length, 0);

  const odd = claims.parseClaimHeading('・請求項 ２-７（補正予定）');
  assert.deepEqual(odd.headingClaims, [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(odd.effectiveHeadingClaims, [2, 3, 4, 5, 6, 7]);
  assert.equal(odd.correctionNote.recognized, false);
  assert.ok(odd.warnings.some((w) => w.code === 'UNKNOWN_HEADING_NOTE'));
});

test('見出し行: 請求項番号なしは警告つきで空を返す', () => {
  const bad = claims.parseClaimHeading('・引用文献等 １、２');
  assert.deepEqual(bad.headingClaims, []);
  assert.ok(bad.warnings.length > 0);
});
