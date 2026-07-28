'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const validator = require('../src/core/validator');

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const codes = (list) => list.map((w) => w.code);
const find = (list, code) => list.find((w) => w.code === code) || null;

// ITEM は clarity-support が作るが、本テストでは検証に必要な項目のみを手組みする。
// 既定値は「警告なしで high になる」状態。
function item(fields) {
  return Object.assign({
    itemNumber: 1,
    headingClaimsRaw: '２',
    headingClaims: [2],
    effectiveHeadingClaims: [2],
    correctionNote: null,
    directClaims: [2],
    citedParentClaims: [1],
    sameIssueClaims: [],
    dependencyRelations: [],
    finalClaims: [2],
    finalClaimsRaw: '２',
    finalClaimsSource: 'conclusion',
    problematicPhrases: [],
    specStatements: [],
    unmatchedSentences: [],
    issueSummary: '請求項2の記載が不明確。',
    summaryReliable: true,
    conclusionText: 'よって、請求項２に係る発明は明確でない。',
    conclusionCategory: 'clarity',
    sourceText: '・請求項 ２\n　…',
    confidence: null,
    warnings: [],
  }, fields);
}

const CLARITY = { reasonNumber: 1, category: 'clarity', categoryLabel: '明確性', legalBasis: '特許法第36条第6項第2号' };
const SUPPORT = { reasonNumber: 2, category: 'support', categoryLabel: 'サポート要件', legalBasis: '特許法第36条第6項第1号' };
const NOVELTY = { reasonNumber: 3, category: 'novelty', categoryLabel: '新規性', legalBasis: '特許法第29条第1項第3号' };

// ---------- HEADING_CONCLUSION_MISMATCH ----------

test('HEADING_CONCLUSION_MISMATCH: 明確性の見出し × サポート要件の結論文', () => {
  const result = validator.validateParsedItem(item({
    conclusionCategory: 'support',
    conclusionText: 'よって、請求項１９-２０に係る発明は、発明の詳細な説明に記載したものでない。',
  }), CLARITY);
  const warning = find(result.warnings, 'HEADING_CONCLUSION_MISMATCH');
  assert.ok(warning, '警告が付いていない: ' + JSON.stringify(codes(result.warnings)));
  assert.equal(
    warning.message,
    '理由見出しは「明確性」ですが、結論文はサポート要件に対応する表現です。原文を確認してください。'
  );
  assert.equal(warning.severity, 'warn');
});

test('HEADING_CONCLUSION_MISMATCH: 29条系の結論文表現は「新規性・進歩性等（29条）」と表示する', () => {
  const result = validator.validateParsedItem(item({ conclusionCategory: 'article29' }), CLARITY);
  assert.equal(
    find(result.warnings, 'HEADING_CONCLUSION_MISMATCH').message,
    '理由見出しは「明確性」ですが、結論文は新規性・進歩性等（29条）に対応する表現です。原文を確認してください。'
  );
});

test('HEADING_CONCLUSION_MISMATCH: 新規性・進歩性はどちらも 29条系として一致扱い', () => {
  const novelty = validator.validateParsedItem(item({ conclusionCategory: 'article29' }), NOVELTY);
  assert.equal(find(novelty.warnings, 'HEADING_CONCLUSION_MISMATCH'), null);
  const inventive = validator.validateParsedItem(
    item({ conclusionCategory: 'article29' }),
    { reasonNumber: 4, category: 'inventiveStep', categoryLabel: '進歩性' }
  );
  assert.equal(find(inventive.warnings, 'HEADING_CONCLUSION_MISMATCH'), null);
});

test('HEADING_CONCLUSION_MISMATCH: unknown / null の結論区分では警告しない', () => {
  assert.equal(find(validator.validateParsedItem(item({ conclusionCategory: 'unknown' }), CLARITY).warnings,
    'HEADING_CONCLUSION_MISMATCH'), null);
  assert.equal(find(validator.validateParsedItem(item({ conclusionCategory: null }), CLARITY).warnings,
    'HEADING_CONCLUSION_MISMATCH'), null);
  // 区分が other の理由は照合対象にしない
  assert.equal(find(validator.validateParsedItem(item({ conclusionCategory: 'support' }),
    { category: 'other', categoryLabel: 'その他' }).warnings, 'HEADING_CONCLUSION_MISMATCH'), null);
});

// ---------- CORRECTION_NOTE_CONFLICT ----------

test('CORRECTION_NOTE_CONFLICT: 除外した請求項5が引用による指摘・結論文に再出現（拒絶理由例の形）', () => {
  const result = validator.validateParsedItem(item({
    headingClaimsRaw: '３-５、１９-２０',
    headingClaims: [3, 4, 5, 19, 20],
    effectiveHeadingClaims: [3, 4, 19, 20],
    correctionNote: { raw: '修正：５を除く', excluded: [5], added: [], recognized: true },
    directClaims: [3],
    sameIssueClaims: [4, 19, 20],
    dependencyRelations: [{ parentClaims: [4], affectedClaims: [5], raw: '請求項４を引用する請求項５にも同様の点が指摘される。' }],
    finalClaims: [3, 4, 5, 19, 20],
    finalClaimsRaw: '３-５、１９-２０',
    conclusionCategory: 'support',
    conclusionText: 'よって、請求項３-５、１９-２０に係る発明は、発明の詳細な説明に記載したものでない。',
  }), SUPPORT);
  const warning = find(result.warnings, 'CORRECTION_NOTE_CONFLICT');
  assert.ok(warning, '警告が付いていない: ' + JSON.stringify(codes(result.warnings)));
  assert.equal(
    warning.message,
    '見出しの修正注記では請求項5が除外されていますが、本文又は結論文には請求項5が含まれています。'
  );
  assert.ok(warning.message.includes('請求項5'));
});

test('CORRECTION_NOTE_CONFLICT: 複数除外は圧縮表記（3-4）で報告する', () => {
  const result = validator.validateParsedItem(item({
    correctionNote: { raw: '修正：３-４を除く', excluded: [3, 4], added: [], recognized: true },
    directClaims: [2],
    sameIssueClaims: [3, 4],
    finalClaims: [2, 3, 4],
  }), CLARITY);
  assert.equal(
    find(result.warnings, 'CORRECTION_NOTE_CONFLICT').message,
    '見出しの修正注記では請求項3-4が除外されていますが、本文又は結論文には請求項3-4が含まれています。'
  );
});

test('CORRECTION_NOTE_CONFLICT: 除外請求項が本文・結論文に現れなければ警告しない', () => {
  const result = validator.validateParsedItem(item({
    correctionNote: { raw: '修正：５を除く', excluded: [5], added: [], recognized: true },
    directClaims: [3],
    sameIssueClaims: [4],
    finalClaims: [3, 4],
    finalClaimsRaw: '３-４',
    conclusionCategory: 'support',
    conclusionText: 'よって、請求項３-４に係る発明は、発明の詳細な説明に記載したものでない。',
  }), SUPPORT);
  assert.equal(find(result.warnings, 'CORRECTION_NOTE_CONFLICT'), null);
  assert.equal(result.confidence, 'high');
});

// ---------- NO_FINAL_CLAIMS / NO_CONCLUSION / UNPARSED_TEXT ----------

test('NO_FINAL_CLAIMS: finalClaimsSource が headingFallback のとき警告する', () => {
  const result = validator.validateParsedItem(item({
    finalClaimsSource: 'headingFallback',
    finalClaimsRaw: null,
  }), CLARITY);
  const warning = find(result.warnings, 'NO_FINAL_CLAIMS');
  assert.ok(warning);
  assert.equal(
    warning.message,
    '結論文から請求項番号を抽出できなかったため、見出し請求項を暫定値として使用しています。'
  );
  assert.equal(result.confidence, 'medium');
});

test('NO_FINAL_CLAIMS: finalClaimsSource が無い旧形でも finalClaimsRaw==null から判定する', () => {
  const result = validator.validateParsedItem(item({
    finalClaimsSource: undefined,
    finalClaimsRaw: null,
    finalClaims: [2, 3],
  }), CLARITY);
  assert.ok(find(result.warnings, 'NO_FINAL_CLAIMS'));
});

test('NO_CONCLUSION: 結論文を特定できない項目は警告され low になる', () => {
  const result = validator.validateParsedItem(item({
    conclusionText: null,
    conclusionCategory: null,
    finalClaimsSource: 'headingFallback',
    finalClaimsRaw: null,
  }), CLARITY);
  assert.ok(find(result.warnings, 'NO_CONCLUSION'));
  assert.equal(result.confidence, 'low');
});

test('UNPARSED_TEXT: 解析できなかった文の件数を info で報告する', () => {
  const result = validator.validateParsedItem(item({
    unmatchedSentences: ['なお、当該記載については補正を検討されたい。', '追加の説明文。'],
  }), CLARITY);
  const warning = find(result.warnings, 'UNPARSED_TEXT');
  assert.ok(warning);
  assert.equal(warning.message, '解析できなかった文が2件あります。原文を確認してください。');
  assert.equal(warning.severity, 'info');
  assert.equal(result.confidence, 'high', 'info の警告は確度を下げない');
});

// ---------- confidence の境界 ----------

test('confidence high: 直接指摘・結論文あり／結論文由来の最終指摘／warn 警告なし', () => {
  const result = validator.validateParsedItem(item({}), CLARITY);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.confidence, 'high');
});

test('confidence medium: 要約の確度が低いだけ／warn 警告 1 件だけ', () => {
  assert.equal(validator.validateParsedItem(item({ summaryReliable: false }), CLARITY).confidence, 'medium');
  assert.equal(validator.validateParsedItem(item({ conclusionCategory: 'support' }), CLARITY).confidence, 'medium');
});

test('confidence low: 直接指摘なし／結論文なし／warn 警告 3 件以上', () => {
  assert.equal(validator.validateParsedItem(item({ directClaims: [] }), CLARITY).confidence, 'low');
  assert.equal(validator.validateParsedItem(item({ conclusionText: null }), CLARITY).confidence, 'low');
  const threeWarnings = validator.validateParsedItem(item({
    conclusionCategory: 'support',   // HEADING_CONCLUSION_MISMATCH で 1 件
    warnings: [
      { code: 'CLAIM_PARSE_UNCERTAIN', message: '範囲指定を解釈できません', severity: 'warn' },
      { code: 'UNKNOWN_HEADING_NOTE', message: '注記を解釈できません', severity: 'warn' },
    ],
  }), CLARITY);
  assert.equal(threeWarnings.warnings.length, 3);
  assert.equal(threeWarnings.confidence, 'low');
});

test('validateParsedItem: 既存の警告を消さず、二重適用でも重複させない', () => {
  const target = item({
    conclusionCategory: 'support',
    warnings: [{ code: 'CLAIM_PARSE_UNCERTAIN', message: '既存の警告', severity: 'info' }],
  });
  const first = validator.validateParsedItem(target, CLARITY);
  assert.equal(first, target, '同じオブジェクトを返す');
  assert.equal(find(first.warnings, 'CLAIM_PARSE_UNCERTAIN').message, '既存の警告');
  const second = validator.validateParsedItem(first, CLARITY);
  assert.deepEqual(codes(second.warnings), ['CLAIM_PARSE_UNCERTAIN', 'HEADING_CONCLUSION_MISMATCH']);
});

// ---------- computeClaimStats ----------

function sampleResult() {
  return {
    metadata: {},
    reasons: [
      {
        reasonNumber: 1,
        category: 'clarity',
        items: [
          {
            headingClaims: [2, 3, 4, 5, 6, 7],
            effectiveHeadingClaims: [2, 3, 4, 5, 6, 7],
            directClaims: [2],
            citedParentClaims: [1],
            sameIssueClaims: [3, 4],
            dependencyRelations: [{ parentClaims: [2, 4], affectedClaims: [5, 6, 7] }],
            finalClaims: [2, 3, 4, 5, 6, 7],
          },
          { directClaims: [19], sameIssueClaims: [20], finalClaims: [19, 20] },
        ],
      },
      {
        reasonNumber: 2,
        category: 'support',
        items: [{ directClaims: [2], finalClaims: [2] }],
      },
    ],
    noveltyInventiveStep: {
      references: [],
      mappings: [
        { subCategory: 'novelty', claims: [1, 8] },
        { subCategory: 'inventiveStep', claims: [9] },
      ],
    },
    unparsedSections: [],
  };
}

test('computeClaimStats: カテゴリ別の和集合と未指摘請求項', () => {
  const stats = validator.computeClaimStats(sampleResult());
  assert.deepEqual(stats.byCategory.clarity, [2, 3, 4, 5, 6, 7, 19, 20]);
  assert.deepEqual(stats.byCategory.support, [2]);
  assert.deepEqual(stats.byCategory.novelty, [1, 8]);
  assert.deepEqual(stats.byCategory.inventiveStep, [9]);
  assert.deepEqual(stats.byCategory.other, []);
  assert.deepEqual(stats.allFinalClaims, [1, 2, 3, 4, 5, 6, 7, 8, 9, 19, 20]);
  assert.equal(stats.maxClaimNumber, 20);
  assert.equal(stats.totalClaimCount, 20);
  assert.deepEqual(stats.unflaggedClaims, range(10, 18));
});

test('computeClaimStats: 全請求項数の上書き（25）で 21-25 が未指摘に加わる', () => {
  const stats = validator.computeClaimStats(sampleResult(), 25);
  assert.equal(stats.maxClaimNumber, 20, '本文からの推定値は変わらない');
  assert.equal(stats.totalClaimCount, 25);
  assert.deepEqual(stats.unflaggedClaims, range(10, 18).concat(range(21, 25)));
  for (const n of stats.allFinalClaims) {
    assert.equal(stats.unflaggedClaims.includes(n), false, '請求項' + n + 'は指摘済み');
  }
});

test('computeClaimStats: allMentionedClaims は本文の全参照から補完される', () => {
  const result = {
    reasons: [{
      reasonNumber: 1,
      category: 'clarity',
      items: [{
        headingClaims: [2],
        citedParentClaims: [1],
        directClaims: [],
        sameIssueClaims: [],
        dependencyRelations: [{ parentClaims: [2, 4], affectedClaims: [5, 6, 7] }],
        finalClaims: [],
      }],
    }],
    noveltyInventiveStep: { references: [], mappings: [] },
  };
  const stats = validator.computeClaimStats(result);
  assert.deepEqual(stats.allMentionedClaims, [1, 2, 4, 5, 6, 7]);
  assert.deepEqual(stats.allFinalClaims, []);
  assert.equal(stats.maxClaimNumber, 7);
  assert.deepEqual(stats.unflaggedClaims, range(1, 7));
});

test('computeClaimStats: allMentionedClaims は第3引数 > metadata の既存値 の順で採用する', () => {
  const result = sampleResult();
  result.metadata = { claimStats: { allMentionedClaims: [1, 2, 30] } };
  const fromMetadata = validator.computeClaimStats(result);
  assert.deepEqual(fromMetadata.allMentionedClaims, [1, 2, 30]);
  assert.equal(fromMetadata.maxClaimNumber, 30);
  const fromArgument = validator.computeClaimStats(result, null, [3, 3, 1, 40]);
  assert.deepEqual(fromArgument.allMentionedClaims, [1, 3, 40], '昇順・重複排除');
  assert.equal(fromArgument.maxClaimNumber, 40);
});

test('computeClaimStats: reason.article29 のみを持つ結果でも集計でき、区分不明は other へ入る', () => {
  const result = {
    reasons: [{
      reasonNumber: 3,
      category: 'novelty',
      items: [],
      article29: {
        references: [],
        mappings: [
          { subCategory: 'novelty', claims: [1, 8] },
          { subCategory: 'article29-unknown', claims: [10] },
        ],
      },
    }],
  };
  const stats = validator.computeClaimStats(result);
  assert.deepEqual(stats.byCategory.novelty, [1, 8]);
  assert.deepEqual(stats.byCategory.other, [10]);
  assert.deepEqual(stats.allFinalClaims, [1, 8, 10]);
  assert.deepEqual(stats.unflaggedClaims, [2, 3, 4, 5, 6, 7, 9]);
});

test('computeClaimStats: 空の結果でも例外を出さない', () => {
  const stats = validator.computeClaimStats({ reasons: [], noveltyInventiveStep: { references: [], mappings: [] } });
  assert.equal(stats.maxClaimNumber, 0);
  assert.equal(stats.totalClaimCount, 0);
  assert.deepEqual(stats.allFinalClaims, []);
  assert.deepEqual(stats.allMentionedClaims, []);
  assert.deepEqual(stats.unflaggedClaims, []);
  assert.deepEqual(stats.byCategory, { clarity: [], support: [], novelty: [], inventiveStep: [], other: [] });
  assert.deepEqual(validator.computeClaimStats(null).unflaggedClaims, []);
});
