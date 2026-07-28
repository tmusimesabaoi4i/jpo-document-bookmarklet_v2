'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sampleData = require('../src/bookmarklet/common/sample-data');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'rejection-reason', '拒絶理由例.txt');

test('サンプルデータ: 空でなく主要な見出しを含む', () => {
  assert.ok(sampleData.text.length > 1000);
  assert.ok(sampleData.text.indexOf('●理由１（明確性）について') !== -1);
  assert.ok(sampleData.text.indexOf('●理由２（サポート要件）について') !== -1);
});

// 埋め込みサンプルは fixture の機械生成コピー。乖離したら再生成が必要
test('サンプルデータ: fixtures/rejection-reason/拒絶理由例.txt と同一', (t) => {
  if (!fs.existsSync(FIXTURE)) {
    t.skip('fixtures が見つからないため skip（プロジェクト単独コピー環境）');
    return;
  }
  const fixture = fs.readFileSync(FIXTURE, 'utf8').replace(/\r\n?/g, '\n');
  assert.equal(sampleData.text, fixture);
});
