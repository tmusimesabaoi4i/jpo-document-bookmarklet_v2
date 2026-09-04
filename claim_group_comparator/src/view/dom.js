/*
 * dom.js — 最小の DOM 組み立てヘルパ（比較タブの document に対して使う）
 *
 * 重要な約束:
 *   - 文字列は必ず textContent で入れる。innerHTML は一切使わない。
 *     請求項本文をそのまま流し込む経路を作らないことで、HTML エスケープ漏れを構造的に防ぐ。
 *   - class の付け外しは className の文字列操作で行う（classList を使わない）。
 *     テスト用の最小 DOM でも同じコードが動くようにするため。
 *   - data-* は setAttribute / getAttribute で扱う（dataset を使わない。理由は同上）。
 *   - 対象 document は引数で受け取る。別タブの document を親タブの JS から組み立てるため、
 *     グローバルな document には依存しない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.dom = factory();
  }
})(globalThis, function () {
  'use strict';

  function classesOf(el) {
    const cls = el.getAttribute ? el.getAttribute('class') : el.className;
    return String(cls || '').split(/\s+/).filter((s) => s !== '');
  }

  function setClassName(el, list) {
    const value = list.join(' ');
    if (el.setAttribute) el.setAttribute('class', value);
    else el.className = value;
  }

  function hasClass(el, name) {
    return classesOf(el).indexOf(name) !== -1;
  }

  function addClass(el, name) {
    if (!el || !name || hasClass(el, name)) return el;
    setClassName(el, classesOf(el).concat([name]));
    return el;
  }

  function removeClass(el, name) {
    if (!el || !name) return el;
    setClassName(el, classesOf(el).filter((c) => c !== name));
    return el;
  }

  function toggleClass(el, name, on) {
    return on ? addClass(el, name) : removeClass(el, name);
  }

  /*
   * h(doc, tag, props, children)
   *   props: { class, id, text, title, type, value, attrs: {}, on: { click: fn } }
   *   children: 要素 or 文字列の配列
   */
  function h(doc, tag, props, children) {
    const el = doc.createElement(tag);
    const p = props || {};
    if (p.class) el.setAttribute('class', p.class);
    if (p.id) el.setAttribute('id', p.id);
    if (p.type) el.setAttribute('type', p.type);
    if (p.title) el.setAttribute('title', p.title);
    if (p.value != null) {
      el.setAttribute('value', String(p.value));
      if ('value' in el) el.value = String(p.value);
    }
    if (p.attrs) {
      for (const key of Object.keys(p.attrs)) {
        if (p.attrs[key] == null) continue;
        el.setAttribute(key, String(p.attrs[key]));
      }
    }
    if (p.text != null) el.textContent = String(p.text);
    if (p.on && el.addEventListener) {
      for (const type of Object.keys(p.on)) el.addEventListener(type, p.on[type]);
    }
    if (children) {
      for (const child of children) {
        if (child == null) continue;
        el.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
      }
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function button(doc, label, onClick, props) {
    const p = Object.assign({ class: 'jcgc-btn', type: 'button', text: label }, props || {});
    const el = h(doc, 'button', p);
    if (onClick && el.addEventListener) el.addEventListener('click', onClick);
    return el;
  }

  function select(doc, options, value, onChange, props) {
    const el = h(doc, 'select', Object.assign({ class: 'jcgc-select' }, props || {}));
    for (const option of options) {
      const opt = h(doc, 'option', { value: option.value, text: option.label });
      if (String(option.value) === String(value)) opt.setAttribute('selected', 'selected');
      el.appendChild(opt);
    }
    if ('value' in el) el.value = String(value);
    if (onChange && el.addEventListener) el.addEventListener('change', onChange);
    return el;
  }

  function fragment(doc) {
    return doc.createDocumentFragment();
  }

  // イベント委譲: root の中で selector（data 属性名）を持つ最も近い祖先を探す
  function closestWithAttr(node, attrName, root) {
    let current = node;
    while (current && current !== root) {
      if (current.nodeType === 1 && current.getAttribute && current.getAttribute(attrName) != null) {
        return current;
      }
      current = current.parentNode;
    }
    if (current && current.nodeType === 1 && current.getAttribute && current.getAttribute(attrName) != null) {
      return current;
    }
    return null;
  }

  return {
    h, clear, button, select, fragment,
    addClass, removeClass, toggleClass, hasClass, classesOf,
    closestWithAttr,
  };
});
