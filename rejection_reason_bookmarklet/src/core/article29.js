/*
 * article29.js — 29条系（新規性・進歩性）の解析と引用文献の対応付け（DOM非依存の純粋モジュール）
 *
 * 29条系の理由は次のブロック構造を採る（1 ブロック = 1 MAPPING）:
 *   ・請求項 １、８          … 対象の請求項（claims.parseClaimHeading で解析）
 *   ・引用文献等 １、２       … 引用文献の番号（claims.parseClaimExpression で解析）
 *   ・備考                   … 以降ブロック末尾までが備考（原文のまま保持）
 * 引用文献の名称は本文全体から拾う一覧（`引用文献１：…` のインライン形式と
 * `＜引用文献等一覧＞` のリスト形式の両対応）と番号で突き合わせる。
 *
 * 備考には `（段落００１５－００２３、図３）` のような段落番号が現れる。これらは
 * 請求項番号ではないため、備考に対して裸の番号式解析を一切行わない（`請求項` 接頭辞の
 * ある表記だけが請求項参照）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalizer'), require('./claims'), require('./splitter'));
  } else {
    root.RRB = root.RRB || {};
    root.RRB.article29 = factory(root.RRB.normalizer, root.RRB.claims, root.RRB.splitter);
  }
})(globalThis, function (normalizer, claims, splitter) {
  'use strict';

  function makeWarning(code, message, severity) {
    return { code, message, severity: severity || 'warn' };
  }

  // 行単位で走査するためのユーティリティ（各行の先頭・末尾オフセットを持つ）。
  // matchText と rawText は同じ長さなのでオフセットを共有できる。
  function toLines(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const result = [];
    let pos = 0;
    for (const line of lines) {
      result.push({ text: line, start: pos, end: pos + line.length });
      pos += line.length + 1;
    }
    return result;
  }

  // ※ 行頭アンカー付きの正規表現では [ \t　]（行内空白のみ）を使う。
  //    \s は改行も含むため、^\s* が直前の空行まで遡ってマッチ位置を狂わせる。

  // 引用文献一覧の見出し行。`＜引用文献等一覧＞` / `引用文献一覧` /
  // 字間に空白が入る `引　用　文　献　等　一　覧` / 括弧・「等」の欠落を許容する
  const REF_LIST_HEADING_RE =
    /^[ \t　]*[＜<【\[]?[ \t　]*引[ \t　]*用[ \t　]*文[ \t　]*献[ \t　]*等?[ \t　]*一[ \t　]*覧[ \t　]*[＞>】\]]?[ \t　]*$/;

  // 一覧の項目行: `１．特開２０２０－１２３４５６号公報`（番号＋句点＋文献名）
  const REF_ENTRY_RE = /^[ \t　]*(\d+)[．.][ \t　]*(.+)$/d;

  // インライン形式の引用文献定義: `引用文献１：特開２０２０－１２３４５６号公報`
  // （normalizeForMatching が `：` を `:` に潰しているため `:` のみを見る）
  const INLINE_REF_RE = /^[ \t　]*[・･]?[ \t　]*引用文献(\d+)[ \t　]*:[ \t　]*(.+)$/d;

  // 罫線行（一覧の終端）と空行
  const RULED_LINE_RE = /^[ \t　]*[-ー─━]{8,}[ \t　]*$/;
  const BLANK_LINE_RE = /^[ \t　]*$/;

  // 指摘項目内の引用文献行: `・引用文献等 １、２` / `・引用文献 １及び３` / `・引用文献等:１`
  const REF_LINE_RE = /^[ \t　]*[・･][ \t　]*引[ \t　]*用[ \t　]*文[ \t　]*献[ \t　]*等?[ \t　]*:?[ \t　]*(.+)$/d;

  // 備考行: `・備考`（同一行に本文が続く形式も許容）
  const REMARKS_RE = /^[ \t　]*[・･][ \t　]*備[ \t　]*考[ \t　]*:?[ \t　]*(.*)$/d;

  // ---------------------------------------------------------------- 引用文献一覧

  // 本文全体から引用文献一覧を作る。
  //   matchBody … 照合用テキスト（全角数字→半角済み）
  //   rawBody   … matchBody と同じ長さの原文（文献名はここからスライスする）
  // 戻り値: [REFERENCE]（出現順・番号で重複排除。同一番号は先に現れた方を採る）
  function parseReferenceList(matchBody, rawBody) {
    const match = String(matchBody == null ? '' : matchBody);
    const raw = rawBody == null ? match : String(rawBody);
    const lines = toLines(match);
    const references = [];
    const seen = new Set();
    let inList = false;      // 一覧ブロックの内側か
    let entrySeen = false;   // 当該一覧で 1 件以上の項目行を読んだか

    function push(number, nameRange, lineStart, lineText) {
      if (seen.has(number)) return;   // 重複番号は先着優先（クラッシュさせない）
      seen.add(number);
      references.push({
        number,
        name: raw.slice(lineStart + nameRange[0], lineStart + nameRange[1]).trim() || null,
        raw: raw.slice(lineStart, lineStart + lineText.length).trim(),
        matched: false,
      });
    }

    for (const line of lines) {
      if (inList) {
        const entry = REF_ENTRY_RE.exec(line.text);
        if (entry) {
          entrySeen = true;
          push(parseInt(entry[1], 10), entry.indices[2], line.start, line.text);
          continue;
        }
        // 空行・罫線・一覧形式でない行で一覧ブロックは終わる
        // （見出し直後の空行だけは項目前の装飾として読み飛ばす）
        if (BLANK_LINE_RE.test(line.text) && !entrySeen) continue;
        inList = false;
        entrySeen = false;
        if (RULED_LINE_RE.test(line.text)) continue;
      }
      if (REF_LIST_HEADING_RE.test(line.text)) {
        inList = true;
        entrySeen = false;
        continue;
      }
      const inline = INLINE_REF_RE.exec(line.text);
      if (inline) push(parseInt(inline[1], 10), inline.indices[2], line.start, line.text);
    }
    return references;
  }

  // 番号から一覧の要素を引く
  function findReference(references, number) {
    for (const ref of references || []) {
      if (ref && ref.number === number) return ref;
    }
    return null;
  }

  // 対応が取れた引用文献に matched フラグを立てる（見つからなかった番号を返す）
  function markReferencesMatched(references, numbers) {
    const unresolved = [];
    for (const n of numbers || []) {
      const ref = findReference(references, n);
      if (ref) ref.matched = true;
      else unresolved.push(n);
    }
    return unresolved;
  }

  // テキスト塊が「引用文献一覧そのもの」かを判定する。
  // 一覧は analyzer が本文全体に対して parseReferenceList で処理するため、
  // 前置き・末尾に一覧が現れても未解析扱いにはしない。
  function isReferenceListLike(matchText) {
    const lines = toLines(matchText);
    let significant = 0;
    for (const line of lines) {
      if (BLANK_LINE_RE.test(line.text) || RULED_LINE_RE.test(line.text)) continue;
      significant++;
      if (REF_LIST_HEADING_RE.test(line.text)) return true;
      if (!REF_ENTRY_RE.test(line.text) && !INLINE_REF_RE.test(line.text)) return false;
    }
    return significant > 0;
  }

  function isBlank(text) {
    return String(text == null ? '' : text).trim() === '';
  }

  // ---------------------------------------------------------------- 区分の判定

  // 29条系の下位区分を決める。
  // 優先順位: ①理由の区分（見出し由来） ②法条（reasonContext.legalBasis） ③セクション本文の法条
  function detectSubCategory(reasonContext, sectionMatchText) {
    const category = reasonContext ? reasonContext.category : null;
    if (category === 'novelty') return { subCategory: 'novelty', subCategoryLabel: '新規性' };
    if (category === 'inventiveStep') return { subCategory: 'inventiveStep', subCategoryLabel: '進歩性' };
    const basis = reasonContext && reasonContext.legalBasis
      ? normalizer.normalizeForMatching(String(reasonContext.legalBasis))
      : null;
    const article = splitter.parseArticle(basis) ||
      splitter.parseArticle(sectionMatchText == null ? '' : sectionMatchText);
    if (article && article.article === 29 && article.branch == null) {
      if (article.paragraph === 1) return { subCategory: 'novelty', subCategoryLabel: '新規性' };
      if (article.paragraph === 2) return { subCategory: 'inventiveStep', subCategoryLabel: '進歩性' };
    }
    return { subCategory: 'article29-unknown', subCategoryLabel: '29条系（区分不明）' };
  }

  // ---------------------------------------------------------------- 指摘項目の解析

  // 1 ブロック（`・請求項` 行から次の `・請求項` 行まで）を 1 MAPPING へ解析する。
  // ブロック内は行単位の状態機械で読む（・引用文献等 → ・備考 → 備考本文）。
  function parseMappingBlock(block, reasonNumber, sub, references) {
    const warnings = [];
    const lines = toLines(block.matchText);
    const heading = claims.parseClaimHeading(block.headingLineRaw);
    for (const w of heading.warnings) warnings.push(w);

    const refNumbers = [];
    const refRawParts = [];
    let refLineFound = false;
    let remarksStart = -1;      // 備考本文の開始オフセット（ブロック内相対）
    const extraLines = [];      // どの行種にも当てはまらなかった行

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (remarksStart >= 0) continue;   // 備考以降はブロック末尾まですべて備考
      const remarksM = REMARKS_RE.exec(line.text);
      if (remarksM) {
        remarksStart = line.start + remarksM.indices[1][0];
        continue;
      }
      const refM = REF_LINE_RE.exec(line.text);
      if (refM) {
        refLineFound = true;
        const exprMatch = refM[1];
        const exprRaw = block.rawText.slice(line.start + refM.indices[1][0], line.start + refM.indices[1][1]).trim();
        const parsed = claims.parseClaimExpression(exprMatch);
        if (parsed.ok) {
          for (const n of parsed.claims) refNumbers.push(n);
          refRawParts.push(exprRaw);
        } else {
          warnings.push(makeWarning('REFERENCE_PARSE_UNCERTAIN',
            '引用文献の番号表記を解釈できませんでした（原文のまま表示します）: ' + exprRaw));
          refRawParts.push(exprRaw);
        }
        continue;
      }
      if (!BLANK_LINE_RE.test(line.text)) extraLines.push(line);
    }

    const referenceNumbers = claims.unionClaims([refNumbers]);
    const referenceNames = [];
    let unresolvedCount = 0;
    for (const n of referenceNumbers) {
      const ref = findReference(references, n);
      if (ref) {
        ref.matched = true;
        referenceNames.push(ref.name);
      } else {
        unresolvedCount++;
        referenceNames.push(null);
        warnings.push(makeWarning('REFERENCE_UNRESOLVED',
          '引用文献' + n + 'が引用文献一覧に見つかりません。番号のみ表示します。'));
      }
    }
    if (!refLineFound) {
      warnings.push(makeWarning('MAPPING_REFERENCE_MISSING',
        '「・引用文献等」の記載が見つからないため、請求項と引用文献の対応関係が不明確です。'));
    }

    const remarks = remarksStart >= 0 ? (block.rawText.slice(remarksStart).trim() || null) : null;

    // 適用関係（適用の型）の簡易判定。備考に「周知」があれば周知技術が優先
    let application = null;
    if (referenceNumbers.length === 1) application = '単独引用';
    else if (referenceNumbers.length > 1) application = '組合せ';
    if (remarks !== null && remarks.indexOf('周知') !== -1) application = '周知技術';

    const headingOk = heading.headingClaimsRaw !== null && heading.headingClaims.length > 0;
    let confidence = 'high';
    if (!headingOk) confidence = 'low';
    else if (unresolvedCount > 0 || !refLineFound) confidence = 'medium';

    const mapping = {
      reasonNumber,
      subCategory: sub.subCategory,
      subCategoryLabel: sub.subCategoryLabel,
      claims: heading.effectiveHeadingClaims.length > 0 ? heading.effectiveHeadingClaims : heading.headingClaims,
      claimsRaw: heading.headingClaimsRaw,
      referenceNumbers,
      referenceNumbersRaw: refRawParts.length > 0 ? refRawParts.join('、') : null,
      referenceNames,
      application,
      remarks,
      sourceText: block.rawText.replace(/\s+$/, ''),
      confidence,
      warnings,
    };
    return { mapping, extraLines };
  }

  // 29条系の理由セクションを解析する。
  //   section        … splitter.splitReasonSections の要素
  //   reasonContext  … { reasonNumber, category, categoryLabel, legalBasis }
  //   references     … parseReferenceList の結果（対応が取れた要素に matched を立てる）
  // 戻り値: { mappings: [MAPPING], unparsed: [{ text, note }], warnings: [WARNING] }
  function parseArticle29Section(section, reasonContext, references) {
    const refs = references || [];
    const mappings = [];
    const unparsed = [];
    const warnings = [];
    const sub = detectSubCategory(reasonContext, section ? section.matchText : '');
    const reasonNumber = section && section.reasonNumber != null
      ? section.reasonNumber
      : (reasonContext && reasonContext.reasonNumber != null ? reasonContext.reasonNumber : null);
    const parts = splitter.splitIssueBlocks(section);

    for (const block of parts.blocks) {
      const parsed = parseMappingBlock(block, reasonNumber, sub, refs);
      mappings.push(parsed.mapping);
      if (parsed.extraLines.length > 0) {
        unparsed.push({
          text: parsed.extraLines.map((l) => block.rawText.slice(l.start, l.end)).join('\n').trim(),
          note: '指摘項目内の解析できなかった記載です。原文を確認してください。',
        });
      }
    }

    if (parts.blocks.length === 0) {
      warnings.push(makeWarning('NO_ISSUE_BLOCKS',
        '29条系の理由から「・請求項」で始まる指摘項目を検出できませんでした。原文を確認してください。'));
    }

    // 前置き（見出しと最初のブロックの間）— 引用文献一覧なら未解析にしない
    if (parts.preamble && !isBlank(parts.preamble.rawText) &&
        !isReferenceListLike(parts.preamble.matchText)) {
      unparsed.push({
        text: parts.preamble.rawText.trim(),
        note: '理由見出しと最初の指摘項目の間の記載を解析できませんでした。',
      });
    }
    // 末尾（引用文献一覧・罫線以降）— 一覧は analyzer が本文全体から解析するため未解析にしない
    if (parts.trailing && !isBlank(parts.trailing.rawText) &&
        !isReferenceListLike(parts.trailing.matchText)) {
      unparsed.push({
        text: parts.trailing.rawText.trim(),
        note: '理由セクション末尾の記載を解析できませんでした。',
      });
    }

    return { mappings, unparsed, warnings };
  }

  return {
    parseReferenceList,
    findReference,
    markReferencesMatched,
    isReferenceListLike,
    detectSubCategory,
    parseArticle29Section,
  };
});
