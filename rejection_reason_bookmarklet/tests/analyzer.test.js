'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const examples = require('../examples/examples');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'rejection-reason', '拒絶理由例.txt');
const OPUS_MODULES = ['article29.js', 'summarizer.js', 'validator.js']
  .map((f) => path.join(__dirname, '..', 'src', 'core', f));

// analyzer は article29 / summarizer / validator に依存するため、
// それらが未実装の間はこのテスト全体を skip する（並行開発用ガード）
function loadAnalyzer(t) {
  if (!OPUS_MODULES.every((p) => fs.existsSync(p))) {
    t.skip('article29 / summarizer / validator が未実装のため skip');
    return null;
  }
  return require('../src/core/analyzer');
}

function readFixture(t) {
  if (!fs.existsSync(FIXTURE)) {
    t.skip('fixtures が見つからないため skip');
    return null;
  }
  return fs.readFileSync(FIXTURE, 'utf8');
}

test('統合ゴールデン: fixture 全体が examples.fixture36 と一致する', (t) => {
  const analyzer = loadAnalyzer(t);
  const text = analyzer && readFixture(t);
  if (!analyzer || !text) return;
  const expected = examples.fixture36;
  const result = analyzer.analyze(text);

  assert.equal(result.metadata.analyzedAt, '', 'analyzedAt は UI が設定するため空');
  assert.equal(result.metadata.totalReasonCount, expected.totalReasonCount);
  assert.deepEqual(result.metadata.claimStats, expected.claimStats);
  assert.deepEqual(result.unparsedSections, []);
  assert.deepEqual(result.noveltyInventiveStep.mappings, []);

  assert.equal(result.reasons.length, expected.reasons.length);
  expected.reasons.forEach((expReason, ri) => {
    const reason = result.reasons[ri];
    const at = '理由' + expReason.reasonNumber;
    assert.equal(reason.reasonNumber, expReason.reasonNumber, at);
    assert.equal(reason.category, expReason.category, at);
    assert.equal(reason.categoryLabel, expReason.categoryLabel, at);
    assert.equal(reason.legalBasis, expReason.legalBasis, at);
    assert.equal(reason.items.length, expReason.items.length, at + ' 項目数');

    expReason.items.forEach((exp, ii) => {
      const item = reason.items[ii];
      const loc = at + ' 項目' + exp.itemNumber;
      assert.equal(item.itemNumber, exp.itemNumber, loc);
      assert.equal(item.headingClaimsRaw, exp.headingClaimsRaw, loc + ' headingClaimsRaw');
      assert.deepEqual(item.headingClaims, exp.headingClaims, loc + ' headingClaims');
      assert.deepEqual(item.effectiveHeadingClaims, exp.effectiveHeadingClaims, loc + ' effectiveHeadingClaims');
      if (exp.correctionNote === null) {
        assert.equal(item.correctionNote, null, loc + ' correctionNote');
      } else {
        assert.equal(item.correctionNote.raw, exp.correctionNote.raw, loc + ' correctionNote.raw');
        assert.deepEqual(item.correctionNote.excluded, exp.correctionNote.excluded, loc + ' correctionNote.excluded');
      }
      assert.deepEqual(item.directClaims, exp.directClaims, loc + ' directClaims');
      assert.deepEqual(item.citedParentClaims, exp.citedParentClaims, loc + ' citedParentClaims');
      assert.deepEqual(item.sameIssueClaims, exp.sameIssueClaims, loc + ' sameIssueClaims');
      assert.deepEqual(
        item.dependencyRelations.map((d) => ({ parentClaims: d.parentClaims, affectedClaims: d.affectedClaims })),
        exp.dependencyRelations, loc + ' dependencyRelations');
      assert.deepEqual(item.finalClaims, exp.finalClaims, loc + ' finalClaims');
      assert.equal(item.finalClaimsRaw, exp.finalClaimsRaw, loc + ' finalClaimsRaw');
      assert.equal(item.finalClaimsSource, exp.finalClaimsSource, loc + ' finalClaimsSource');
      assert.equal(item.conclusionCategory, exp.conclusionCategory, loc + ' conclusionCategory');

      assert.equal(item.problematicPhrases.length, exp.phrases.length, loc + ' 引用文言数');
      exp.phrases.forEach((expPhrase, pi) => {
        const phrase = item.problematicPhrases[pi];
        assert.equal(phrase.role, expPhrase.role, loc + ' phrase[' + pi + '].role');
        assert.deepEqual(phrase.claimNumbers, expPhrase.claimNumbers, loc + ' phrase[' + pi + '].claimNumbers');
        if (expPhrase.text !== null) {
          assert.equal(phrase.text, expPhrase.text, loc + ' phrase[' + pi + '].text');
        } else {
          // 長文引用は先頭一致のみ検査（examples の phrasePrefixes）
          assert.ok(phrase.text.startsWith(exp.phrasePrefixes[0]), loc + ' phrase[' + pi + '] prefix');
        }
      });
      assert.deepEqual(item.specStatements.map((s) => s.missing), exp.specMissing, loc + ' specStatements');
      assert.equal(item.issueSummary, exp.issueSummary, loc + ' issueSummary');
      assert.equal(item.summaryReliable, exp.summaryReliable, loc + ' summaryReliable');
      assert.equal(item.confidence, exp.confidence, loc + ' confidence');
      assert.equal(item.unmatchedSentences.length, exp.unmatchedSentences, loc + ' unmatchedSentences');
      for (const code of exp.warningCodes) {
        assert.ok(item.warnings.some((w) => w.code === code), loc + ' 警告 ' + code + ': ' + JSON.stringify(item.warnings));
      }
      // 期待に無い警告コード（info 除く）が紛れていないこと
      const unexpected = item.warnings.filter((w) => w.severity !== 'info' && exp.warningCodes.indexOf(w.code) === -1);
      assert.deepEqual(unexpected, [], loc + ' 予期しない警告');
      assert.ok(item.sourceText.indexOf(exp.headingClaimsRaw) !== -1, loc + ' sourceText に見出し');
    });
  });

  // 表示用圧縮表記
  const claims = require('../src/core/claims');
  assert.equal(claims.compressClaimNumbers(result.metadata.claimStats.allFinalClaims), expected.display.allFinalClaims);
  assert.equal(claims.compressClaimNumbers(result.metadata.claimStats.unflaggedClaims), expected.display.unflaggedClaims);
});

test('全請求項数の上書き: 25 にすると未指摘に 21-25 が加わる', (t) => {
  const analyzer = loadAnalyzer(t);
  const text = analyzer && readFixture(t);
  if (!analyzer || !text) return;
  const result = analyzer.analyze(text, { totalClaimCount: 25 });
  const stats = result.metadata.claimStats;
  assert.equal(stats.totalClaimCount, 25);
  for (const n of [21, 22, 23, 24, 25]) assert.ok(stats.unflaggedClaims.indexOf(n) !== -1);
  assert.equal(stats.unflaggedClaims.indexOf(2), -1);
});

test('冪等性: 同じ入力を 2 回解析しても同一結果', (t) => {
  const analyzer = loadAnalyzer(t);
  const text = analyzer && readFixture(t);
  if (!analyzer || !text) return;
  assert.deepEqual(analyzer.analyze(text), analyzer.analyze(text));
});

test('異常系: 空入力・理由なし入力は throw せず警告を返す', (t) => {
  const analyzer = loadAnalyzer(t);
  if (!analyzer) return;
  const empty = analyzer.analyze('');
  assert.ok(empty.metadata.warnings.some((w) => w.code === 'EMPTY_INPUT'));
  assert.deepEqual(empty.reasons, []);

  const noise = analyzer.analyze('これは拒絶理由通知ではありません。');
  assert.ok(noise.metadata.warnings.some((w) => w.code === 'NO_REASONS_FOUND'));
});

// ---- クレーム構造との統合（追加要件） ----

const CLAIM_HTML = path.join(__dirname, '..', '..', 'fixtures', 'claim-checker', 'new',
  '書類比較・クレームチェッカー_特願2024-203064.html');

// テスト内でのみ使う簡易 DOM 代替（node には DOM が無いため id で div の中身を切り出す）
function innerHtmlById(html, id) {
  const i = html.indexOf('id="' + id + '"');
  if (i === -1) return null;
  const gt = html.indexOf('>', i);
  return html.slice(gt + 1, html.indexOf('</div>', gt));
}

// #claim_tree の中の .div_tree を切り出す（class で入る子要素）
function treeInnerHtml(html) {
  const i = html.indexOf('id="claim_tree"');
  if (i === -1) return null;
  const j = html.indexOf('class="div_tree', i);
  const gt = html.indexOf('>', j);
  return html.slice(gt + 1, html.indexOf('</div>', gt));
}

// 本番（page-claims.collect）と同じ組み立て:
//   引用関係 ← #claim_tree ／ 合計請求項数・独立請求項 ← #claim_cite ／ 全文 ← #claim_mark
function loadFixtureStructure(t) {
  const csPath = path.join(__dirname, '..', 'src', 'core', 'claim-structure.js');
  if (!fs.existsSync(csPath) || !fs.existsSync(CLAIM_HTML)) {
    t.skip('claim-structure または対象HTMLが見つからないため skip');
    return null;
  }
  const cs = require('../src/core/claim-structure');
  const html = fs.readFileSync(CLAIM_HTML, 'utf8');
  const items = cs.parseClaimTexts(cs.claimHtmlToText(innerHtmlById(html, 'claim_mark')));
  const tree = cs.parseClaimTree(cs.claimHtmlToText(treeInnerHtml(html)));
  const cite = cs.parseClaimCiteText(cs.claimHtmlToText(innerHtmlById(html, 'claim_cite')));
  assert.equal(tree.ok, true, '罫線ツリーの解析: ' + (tree.ok ? '' : tree.error));
  const structure = cs.build(items, {
    source: 'claim_tree',
    sourceLabel: 'テスト',
    dependencies: tree.dependencies,
    totalClaimCount: cite.totalClaimCount,
    independentClaims: cite.independentClaims,
  });
  structure.crossChecks = cs.crossCheckWithCite(structure, cite);
  return structure;
}

test('クレーム構造あり: 全請求項数がHTML由来の26になり未指摘請求項が是正される', (t) => {
  const analyzer = loadAnalyzer(t);
  const text = analyzer && readFixture(t);
  const structure = text && loadFixtureStructure(t);
  if (!analyzer || !text || !structure) return;
  const exp = examples.claimStructure203064;
  const result = analyzer.analyze(text, { claimStructure: structure });
  const stats = result.metadata.claimStats;

  assert.equal(stats.totalClaimCount, exp.claimStatsWithStructure.totalClaimCount);
  assert.equal(stats.totalClaimCountSource, exp.claimStatsWithStructure.totalClaimCountSource);
  assert.deepEqual(stats.unflaggedClaims, exp.claimStatsWithStructure.unflaggedClaims);
  const claims = require('../src/core/claims');
  assert.equal(claims.compressClaimNumbers(stats.unflaggedClaims),
    exp.claimStatsWithStructure.displayUnflagged);
  // 構造を渡しても指摘そのものは変わらない
  assert.deepEqual(stats.allFinalClaims, examples.fixture36.claimStats.allFinalClaims);
  assert.equal(result.claimStructure, structure);
  // 罫線ツリー由来の構造とページ側の計算結果（#claim_cite）が完全一致していること
  assert.deepEqual(structure.crossChecks, []);
  assert.equal(structure.source, 'claim_tree');
  assert.equal(structure.totalClaimCountSource, 'claim_cite');
});

test('クレーム構造あり: 整合性チェックと指摘漏れ候補が期待どおり', (t) => {
  const analyzer = loadAnalyzer(t);
  const text = analyzer && readFixture(t);
  const structure = text && loadFixtureStructure(t);
  if (!analyzer || !text || !structure) return;
  const exp = examples.claimStructure203064.consistency;
  const result = analyzer.analyze(text, { claimStructure: structure });

  assert.equal(result.consistencyChecks.length, exp.checkCount);
  for (const expErr of exp.errorItems) {
    const check = result.consistencyChecks.find(
      (c) => c.reasonNumber === expErr.reasonNumber && c.itemNumber === expErr.itemNumber);
    assert.ok(check, '理由' + expErr.reasonNumber + '項目' + expErr.itemNumber + 'の検証結果');
    assert.equal(check.status, 'error');
    for (const code of expErr.codes) {
      assert.ok(check.issues.some((i) => i.code === code && i.severity === 'error'),
        code + ' を期待: ' + JSON.stringify(check.issues));
    }
  }
  // エラー項目以外は整合
  const others = result.consistencyChecks.filter(
    (c) => !exp.errorItems.some((e) => e.reasonNumber === c.reasonNumber && e.itemNumber === c.itemNumber));
  for (const c of others) {
    assert.equal(c.status, 'ok', '理由' + c.reasonNumber + '項目' + c.itemNumber + ': ' + JSON.stringify(c.messages));
  }

  assert.equal(result.omittedClaimCandidates.length, exp.omittedCandidateCount);
  assert.deepEqual(result.omittedClaimCandidates.map((o) => o.omittedClaim).sort((a, b) => a - b), exp.omittedClaims);
  if (exp.omittedAllInfo) {
    for (const o of result.omittedClaimCandidates) {
      assert.equal(o.severity, 'info');
      assert.equal(o.coveredElsewhereInReason, true);
      assert.equal(o.sourceClaim, 2);
    }
  }
  // 引用経路の表示（請求項5は 2 → 4 → 5 の間接引用）
  const via5 = result.omittedClaimCandidates.find((o) => o.omittedClaim === 5);
  assert.deepEqual(via5.dependencyPath, [2, 4, 5]);
  assert.equal(via5.inDirectDependency, false);

  assert.equal(result.metadata.issueCounts.error, exp.errorCount);
  // 拒絶理由が述べる引用関係は実構造と矛盾しない
  const stated = result.consistencyChecks
    .reduce((acc, c) => acc.concat(c.issues.filter((i) => i.code === 'STATED_DEPENDENCY_MISMATCH')), []);
  assert.equal(stated.length, exp.statedDependencyMismatches);
});

test('クレーム構造なし: 文章内の整合性検証だけが実行される', (t) => {
  const analyzer = loadAnalyzer(t);
  const text = analyzer && readFixture(t);
  if (!analyzer || !text) return;
  const result = analyzer.analyze(text);
  assert.equal(result.claimStructure, null);
  assert.equal(result.consistencyChecks.length, 6);
  assert.deepEqual(result.omittedClaimCandidates, []);
  // 修正注記まわりの不一致は構造が無くても検出できる
  const check = result.consistencyChecks.find((c) => c.reasonNumber === 2 && c.itemNumber === 2);
  assert.equal(check.status, 'error');
  assert.deepEqual(check.unexpectedInConclusion, [5]);
  assert.equal(result.metadata.claimStats.totalClaimCountSource, 'estimated');
});

test('統合: 29条合成サンプル（examples-article29）の集約ビュー', (t) => {
  const analyzer = loadAnalyzer(t);
  if (!analyzer) return;
  const exPath = path.join(__dirname, '..', 'examples', 'examples-article29.js');
  if (!fs.existsSync(exPath)) { t.skip('examples-article29 未作成のため skip'); return; }
  const ex29 = require('../examples/examples-article29');
  const result = analyzer.analyze(ex29.text);
  assert.equal(result.noveltyInventiveStep.references.length, 3);
  assert.equal(result.noveltyInventiveStep.mappings.length, 3);
  const subs = result.noveltyInventiveStep.mappings.map((m) => m.subCategory);
  assert.deepEqual(subs, ['novelty', 'inventiveStep', 'inventiveStep']);
  assert.deepEqual(result.noveltyInventiveStep.mappings[0].claims, [1, 8]);
  assert.deepEqual(result.noveltyInventiveStep.mappings[2].referenceNumbers, [1, 3]);
  // 引用文献一覧は除外されず、名称が対応付いている
  assert.equal(result.noveltyInventiveStep.references[0].name, '特開２０２０－１２３４５６号公報');
});
