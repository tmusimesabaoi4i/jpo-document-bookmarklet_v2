'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const normalizer = require('../src/core/normalizer');
const claritySupport = require('../src/core/clarity-support');
const claimStructure = require('../src/core/claim-structure');
const analyzer = require('../src/core/analyzer');
const consistency = require('../src/core/consistency');

const REJECTION = path.join(__dirname, '..', '..', 'fixtures', 'rejection-reason', '拒絶理由例.txt');
const CLAIM_HTML = path.join(__dirname, '..', '..', 'fixtures', 'claim-checker', 'new',
  '書類比較・クレームチェッカー_特願2024-203064.html');

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

// ITEM（docs/specification.md）の空の骨格。必要なフィールドだけ上書きして使う
function makeItem(overrides) {
  return Object.assign({
    itemNumber: 1,
    headingClaims: [],
    effectiveHeadingClaims: [],
    correctionNote: null,
    directClaims: [],
    citedParentClaims: [],
    sameIssueClaims: [],
    dependencyRelations: [],
    finalClaims: [],
    conclusionText: null,
    conclusionCategory: null,
    clarityCoreSentence: null,
    specStatements: [],
    issueSummary: null,
  }, overrides || {});
}

const CLARITY = { reasonNumber: 1, category: 'clarity', categoryLabel: '明確性' };
const SUPPORT = { reasonNumber: 2, category: 'support', categoryLabel: 'サポート要件' };

const claim = (claimNumber, text) => ({ claimNumber, text });
const codesOf = (check) => check.issues.map((i) => i.code);

// DOM の無い node で fixture の <div id="…"> の innerHTML を切り出すテスト専用ヘルパー
function innerHtmlById(html, id) {
  const i = html.indexOf('id="' + id + '"');
  if (i === -1) return null;
  const gt = html.indexOf('>', i);
  return html.slice(gt + 1, html.indexOf('</div>', gt));
}

function fixtureStructure() {
  const html = fs.readFileSync(CLAIM_HTML, 'utf8');
  return claimStructure.build(
    claimStructure.parseClaimTexts(claimStructure.claimHtmlToText(innerHtmlById(html, 'claim_mark'))),
    { source: 'claim_mark' });
}

// ---- §7 本文上の指摘集合 ---------------------------------------------------

test('computeBodyAffectedClaims: 直接指摘・同様指摘・引用による指摘の和集合', () => {
  const item = makeItem({
    directClaims: [3],
    sameIssueClaims: [4, 19, 20],
    dependencyRelations: [{ parentClaims: [4], affectedClaims: [5] }],
  });
  assert.deepEqual(consistency.computeBodyAffectedClaims(item), [3, 4, 5, 19, 20]);
  // 重複は畳まれ、複数の引用関係も合算される
  assert.deepEqual(consistency.computeBodyAffectedClaims(makeItem({
    directClaims: [2],
    sameIssueClaims: [2, 3],
    dependencyRelations: [
      { parentClaims: [2], affectedClaims: [5, 6] },
      { parentClaims: [4], affectedClaims: [6, 7] },
    ],
  })), [2, 3, 5, 6, 7]);
  assert.deepEqual(consistency.computeBodyAffectedClaims(makeItem({})), []);
});

// ---- §13.1 見出しと結論の不一致 -------------------------------------------

test('13.1 見出しと結論の不一致: 見出し19-20・本文19-20に対し結論が19だけ', () => {
  const item = claritySupport.parseIssueBlock(toBlock([
    '・請求項 １９-２０',
    '　請求項１９には「Ａ」が記載されている。',
    '　請求項２０にも同様の点が指摘される。',
    '　よって、請求項１９に係る発明は明確でない。',
  ]), Object.assign({ itemNumber: 1 }, CLARITY));
  // 実文からの抽出が前提どおりであることを先に確認する
  assert.deepEqual(item.headingClaims, [19, 20]);
  assert.deepEqual(item.effectiveHeadingClaims, [19, 20]);
  assert.deepEqual(item.directClaims, [19]);
  assert.deepEqual(item.sameIssueClaims, [20]);
  assert.deepEqual(item.finalClaims, [19]);

  const check = consistency.checkItem(item, CLARITY, null);
  assert.deepEqual(check.bodyAffectedClaims, [19, 20]);
  assert.deepEqual(check.missingFromConclusion, [20]);
  assert.deepEqual(check.bodyMissingFromConclusion, [20]);
  assert.deepEqual(check.unexpectedInConclusion, []);
  assert.equal(check.status, 'error');
  assert.deepEqual(codesOf(check),
    ['HEADING_CLAIMS_MISSING_IN_CONCLUSION', 'BODY_CLAIMS_MISSING_IN_CONCLUSION']);
  assert.ok(check.messages[0].indexOf('請求項20') !== -1);
});

// ---- §13.2 結論側に余分 ----------------------------------------------------

test('13.2 結論側に余分: 見出し2-4に対し結論が2-5', () => {
  const check = consistency.checkItem(makeItem({
    headingClaims: [2, 3, 4],
    effectiveHeadingClaims: [2, 3, 4],
    directClaims: [2],
    sameIssueClaims: [3, 4],
    finalClaims: [2, 3, 4, 5],
  }), CLARITY, null);
  assert.deepEqual(check.unexpectedInConclusion, [5]);
  assert.deepEqual(check.missingFromConclusion, []);
  assert.equal(check.status, 'error');
  assert.ok(codesOf(check).indexOf('CONCLUSION_CLAIMS_NOT_IN_HEADING') !== -1);
  assert.ok(check.messages[0].indexOf('請求項5') !== -1);
});

// ---- §13.3 本文と結論の不一致 ---------------------------------------------

test('13.3 本文と結論の不一致: 結論の請求項4に本文上の根拠が無い（構造なし）', () => {
  const check = consistency.checkItem(makeItem({
    headingClaims: [2, 3, 4],
    effectiveHeadingClaims: [2, 3, 4],
    directClaims: [2],
    sameIssueClaims: [3],
    finalClaims: [2, 3, 4],
  }), CLARITY, null);
  assert.deepEqual(check.bodyAffectedClaims, [2, 3]);
  assert.deepEqual(check.conclusionMissingFromBody, [4]);
  assert.equal(check.status, 'error');
  const issue = check.issues.find((i) => i.code === 'CONCLUSION_CLAIMS_WITHOUT_BODY_BASIS');
  assert.ok(issue, 'CONCLUSION_CLAIMS_WITHOUT_BODY_BASIS が出ていない');
  assert.equal(issue.severity, 'error');
  assert.ok(issue.text.indexOf('請求項4') !== -1);
  assert.ok(issue.text.indexOf('確認できません') !== -1);
});

// ---- §13.4 引用関係による指摘漏れ -----------------------------------------

test('13.4 指摘漏れ: 請求項2の下位3・4が指摘対象から漏れている（直接下位＝error）', () => {
  const structure = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '請求項2に記載の装置。'),
    claim(4, '請求項2に記載の装置。'),
  ]);
  const item = makeItem({
    headingClaims: [2],
    effectiveHeadingClaims: [2],
    directClaims: [2],
    finalClaims: [2],
    clarityCoreSentence: '請求項２に係る発明において「Ａ」と「Ｂ」との異同が不明確である。',
  });
  const omitted = consistency.findOmittedCandidatesForItem(item, CLARITY, structure, [2]);
  assert.deepEqual(omitted.map((o) => o.omittedClaim), [3, 4]);
  assert.deepEqual(omitted.map((o) => o.dependencyPath), [[2, 3], [2, 4]]);
  for (const o of omitted) {
    assert.equal(o.sourceClaim, 2);
    assert.equal(o.inDirectDependency, true);
    assert.equal(o.severity, 'error');
    assert.equal(o.inheritKind, 'clarity-wording');
    assert.equal(o.coveredElsewhereInReason, false);
    assert.equal(o.reasonNumber, 1);
  }
  assert.equal(omitted[0].dependencyPathText, '2 → 3');
});

test('13.4 指摘漏れ: 3階層（1←2←5←8）では間接下位の請求項8が warning になる', () => {
  const structure = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(5, '請求項2に記載の装置。'),
    claim(8, '請求項5に記載の装置。'),
  ]);
  const item = makeItem({
    headingClaims: [2],
    effectiveHeadingClaims: [2],
    directClaims: [2],
    finalClaims: [2],
    clarityCoreSentence: '請求項２に係る発明は不明確である。',
  });
  const omitted = consistency.findOmittedCandidatesForItem(item, CLARITY, structure, [2]);
  assert.deepEqual(omitted.map((o) => o.omittedClaim), [5, 8]);
  const c8 = omitted.find((o) => o.omittedClaim === 8);
  assert.deepEqual(c8.dependencyPath, [2, 5, 8]);
  assert.equal(c8.inDirectDependency, false);
  assert.equal(c8.severity, 'warning');
  assert.ok(c8.basis.indexOf('間接的に引用') !== -1);
  assert.equal(omitted.find((o) => o.omittedClaim === 5).severity, 'error');
});

test('13.4 指摘漏れ: 構造が無ければ候補は出ない', () => {
  const item = makeItem({ directClaims: [2], finalClaims: [2] });
  assert.deepEqual(consistency.findOmittedCandidatesForItem(item, CLARITY, null, []), []);
  assert.deepEqual(consistency.findOmittedCandidatesForItem(
    item, CLARITY, claimStructure.build([]), []), []);
});

// ---- §13.5 存在しない請求項 -----------------------------------------------

test('13.5 存在しない請求項: 全20項の出願で請求項21を指摘している', () => {
  const list = [claim(1, '装置。')];
  for (let n = 2; n <= 20; n++) list.push(claim(n, '請求項1に記載の装置。'));
  const structure = claimStructure.build(list);
  const reasons = [{
    reasonNumber: 1,
    items: [makeItem({
      headingClaims: [21], effectiveHeadingClaims: [21], directClaims: [21], finalClaims: [21],
    })],
  }];
  const issues = consistency.validateClaimExistence(reasons, structure);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'error');
  assert.equal(issues[0].code, 'CLAIM_NOT_IN_SCOPE');
  assert.ok(issues[0].text.indexOf('請求項21') !== -1);
  assert.ok(issues[0].text.indexOf('存在しません') !== -1);
  assert.ok(issues[0].text.indexOf('全請求項数: 20') !== -1);
  // 構造が無い／空なら検証しない
  assert.deepEqual(consistency.validateClaimExistence(reasons, null), []);
});

test('13.5 派生: 欠番の請求項は「（欠番）」として報告される', () => {
  const structure = claimStructure.build([claim(1, '装置。'), claim(3, '請求項1に記載の装置。')]);
  const reasons = [{ reasonNumber: 1, items: [makeItem({ itemNumber: 2, directClaims: [2], finalClaims: [2] })] }];
  const issues = consistency.validateClaimExistence(reasons, structure);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].text.indexOf('（欠番）') !== -1);
  assert.ok(issues[0].text.indexOf('理由1 項目2 直接指摘') !== -1);
});

test('collectMentionedClaims: 出現箇所のラベルつきで全番号を集める', () => {
  const map = consistency.collectMentionedClaims([{
    reasonNumber: 1,
    items: [makeItem({
      headingClaims: [2], directClaims: [2], citedParentClaims: [1], sameIssueClaims: [3],
      dependencyRelations: [{ parentClaims: [4], affectedClaims: [5] }], finalClaims: [2, 3, 5],
    })],
  }]);
  assert.deepEqual(Array.from(map.keys()).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.deepEqual(map.get(1), ['理由1 項目1 引用元']);
  assert.deepEqual(map.get(5), ['理由1 項目1 引用による指摘', '理由1 項目1 結論']);
});

// ---- §13.6 修正注記との不一致 ---------------------------------------------

test('13.6 修正注記との不一致: 除外された請求項5が結論に残っている（§6.4）', () => {
  const check = consistency.checkItem(makeItem({
    headingClaims: [3, 4, 5],
    effectiveHeadingClaims: [3, 4],
    correctionNote: { raw: '修正：５を除く', excluded: [5], added: [], recognized: true },
    directClaims: [3],
    sameIssueClaims: [4],
    finalClaims: [3, 4, 5],
  }), SUPPORT, null);
  // 比較の基準は修正注記適用後の見出し
  assert.deepEqual(check.headingClaims, [3, 4, 5]);
  assert.deepEqual(check.effectiveHeadingClaims, [3, 4]);
  assert.deepEqual(check.unexpectedInConclusion, [5]);
  assert.equal(check.status, 'error');
  const issue = check.issues.find((i) => i.code === 'CONCLUSION_CLAIMS_NOT_IN_HEADING');
  assert.ok(issue);
  assert.ok(issue.text.indexOf('修正注記で請求項5が除外') !== -1);
});

// ---- §5.1 承継性の判定 ----------------------------------------------------

test('assessInheritability: 矛盾を述べる文は contradiction / strong', () => {
  const r = consistency.assessInheritability(
    makeItem({ clarityCoreSentence: '発明特定事項同士の関係が整合しておらず、請求項１９に係る発明は不明確である。' }),
    'clarity');
  assert.equal(r.kind, 'contradiction');
  assert.equal(r.strength, 'strong');
  assert.equal(r.inheritable, true);
});

test('assessInheritability: サポート要件（category / specStatements / conclusionCategory）は support-missing / strong', () => {
  assert.equal(consistency.assessInheritability(makeItem({}), 'support').kind, 'support-missing');
  assert.equal(consistency.assessInheritability(
    makeItem({ specStatements: [{ sentence: '本願明細書には…は記載されていない。', missing: 'Ｘする' }] }), null).kind,
  'support-missing');
  assert.equal(consistency.assessInheritability(
    makeItem({ conclusionCategory: 'support' }), null).kind, 'support-missing');
  assert.equal(consistency.assessInheritability(makeItem({}), 'support').strength, 'strong');
});

test('assessInheritability: 明確性（category / 「不明確」の語）は clarity-wording / strong', () => {
  assert.equal(consistency.assessInheritability(makeItem({}), 'clarity').kind, 'clarity-wording');
  assert.equal(consistency.assessInheritability(
    makeItem({ issueSummary: '「Ａ」と「Ｂ」との異同が不明確' }), null).kind, 'clarity-wording');
  assert.equal(consistency.assessInheritability(
    makeItem({ conclusionText: 'よって、請求項２に係る発明は明確でない。' }), null).kind, 'clarity-wording');
  assert.equal(consistency.assessInheritability(makeItem({}), 'clarity').strength, 'strong');
});

test('assessInheritability: 性質を特定できない指摘は other / weak', () => {
  const r = consistency.assessInheritability(makeItem({}), null);
  assert.equal(r.kind, 'other');
  assert.equal(r.strength, 'weak');
  assert.ok(r.basis.indexOf('原文の確認が必要') !== -1);
});

test('承継性が weak なら直接下位でも指摘漏れは warning 止まり', () => {
  const structure = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '請求項2に記載の装置。'),
  ]);
  const item = makeItem({
    headingClaims: [2], effectiveHeadingClaims: [2], directClaims: [2], finalClaims: [2],
  });
  const omitted = consistency.findOmittedCandidatesForItem(
    item, { reasonNumber: 1, category: null, categoryLabel: 'その他' }, structure, [2]);
  assert.equal(omitted.length, 1);
  assert.equal(omitted[0].omittedClaim, 3);
  assert.equal(omitted[0].inDirectDependency, true);
  assert.equal(omitted[0].severity, 'warning');
  assert.equal(omitted[0].inheritKind, 'other');
  assert.ok(omitted[0].basis.indexOf('原文を確認してください') !== -1);
});

// ---- §14 拒絶理由が述べる引用関係と実構造の照合 ----------------------------

test('14 引用関係の照合: 実 fixture の構造では「請求項2、4を引用する請求項5-7」に矛盾なし', (t) => {
  if (!fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const structure = fixtureStructure();
  const item = makeItem({
    itemNumber: 1,
    dependencyRelations: [{ parentClaims: [2, 4], affectedClaims: [5, 6, 7] }],
  });
  assert.deepEqual(consistency.crossCheckStatedDependencies(item, CLARITY, structure), []);
});

test('14 引用関係の照合: 請求項7が請求項1しか引用しない構造では STATED_DEPENDENCY_MISMATCH', () => {
  const structure = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '請求項2に記載の装置。'),
    claim(4, '請求項2に記載の装置。'),
    claim(5, '請求項4に記載の装置。'),
    claim(6, '請求項2に記載の装置。'),
    claim(7, '請求項1に記載の装置。'),
  ]);
  const item = makeItem({
    itemNumber: 1,
    dependencyRelations: [{ parentClaims: [2, 4], affectedClaims: [5, 6, 7] }],
  });
  const issues = consistency.crossCheckStatedDependencies(item, CLARITY, structure);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'error');
  assert.equal(issues[0].code, 'STATED_DEPENDENCY_MISMATCH');
  assert.ok(issues[0].text.indexOf('請求項7') !== -1);
  assert.ok(issues[0].text.indexOf('理由1 項目1') !== -1);
  // 構造が無ければ照合しない
  assert.deepEqual(consistency.crossCheckStatedDependencies(item, CLARITY, null), []);
});

test('14 引用関係の照合: 直接指摘の引用元（citedParentClaims）も照合する', () => {
  const structure = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '装置。'),
  ]);
  const ok = makeItem({ itemNumber: 1, directClaims: [2], citedParentClaims: [1] });
  assert.deepEqual(consistency.crossCheckStatedDependencies(ok, CLARITY, structure), []);
  const ng = makeItem({ itemNumber: 1, directClaims: [3], citedParentClaims: [1] });
  const issues = consistency.crossCheckStatedDependencies(ng, CLARITY, structure);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'STATED_DEPENDENCY_MISMATCH');
});

// ---- §7.3 クレーム構造による精緻化 ----------------------------------------

test('7.3 見出しに本文上の根拠が無い場合: 構造で下位関係が説明できれば info', () => {
  const structure = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '請求項2に記載の装置。'),
    claim(4, '請求項2に記載の装置。'),
  ]);
  const item = makeItem({
    headingClaims: [2, 3, 4],
    effectiveHeadingClaims: [2, 3, 4],
    directClaims: [2],
    finalClaims: [2, 3, 4],
  });
  const withStructure = consistency.checkItem(item, CLARITY, structure);
  assert.deepEqual(withStructure.missingFromBody, [3, 4]);
  const info = withStructure.issues.find((i) => i.code === 'HEADING_CLAIMS_COVERED_BY_STRUCTURE');
  assert.ok(info, 'HEADING_CLAIMS_COVERED_BY_STRUCTURE が出ていない');
  assert.equal(info.severity, 'info');
  assert.ok(info.text.indexOf('請求項3-4') !== -1);
  assert.equal(codesOf(withStructure).indexOf('HEADING_CLAIMS_WITHOUT_BODY_BASIS'), -1);

  const withoutStructure = consistency.checkItem(item, CLARITY, null);
  const warn = withoutStructure.issues.find((i) => i.code === 'HEADING_CLAIMS_WITHOUT_BODY_BASIS');
  assert.ok(warn, 'HEADING_CLAIMS_WITHOUT_BODY_BASIS が出ていない');
  assert.equal(warn.severity, 'warn');
  assert.equal(codesOf(withoutStructure).indexOf('HEADING_CLAIMS_COVERED_BY_STRUCTURE'), -1);
});

test('7.3 構造でも説明できない請求項は warn のまま残る', () => {
  const structure = claimStructure.build([
    claim(1, '装置。'),
    claim(2, '請求項1に記載の装置。'),
    claim(3, '請求項2に記載の装置。'),
    claim(4, '装置。'),   // 請求項2の下位ではない
  ]);
  const check = consistency.checkItem(makeItem({
    headingClaims: [2, 3, 4],
    effectiveHeadingClaims: [2, 3, 4],
    directClaims: [2],
    finalClaims: [2, 3, 4],
  }), CLARITY, structure);
  const info = check.issues.find((i) => i.code === 'HEADING_CLAIMS_COVERED_BY_STRUCTURE');
  const warn = check.issues.find((i) => i.code === 'HEADING_CLAIMS_WITHOUT_BODY_BASIS');
  assert.ok(info.text.indexOf('請求項3') !== -1);
  assert.ok(warn.text.indexOf('請求項4') !== -1);
});

test('7.4 本文にあるが見出しにない請求項は error', () => {
  const check = consistency.checkItem(makeItem({
    headingClaims: [2], effectiveHeadingClaims: [2],
    directClaims: [2], sameIssueClaims: [8],
    finalClaims: [2, 8],
  }), CLARITY, null);
  assert.deepEqual(check.missingFromHeading, [8]);
  const issue = check.issues.find((i) => i.code === 'BODY_CLAIMS_NOT_IN_HEADING');
  assert.ok(issue);
  assert.equal(issue.severity, 'error');
  assert.equal(check.status, 'error');
});

test('整合していれば status は ok（issues なし）', () => {
  const check = consistency.checkItem(makeItem({
    headingClaims: [2, 3], effectiveHeadingClaims: [2, 3],
    directClaims: [2], sameIssueClaims: [3], finalClaims: [2, 3],
  }), CLARITY, null);
  assert.deepEqual(check.issues, []);
  assert.deepEqual(check.messages, []);
  assert.equal(check.status, 'ok');
  assert.equal(check.categoryLabel, '明確性');
  assert.equal(check.reasonNumber, 1);
});

// ---- run() の統合検証（実 fixture） ---------------------------------------

test('run(): 実 fixture（拒絶理由 + クレーム構造）の整合性検証', (t) => {
  if (!fs.existsSync(REJECTION) || !fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const structure = fixtureStructure();
  const result = analyzer.analyze(fs.readFileSync(REJECTION, 'utf8'));
  const out = consistency.run(result, structure);

  assert.equal(out.consistencyChecks.length, 6);
  assert.deepEqual(out.warnings, []);   // 存在しない請求項の指摘は無い

  const target = out.consistencyChecks.find((c) => c.reasonNumber === 2 && c.itemNumber === 2);
  assert.equal(target.status, 'error');
  assert.deepEqual(codesOf(target), ['CONCLUSION_CLAIMS_NOT_IN_HEADING', 'BODY_CLAIMS_NOT_IN_HEADING']);
  assert.deepEqual(target.effectiveHeadingClaims, [3, 4, 19, 20]);
  assert.deepEqual(target.unexpectedInConclusion, [5]);
  assert.deepEqual(target.missingFromHeading, [5]);

  for (const c of out.consistencyChecks) {
    if (c === target) continue;
    assert.equal(c.status, 'ok', '理由' + c.reasonNumber + ' 項目' + c.itemNumber + ' は ok のはず');
    assert.deepEqual(c.issues, []);
  }

  assert.equal(out.omittedClaimCandidates.length, 5);
  assert.deepEqual(out.omittedClaimCandidates.map((o) => o.omittedClaim), [3, 4, 5, 6, 7]);
  for (const o of out.omittedClaimCandidates) {
    assert.equal(o.severity, 'info');
    assert.equal(o.coveredElsewhereInReason, true);
    assert.equal(o.sourceClaim, 2);
    assert.equal(o.reasonNumber, 2);
    assert.equal(o.itemNumber, 1);
    assert.ok(o.basis.indexOf('他の指摘項目では') !== -1);
  }
  assert.deepEqual(out.consistencyChecks.find((c) => c.reasonNumber === 2 && c.itemNumber === 1).omittedClaims,
    [3, 4, 5, 6, 7]);

  assert.deepEqual(out.counts, { error: 2, warning: 0, info: 5 });
});

test('run(): coveredElsewhereInReason が無ければ同じ入力でも error に上がる', (t) => {
  if (!fs.existsSync(REJECTION) || !fs.existsSync(CLAIM_HTML)) { t.skip('fixtures なし'); return; }
  const structure = fixtureStructure();
  const result = analyzer.analyze(fs.readFileSync(REJECTION, 'utf8'));
  const item = result.reasons.find((r) => r.reasonNumber === 2).items[0];
  assert.deepEqual(item.effectiveHeadingClaims, [2]);
  assert.deepEqual(item.finalClaims, [2]);

  // 同一理由の他項目が請求項3-7を拾っている前提を外す（reasonCoverage に含めない）
  const omitted = consistency.findOmittedCandidatesForItem(item, SUPPORT, structure, [2]);
  assert.deepEqual(omitted.map((o) => o.omittedClaim), [3, 4, 5, 6, 7]);
  for (const o of omitted) {
    assert.equal(o.coveredElsewhereInReason, false);
    assert.equal(o.inheritKind, 'support-missing');
  }
  const bySeverity = new Map(omitted.map((o) => [o.omittedClaim, o.severity]));
  assert.equal(bySeverity.get(3), 'error');   // 直接下位
  assert.equal(bySeverity.get(4), 'error');
  assert.equal(bySeverity.get(6), 'error');
  assert.equal(bySeverity.get(7), 'error');
  assert.equal(bySeverity.get(5), 'warning'); // 2 → 4 → 5 の間接下位
  assert.deepEqual(omitted.find((o) => o.omittedClaim === 5).dependencyPath, [2, 4, 5]);
});

test('run(): クレーム構造が無くても文章内の整合性検証は動く', (t) => {
  if (!fs.existsSync(REJECTION)) { t.skip('fixtures なし'); return; }
  const result = analyzer.analyze(fs.readFileSync(REJECTION, 'utf8'));
  const out = consistency.run(result, null);
  assert.equal(out.consistencyChecks.length, 6);
  assert.deepEqual(out.omittedClaimCandidates, []);
  assert.deepEqual(out.warnings, []);
  const target = out.consistencyChecks.find((c) => c.reasonNumber === 2 && c.itemNumber === 2);
  assert.equal(target.status, 'error');
  assert.deepEqual(target.inheritedCandidates, []);
  assert.equal(out.counts.error, 2);
});

test('run(): クレーム構造側の警告も counts に合算される', () => {
  const structure = claimStructure.build([claim(1, '装置。'), claim(3, '請求項1に記載の装置。')]);
  const result = { reasons: [] };
  const out = consistency.run(result, structure);
  assert.deepEqual(out.consistencyChecks, []);
  assert.equal(out.counts.warning, 1);   // CLAIM_NUMBER_GAP
  assert.equal(out.counts.error, 0);
});
