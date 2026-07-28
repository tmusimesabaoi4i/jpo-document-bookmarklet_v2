/*
 * summarizer.js — 問題の要約（テンプレート方式・DOM非依存の純粋モジュール）
 *
 * 自然言語生成は行わない。ITEM から抽出済みの素材（clarityCoreSentence /
 * specStatements / firstBodySentence）を決まった型に流し込むだけで、
 * 素材が足りない場合は原文の主要文をそのまま要約として返し reliable: false を立てる。
 *
 * 素材は原文（raw）のスライスなので全角数字を含む（`請求項２に係る発明において…`）。
 * テンプレート照合と出力表記は normalizer.normalizeForMatching を通した形（半角数字）で行う。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.summarizer = factory(root.RRB.normalizer);
  }
})(globalThis, function (normalizer) {
  'use strict';

  // 要約の先頭に残ると読みにくい接続表現（原文の文頭から取り除く）
  const LEADING_CONNECTIVES = ['してみると、', 'したがって、', 'そうすると、', 'すると、'];

  // かぎ括弧で挟まれた 2 つの記載の異同を問う明確性の定型文。
  // 例: 請求項２に係る発明において「第1送信ステップ」と「第2接続設定処理」との異同が不明確である。
  const QUOTE_PAIR_RE =
    /請求項(\d+)に係る発明において「([^」]*)」と「([^」]*)」との(異同|関係|対応関係)が(?:不明確|明確でない)/;

  function norm(text) {
    if (text == null) return null;
    const s = normalizer.normalizeForMatching(normalizer.normalizeLineEndings(String(text)));
    return s;
  }

  // n 文字を超える場合だけ末尾を省略記号に置き換える
  function truncate(text, n) {
    const s = String(text == null ? '' : text);
    const limit = typeof n === 'number' && n > 0 ? n : 40;
    return s.length <= limit ? s : s.slice(0, limit) + '…';
  }

  function stripLeadingConnectives(sentence) {
    let s = String(sentence == null ? '' : sentence).trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of LEADING_CONNECTIVES) {
        if (s.indexOf(c) === 0) {
          s = s.slice(c.length).trim();
          changed = true;
        }
      }
    }
    return s;
  }

  function endWithPeriod(sentence) {
    const s = String(sentence == null ? '' : sentence).trim();
    if (s === '') return s;
    return /[。？！]$/.test(s) ? s : s + '。';
  }

  // 明細書の欠落記載（「…の記載がない」）用に末尾の句読点を落とす
  function trimTail(text) {
    return String(text == null ? '' : text).trim().replace(/[。、，,\.]+$/, '');
  }

  // ---- テンプレート ----

  // 1) かぎ括弧 2 記載の異同 → 請求項2の「A」と「B」の異同が不明確。
  function quotePair(item) {
    const core = norm(item.clarityCoreSentence);
    if (core === null) return null;
    const m = QUOTE_PAIR_RE.exec(core);
    if (!m) return null;
    return {
      summary: '請求項' + parseInt(m[1], 10) + 'の「' + m[2] + '」と「' + m[3] + '」の' + m[4] + 'が不明確。',
      reliable: true,
    };
  }

  // 2) 明細書に記載がない → 明細書に「…」の記載がない。
  function specMissing(item) {
    const statements = item.specStatements || [];
    if (statements.length === 0) return null;
    const first = statements[0] || {};
    const missing = trimTail(norm(first.missing != null ? first.missing : first.sentence));
    if (missing === '') return null;
    return { summary: '明細書に「' + missing + '」の記載がない。', reliable: true };
  }

  // 3) 明確性の中核文をそのまま（文頭の接続表現のみ除去）
  function coreClarity(item) {
    const core = norm(item.clarityCoreSentence);
    if (core === null) return null;
    const summary = endWithPeriod(stripLeadingConnectives(core));
    if (summary === '') return null;
    return { summary, reliable: true };
  }

  // 4) 素材不足 — 原文の最初の指摘文（無ければ原文冒頭）を要約とし確度を落とす
  function fallback(item) {
    const first = norm(item.firstBodySentence);
    if (first !== null && first.trim() !== '') {
      return { summary: first.trim(), reliable: false };
    }
    const source = norm(item.sourceText);
    if (source !== null && source.trim() !== '') {
      // 原文は改行を含むため 1 行に潰してから 40 文字で切る
      return { summary: truncate(source.trim().replace(/[\s　]+/g, ' '), 40), reliable: false };
    }
    return null;
  }

  // ITEM から要約を作る。テンプレートは区分ごとの優先順で試す。
  //   support  … 明細書の欠落記載が主論点なので specMissing を先に見る
  //   clarity  … かぎ括弧の異同／中核文を先に見る
  //   その他   … quotePair → specMissing → coreClarity
  function buildIssueSummary(item, category) {
    if (item == null) return { summary: null, reliable: false };
    let order;
    if (category === 'support') order = [specMissing, quotePair, coreClarity];
    else if (category === 'clarity') order = [quotePair, coreClarity, specMissing];
    else order = [quotePair, specMissing, coreClarity];
    for (const template of order) {
      const result = template(item);
      if (result) return result;
    }
    const fb = fallback(item);
    return fb || { summary: null, reliable: false };
  }

  // 29条系の MAPPING 用の一行要約（概要タブ向け。備考は UI が原文のまま表示する）
  function buildMappingSummary(mapping) {
    if (mapping == null) return { summary: null, reliable: false };
    const label = mapping.subCategoryLabel || '29条系';
    const numbers = (mapping.referenceNumbers || []).join('、');
    if (numbers === '') return { summary: label + 'の指摘。', reliable: true };
    return { summary: '引用文献' + numbers + 'に基づく' + label + 'の指摘。', reliable: true };
  }

  return {
    truncate,
    stripLeadingConnectives,
    buildIssueSummary,
    buildMappingSummary,
  };
});
