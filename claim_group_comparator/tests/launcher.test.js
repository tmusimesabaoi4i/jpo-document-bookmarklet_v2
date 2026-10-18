'use strict';
const test = require('node:test');
const assert = require('node:assert');
const launcherApp = require('../src/bookmarklet/common/launcher-app');
const helpers = require('./helpers');
const { parseHTML } = require('./minidom');

// window.open の代役。開かれた擬似ウィンドウを記録する
function makeWindow(doc, options) {
  const opts = options || {};
  const opened = [];
  const listeners = {};
  const win = {
    document: doc,
    innerWidth: 1920,
    location: { search: opts.search || '' },
    opened,
    open() {
      if (opts.blocked) return null;
      const childDoc = helpers.blankDocument();
      const child = {
        document: childDoc,
        innerWidth: 1920,
        addEventListener() {},
        requestAnimationFrame(fn) { fn(); return 0; },
        setTimeout(fn) { fn(); return 0; },
      };
      opened.push(child);
      return child;
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type) { for (const fn of (listeners[type] || []).slice()) fn({ type }); },
    setTimeout(fn) { fn(); return 0; },
  };
  return win;
}

function launchOn(key, options) {
  const doc = typeof key === 'string' ? helpers.loadDocument(key) : key;
  const win = makeWindow(doc, options);
  const handle = launcherApp.launch({ document: doc, window: win });
  return { doc, win, handle };
}

test('ボタンを1つだけ置く（多重実行しても増やさない）', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const doc = helpers.loadDocument('parallelTree');
  const win = makeWindow(doc);
  const first = launcherApp.launch({ document: doc, window: win });
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.button.textContent, '請求項グループ比較を開く');

  const second = launcherApp.launch({ document: doc, window: win });
  assert.strictEqual(second.created, false);
  assert.strictEqual(doc.querySelectorAll('#jcgc-launcher').length, 1);
  assert.strictEqual(doc.querySelectorAll('#jcgc-launcher-style').length, 1);
});

test('起動時に元ページの Checker まわりの DOM を書き換えない', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const doc = helpers.loadDocument('parallelTree');
  const before = {
    mark: doc.querySelector('#claim_mark').innerHTML,
    cite: doc.querySelector('#claim_cite').innerHTML,
    tree: doc.querySelector('#claim_tree').innerHTML,
  };
  const win = makeWindow(doc);
  launcherApp.launch({ document: doc, window: win });
  win.document.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });

  assert.strictEqual(doc.querySelector('#claim_mark').innerHTML, before.mark);
  assert.strictEqual(doc.querySelector('#claim_cite').innerHTML, before.cite);
  assert.strictEqual(doc.querySelector('#claim_tree').innerHTML, before.tree);
  // 元ページに足すのはこの2つだけ
  const added = [];
  const walk = (node) => {
    if (node.nodeType === 1 && String(node.id).indexOf('jcgc') === 0) added.push(node.id);
    for (const child of node.childNodes) walk(child);
  };
  walk(doc.documentElement);
  assert.deepStrictEqual(added.sort(), ['jcgc-launcher', 'jcgc-launcher-style']);
});

test('クリックで新しいタブを開き、比較画面を描く', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const { doc, win } = launchOn('parallelTree');
  doc.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });

  assert.strictEqual(win.opened.length, 1, '新しいタブが開かれていない');
  const childDoc = win.opened[0].document;
  assert.ok(childDoc.querySelector('.jcgc-title'), '比較画面が描かれていない');
  assert.ok(childDoc.querySelectorAll('.jcgc-card').length >= 2);
  // 元ページの ID をそのまま複製していない
  assert.strictEqual(childDoc.querySelector('#claim_mark'), null);
  assert.strictEqual(childDoc.querySelector('#claim_cite'), null);
});

test('新しいタブを2回開いても互いに干渉しない', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const { doc, win } = launchOn('parallelTree');
  const button = doc.querySelector('#jcgc-launcher button');
  button.dispatchEvent({ type: 'click' });
  button.dispatchEvent({ type: 'click' });
  assert.strictEqual(win.opened.length, 2);

  const [a, b] = win.opened;
  const cardsA = a.document.querySelectorAll('.jcgc-card').length;
  // 片方のグループを切り替えても、もう片方は変わらない
  const selectB = b.document.querySelector('#jcgc-group-select');
  const options = selectB.querySelectorAll('option');
  assert.ok(options.length >= 2);
  b.document.querySelectorAll('.jcgc-seg')[0].dispatchEvent({ type: 'click' });
  assert.strictEqual(a.document.querySelectorAll('.jcgc-card').length, cardsA);
  assert.strictEqual(
    a.document.querySelectorAll('.jcgc-seg').filter((el) => el.getAttribute('class').indexOf('is-selected') !== -1).length,
    0, '別タブの段落選択が波及してはいけない');
});

test('ポップアップがブロックされたらボタン脇に案内を出す', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const { doc, win } = launchOn('parallelTree', { blocked: true });
  doc.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });
  assert.strictEqual(win.opened.length, 0);
  const message = doc.querySelector('#jcgc-launcher .jcgc-launch-msg').textContent;
  assert.ok(message.indexOf('ポップアップ') !== -1, message);
});

test('請求項が取れないときは案内文を出して止まらない', () => {
  const doc = parseHTML('<html><body><div id="claim_mark"></div><textarea id="doc1"></textarea></body></html>');
  const win = makeWindow(doc);
  launcherApp.launch({ document: doc, window: win });
  doc.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });

  const message = doc.querySelector('#jcgc-launcher .jcgc-launch-msg').textContent;
  assert.strictEqual(message, '請求項を取得できませんでした。先にクレーム解析を実行してください。');
  assert.strictEqual(win.opened.length, 1);
  assert.strictEqual(win.opened[0].document.querySelector('.jcgc-empty').textContent, message);
});

test('元タブを閉じるとき、開いた比較タブへ案内を出す', { skip: !helpers.hasFixture('parallelTree') }, () => {
  const { doc, win } = launchOn('parallelTree');
  doc.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });
  win.dispatch('beforeunload');
  const banner = win.opened[0].document.querySelector('#jcgc-banner');
  assert.ok(banner.textContent.indexOf('元のクレームチェッカーのタブが閉じられました') !== -1);
});

test('出願番号を URL の lappnum から読み取れる', () => {
  const doc = parseHTML('<html><body></body></html>');
  assert.strictEqual(
    launcherApp.readLappnum(doc, { search: '?lappnum=12025557557' }), '特願2025-557557');
  assert.strictEqual(launcherApp.readLappnum(doc, { search: '' }), '');
});

test('出願番号は入力欄を優先して読む', () => {
  const doc = parseHTML('<html><body><input id="lappnum2" value="特願2024-536222"></body></html>');
  assert.strictEqual(
    launcherApp.readLappnum(doc, { search: '?lappnum=12025557557' }), '特願2024-536222');
});

test('自動グルーピングに失敗しても、抽出できた請求項は表示する（縮退動作）', () => {
  const doc = parseHTML('<html><body><div id="claim_mark"></div><textarea id="doc1">'
    + '【請求項１】\n　第1の対象を処理する装置であって、値を取得する取得部を備える装置。\n'
    + '【請求項２】\n　請求項１に記載の装置であって、前記値は所定の周期で測定される装置。'
    + '</textarea></body></html>');
  const win = makeWindow(doc);
  launcherApp.launch({ document: doc, window: win });

  // グルーピングが例外を投げる状況を再現する（凍結したレコードは内部キャッシュを書けない）
  const frozen = [Object.freeze({ number: 1 }), Object.freeze({ number: 2 })];
  const broken = launcherApp.safeAutoGroup(frozen, 'broad');
  assert.ok(broken.error, '例外が握りつぶされて error に入る');
  assert.strictEqual(broken.groups.length, 1);
  assert.strictEqual(broken.groups[0].name, '全請求項');
  assert.deepStrictEqual(broken.groups[0].claimNumbers, [1, 2]);

  // 実際の起動も止まらない
  doc.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });
  assert.strictEqual(win.opened.length, 1);
  assert.ok(win.opened[0].document.querySelectorAll('.jcgc-card').length >= 2);
});

test('グループが1つも作れない案件でも、全請求項のグループを出す', () => {
  const doc = parseHTML('<html><body><div id="claim_mark"></div><textarea id="doc1">'
    + '【請求項１】\n　単独の対象を処理する装置であって、値を取得する取得部を備える装置。'
    + '</textarea></body></html>');
  const win = makeWindow(doc);
  launcherApp.launch({ document: doc, window: win });
  doc.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });
  const childDoc = win.opened[0].document;
  assert.strictEqual(childDoc.querySelectorAll('.jcgc-card').length, 1);
  assert.ok(childDoc.querySelector('.jcgc-groupinfo').textContent.indexOf('全請求項') !== -1);
});

test('新 UI（span.claim_num）の実ページでも起動して比較画面を描く',
  { skip: !helpers.hasFixture('newClaimMark') }, () => {
    const { doc, win } = launchOn('newClaimMark');
    doc.querySelector('#jcgc-launcher button').dispatchEvent({ type: 'click' });

    assert.strictEqual(win.opened.length, 1, '新しいタブが開かれていない');
    const childDoc = win.opened[0].document;
    assert.ok(childDoc.querySelector('.jcgc-title'), '比較画面が描かれていない');
    assert.ok(childDoc.querySelectorAll('.jcgc-card').length >= 2, '比較カードが描かれていない');
    // 元ページは読み取り専用（#claim_mark を書き換えない）
    assert.ok(doc.querySelector('#claim_mark'));
  });
