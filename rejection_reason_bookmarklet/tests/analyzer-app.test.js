'use strict';
/*
 * analyzer-app.test.js — モーダルUIの起動まわりの検証
 *
 * jsdom を持たない（依存ゼロの）リポジトリなので、必要最小限の DOM スタブを自作して
 * 連結済みバンドルを実行し、起動の不変条件だけを確かめる。描画内容の検証はしない。
 *   - 起動時にクレーム構造を自動取得すること（ボタン操作なし）
 *   - 取得に失敗しても例外を投げず、入力画面が必ず表示されること
 *   - 再実行でホストを重複生成しないこと
 *   - ホストがページから外れていた場合は作り直すこと（押しても何も出ない状態にしない）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'src', 'bookmarklet', 'common', 'analyzer-app.js');

// ---- 最小 DOM スタブ ------------------------------------------------------

function makeElement(doc, tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    style: {},
    dataset: {},
    open: false,
    children: [],
    parentNode: null,
    shadowRoot: null,
    ownerDocument: doc,
    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node === doc.body || node === doc;
    },
    set innerHTML(html) { this._html = html; this.children = parseStub(doc, html); for (const c of this.children) c.parentNode = this; },
    get innerHTML() { return this._html || ''; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { const i = this.children.indexOf(child); if (i !== -1) this.children.splice(i, 1); child.parentNode = null; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
    setAttribute(k, v) { if (k === 'id') this.id = v; this[k] = v; },
    getAttribute(k) { return this[k]; },
    removeAttribute(k) { delete this[k]; },
    attachShadow() { this.shadowRoot = makeShadowRoot(doc); return this.shadowRoot; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    insertAdjacentHTML() {},
  };
  return el;
}

// PANEL_HTML から id を拾って要素を作る（q(id) が null を返さないようにするだけの簡易実装）
function parseStub(doc, html) {
  const out = [];
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const el = makeElement(doc, 'div');
    el.id = m[1];
    out.push(el);
    doc._byId.set(m[1], el);
  }
  return out;
}

function makeShadowRoot(doc) {
  const children = [];
  return {
    children,
    appendChild(child) { child.parentNode = null; children.push(child); return child; },
    getElementById(id) { return doc._byId.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeDocument() {
  const doc = {};
  doc._byId = new Map();
  doc.body = makeElement(doc, 'body');
  doc.createElement = (tag) => makeElement(doc, tag);
  doc.getElementById = (id) => {
    // body 直下のホストだけは実体を辿って返す（外れていたら null）
    for (const c of doc.body.children) if (c.id === id) return c;
    return null;
  };
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.contains = (node) => {
    let n = node;
    while (n) { if (n === doc.body) return true; n = n.parentNode; }
    return false;
  };
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  return doc;
}

// 連結済みバンドルを DOM スタブ上で実行し、RRB と document を返す
function bootstrap(collectImpl) {
  const build = require('../scripts/build-bookmarklets');
  const doc = makeDocument();
  const alerts = [];
  const sandbox = {
    document: doc,
    alert: (m) => alerts.push(String(m)),
    setTimeout: () => 0,
    clearTimeout: () => {},
    navigator: {},
    location: { href: 'about:blank' },
    getSelection: () => ({ toString: () => '' }),
    addEventListener: () => {},
    removeEventListener: () => {},
    open: () => null,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    Blob: function Blob() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(build.coreAndAppSource(), sandbox);
  if (collectImpl) sandbox.RRB.pageClaims.collect = collectImpl;
  return { sandbox, doc, alerts };
}

const hostCount = (doc) => doc.body.children.filter((c) => c.id === 'rrb-host').length;

// ---- テスト ---------------------------------------------------------------

test('起動: クレーム構造をボタン操作なしで自動取得する', (t) => {
  if (!fs.existsSync(APP)) { t.skip('analyzer-app.js なし'); return; }
  let called = 0;
  const { sandbox, doc } = bootstrap(() => {
    called++;
    return { ok: false, error: 'テスト用（取得なし）' };
  });
  sandbox.RRB.analyzerApp.launch({ target: 'new', label: '拒絶理由分析' });
  assert.equal(called, 1, '起動時に pageClaims.collect が自動で呼ばれること');
  assert.equal(hostCount(doc), 1, 'モーダルのホストが生成されること');
});

test('起動: 取得が例外を投げても起動を妨げない', (t) => {
  if (!fs.existsSync(APP)) { t.skip('analyzer-app.js なし'); return; }
  const { sandbox, doc, alerts } = bootstrap(() => { throw new Error('意図的な失敗'); });
  assert.doesNotThrow(() => sandbox.RRB.analyzerApp.launch({ target: 'new', label: '拒絶理由分析' }));
  assert.equal(hostCount(doc), 1, '例外が起きてもモーダルは表示されること');
  assert.deepEqual(alerts, [], 'alert は使わないこと');
});

test('起動: 取得が undefined を返しても起動を妨げない', (t) => {
  if (!fs.existsSync(APP)) { t.skip('analyzer-app.js なし'); return; }
  const { sandbox, doc } = bootstrap(() => undefined);
  assert.doesNotThrow(() => sandbox.RRB.analyzerApp.launch({ target: 'new', label: '拒絶理由分析' }));
  assert.equal(hostCount(doc), 1);
});

test('再実行: モーダルを重複生成せず、自動取得も繰り返さない', (t) => {
  if (!fs.existsSync(APP)) { t.skip('analyzer-app.js なし'); return; }
  let called = 0;
  const { sandbox, doc } = bootstrap(() => {
    called++;
    return { ok: true, structure: { source: 'test', sourceLabel: 'テスト', totalClaimCount: 2, totalClaimCountSource: 'claim_cite', claimNumbers: [1, 2], independentClaims: [1], claims: [], warnings: [], crossChecks: [] }, citeInfo: null };
  });
  sandbox.RRB.analyzerApp.launch({ target: 'new', label: '拒絶理由分析' });
  sandbox.RRB.analyzerApp.launch({ target: 'new', label: '拒絶理由分析' });
  assert.equal(hostCount(doc), 1, 'ホストは1つだけ');
  assert.equal(called, 1, '取得済みなら再取得しない（取得結果を壊さない）');
});

// 回帰: ページ側の描き換え等でホストが外れた状態で再実行すると、
// 以前は「押しても何も出ない」状態になっていた
test('再実行: ホストがページから外れていたら作り直す', (t) => {
  if (!fs.existsSync(APP)) { t.skip('analyzer-app.js なし'); return; }
  const { sandbox, doc } = bootstrap(() => ({ ok: false, error: 'テスト用' }));
  sandbox.RRB.analyzerApp.launch({ target: 'new', label: '拒絶理由分析' });
  assert.equal(hostCount(doc), 1);
  // ページ側がホストを取り除いた状況を作る
  doc.body.children.filter((c) => c.id === 'rrb-host').forEach((c) => c.remove());
  assert.equal(hostCount(doc), 0);
  sandbox.RRB.analyzerApp.launch({ target: 'new', label: '拒絶理由分析' });
  assert.equal(hostCount(doc), 1, 'モーダルが作り直されること');
});
