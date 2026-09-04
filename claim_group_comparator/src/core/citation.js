/*
 * citation.js — 引用関係の解析（DOM 非依存・依存ゼロ）
 *
 * 請求項本文に現れる引用表現を、位置（span）付きで取り出す。位置を返すのは
 * normalize.js が「引用定型句を取り除いた比較用文字列」を作るために使うため。
 *
 * 対応する記載（実物のクレームから採取）:
 *   請求項1に記載の
 *   請求項11又は12に記載の
 *   請求項1から14のいずれか一項に記載の
 *   請求項1から請求項14のいずれか一項に記載の
 *   請求項1、請求項17、請求項26又は請求項35に記載の
 *   請求項1～7に記載の / 請求項1乃至7 / 請求項1-7
 *
 * 方針:
 *   - 「請求項」を起点に、数値と接続語だけを前方へ食べていく決定論的スキャン。
 *     接続語は「次に（請求項＋）数字が続くとき」しか食べないので、
 *     「請求項1に記載の方法であって、前記…」の読点を巻き込まない。
 *   - 全角数字は等長の半角へ写してから走査する（1文字↔1文字なので元文字列の
 *     インデックスがずれない）。
 *   - ここでの結果は「グループ化の正解」ではなく補助情報。呼び出し側は
 *     引用一覧（#claim_cite）を優先し、これはフォールバック兼クロスチェックに使う。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.citation = factory();
  }
})(globalThis, function () {
  'use strict';

  const CLAIM_WORD = '請求項';

  // 列挙の接続語（範囲ではない）。長いものから順に試す
  const LIST_CONNECTORS = [
    '若しくは', 'もしくは', '並びに', 'ならびに', 'または', '及び', 'および', '又は',
    'かつ', '、', '，', ',', '・',
  ];

  // 範囲の接続語。長いものから順に試す
  const RANGE_CONNECTORS = ['乃至', 'ないし', 'から', '〜', '～', '~', '―', '‐', '−', '－', '—', '-'];

  // 引用表現の直後に続く定型句（span に含めて丸ごと除去できるようにする）
  const TRAILING_PHRASES = [
    'のいずれか一項に記載の', 'のいずれか１項に記載の', 'のいずれか1項に記載の',
    'のいずれかに記載の', 'のうちのいずれか一項に記載の', 'のいずれか一項記載の',
    'のいずれか一項に記載された', 'のいずれか一項に記載', 'のいずれか一項',
    'に記載された', 'に記載の', 'に記載', '記載の', 'に従属する',
  ];

  // 全角数字 → 半角数字（1文字→1文字なのでインデックスが保存される）
  function toAsciiDigits(text) {
    return String(text == null ? '' : text).replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30));
  }

  // pos から prefix 群のいずれかに一致すれば、その長さを返す（最長一致）
  function matchAny(s, pos, candidates) {
    let best = 0;
    for (const cand of candidates) {
      if (cand.length > best && s.startsWith(cand, pos)) best = cand.length;
    }
    return best;
  }

  function skipSpaces(s, pos) {
    while (pos < s.length && (s[pos] === ' ' || s[pos] === '　' || s[pos] === '\t')) pos += 1;
    return pos;
  }

  // pos から「（請求項）?数字」を読む。読めなければ null
  function readNumberRef(s, pos) {
    let p = skipSpaces(s, pos);
    if (s.startsWith(CLAIM_WORD, p)) p = skipSpaces(s, p + CLAIM_WORD.length);
    const m = /^\d+/.exec(s.slice(p));
    if (!m) return null;
    return { value: Number(m[0]), end: p + m[0].length };
  }

  /*
   * 1 つの引用表現を pos（「請求項」の先頭）から読む。
   * 返り値 { numbers, start, end } / 読めなければ null
   */
  function readCitation(scan, pos) {
    const first = readNumberRef(scan, pos);
    if (!first) return null;

    const numbers = [first.value];
    let cursor = first.end;
    let last = first.value;

    for (;;) {
      // 接続語は続けて現れうる（「、又は」「、及び」など）。まとめて読む
      let pos = skipSpaces(scan, cursor);
      let consumed = 0;
      let rangeLen = 0;
      for (let k = 0; k < 3; k += 1) {
        const r = matchAny(scan, pos, RANGE_CONNECTORS);
        if (r) { rangeLen = r; pos = skipSpaces(scan, pos + r); consumed += r; continue; }
        const l = matchAny(scan, pos, LIST_CONNECTORS);
        if (l) { pos = skipSpaces(scan, pos + l); consumed += l; continue; }
        break;
      }
      if (!consumed) break;

      const next = readNumberRef(scan, pos);
      // 接続語の先に数字が無ければ、その接続語は引用表現の一部ではない
      if (!next) break;

      if (rangeLen) {
        // 範囲: last+1 〜 next を補う（降順・異常値は無視して端点だけ採る）
        if (next.value > last) {
          for (let n = last + 1; n <= next.value; n += 1) numbers.push(n);
        } else {
          numbers.push(next.value);
        }
      } else {
        numbers.push(next.value);
      }
      last = next.value;
      cursor = next.end;
    }

    // 後続の定型句まで span に含める
    const afterNums = skipSpaces(scan, cursor);
    const trailing = matchAny(scan, afterNums, TRAILING_PHRASES);
    const end = trailing ? afterNums + trailing : cursor;

    return { numbers, start: pos, end };
  }

  /*
   * 本文から引用表現をすべて取り出す。
   * → { numbers: 昇順ユニークな引用先, spans: [{ start, end, numbers }] }
   */
  function parseCitations(text) {
    const src = String(text == null ? '' : text);
    const scan = toAsciiDigits(src);
    const spans = [];
    const all = new Set();

    let idx = scan.indexOf(CLAIM_WORD);
    while (idx !== -1) {
      const hit = readCitation(scan, idx);
      if (hit) {
        spans.push(hit);
        for (const n of hit.numbers) all.add(n);
        idx = scan.indexOf(CLAIM_WORD, hit.end);
      } else {
        idx = scan.indexOf(CLAIM_WORD, idx + CLAIM_WORD.length);
      }
    }

    return {
      numbers: Array.from(all).sort((a, b) => a - b),
      spans,
    };
  }

  /*
   * 引用表現の span を取り除いた文字列を返す（比較用文字列の材料）。
   * 表示用の原文には使わないこと。
   */
  function stripCitations(text) {
    const src = String(text == null ? '' : text);
    const { spans } = parseCitations(src);
    if (!spans.length) return src;
    let out = '';
    let cursor = 0;
    for (const span of spans) {
      out += src.slice(cursor, span.start);
      cursor = span.end;
    }
    out += src.slice(cursor);
    return out;
  }

  /*
   * 引用一覧（#claim_cite）のテキストから直接引用を読む。
   *   [12]請求項12 『・・方法』 従属請求項　引用請求項: 8　引用パターンの数: 1　被引用請求項: 13,14
   * 「被引用請求項」は上限到達時に不完全になるため使わない（fixtures/README.md 参照）。
   * → { claims: [{ number, categoryLabel, isIndependent, citations }], total, independents }
   */
  function parseCiteList(text) {
    const src = toAsciiDigits(String(text == null ? '' : text));
    const claims = [];
    // 「[n]請求項n 『…』 独立請求項/従属請求項」を境界にレコードへ切る
    const head = /\[(\d+)\]請求項(\d+)/g;
    const starts = [];
    let m;
    while ((m = head.exec(src)) !== null) starts.push({ index: m.index, number: Number(m[2]) });

    for (let i = 0; i < starts.length; i += 1) {
      const begin = starts[i].index;
      const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
      const body = src.slice(begin, end);
      const categoryMatch = /『(.*?)』/.exec(body);
      // 「被引用請求項」を拾わないよう、直前が区切り文字であることを要求する。
      // 被引用は上限到達時に不完全になるため、引用関係の復元に使ってはいけない。
      const citeMatch = /[\s　]引用請求項\s*[:：]\s*([\d,\s]+)/.exec(body);
      claims.push({
        number: starts[i].number,
        categoryLabel: categoryMatch ? categoryMatch[1].replace(/^[・･]+/, '').trim() : '',
        isIndependent: body.indexOf('独立請求項') !== -1,
        citations: citeMatch
          ? citeMatch[1].split(/[,\s]+/).filter((s) => s !== '').map(Number).sort((a, b) => a - b)
          : [],
      });
    }

    const totalMatch = /合計請求項数\s*[:：]\s*(\d+)/.exec(src);
    const indMatch = /独立請求項\s*[:：]\s*([\d,\s]+)\)/.exec(src);
    return {
      claims,
      total: totalMatch ? Number(totalMatch[1]) : claims.length,
      independents: indMatch
        ? indMatch[1].split(/[,\s]+/).filter((s) => s !== '').map(Number)
        : claims.filter((c) => c.isIndependent).map((c) => c.number),
    };
  }

  return { parseCitations, stripCitations, parseCiteList, toAsciiDigits };
});
