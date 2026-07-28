'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const normalizer = require('../src/core/normalizer');
const splitter = require('../src/core/splitter');
const cs = require('../src/core/clarity-support');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'rejection-reason', '拒絶理由例.txt');

// 行区切りテキストから 1 ブロックを作る（raw と match を並走生成）
function toBlock(lines) {
  const raw = lines.join('\n');
  const match = normalizer.normalizeForMatching(raw);
  const nl = raw.indexOf('\n');
  return {
    headingLineRaw: nl === -1 ? raw : raw.slice(0, nl),
    headingLineMatch: nl === -1 ? match : match.slice(0, nl),
    rawText: raw,
    matchText: match,
  };
}

const CTX = { reasonNumber: 1, category: 'clarity', categoryLabel: '明確性', itemNumber: 1 };

test('文分割: かぎ括弧内の句点では切らない・字下げ結合・末尾句点なし', () => {
  const text = '　請求項１には「Ａする。Ｂする。」ことが記載されている。\n　しかし不明確である';
  const s = cs.splitSentences(normalizer.normalizeForMatching(text), text);
  assert.equal(s.length, 2);
  assert.ok(s[0].raw.indexOf('「Ａする。Ｂする。」') !== -1);
  assert.equal(s[1].raw, 'しかし不明確である');
});

test('文分割: 折返し行が 1 文に結合される', () => {
  const text = '　請求項１には「長い\n　引用」が記載されて\n　いる。';
  const s = cs.splitSentences(normalizer.normalizeForMatching(text), text);
  assert.equal(s.length, 1);
  assert.equal(s[0].raw, '請求項１には「長い引用」が記載されている。');
});

test('かぎ括弧スパン: 入れ子はトップレベルのみ・閉じ忘れは無視', () => {
  const spans = cs.scanQuotes('「外『内』側」と「二つ目」と「閉じない');
  assert.equal(spans.length, 2);
  assert.equal(spans[0].innerEnd - spans[0].innerStart, '外『内』側'.length);
});

test('融合文: 同様指摘と引用関係指摘を 1 文から両方抽出する', () => {
  const block = toBlock([
    '・請求項 ２-７、１９-２０',
    '　請求項２には「Ａ」が記載されている。',
    '　請求項３-４、１９-２０にも同様の点が指摘され、請求項２、４を引用する請求項５-７にも同様の点が指摘される。',
    '　よって、請求項２-７、１９-２０に係る発明は、発明の詳細な説明に記載したものでない。',
  ]);
  const item = cs.parseIssueBlock(block, CTX);
  assert.deepEqual(item.sameIssueClaims, [3, 4, 19, 20]);
  assert.equal(item.dependencyRelations.length, 1);
  assert.deepEqual(item.dependencyRelations[0].parentClaims, [2, 4]);
  assert.deepEqual(item.dependencyRelations[0].affectedClaims, [5, 6, 7]);
  assert.deepEqual(item.finalClaims, [2, 3, 4, 5, 6, 7, 19, 20]);
  assert.equal(item.unmatchedSentences.length, 0);
});

test('同様指摘: 終止形・連用形の単独文', () => {
  const block = toBlock([
    '・請求項 ２-７',
    '　請求項２には「Ａ」が記載されている。',
    '　請求項３にも同様の点が指摘される。',
    '　請求項４を引用する請求項５にも同様の点が指摘される。',
    '　よって、請求項２-７に係る発明は明確でない。',
  ]);
  const item = cs.parseIssueBlock(block, CTX);
  assert.deepEqual(item.sameIssueClaims, [3]);
  assert.deepEqual(item.dependencyRelations[0].parentClaims, [4]);
  assert.deepEqual(item.dependencyRelations[0].affectedClaims, [5]);
});

test('比較対象規則: 見出しに含まれない請求項の「…には」は直接指摘にしない', () => {
  const block = toBlock([
    '・請求項 ２-７',
    '　請求項１を引用する請求項２には「問題の記載」が記載されている。',
    '　しかしながら、請求項１には「比較の記載」が記載されている。',
    '　よって、請求項２-７に係る発明は明確でない。',
  ]);
  const item = cs.parseIssueBlock(block, CTX);
  assert.deepEqual(item.directClaims, [2]);
  assert.deepEqual(item.citedParentClaims, [1]);
  const roles = item.problematicPhrases.map((p) => [p.role, p.text]);
  assert.deepEqual(roles, [['problem', '問題の記載'], ['comparison', '比較の記載']]);
  assert.deepEqual(item.problematicPhrases[0].claimNumbers, [2]);
  assert.deepEqual(item.problematicPhrases[1].claimNumbers, [1]);
});

test('「加えて、請求項１には…」も比較対象になる（接続詞リスト非依存）', () => {
  const block = toBlock([
    '・請求項 ２-７、１９-２０',
    '　請求項１を引用する請求項２には「Ｘ」ことが記載されている。',
    '　加えて、請求項１には「Ｙ」ことが記載されている。',
    '　よって、請求項２-７、１９-２０に係る発明は、発明の詳細な説明に記載したものでない。',
  ]);
  const item = cs.parseIssueBlock(block, CTX);
  assert.equal(item.problematicPhrases[1].role, 'comparison');
  assert.deepEqual(item.problematicPhrases[1].claimNumbers, [1]);
});

test('明細書文: 欠落記載の捕捉（「こと」は除いて抽出）', () => {
  const block = toBlock([
    '・請求項 ２',
    '　請求項２には「Ａ」ことが記載されている。',
    '　しかしながら、本願明細書には任意の条件に基づいて制御することは記載されていない。',
    '　よって、請求項２に係る発明は、発明の詳細な説明に記載したものでない。',
  ]);
  const item = cs.parseIssueBlock(block, CTX);
  assert.equal(item.specStatements.length, 1);
  assert.equal(item.specStatements[0].missing, '任意の条件に基づいて制御する');
});

test('結論文に請求項番号が無ければ見出しを暫定値にする', () => {
  const block = toBlock([
    '・請求項 ２-７',
    '　請求項２には「Ａ」が記載されている。',
    '　よって、本願に係る発明は明確でない。',
  ]);
  const item = cs.parseIssueBlock(block, CTX);
  assert.deepEqual(item.finalClaims, [2, 3, 4, 5, 6, 7]);
  assert.equal(item.finalClaimsSource, 'headingFallback');
  assert.equal(item.finalClaimsRaw, null);
  assert.notEqual(item.conclusionText, null);
});

test('未解析文: どの抽出器にも掛からない文が unmatchedSentences に残る', () => {
  const block = toBlock([
    '・請求項 ２',
    '　この点は審査官として付言する。',
    '　よって、請求項２に係る発明は明確でない。',
  ]);
  const item = cs.parseIssueBlock(block, CTX);
  assert.equal(item.unmatchedSentences.length, 1);
  assert.ok(item.unmatchedSentences[0].indexOf('付言') !== -1);
});

test('fixture 全 6 項目の主要フィールド（10.1〜10.3 の期待表）', (t) => {
  if (!fs.existsSync(FIXTURE)) { t.skip('fixtures なし'); return; }
  const { body, matchBody } = normalizer.removeNonReasonSections(fs.readFileSync(FIXTURE, 'utf8'));
  const { sections } = splitter.splitReasonSections(body, matchBody);
  const items = [];
  for (const s of sections) {
    const { blocks } = splitter.splitIssueBlocks(s);
    blocks.forEach((b, i) => items.push(cs.parseIssueBlock(b, {
      reasonNumber: s.reasonNumber, category: null, categoryLabel: null, itemNumber: i + 1,
    })));
  }
  assert.equal(items.length, 6);

  // 10.1 明確性・第1項目
  const r1i1 = items[0];
  assert.deepEqual(r1i1.headingClaims, [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(r1i1.directClaims, [2]);
  assert.deepEqual(r1i1.citedParentClaims, [1]);
  assert.deepEqual(r1i1.sameIssueClaims, [3, 4]);
  assert.deepEqual(r1i1.dependencyRelations.map((d) => [d.parentClaims, d.affectedClaims]), [[[2, 4], [5, 6, 7]]]);
  assert.deepEqual(r1i1.finalClaims, [2, 3, 4, 5, 6, 7]);
  assert.equal(r1i1.problematicPhrases[0].role, 'problem');
  assert.equal(r1i1.problematicPhrases[0].text, '前記所定の接続を介して前記設定情報を前記通信装置に送信するための第2接続設定処理');
  assert.equal(r1i1.problematicPhrases[1].role, 'comparison');
  assert.equal(r1i1.problematicPhrases[1].text, '前記情報処理装置の外部のアクセスポイントと接続するための設定情報を、前記所定の接続を介して、前記通信装置に送信する第1送信ステップ');

  // 10.2 明確性・第2項目（結論はサポート要件表現）
  const r1i2 = items[1];
  assert.deepEqual(r1i2.directClaims, [19]);
  assert.deepEqual(r1i2.sameIssueClaims, [20]);
  assert.deepEqual(r1i2.dependencyRelations, []);
  assert.deepEqual(r1i2.finalClaims, [19, 20]);
  assert.equal(r1i2.conclusionCategory, 'support');

  // 10.3 サポート要件・修正注記（items[3] = 理由2の第2項目）
  const r2i2 = items[3];
  assert.equal(r2i2.headingClaimsRaw, '３-５、１９-２０');
  assert.deepEqual(r2i2.headingClaims, [3, 4, 5, 19, 20]);
  assert.deepEqual(r2i2.effectiveHeadingClaims, [3, 4, 19, 20]);
  assert.deepEqual(r2i2.directClaims, [3]);
  assert.deepEqual(r2i2.sameIssueClaims, [4, 19, 20]);
  assert.deepEqual(r2i2.dependencyRelations.map((d) => [d.parentClaims, d.affectedClaims]), [[[4], [5]]]);
  assert.deepEqual(r2i2.finalClaims, [3, 4, 5, 19, 20]);

  // 全項目で未解析文ゼロ（このサンプルは全文が既知パターン）
  for (const it of items) assert.equal(it.unmatchedSentences.length, 0);
});
