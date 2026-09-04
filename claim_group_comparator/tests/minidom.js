'use strict';
/*
 * minidom.js — テスト専用の最小 DOM（依存ゼロ）
 *
 * fixtures の保存済み HTML を Node 上で解析し、抽出・グルーピング・比較画面の描画を
 * ブラウザなしで検証するためだけに使う。
 *
 * term_marker/tests/minidom.js を取り込み（そちらは document_downloader からの取り込み）、
 * このプロジェクトの比較画面が使う機能を足した:
 *   - フォーム要素の value（input / textarea / select）
 *   - addEventListener / removeEventListener / dispatchEvent（**バブリングあり**。
 *     カード上のイベント委譲を検証するために必須）
 *   - document.getElementById
 * ルート README「プロジェクト間の独立性」に従い参照ではなくコピーしている。
 * 一方を直したら他方も直すか判断すること。
 *
 * ブラウザの DOM 実装ではないので、次の部分集合だけをサポートする:
 *   - セレクタ: タグ / #id / .class / [attr] / [attr="v"] / [attr*="v"] とその複合、
 *     子孫結合子（スペース）、カンマ区切り
 *   - html / head / body が無いスナップショットにはブラウザ同様に補う
 *   - コメント <!-- --> はノード（nodeType 8）として保持する（normalize で隣接テキストが
 *     コメント越しに結合されない、というブラウザの挙動を再現するため）
 * marker.js 側でこれ以外を使い始めたら、ここも拡張すること。
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['script', 'style']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };

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

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00A0/g, '&nbsp;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\u00A0/g, '&nbsp;');
}

/* ---- ノード ---------------------------------------------------- */
class MiniNode {
  constructor(nodeType, ownerDocument) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = ownerDocument || null;
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get firstChild() { return this.childNodes.length ? this.childNodes[0] : null; }
  get lastChild() { return this.childNodes.length ? this.childNodes[this.childNodes.length - 1] : null; }
  get nextSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return i > -1 && i + 1 < p.childNodes.length ? p.childNodes[i + 1] : null;
  }
  get previousSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return i > 0 ? p.childNodes[i - 1] : null;
  }
  get textContent() {
    let out = '';
    for (const n of this.childNodes) out += n.textContent;
    return out;
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new MiniText(String(v), this.ownerDocument));
  }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    if (node.nodeType === 11) {
      const kids = node.childNodes.slice();
      for (const k of kids) this.insertBefore(k, ref);
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    const idx = ref ? this.childNodes.indexOf(ref) : -1;
    if (ref && idx === -1) throw new Error('minidom: insertBefore の参照ノードが子ではありません');
    if (idx === -1) this.childNodes.push(node);
    else this.childNodes.splice(idx, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i === -1) throw new Error('minidom: removeChild の対象が子ではありません');
    this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(newNode, oldNode) {
    if (this.childNodes.indexOf(oldNode) === -1) throw new Error('minidom: replaceChild の対象が子ではありません');
    this.insertBefore(newNode, oldNode);
    this.removeChild(oldNode);
    return oldNode;
  }
  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  /* 隣接するテキストノードを結合し、空のテキストノードを除去（ブラウザの Node.normalize と同じ） */
  normalize() {
    let i = 0;
    while (i < this.childNodes.length) {
      const n = this.childNodes[i];
      if (n.nodeType === 3) {
        if (n.nodeValue === '') { this.childNodes.splice(i, 1); n.parentNode = null; continue; }
        while (i + 1 < this.childNodes.length && this.childNodes[i + 1].nodeType === 3) {
          const next = this.childNodes[i + 1];
          n.nodeValue += next.nodeValue;
          next.parentNode = null;
          this.childNodes.splice(i + 1, 1);
        }
      } else if (n.nodeType === 1) {
        n.normalize();
      }
      i++;
    }
  }
}

class MiniText extends MiniNode {
  constructor(value, ownerDocument) {
    super(3, ownerDocument);
    this.nodeValue = value;
  }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
  get data() { return this.nodeValue; }
  set data(v) { this.nodeValue = String(v); }
  cloneNode() { return new MiniText(this.nodeValue, this.ownerDocument); }
}

class MiniComment extends MiniNode {
  constructor(value, ownerDocument) {
    super(8, ownerDocument);
    this.nodeValue = value;
  }
  get textContent() { return ''; }
  cloneNode() { return new MiniComment(this.nodeValue, this.ownerDocument); }
}

class MiniFragment extends MiniNode {
  constructor(ownerDocument) { super(11, ownerDocument); }
  cloneNode(deep) {
    const f = new MiniFragment(this.ownerDocument);
    if (deep) for (const c of this.childNodes) f.appendChild(c.cloneNode(true));
    return f;
  }
}

class MiniElement extends MiniNode {
  constructor(tagName, attrs, ownerDocument) {
    super(1, ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs || {};
  }
  get localName() { return this.tagName.toLowerCase(); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get className() { return this.attrs['class'] || ''; }
  set className(v) { this.attrs['class'] = String(v); }
  get id() { return this.attrs['id'] || ''; }
  set id(v) { this.attrs['id'] = String(v); }
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
  setAttribute(name, value) { this.attrs[String(name).toLowerCase()] = String(value); }
  removeAttribute(name) { delete this.attrs[String(name).toLowerCase()]; }
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
  cloneNode(deep) {
    const el = new MiniElement(this.tagName, Object.assign({}, this.attrs), this.ownerDocument);
    if (deep) for (const c of this.childNodes) el.appendChild(c.cloneNode(true));
    return el;
  }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  get outerHTML() { return serialize(this); }

  /* ---- フォーム要素の value（比較タブの UI がこの形で読み書きする） ---- */
  get value() {
    if (Object.prototype.hasOwnProperty.call(this, '_value')) return this._value;
    if (this.tagName === 'TEXTAREA') return this.textContent;
    if (this.tagName === 'SELECT') {
      const selected = this.querySelectorAll('option').find((o) => o.hasAttribute('selected'));
      const first = this.querySelectorAll('option')[0];
      const target = selected || first;
      return target ? (target.getAttribute('value') || target.textContent) : '';
    }
    return this.getAttribute('value') || '';
  }
  set value(v) { this._value = String(v); }

  /* ---- イベント（バブリングつき。イベント委譲のテストに必要） ---- */
  addEventListener(type, handler) {
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
  }
  removeEventListener(type, handler) {
    if (!this._listeners || !this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter((h) => h !== handler);
  }
  dispatchEvent(event) {
    const evt = event && typeof event === 'object' ? event : { type: String(event) };
    if (!evt.target) evt.target = this;
    if (typeof evt.preventDefault !== 'function') evt.preventDefault = function preventDefault() { evt.defaultPrevented = true; };
    let node = this;
    while (node) {
      evt.currentTarget = node;
      const handlers = node._listeners && node._listeners[evt.type];
      if (handlers) for (const handler of handlers.slice()) handler.call(node, evt);
      if (evt.cancelBubble) break;
      node = node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : null;
    }
    return !evt.defaultPrevented;
  }
  // テスト用のショートカット
  click() { return this.dispatchEvent({ type: 'click' }); }
}

function serialize(node) {
  if (node.nodeType === 3) {
    const p = node.parentNode;
    if (p && p.nodeType === 1 && RAWTEXT.has(p.tagName.toLowerCase())) return node.nodeValue;
    return escapeText(node.nodeValue);
  }
  if (node.nodeType === 8) return '<!--' + node.nodeValue + '-->';
  if (node.nodeType === 11) return node.childNodes.map(serialize).join('');
  const tag = node.tagName.toLowerCase();
  let s = '<' + tag;
  for (const k of Object.keys(node.attrs)) s += ' ' + k + '="' + escapeAttr(node.attrs[k]) + '"';
  s += '>';
  if (VOID.has(tag)) return s;
  s += node.childNodes.map(serialize).join('');
  return s + '</' + tag + '>';
}

function walkElements(root, fn) {
  fn(root);
  for (const child of root.childNodes) {
    if (child.nodeType === 1) walkElements(child, fn);
  }
}

/* ---- セレクタ ------------------------------------------------ */
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

/* ---- ドキュメント --------------------------------------------- */
class MiniDocument {
  constructor() {
    this.nodeType = 9;
    this.doctype = null;
    this.documentElement = null;
    this.childNodes = [];
  }
  get head() { return this.documentElement.children.find((c) => c.tagName === 'HEAD') || null; }
  get body() { return this.documentElement.children.find((c) => c.tagName === 'BODY') || null; }
  createElement(tag) { return new MiniElement(tag, {}, this); }
  createTextNode(v) { return new MiniText(String(v), this); }
  createDocumentFragment() { return new MiniFragment(this); }
  querySelector(selector) {
    if (this.documentElement.matches(selector)) return this.documentElement;
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector) {
    const out = this.documentElement.matches(selector) ? [this.documentElement] : [];
    return out.concat(this.documentElement.querySelectorAll(selector));
  }
  getElementById(id) { return this.querySelector('#' + id); }
  addEventListener() { /* document 自体への購読は使っていない */ }
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
  const doc = new MiniDocument();
  const container = new MiniElement('#container', {}, doc);
  const stack = [container];
  const top = () => stack[stack.length - 1];
  let i = 0;

  const appendText = (text) => {
    if (!text) return;
    top().appendChild(new MiniText(decodeEntities(text), doc));
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) { appendText(source.slice(i)); break; }
    if (lt > i) appendText(source.slice(i, lt));

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      top().appendChild(new MiniComment(source.slice(lt + 4, end === -1 ? source.length : end), doc));
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      if (/^<!doctype/i.test(source.slice(lt, lt + 9))) doc.doctype = { name: 'html' };
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
    const el = new MiniElement(tag, parseAttributes(inner.slice(nameMatch[1].length)), doc);
    top().appendChild(el);
    i = end + 1;

    if (VOID.has(tag) || /\/\s*$/.test(inner)) continue;
    if (RAWTEXT.has(tag)) {
      const close = source.toLowerCase().indexOf('</' + tag, i);
      const stop = close === -1 ? source.length : close;
      const raw = source.slice(i, stop);
      if (raw) el.appendChild(new MiniText(raw, doc));
      const closeEnd = close === -1 ? source.length : source.indexOf('>', close);
      i = closeEnd === -1 ? source.length : closeEnd + 1;
      continue;
    }
    stack.push(el);
  }

  /* ブラウザと同様に html / head / body を補う */
  let htmlEl = container.children.find((c) => c.tagName === 'HTML');
  if (!htmlEl) {
    htmlEl = new MiniElement('html', {}, doc);
    const head = new MiniElement('head', {}, doc);
    const body = new MiniElement('body', {}, doc);
    htmlEl.appendChild(head);
    htmlEl.appendChild(body);
    for (const c of container.childNodes.slice()) {
      if (c.nodeType === 1 && (c.tagName === 'HEAD' || c.tagName === 'BODY')) htmlEl.appendChild(c);
      else body.appendChild(c);
    }
  } else {
    if (!htmlEl.children.some((c) => c.tagName === 'HEAD')) htmlEl.insertBefore(new MiniElement('head', {}, doc), htmlEl.firstChild);
    if (!htmlEl.children.some((c) => c.tagName === 'BODY')) htmlEl.appendChild(new MiniElement('body', {}, doc));
  }
  htmlEl.parentNode = null;
  doc.documentElement = htmlEl;
  doc.childNodes = [htmlEl];
  return doc;
}

module.exports = { parseHTML, decodeEntities, serialize, MiniDocument, MiniElement, MiniText, MiniComment, MiniFragment };
