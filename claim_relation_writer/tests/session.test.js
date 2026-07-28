'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../src/core/parser');
const session = require('../src/core/session');
const examples = require('../examples/examples');

function stateWithTree(treeKey, issueText, relatedText, issueType) {
  const state = session.createEmptyState();
  state.treeText = examples.trees[treeKey].text;
  const parsed = parser.parseClaimTree(state.treeText);
  assert.equal(parsed.ok, true, treeKey + ' の解析に失敗');
  state.graph = parsed.graph;
  state.issueClaimsText = issueText || '';
  state.relatedClaimsText = relatedText || '';
  state.issueType = issueType || 'clarity';
  return state;
}

test('createEmptyState: 既定値', () => {
  assert.deepEqual(session.createEmptyState(), {
    treeText: '',
    graph: null,
    issueType: 'clarity',
    issueClaimsText: '',
    relatedClaimsText: '',
    generatedText: '',
    currentStep: 1,
  });
});

test('generateFromState: ゴールデン提示例1と一致', () => {
  const state = stateWithTree('tree1', '1', '21');
  const gen = session.generateFromState(state);
  assert.equal(gen.ok, true);
  const golden = examples.goldenCases.find((c) => c.id === 'case1-clarity');
  assert.equal(gen.text, golden.expectedText);
  assert.deepEqual(gen.resolved.allAffectedClaims, golden.expectedSets.allAffectedClaims);
});

test('resolveFromState: エラー系（未解析・不正入力・指摘空・存在しない番号）', () => {
  assert.equal(session.resolveFromState(session.createEmptyState()).ok, false);

  const bad = session.resolveFromState(stateWithTree('tree1', 'abc', ''));
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('指摘する請求項'));

  const empty = session.resolveFromState(stateWithTree('tree1', '', ''));
  assert.equal(empty.ok, false);
  assert.ok(empty.error.includes('1つ以上'));

  const unknown = session.resolveFromState(stateWithTree('tree1', '99', ''));
  assert.equal(unknown.ok, false);
  assert.ok(unknown.error.includes('99'));
});

test('invalidateDownstream: 上流変更で生成済み文章が無効化される（H-1回帰）', () => {
  const state = stateWithTree('tree1', '1', '');
  const gen = session.generateFromState(state);
  assert.equal(gen.ok, true);
  state.generatedText = gen.text;

  // 指摘する請求項を 1→2 に変更（opus レビュー H-1 の再現シナリオ）
  const afterIssueChange = session.invalidateDownstream(
    Object.assign({}, state, { issueClaimsText: '2' }),
    'issueClaimsText'
  );
  assert.equal(afterIssueChange.generatedText, '', '旧生成文がコピー可能なまま残ってはならない');
  assert.notEqual(afterIssueChange.graph, null, '構造は変わっていないので graph は維持');

  // 指摘事項の切替（明確性 → サポート要件）
  const afterTypeChange = session.invalidateDownstream(
    Object.assign({}, state, { issueType: 'support' }),
    'issueType'
  );
  assert.equal(afterTypeChange.generatedText, '');

  // 関連する請求項の変更
  const afterRelatedChange = session.invalidateDownstream(
    Object.assign({}, state, { relatedClaimsText: '21' }),
    'relatedClaimsText'
  );
  assert.equal(afterRelatedChange.generatedText, '');

  // クレーム構造の変更 → graph も無効化
  const afterTreeChange = session.invalidateDownstream(
    Object.assign({}, state, { treeText: '1 ━ 2' }),
    'treeText'
  );
  assert.equal(afterTreeChange.generatedText, '');
  assert.equal(afterTreeChange.graph, null);
});

test('restoreState: 整合する保存データは生成文ごと復元され Step4 を維持', () => {
  const state = stateWithTree('tree1', '1', '21');
  const gen = session.generateFromState(state);
  const restored = session.restoreState({
    treeText: state.treeText,
    issueType: 'clarity',
    issueClaimsText: '1',
    relatedClaimsText: '21',
    generatedText: gen.text,
    currentStep: 4,
  });
  assert.equal(restored.generatedText, gen.text);
  assert.equal(restored.currentStep, 4);
  assert.notEqual(restored.graph, null);
});

test('restoreState: 生成後に指摘が変更された不整合ペアは生成文を破棄し Step3 へ', () => {
  const state = stateWithTree('tree1', '1', '21');
  const gen = session.generateFromState(state);
  const restored = session.restoreState({
    treeText: state.treeText,
    issueType: 'clarity',
    issueClaimsText: '2', // 生成時は 1 だった
    relatedClaimsText: '21',
    generatedText: gen.text,
    currentStep: 4,
  });
  assert.equal(restored.generatedText, '');
  assert.equal(restored.currentStep, 3);
});

test('restoreState: 指摘種別だけ食い違う場合も生成文を破棄', () => {
  const state = stateWithTree('tree1', '1', '21');
  const gen = session.generateFromState(state); // clarity で生成
  const restored = session.restoreState({
    treeText: state.treeText,
    issueType: 'support',
    issueClaimsText: '1',
    relatedClaimsText: '21',
    generatedText: gen.text,
    currentStep: 4,
  });
  assert.equal(restored.generatedText, '');
});

test('restoreState: 構造が解析できなければ Step1 に戻し生成文も破棄', () => {
  const restored = session.restoreState({
    treeText: '1 2', // 構文エラーになる入力
    issueType: 'clarity',
    issueClaimsText: '1',
    relatedClaimsText: '',
    generatedText: 'なんらかの旧文',
    currentStep: 4,
  });
  assert.equal(restored.graph, null);
  assert.equal(restored.currentStep, 1);
  assert.equal(restored.generatedText, '');
});

test('restoreState: 現在の構造に存在しない請求項が指定されていたら生成文を破棄', () => {
  const state = stateWithTree('tree1', '1', '21');
  const gen = session.generateFromState(state);
  const restored = session.restoreState({
    treeText: examples.trees.tree3.text, // 1項のみの構造に差し替わっている
    issueType: 'clarity',
    issueClaimsText: '1',
    relatedClaimsText: '21',
    generatedText: gen.text,
    currentStep: 4,
  });
  assert.equal(restored.generatedText, '');
  assert.equal(restored.currentStep, 3);
});

test('restoreState: Step2/3 は生成文がなくても維持される', () => {
  const state = stateWithTree('tree1', '', '');
  const restored = session.restoreState({
    treeText: state.treeText,
    issueType: 'support',
    issueClaimsText: '',
    relatedClaimsText: '',
    generatedText: '',
    currentStep: 2,
  });
  assert.equal(restored.currentStep, 2);
  assert.equal(restored.issueType, 'support');
});

test('restoreState: 型が壊れた保存データ・null は既定値に落ちる', () => {
  const broken = session.restoreState({
    treeText: 123,
    issueType: 'x',
    issueClaimsText: null,
    relatedClaimsText: {},
    generatedText: 42,
    currentStep: 'abc',
  });
  assert.deepEqual(broken, session.createEmptyState());
  assert.deepEqual(session.restoreState(null), session.createEmptyState());
  assert.deepEqual(session.restoreState(undefined), session.createEmptyState());
});
