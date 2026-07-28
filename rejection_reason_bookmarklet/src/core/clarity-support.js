/*
 * clarity-support.js — 明確性・サポート要件の指摘項目解析（DOM非依存の純粋モジュール）
 *
 * 1 ブロック（・請求項 … で始まる指摘項目）を文単位に分割し、文ごとに
 * 次のパターンを適用して ITEM（docs/specification.md）へ構造化する。
 *
 *   直接指摘:   請求項Ｐを引用する請求項Ｙには…（direct=Y, 引用元=P）
 *               請求項Ｘには… ／ 請求項Ｘに係る発明において…
 *               ※ Ｘが見出し請求項と交わらない場合（例: しかしながら、請求項１には…）は
 *                 直接指摘ではなく比較対象とみなす（接続詞のリストに依存しない汎用規則）
 *   引用文言:   「…」『…』。直前のアンカー（請求項…には／に係る発明において／明細書には）
 *               から役割（問題となる記載・比較対象の記載・明細書の記載）を決める
 *   同様指摘:   請求項Ａにも同様の点が指摘され(る)
 *   引用指摘:   請求項Ｐを引用する請求項Ａにも同様の点が指摘され(る)
 *               ※ 両者は一文に融合されうる（「…指摘され、…指摘される。」）ため、
 *                 引用元プレフィックスを任意項とする単一の正規表現で両対応する
 *   明細書文:   （本願）明細書には…（こと|点）は記載されていない → 要約素材
 *   結論文:     よって、請求項Ｘ…に係る発明は…
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./claims'), require('./splitter'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.claritySupport = factory(root.RRB.claims, root.RRB.splitter);
  }
})(globalThis, function (claims, splitter) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  const EXPR = claims.EXPR_SRC;

  // ---- 文分割 -------------------------------------------------------------

  // 開き括弧 → 閉じ括弧の対応（かぎ括弧内の句点では文を切らない）
  const OPEN_TO_CLOSE = { '「': '」', '『': '』', '（': '）', '〔': '〕' };
  const CLOSERS = { '」': '「', '』': '『', '）': '（', '〕': '〔' };

  // ブロック本文を論理文に分割する。各行の行頭字下げを除去して行を連結し、
  // 括弧深度 0 の「。」で区切る。raw / match は同じ長さのまま並走させる。
  // 戻り値: [{ raw, match, index }]
  function splitSentences(matchText, rawText) {
    const rawSrc = rawText == null ? String(matchText) : String(rawText);
    const matchLines = String(matchText).split('\n');
    const rawLines = rawSrc.split('\n');
    let joinedMatch = '';
    let joinedRaw = '';
    for (let i = 0; i < matchLines.length; i++) {
      // 行頭の字下げ（半角空白・タブ・全角空白）だけを除去する
      const stripped = matchLines[i].replace(/^[ \t　]+/, '');
      const cut = matchLines[i].length - stripped.length;
      joinedMatch += matchLines[i].slice(cut);
      joinedRaw += rawLines[i].slice(cut);
    }
    const sentences = [];
    const stack = [];
    let start = 0;
    for (let i = 0; i < joinedMatch.length; i++) {
      const ch = joinedMatch[i];
      if (OPEN_TO_CLOSE[ch]) {
        stack.push(ch);
      } else if (CLOSERS[ch]) {
        // 対応しない閉じ括弧は無視（深度を 0 未満にしない）
        if (stack.length > 0 && stack[stack.length - 1] === CLOSERS[ch]) stack.pop();
      } else if (ch === '。' && stack.length === 0) {
        sentences.push({
          raw: joinedRaw.slice(start, i + 1),
          match: joinedMatch.slice(start, i + 1),
          index: start,
        });
        start = i + 1;
      }
    }
    if (start < joinedMatch.length && joinedMatch.slice(start).trim() !== '') {
      sentences.push({
        raw: joinedRaw.slice(start),
        match: joinedMatch.slice(start),
        index: start,
      });
    }
    return sentences;
  }

  // ---- かぎ括弧スパン -----------------------------------------------------

  // 文中のトップレベルの「…」『…』スパンを返す（入れ子の内側は外側の一部）。
  // 戻り値: [{ start, end, innerStart, innerEnd }]（end は閉じ括弧の次）
  function scanQuotes(matchSentence) {
    const spans = [];
    const stack = [];
    for (let i = 0; i < matchSentence.length; i++) {
      const ch = matchSentence[i];
      if (ch === '「' || ch === '『') {
        stack.push({ ch, index: i });
      } else if (ch === '」' || ch === '』') {
        const opener = ch === '」' ? '「' : '『';
        if (stack.length > 0 && stack[stack.length - 1].ch === opener) {
          const top = stack.pop();
          if (stack.length === 0) {
            spans.push({ start: top.index, end: i + 1, innerStart: top.index + 1, innerEnd: i });
          }
        }
      }
    }
    return spans;
  }

  // ---- 文単位の抽出器 -----------------------------------------------------

  // 同様指摘・引用関係指摘（融合文対応の単一正規表現）。
  //   （請求項Ｐを引用する）? 請求項Ａ にも同様の点が指摘され
  // 連用形「指摘され、」でも終止形「指摘される。」でもマッチする。
  function sameOrDependencyRe() {
    return new RegExp(
      '(?:請求項\\s*(' + EXPR + ')\\s*を引用する\\s*)?請求項\\s*(' + EXPR + ')\\s*にも同様の点が指摘され',
      'gd'
    );
  }

  // 直接指摘 D1: 請求項Ｐを引用する請求項Ｙには
  function directWithParentRe() {
    return new RegExp('請求項\\s*(' + EXPR + ')\\s*を引用する\\s*請求項\\s*(' + EXPR + ')\\s*には', 'gd');
  }

  // 直接指摘 D2/D3: 請求項Ｘには ／ 請求項Ｘに係る発明において（結論文の「に係る発明は」も
  // D3 に含めるが、「よって」で始まる結論文はそもそも直接指摘の走査対象にしない）
  function directPlainRe() {
    return new RegExp('請求項\\s*(' + EXPR + ')\\s*(?:には|に係る発明(?:において|は))', 'gd');
  }

  // 引用文言の役割決定用アンカー:
  //   （請求項Ｐを引用する）? 請求項Ｘ（には|に係る発明において） … 請求項側
  //   （本願）?明細書には                                        … 明細書側
  function quoteAnchorRe() {
    return new RegExp(
      '(?:請求項\\s*(?:' + EXPR + ')\\s*を引用する\\s*)?請求項\\s*(' + EXPR + ')\\s*(?:には|に係る発明において)' +
      '|(?:本願)?明細書には',
      'gd'
    );
  }

  // 明細書文: （本願）明細書には <欠落記載> （こと|点）? は記載されていない
  function specStatementRe() {
    return new RegExp('(?:本願)?明細書には(.+?)(?:こと|点)?は記載されていない', 'd');
  }

  // 結論文: よって、（請求項Ｘ）? に係る発明は <述部>
  function conclusionRe() {
    return new RegExp('よって、?\\s*(?:請求項\\s*(' + EXPR + ')\\s*)?に係る発明は、?\\s*([\\s\\S]*)$', 'd');
  }

  // ---- ブロック解析本体 ---------------------------------------------------

  // 1 指摘項目（BLOCK）を ITEM へ構造化する。summarizer / validator 適用前の状態を返す。
  // reasonContext = { reasonNumber, category, categoryLabel, itemNumber }
  function parseIssueBlock(block, reasonContext) {
    const warnings = [];
    const heading = claims.parseClaimHeading(block.headingLineRaw);
    for (const w of heading.warnings) warnings.push(w);

    // 見出し行を除いた本文
    const nl = block.matchText.indexOf('\n');
    const bodyMatch = nl === -1 ? '' : block.matchText.slice(nl + 1);
    const bodyRaw = nl === -1 ? '' : block.rawText.slice(nl + 1);
    const sentences = splitSentences(bodyMatch, bodyRaw);

    const directSet = new Set();
    const citedParentSet = new Set();
    const sameIssueSet = new Set();
    const dependencyRelations = [];
    const problematicPhrases = [];
    const specStatements = [];
    let clarityCoreSentence = null;
    let finalClaims = [];
    let finalClaimsRaw = null;
    let finalClaimsSource = null;
    let conclusionText = null;
    let conclusionCategory = null;
    const unmatchedSentences = [];

    const headingSet = new Set(heading.headingClaims);
    // 見出しが解析できなかった場合は「見出しとの交差」判定を常に真とみなす
    const intersectsHeading = (nums) =>
      headingSet.size === 0 || nums.some((n) => headingSet.has(n));

    for (const s of sentences) {
      let consumed = false;

      // --- 結論文 ---
      if (/^[ \t　]*よって/.test(s.match)) {
        const m = conclusionRe().exec(s.match);
        conclusionText = s.raw;
        conclusionCategory = splitter.categoryFromConclusion(s.match);
        if (m && m[1] !== undefined) {
          const parsed = claims.parseClaimExpression(m[1]);
          if (parsed.ok) {
            finalClaims = parsed.claims;
            finalClaimsRaw = s.raw.slice(m.indices[1][0], m.indices[1][1]);
            finalClaimsSource = 'conclusion';
          }
        }
        continue;   // 結論文は他の抽出器に掛けない
      }

      // --- 同様指摘・引用関係指摘（融合文対応） ---
      const sdRe = sameOrDependencyRe();
      let sd;
      while ((sd = sdRe.exec(s.match)) !== null) {
        const affected = claims.parseClaimExpression(sd[2]);
        if (!affected.ok) continue;
        if (sd[1] !== undefined) {
          const parents = claims.parseClaimExpression(sd[1]);
          dependencyRelations.push({
            parentClaims: parents.claims,
            affectedClaims: affected.claims,
            raw: s.raw.slice(sd.index, sdRe.lastIndex),
          });
        } else {
          for (const n of affected.claims) sameIssueSet.add(n);
        }
        consumed = true;
      }

      // --- 直接指摘（D1: 引用元つき） ---
      const d1Spans = [];
      const d1Re = directWithParentRe();
      let d1;
      while ((d1 = d1Re.exec(s.match)) !== null) {
        const parents = claims.parseClaimExpression(d1[1]);
        const targets = claims.parseClaimExpression(d1[2]);
        if (!targets.ok) continue;
        d1Spans.push([d1.index, d1Re.lastIndex]);
        if (intersectsHeading(targets.claims)) {
          for (const n of targets.claims) directSet.add(n);
          if (parents.ok) for (const n of parents.claims) citedParentSet.add(n);
          consumed = true;
        }
      }

      // --- 直接指摘（D2/D3: 引用元なし。D1 と重なる位置は読み飛ばす） ---
      const d2Re = directPlainRe();
      let d2;
      while ((d2 = d2Re.exec(s.match)) !== null) {
        const overlapsD1 = d1Spans.some(([a, b]) => d2.index < b && d2Re.lastIndex > a);
        if (overlapsD1) continue;
        const targets = claims.parseClaimExpression(d2[1]);
        if (!targets.ok) continue;
        if (intersectsHeading(targets.claims)) {
          for (const n of targets.claims) directSet.add(n);
          consumed = true;
        }
        // 見出しと交わらない請求項（比較対象）は directClaims に入れない
      }

      // --- 引用文言と役割 ---
      const quotes = scanQuotes(s.match);
      if (quotes.length > 0) {
        // 文中のアンカーをすべて収集し、各引用文言の直前のものを対応付ける
        const anchors = [];
        const aRe = quoteAnchorRe();
        let a;
        while ((a = aRe.exec(s.match)) !== null) {
          anchors.push({
            end: aRe.lastIndex,
            claims: a[1] !== undefined ? claims.parseClaimExpression(a[1]).claims : null,
            isSpec: a[1] === undefined,
          });
        }
        for (const q of quotes) {
          let anchor = null;
          for (const cand of anchors) {
            if (cand.end <= q.start && (anchor === null || cand.end > anchor.end)) anchor = cand;
          }
          let role, roleLabel, claimNumbers;
          if (anchor === null) {
            role = 'unknown';
            roleLabel = '不明';
            claimNumbers = claims.unionClaims(
              claims.extractClaimRefs(s.match, s.raw).map((r) => r.claims));
          } else if (anchor.isSpec) {
            role = 'spec';
            roleLabel = '明細書の記載';
            claimNumbers = [];
          } else if (intersectsHeading(anchor.claims)) {
            role = 'problem';
            roleLabel = '問題となる記載';
            claimNumbers = anchor.claims;
          } else {
            role = 'comparison';
            roleLabel = '比較対象の記載';
            claimNumbers = anchor.claims;
          }
          problematicPhrases.push({
            text: s.raw.slice(q.innerStart, q.innerEnd),
            claimNumbers,
            role,
            roleLabel,
          });
        }
        consumed = true;
      }

      // --- 明細書文（要約素材） ---
      const specM = specStatementRe().exec(s.match);
      if (specM) {
        specStatements.push({
          sentence: s.raw,
          missing: s.raw.slice(specM.indices[1][0], specM.indices[1][1]),
        });
        consumed = true;
      }

      // --- 明確性の中核文（要約素材。結論文以外で「不明確／明確でない」を含む文） ---
      if (clarityCoreSentence === null && /不明確|明確でない/.test(s.match)) {
        clarityCoreSentence = s.raw;
        consumed = true;
      }

      if (!consumed && s.match.trim() !== '') unmatchedSentences.push(s.raw);
    }

    // 結論文に請求項番号が無い場合は見出し（修正注記適用後）を暫定値とする
    if (finalClaims.length === 0) {
      finalClaims = heading.effectiveHeadingClaims.slice();
      finalClaimsSource = 'headingFallback';
    }

    return {
      itemNumber: reasonContext && reasonContext.itemNumber ? reasonContext.itemNumber : 1,
      headingClaimsRaw: heading.headingClaimsRaw,
      headingClaims: heading.headingClaims,
      effectiveHeadingClaims: heading.effectiveHeadingClaims,
      correctionNote: heading.correctionNote,
      directClaims: Array.from(directSet).sort((a, b) => a - b),
      citedParentClaims: Array.from(citedParentSet).sort((a, b) => a - b),
      sameIssueClaims: Array.from(sameIssueSet).sort((a, b) => a - b),
      dependencyRelations,
      finalClaims,
      finalClaimsRaw,
      finalClaimsSource,
      problematicPhrases,
      issueSummary: null,
      summaryReliable: null,
      conclusionText,
      conclusionCategory,
      sourceText: block.rawText,
      specStatements,
      clarityCoreSentence,
      firstBodySentence: sentences.length > 0 ? sentences[0].raw : null,
      unmatchedSentences,
      confidence: null,
      warnings,
    };
  }

  return {
    splitSentences,
    scanQuotes,
    parseIssueBlock,
  };
});
