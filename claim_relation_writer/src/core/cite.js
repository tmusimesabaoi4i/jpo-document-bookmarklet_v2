/*
 * cite.js — 「引用一覧」（#claim_cite）テキストを有向グラフに変換する（DOM非依存の純粋モジュール）
 *
 * なぜ罫線ツリー（parser.js）ではなくこちらを主データ源にするか:
 *   ページ側は「全請求項間引用パターン全展開」が上限（5000）に達すると解析を打ち切る。
 *   このとき #claim_tree の罫線ツリーは**先頭の上限数分しか描画されず、残りが丸ごと欠落**する。
 *   実例（92請求項）では 92ノード/857エッジのうち 22ノード/100エッジしか残らないが、
 *   罫線としては正しいため parseClaimTree は成功してしまい、誤ったサマリのまま先へ進む。
 *   一方 #claim_cite は上限到達時でも全請求項を列挙するため、こちらが唯一信頼できる。
 *
 * 解析対象の書式（<br> 改行・<b> 除去後のプレーンテキスト）:
 *   ★全請求項間引用パターン全展開上限数(5000)到達のため、…★   ← 上限到達時のみ
 *   合計請求項数: 92  (独立請求項: 1,22,42,43,46,68,89,90)
 *   [6]請求項6 『・・通信装置』 従属請求項
 *   　引用請求項: 5 (間接引用: 1,2,3,4)　引用パターンの数: 1
 *   　被引用請求項: 7,8,9(うち間接被引用: 9)
 *
 * 重要な既知の非対称性（実データで検証済み）:
 *   - 「引用請求項」＝**直接**引用元、「(間接引用: …)」＝間接引用元。上限到達時も完全。
 *   - 「被引用請求項」＝直接＋間接の全下位。**上限到達時は不完全**（実例で 857 中 219 のみ）。
 *   したがって**エッジは必ず「引用請求項」（順方向）からのみ構築する**。「被引用請求項」は
 *   上限に達していない場合のクロスチェックにのみ使う。
 *   - 「引用パターンの数」も上限到達時は打ち切り後の値。表示以外に使わない。
 *
 * グラフの向き: edges の [from, to] は「to が from を引用する」（parser.js と同一規約）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./parser'));
  } else {
    root.CRW = root.CRW || {};
    if (!root.CRW.parser) {
      throw new Error('CRW.parser が読み込まれていません。script の読み込み順を確認してください。');
    }
    root.CRW.cite = factory(root.CRW.parser);
  }
})(globalThis, function (parser) {
  'use strict';

  function toHalfWidthDigits(text) {
    return String(text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  }

  // 改行コードと、書式を構成する記号の異体字だけを揃える（1:1置換のみ）。
  // 全角スペース（U+3000）は JS の \s に含まれるため変換不要。
  function normalizeText(text) {
    return toHalfWidthDigits(String(text == null ? '' : text).replace(/\r\n?/g, '\n'))
      .replace(/：/g, ':')
      .replace(/，/g, '、')
      .replace(/（/g, '(')
      .replace(/）/g, ')');
  }

  // 「1,2, 3」「1、2」などを昇順ユニークな数値配列にする
  function numList(s) {
    const out = [];
    const seen = new Set();
    for (const part of String(s || '').split(/[^0-9]+/)) {
      if (part === '') continue;
      const n = parseInt(part, 10);
      if (!Number.isInteger(n) || n < 1 || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out.sort((a, b) => a - b);
  }

  const uniqueSorted = (arr) => [...new Set(arr)].sort((a, b) => a - b);
  const setOfEdges = (edges) => new Set(edges.map((e) => e[0] + '>' + e[1]));

  // 「[6]請求項6 …」ブロックの切り出し。次の「[n]請求項」直前まで（最後は文末まで）
  const BLOCK_RE = /\[(\d+)\][ \t　]*請求項[ \t　]*(\d+)([\s\S]*?)(?=\n[ \t　]*\[\d+\][ \t　]*請求項|$)/g;
  // 「被引用請求項」は「引用請求項」を部分文字列として含むため否定後読みで区別する
  const PARENTS_RE = /(?<!被)引用請求項[ \t　]*:[ \t　]*([\d,、\s]+)/;
  const INDIRECT_PARENTS_RE = /(?<!被)間接引用[ \t　]*:[ \t　]*([\d,、\s]+)/;
  const CHILDREN_RE = /被引用請求項[ \t　]*:[ \t　]*([\d,、\s]+)/;
  const INDIRECT_CHILDREN_RE = /間接被引用[ \t　]*:[ \t　]*([\d,、\s]+)/;
  const PATTERN_COUNT_RE = /引用パターンの数[ \t　]*:[ \t　]*(\d+)/;
  // 「★全請求項間引用パターン全展開上限数(5000)到達のため、…★」
  const OVERFLOW_RE = /全展開上限数[ \t　]*\((\d+)\)[ \t　]*到達/;

  /**
   * 引用一覧テキストを解析する。
   * @returns {ok:true, graph:{nodes,edges,roots}, meta:{...}, warnings:string[]}
   *        | {ok:false, errors:[{line:number|null, message:string}]}
   */
  function parseClaimCite(text) {
    const normalized = normalizeText(text);
    const errors = [];
    const warnings = [];
    const addError = (line, message) => errors.push({ line, message });

    if (normalized.trim() === '') {
      return { ok: false, errors: [{ line: null, message: 'クレーム構造が入力されていません' }] };
    }

    // 文字位置 → 行番号（エラー表示用）
    const lineOf = (index) => normalized.slice(0, index).split('\n').length;

    // ---- ヘッダ（最初のブロックより前）から総数・独立請求項・上限到達を読む ----
    const firstBlock = /\[\d+\][ \t　]*請求項/.exec(normalized);
    const header = firstBlock ? normalized.slice(0, firstBlock.index) : normalized;

    const overflowM = OVERFLOW_RE.exec(normalized);
    const overflow = overflowM !== null;
    const overflowLimit = overflowM ? parseInt(overflowM[1], 10) : null;

    const totalM = /合計請求項数[ \t　]*:[ \t　]*(\d+)/.exec(header);
    const declaredTotal = totalM ? parseInt(totalM[1], 10) : null;
    const indepM = /独立請求項[ \t　]*:[ \t　]*([\d,、\s]+)/.exec(header);
    const declaredRoots = indepM ? numList(indepM[1]) : [];

    // ---- 各請求項ブロックを読む ----
    const nodes = new Set();
    const edges = [];
    const edgeKeys = new Set();
    const patternCounts = {};
    const seenClaims = new Set();
    const revEdges = []; // 「被引用請求項 − うち間接被引用」から作る逆方向エッジ（照合専用）
    let hasChildrenField = false;

    const addEdge = (from, to) => {
      const key = from + '>' + to;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push([from, to]);
    };

    BLOCK_RE.lastIndex = 0;
    let m;
    while ((m = BLOCK_RE.exec(normalized)) !== null) {
      const ln = lineOf(m.index);
      const claim = parseInt(m[2], 10);
      const body = m[3];

      if (claim < 1) {
        addError(ln, '請求項番号は1以上の整数にしてください');
        continue;
      }
      if (seenClaims.has(claim)) {
        warnings.push('請求項' + claim + 'の記載が引用一覧に複数あります（最初の記載を使います）。');
        continue;
      }
      seenClaims.add(claim);
      nodes.add(claim);

      const parentsM = PARENTS_RE.exec(body);
      const directParents = parentsM ? numList(parentsM[1]) : [];
      if (directParents.indexOf(claim) !== -1) {
        addError(ln, '請求項' + claim + 'が自分自身を引用しています');
        continue;
      }
      for (const p of directParents) {
        nodes.add(p);
        addEdge(p, claim);
      }

      const patternM = PATTERN_COUNT_RE.exec(body);
      if (patternM) patternCounts[claim] = parseInt(patternM[1], 10);

      // 照合用（エッジ生成には使わない）
      const childrenM = CHILDREN_RE.exec(body);
      if (childrenM) {
        hasChildrenField = true;
        const indirectChildrenM = INDIRECT_CHILDREN_RE.exec(body);
        const indirect = new Set(indirectChildrenM ? numList(indirectChildrenM[1]) : []);
        for (const c of numList(childrenM[1])) {
          if (!indirect.has(c)) revEdges.push([claim, c]);
        }
      }
      // 「(間接引用: …)」は推移閉包から再計算できるため保持のみ（解析には使わない）
      INDIRECT_PARENTS_RE.exec(body);
    }

    if (seenClaims.size === 0) {
      addError(null,
        '引用一覧として解釈できませんでした（「[1]請求項1 …」の形式の行が見つかりません）');
    }
    if (errors.length > 0) return { ok: false, errors };

    const sortedNodes = [...nodes].sort((a, b) => a - b);
    const dependentSet = new Set(edges.map((e) => e[1]));
    const roots = sortedNodes.filter((n) => !dependentSet.has(n));

    const cycle = parser.findCycle(sortedNodes, edges);
    if (cycle) {
      return {
        ok: false,
        errors: [{ line: null, message: '循環する引用関係が検出されました: 請求項 ' + cycle.join(' → ') }],
      };
    }

    // ---- 自己検証（不一致は警告にとどめ、生成はブロックしない） ----
    const undeclared = sortedNodes.filter((n) => !seenClaims.has(n));
    if (undeclared.length > 0) {
      warnings.push(
        '引用元として現れる請求項' + undeclared.join('、') +
        'が引用一覧に記載されていません。ページ側の表示を確認してください。'
      );
    }
    if (declaredTotal !== null && declaredTotal !== sortedNodes.length) {
      warnings.push(
        'ページ側の合計請求項数（' + declaredTotal + '）と、引用一覧から読み取れた請求項数（' +
        sortedNodes.length + '）が一致しません。'
      );
    }
    if (declaredRoots.length > 0 && declaredRoots.join(',') !== roots.join(',')) {
      warnings.push(
        'ページ側の独立請求項（' + declaredRoots.join('、') +
        '）と、引用関係から導出した独立請求項（' + (roots.length === 0 ? 'なし' : roots.join('、')) +
        '）が一致しません。'
      );
    }
    // 逆方向（被引用請求項）との照合は、上限に達していないときだけ意味がある。
    // 上限到達時の「被引用請求項」は打ち切り後の不完全な値なので照合しない。
    if (!overflow && hasChildrenField) {
      const fwd = setOfEdges(edges);
      const rev = setOfEdges(revEdges);
      const onlyFwd = [...fwd].filter((e) => !rev.has(e)).length;
      const onlyRev = [...rev].filter((e) => !fwd.has(e)).length;
      if (onlyFwd > 0 || onlyRev > 0) {
        warnings.push(
          'ページ側の「引用請求項」と「被引用請求項」の内容が一致しません' +
          '（引用側のみ: ' + onlyFwd + '件、被引用側のみ: ' + onlyRev + '件）。'
        );
      }
    }

    return {
      ok: true,
      graph: { nodes: sortedNodes, edges, roots },
      meta: {
        overflow,
        overflowLimit,
        declaredTotal,
        declaredRoots: uniqueSorted(declaredRoots),
        patternCounts,
      },
      warnings,
    };
  }

  return { parseClaimCite, normalizeText, numList };
});
