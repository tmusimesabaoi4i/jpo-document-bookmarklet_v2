/*
 * claim-structure.js — 特許請求の範囲の構造解析（DOM非依存の純粋モジュール）
 *
 * 「書類比較・クレームチェッカー」ページのクレーム解析結果から請求項の構造を組み立てる。
 * データ源と役割は次のとおり（役割を分けており、どれかが欠けても縮退して動く）:
 *
 *   1. #claim_tree .div_tree … 罫線ツリー。**引用関係の一次情報**。
 *      記法の解析は本プロジェクト内の claim-tree.js（RRB.claimTree）が行う
 *   2. #claim_cite … **合計請求項数**と独立請求項の一次情報（「合計請求項数: 26
 *      (独立請求項: 1,25,26)」）。ツリー由来の構造との照合にも使う
 *   3. #claim_mark … 請求項全文（【請求項 N】区切り）。全文表示と、引用表現の文字列・
 *      引用種別（単独／選択的／累積的）の判定に使う。ツリーが無い場合は引用関係の
 *      フォールバック情報源にもなる
 *
 * 引用関係はツリーを優先し、本文の引用表現と食い違う場合は上書きせず警告する。
 *
 * 拒絶理由文中に書かれた引用関係（「請求項２、４を引用する請求項５-７」）とは別物であり、
 * 混同しないよう本モジュールは拒絶理由テキストを一切参照しない（照合は consistency.js）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'), require('./claims'), require('./claim-tree'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.claimStructure = factory(root.RRB.normalizer, root.RRB.claims, root.RRB.claimTree);
  }
})(globalThis, function (normalizer, claims, claimTree) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr || [])).sort((a, b) => a - b);
  }

  // ---- HTML → プレーンテキスト -------------------------------------------

  // クレーム解析結果の innerHTML をプレーンテキストにする。
  // ページ側が本文に挿入した通番マーカーは原文の一部ではないため取り除く。
  //   旧 UI: <span class="showCiteCited…">[1-7]</span>
  //   新 UI: <span class="cited_word|jump_link show_word">[1-7]</span>
  // どの世代でも「span の中身が [n-m] だけ」ならマーカーなので、class 名に依存せず除く。
  // &amp; の復元は必ず最後。
  function claimHtmlToText(html) {
    let t = String(html == null ? '' : html);
    t = t.replace(/<br\s*\/?>/gi, '\n');
    // 通番マーカー（[1-7] 等）を span ごと除去する
    t = t.replace(/<span\b[^>]*>\s*\[\d+-\d+\]\s*<\/span>/gi, '');
    t = t.replace(/<[^>]*>/g, '');
    t = t.replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, '&');
    return t;
  }

  // ---- 請求項本文の分割 ---------------------------------------------------

  // 【請求項 N】 見出しで請求項全文を分割する。
  // 対応形: 【請求項 1】【請求項1】［請求項1］[請求項1] ／ 行が「請求項1」だけの場合
  function parseClaimTexts(plainText) {
    const raw = normalizer.normalizeLineEndings(plainText);
    const match = normalizer.normalizeForMatching(raw);
    // 見出し: 全角/半角の各種括弧つき、または行全体が「請求項N」
    const headingRe = /[【［\[][ \t　]*請求項[ \t　]*(\d+)[ \t　]*[】］\]]|^[ \t　]*請求項[ \t　]*(\d+)[ \t　]*$/gm;
    const heads = [];
    let m;
    while ((m = headingRe.exec(match)) !== null) {
      const num = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2], 10);
      heads.push({ claimNumber: num, start: m.index, end: m.index + m[0].length });
    }
    const items = [];
    for (let i = 0; i < heads.length; i++) {
      const bodyEnd = i + 1 < heads.length ? heads[i + 1].start : raw.length;
      items.push({
        claimNumber: heads[i].claimNumber,
        text: raw.slice(heads[i].end, bodyEnd).replace(/^[\s　]+|[\s　]+$/g, ''),
        headingRaw: raw.slice(heads[i].start, heads[i].end),
      });
    }
    return items;
  }

  // ---- 引用表現の解析 -----------------------------------------------------

  // 引用表現の番号列（例: 「1」「1又は2」「1から3のいずれか一項」「1、2又は4」「1ないし4」）を
  // 整数配列へ。範囲: から / ないし / - / ～、列挙: 、／又は／若しくは／及び／並びに
  function parseDependencyClaimList(numberListMatch) {
    const norm = String(numberListMatch == null ? '' : numberListMatch);
    const out = [];
    // 範囲: から / ないし / 乃至 / -（正規化でダッシュ類とチルダは - に統一済み）
    // 列挙: 、／又は／または／若しくは／もしくは／及び／および／並びに
    const tokenRe = /(\d+)|(から|ないし|乃至|-|至)|(、|又は|または|若しくは|もしくは|及び|および|並びに)|([\s\S])/g;
    let pending = null;
    let rangeOp = false;
    let sawSelective = false;
    let sawCumulative = false;
    let m;
    while ((m = tokenRe.exec(norm)) !== null) {
      if (m[1] !== undefined) {
        const n = parseInt(m[1], 10);
        if (rangeOp) {
          if (pending === null || n < pending || n - pending > 999) return null;
          for (let k = pending; k <= n; k++) out.push(k);
          pending = null;
          rangeOp = false;
        } else {
          if (pending !== null) out.push(pending);
          pending = n;
        }
      } else if (m[2] !== undefined) {
        if (pending === null || rangeOp) return null;
        rangeOp = true;
      } else if (m[3] !== undefined) {
        if (/又は|または|若しくは|もしくは/.test(m[3])) sawSelective = true;
        if (/及び|および|並びに/.test(m[3])) sawCumulative = true;
        if (pending !== null) { out.push(pending); pending = null; }
      } else {
        // 数値列以外の文字（「のいずれか一項」等）が来たら番号列は終わり
        break;
      }
    }
    if (rangeOp) return null;
    if (pending !== null) out.push(pending);
    if (out.length === 0) return null;
    return { claims: uniqueSorted(out), sawSelective, sawCumulative };
  }

  // 請求項本文から引用表現を解析する。
  // 例: 「ことを特徴とする請求項4に記載のプログラム。」
  //     「請求項1から3のいずれか一項に記載の情報処理装置において、」
  // 戻り値: { expression, claims, type, raw } または null（引用表現なし＝独立請求項）
  function parseDependencyExpression(claimText) {
    const raw = String(claimText == null ? '' : claimText);
    const match = normalizer.normalizeForMatching(raw);
    // 引用節: 請求項<番号列>[のいずれか(一項)](に記載|に係る|に規定|において|記載)
    // 番号列に許すのは、数字・空白・読点と、範囲語（から/ないし/乃至/-）および
    // 列挙語（又は/または/若しくは/もしくは/及び/および/並びに）を構成する文字のみ。
    // 非貪欲にして、直後の「に記載」等の終端で止める。
    const NUM_LIST = '[0-9\\s　、\\-又はまたも若しくび及お並にないしから乃至]{1,60}?';
    const re = new RegExp(
      '請求項[ \\t　]*(' + NUM_LIST + ')' +
      '(?:の(?:いずれか|うち)(?:一項|1項)?)?[ \\t　]*' +
      '(?:に記載|に係る|に規定|において|記載)', 'gd');
    let best = null;
    let m;
    while ((m = re.exec(match)) !== null) {
      const parsed = parseDependencyClaimList(m[1]);
      if (parsed === null) continue;
      const hasEither = /の(?:いずれか|うち)/.test(m[0]);
      let type;
      if (parsed.claims.length === 1) type = 'single';
      else if (hasEither || parsed.sawSelective) type = 'selective';
      else if (parsed.sawCumulative) type = 'cumulative';
      else type = 'selective';   // 複数番号で選択語が無い場合も選択的引用として扱う
      const cand = {
        expression: raw.slice(m.indices[0][0], m.indices[0][1]),
        claims: parsed.claims,
        type,
        index: m.index,
      };
      // 引用表現は文末に置かれるのが通例。最後に現れたものを採用する
      if (best === null || cand.index > best.index) best = cand;
    }
    if (best === null) return null;
    return { expression: best.expression, claims: best.claims, type: best.type };
  }

  // ---- 罫線ツリー（引用関係の一次情報） -----------------------------------

  // #claim_tree .div_tree のテキストを解析し、引用関係を得る。
  // 記法の解析は claim-tree.js（RRB.claimTree）に委譲する
  //   （グラフの辺 [from, to] は「to が from を引用する」向き）。
  // 戻り値: { ok: true, nodes, roots, dependencies: Map<number, number[]> }
  //         | { ok: false, error }
  function parseClaimTree(treeText) {
    if (!claimTree || typeof claimTree.parseClaimTree !== 'function') {
      return {
        ok: false,
        error: '罫線ツリーの解析モジュール（claim-tree.js）が読み込まれていません。',
      };
    }
    const text = String(treeText == null ? '' : treeText);
    if (text.trim() === '') return { ok: false, error: '罫線ツリーが空です。' };
    const parsed = claimTree.parseClaimTree(text);
    if (!parsed.ok) {
      const messages = (parsed.errors || []).map(
        (e) => (e.line === null || e.line === undefined ? '' : e.line + '行目: ') + e.message);
      return { ok: false, error: '罫線ツリーを解析できませんでした: ' + messages.join(' / ') };
    }
    const dependencies = new Map();
    for (const n of parsed.graph.nodes) dependencies.set(n, []);
    for (const [from, to] of parsed.graph.edges) {
      dependencies.get(to).push(from);   // to が from を引用する
    }
    for (const [k, v] of dependencies) dependencies.set(k, uniqueSorted(v));
    return {
      ok: true,
      nodes: parsed.graph.nodes.slice(),
      roots: parsed.graph.roots.slice(),
      dependencies,
    };
  }

  // ---- 構造の構築 ---------------------------------------------------------

  // 到達可能集合（推移閉包）。循環があっても停止する（訪問済み管理）
  function reachable(startList, adjacency) {
    const seen = new Set();
    const stack = (startList || []).slice();
    while (stack.length > 0) {
      const n = stack.pop();
      const next = adjacency.get(n) || [];
      for (const x of next) {
        if (!seen.has(x)) { seen.add(x); stack.push(x); }
      }
    }
    return uniqueSorted(Array.from(seen));
  }

  // 引用経路（from → to）を1本返す（幅優先。無ければ null）
  function findDependencyPath(from, to, childAdjacency) {
    if (from === to) return [from];
    const queue = [[from]];
    const visited = new Set([from]);
    while (queue.length > 0) {
      const path = queue.shift();
      const last = path[path.length - 1];
      for (const child of childAdjacency.get(last) || []) {
        if (visited.has(child)) continue;
        const next = path.concat([child]);
        if (child === to) return next;
        visited.add(child);
        queue.push(next);
      }
    }
    return null;
  }

  // 請求項配列（[{claimNumber, text}]）から構造を構築する。
  // options.source            … 由来ラベル（'claim_tree' | 'claim_mark' | 'pasted' | 'manual'）
  // options.dependencies      … 引用関係 Map<number, number[]>（罫線ツリー由来。**本文解析より優先**）
  // options.totalClaimCount   … 合計請求項数（#claim_cite 由来。あれば優先）
  // options.independentClaims … 独立請求項（#claim_cite 由来。照合用）
  function build(claimList, options) {
    const opts = options || {};
    const warnings = [];
    const seenNumbers = new Map();
    const entries = [];
    const hasTree = !!(opts.dependencies && opts.dependencies.size > 0);

    for (const c of claimList || []) {
      const num = c.claimNumber;
      if (seenNumbers.has(num)) {
        warnings.push(makeWarning('CLAIM_NUMBER_DUPLICATE',
          '請求項' + num + 'が重複しています。後の記載を無視しました。', 'error'));
        continue;
      }
      seenNumbers.set(num, true);
      const text = String(c.text == null ? '' : c.text);
      // 引用表現は「表現の文字列」と「引用種別（単独／選択的／累積的）」のために常に解析する
      const textDep = parseDependencyExpression(text);
      const itemWarnings = [];
      let directParents;
      let parentsSource;
      if (opts.dependencies && opts.dependencies.has(num)) {
        directParents = uniqueSorted(opts.dependencies.get(num));
        parentsSource = 'claim_tree';
        // ツリーと本文の引用表現が食い違う場合は上書きせず警告する（誤りの発見が目的）
        if (textDep !== null && textDep.claims.join(',') !== directParents.join(',')) {
          itemWarnings.push(makeWarning('TREE_TEXT_DEPENDENCY_MISMATCH',
            '請求項' + num + 'の引用元が、罫線ツリー（' +
            (directParents.length === 0 ? 'なし' : claims.compressClaimNumbers(directParents)) +
            '）と請求項本文の引用表現（' + claims.compressClaimNumbers(textDep.claims) +
            '）で一致しません。原文を確認してください。', 'warn'));
        }
        if (textDep === null && directParents.length > 0 && text !== '') {
          itemWarnings.push(makeWarning('TREE_TEXT_DEPENDENCY_MISMATCH',
            '請求項' + num + 'は罫線ツリーでは請求項' + claims.compressClaimNumbers(directParents) +
            'を引用していますが、請求項本文から引用表現を検出できませんでした。', 'warn'));
        }
      } else {
        directParents = textDep === null ? [] : textDep.claims.slice();
        parentsSource = hasTree ? 'text-fallback' : 'text';
        if (hasTree) {
          itemWarnings.push(makeWarning('CLAIM_NOT_IN_TREE',
            '請求項' + num + 'が罫線ツリーに現れないため、請求項本文の引用表現から引用関係を推定しました。', 'warn'));
        }
      }
      entries.push({
        claimNumber: num,
        text,
        type: directParents.length === 0 ? 'independent' : 'dependent',
        directParents,
        allAncestors: [],
        directChildren: [],
        allDescendants: [],
        dependencyExpression: textDep === null ? null : textDep.expression,
        dependencyType: textDep !== null ? textDep.type
          : (directParents.length > 1 ? 'selective' : (directParents.length === 1 ? 'single' : null)),
        parentsSource,
        warnings: itemWarnings,
      });
    }
    entries.sort((a, b) => a.claimNumber - b.claimNumber);

    const numbers = entries.map((e) => e.claimNumber);
    const numberSet = new Set(numbers);

    // 番号の連続性（1 から欠番なし）を確認する
    if (numbers.length > 0) {
      if (numbers[0] !== 1) {
        warnings.push(makeWarning('CLAIM_NUMBER_START',
          '請求項番号が1から始まっていません（最小: ' + numbers[0] + '）。', 'warn'));
      }
      const gaps = [];
      for (let n = 1; n <= numbers[numbers.length - 1]; n++) {
        if (!numberSet.has(n)) gaps.push(n);
      }
      if (gaps.length > 0) {
        warnings.push(makeWarning('CLAIM_NUMBER_GAP',
          '請求項番号に欠番があります: ' + claims.compressClaimNumbers(gaps), 'warn'));
      }
    }

    // 引用先の妥当性（存在・自己引用・後方引用）
    const byNumber = new Map(entries.map((e) => [e.claimNumber, e]));
    for (const e of entries) {
      const valid = [];
      for (const p of e.directParents) {
        if (p === e.claimNumber) {
          e.warnings.push(makeWarning('CLAIM_SELF_REFERENCE',
            '請求項' + e.claimNumber + 'が自身を引用しています。', 'error'));
          continue;
        }
        if (!numberSet.has(p)) {
          e.warnings.push(makeWarning('CLAIM_PARENT_NOT_FOUND',
            '請求項' + e.claimNumber + 'が引用する請求項' + p + 'は存在しません。', 'error'));
          continue;
        }
        if (p > e.claimNumber) {
          e.warnings.push(makeWarning('CLAIM_FORWARD_REFERENCE',
            '請求項' + e.claimNumber + 'が後方の請求項' + p + 'を引用しています（通常は前方の請求項を引用します）。', 'warn'));
        }
        valid.push(p);
      }
      e.directParents = uniqueSorted(valid);
      if (e.directParents.length === 0 && e.type === 'dependent') {
        // 引用先が全て無効だった場合は独立請求項として扱う
        e.type = 'independent';
      }
    }

    // 隣接リスト（親→子 / 子→親）
    const parentAdj = new Map();   // n → 直接引用元
    const childAdj = new Map();    // n → 直接下位
    for (const e of entries) {
      parentAdj.set(e.claimNumber, e.directParents.slice());
      if (!childAdj.has(e.claimNumber)) childAdj.set(e.claimNumber, []);
    }
    for (const e of entries) {
      for (const p of e.directParents) {
        if (!childAdj.has(p)) childAdj.set(p, []);
        childAdj.get(p).push(e.claimNumber);
      }
    }
    for (const [k, v] of childAdj) childAdj.set(k, uniqueSorted(v));

    // 推移閉包と循環検出
    for (const e of entries) {
      e.allAncestors = reachable([e.claimNumber], parentAdj);
      e.allDescendants = reachable([e.claimNumber], childAdj);
      e.directChildren = (childAdj.get(e.claimNumber) || []).slice();
      if (e.allAncestors.indexOf(e.claimNumber) !== -1) {
        e.warnings.push(makeWarning('CLAIM_CIRCULAR_REFERENCE',
          '請求項' + e.claimNumber + 'の引用関係が循環しています。', 'error'));
      }
    }

    const independentClaims = entries.filter((e) => e.type === 'independent').map((e) => e.claimNumber);
    if (entries.length > 0 && independentClaims.length === 0) {
      warnings.push(makeWarning('NO_INDEPENDENT_CLAIM',
        '独立請求項を検出できませんでした。引用関係の解析結果を確認してください。', 'error'));
    }
    // #claim_cite の独立請求項一覧と照合する
    if (Array.isArray(opts.independentClaims) && opts.independentClaims.length > 0) {
      const a = independentClaims.join(',');
      const b = uniqueSorted(opts.independentClaims).join(',');
      if (a !== b) {
        warnings.push(makeWarning('INDEPENDENT_CLAIMS_MISMATCH',
          '独立請求項が、引用関係の解析結果（' + (a === '' ? 'なし' : a) +
          '）とページ側の一覧（' + b + '）で一致しません。', 'warn'));
      }
    }

    // 合計請求項数は #claim_cite の値を優先する（無ければ検出した最大番号）
    const maxFound = numbers.length === 0 ? 0 : numbers[numbers.length - 1];
    let totalClaimCount = maxFound;
    let totalClaimCountSource = 'max-claim-number';
    if (typeof opts.totalClaimCount === 'number' && opts.totalClaimCount > 0) {
      totalClaimCount = opts.totalClaimCount;
      totalClaimCountSource = 'claim_cite';
      if (opts.totalClaimCount !== maxFound) {
        warnings.push(makeWarning('CLAIM_TOTAL_MISMATCH',
          'ページ側の合計請求項数（' + opts.totalClaimCount + '）と、抽出できた請求項の最大番号（' +
          maxFound + '）が一致しません。', 'warn'));
      }
    }

    return {
      source: opts.source || 'unknown',
      sourceLabel: opts.sourceLabel || null,
      totalClaimCount,
      totalClaimCountSource,
      claimNumbers: numbers,
      independentClaims,
      claims: entries,
      warnings,
      crossChecks: [],
      // 引用経路の探索（consistency.js が指摘漏れの根拠表示に使う）
      findPath: function (from, to) { return findDependencyPath(from, to, childAdj); },
    };
  }

  // ---- 照合用の別データ源 -------------------------------------------------

  // #claim_cite のプレーンテキストからページ側の計算結果を読む。
  // 形式: 「合計請求項数: 26  (独立請求項: 1,25,26)」
  //       「[2]請求項2 『…』 従属請求項」
  //       「　引用請求項: 1 (間接引用: 1,2)　引用パターンの数: 1」
  //       「　被引用請求項: 3,4,5,6,7(うち間接被引用: 5)」
  // 注意1: 「被引用請求項」は「引用請求項」を部分文字列として含むため、否定後読みで区別する。
  // 注意2: ページ側の「被引用請求項」は直接＋間接の**全下位**であり、そのうち間接分が
  //        「うち間接被引用」で示される（直接下位 = 全下位 − 間接下位）。同様に
  //        「引用請求項」は直接引用元、「間接引用」は間接の引用元。
  function parseClaimCiteText(plainText) {
    const text = normalizer.normalizeForMatching(normalizer.normalizeLineEndings(plainText));
    if (text.trim() === '') return null;
    const totalM = /合計請求項数[ \t　]*:[ \t　]*(\d+)/.exec(text);
    const indepM = /独立請求項[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(text);
    const numList = (s) => uniqueSorted(String(s || '').split(/[,、\s　]+/).filter((x) => x !== '').map(Number).filter((n) => !isNaN(n)));
    const diff = (a, b) => a.filter((n) => b.indexOf(n) === -1);
    const entries = [];
    // 各請求項の記載: [n]請求項n … 次の [n]請求項 まで。
    // 新 UI はレコードが <div> で並び、HTML→テキストで改行にならないことがあるため、
    // 境界の空白は改行に限らない。
    const blockRe = /\[(\d+)\][ \t　]*請求項[ \t　]*(\d+)([\s\S]*?)(?=[\s　]*\[\d+\][ \t　]*請求項|$)/g;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
      const body = m[3];
      const parentsM = /(?<!被)引用請求項[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const indirectParentsM = /(?<!被)間接引用[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const citedByM = /被引用請求項[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const indirectCitedByM = /間接被引用[ \t　]*:[ \t　]*([\d,、\s　]+)/.exec(body);
      const patternM = /引用パターンの数[ \t　]*:[ \t　]*(\d+)/.exec(body);
      const listedParents = parentsM ? numList(parentsM[1]) : [];
      const indirectAncestors = indirectParentsM ? numList(indirectParentsM[1]) : [];
      // 新 UI の「引用請求項」は直接＋間接の全引用元なので、間接分を除いて直接引用元にする。
      // 旧 UI はもともと直接分だけなので、この差し引きは no-op。
      const indirectAncestorSet = new Set(indirectAncestors);
      const directParents = listedParents.filter((n) => !indirectAncestorSet.has(n));
      const allDescendants = citedByM ? numList(citedByM[1]) : [];
      const indirectDescendants = indirectCitedByM ? numList(indirectCitedByM[1]) : [];
      entries.push({
        claimNumber: parseInt(m[2], 10),
        type: /独立請求項/.test(body) ? 'independent' : 'dependent',
        directParents,
        indirectAncestors,
        allAncestors: uniqueSorted(directParents.concat(indirectAncestors)),
        allDescendants,
        indirectDescendants,
        directChildren: diff(allDescendants, indirectDescendants),
        patternCount: patternM ? parseInt(patternM[1], 10) : null,
      });
    }
    if (totalM === null && entries.length === 0) return null;
    return {
      totalClaimCount: totalM ? parseInt(totalM[1], 10) : null,
      independentClaims: indepM ? numList(indepM[1]) : [],
      entries,
    };
  }

  // 自前解析（structure）とページ側の計算結果（cite）を照合する。
  // 直接引用元・全引用元・直接下位・全下位の4集合すべてを突き合わせる。
  function crossCheckWithCite(structure, cite) {
    const results = [];
    if (structure === null || cite === null) return results;
    if (cite.totalClaimCount !== null && cite.totalClaimCount !== structure.totalClaimCount) {
      results.push(makeWarning('CLAIM_TOTAL_MISMATCH',
        'ページ側の合計請求項数（' + cite.totalClaimCount + '）と請求項本文から数えた総数（' +
        structure.totalClaimCount + '）が一致しません。', 'warn'));
    }
    const byNum = new Map(structure.claims.map((c) => [c.claimNumber, c]));
    const FIELDS = [
      ['directParents', '直接引用元'],
      ['allAncestors', '全引用元'],
      ['directChildren', '直接下位'],
      ['allDescendants', '全下位'],
    ];
    for (const e of cite.entries) {
      const mine = byNum.get(e.claimNumber);
      if (!mine) {
        results.push(makeWarning('CLAIM_CITE_UNKNOWN_CLAIM',
          'ページ側の引用関係一覧にある請求項' + e.claimNumber + 'が請求項本文から抽出できていません。', 'warn'));
        continue;
      }
      for (const [field, label] of FIELDS) {
        // 全引用元は自身を含めない形で比較する（自前解析は自身を含まない）
        const a = uniqueSorted(mine[field]).join(',');
        const b = uniqueSorted(e[field]).join(',');
        if (a !== b) {
          results.push(makeWarning('CLAIM_DEPENDENCY_MISMATCH',
            '請求項' + e.claimNumber + 'の' + label + 'が、請求項本文の解析（' + (a === '' ? 'なし' : a) +
            '）とページ側の一覧（' + (b === '' ? 'なし' : b) + '）で一致しません。', 'warn'));
        }
      }
    }
    return results;
  }

  return {
    claimHtmlToText,
    parseClaimTexts,
    parseDependencyClaimList,
    parseDependencyExpression,
    parseClaimTree,
    hasTreeParser: function () { return !!claimTree && typeof claimTree.parseClaimTree === 'function'; },
    build,
    parseClaimCiteText,
    crossCheckWithCite,
  };
});
