'use strict';
/*
 * helpers.js — テスト共通のフィクスチャ読み込み（依存ゼロ）
 *
 * 共有の fixtures/claim-checker/new/ を読む。リポジトリ全体をチェックアウトしていない
 * 環境では、fixtures が無いことを検出してテスト側で skip できるようにする。
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'fixtures', 'claim-checker', 'new');

// 台帳（fixtures/README.md）の名前と対応させる
const FIXTURES = {
  parallelTree: '書類比較・クレームチェッカー_特願2025-557557.html',
  categoryTrio: '書類比較・クレームチェッカー_特願2024-203062.html',
  multiIndependent: '書類比較・クレームチェッカー_特願2024-536222.html',
  overflow: '書類比較・クレームチェッカー_引用パターン上限到達.html',
  base: '書類比較・クレームチェッカー.html',
  // 新 UI（2026 年〜）: #claim_mark の境界が CLMNM から span.claim_num に変わり、
  // 用語クラス（zenki_wdXX）が無くなったスナップショット
  newClaimMark: '書類比較・クレームチェッカー_特願2025-557197.html',
};

function fixturePath(key) {
  return path.join(FIXTURE_DIR, FIXTURES[key] || key);
}

function hasFixture(key) {
  try { return fs.statSync(fixturePath(key)).isFile(); } catch (e) { return false; }
}

function readFixture(key) {
  return fs.readFileSync(fixturePath(key), 'utf8');
}

function loadDocument(key) {
  const { parseHTML } = require('./minidom');
  return parseHTML(readFixture(key));
}

function extract(key) {
  const extractor = require('../src/extract/extractor');
  return extractor.extractClaims(loadDocument(key));
}

// 比較タブ用の空 document（about:blank の代わり）
function blankDocument() {
  const { parseHTML } = require('./minidom');
  return parseHTML('<!DOCTYPE html><html lang="ja"><head><title></title></head><body></body></html>');
}

// window の代役。resize 購読と requestAnimationFrame だけ使う
function fakeWindow(doc, innerWidth) {
  const listeners = {};
  return {
    document: doc,
    innerWidth: innerWidth || 1920,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type) { for (const fn of (listeners[type] || []).slice()) fn({ type }); },
    setTimeout(fn) { fn(); return 0; },
  };
}

// グループ内の全カードを番号で引く
function cardNumbers(doc) {
  return doc.querySelectorAll('.jcgc-card').map((el) => Number(el.getAttribute('data-claim')));
}

function groupNumbers(groups, predicate) {
  return groups.filter(predicate).map((g) => g.claimNumbers.join(','));
}

// グループ集合の中に、指定の請求項をすべて含むグループがあるか
function hasGroupContaining(groups, numbers) {
  return groups.some((g) => numbers.every((n) => g.claimNumbers.indexOf(n) !== -1));
}

function findGroupContaining(groups, numbers) {
  return groups.find((g) => numbers.every((n) => g.claimNumbers.indexOf(n) !== -1)) || null;
}

module.exports = {
  REPO_ROOT, FIXTURE_DIR, FIXTURES,
  fixturePath, hasFixture, readFixture, loadDocument, extract,
  blankDocument, fakeWindow,
  cardNumbers, groupNumbers, hasGroupContaining, findGroupContaining,
};
