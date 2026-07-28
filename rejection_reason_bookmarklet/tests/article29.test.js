'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const normalizer = require('../src/core/normalizer');
const splitter = require('../src/core/splitter');
const article29 = require('../src/core/article29');
const examples = require('../examples/examples-article29');

const ROOT = path.join(__dirname, '..');

// normalizer → parseReferenceList → splitReasonSections → classifyReason →
// parseArticle29Section の一連（analyzer.js と同じ順序）を再現するテスト用ハーネス
function runPipeline(text) {
  const { body, matchBody, removedNote } = normalizer.removeNonReasonSections(text);
  const references = article29.parseReferenceList(matchBody, body);
  const leadingList = splitter.parseLeadingReasonList(matchBody, body);
  const { sections } = splitter.splitReasonSections(body, matchBody);
  const mappings = [];
  const unparsed = [];
  const warnings = [];
  const contexts = [];
  for (const section of sections) {
    const classified = splitter.classifyReason(section, leadingList);
    const context = {
      reasonNumber: section.reasonNumber,
      category: classified.category,
      categoryLabel: classified.categoryLabel,
      legalBasis: classified.legalBasis,
    };
    contexts.push(context);
    const parsed = article29.parseArticle29Section(section, context, references);
    for (const m of parsed.mappings) mappings.push(m);
    for (const u of parsed.unparsed) unparsed.push(u);
    for (const w of parsed.warnings) warnings.push(w);
  }
  return { body, matchBody, removedNote, references, leadingList, sections, contexts, mappings, unparsed, warnings };
}

const codes = (list) => list.map((w) => w.code);

// ---------- 合成ゴールデンケース（examples-article29.js） ----------

test('removeNonReasonSections: ＜引用文献等一覧＞は残り、罫線以降の調査結果の記録は除去される', () => {
  const { body, removedNote } = normalizer.removeNonReasonSections(examples.text);
  assert.ok(body.includes(examples.expected.survivingText), '引用文献等一覧が除去されている');
  assert.equal(body.includes(examples.expected.removedText), false, '調査結果の記録が残っている');
  assert.equal(removedNote, examples.expected.removedNote);
  // 一覧の 3 件目まで本文に残っていること
  assert.ok(body.includes('３．米国特許出願公開第２０１８／０１２３４５６号明細書'));
});

test('冒頭の理由一覧: 新規性(29条1項3号)・進歩性(29条2項)として解釈される', () => {
  const { leadingList } = runPipeline(examples.text);
  assert.equal(leadingList.length, examples.expected.leadingList.length);
  leadingList.forEach((item, i) => {
    const want = examples.expected.leadingList[i];
    assert.equal(item.num, want.num);
    assert.equal(item.label, want.label);
    assert.equal(item.category, want.category);
    assert.equal(item.legalBasis, want.legalBasis);
  });
});

test('parseReferenceList: ＜引用文献等一覧＞形式の 3 件を原文どおりの名称で取得する', () => {
  const { references } = runPipeline(examples.text);
  assert.equal(references.length, examples.expected.references.length);
  references.forEach((ref, i) => {
    const want = examples.expected.references[i];
    assert.equal(ref.number, want.number);
    assert.equal(ref.name, want.name);
    assert.equal(ref.raw, want.raw);
  });
});

test('parseArticle29Section: 合成サンプルの請求項×引用文献の対応が期待どおり', () => {
  const { mappings, references, unparsed, warnings } = runPipeline(examples.text);
  assert.equal(mappings.length, examples.expected.mappings.length);
  mappings.forEach((mapping, i) => {
    const want = examples.expected.mappings[i];
    const tag = 'mapping[' + i + ']';
    assert.equal(mapping.reasonNumber, want.reasonNumber, tag + ' reasonNumber');
    assert.equal(mapping.subCategory, want.subCategory, tag + ' subCategory');
    assert.equal(mapping.subCategoryLabel, want.subCategoryLabel, tag + ' subCategoryLabel');
    assert.deepEqual(mapping.claims, want.claims, tag + ' claims');
    assert.equal(mapping.claimsRaw, want.claimsRaw, tag + ' claimsRaw');
    assert.deepEqual(mapping.referenceNumbers, want.referenceNumbers, tag + ' referenceNumbers');
    assert.equal(mapping.referenceNumbersRaw, want.referenceNumbersRaw, tag + ' referenceNumbersRaw');
    assert.deepEqual(mapping.referenceNames, want.referenceNames, tag + ' referenceNames');
    assert.equal(mapping.application, want.application, tag + ' application');
    assert.equal(mapping.confidence, want.confidence, tag + ' confidence');
    assert.ok(mapping.remarks && mapping.remarks.length > 0, tag + ' remarks が空');
    assert.ok(mapping.remarks.includes(want.remarksIncludes), tag + ' remarks⊇' + want.remarksIncludes);
    assert.ok(mapping.sourceText.startsWith('・請求項'), tag + ' sourceText は見出し行から始まる');
    assert.deepEqual(mapping.warnings, [], tag + ' 警告なし');
  });
  assert.deepEqual(references.map((r) => r.matched), [true, true, true], '全文献が対応付け済み');
  assert.deepEqual(unparsed, [], '未解析テキストなし');
  assert.deepEqual(warnings, [], 'セクション警告なし');
});

test('備考内の段落番号（００１５－００２３）は請求項番号として解釈されない', () => {
  const { mappings } = runPipeline(examples.text);
  assert.deepEqual(mappings[0].claims, [1, 8]);
  assert.ok(mappings[0].remarks.includes('（段落００１５－００２３、図３）'));
  // 段落番号の 15-23 が請求項側へ混入していないこと
  for (const n of [15, 16, 23, 31]) {
    assert.equal(mappings[0].claims.includes(n), false, '請求項' + n + 'が混入');
  }
});

// ---------- 引用文献一覧の表記バリエーション ----------

test('parseReferenceList: インライン形式（引用文献１：…）に対応する', () => {
  const text = [
    '●理由１（新規性）について',
    '',
    '引用文献１：特開２０２０－１２３４５６号公報',
    '引用文献２：特開２０１９－６５４３２１号公報',
    '',
    '・請求項 １',
    '・引用文献等 １',
    '・備考',
    '　引用文献１には、当該構成が記載されている。',
    '',
  ].join('\n');
  const { references, mappings, unparsed } = runPipeline(text);
  assert.deepEqual(references.map((r) => r.number), [1, 2]);
  assert.equal(references[0].name, '特開２０２０－１２３４５６号公報');
  assert.equal(references[0].raw, '引用文献１：特開２０２０－１２３４５６号公報');
  assert.deepEqual(mappings[0].referenceNames, ['特開２０２０－１２３４５６号公報']);
  assert.equal(mappings[0].application, '単独引用');
  assert.deepEqual(unparsed, [], 'インライン一覧は未解析扱いにしない');
});

test('parseReferenceList: 字間に空白のある見出し（引　用　文　献　等　一　覧）に対応する', () => {
  const text = [
    '　　　　＜引　用　文　献　等　一　覧＞',
    '１．特開２０２０－１２３４５６号公報',
    '２．特開２０１９－６５４３２１号公報',
    '',
  ].join('\n');
  const match = normalizer.normalizeForMatching(text);
  const references = article29.parseReferenceList(match, text);
  assert.deepEqual(references.map((r) => r.number), [1, 2]);
  assert.equal(references[1].name, '特開２０１９－６５４３２１号公報');
});

test('parseReferenceList: 括弧・「等」なしの見出し（引用文献一覧）と重複番号の先着優先', () => {
  const text = [
    '引用文献一覧',
    '１．特開２０２０－１２３４５６号公報',
    '１．特開２０１９－６５４３２１号公報',
    '２．米国特許出願公開第２０１８／０１２３４５６号明細書',
    '',
  ].join('\n');
  const match = normalizer.normalizeForMatching(text);
  const references = article29.parseReferenceList(match, text);
  assert.deepEqual(references.map((r) => r.number), [1, 2]);
  assert.equal(references[0].name, '特開２０２０－１２３４５６号公報', '重複番号は先に現れた方を採る');
});

test('parseReferenceList: 一覧は空行・罫線で終端する', () => {
  const text = [
    '＜引用文献等一覧＞',
    '１．特開２０２０－１２３４５６号公報',
    '',
    '２．これは一覧の外の行なので採らない',
    '－－－－－－－－－－－－－－－－',
    '',
  ].join('\n');
  const match = normalizer.normalizeForMatching(text);
  const references = article29.parseReferenceList(match, text);
  assert.deepEqual(references.map((r) => r.number), [1]);
});

// ---------- 対応付けできない引用番号・引用文献行の欠落 ----------

test('一覧に無い引用番号は REFERENCE_UNRESOLVED 警告付きで番号のみ保持する', () => {
  const text = [
    '●理由２（進歩性）について',
    '',
    '・請求項 ９',
    '・引用文献等 ４',
    '・備考',
    '　引用文献４には、当該構成が記載されている。',
    '',
    '　　　　　　　　＜引用文献等一覧＞',
    '１．特開２０２０－１２３４５６号公報',
    '',
  ].join('\n');
  const { mappings, unparsed } = runPipeline(text);
  assert.equal(mappings.length, 1);
  const mapping = mappings[0];
  assert.deepEqual(mapping.claims, [9]);
  assert.deepEqual(mapping.referenceNumbers, [4]);
  assert.deepEqual(mapping.referenceNames, [null]);
  assert.equal(mapping.application, '単独引用');
  assert.deepEqual(codes(mapping.warnings), ['REFERENCE_UNRESOLVED']);
  assert.equal(mapping.warnings[0].message, '引用文献4が引用文献一覧に見つかりません。番号のみ表示します。');
  assert.equal(mapping.warnings[0].severity, 'warn');
  assert.equal(mapping.confidence, 'medium');
  assert.deepEqual(unparsed, []);
});

test('引用文献等の行が無いブロックも MAPPING を出し、対応関係が不明な旨を警告する', () => {
  const text = [
    '●理由１（新規性）について',
    '',
    '・請求項 ３',
    '・備考',
    '　引用文献の記載が欠けている例。',
    '',
  ].join('\n');
  const { mappings } = runPipeline(text);
  assert.equal(mappings.length, 1);
  const mapping = mappings[0];
  assert.deepEqual(mapping.claims, [3]);
  assert.deepEqual(mapping.referenceNumbers, []);
  assert.deepEqual(mapping.referenceNames, []);
  assert.equal(mapping.referenceNumbersRaw, null);
  assert.equal(mapping.application, null);
  assert.deepEqual(codes(mapping.warnings), ['MAPPING_REFERENCE_MISSING']);
  assert.ok(mapping.warnings[0].message.includes('対応関係が不明確'));
  assert.equal(mapping.confidence, 'medium');
});

test('請求項見出しを解釈できないブロックは confidence low', () => {
  const section = {
    reasonNumber: 1,
    headingLabel: '新規性',
    headingRaw: null,
    rawText: '・請求項について\n・引用文献等 １\n',
    matchText: '・請求項について\n・引用文献等 １\n',
  };
  const sectionMatch = normalizer.normalizeForMatching(section.rawText);
  const parsed = article29.parseArticle29Section(
    { ...section, matchText: sectionMatch },
    { reasonNumber: 1, category: 'novelty', categoryLabel: '新規性', legalBasis: null },
    []
  );
  assert.equal(parsed.mappings.length, 1);
  assert.equal(parsed.mappings[0].confidence, 'low');
  assert.deepEqual(parsed.mappings[0].claims, []);
});

test('指摘項目を検出できない 29条系セクションは NO_ISSUE_BLOCKS を警告する', () => {
  const rawText = '●理由１（新規性）について\n\n引用文献の検討結果は次のとおりである。\n';
  const parsed = article29.parseArticle29Section(
    {
      reasonNumber: 1,
      headingLabel: '新規性',
      headingRaw: '●理由１（新規性）について',
      rawText,
      matchText: normalizer.normalizeForMatching(rawText),
    },
    { reasonNumber: 1, category: 'novelty', categoryLabel: '新規性', legalBasis: null },
    []
  );
  assert.deepEqual(parsed.mappings, []);
  assert.deepEqual(codes(parsed.warnings), ['NO_ISSUE_BLOCKS']);
  assert.equal(parsed.unparsed.length, 1);
  assert.ok(parsed.unparsed[0].text.includes('引用文献の検討結果'));
});

// ---------- 適用関係の判定 ----------

test('適用関係: 単独引用 / 組合せ / 備考に「周知」があれば周知技術', () => {
  const { mappings } = runPipeline(examples.text);
  assert.deepEqual(mappings.map((m) => m.application), ['単独引用', '組合せ', '周知技術']);
});

// ---------- detectSubCategory ----------

test('detectSubCategory: 理由の区分から新規性・進歩性を決める', () => {
  assert.deepEqual(
    article29.detectSubCategory({ category: 'novelty' }, ''),
    { subCategory: 'novelty', subCategoryLabel: '新規性' }
  );
  assert.deepEqual(
    article29.detectSubCategory({ category: 'inventiveStep' }, ''),
    { subCategory: 'inventiveStep', subCategoryLabel: '進歩性' }
  );
});

test('detectSubCategory: 法条（29条1項/2項）から決める（全角表記も可）', () => {
  assert.equal(
    article29.detectSubCategory({ category: 'other', legalBasis: '特許法第29条第1項第3号' }, '').subCategory,
    'novelty'
  );
  assert.equal(
    article29.detectSubCategory({ category: 'other', legalBasis: '特許法第２９条第２項' }, '').subCategory,
    'inventiveStep'
  );
  assert.equal(
    article29.detectSubCategory({ category: 'other' }, 'この出願は特許法第29条第2項の規定により…').subCategory,
    'inventiveStep'
  );
});

test('detectSubCategory: 区分不明は article29-unknown', () => {
  assert.deepEqual(
    article29.detectSubCategory({ category: 'other', legalBasis: null }, '引用文献の記載について'),
    { subCategory: 'article29-unknown', subCategoryLabel: '29条系（区分不明）' }
  );
  // 29条の2（拡大先願）は新規性・進歩性のいずれでもない
  assert.equal(
    article29.detectSubCategory({ category: 'other', legalBasis: '特許法第29条の2' }, '').subCategory,
    'article29-unknown'
  );
});

// ---------- 36条系サンプル（fixtures）で壊れないこと ----------

test('36条系の拒絶理由例でも例外を出さず、引用文献一覧は 0 件になる', (t) => {
  const fixture = path.join(ROOT, '..', 'fixtures', 'rejection-reason', '拒絶理由例.txt');
  if (!fs.existsSync(fixture)) {
    t.skip('fixtures が見つからないため skip（プロジェクト単独コピー環境）');
    return;
  }
  const text = fs.readFileSync(fixture, 'utf8');
  const { body, matchBody } = normalizer.removeNonReasonSections(text);
  assert.deepEqual(article29.parseReferenceList(matchBody, body), []);
  // 29条系ではないセクションへ適用しても throw せず、確度が付く（analyzer は呼ばない経路）
  const { sections } = splitter.splitReasonSections(body, matchBody);
  for (const section of sections) {
    const parsed = article29.parseArticle29Section(section, { category: 'other' }, []);
    for (const mapping of parsed.mappings) {
      assert.ok(['high', 'medium', 'low'].includes(mapping.confidence));
      assert.equal(mapping.subCategory, 'article29-unknown');
    }
  }
});
