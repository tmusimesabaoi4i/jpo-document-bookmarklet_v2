'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reportTemplate = require('../src/bookmarklet/common/report-template');

// ---------------------------------------------------------------------
// モック RESULT（仕様書のスキーマに厳密に従う手書きデータ）
//   - 理由1: 明確性。項目2件（うち1件は修正注記あり／もう1件は要約の確度が低い）
//   - 理由2: 新規性（29条系）。引用文献2件（うち1件は未対応）／マッピング2件（新規性・進歩性）
//   - XSS 対策確認用に <script>alert(1)</script> を issueSummary に含める
//   - CSV クオーティング確認用に "quotes", commas を issueSummary に含める
// ---------------------------------------------------------------------

const item1 = {
  itemNumber: 1,
  headingClaimsRaw: '２-７',
  headingClaims: [2, 3, 4, 5, 6, 7],
  effectiveHeadingClaims: [2, 3, 4, 6, 7],
  correctionNote: { raw: '（修正：５を除く）', excluded: [5] },
  directClaims: [2],
  citedParentClaims: [1],
  sameIssueClaims: [3, 4],
  dependencyRelations: [
    { parentClaims: [2, 4], affectedClaims: [6, 7], raw: '請求項２、４を引用する請求項６-７にも同様の点が指摘される。' },
  ],
  finalClaims: [2, 3, 4, 6, 7],
  finalClaimsRaw: '２-４、６-７',
  problematicPhrases: [
    { text: '第1送信ステップと第2接続設定処理の関係', claimNumbers: [2], role: 'problem', roleLabel: '問題となる記載' },
    { text: '比較対象の記載<script>alert(1)</script>', claimNumbers: [1], role: 'comparison', roleLabel: '比較対象の記載' },
  ],
  issueSummary: '請求項2の関係が不明確<script>alert(1)</script>。',
  summaryReliable: true,
  conclusionText: 'よって、請求項２-４、６-７に係る発明は明確でない。',
  conclusionCategory: 'clarity',
  sourceText: '・請求項 ２-７\n　請求項１を引用する請求項２には…が記載されている。\n　よって、請求項２-４、６-７に係る発明は明確でない。',
  specStatements: [],
  clarityCoreSentence: null,
  firstBodySentence: '請求項１を引用する請求項２には…。',
  unmatchedSentences: ['謎の一文が残った。'],
  confidence: 'medium',
  warnings: [
    { code: 'CORRECTION_NOTE_CONFLICT', message: '修正注記で除外した請求項5が結論文に再出現しています。', severity: 'error' },
  ],
};

const item2 = {
  itemNumber: 2,
  headingClaimsRaw: '１９-２０',
  headingClaims: [19, 20],
  effectiveHeadingClaims: [19, 20],
  correctionNote: null,
  directClaims: [19],
  citedParentClaims: [1],
  sameIssueClaims: [20],
  dependencyRelations: [],
  finalClaims: [19, 20],
  finalClaimsRaw: '１９-２０',
  problematicPhrases: [
    { text: '設定情報を通信装置に送信する処理', claimNumbers: [19], role: 'problem', roleLabel: '問題となる記載' },
  ],
  issueSummary: '"quotes", commas を含む要約文。',
  summaryReliable: false,
  conclusionText: 'よって、請求項１９-２０に係る発明は、発明の詳細な説明に記載したものでない。',
  conclusionCategory: 'clarity',
  sourceText: '・請求項 １９-２０\n　請求項１を引用する請求項１９には…ないことが記載されている。',
  specStatements: [],
  clarityCoreSentence: 'してみると、発明特定事項同士の関係が整合しておらず、請求項１９に係る発明は不明確である。',
  firstBodySentence: '請求項１を引用する請求項１９には…。',
  unmatchedSentences: [],
  confidence: 'low',
  warnings: [
    { code: 'NO_FINAL_CLAIMS', message: '結論文から請求項番号を抽出できず見出しを暫定使用しました。', severity: 'warn' },
  ],
};

const reason1 = {
  reasonNumber: 1,
  category: 'clarity',
  categoryLabel: '明確性',
  legalBasis: '特許法第36条第6項第2号',
  headingRaw: '●理由１（明確性）について',
  confidence: 'high',
  warnings: [
    { code: 'HEADING_CONCLUSION_MISMATCH', message: '理由見出しは「明確性」ですが、結論文はサポート要件に対応する表現です。', severity: 'warn' },
  ],
  items: [item1, item2],
  article29: null,
};

const reference1 = { number: 1, name: '特開2000-000001号公報', raw: '引用文献１：特開2000-000001号公報', matched: true };
const reference2 = { number: 2, name: '特開2000-000002号公報', raw: '引用文献２：特開2000-000002号公報', matched: false };

const mapping1 = {
  reasonNumber: 2,
  subCategory: 'novelty',
  subCategoryLabel: '新規性',
  claims: [1, 2],
  claimsRaw: '１-２',
  referenceNumbers: [1],
  referenceNumbersRaw: '１',
  referenceNames: ['特開2000-000001号公報'],
  application: '単独引用',
  remarks: '請求項1の構成は引用文献1に開示されている。',
  sourceText: '・請求項 １-２\n・引用文献等 １\n・備考 請求項1の構成は引用文献1に開示されている。',
  confidence: 'high',
  warnings: [],
};

const mapping2 = {
  reasonNumber: 2,
  subCategory: 'inventiveStep',
  subCategoryLabel: '進歩性',
  claims: [3],
  claimsRaw: '３',
  referenceNumbers: [1, 3],
  referenceNumbersRaw: '１及び３',
  referenceNames: ['特開2000-000001号公報', null],
  application: '組合せ',
  remarks: '引用文献３号公報記載の周知技術を適用することは容易である。',
  sourceText: '・請求項 ３\n・引用文献等 １及び３\n・備考 引用文献３号公報記載の周知技術を適用することは容易である。',
  confidence: 'medium',
  warnings: [
    { code: 'REFERENCE_UNRESOLVED', message: '引用文献３は引用文献一覧に対応する項目が見つかりません。', severity: 'warn' },
  ],
};

const reason2 = {
  reasonNumber: 2,
  category: 'novelty',
  categoryLabel: '新規性',
  legalBasis: '特許法第29条第1項第3号',
  headingRaw: '●理由２（新規性）について',
  confidence: 'high',
  warnings: [],
  items: [],
  article29: { references: [reference1, reference2], mappings: [mapping1, mapping2] },
};

// ---------------------------------------------------------------------
// クレーム構造（RRB.claimStructure.build の戻り値相当）
//   1（独立）→2,3（従属）→4（2又は3の選択的従属）。5 は欠番として警告を1件持たせる。
//   claim2.text に <script>alert(1)</script> を混ぜ、請求項構造タブの詳細展開でも
//   エスケープが効くことを確認する。
// ---------------------------------------------------------------------
const claimStructureMock = {
  source: 'claim_mark',
  sourceLabel: 'ページの「クレーム解析」結果（#claim_mark）',
  totalClaimCount: 4,
  claimNumbers: [1, 2, 3, 4],
  independentClaims: [1],
  claims: [
    {
      claimNumber: 1, text: '所定の処理を実行するコンピュータ。', type: 'independent',
      directParents: [], allAncestors: [], directChildren: [2, 3], allDescendants: [2, 3, 4],
      dependencyExpression: null, dependencyType: null, warnings: [],
    },
    {
      claimNumber: 2, text: '請求項1に記載のコンピュータであって<script>alert(1)</script>を特徴とする。', type: 'dependent',
      directParents: [1], allAncestors: [1], directChildren: [4], allDescendants: [4],
      dependencyExpression: '請求項1に記載', dependencyType: 'single', warnings: [],
    },
    {
      claimNumber: 3, text: '請求項1に記載のコンピュータ。', type: 'dependent',
      directParents: [1], allAncestors: [1], directChildren: [], allDescendants: [],
      dependencyExpression: '請求項1に記載', dependencyType: 'single', warnings: [],
    },
    {
      claimNumber: 4, text: '請求項2又は3に記載のコンピュータ。', type: 'dependent',
      directParents: [2, 3], allAncestors: [1, 2, 3], directChildren: [], allDescendants: [],
      dependencyExpression: '請求項2又は3に記載', dependencyType: 'selective',
      warnings: [{ code: 'CLAIM_FORWARD_REFERENCE', message: 'テスト用の請求項警告。', severity: 'warn' }],
    },
  ],
  warnings: [
    { code: 'CLAIM_NUMBER_GAP', message: '請求項番号に欠番があります: 5', severity: 'warn' },
  ],
  crossChecks: [],
  findPath(from, to) { return [from, to]; }, // JSON化時は自動的に消える（enumerable な関数プロパティのため）
};

// ---------------------------------------------------------------------
// 整合性チェック（reason1 の item1=整合、item2=不一致 に対応させる）
// ---------------------------------------------------------------------
const consistencyCheckOk = {
  reasonNumber: 1, itemNumber: 1, category: 'clarity', categoryLabel: '明確性',
  headingClaims: [2, 3, 4, 5, 6, 7], effectiveHeadingClaims: [2, 3, 4, 6, 7],
  bodyAffectedClaims: [2, 3, 4, 6, 7], finalClaims: [2, 3, 4, 6, 7],
  missingFromConclusion: [], unexpectedInConclusion: [], missingFromHeading: [], missingFromBody: [],
  bodyMissingFromConclusion: [], conclusionMissingFromBody: [],
  inheritedCandidates: [], omittedClaims: [],
  status: 'ok', issues: [], messages: [],
};
const consistencyCheckError = {
  reasonNumber: 1, itemNumber: 2, category: 'clarity', categoryLabel: '明確性',
  headingClaims: [19, 20], effectiveHeadingClaims: [19, 20],
  bodyAffectedClaims: [19, 20], finalClaims: [19],
  missingFromConclusion: [20], unexpectedInConclusion: [],
  missingFromHeading: [], missingFromBody: [],
  bodyMissingFromConclusion: [20], conclusionMissingFromBody: [],
  inheritedCandidates: [21], omittedClaims: [21],
  status: 'error',
  issues: [
    {
      severity: 'error', code: 'HEADING_CLAIMS_MISSING_IN_CONCLUSION',
      text: '項目見出しでは請求項19-20が指摘対象ですが、結論文の指摘対象は請求項19です。請求項20が結論から欠落しています。',
    },
  ],
  messages: [
    '項目見出しでは請求項19-20が指摘対象ですが、結論文の指摘対象は請求項19です。請求項20が結論から欠落しています。',
  ],
};

// ---------------------------------------------------------------------
// 指摘漏れ候補（"quotes", commas を basis に混ぜてCSVクオーティングも確認する）
// ---------------------------------------------------------------------
const omittedCandidate = {
  reasonNumber: 1, itemNumber: 2, categoryLabel: '明確性',
  sourceClaim: 19, omittedClaim: 21,
  dependencyPath: [19, 21], dependencyPathText: '19 → 21', inDirectDependency: true,
  inheritKind: 'clarity-wording', inheritKindLabel: '請求項の文言自体の不明確性',
  coveredElsewhereInReason: false, severity: 'error',
  basis: '請求項21は、問題が指摘された請求項19を直接引用しています。"quotes", commas を含む根拠テキスト。',
};

const mockResult = {
  metadata: {
    analyzedAt: '2026-07-26T00:00:00.000Z',
    totalReasonCount: 2,
    warnings: [
      { code: 'UNPARSED_TEXT', message: '一部の記載を解析できませんでした。', severity: 'info' },
    ],
    issueCounts: { error: 2, warning: 0, info: 1 },
    claimStats: {
      maxClaimNumber: 20,
      totalClaimCount: 20,
      totalClaimCountSource: 'claimStructure',
      allFinalClaims: [2, 3, 4, 6, 7, 19, 20],
      allMentionedClaims: [1, 2, 3, 4, 5, 6, 7, 19, 20],
      unflaggedClaims: [1, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
      byCategory: { clarity: [2, 3, 4, 6, 7, 19, 20], support: [], novelty: [1, 2], inventiveStep: [3], other: [] },
    },
  },
  reasons: [reason1, reason2],
  noveltyInventiveStep: {
    references: [reference1, reference2],
    mappings: [mapping1, mapping2],
  },
  unparsedSections: [
    { text: '＜先行技術文献調査結果の記録＞\n・調査した分野…', location: '末尾', note: '拒絶理由を構成しない部分として除去' },
  ],
  claimStructure: claimStructureMock,
  consistencyChecks: [consistencyCheckOk, consistencyCheckError],
  omittedClaimCandidates: [omittedCandidate],
};

// ---------------------------------------------------------------------
// CSV 用の最小パーサ（RFC4180: ダブルクオート内の , / 改行 / "" を正しく解釈する）
// ---------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cur += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(cur); cur = ''; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; i += 2; continue; }
    if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; i++; continue; }
    cur += c; i++;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

// buildCsv() の出力を「空行」区切りでセクションに分ける（parseCsv の空行は [''] になる）
function splitCsvSections(rows) {
  const sections = [[]];
  for (const row of rows) {
    if (row.length === 1 && row[0] === '') sections.push([]);
    else sections[sections.length - 1].push(row);
  }
  return sections;
}

// buildTsv() の出力を空行区切りでセクションに分ける
function splitTsvSections(tsv) {
  const sections = [[]];
  for (const line of tsv.split('\n')) {
    if (line === '') sections.push([]);
    else sections[sections.length - 1].push(line);
  }
  return sections;
}

// =======================================================================
// build()（HTML レポート）
// =======================================================================

test('build: <!doctype html> で始まり <script>・on*属性・javascript: を含まない', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.startsWith('<!doctype html>'), 'ドキュメント先頭が <!doctype html> であること');
  assert.ok(!/<script/i.test(html), '<script タグを含まないこと');
  assert.ok(!/\son[a-z]+=/i.test(html), 'on*属性を含まないこと');
  assert.ok(!/javascript:/i.test(html), 'javascript: URL を含まないこと');
});

test('build: <details> による展開UIを含む', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.includes('<details'), '<details> を含むこと');
});

test('build: 危険な値がHTMLエスケープされて出現する（XSS対策）', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'エスケープ済みの<script>alert(1)</script>を含むこと');
  assert.ok(!html.includes('<script>alert(1)</script>'), '生の<script>alert(1)</script>を含まないこと');
});

test('build: 請求項の圧縮表記・引用文献名が本文に含まれる', () => {
  const html = reportTemplate.build(mockResult);
  // item1: effectiveHeadingClaims=[2,3,4,6,7] -> "2-4、6-7"
  assert.ok(html.includes('2-4、6-7'), '請求項の圧縮表記（2-4、6-7）を含むこと');
  // item1: sameIssueClaims=[3,4] -> "3-4"
  assert.ok(html.includes('3-4'), '同様指摘の圧縮表記（3-4）を含むこと');
  // 引用文献名
  assert.ok(html.includes('特開2000-000001号公報'), '引用文献名を含むこと');
  assert.ok(html.includes('特開2000-000002号公報'), '未対応の引用文献名も含むこと');
});

test('build: @media print に対応している', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.includes('@media print'), '@media print ルールを含むこと');
});

test('build: 修正注記・自動要約の確度低下ラベル・未解析原文を含む', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.includes('２-７'), '修正注記時の原文（全角表記）を含むこと');
  assert.ok(html.includes('自動要約の確度が低い'), '確度が低い要約の注記を含むこと');
  assert.ok(html.includes('先行技術文献調査結果の記録'), '未解析原文セクションに元テキストを含むこと');
});

test('build: 請求項構造セクションが出て、請求項全文（危険な値含む）がエスケープされる', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.includes('請求項構造'), '「請求項構造」の見出しを含むこと');
  assert.ok(html.includes('所定の処理を実行するコンピュータ'), '請求項本文（claim.text）を含むこと');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '請求項本文中の危険な値もエスケープされること');
  assert.ok(html.includes('単独'), '引用種別（single→単独）のラベルを含むこと');
  assert.ok(html.includes('選択的'), '引用種別（selective→選択的）のラベルを含むこと');
  assert.ok(html.includes('請求項番号に欠番があります'), '構造警告のメッセージを含むこと');
});

test('build: 整合性チェックセクションが出て、不一致行に判定バッジと差分が出る', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.includes('整合性チェック'), '「整合性チェック」の見出しを含むこと');
  assert.ok(html.includes('不一致'), '不一致（status:error）のラベルを含むこと');
  assert.ok(html.includes('整合'), '整合（status:ok）のラベルを含むこと');
  assert.ok(html.includes('結論から欠落しています'), '検出された不整合のメッセージ（詳細）を含むこと');
});

test('build: 指摘漏れ候補セクションが出て、根拠テキストが含まれる', () => {
  const html = reportTemplate.build(mockResult);
  assert.ok(html.includes('指摘漏れ候補'), '「指摘漏れ候補」の見出しを含むこと');
  assert.ok(html.includes('19 → 21'), '引用経路（dependencyPathText）を含むこと');
  assert.ok(html.includes('直接引用しています'), '根拠（basis）テキストを含むこと');
});

test('build: 請求項構造が null のときは「未取得」の案内を表示する', () => {
  const withoutStructure = Object.assign({}, mockResult, { claimStructure: null });
  const html = reportTemplate.build(withoutStructure);
  assert.ok(html.includes('該当なし（請求項が未取得です）'), '未取得の案内文を含むこと');
});

test('build: 空の29条系・カテゴリでも「該当なし」を表示する（回帰確認）', () => {
  const emptyResult = {
    metadata: { analyzedAt: '', totalReasonCount: 0, warnings: [], claimStats: {} },
    reasons: [],
    noveltyInventiveStep: { references: [], mappings: [] },
    unparsedSections: [],
  };
  const html = reportTemplate.build(emptyResult);
  assert.ok(html.includes('該当なし'), '該当なしの表示を含むこと');
  assert.ok(!/<script/i.test(html));
});

// =======================================================================
// buildCsv()
// =======================================================================

test('buildCsv: ヘッダ行が仕様書の列定義と完全一致する', () => {
  const csv = reportTemplate.buildCsv(mockResult);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], reportTemplate.CSV_COLUMNS);
});

test('buildCsv: 主要セクションの行数 = 明確性/サポート/その他項目数 + 29条マッピング数 + ヘッダ1行', () => {
  const csv = reportTemplate.buildCsv(mockResult);
  const mainRows = splitCsvSections(parseCsv(csv))[0];
  // item1, item2（理由1） + mapping1, mapping2（理由2） + ヘッダ = 5行
  assert.equal(mainRows.length, 2 + 2 + 1);
});

test('buildCsv: CRLF で行が区切られる', () => {
  const csv = reportTemplate.buildCsv(mockResult);
  assert.ok(csv.includes('\r\n'), 'CRLFを含むこと');
});

test('buildCsv: RFC4180準拠のクオーティング（カンマ・ダブルクオートを含む値）', () => {
  const csv = reportTemplate.buildCsv(mockResult);
  const mainRows = splitCsvSections(parseCsv(csv))[0];
  const item2Row = mainRows.find((r) => r[0] === '明確性' && r[2] === '2'); // 理由1・項目No=2 の行
  assert.ok(item2Row, 'item2 の行が見つかること');
  assert.equal(item2Row[15], '"quotes", commas を含む要約文。', 'クオート・カンマを含む値が正しく復元されること');
});

test('buildCsv: 明確性の項目行は請求項系の列を持つ', () => {
  const csv = reportTemplate.buildCsv(mockResult);
  const mainRows = splitCsvSections(parseCsv(csv))[0];
  const item1Row = mainRows.find((r) => r[0] === '明確性' && r[1] === '1' && r[2] === '1');
  assert.ok(item1Row, '明確性・理由1・項目No=1 の行が見つかること');
  assert.equal(item1Row[3], '２-７', '見出し請求項(原文)');
  assert.equal(item1Row[4], '2-4、6-7', '見出し請求項(修正後)');
  assert.equal(item1Row[5], '2', '直接指摘');
  assert.equal(item1Row[6], '3-4', '同様指摘');
  assert.equal(item1Row[9], '2-4、6-7', '最終指摘');
  assert.equal(item1Row[10], '', '引用文献番号は空');
  assert.equal(item1Row[11], '', '引用文献名は空');
});

test('buildCsv: 29条マッピング行は引用文献番号・名称を持ち指摘系の列は空', () => {
  const csv = reportTemplate.buildCsv(mockResult);
  const mainRows = splitCsvSections(parseCsv(csv))[0];
  const mappingRow = mainRows.find((r) => r[0] === '進歩性');
  assert.ok(mappingRow, '進歩性のマッピング行が見つかること');
  assert.equal(mappingRow[10], '１及び３', '引用文献番号');
  assert.equal(mappingRow[11], '特開2000-000001号公報、(不明)', '引用文献名（null は(不明)表記）');
  assert.equal(mappingRow[12], '組合せ', '適用関係');
  assert.equal(mappingRow[3], '', '見出し請求項(原文)は空');
  assert.equal(mappingRow[9], '', '最終指摘は空');
});

test('buildCsv: 空行＋見出し行を挟んで整合性チェック・指摘漏れ候補セクションが追記される', () => {
  const csv = reportTemplate.buildCsv(mockResult);
  const sections = splitCsvSections(parseCsv(csv));
  assert.equal(sections.length, 3, '空行で3セクションに分かれること（主要20列／整合性チェック／指摘漏れ候補）');

  const [consistencyTitle, consistencyHeader, ...consistencyRows] = sections[1];
  assert.deepEqual(consistencyTitle, ['[整合性チェック]']);
  assert.deepEqual(consistencyHeader, reportTemplate.CONSISTENCY_COLUMNS);
  assert.equal(consistencyRows.length, 2, 'consistencyChecks の2件分の行があること');
  const errorRow = consistencyRows.find((r) => r[7] === '不一致');
  assert.ok(errorRow, 'status:error の行が「不一致」判定で見つかること');
  assert.equal(errorRow[0], '1', '理由No');
  assert.equal(errorRow[1], '2', '項目No');
  assert.ok(errorRow[8].includes('見出し−結論'), '差分セルに「見出し−結論」の非空項目が列挙されること');
  assert.ok(!errorRow[8].includes('結論−見出し'), '差分セルは非空の項目だけを列挙し、空の項目は含めないこと');
  assert.ok(errorRow[9].includes('結論から欠落しています'), 'エラー内容列に issues のテキストが入ること');

  const [omittedTitle, omittedHeader, ...omittedRows] = sections[2];
  assert.deepEqual(omittedTitle, ['[指摘漏れ候補]']);
  assert.deepEqual(omittedHeader, reportTemplate.OMITTED_COLUMNS);
  assert.equal(omittedRows.length, 1);
  assert.equal(omittedRows[0][3], '19', '問題請求項');
  assert.equal(omittedRows[0][4], '21', '漏れている可能性のある請求項');
  assert.equal(omittedRows[0][5], '19 → 21', '引用経路');
  assert.equal(omittedRows[0][6], 'エラー', '判定（severity:error → エラー）');
  assert.ok(
    omittedRows[0][8].includes('"quotes", commas'),
    '根拠列のクオート・カンマを含む値がRFC4180パーサで正しく復元されること'
  );
});

// =======================================================================
// buildTsv()
// =======================================================================

test('buildTsv: 主要20列セクションの各行のタブ数が列数-1で揃っている', () => {
  const tsv = reportTemplate.buildTsv(mockResult);
  const mainLines = splitTsvSections(tsv)[0];
  assert.equal(mainLines.length, 2 + 2 + 1);
  for (const line of mainLines) {
    const tabCount = (line.match(/\t/g) || []).length;
    assert.equal(tabCount, reportTemplate.CSV_COLUMNS.length - 1, `タブ数が一致すること: ${line.slice(0, 30)}...`);
  }
});

test('buildTsv: 値中の改行・タブは半角スペースに置換され、フィールド内に生の改行が残らない', () => {
  const tsv = reportTemplate.buildTsv(mockResult);
  // 原文列（sourceText）は複数行だが、TSV中では半角スペースに変換されているはず
  assert.ok(tsv.includes('・請求項 ２-７ 　請求項１を引用する請求項２には'), '改行がスペースに変換された原文を含むこと');
  assert.ok(!/\r/.test(tsv), 'CRを含まないこと');
});

test('buildTsv: ヘッダがタブ区切りで仕様書の列定義と一致する', () => {
  const tsv = reportTemplate.buildTsv(mockResult);
  const header = tsv.split('\n')[0].split('\t');
  assert.deepEqual(header, reportTemplate.CSV_COLUMNS);
});

test('buildTsv: 整合性チェック・指摘漏れ候補セクションが空行＋見出し行を挟んで追記され、タブ数もセクションごとに揃う', () => {
  const tsv = reportTemplate.buildTsv(mockResult);
  const sections = splitTsvSections(tsv);
  assert.equal(sections.length, 3);

  assert.equal(sections[1][0], '[整合性チェック]');
  assert.deepEqual(sections[1][1].split('\t'), reportTemplate.CONSISTENCY_COLUMNS);
  for (const line of sections[1].slice(2)) {
    assert.equal((line.match(/\t/g) || []).length, reportTemplate.CONSISTENCY_COLUMNS.length - 1);
  }

  assert.equal(sections[2][0], '[指摘漏れ候補]');
  assert.deepEqual(sections[2][1].split('\t'), reportTemplate.OMITTED_COLUMNS);
  for (const line of sections[2].slice(2)) {
    assert.equal((line.match(/\t/g) || []).length, reportTemplate.OMITTED_COLUMNS.length - 1);
  }
  // TSV では値中のタブ・改行は半角スペースに正規化されるため、"quotes", commas はそのまま残る
  assert.ok(sections[2][2].includes('"quotes", commas'), '根拠列の値がタブ置換の影響を受けずに残ること');
});
