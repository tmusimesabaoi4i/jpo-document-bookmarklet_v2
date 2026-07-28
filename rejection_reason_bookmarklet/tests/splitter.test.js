'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const normalizer = require('../src/core/normalizer');
const splitter = require('../src/core/splitter');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'rejection-reason', '拒絶理由例.txt');

function prep(text) {
  return normalizer.removeNonReasonSections(text);
}

const LEADING_SAMPLE = [
  '',
  '１．（明確性）この出願は、特許請求の範囲の記載が下記の点で、特許法第３６条第６項第２号に規定する要件を満たしていない。',
  '',
  '２．（サポート要件）この出願は、特許請求の範囲の記載が下記の点で、特許法第３６条第６項第１号に規定する要件を満たしていない。',
  '',
  '　　　　　　　　　　　　　　　　　記',
  '',
  '●理由１（明確性）について',
  '',
  '・請求項 １',
  '　よって、請求項１に係る発明は明確でない。',
  '',
].join('\n');

test('冒頭理由一覧: 番号・ラベル・区分・法条', () => {
  const { body, matchBody } = prep(LEADING_SAMPLE);
  const list = splitter.parseLeadingReasonList(matchBody, body);
  assert.equal(list.length, 2);
  assert.equal(list[0].num, 1);
  assert.equal(list[0].label, '明確性');
  assert.equal(list[0].category, 'clarity');
  assert.equal(list[0].legalBasis, '特許法第36条第6項第2号');
  assert.equal(list[1].category, 'support');
  assert.equal(list[1].legalBasis, '特許法第36条第6項第1号');
});

test('理由分割: fixture は 2 セクション・見出しラベルつき', (t) => {
  if (!fs.existsSync(FIXTURE)) { t.skip('fixtures なし'); return; }
  const { body, matchBody } = prep(fs.readFileSync(FIXTURE, 'utf8'));
  const { sections, preambleRaw } = splitter.splitReasonSections(body, matchBody);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].reasonNumber, 1);
  assert.equal(sections[0].headingLabel, '明確性');
  assert.equal(sections[1].reasonNumber, 2);
  assert.equal(sections[1].headingLabel, 'サポート要件');
  assert.ok(preambleRaw.indexOf('記') !== -1);
  // セクションの raw/match は同じ長さ（オフセット共有の前提）
  for (const s of sections) assert.equal(s.rawText.length, s.matchText.length);
});

test('理由分割: 見出しが無い場合は「記」以降を単一セクションにする', () => {
  const text = '１．（明確性）この出願は…\n\n　記\n\n・請求項 １\n　よって、請求項１に係る発明は明確でない。\n';
  const { body, matchBody } = prep(text);
  const { sections } = splitter.splitReasonSections(body, matchBody);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].reasonNumber, null);
  assert.equal(sections[0].headingLabel, null);
  assert.ok(sections[0].matchText.indexOf('・請求項') !== -1);
});

test('理由分類: 見出し優先・一覧との矛盾は警告のみ', () => {
  const section = { reasonNumber: 1, headingLabel: '明確性', headingRaw: '●理由１（明確性）について', matchText: '', rawText: '' };
  const list = [{ num: 1, label: 'サポート要件', category: 'support', legalBasis: '特許法第36条第6項第1号', article: null }];
  const cls = splitter.classifyReason(section, list);
  assert.equal(cls.category, 'clarity');
  assert.ok(cls.warnings.some((w) => w.code === 'REASON_LIST_MISMATCH'));
});

test('理由分類: 見出しなしは一覧→法条の順で補完', () => {
  const noHeading = { reasonNumber: 1, headingLabel: null, headingRaw: null, matchText: 'この出願は特許法第29条第2項の規定により特許を受けることができない。', rawText: '' };
  const cls = splitter.classifyReason(noHeading, []);
  assert.equal(cls.category, 'inventiveStep');
  assert.equal(cls.confidence, 'medium');

  const nothing = { reasonNumber: 1, headingLabel: null, headingRaw: null, matchText: 'なにもない', rawText: '' };
  const cls2 = splitter.classifyReason(nothing, []);
  assert.equal(cls2.category, 'other');
  assert.equal(cls2.confidence, 'low');
});

test('結論表現の区分判定', () => {
  assert.equal(splitter.categoryFromConclusion('よって、請求項２-７に係る発明は明確でない。'), 'clarity');
  assert.equal(splitter.categoryFromConclusion('よって、請求項１９-２０に係る発明は、発明の詳細な説明に記載したものでない。'), 'support');
  assert.equal(splitter.categoryFromConclusion('…特許を受けることができない。'), 'article29');
  assert.equal(splitter.categoryFromConclusion('…である。'), 'unknown');
});

test('項目分割: fixture 理由2 は 4 ブロック', (t) => {
  if (!fs.existsSync(FIXTURE)) { t.skip('fixtures なし'); return; }
  const { body, matchBody } = prep(fs.readFileSync(FIXTURE, 'utf8'));
  const { sections } = splitter.splitReasonSections(body, matchBody);
  const { preamble, blocks, trailing } = splitter.splitIssueBlocks(sections[1]);
  assert.equal(blocks.length, 4);
  assert.equal(preamble.rawText.trim(), '');
  assert.equal(trailing, null);
  assert.ok(blocks[1].headingLineRaw.indexOf('（修正：５を除く）') !== -1);
  for (const b of blocks) assert.equal(b.rawText.length, b.matchText.length);
});

test('項目分割: 29条系の ・引用文献等 / ・備考 は同一ブロックに含まれる', () => {
  const text = [
    '●理由１（新規性）について',
    '',
    '・請求項 １、８',
    '・引用文献等 １',
    '・備考',
    '　引用文献１には…が記載されている。',
    '',
    '・請求項 ２-４',
    '・引用文献等 １、２',
    '・備考',
    '　引用文献２には…が記載されている。',
    '',
  ].join('\n');
  const { body, matchBody } = prep(text);
  const { sections } = splitter.splitReasonSections(body, matchBody);
  const { blocks } = splitter.splitIssueBlocks(sections[0]);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].matchText.indexOf('・引用文献等 1') !== -1);
  assert.ok(blocks[0].matchText.indexOf('・備考') !== -1);
  assert.ok(blocks[1].matchText.indexOf('・引用文献等 1、2') !== -1);
});

test('項目分割: ＜引用文献等一覧＞で終端し trailing に回る', () => {
  const text = [
    '●理由１（新規性）について',
    '',
    '・請求項 １',
    '・引用文献等 １',
    '・備考',
    '　引用文献１には…が記載されている。',
    '',
    '　　＜引用文献等一覧＞',
    '１．特開２０２０－１２３４５６号公報',
    '',
  ].join('\n');
  const { body, matchBody } = prep(text);
  const { sections } = splitter.splitReasonSections(body, matchBody);
  const { blocks, trailing } = splitter.splitIssueBlocks(sections[0]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].matchText.indexOf('引用文献等一覧'), -1);
  assert.notEqual(trailing, null);
  assert.ok(trailing.rawText.indexOf('特開２０２０－１２３４５６号公報') !== -1);
});
