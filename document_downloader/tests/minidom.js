'use strict';
/*
 * minidom.js — テスト専用の最小 DOM（依存ゼロ）
 *
 * fixtures の保存済み HTML を Node 上で解析し、collector.js の CORE
 * （DOM 収集ロジック）をブラウザなしで検証するためだけに使う。
 * ブラウザの DOM 実装ではないので、collector.js が実際に使うセレクタの
 * 部分集合だけをサポートする:
 *   - タグ / #id / .class / [attr] / [attr="v"] / [attr*="v"]
 *   - 上記の複合（td.name, input[type="checkbox"][name="pubnum"] など）
 *   - 子孫結合子（スペース）とカンマ区切り
 * collector.js 側でこれ以外のセレクタを使い始めたら、ここも拡張すること。
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['script', 'style']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
  });
}

class MiniNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
}

class MiniText extends MiniNode {
  constructor(value) {
    super(3);
    this.nodeValue = value;
  }
  get textContent() { return this.nodeValue; }
}

class MiniElement extends MiniNode {
  constructor(tagName, attrs) {
    super(1);
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs || {};
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get className() { return this.attrs['class'] || ''; }
  get id() { return this.attrs['id'] || ''; }
  get textContent() {
    let out = '';
    for (const n of this.childNodes) out += n.textContent;
    return out;
  }
  get nextElementSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const sibs = p.children;
    const i = sibs.indexOf(this);
    return i > -1 && i + 1 < sibs.length ? sibs[i + 1] : null;
  }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, String(name).toLowerCase());
  }
  matches(selector) {
    return parseSelector(selector).some((seq) => matchSequence(this, seq));
  }
  closest(selector) {
    let el = this;
    while (el && el.nodeType === 1) {
      if (el.matches(selector)) return el;
      el = el.parentNode;
    }
    return null;
  }
  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }
  querySelectorAll(selector) {
    const groups = parseSelector(selector);
    const out = [];
    walkElements(this, (el) => {
      if (el !== this && groups.some((seq) => matchSequence(el, seq))) out.push(el);
    });
    return out;
  }
}

function walkElements(root, fn) {
  fn(root);
  for (const child of root.childNodes) {
    if (child.nodeType === 1) walkElements(child, fn);
  }
}

/* ---- セレクタ ------------------------------------------------ */
/* 'div.tbl_others table tbody input[type="checkbox"]' →
 *   [[compound(div.tbl_others), compound(table), compound(tbody), compound(input[...])]] */
const selectorCache = new Map();

function parseSelector(selector) {
  const key = String(selector);
  if (selectorCache.has(key)) return selectorCache.get(key);
  const groups = key.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    if (/[>+~]/.test(part)) throw new Error('minidom: 未対応の結合子です: ' + part);
    return part.split(/\s+/).map(parseCompound);
  });
  selectorCache.set(key, groups);
  return groups;
}

function parseCompound(text) {
  const compound = { tag: '', id: '', classes: [], attrs: [] };
  const re = /(^[a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([*^$~|]?=)"?([^\]"]*)"?)?\]/g;
  let consumed = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    consumed += m[0].length;
    if (m[1]) compound.tag = m[1].toUpperCase();
    else if (m[2]) compound.id = m[2];
    else if (m[3]) compound.classes.push(m[3]);
    else if (m[4]) compound.attrs.push({ name: m[4].toLowerCase(), op: m[5] || '', value: m[6] === undefined ? '' : m[6] });
  }
  if (consumed !== text.length) throw new Error('minidom: 解釈できないセレクタです: ' + text);
  return compound;
}

function matchCompound(el, compound) {
  if (compound.tag && el.tagName !== compound.tag) return false;
  if (compound.id && el.getAttribute('id') !== compound.id) return false;
  if (compound.classes.length) {
    const list = String(el.getAttribute('class') || '').split(/\s+/);
    for (const c of compound.classes) if (list.indexOf(c) === -1) return false;
  }
  for (const a of compound.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (!a.op) continue;
    const v = String(el.getAttribute(a.name));
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '*=' && v.indexOf(a.value) === -1) return false;
    if (a.op === '^=' && v.indexOf(a.value) !== 0) return false;
    if (a.op === '$=' && v.slice(-a.value.length) !== a.value) return false;
  }
  return true;
}

/* 子孫結合子は末尾から遡って照合する */
function matchSequence(el, sequence) {
  let i = sequence.length - 1;
  if (!matchCompound(el, sequence[i])) return false;
  i--;
  let node = el.parentNode;
  while (i >= 0 && node && node.nodeType === 1) {
    if (matchCompound(node, sequence[i])) i--;
    node = node.parentNode;
  }
  return i < 0;
}

/* ---- パーサ -------------------------------------------------- */
function parseAttributes(text) {
  const attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    if (!name || name === '/') continue;
    let value = '';
    if (m[3] !== undefined) value = m[3];
    else if (m[4] !== undefined) value = m[4];
    else if (m[5] !== undefined) value = m[5];
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function parseHTML(html) {
  const source = String(html).replace(/^﻿/, '');
  const root = new MiniElement('#root', {});
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;

  const appendText = (text) => {
    if (!text) return;
    const node = new MiniText(decodeEntities(text));
    node.parentNode = top();
    top().childNodes.push(node);
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) { appendText(source.slice(i)); break; }
    if (lt > i) appendText(source.slice(i, lt));

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('</', lt)) {
      const end = source.indexOf('>', lt);
      if (end === -1) { i = source.length; continue; }
      const name = source.slice(lt + 2, end).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName === name.toUpperCase()) { stack.length = s; break; }
      }
      i = end + 1;
      continue;
    }

    const end = source.indexOf('>', lt);
    if (end === -1) { appendText(source.slice(lt)); break; }
    const inner = source.slice(lt + 1, end);
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(inner);
    if (!nameMatch) { appendText(source.slice(lt, end + 1)); i = end + 1; continue; }
    const tag = nameMatch[1].toLowerCase();
    const el = new MiniElement(tag, parseAttributes(inner.slice(nameMatch[1].length)));
    el.parentNode = top();
    top().childNodes.push(el);
    i = end + 1;

    if (VOID.has(tag) || /\/\s*$/.test(inner)) continue;
    if (RAWTEXT.has(tag)) {
      const close = source.toLowerCase().indexOf('</' + tag, i);
      const stop = close === -1 ? source.length : close;
      const raw = source.slice(i, stop);
      if (raw) {
        const node = new MiniText(raw);
        node.parentNode = el;
        el.childNodes.push(node);
      }
      const closeEnd = close === -1 ? source.length : source.indexOf('>', close);
      i = closeEnd === -1 ? source.length : closeEnd + 1;
      continue;
    }
    stack.push(el);
  }

  const doc = {
    nodeType: 9,
    documentElement: root.querySelector('html') || root,
    body: root.querySelector('body') || root,
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
  };
  return doc;
}

module.exports = { parseHTML, decodeEntities, MiniElement, MiniText };
