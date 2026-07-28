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
