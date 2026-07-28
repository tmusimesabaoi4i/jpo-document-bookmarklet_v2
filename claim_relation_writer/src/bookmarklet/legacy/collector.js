/*
 * このファイルは自動生成です — 直接編集しないでください (DO NOT EDIT)。
 * 生成元: src/core/*.js + src/bookmarklet/common/collector-app.js
 * 再生成: npm run build:bookmarklets
 */
(function () {
var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */
try {
/*
 * parser.js — クレーム構造テキストを有向グラフに変換する（DOM非依存の純粋モジュール）
 *
 * 罫線ツリー記法の解析はトークン列＋スタック方式で行う。列位置（インデント幅）には
 * 依存しないため、半角スペース・全角スペース・タブが混在していても正しく解析できる。
 * 正しい入力では「行頭の ┃ の個数 k に対し、開いている分岐スタックの深さが常に k+1」
 * という不変条件が成り立つ。これが崩れた入力（┗ の閉じ忘れ・┃ の不足）は、意図を
 * 推測できないため誤解析せずエラーで停止する。
 *
 * グラフの向き: edges の [from, to] は「to が from を引用する」（from = 引用される側）。
 * 同一の請求項番号はどこに何回現れても常に同一ノードとして扱う（多項従属対応）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.CRW = root.CRW || {};
    root.CRW.parser = factory();
  }
})(globalThis, function () {
  'use strict';

  // 細線などの異体字は太線の罫線に読み替える（表にない罫線文字は不明トークン扱い）
  const GLYPH_ALIASES = { '┬': '┳', '├': '┣', '│': '┃', '└': '┗', '─': '━', '｜': '┃' };

  function toHalfWidthDigits(text) {
    return String(text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  }

  // 改行コード・全角数字・罫線異体字を正規化する。空白はトークン区切りとしてのみ
  // 使うため、インデント（枝の深さ情報）を壊す変換は行わない。
  function normalizeText(text) {
    return toHalfWidthDigits(String(text == null ? '' : text).replace(/\r\n?/g, '\n'))
      .replace(/[┬├│└─｜]/g, (c) => GLYPH_ALIASES[c]);
  }

  // 1行をトークン列にする。数字・罫線以外の非空白文字は 'bad' として報告する
  function tokenizeLine(line) {
    const tokens = [];
    const re = /(\d+)|([┳┣┗┃━])|(\S)/gu;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[1] !== undefined) tokens.push({ type: 'num', value: parseInt(m[1], 10) });
      else if (m[2] !== undefined) tokens.push({ type: m[2] });
      else tokens.push({ type: 'bad', raw: m[3] });
    }
    return tokens;
  }

  // 三色DFS（反復版・巨大入力でも再帰スタックを溢れさせない）で循環を検出し、
  // 循環している請求項の経路を返す（なければ null）
  function findCycle(nodes, edges) {
    const children = new Map();
    for (const [from, to] of edges) {
      if (!children.has(from)) children.set(from, []);
      children.get(from).push(to);
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map([...nodes].map((n) => [n, WHITE]));
    for (const start of nodes) {
      if (color.get(start) !== WHITE) continue;
      const stack = [{ node: start, next: 0 }];
      color.set(start, GRAY);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const kids = children.get(frame.node) || [];
        if (frame.next < kids.length) {
          const c = kids[frame.next++];
          const col = color.get(c);
          if (col === GRAY) {
            const path = stack.map((f) => f.node);
            return path.slice(path.indexOf(c)).concat(c);
          }
          if (col === WHITE) {
            color.set(c, GRAY);
            stack.push({ node: c, next: 0 });
          }
        } else {
          color.set(frame.node, BLACK);
          stack.pop();
        }
      }
    }
    return null;
  }

  /**
   * クレーム構造テキストを解析する。
   * @returns {ok:true, graph:{nodes:number[], edges:[number,number][], roots:number[]}}
   *        | {ok:false, errors:[{line:number|null, message:string}]}
   */
  function parseClaimTree(text) {
    const lines = normalizeText(text).split('\n');
    const errors = [];
    const nodes = new Set();
    const edges = [];
    const edgeKeys = new Set();
    let stack = []; // 開いている分岐（┳）の親番号。添字 = 行頭の ┃ の個数

    const addError = (line, message) => errors.push({ line, message });
    const addEdge = (from, to) => {
      const key = from + '>' + to;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([from, to]);
      }
    };

    lines.forEach((line, index) => {
      const ln = index + 1;
      const tokens = tokenizeLine(line);
      if (tokens.length === 0) return; // 空行はスキップ

      const bad = tokens.find((t) => t.type === 'bad');
      if (bad) {
        addError(ln, '解釈できない文字「' + bad.raw + '」があります');
        return;
      }

      let i = 0;
      while (i < tokens.length && tokens[i].type === '┃') i++;
      const k = i; // 行頭の ┃ の個数
      if (i === tokens.length) return; // ┃ だけの行（縦線の継続表示）はスキップ

      let parent = null;
      const head = tokens[i];
      if (head.type === '┣' || head.type === '┗') {
        // 不変条件チェック: 正しい入力では常に stack.length === k + 1。
        // 崩れている場合は「┗ の閉じ忘れ」か「┃ の不足」かを判別できないため、
        // 推測で救済せずエラーにする（誤った引用関係を黙って生成しない）。
        if (stack.length < k + 1) {
          addError(ln, head.type + ' に対応する分岐（┳）がありません（┃ の数を確認してください）');
          return;
        }
        if (stack.length > k + 1) {
          addError(ln, '内側の分岐が ┗ で閉じられていないか、┃ の数が不足しています');
          return;
        }
        parent = stack[k];
        if (head.type === '┗') stack = stack.slice(0, k); // 分岐を閉じる
        i++;
        if (i >= tokens.length || tokens[i].type !== 'num') {
          addError(ln, head.type + ' の直後に請求項番号がありません');
          return;
        }
      } else if (head.type === 'num') {
        if (k > 0) {
          addError(ln, '┃ の直後に請求項番号は置けません（┣ または ┗ が必要です）');
          return;
        }
        stack = []; // 行頭が数字 = 新しい最上位行（前のツリーは暗黙に終了）
      } else {
        addError(ln, '行頭に ' + head.type + ' は置けません');
        return;
      }

      let prev = tokens[i].value;
      if (prev < 1) {
        addError(ln, '請求項番号は1以上の整数にしてください');
        return;
      }
      nodes.add(prev);
      if (parent !== null) {
        if (parent === prev) {
          addError(ln, '請求項' + prev + 'が自分自身を引用しています');
          return;
        }
        addEdge(parent, prev);
      }
      i++;

      // 行の残り: (┳ または ━) と請求項番号の繰り返し
      while (i < tokens.length) {
        const conn = tokens[i];
        if (conn.type === 'num') {
          addError(ln, '請求項番号が連続しています（' + prev + ' と ' + conn.value + ' の間に ┳ か ━ が必要です）');
          return;
        }
        if (conn.type !== '┳' && conn.type !== '━') {
          addError(ln, '行の途中に ' + conn.type + ' は置けません');
          return;
        }
        if (conn.type === '┳') stack.push(prev); // 分岐を開く
        i++;
        if (i >= tokens.length || tokens[i].type !== 'num') {
          addError(ln, conn.type + ' の直後に請求項番号がありません');
          return;
        }
        const child = tokens[i].value;
        if (child < 1) {
          addError(ln, '請求項番号は1以上の整数にしてください');
          return;
        }
        if (child === prev) {
          addError(ln, '請求項' + prev + 'が自分自身を引用しています');
          return;
        }
        nodes.add(child);
        addEdge(prev, child);
        prev = child;
        i++;
      }
    });

    if (nodes.size === 0 && errors.length === 0) {
      addError(null, 'クレーム構造が入力されていません');
    }

    // 構文エラーがない場合のみ循環を検査する（経路付きで報告）
    if (errors.length === 0) {
      const cycle = findCycle(nodes, edges);
      if (cycle) {
        addError(null, '循環する引用関係が検出されました: 請求項 ' + cycle.join(' → '));
      }
    }

    if (errors.length > 0) return { ok: false, errors };

    const sortedNodes = [...nodes].sort((a, b) => a - b);
    const dependentSet = new Set(edges.map((e) => e[1])); // 何かを引用している項
    const roots = sortedNodes.filter((n) => !dependentSet.has(n)); // 独立請求項
    return { ok: true, graph: { nodes: sortedNodes, edges, roots } };
  }

  /**
   * 請求項番号リストの入力（例: "２、４ 7-9"）を番号の昇順配列にする。
   * 区切りはカンマ・読点・空白。範囲は「2-4」形式（全角ハイフン・チルダも可）。
   * @returns {ok:true, claims:number[]} | {ok:false, error:string}
   */
  function parseClaimNumberList(text) {
    const parts = toHalfWidthDigits(String(text == null ? '' : text))
      .split(/[,，、\s]+/u)
      .filter((p) => p.length > 0);
    const claims = new Set();
    for (const part of parts) {
      let m = /^(\d+)$/.exec(part);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n < 1) return { ok: false, error: '請求項番号は1以上の整数にしてください（「' + part + '」）' };
        claims.add(n);
        continue;
      }
      m = /^(\d+)[-−－‐~～〜](\d+)$/.exec(part);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        if (a < 1 || b < 1) return { ok: false, error: '請求項番号は1以上の整数にしてください（「' + part + '」）' };
        if (a > b) return { ok: false, error: '範囲「' + part + '」は小さい番号→大きい番号の順で指定してください' };
        if (b - a > 9999) return { ok: false, error: '範囲「' + part + '」が大きすぎます' };
        for (let n = a; n <= b; n++) claims.add(n);
        continue;
      }
      return { ok: false, error: '「' + part + '」は請求項番号として解釈できません' };
    }
    return { ok: true, claims: [...claims].sort((x, y) => x - y) };
  }

  return { parseClaimTree, parseClaimNumberList };
});

/*
 * formatter.js — 請求項番号リストを起案文向けの表記に整形する（DOM非依存の純粋モジュール）
 *
 * 表記規則:
 *   - 重複を除去し昇順に並べる
 *   - 2つ以上連続する番号は「先頭-末尾」（ハイフンは半角 U+002D）
 *   - 連続しないまとまり同士は読点「、」（U+3001）で区切る
 *   - 数字は全角（U+FF10〜U+FF19）
 * 例: [2,3,4,5,6,7,9,10,11] → "２-７、９-１１"
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.CRW = root.CRW || {};
    root.CRW.formatter = factory();
  }
})(globalThis, function () {
  'use strict';

  function toFullWidthDigits(text) {
    return String(text).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  }

  function formatClaimNumbers(numbers) {
    const sorted = [...new Set(numbers || [])].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      parts.push(j > i ? sorted[i] + '-' + sorted[j] : String(sorted[i]));
      i = j + 1;
    }
    return toFullWidthDigits(parts.join('、'));
  }

  return { toFullWidthDigits, formatClaimNumbers };
});

/*
 * resolver.js — 指摘・関連請求項から影響範囲を計算する（DOM非依存の純粋モジュール）
 *
 * 文ごとに使用する請求項集合が異なるため、結果は1つの配列に統合せず、
 * issueClaims / relatedClaims / dependentClaims / allAffectedClaims / citedSeeds を
 * 意味ごとに分けて返す。
 *
 * 探索は「引用してくる方向」（from → to）への幅優先探索で、訪問済み集合により
 * 多重経路・多項従属・循環があっても重複や無限ループは起きない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.CRW = root.CRW || {};
    root.CRW.resolver = factory();
  }
})(globalThis, function () {
  'use strict';

  function uniqueSorted(arr) {
    return [...new Set(arr)].sort((a, b) => a - b);
  }

  /**
   * @param graph parser.parseClaimTree が返す { nodes, edges, roots }
   * @param issueClaims 指摘する請求項（1つ以上必須）
   * @param relatedClaims 関連する請求項（空可）
   * @returns {ok:true, issueClaims, relatedClaims, dependentClaims, allAffectedClaims, citedSeeds}
   *        | {ok:false, error:string}
   */
  function resolveAffectedClaims(graph, issueClaims, relatedClaims) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return { ok: false, error: 'クレーム構造が解析されていません' };
    }
    const issue = uniqueSorted(issueClaims || []);
    if (issue.length === 0) {
      return { ok: false, error: '指摘する請求項を1つ以上指定してください' };
    }
    const issueSet = new Set(issue);
    // 指摘と関連の両方に書かれた番号は指摘側を優先する（関連からは除去）
    const related = uniqueSorted((relatedClaims || []).filter((n) => !issueSet.has(n)));

    const nodeSet = new Set(graph.nodes);
    const unknown = uniqueSorted([...issue, ...related].filter((n) => !nodeSet.has(n)));
    if (unknown.length > 0) {
      return { ok: false, error: '請求項' + unknown.join('、') + 'は入力されたクレーム構造に存在しません' };
    }

    // from → to（引用してくる側）の隣接マップ
    const children = new Map();
    for (const [from, to] of graph.edges) {
      if (!children.has(from)) children.set(from, new Set());
      children.get(from).add(to);
    }

    const seeds = uniqueSorted([...issue, ...related]);
    const seedSet = new Set(seeds);

    // 訪問済み集合付きBFS: 既に訪れた請求項は再探索しない
    const visited = new Set(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
      const n = queue.shift();
      const next = children.get(n);
      if (!next) continue;
      for (const c of next) {
        if (!visited.has(c)) {
          visited.add(c);
          queue.push(c);
        }
      }
    }

    const dependentClaims = uniqueSorted([...visited].filter((n) => !seedSet.has(n)));
    // 2文目「請求項Xを引用する請求項…」の主語X: 従属項（直接引用してくる項）を
    // 1つ以上持つ請求項のみ（誰からも引用されていない項は主語に載せない）
    const citedSeeds = seeds.filter((s) => {
      const c = children.get(s);
      return !!c && c.size > 0;
    });
    const allAffectedClaims = uniqueSorted([...seeds, ...dependentClaims]);

    return {
      ok: true,
      issueClaims: issue,
      relatedClaims: related,
      dependentClaims,
      allAffectedClaims,
      citedSeeds,
    };
  }

  return { resolveAffectedClaims };
});

/*
 * generator.js — 影響範囲の計算結果を拒絶理由の定型文に整形する（DOM非依存の純粋モジュール）
 *
 * 文章構成（各文の行頭は全角スペース、文は \n 区切り）:
 *   1文目: 関連する請求項への同様の指摘        … 関連が空なら文ごと省略
 *   2文目: 引用してくる請求項（従属項）への波及 … 従属項が空なら文ごと省略
 *   3文目: 結論（明確性 / サポート要件で文末が変わる）
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./formatter'));
  } else {
    root.CRW = root.CRW || {};
    if (!root.CRW.formatter) {
      throw new Error('CRW.formatter が読み込まれていません。script の読み込み順を確認してください。');
    }
    root.CRW.generator = factory(root.CRW.formatter);
  }
})(globalThis, function (formatter) {
  'use strict';

  const ISSUE_TYPES = {
    clarity: {
      label: '明確性',
      conclusion: 'に係る発明は明確でない。',
    },
    support: {
      label: 'サポート要件',
      conclusion: 'に係る発明は、発明の詳細な説明に記載したものでない。',
    },
  };

  /**
   * @param options.issueType 'clarity' | 'support'
   * @param options.resolved  resolver.resolveAffectedClaims の戻り値（ok:true のもの）
   * @returns 生成された文章（string）
   */
  function generateStatement(options) {
    const { issueType, resolved } = options || {};
    const type = ISSUE_TYPES[issueType];
    if (!type) {
      throw new Error('不明な指摘事項です: ' + issueType);
    }
    if (
      !resolved ||
      !Array.isArray(resolved.allAffectedClaims) ||
      !Array.isArray(resolved.relatedClaims) ||
      !Array.isArray(resolved.dependentClaims) ||
      !Array.isArray(resolved.citedSeeds)
    ) {
      throw new Error('影響範囲の計算結果（resolver の戻り値）が必要です');
    }

    const f = formatter.formatClaimNumbers;
    const lines = [];
    if (resolved.relatedClaims.length > 0) {
      lines.push('　請求項' + f(resolved.relatedClaims) + 'にも同様の点が指摘される。');
    }
    if (resolved.dependentClaims.length > 0) {
      lines.push(
        '　請求項' + f(resolved.citedSeeds) + 'を引用する請求項' + f(resolved.dependentClaims) +
        'にも同様の点が指摘される。'
      );
    }
    lines.push('　よって、請求項' + f(resolved.allAffectedClaims) + type.conclusion);
    return lines.join('\n');
  }

  return { ISSUE_TYPES, generateStatement };
});

/*
 * session.js — アプリ状態の純粋ロジック（DOM非依存）
 *
 * ローカルUIとブックマークレットの両方から使う「状態の整合性」を一手に担う:
 *   - invalidateDownstream: 上流入力（構造・指摘種別・請求項指定）が変わったら、
 *     生成済み文章（と必要なら解析結果）を必ず無効化する。
 *     ※ 古い生成文がコピー可能なまま残ると、誤った請求項番号を含む起案文が
 *       黙って複製される（本ツールの最悪故障モード）ため、ここで一元管理する。
 *   - restoreState: 保存データの復元時、生成文は「現在の入力から再生成した文と
 *     一致する場合のみ」復元する（不整合ペアの持ち越しを防ぐ）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./parser'), require('./resolver'), require('./generator'));
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'resolver', 'generator']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。script の読み込み順を確認してください。');
      }
    }
    root.CRW.session = factory(root.CRW.parser, root.CRW.resolver, root.CRW.generator);
  }
})(globalThis, function (parser, resolver, generator) {
  'use strict';

  function createEmptyState() {
    return {
      treeText: '',
      graph: null, // 解析済み引用関係（treeText から再計算できるキャッシュ）
      issueType: 'clarity',
      issueClaimsText: '',
      relatedClaimsText: '',
      generatedText: '',
      currentStep: 1,
    };
  }

  /**
   * 上流入力の変更を反映した新しい状態を返す。
   * どのフィールドの変更でも生成済み文章は無効化し、構造の変更では解析結果も捨てる。
   */
  function invalidateDownstream(state, changedField) {
    const next = Object.assign({}, state);
    if (changedField === 'treeText') next.graph = null;
    next.generatedText = '';
    return next;
  }

  /**
   * 状態（グラフ + 請求項入力文字列）から影響範囲を計算する。
   * @returns {ok:true, resolved} | {ok:false, error:string}
   */
  function resolveFromState(state) {
    if (!state || !state.graph) {
      return { ok: false, error: 'クレーム構造が解析されていません' };
    }
    const issue = parser.parseClaimNumberList(state.issueClaimsText);
    if (!issue.ok) return { ok: false, error: '指摘する請求項: ' + issue.error };
    const related = parser.parseClaimNumberList(state.relatedClaimsText);
    if (!related.ok) return { ok: false, error: '関連する請求項: ' + related.error };
    if (issue.claims.length === 0) {
      return { ok: false, error: '指摘する請求項を1つ以上入力してください' };
    }
    const resolved = resolver.resolveAffectedClaims(state.graph, issue.claims, related.claims);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return { ok: true, resolved };
  }

  /**
   * 状態から文章を生成する。
   * @returns {ok:true, text, resolved} | {ok:false, error:string}
   */
  function generateFromState(state) {
    const res = resolveFromState(state);
    if (!res.ok) return res;
    try {
      const text = generator.generateStatement({ issueType: state.issueType, resolved: res.resolved });
      return { ok: true, text, resolved: res.resolved };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  /**
   * 保存データ（localStorage の中身）から安全な状態を復元する。
   *   - 型が不正なフィールドは既定値に落とす
   *   - graph は保存値を使わず treeText を再解析（デシンク防止）
   *   - 生成文は現在の入力から再生成した文と一致する場合のみ復元
   *   - currentStep は到達可能な範囲にクランプ
   *     （構造なし→Step1、生成文なしのStep4→Step3）
   */
  function restoreState(saved) {
    const state = createEmptyState();
    if (!saved || typeof saved !== 'object') return state;

    if (typeof saved.treeText === 'string') state.treeText = saved.treeText;
    state.issueType = saved.issueType === 'support' ? 'support' : 'clarity';
    if (typeof saved.issueClaimsText === 'string') state.issueClaimsText = saved.issueClaimsText;
    if (typeof saved.relatedClaimsText === 'string') state.relatedClaimsText = saved.relatedClaimsText;

    if (state.treeText.trim()) {
      const parsed = parser.parseClaimTree(state.treeText);
      state.graph = parsed.ok ? parsed.graph : null;
    }

    if (typeof saved.generatedText === 'string' && saved.generatedText !== '' && state.graph) {
      const regen = generateFromState(state);
      if (regen.ok && regen.text === saved.generatedText) {
        state.generatedText = saved.generatedText;
      }
    }

    let step = Number(saved.currentStep);
    if (!Number.isInteger(step) || step < 1 || step > 4) step = 1;
    if (!state.graph) step = 1;
    else if (step === 4 && state.generatedText === '') step = 3; // 生成し直しを促す
    state.currentStep = step;

    return state;
  }

  return { createEmptyState, invalidateDownstream, resolveFromState, generateFromState, restoreState };
});

/*
 * collector-app.js — ブックマークレット版のモーダルUI（new/legacy 共通ソース）
 *
 * 「書類比較・クレームチェッカー」のページから罫線ツリー（#claim_tree .div_tree）を
 * 収集し、モーダル上で Step 2〜4（指摘事項・請求項指定・生成・コピー）を完結させる。
 *
 * 設計原則:
 *   - 実行時のコード評価（eval 系）・ドキュメントへの write 系API・script 要素の挿入を一切使わない
 *     （対象ページは CSP script-src 'self' のため、ユーザー操作起点の自己完結
 *       ブックマークレットのみが現実的な実行経路。DOM API とクロージャ内関数だけで動く）
 *   - ページを汚さない: 追加するグローバルは window.CRW、DOM は #crw-modal と
 *     #crw-modal-style のみ。localStorage は使わない（状態はモーダル内で完結）
 *   - 上流入力（木構造・指摘種別・請求項指定）の変更で生成文とコピーを必ず無効化
 *     （ローカル版と同じ安全規則）。ページ側で「クレーム解析」が再実行された場合は
 *     MutationObserver で検知して警告し、陳腐化したツリーからの生成を止める
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../../core/parser'),
      require('../../core/formatter'),
      require('../../core/session')
    );
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'formatter', 'resolver', 'generator', 'session']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。連結順を確認してください。');
      }
    }
    root.CRW.collectorApp = factory(root.CRW.parser, root.CRW.formatter, root.CRW.session);
  }
})(globalThis, function (parser, formatter, session) {
  'use strict';

  // 抽出セレクタの優先順。#claim_tree は常駐のデータ保持用（hidden）、
  // #claim_dialog は「木構造」ダイアログ表示中のみ .div_tree を含む
  const TREE_SELECTORS = ['#claim_tree .div_tree', '#claim_dialog .div_tree', '.div_tree'];

  // div_tree の innerHTML をプレーンテキストへ（純関数・Nodeでテスト可能）。
  // 実ページの中身は「テキスト + <br> 行終端」のみだが、将来の変化に備えて
  // 残タグ除去と基本エンティティ復元も行う。&amp; の復元は必ず最後。
  function treeHtmlToText(html) {
    let t = String(html == null ? '' : html);
    t = t.replace(/<br\s*\/?>/gi, '\n');
    t = t.replace(/<[^>]*>/g, '');
    t = t.replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
    return t;
  }

  // ページから木構造テキストを収集する
  function extractTreeText(doc) {
    const d = doc || document;
    for (const selector of TREE_SELECTORS) {
      const nodes = d.querySelectorAll(selector);
      for (const el of nodes) {
        const text = treeHtmlToText(el.innerHTML);
        if (text.trim() !== '') return { ok: true, text, selector };
      }
    }
    return {
      ok: false,
      error: 'クレーム構造が見つかりませんでした。ページ側で「クレーム解析」を実行してから' +
        '「ページから再取得」を押すか、下の欄に木構造を手動で貼り付けてください。',
    };
  }

  // ---------- ここから DOM（launch 時のみ使用） ----------

  const STYLE_TEXT = [
    '#crw-modal{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:"Segoe UI","Yu Gothic UI",Meiryo,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2430;text-align:left;letter-spacing:normal;word-spacing:normal;text-transform:none;}',
    '#crw-modal [hidden]{display:none!important;}',
    '#crw-modal *,#crw-modal *::before,#crw-modal *::after{box-sizing:border-box;font-family:inherit;}',
    '#crw-modal .crw-backdrop{position:absolute;inset:0;background:rgba(15,20,30,.22);}',
    '#crw-modal .crw-panel{position:absolute;top:4vh;right:3vw;width:min(560px,94vw);max-height:92vh;overflow-y:auto;pointer-events:auto;background:#fff;border:1px solid #c7cdd6;border-radius:10px;box-shadow:0 10px 36px rgba(0,0,0,.28);padding:14px 16px 16px;margin:0;}',
    '#crw-modal .crw-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;}',
    '#crw-modal h2{margin:0;font-size:15px;font-weight:700;color:#1f2430;line-height:1.4;}',
    '#crw-modal button{appearance:auto;font:inherit;font-size:13px;line-height:1.4;margin:0;padding:6px 14px;border:1px solid #c7cdd6;border-radius:6px;background:#eef1f5;color:#1f2430;cursor:pointer;text-transform:none;box-shadow:none;touch-action:manipulation;}',
    '#crw-modal button:hover{background:#e1e6ec;}',
    '#crw-modal button:disabled{opacity:.5;cursor:not-allowed;}',
    '#crw-modal button.crw-primary{background:#1d4e89;border-color:#1d4e89;color:#fff;}',
    '#crw-modal button.crw-primary:hover:not(:disabled){background:#163f6f;}',
    '#crw-modal button.crw-x{padding:0 8px;font-size:18px;line-height:1;background:none;border:none;color:#626b78;}',
    '#crw-modal button.crw-x:hover{background:none;color:#1f2430;}',
    '#crw-modal textarea{display:block;width:100%;margin:6px 0;padding:8px;border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;font:12.5px/1.55 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;white-space:pre;overflow:auto;resize:vertical;}',
    '#crw-modal textarea#crw-result{font:13.5px/1.8 "Segoe UI","Yu Gothic UI",Meiryo,system-ui,sans-serif;white-space:pre-wrap;}',
    '#crw-modal input[type="text"]{display:block;width:100%;margin:2px 0 8px;padding:6px 8px;border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;font:inherit;line-height:1.5;}',
    '#crw-modal label{display:block;margin:0;font-size:12.5px;color:#454d59;font-weight:600;}',
    '#crw-modal .crw-radio{display:inline-flex;align-items:center;gap:4px;margin:0 14px 0 0;font-weight:400;font-size:13px;color:#1f2430;}',
    '#crw-modal input[type="radio"]{margin:0;width:auto;accent-color:#1d4e89;}',
    '#crw-modal fieldset{margin:0 0 8px;padding:6px 10px 8px;border:1px solid #dfe3e9;border-radius:6px;min-width:0;}',
    '#crw-modal legend{padding:0 4px;font-size:12px;color:#626b78;float:none;width:auto;margin:0;}',
    '#crw-modal details{margin:0 0 8px;border:1px solid #dfe3e9;border-radius:6px;padding:6px 10px;display:block;}',
    '#crw-modal summary{cursor:pointer;font-size:12.5px;color:#454d59;display:list-item;}',
    '#crw-modal .crw-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0;}',
    '#crw-modal .crw-msg{margin:6px 0;padding:6px 10px;border-radius:6px;font-size:12.5px;white-space:pre-wrap;border:1px solid transparent;}',
    '#crw-modal .crw-success{background:#e7f5ea;color:#226a3b;border-color:#bfe2c8;}',
    '#crw-modal .crw-error{background:#fbeae9;color:#a4302a;border-color:#f1c4c0;}',
    '#crw-modal .crw-warn{background:#fff6e5;color:#8a5a00;border-color:#f0dca8;}',
    '#crw-modal .crw-feedback{font-size:12.5px;}',
    '#crw-modal .crw-feedback.ok{color:#226a3b;}',
    '#crw-modal .crw-feedback.ng{color:#a4302a;}',
    '#crw-modal dl.crw-breakdown{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:8px 0 0;font-size:12.5px;}',
    '#crw-modal dt{color:#626b78;margin:0;font-weight:600;}',
    '#crw-modal dd{margin:0;color:#1f2430;}',
    '#crw-modal .crw-note{margin:10px 0 0;font-size:11.5px;color:#8a93a0;}',
  ].join('\n');

  // 静的なテンプレート（ユーザー由来のデータは含めない。動的な値はすべて
  // textContent / value で後から注入する）
  const PANEL_HTML = [
    '<div class="crw-backdrop"></div>',
    '<div class="crw-panel" role="dialog" aria-labelledby="crw-title">',
    '  <div class="crw-head">',
    '    <h2 id="crw-title"></h2>',
    '    <button type="button" id="crw-close" class="crw-x" aria-label="閉じる">×</button>',
    '  </div>',
    '  <div id="crw-status" class="crw-msg" hidden></div>',
    '  <details id="crw-tree-details">',
    '    <summary>収集した木構造（編集できます）</summary>',
    '    <textarea id="crw-tree" rows="8" spellcheck="false"></textarea>',
    '    <div class="crw-row">',
    '      <button type="button" id="crw-refetch">ページから再取得</button>',
    '    </div>',
    '  </details>',
    '  <div id="crw-tree-warn" class="crw-msg crw-warn" hidden></div>',
    '  <fieldset>',
    '    <legend>指摘する事項</legend>',
    '    <label class="crw-radio"><input type="radio" name="crw-issue-type" value="clarity" checked>明確性</label>',
    '    <label class="crw-radio"><input type="radio" name="crw-issue-type" value="support">サポート要件</label>',
    '  </fieldset>',
    '  <label for="crw-issue-claims">指摘する請求項（必須）</label>',
    '  <input type="text" id="crw-issue-claims" autocomplete="off" placeholder="例: 2、4">',
    '  <label for="crw-related-claims">関連する請求項（同様の点が指摘される請求項・空欄可）</label>',
    '  <input type="text" id="crw-related-claims" autocomplete="off" placeholder="例: 9、13、25">',
    '  <div class="crw-row">',
    '    <button type="button" id="crw-generate" class="crw-primary">生成する</button>',
    '    <button type="button" id="crw-copy" disabled>コピー</button>',
    '    <span id="crw-copy-feedback" class="crw-feedback" role="status" aria-live="polite"></span>',
    '  </div>',
    '  <div id="crw-errors" class="crw-msg crw-error" hidden></div>',
    '  <textarea id="crw-result" rows="5" readonly placeholder="ここに生成された文章が表示されます"></textarea>',
    '  <dl id="crw-breakdown" class="crw-breakdown" hidden></dl>',
    '  <p class="crw-note">処理はこのブラウザ内で完結します（クレーム構造・生成文章の外部送信はありません）。</p>',
    '</div>',
  ].join('\n');

  let cleanup = null; // 開いているモーダルの後片付け（再実行時に先に呼ぶ）

  function launch(config) {
    const cfg = config || {};
    if (cleanup) cleanup();

    const doc = document;
    const style = doc.createElement('style');
    style.id = 'crw-modal-style';
    style.textContent = STYLE_TEXT;
    doc.head.appendChild(style);

    const rootEl = doc.createElement('div');
    rootEl.id = 'crw-modal';
    rootEl.innerHTML = PANEL_HTML;
    doc.body.appendChild(rootEl);

    const q = (id) => doc.getElementById(id);
    const els = {
      title: q('crw-title'),
      close: q('crw-close'),
      status: q('crw-status'),
      treeDetails: q('crw-tree-details'),
      tree: q('crw-tree'),
      refetch: q('crw-refetch'),
      treeWarn: q('crw-tree-warn'),
      issueClaims: q('crw-issue-claims'),
      relatedClaims: q('crw-related-claims'),
      generate: q('crw-generate'),
      copy: q('crw-copy'),
      copyFeedback: q('crw-copy-feedback'),
      errors: q('crw-errors'),
      result: q('crw-result'),
      breakdown: q('crw-breakdown'),
    };
    els.title.textContent = 'Claim Relation Writer — ' + (cfg.label || 'クレーム構造の収集');

    let state = session.createEmptyState();
    let lastCollectedText = '';

    // ---- 表示ヘルパ ----
    function setStatus(kind, message) {
      els.status.className = 'crw-msg crw-' + kind;
      els.status.textContent = message;
      els.status.hidden = false;
    }
    function hideErrors() {
      els.errors.hidden = true;
      els.errors.textContent = '';
    }
    function showErrors(messages) {
      els.errors.textContent = (Array.isArray(messages) ? messages : [messages]).join('\n');
      els.errors.hidden = false;
    }
    function clearResultUI() {
      els.result.value = '';
      els.copy.disabled = true;
      els.breakdown.hidden = true;
      els.breakdown.textContent = '';
      hideErrors();
    }

    // ---- 状態の安全規則: 上流変更で生成済み結果を必ず無効化 ----
    function applyUpstreamChange(field, value) {
      state = session.invalidateDownstream(
        Object.assign({}, state, { [field]: value }),
        field
      );
      clearResultUI();
    }

    // ---- 陳腐化ガード（ページ側でクレーム解析が再実行された場合） ----
    function markStale() {
      els.treeWarn.textContent =
        'ページのクレーム構造が変わりました。「ページから再取得」を押してください。';
      els.treeWarn.hidden = false;
      els.treeDetails.open = true;
      els.generate.disabled = true;
    }
    function clearStale() {
      els.treeWarn.hidden = true;
      els.treeWarn.textContent = '';
      els.generate.disabled = false;
    }

    // ---- 収集と解析 ----
    function tryParseForSummary() {
      const parsed = parser.parseClaimTree(state.treeText);
      if (parsed.ok) {
        state.graph = parsed.graph;
        const f = formatter.formatClaimNumbers;
        setStatus('success',
          '木構造を収集しました: 請求項 ' + parsed.graph.nodes.length + ' 項' +
          '（独立請求項: ' + f(parsed.graph.roots) + '）');
      } else {
        setStatus('error',
          '収集した木構造の解析に失敗しました。下の欄で修正してください。\n' +
          parsed.errors.map((e) => (e.line != null ? e.line + '行目: ' : '') + e.message).join('\n'));
        els.treeDetails.open = true;
      }
    }

    function collectFromPage() {
      // 収集のたびに現行の #claim_tree へ observer を張り直す（起動時に要素が
      // 無かった場合や、ページ側で要素ごと差し替えられた場合の検知漏れを防ぐ）
      bindObserver();
      const res = extractTreeText(doc);
      if (res.ok) {
        els.tree.value = res.text;
        lastCollectedText = res.text;
        applyUpstreamChange('treeText', res.text);
        tryParseForSummary();
        clearStale();
      } else {
        setStatus('error', res.error);
        els.treeDetails.open = true;
        clearStale();
      }
    }

    function handleRefetch() {
      const current = els.tree.value;
      if (current.trim() !== '' && current !== lastCollectedText) {
        if (!window.confirm('編集中の木構造を破棄して、ページから取得し直します。よろしいですか？')) return;
      }
      collectFromPage();
    }

    // ---- 生成（押下時に明示再解析。generateFromState は自前で解析しないため） ----
    function ensureParsed() {
      if (state.graph) return true;
      const parsed = parser.parseClaimTree(state.treeText);
      if (!parsed.ok) {
        showErrors(parsed.errors.map((e) => (e.line != null ? e.line + '行目: ' : '') + e.message));
        els.treeDetails.open = true;
        return false;
      }
      state.graph = parsed.graph;
      return true;
    }

    function handleGenerate() {
      clearResultUI(); // 生成前に必ず前回結果とエラー表示を消す
      if (!ensureParsed()) return; // ensureParsed が行番号付きエラーを表示済み
      const gen = session.generateFromState(state);
      if (!gen.ok) {
        showErrors(gen.error);
        return;
      }
      state.generatedText = gen.text;
      els.result.value = gen.text;
      els.copy.disabled = false;
      renderBreakdown(gen.resolved);
    }

    function renderBreakdown(resolved) {
      const f = formatter.formatClaimNumbers;
      const rows = [
        ['指摘する請求項', f(resolved.issueClaims)],
        ['関連する請求項', f(resolved.relatedClaims) || 'なし'],
        ['引用してくる請求項（従属項）', f(resolved.dependentClaims) || 'なし'],
        ['影響を受ける請求項全体', f(resolved.allAffectedClaims)],
      ];
      els.breakdown.textContent = '';
      for (const row of rows) {
        const dt = doc.createElement('dt');
        dt.textContent = row[0];
        const dd = doc.createElement('dd');
        dd.textContent = row[1];
        els.breakdown.appendChild(dt);
        els.breakdown.appendChild(dd);
      }
      els.breakdown.hidden = false;
    }

    // ---- コピー ----
    let feedbackTimer = null;
    function flashFeedback(message, ok) {
      els.copyFeedback.textContent = message;
      els.copyFeedback.classList.toggle('ok', ok);
      els.copyFeedback.classList.toggle('ng', !ok);
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        els.copyFeedback.textContent = '';
        els.copyFeedback.classList.remove('ok', 'ng');
      }, 2500);
    }

    function handleCopy() {
      const text = els.result.value;
      if (!text) return;
      const fallback = () => {
        let ok = false;
        try {
          els.result.focus();
          els.result.select();
          ok = doc.execCommand('copy');
        } catch (e) {
          ok = false;
        }
        if (window.getSelection) window.getSelection().removeAllRanges();
        flashFeedback(ok ? 'コピーしました' : 'コピーできませんでした。テキストを選択して手動でコピーしてください。', ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => flashFeedback('コピーしました', true),
          fallback
        );
      } else {
        fallback();
      }
    }

    // ---- ページ側の変化検知（収集のたびに bindObserver で張り直す） ----
    let observer = null;
    function bindObserver() {
      if (typeof MutationObserver !== 'function') return;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      const claimTreeHost = doc.getElementById('claim_tree');
      if (claimTreeHost) {
        observer = new MutationObserver(markStale);
        observer.observe(claimTreeHost, { childList: true, subtree: true, characterData: true });
      }
    }

    // ---- 終了処理 ----
    function onKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return; // IME 変換中の Escape は奪わない
      if (e.key === 'Escape') {
        // ページ側（Bootstrap モーダル等）に渡す前に閉じる
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    }

    function close() {
      if (observer) observer.disconnect();
      doc.removeEventListener('keydown', onKeydown, true);
      clearTimeout(feedbackTimer);
      rootEl.remove();
      style.remove();
      cleanup = null;
    }
    cleanup = close;

    // ---- 配線 ----
    els.close.addEventListener('click', close);
    doc.addEventListener('keydown', onKeydown, true);
    els.refetch.addEventListener('click', handleRefetch);
    els.tree.addEventListener('input', () => {
      applyUpstreamChange('treeText', els.tree.value);
      els.status.hidden = true; // 手動編集後のサマリは生成時の再解析で更新される
      clearStale(); // 手動編集はユーザーの意思なので陳腐化警告を解除
    });
    els.issueClaims.addEventListener('input', () => {
      applyUpstreamChange('issueClaimsText', els.issueClaims.value);
    });
    els.relatedClaims.addEventListener('input', () => {
      applyUpstreamChange('relatedClaimsText', els.relatedClaims.value);
    });
    rootEl.querySelectorAll('input[name="crw-issue-type"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) applyUpstreamChange('issueType', radio.value);
      });
    });
    els.generate.addEventListener('click', handleGenerate);
    els.copy.addEventListener('click', handleCopy);

    // ---- 起動時の収集 ----
    collectFromPage();
    els.issueClaims.focus();
  }

  return { TREE_SELECTORS, treeHtmlToText, extractTreeText, launch };
});

globalThis.CRW.collectorApp.launch({"target":"legacy","label":"書類比較・クレームチェッカー（旧版）"});
} catch (e) {
alert('Claim Relation Writer: 起動に失敗しました: ' + ((e && e.message) || e));
}
})();
