'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('サンプル: テストハーネスが動く', () => {
  assert.equal(1 + 1, 2);
});

// リポジトリ共有の fixtures/ を読むテストのお手本。
// fixtures はモノレポのチェックアウトにのみ存在するため、プロジェクト単独コピーでは skip する。
test('fixtures を読むテストの雛形', (t) => {
  // TODO(template): ページ種別・ページ名を書き換える
  const fixture = path.join(ROOT, '..', 'fixtures', 'TODO-ページ種別', 'new', 'TODO-ページ名.html');
  if (!fs.existsSync(fixture)) {
    t.skip('fixtures が見つからないため skip（プロジェクト単独コピー環境）');
    return;
  }
  const html = fs.readFileSync(fixture, 'utf8');
  assert.ok(html.length > 0);
});
