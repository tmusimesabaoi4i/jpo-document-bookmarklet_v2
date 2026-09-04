/*
 * extractor.js — 「書類比較・クレームチェッカー」から請求項を取り出す
 *
 * 収集元の優先順位:
 *   1. #claim_mark（クレーム解析済みの本文）… 既定。CLMNM<n> を境界に請求項へ切る
 *   2. #claim_cite（引用一覧）… 引用請求項・独立/従属・カテゴリー末尾語の権威ある出所。
 *      上限到達時も全請求項を列挙するため欠落しない（fixtures/README.md 参照）
 *   3. #doc1 / #doc2 の入力欄 …「【請求項○】」を検出するフォールバック
 *
 * 元ページを一切書き換えない（読むだけ）。document は引数で受け取るのでテストから
 * 最小 DOM を渡せる。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../core/citation'),
      require('../core/normalize'),
      require('../core/segment')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['citation', 'normalize', 'segment']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.extractor = factory(root.JCGC.citation, root.JCGC.normalize, root.JCGC.segment);
  }
})(globalThis, function (citation, normalize, segment) {
  'use strict';

  const NO_CLAIMS_MESSAGE = '請求項を取得できませんでした。先にクレーム解析を実行してください。';

  const CLAIM_MARK_SELECTORS = ['#claim_mark', '#claim_dialog #claim_mark'];
  const CITE_SELECTORS = ['#claim_cite', '#claim_dialog #claim_cite'];
  const INPUT_SELECTORS = ['#doc1', '#doc2', 'textarea'];

  /*
   * カテゴリー判定の補助表。上から順に当てる（媒体をデバイス系より先に見るなど順序に意味がある）。
   *
   * ここに並ぶのは特定の案件の用語ではなく、**日本語クレームの末尾に置かれる一般的な
   * 対象語**（カテゴリー宣言）。この表に載らない末尾語（未知のカテゴリー）が来ても処理は続き、
   * その場合は末尾語そのものからキーを作る（下の classifyCategory を参照）。
   * したがって、この表は「分野が変わると動かなくなる」種類の依存ではない。
   */
  const CATEGORY_RULES = [
    { key: 'program', label: 'プログラム', re: /(プログラム|ソフトウェア)$/ },
    { key: 'medium', label: '記録媒体', re: /(媒体|メディア)$/ },
    { key: 'method', label: '方法', re: /(方法|工程|プロセス|手順)$/ },
    { key: 'circuit', label: '回路', re: /(回路|回路構成|チップ)$/ },
    { key: 'system', label: 'システム', re: /(システム|ネットワーク)$/ },
    {
      key: 'apparatus',
      label: '装置',
      re: /(装置|機器|デバイス|端末|ノード|サーバ[ー]?|基地局|局|機|器|体|ユニット|モジュール|コンピュータ|部|手段)$/,
    },
  ];

  function hasClass(el, name) {
    const cls = el && el.className;
    if (!cls) return false;
    return String(cls).split(/\s+/).indexOf(name) !== -1;
  }

  function classListOf(el) {
    const cls = el && el.className;
    return cls ? String(cls).split(/\s+/).filter((s) => s !== '') : [];
  }

  function firstElement(doc, selectors) {
    for (const selector of selectors) {
      const el = doc.querySelector && doc.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function claimNumberOfMarker(el) {
    const id = el && el.id ? String(el.id) : '';
    const m = /^CLMNM(\d+)$/.exec(id);
    return m ? Number(m[1]) : null;
  }

  function isDisplayNumber(el) {
    const cls = el && el.className ? String(el.className) : '';
    return cls.indexOf('showCiteCited') !== -1;
  }

  /*
   * #claim_mark を文書順に歩き、CLMNM<n> を境界として請求項へ切る。
   * 表示用番号（[1-1] 等）のノードは捨て、用語クラス（zenki_wdXX）は拾う。
   */
  function readClaimMark(markEl) {
    const claims = [];
    let current = null;

    function pushText(text) {
      if (!current || text === '') return;
      current.parts.push(text);
    }

    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        pushText(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;

      const num = claimNumberOfMarker(node);
      if (num != null) {
        current = { number: num, parts: [], termClasses: new Set(), terms: [], termPairs: [] };
        claims.push(current);
        return; // 【請求項 n】の見出しは本文に含めない
      }
      if (isDisplayNumber(node) || hasClass(node, 'hidden')) return;

      if (current) {
        for (const cls of classListOf(node)) {
          if (cls.indexOf('zenki_wd') === 0) {
            current.termClasses.add(cls);
            const t = String(node.textContent || '').replace(/\[\d+-\d+\]/g, '').trim();
            if (t) {
              current.terms.push(t);
              // 用語クラスと、その語の実際の文字列。どの段落に出たかを後で突き合わせる
              current.termPairs.push({ cls, text: t });
            }
          }
        }
      }

      if (node.localName === 'br' || node.tagName === 'BR') {
        pushText('\n');
        return;
      }
      for (const child of node.childNodes) walk(child);
    }

    for (const child of markEl.childNodes) walk(child);

    return claims
      .filter((c) => c.parts.join('').replace(/[\s　]/g, '') !== '')
      .map((c) => ({
        number: c.number,
        rawText: c.parts.join(''),
        termClasses: Array.from(c.termClasses).sort(),
        terms: Array.from(new Set(c.terms)),
        termPairs: c.termPairs,
      }));
  }

  // 入力欄テキストから【請求項○】を検出するフォールバック
  function readInputText(text) {
    const src = citation.toAsciiDigits(String(text == null ? '' : text).replace(/\r\n?/g, '\n'));
    const re = /【\s*請求項\s*(\d+)\s*】/g;
    const heads = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      heads.push({ number: Number(m[1]), start: m.index, bodyStart: m.index + m[0].length });
    }
    return heads.map((h, i) => ({
      number: h.number,
      rawText: src.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : src.length),
      termClasses: [],
      terms: [],
      termPairs: [],
    })).filter((c) => c.rawText.replace(/[\s　]/g, '') !== '');
  }

  function elementText(el) {
    if (!el) return '';
    if (typeof el.value === 'string' && el.value !== '') return el.value;
    return String(el.textContent || '');
  }

  // 末尾のカテゴリー宣言を本文から推定する（引用一覧の『・・XXX』が無い/使えないとき）
  function deriveCategoryLabel(segments) {
    if (!segments.length) return '';
    let t = String(segments[segments.length - 1].text || '').replace(/[。．]+\s*$/, '');
    const tosuru = t.lastIndexOf('とする');
    if (tosuru !== -1) t = t.slice(tosuru + 3);
    const comma = Math.max(t.lastIndexOf('、'), t.lastIndexOf('，'));
    if (comma !== -1) t = t.slice(comma + 1);
    const parts = t.split(/[　\s]+/).filter((s) => s !== '');
    if (parts.length) t = parts[parts.length - 1];
    t = t.replace(/[（(][^）)]*[）)]\s*$/, '');
    return t.trim();
  }

  // 用語クラスの付いた語（termPairs）を、その語が現れる段落へ割り当てる
  function segmentTermClasses(segments, termPairs) {
    const pairs = termPairs || [];
    return segments.map((seg) => {
      const found = new Set();
      for (const pair of pairs) {
        if (pair.text && seg.text.indexOf(pair.text) !== -1) found.add(pair.cls);
      }
      return Array.from(found).sort();
    });
  }

  // 未知の末尾語からカテゴリーキーを作るときに見る末尾の文字数。
  // 日本語の複合名詞は主要語が末尾に来るので、末尾数文字が実質の対象語になる
  // （「〇〇樹脂組成物」と「樹脂組成物」を同じ系列として扱える）。
  const UNKNOWN_TAIL_LENGTH = 3;

  /*
   * 末尾語（カテゴリー宣言）を分類する。
   * → { key, groupLabel, known }
   *   known=false のときも処理は続く。キーは末尾語そのものから作るので、
   *   未知のカテゴリーどうしが誤って同じ系列にまとめられることもない。
   */
  function classifyCategory(label) {
    const normalized = normalize.toNfkc(String(label == null ? '' : label)).replace(/[\s　]/g, '');
    for (const rule of CATEGORY_RULES) {
      if (rule.re.test(normalized)) return { key: rule.key, groupLabel: rule.label, known: true };
    }
    if (normalized) {
      const tail = normalized.length > UNKNOWN_TAIL_LENGTH
        ? normalized.slice(-UNKNOWN_TAIL_LENGTH) : normalized;
      return { key: 'tail:' + tail, groupLabel: normalized, known: false };
    }
    return { key: 'unknown', groupLabel: 'カテゴリー不明', known: false };
  }

  /*
   * 抽出結果 1 件を組み立てる（段落分割 → 正規化の順を守る）
   */
  function buildClaim(raw, citeInfo) {
    const cleaned = normalize.stripDisplayNumbers(raw.rawText, raw.number)
      .replace(/\[\d+-\d+\]/g, '');
    const segments = segment.splitSegments(cleaned);

    const citeLabel = citeInfo ? String(citeInfo.categoryLabel || '') : '';
    let categoryLabel = citeLabel;
    let category = classifyCategory(categoryLabel);
    if (!categoryLabel || !category.known) {
      const derived = deriveCategoryLabel(segments);
      const derivedCategory = classifyCategory(derived);
      if (derived && (derivedCategory.known || !categoryLabel)) {
        categoryLabel = derived;
        category = derivedCategory;
      }
    }

    const textCitations = citation.parseCitations(cleaned).numbers.filter((n) => n !== raw.number);
    const citations = citeInfo && citeInfo.citations && citeInfo.citations.length
      ? citeInfo.citations.slice()
      : textCitations;
    const citationSource = citeInfo && citeInfo.citations && citeInfo.citations.length ? 'cite' : 'text';

    const normalized = normalize.normalizeForCompare(cleaned, { claimNumber: raw.number });

    return {
      number: raw.number,
      rawText: cleaned,
      segments,
      segmentCount: segments.length,
      citations,
      textCitations,
      citationSource,
      isIndependent: citeInfo ? citeInfo.isIndependent : citations.length === 0,
      categoryLabel: categoryLabel || '',
      categoryKey: category.key,
      categoryGroupLabel: category.groupLabel,
      categoryKnown: category.known,
      termClasses: raw.termClasses || [],
      terms: raw.terms || [],
      normalized,
      normalizedSegments: segments.map((s) =>
        normalize.normalizeSegment(s.text, { claimNumber: raw.number })),
      // 段落ごとの用語クラス（段落の対応付けの手がかり）。
      // 用語クラスの付いた語の文字列が、その段落に現れるかで割り当てる。
      segmentTermClasses: segmentTermClasses(segments, raw.termPairs),
    };
  }

  /*
   * 末尾語だけではカテゴリーが判定できなかった従属項は、引用先のカテゴリーを継承する。
   * 略語や造語で終わる従属項（表に載らない末尾語）でも、引用元が装置系なら
   * その系列とみなすのが自然。表示ラベルは自分の末尾語のまま残す。
   * 請求項番号の昇順に処理するので、鎖状の従属でも解決する。
   */
  function inheritCategories(claims) {
    const byNumber = new Map();
    for (const c of claims) byNumber.set(c.number, c);
    for (const c of claims) {
      if (c.categoryKnown || !c.citations || !c.citations.length) continue;
      for (const parentNumber of c.citations) {
        const parent = byNumber.get(parentNumber);
        if (parent && parent.categoryKnown) {
          c.categoryKey = parent.categoryKey;
          c.categoryGroupLabel = parent.categoryGroupLabel;
          c.categoryKnown = true;
          c.categoryInherited = true;
          break;
        }
      }
    }
    return claims;
  }

  function readMeta(doc) {
    const meta = { lappnum: '', title: '' };
    for (const id of ['#lappnum2', '#lappnum1']) {
      const el = doc.querySelector && doc.querySelector(id);
      const v = el ? elementText(el) || (el.getAttribute && el.getAttribute('value')) : '';
      if (v && String(v).trim() !== '') { meta.lappnum = String(v).trim(); break; }
    }
    const titleEl = doc.querySelector && doc.querySelector('title');
    if (titleEl) meta.title = String(titleEl.textContent || '').trim();
    return meta;
  }

  /*
   * ページ（または注入された document）から請求項を抽出する。
   * → { ok, claims, source, message, meta, citeSummary }
   */
  function extractClaims(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return { ok: false, claims: [], source: 'none', message: NO_CLAIMS_MESSAGE, meta: {} };

    const citeEl = firstElement(d, CITE_SELECTORS);
    const citeSummary = citeEl ? citation.parseCiteList(citeEl.textContent) : null;
    const citeByNumber = new Map();
    if (citeSummary) for (const c of citeSummary.claims) citeByNumber.set(c.number, c);

    let rawClaims = [];
    let source = 'none';

    const markEl = firstElement(d, CLAIM_MARK_SELECTORS);
    if (markEl) {
      rawClaims = readClaimMark(markEl);
      if (rawClaims.length) source = 'claim_mark';
    }

    if (!rawClaims.length) {
      for (const selector of INPUT_SELECTORS) {
        const nodes = d.querySelectorAll ? d.querySelectorAll(selector) : [];
        for (const el of nodes) {
          const parsed = readInputText(elementText(el));
          if (parsed.length) { rawClaims = parsed; source = 'input'; break; }
        }
        if (rawClaims.length) break;
      }
    }

    if (!rawClaims.length) {
      return { ok: false, claims: [], source: 'none', message: NO_CLAIMS_MESSAGE, meta: readMeta(d), citeSummary };
    }

    const claims = rawClaims
      .map((raw) => buildClaim(raw, citeByNumber.get(raw.number)))
      .sort((a, b) => a.number - b.number);
    inheritCategories(claims);

    return { ok: true, claims, source, message: '', meta: readMeta(d), citeSummary };
  }

  return {
    extractClaims,
    readClaimMark,
    readInputText,
    buildClaim,
    classifyCategory,
    deriveCategoryLabel,
    inheritCategories,
    segmentTermClasses,
    NO_CLAIMS_MESSAGE,
    CATEGORY_RULES,
  };
});
