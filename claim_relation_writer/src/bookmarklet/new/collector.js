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
  // 循環している請求項の経路を返す（なければ null）。
  // 罫線ツリー・引用一覧のどちらの解析でも使うため cite.js からも呼ぶ（エクスポート済み）
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

  return { parseClaimTree, parseClaimNumberList, findCycle };
});

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
 *   - 「引用請求項」の主リストは、旧 UI では**直接**引用元のみ、新 UI では
 *     **直接＋間接**の全引用元。どちらも括弧内の「(うち間接引用: …)」が間接分を示す。
 *     そこで主リストから間接分を差し引いて直接引用元を求め、エッジは直接分だけにする
 *     （差し引いても旧 UI では no-op なので、新旧どちらの書式でも同じ結果になる）。
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

  // 「[6]請求項6 …」ブロックの切り出し。次の「[n]請求項」直前まで（最後は文末まで）。
  // 新 UI はレコードが <div> で並び、HTML→テキストで改行になるが、呼び出し側が
  // 改行を落としたテキストを渡しても壊れないよう、境界の空白は改行に限らない。
  const BLOCK_RE = /\[(\d+)\][ \t　]*請求項[ \t　]*(\d+)([\s\S]*?)(?=[\s　]*\[\d+\][ \t　]*請求項|$)/g;
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
      const indirectParentsM = INDIRECT_PARENTS_RE.exec(body);
      const listedParents = parentsM ? numList(parentsM[1]) : [];
      const indirectParents = indirectParentsM ? numList(indirectParentsM[1]) : [];
      if (listedParents.indexOf(claim) !== -1) {
        addError(ln, '請求項' + claim + 'が自分自身を引用しています');
        continue;
      }
      // 新 UI の主リスト（全引用元）から間接分を除いて直接引用元にする。
      // 旧 UI の主リスト（直接引用元のみ）では間接分が含まれないため、この差し引きは no-op。
      const indirectSet = new Set(indirectParents);
      const directParents = listedParents.filter((p) => !indirectSet.has(p));
      for (const p of listedParents) nodes.add(p);
      for (const p of directParents) addEdge(p, claim);

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

/*
 * structure.js — クレーム構造テキストの書式判定とディスパッチ（DOM非依存の純粋モジュール）
 *
 * 本ツールは2種類の入力を受け付ける:
 *   1. 引用一覧（#claim_cite） … 「合計請求項数: …」「[1]請求項1 …」形式。**推奨**。
 *      ページ側が引用パターン上限に達しても全請求項が列挙されるため欠落しない。
 *   2. 罫線ツリー（#claim_tree） … 「1 ┳ 2 ┳ 3」形式。従来からの入力で、手書きにも使える。
 *      ただしページ側が上限に達すると先頭の上限数分しか描画されず**黙って欠落する**。
 *
 * UI 層（ローカル版・ブックマークレット版）はどちらの書式かを意識せず
 * parseClaimStructure() だけを呼ぶ。戻り値の format で「どちらとして読んだか」を確認できる。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./parser'), require('./cite'));
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'cite']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。script の読み込み順を確認してください。');
      }
    }
    root.CRW.structure = factory(root.CRW.parser, root.CRW.cite);
  }
})(globalThis, function (parser, cite) {
  'use strict';

  // 引用一覧に固有の見出し（罫線ツリーには決して現れない）
  const CITE_MARKERS = [/合計請求項数[ \t　]*[:：]/, /引用請求項[ \t　]*[:：]/, /\[\d+\][ \t　]*請求項[ \t　]*\d+/];
  const TREE_GLYPHS = /[┳┣┗┃━┬├└│─｜]/;

  /**
   * 入力テキストの書式を判定する。
   * @returns {'cite'|'tree'|'unknown'}
   */
  function detectFormat(text) {
    const t = String(text == null ? '' : text);
    if (t.trim() === '') return 'unknown';
    // 引用一覧の判定を先に行う。引用一覧に罫線文字が混ざることはないが、
    // 逆に手書きツリーへ注記として「引用請求項:」と書く可能性は低いため誤判定しにくい。
    for (const re of CITE_MARKERS) {
      if (re.test(t)) return 'cite';
    }
    if (TREE_GLYPHS.test(t)) return 'tree';
    return 'unknown';
  }

  /**
   * 書式を自動判定して解析する。
   * @returns {ok:true, graph, format, meta, warnings}
   *        | {ok:false, errors:[{line,message}], format}
   */
  function parseClaimStructure(text) {
    const format = detectFormat(text);
    if (format === 'cite') {
      const result = cite.parseClaimCite(text);
      return result.ok
        ? { ok: true, graph: result.graph, format: 'cite', meta: result.meta, warnings: result.warnings }
        : { ok: false, errors: result.errors, format: 'cite' };
    }
    // 'tree' と 'unknown' はどちらも罫線ツリーとして読む（unknown の場合は
    // parseClaimTree が行番号付きの具体的なエラーを返すので、そちらに委ねる）
    const result = parser.parseClaimTree(text);
    return result.ok
      ? { ok: true, graph: result.graph, format: 'tree', meta: null, warnings: [] }
      : { ok: false, errors: result.errors, format: format === 'tree' ? 'tree' : 'unknown' };
  }

  // 収集元・書式を人間向けに1語で表す（ステータス表示用）
  function formatLabel(format) {
    if (format === 'cite') return '引用一覧';
    if (format === 'tree') return '木構造';
    return '不明';
  }

  return { detectFormat, parseClaimStructure, formatLabel };
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
    module.exports = factory(
      require('./parser'), require('./resolver'), require('./generator'), require('./structure')
    );
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'resolver', 'generator', 'structure']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。script の読み込み順を確認してください。');
      }
    }
    root.CRW.session = factory(root.CRW.parser, root.CRW.resolver, root.CRW.generator, root.CRW.structure);
  }
})(globalThis, function (parser, resolver, generator, structure) {
  'use strict';

  function createEmptyState() {
    return {
      // treeText は「貼り付けた／収集した生テキスト」。罫線ツリーでも引用一覧でもよい
      // （書式は structure.detectFormat が自動判定する）。保存データ互換のため名前は変えない。
      treeText: '',
      graph: null, // 解析済み引用関係（treeText から再計算できるキャッシュ）
      sourceFormat: null, // 'cite' | 'tree' | null（graph と同じライフサイクル）
      sourceMeta: null, // 引用一覧のときの付帯情報（上限到達・合計請求項数など）
      sourceWarnings: [], // ページ側データの自己矛盾など（生成はブロックしない）
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
    if (changedField === 'treeText') {
      next.graph = null;
      next.sourceFormat = null;
      next.sourceMeta = null;
      next.sourceWarnings = [];
    }
    next.generatedText = '';
    return next;
  }

  /**
   * 状態のテキストを解析し、graph と付帯情報を書き戻す（失敗時は state を変更しない）。
   * ローカル版・ブックマークレット版の双方から使い、解析結果の格納方法を一元化する。
   * @returns {ok:true, graph, format, warnings} | {ok:false, errors:[{line,message}]}
   */
  function parseIntoState(state) {
    const parsed = structure.parseClaimStructure(state.treeText);
    if (!parsed.ok) return { ok: false, errors: parsed.errors, format: parsed.format };
    state.graph = parsed.graph;
    state.sourceFormat = parsed.format;
    state.sourceMeta = parsed.meta;
    state.sourceWarnings = parsed.warnings || [];
    return { ok: true, graph: parsed.graph, format: parsed.format, warnings: state.sourceWarnings };
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
      parseIntoState(state); // 失敗時は graph=null のまま（下でステップが1にクランプされる）
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

  return {
    createEmptyState, invalidateDownstream, parseIntoState,
    resolveFromState, generateFromState, restoreState,
  };
});

/*
 * collector-app.js — ブックマークレット版のモーダルUI（new/legacy 共通ソース）
 *
 * 「書類比較・クレームチェッカー」のページからクレーム構造を収集し、モーダル上で
 * Step 2〜4（指摘事項・請求項指定・生成・コピー）を完結させる。
 *
 * 収集元の優先順位（重要）:
 *   1. 引用一覧 #claim_cite … **既定**。ページ側が引用パターン全展開の上限（5000）に
 *      達しても全請求項が列挙されるため欠落しない。
 *   2. 罫線ツリー #claim_tree .div_tree … 引用一覧が空のときのフォールバック。
 *      上限到達時は先頭の上限数分しか描画されず、罫線としては正しいまま**黙って欠落する**
 *      （実例: 92請求項が22請求項に化ける）ので、この場合は警告を必ず表示する。
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
      require('../../core/formatter'),
      require('../../core/session'),
      require('../../core/structure')
    );
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'cite', 'structure', 'formatter', 'resolver', 'generator', 'session']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。連結順を確認してください。');
      }
    }
    root.CRW.collectorApp = factory(root.CRW.formatter, root.CRW.session, root.CRW.structure);
  }
})(globalThis, function (formatter, session, structure) {
  'use strict';

  // 引用一覧の抽出セレクタ（最優先の収集元）。#claim_cite は「引用一覧」ペインの本体で、
  // ページ側の解析実行後は常に中身を持つ
  const CITE_SELECTORS = ['#claim_cite', '#claim_dialog #claim_cite'];

  // 罫線ツリーの抽出セレクタ（フォールバック）。#claim_tree は常駐のデータ保持用（hidden）、
  // #claim_dialog は「木構造」ダイアログ表示中のみ .div_tree を含む
  const TREE_SELECTORS = ['#claim_tree .div_tree', '#claim_dialog .div_tree', '.div_tree'];

  // ページ側が引用パターン上限に達したことを示す要素。到達時に class="hidden" が外れる
  const OVERFLOW_SELECTORS = ['#claim_warn_overflow', '#claim_kian_overflow'];

  // div_tree / claim_cite の innerHTML をプレーンテキストへ（純関数・Nodeでテスト可能）。
  // 罫線ツリーの中身は「テキスト + <br> 行終端」のみ、引用一覧は加えて <b> と、
  // 新 UI（2026 年〜）では請求項ごとの <div> を含む。ブロック境界を改行にしないと
  // 引用一覧のレコードが 1 行に連結され、「次の [n]請求項」の境界判定が壊れる。
  // 残タグ除去と基本エンティティ復元で正しく平文化できる。&amp; の復元は必ず最後。
  function treeHtmlToText(html) {
    let t = String(html == null ? '' : html);
    t = t.replace(/<br\s*\/?>/gi, '\n');
    t = t.replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, '\n');
    t = t.replace(/<(?:div|p|li|tr|h[1-6])(?:\s[^>]*)?>/gi, '\n');
    t = t.replace(/<[^>]*>/g, '');
    t = t.replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
    return t;
  }

  // セレクタ群を順に試し、最初に中身のある要素のテキストを返す
  function firstNonEmpty(d, selectors) {
    for (const selector of selectors) {
      const nodes = d.querySelectorAll(selector);
      for (const el of nodes) {
        const text = treeHtmlToText(el.innerHTML);
        if (text.trim() !== '') return { text, selector };
      }
    }
    return null;
  }

  // ページ側で「引用パターン全展開上限数到達」の警告が表示されているか。
  // 罫線ツリーへフォールバックしたときだけ必要になる（引用一覧なら本文に★行が含まれる）
  function pageHasOverflowWarning(doc) {
    const d = doc || document;
    for (const selector of OVERFLOW_SELECTORS) {
      const el = d.querySelector && d.querySelector(selector);
      if (!el) continue;
      const hidden = el.className && String(el.className).split(/\s+/).indexOf('hidden') !== -1;
      if (!hidden && treeHtmlToText(el.innerHTML).trim() !== '') return true;
    }
    return false;
  }

  // ページから木構造テキストを収集する（罫線ツリーのみ。互換のため残す）
  function extractTreeText(doc) {
    const d = doc || document;
    const hit = firstNonEmpty(d, TREE_SELECTORS);
    if (hit) return { ok: true, text: hit.text, selector: hit.selector };
    return {
      ok: false,
      error: 'クレーム構造が見つかりませんでした。ページ側で「クレーム解析」を実行してから' +
        '「ページから再取得」を押すか、下の欄に木構造を手動で貼り付けてください。',
    };
  }

  // ページからクレーム構造を収集する。引用一覧（#claim_cite）を最優先し、
  // 無ければ罫線ツリーへフォールバックする
  function extractStructureText(doc) {
    const d = doc || document;
    const cite = firstNonEmpty(d, CITE_SELECTORS);
    if (cite) return { ok: true, text: cite.text, selector: cite.selector, format: 'cite' };

    const tree = firstNonEmpty(d, TREE_SELECTORS);
    if (tree) {
      return {
        ok: true,
        text: tree.text,
        selector: tree.selector,
        format: 'tree',
        // 上限到達時の罫線ツリーは欠落しているため、フォールバック時のみ判定して伝える
        truncatedTree: pageHasOverflowWarning(d),
      };
    }
    return {
      ok: false,
      error: 'クレーム構造が見つかりませんでした。ページ側で「クレーム解析」を実行してから' +
        '「ページから再取得」を押すか、下の欄に引用一覧または木構造を手動で貼り付けてください。',
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
    '    <summary>収集したクレーム構造（編集できます）</summary>',
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
      showTreeWarn(['ページのクレーム構造が変わりました。「ページから再取得」を押してください。']);
      els.treeDetails.open = true;
      els.generate.disabled = true;
    }
    function clearStale() {
      hideTreeWarn();
      els.generate.disabled = false;
    }

    // ---- データ源の注意書き（上限到達・自己矛盾など） ----
    function showTreeWarn(messages) {
      els.treeWarn.textContent = messages.join('\n');
      els.treeWarn.hidden = false;
    }
    function hideTreeWarn() {
      els.treeWarn.hidden = true;
      els.treeWarn.textContent = '';
    }

    // ---- 収集と解析 ----
    // 収集元・解析結果から出す注意書きを組み立てる（生成はブロックしない）
    function collectNotices(res) {
      const notices = [];
      if (state.sourceMeta && state.sourceMeta.overflow) {
        notices.push(
          'ページ側で引用パターンが上限（' + (state.sourceMeta.overflowLimit || 5000) +
          '）に達しています。木構造は不完全になるため、引用一覧から解析しました。'
        );
      }
      if (res && res.format === 'tree' && res.truncatedTree) {
        notices.push(
          'ページ側で引用パターンが上限に達しており、木構造には一部の請求項しか含まれていません。' +
          '「引用一覧」を表示してから「ページから再取得」を押すか、引用一覧を下の欄に貼り付けてください。'
        );
      }
      for (const w of state.sourceWarnings || []) notices.push(w);
      return notices;
    }

    function tryParseForSummary(res) {
      const parsed = session.parseIntoState(state);
      if (!parsed.ok) {
        setStatus('error',
          '収集したクレーム構造の解析に失敗しました。下の欄で修正してください。\n' +
          parsed.errors.map((e) => (e.line != null ? e.line + '行目: ' : '') + e.message).join('\n'));
        els.treeDetails.open = true;
        hideTreeWarn();
        return;
      }
      const f = formatter.formatClaimNumbers;
      setStatus('success',
        structure.formatLabel(parsed.format) + 'から収集しました: 請求項 ' +
        parsed.graph.nodes.length + ' 項（独立請求項: ' + f(parsed.graph.roots) + '）');

      const notices = collectNotices(res);
      if (notices.length > 0) {
        showTreeWarn(notices);
        els.treeDetails.open = true;
      } else {
        hideTreeWarn();
      }
    }

    function collectFromPage() {
      // 収集のたびに現行の #claim_cite / #claim_tree へ observer を張り直す（起動時に要素が
      // 無かった場合や、ページ側で要素ごと差し替えられた場合の検知漏れを防ぐ）
      bindObserver();
      const res = extractStructureText(doc);
      if (res.ok) {
        els.tree.value = res.text;
        lastCollectedText = res.text;
        applyUpstreamChange('treeText', res.text);
        els.generate.disabled = false; // 陳腐化フラグの解除（警告表示は tryParse 側が決める）
        tryParseForSummary(res);
      } else {
        setStatus('error', res.error);
        els.treeDetails.open = true;
        clearStale();
      }
    }

    function handleRefetch() {
      const current = els.tree.value;
      if (current.trim() !== '' && current !== lastCollectedText) {
        if (!window.confirm('編集中のクレーム構造を破棄して、ページから取得し直します。よろしいですか？')) return;
      }
      collectFromPage();
    }

    // ---- 生成（押下時に明示再解析。generateFromState は自前で解析しないため） ----
    function ensureParsed() {
      if (state.graph) return true;
      const parsed = session.parseIntoState(state);
      if (!parsed.ok) {
        showErrors(parsed.errors.map((e) => (e.line != null ? e.line + '行目: ' : '') + e.message));
        els.treeDetails.open = true;
        return false;
      }
      // 手動編集後は収集元の注意書きを解析結果から出し直す（上限到達の見落とし防止）
      const notices = collectNotices(null);
      if (notices.length > 0) {
        showTreeWarn(notices);
      } else {
        hideTreeWarn();
      }
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
    // 収集元が #claim_cite / #claim_tree のどちらでも陳腐化を検知できるよう両方を監視する
    let observers = [];
    function bindObserver() {
      for (const o of observers) o.disconnect();
      observers = [];
      if (typeof MutationObserver !== 'function') return;
      for (const id of ['claim_cite', 'claim_tree']) {
        const host = doc.getElementById(id);
        if (!host) continue;
        const observer = new MutationObserver(markStale);
        observer.observe(host, { childList: true, subtree: true, characterData: true });
        observers.push(observer);
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
      for (const o of observers) o.disconnect();
      observers = [];
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

  return {
    CITE_SELECTORS, TREE_SELECTORS, OVERFLOW_SELECTORS,
    treeHtmlToText, extractTreeText, extractStructureText, pageHasOverflowWarning, launch,
  };
});

globalThis.CRW.collectorApp.launch({"target":"new","label":"書類比較・クレームチェッカー（新版）"});
} catch (e) {
alert('Claim Relation Writer: 起動に失敗しました: ' + ((e && e.message) || e));
}
})();
