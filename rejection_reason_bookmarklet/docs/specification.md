# rejection_reason_bookmarklet — 仕様書（モジュール間契約）

拒絶理由通知の全文をブラウザ内 JavaScript だけで解析し、指摘事項を構造化して
モーダル／別タブレポートに表示するブックマークレット。外部通信は一切行わない。

- 名前空間: `globalThis.RRB`（モジュールは UMD 風で `module.exports` / `RRB.*` の両対応）
- DOM 接頭辞: `rrb-`（ホスト要素は `#rrb-host` の 1 個のみ。再実行時は再利用して前面化）
- 実行環境制約（対象ページの CSP `script-src 'self'; script-src-attr 'unsafe-inline'`）:
  - 実行時に `eval` / `new Function` / `<script>` 挿入 / 外部リソース読込を**使わない**
  - 別タブレポートは CSP を継承し **JS が動かない前提**（`<details>/<summary>` で展開 UI を実現）
  - `file://` では `navigator.clipboard` 不可 → `document.execCommand('copy')` フォールバック必須
- モーダルは **Shadow DOM (open)** + `:host` 明示リセット。z-index `2147483000`

## モジュール構成と担当

| ファイル | 名前空間 | 責務 |
|---|---|---|
| `src/core/normalizer.js` | `RRB.normalizer` | テキスト正規化・非拒絶理由部の除去 |
| `src/core/claims.js` | `RRB.claims` | 請求項番号式の解析・圧縮表示・修正注記 |
| `src/core/splitter.js` | `RRB.splitter` | 理由分割・理由分類・指摘項目分割 |
| `src/core/clarity-support.js` | `RRB.claritySupport` | 明確性・サポート要件の項目解析 |
| `src/core/article29.js` | `RRB.article29` | 29条系（新規性・進歩性）解析・引用文献対応付け |
| `src/core/summarizer.js` | `RRB.summarizer` | 問題の要約（テンプレート方式） |
| `src/core/validator.js` | `RRB.validator` | 検証・警告・confidence・請求項統計（未指摘請求項） |
| `src/core/claim-tree.js` | `RRB.claimTree` | 罫線ツリー記法の解析（`claim_relation_writer` から取り込んだ独立実装） |
| `src/core/claim-structure.js` | `RRB.claimStructure` | 特許請求の範囲の構造解析（請求項全文・引用関係） |
| `src/core/consistency.js` | `RRB.consistency` | 指摘範囲の整合性検証・指摘漏れ候補の検出 |
| `src/core/analyzer.js` | `RRB.analyzer` | パイプライン統合（テキスト → 解析結果） |
| `src/bookmarklet/common/page-claims.js` | `RRB.pageClaims` | 対象ページ（#claim_mark / #claim_cite）からの請求項取得（DOM） |
| `src/bookmarklet/common/sample-data.js` | `RRB.sampleData` | サンプル文（fixtures の拒絶理由例と同一。テストで同一性検証） |
| `src/bookmarklet/common/report-template.js` | `RRB.reportTemplate` | 別タブ用 JS フリー HTML レポート生成（純関数） |
| `src/bookmarklet/common/analyzer-app.js` | `RRB.analyzerApp` | モーダル UI・入出力・エクスポート |

連結順（ビルド）: normalizer → claims → splitter → clarity-support → article29 →
summarizer → validator → analyzer → sample-data → report-template → analyzer-app。

## 解析結果スキーマ（`RRB.analyzer.analyze()` の戻り値）

```javascript
{
  metadata: {
    analyzedAt: "",                  // ISO文字列。analyze() は空のまま返し、UI側が設定する（決定論のため）
    totalReasonCount: 0,
    warnings: [WARNING],             // 文書レベルの警告
    claimStats: {
      maxClaimNumber: 20,            // 本文中に現れた最大請求項番号（推定の全請求項数の初期値）
      totalClaimCount: 20,           // ユーザ上書き可（analyze() では maxClaimNumber と同値）
      allFinalClaims: [2,3,...],     // 全理由の最終指摘請求項の和集合（昇順）
      allMentionedClaims: [...],     // 本文中に登場した全請求項の和集合
      unflaggedClaims: [1,8,...],    // 1..totalClaimCount のうち allFinalClaims に無いもの（未指摘請求項）
      byCategory: {                  // カテゴリごとの最終指摘請求項の和集合
        clarity: [...], support: [...], novelty: [...], inventiveStep: [...], other: [...]
      }
    }
  },
  reasons: [REASON],
  noveltyInventiveStep: {            // 29条系の集約ビュー（reasons 内の 29条系項目の再掲）
    references: [REFERENCE],
    mappings: [MAPPING]
  },
  unparsedSections: [{ text: "", location: "", note: "" }]
}
```

```javascript
REASON = {
  reasonNumber: 1,                   // ●理由Ｘ の番号（見出しが無い場合は出現順の連番）
  category: "clarity" | "support" | "novelty" | "inventiveStep" | "other",
  categoryLabel: "明確性",           // 表示用（サポート要件／新規性／進歩性／その他）
  legalBasis: "特許法第36条第6項第2号" | null,
  headingRaw: "●理由１（明確性）について" | null,
  confidence: "high" | "medium" | "low",
  warnings: [WARNING],
  items: [ITEM],                     // 明確性・サポート要件・その他の指摘項目
  article29: {                       // 29条系理由のみ（それ以外は null）
    references: [REFERENCE], mappings: [MAPPING]
  } | null
}

ITEM = {
  itemNumber: 1,                     // 同一理由内の連番
  headingClaimsRaw: "２-７",         // ・請求項 直後の原文表記
  headingClaims: [2,3,4,5,6,7],      // 原文上の見出し請求項
  effectiveHeadingClaims: [...],     // 修正注記適用後（注記なしなら headingClaims と同値）
  correctionNote: { raw: "（修正：５を除く）", excluded: [5] } | null,
  directClaims: [2],                 // 直接指摘されている請求項
  citedParentClaims: [1],            // 直接指摘の引用元請求項（「請求項1を引用する請求項2には」の 1）
  sameIssueClaims: [3,4],            // 「〜にも同様の点が指摘され(る)」の請求項
  dependencyRelations: [             // 「請求項P を引用する請求項A にも同様の点が…」
    { parentClaims: [2,4], affectedClaims: [5,6,7], raw: "請求項２、４を引用する請求項５-７にも同様の点が指摘される。" }
  ],
  finalClaims: [2,...,7],            // 結論文の請求項（無ければ見出しの暫定値 + 警告）
  finalClaimsRaw: "２-７" | null,
  problematicPhrases: [PHRASE],
  issueSummary: "請求項2の「第1送信ステップ」と「第2接続設定処理」の関係が不明確。",
  summaryReliable: true,             // false のとき UI は「自動要約の確度が低い」を付記
  conclusionText: "よって、請求項２-７に係る発明は明確でない。" | null,
  conclusionCategory: "clarity" | "support" | "article29" | "unknown" | null,
  sourceText: "・請求項 ２-７\n…",   // 当該指摘項目の原文全文
  // ---- 要約・検証の素材（clarity-support が抽出し summarizer/validator が消費する） ----
  specStatements: [                  // 「本願明細書には…記載されていない」文（かぎ括弧なしでも捕捉）
    { sentence: "しかしながら、本願明細書には…記載されていない。", missing: "任意の条件に基づいて…制御すること" }
  ],
  clarityCoreSentence: "してみると、…異同が不明確である。" | null,  // 不明確/明確でない を含む本文文（結論文以外）
  firstBodySentence: "請求項１を引用する請求項２には…。" | null,
  unmatchedSentences: ["…"],         // どの抽出器にも消費されなかった文（UNPARSED_TEXT 警告の素材）
  confidence: "high" | "medium" | "low",
  warnings: [WARNING]
}

PHRASE = {
  text: "前記所定の接続を介して…第2接続設定処理",
  claimNumbers: [2],                 // その記載がある請求項（特定できなければ []）
  role: "problem" | "comparison" | "spec" | "unknown",
  roleLabel: "問題となる記載" | "比較対象の記載" | "明細書の記載" | "不明"
}

WARNING = {
  code: "HEADING_CONCLUSION_MISMATCH",  // 機械可読コード（英大文字スネーク）
  message: "理由見出しは「明確性」ですが、結論文はサポート要件に対応する表現です。原文を確認してください。",
  severity: "warn" | "error" | "info"
}

REFERENCE = {
  number: 1, name: "特開XXXX-XXXXXX号公報" | null, raw: "引用文献１：特開XXXX-XXXXXX号公報",
  matched: true                      // 本文の引用番号と一覧の対応が取れたか
}

MAPPING = {                          // 29条系: 請求項（群）× 引用文献
  reasonNumber: 3,
  subCategory: "novelty" | "inventiveStep" | "article29-unknown",
  subCategoryLabel: "新規性" | "進歩性" | "29条系（区分不明）",
  claims: [1,2], claimsRaw: "１-２",
  referenceNumbers: [1,2], referenceNumbersRaw: "１、２",
  referenceNames: ["特開…号公報", "…"],   // 一覧と対応付いた名称（無ければ null 要素）
  application: "単独引用" | "組合せ" | "周知技術" | null,   // 判別できた場合のみ
  remarks: "備考の原文" | null,
  sourceText: "・請求項 １-２\n・引用文献等 １\n…",
  confidence: "high" | "medium" | "low",
  warnings: [WARNING]
}
```

### 主要警告コード

| code | 意味 |
|---|---|
| `HEADING_CONCLUSION_MISMATCH` | 理由見出しと結論文の区分表現が不一致（見出し優先で分類し警告） |
| `CORRECTION_NOTE_CONFLICT` | 修正注記で除外した請求項が本文/結論文に再出現 |
| `NO_FINAL_CLAIMS` | 結論文から請求項番号を抽出できず見出しを暫定使用 |
| `NO_CONCLUSION` | 結論文（よって…）を特定できない |
| `REFERENCE_UNRESOLVED` | 引用番号を引用文献一覧へ対応付けできない |
| `CLAIM_PARSE_UNCERTAIN` | 請求項番号式の解析に不確実性 |
| `UNKNOWN_HEADING_NOTE` | 見出しの丸括弧注記を解釈できない（raw のみ保持） |
| `UNPARSED_TEXT` | 項目内に解析できなかった文が残った |
| `REASON_LIST_MISMATCH` | 理由見出しと冒頭理由一覧の区分が不一致 |
| `NO_CATEGORY` / `NO_REASON_HEADING` / `NO_ISSUE_BLOCKS` | 区分・見出し・指摘項目を特定できない |
| `NON_REASON_REMOVED` (info) | 調査結果の記録・連絡先を解析対象から除外した |
| `EMPTY_INPUT` / `NO_REASONS_FOUND` | 入力が空／理由を1件も検出できない |

## 共有テキスト型（raw / match の対）

原文の完全保存（ユーザ要件「元の表記も失わず保存」）のため、照合と表示を分離する:

- `rawText` … 改行正規化のみ行った原文（表示・sourceText・かぎ括弧内文言はここからスライス）
- `matchText` … rawText と**同じ長さ**の照合用文字列（全角数字→半角、ダッシュ類→`-`、`，`→`、`）
- 長さが等しいためオフセットを共有できる。正規表現は matchText に適用し、
  マッチ位置で rawText をスライスして表示用文字列を得る

```javascript
SECTION = { rawText, matchText, reasonNumber, headingLabel, headingRaw }
BLOCK   = { headingLineRaw, headingLineMatch, rawText, matchText }   // rawText は見出し行を含む項目全文
SENTENCE = { raw, match, index }                                     // 文分割後（行頭字下げ除去・行結合済み）
```

## コア API 契約

### RRB.normalizer

- `normalizeLineEndings(text) -> string` … CRLF/CR → LF のみ（これが「原文 rawText」の基準形）
- `normalizeForMatching(text) -> string` … rawText と**同じ長さ**の照合用文字列。
  全角数字→半角、ダッシュ類 8 種＋`～〜`→`-`、`，`→`、`、全角空白は保持（1:1 置換のみ。
  オフセットが rawText と一致するため、抽出結果の原文スライスに使える）
- `removeNonReasonSections(rawText) -> { body, matchBody, removedNote }` …
  罫線行（`[－ー―\-]{10,}`）直後の `＜先行技術文献調査結果の記録＞` 以降と、
  問合せ・面接・審査官名・TEL・メール等の末尾連絡ブロックを除去。
  `＜引用文献等一覧＞` は**除去しない**。body/matchBody は同じ範囲

### RRB.claims

- `parseClaimExpression(expr) -> { ok, claims: int[], raw, warnings }` …
  `"２-７"` `"３-５、１９-２０"` `"２ないし７"` `"３－５及び１９－２０"` `"２、４"` 等
  （正規化前の表記でも可）を昇順・重複なしの整数配列へ
- `compressClaimNumbers(nums: int[]) -> string` … `[2..7]` → `"2-7"`、`[3,4,19,20]` → `"3-4、19-20"`
- `claimRefPattern() -> RegExp` … 文中の `請求項<式>` を検出する共有正規表現（g フラグ付きの新品を返す）
- `extractClaimRefs(sentence) -> [{ claims, raw, index }]` … 文中の請求項参照を出現順に全て
- `parseClaimHeading(headingLine) -> { headingClaimsRaw, headingClaims, effectiveHeadingClaims, correctionNote, warnings }`
  … `・請求項 ３-５、１９-２０（修正：５を除く）` 形式（`（修正：…を除く）` を解釈。
  解釈できない注記は raw のみ保持し警告）

### RRB.splitter

- `parseLeadingReasonList(matchBody) -> [{ num, label, category, legalBasis, raw }]` …
  冒頭の `１．（明確性）この出願は、…` 一覧（`記` 行より前）
- `splitReasonSections(rawBody, matchBody) -> { preambleRaw, sections: [{ reasonNumber, headingLabel, headingRaw, rawText, matchText }] }`
  … `●理由Ｘ（…）について` 見出しで分割。見出しが無い場合は全体を 1 セクション（headingLabel: null）
- `classifyReason(section, leadingList) -> { category, categoryLabel, legalBasis, confidence, warnings }`
  … 優先順位: ①見出しの理由名 ②冒頭一覧 ③法条 ④結論文。結論文のみ矛盾なら見出し優先＋警告
- `splitIssueBlocks(section) -> [{ headingLine, rawText, matchText }]` …
  `・請求項` 行で分割（次の `・請求項`／理由見出し／罫線／文末まで）

### RRB.claritySupport

- `splitSentences(text) -> [{ text, index }]` … 「。」で文分割。`「…」『…』` 内の句点では分割しない
- `parseIssueBlock(block, reasonContext) -> ITEM` … 上記 ITEM を返す（summary/validate 適用前）。
  対応必須パターン:
  - `請求項Ｘを引用する請求項Ｙには「…」が記載されている` → direct=Y, citedParent=X, PHRASE(problem)
  - `請求項Ｘには「…」が記載されている` → direct=X。ただし文頭が `しかしながら、`／`加えて、` 等の
    対比接続詞なら PHRASE(comparison) とし、その X は citedParent/比較対象側（direct に入れない）
  - `本願明細書には…記載されていない` → PHRASE(spec)（かぎ括弧が無い場合は対象文を要約素材に）
  - `請求項Ｘ(-Ｙ、…)にも同様の点が指摘され(る|、)` → sameIssueClaims（**連用形・一文融合対応**:
    「請求項３-４、１９-２０にも同様の点が指摘され、請求項２、４を引用する請求項５-７にも
    同様の点が指摘される。」から sameIssue=[3,4,19,20] と dependency={parents:[2,4],affected:[5,6,7]} の両方）
  - `請求項Ｐを引用する請求項Ａにも同様の点が指摘され(る)` → dependencyRelations（P は sameIssue に入れない）
  - `よって、請求項Ｘ…に係る発明は(明確でない|発明の詳細な説明に記載したものでない|…)` →
    finalClaims / conclusionText / conclusionCategory

### RRB.article29（担当: Opus サブエージェント）

- `parseReferenceList(matchBody, rawBody) -> [REFERENCE]` … `引用文献１：特開…` 形式と
  `＜引用文献等一覧＞` セクション（`１．特開…号公報` 形式）の両対応
- `parseArticle29Section(section, reasonContext, references) -> { mappings: [MAPPING], unparsed: [...] }`
  … `・請求項` `・引用文献等 Ｘ` `・備考` のブロック構造を解析。
  引用番号表記 `引用文献等 １、２` `引用文献１及び２` に対応。一覧に無い番号は
  `REFERENCE_UNRESOLVED` 警告付きで番号のみ表示
- `detectSubCategory(reasonContext, sectionText) -> { subCategory, subCategoryLabel }`
  … 29条1項(3号)/新規性 → novelty、29条2項/進歩性 → inventiveStep、不明 → article29-unknown

### RRB.summarizer（担当: Opus サブエージェント）

- `buildIssueSummary(item, category) -> { summary, reliable }` … テンプレート方式。例:
  - 明確性 + problem/comparison 両方あり: `請求項2の「A」と「B」の関係(異同)が不明確。`
  - サポート要件 + spec あり: `明細書に「…」に対応する記載がない。`
  - 素材不足: 原文の主要文（最初の指摘文）を要約とし `reliable: false`

### RRB.validator（担当: Opus サブエージェント）

- `validateParsedItem(item, reasonContext) -> item` … 警告付与と confidence 決定
  （high: 見出し・結論一致かつ番号明確 / medium: 一部曖昧 / low: 結論・境界不明）。
  修正注記除外請求項の本文/結論再出現チェック（`CORRECTION_NOTE_CONFLICT`）、
  見出し区分と conclusionCategory の不一致チェック（`HEADING_CONCLUSION_MISMATCH`）を含む
- `computeClaimStats(result, totalClaimCountOverride) -> claimStats` …
  未指摘請求項の計算。純関数（UI が全請求項数変更時に再計算に使う）

### RRB.analyzer

- `analyze(text, options) -> RESULT` … パイプライン統合。options: `{ totalClaimCount?: number }`
- 解析不能でも throw せず、`metadata.warnings` と `unparsedSections` に残す

## 追加要件: 請求項構造との照合

### 対象ページからの取得（実測に基づく）

「書類比較・クレームチェッカー」で**クレーム解析を実行済み**のとき、次の3要素を役割ごとに使う。

| 要素 | 内容 | 役割 |
|---|---|---|
| `#claim_tree .div_tree` | 罫線ツリー（`1 ┳ 2 ┳ 3` / `┃ ┣ 4 ━ 5` …） | **引用関係の一次情報** |
| `#claim_cite` | `合計請求項数: 26 (独立請求項: 1,25,26)` と請求項ごとの `引用請求項 / 間接引用 / 被引用請求項 / うち間接被引用 / 引用パターンの数` | **合計請求項数**と独立請求項。引用関係の照合にも使う |
| `#claim_mark` | 請求項全文。`<span id="CLMNM<n>">【請求項 n】</span>` が見出し、本文には通番マーカー `<span class="showCiteCited…">[1-7]</span>` が挿入されている | **請求項全文**と引用表現（引用種別の判定）。ツリーが無い場合は引用関係のフォールバック |

罫線ツリーの解析は本プロジェクト内の `src/core/claim-tree.js`（`RRB.claimTree`）が行う。
これは `claim_relation_writer/src/core/parser.js` のアルゴリズム（トークン列＋スタック方式）を
**本プロジェクトへ取り込んだ独立実装**であり、他プロジェクトへの参照は持たない
（ルート README.md「ルール: プロジェクト間の独立性」）。ページに残る追加グローバルは `RRB` だけ。

注意点:
- `被引用請求項` は `引用請求項` を部分文字列として含むため、否定後読み `(?<!被)` で区別する
- ページ側の「被引用請求項」は直接＋間接の**全下位**であり、`うち間接被引用` を引くと直接下位になる
- 引用関係はツリーを優先し、請求項本文の引用表現と食い違う場合は**上書きせず**
  `TREE_TEXT_DEPENDENCY_MISMATCH` を警告する（誤りの発見が目的）
- ツリーに現れない請求項は本文の引用表現から推定し `CLAIM_NOT_IN_TREE` を警告する

### CLAIM_STRUCTURE

```javascript
{
  source: "claim_tree" | "claim_mark" | "pasted", sourceLabel: "…（表示用の由来）",
  totalClaimCount: 26,
  totalClaimCountSource: "claim_cite" | "max-claim-number",
  claimNumbers: [1..26], independentClaims: [1, 25, 26],
  claims: [{
    claimNumber: 2, text: "…（請求項全文）",
    type: "independent" | "dependent",
    directParents: [1], allAncestors: [1],
    directChildren: [3, 4, 6, 7], allDescendants: [3, 4, 5, 6, 7],
    dependencyExpression: "請求項1に記載" | null,          // 本文由来（常に本文から取る）
    dependencyType: "single" | "selective" | "cumulative" | null,
    parentsSource: "claim_tree" | "text" | "text-fallback", // 引用元をどこから得たか
    warnings: [WARNING]
  }],
  warnings: [WARNING],     // 欠番・重複・独立請求項なし・総数不一致 等（構造全体）
  crossChecks: [WARNING],  // #claim_cite との不一致（空 = 完全一致）
  findPath(from, to)       // 引用経路（[2,4,5] 等。無ければ null）
}
```

`totalClaimCountSource`（構造がどこから総数を得たか）と、
`metadata.claimStats.totalClaimCountSource`（解析結果が使った総数の由来:
`claimStructure` / `manual` / `estimated`）は別のフィールドである。

請求項固有の警告コード: `CLAIM_NUMBER_GAP` / `CLAIM_NUMBER_DUPLICATE` / `CLAIM_NUMBER_START` /
`CLAIM_SELF_REFERENCE` / `CLAIM_PARENT_NOT_FOUND` / `CLAIM_FORWARD_REFERENCE` /
`CLAIM_CIRCULAR_REFERENCE` / `NO_INDEPENDENT_CLAIM` / `CLAIM_TOTAL_MISMATCH` /
`INDEPENDENT_CLAIMS_MISMATCH` / `CLAIM_DEPENDENCY_MISMATCH` / `CLAIM_CITE_UNKNOWN_CLAIM` /
`TREE_TEXT_DEPENDENCY_MISMATCH` / `CLAIM_NOT_IN_TREE` / `CLAIM_TREE_PARSE_ERROR`

### RRB.claimStructure

- `claimHtmlToText(html)` … `<br>`→改行、通番マーカー除去、タグ除去、実体参照復元（`&amp;` は最後）
- `parseClaimTree(treeText)` … 罫線ツリーを `RRB.claimTree.parseClaimTree` に委譲して
  `{ ok, nodes, roots, dependencies: Map<number, number[]> }` を返す。
  モジュールが無い／ツリーが不正なら `{ ok: false, error }`（**誤った関係を作らない**）
- `hasTreeParser()` … 罫線ツリー解析モジュールが読み込めているか

### RRB.claimTree（取り込んだ機構）

- `parseClaimTree(text)` … `{ ok: true, graph: { nodes, edges, roots } }` /
  `{ ok: false, errors: [{ line, message }] }`。辺 `[from, to]` は「to が from を引用する」向き。
  不変条件「行頭の `┃` の個数 k に対しスタック深さ常に k+1」が崩れた入力は救済せずエラー
- `normalizeTreeText(text)` / `tokenizeLine(line)` … 正規化とトークン化（内部用・テスト用）
- `parseClaimTexts(plainText)` … `【請求項 N】`『［請求項N］』`[請求項N]`・行全体が `請求項N` で分割
- `parseDependencyExpression(claimText)` … 末尾の引用節を解析。範囲 `から/ないし/乃至/-/～`、
  列挙 `、/又は/または/若しくは/もしくは/及び/および/並びに`、`のいずれか(一項)`、
  終端 `に記載/に係る/に規定/において/記載` に対応。複数該当時は**最後**を採用
- `build(claimList, options)` … 推移閉包（循環しても停止）・妥当性検証・独立/従属判定。
  - `options.dependencies: Map<number, number[]>` … ツリー由来の引用関係（**本文解析より優先**）
  - `options.totalClaimCount` / `options.independentClaims` … `#claim_cite` 由来（優先・照合）
  - 引用表現の文字列と引用種別は、ツリーがあっても常に本文から取る（選択的／累積的の判定に必要）
- `parseClaimCiteText(plainText)` / `crossCheckWithCite(structure, cite)` … 4集合
  （直接引用元・全引用元・直接下位・全下位）をすべて突き合わせる

### RRB.consistency

- `computeBodyAffectedClaims(item)` … `union(directClaims, sameIssueClaims, dependencyRelations.affectedClaims)`
- `checkItem(item, reasonContext, claimStructure?)` … §6・§7 の照合（構造が無くても動く）→ CONSISTENCY_CHECK
- `assessInheritability(item, category)` … 承継性 `{ inheritable, strength: 'strong'|'weak', kind, kindLabel, basis }`。
  文言自体の不明確性・発明特定事項の矛盾・明細書の記載欠如は `strong`（下位請求項の限定追加では通常解消しない）
- `validateClaimExistence(reasons, claimStructure)` … 実在しない請求項番号（§3）
- `crossCheckStatedDependencies(item, ctx, claimStructure)` … 拒絶理由が述べる引用関係 vs 実構造（§14）。
  判定は「対象請求項の**全引用元**に、記載された引用元のいずれかが含まれるか」
- `findOmittedCandidatesForItem(item, ctx, claimStructure, reasonCoverage)` … 指摘漏れ候補（§5）
- `run(result, claimStructure)` … 上記を全項目に適用し `{ consistencyChecks, omittedClaimCandidates, warnings, counts }`

CONSISTENCY_CHECK / OMITTED_CANDIDATE の形および `metadata.issueCounts`・
`claimStats.totalClaimCountSource` は本書の「解析結果スキーマ」に準拠（実装済みの形は
`src/core/consistency.js` の `checkItem` / `findOmittedCandidatesForItem` を参照）。

指摘漏れの severity 規則:

| 条件 | severity |
|---|---|
| 承継性 strong かつ**直接**引用の下位請求項 | `error` |
| 承継性 strong かつ**間接**引用（多段階） | `warning` |
| 承継性 weak（性質を特定できない） | `warning`（要確認） |
| 同一理由の他の指摘項目で既に指摘対象 | `info`（`coveredElsewhereInReason: true`） |

### RRB.pageClaims（DOM）

- `collect(document)` → `{ ok: true, structure, citeInfo }` / `{ ok: false, error }`
- `fromText(text, source?, sourceLabel?)` → 貼り付けた請求項全文から構築

`analyze(text, options)` の `options.claimStructure` に渡すと、`result.claimStructure` /
`result.consistencyChecks` / `result.omittedClaimCandidates` が埋まり、
`claimStats.totalClaimCount` が構造由来の値になる（渡さなければ本文中の最大番号を推定値として使う）。

## UI 契約（担当: Sonnet サブエージェント）

### モーダル（analyzer-app.js）

- `RRB.analyzerApp.launch(config)` … `{ label: string }`。既存 `#rrb-host` があれば再利用・表示・前面化。
  ただし保持しているホストが**文書から外れていた場合は作り直す**（押しても何も出ない状態を防ぐ）
- **起動時にクレーム構造を自動取得する**（`RRB.pageClaims.collect(document)` をボタン操作なしで実行）。
  - 成功時は「自動取得: …」の接頭辞つきメッセージ＋入力画面に構造のサマリ行と
    `<details>`（既定は閉。ラベル「請求項構造を表示（N項）」）で請求項構造の表を表示する
  - 失敗・例外は**情報レベル**の表示に留め、`alert` を出さず**起動を妨げない**
    （拒絶理由の文章だけでも解析できるため）
  - 既に構造を取得済みなら再取得しない（再実行で取得結果を壊さない）
  - 手動の「ページから請求項を取得」ボタンと貼り付け経路は維持（接頭辞なしの通常文言）
  - 拒絶理由の文章の解析（「分析する」）は自動化しない（本文はページ上に無く貼り付けが必要なため）
- Shadow DOM (open)。ホスト以外のページ DOM・グローバルへ一切影響を与えない
- **入力画面**: タイトル「拒絶理由分析」/ 大 textarea / 「TXTファイルを読み込む」(input type=file +
  FileReader、UTF-8) / 「サンプルを読み込む」(RRB.sampleData.text) / 「クリア」/ 「分析する」/ 「閉じる」(×・Esc)
- **結果画面**:
  - サマリカード: 理由数 / 明確性件数 / サポート件数 / 29条系件数 / 最終指摘請求項の集合 /
    **未指摘請求項** / 警告件数
  - 「全請求項数」number 入力（初期値 = maxClaimNumber、「本文からの推定」ラベル）→ 変更で
    `RRB.validator.computeClaimStats` により未指摘請求項を再計算
  - タブ: 概要 / 明確性 / サポート要件 / 29条系 / その他 / 未解析・警告（該当なしは「該当なし」表示）
  - 明確性・サポート表の列: No. / 見出し請求項（修正後。注記があれば原文も併記）/ 問題となる記載 /
    直接指摘 / 同様指摘 / 引用元 / 引用による指摘 / 最終指摘 / 問題の要約 / 警告
  - 行クリック（またはボタン）で展開: 原文全文・比較対象記載・引用関係の内訳・警告詳細・確度
  - 29条系タブ: 新規性と進歩性を別表。列: 請求項 / 引用文献番号 / 引用文献名 / 適用関係 / 備考 / 警告
  - バッジ（色＋文字ラベル併用）: 直接指摘=強調 / 同様指摘 / 引用による指摘（引用元→対象を明示）/
    警告=黄・赤 / 未解析・low=グレー
  - 操作: 入力へ戻る / 再解析 / 閉じる / 表をコピー(TSV) / JSONコピー / JSON保存 / CSV保存(BOM付きUTF-8) /
    原文全文の表示切替 / **別タブでレポートを開く**
- コピー: `navigator.clipboard.writeText` → 失敗時 Shadow 内 textarea + `document.execCommand('copy')`
- 保存: Blob + a[download]（JSON: `rejection-analysis.json`、CSV: `rejection-analysis.csv`、
  レポート: `rejection-analysis-report.html`）
- 別タブ: `window.open('', '_blank')` → `document.write(reportHtml)`。ブロック時は HTML Blob 保存へ
  フォールバック。**レポートは JS 無しで成立**（対象ページの CSP を継承しても表示が壊れない）

### レポート（report-template.js）

- `RRB.reportTemplate.build(result, options) -> string`（完全な HTML 文書、`<script>` を一切含まない・純関数）
- 目次 / サマリ / カテゴリ別テーブル / 各行 `<details>` で原文展開 / 警告一覧 / 未解析原文 /
  `@media print` 対応 / すべての動的値は HTML エスケープ

### CSV / TSV 列（エクスポート共通）

`区分, 理由No, 項目No, 見出し請求項(原文), 見出し請求項(修正後), 直接指摘, 同様指摘, 引用元,
引用による指摘, 最終指摘, 引用文献番号, 引用文献名, 適用関係, 問題となる記載, 比較対象の記載,
問題の要約, 備考, 確度, 警告, 原文`
（明確性・サポートの行は引用文献系列が空、29条系の行は指摘系列が空）

## コーディング規約

- 各モジュールは既存 `claim_relation_writer/src/core/parser.js` と同じ UMD ヘッダ形式:

```javascript
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./claims'));   // 依存があれば require
  } else {
    root.RRB = root.RRB || {};
    root.RRB.splitter = factory(root.RRB.claims);    // 依存は RRB.* から受け取る
  }
})(globalThis, function (claims) {
  'use strict';
  // ...
  return { splitReasonSections, classifyReason, splitIssueBlocks };
});
```

- 複雑な正規表現には「何を解析するか」のコメント必須
- 実行時の `eval` / `new Function` / `document.write`（レポート用新タブへの write を除く）/
  外部リソース読込・外部送信は禁止
- テストは `node --test`（`tests/*.test.js`、`assert/strict`）
- Git 操作（commit / push / rebase 等）は行わない
