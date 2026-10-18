# rejection_reason_bookmarklet — 拒絶理由分析ブックマークレット

拒絶理由通知の全文（貼り付け又は TXT ファイル）を解析し、理由単位・指摘項目単位に構造化して
「どの請求項に・どんな拒絶理由が・どの引用関係で」指摘されているかを表形式で表示するツールです。
フル版プロファイル（ローカル版 UI + ブックマークレット + コアロジック + テスト + ビルド）のプロジェクトです。完全にブラウザ内で完結し、外部にデータを送信しません。

主な機能:

- 理由分割（●理由Ｘ見出し・冒頭理由一覧・法条から分類。矛盾は再分類せず警告）
- 明確性・サポート要件の項目解析（見出し請求項／直接指摘／同様指摘／引用関係による指摘／
  最終指摘の区別、かぎ括弧内クレーム文言の役割分類、修正注記「（修正：５を除く）」の処理）
- 29条系（新規性・進歩性）の請求項×引用文献の対応表（引用文献一覧との対応付け）
- **特許請求の範囲との照合**（対象ページのクレーム解析結果から取得。引用関係は罫線ツリー
  `#claim_tree`、合計請求項数は `#claim_cite`、請求項全文は `#claim_mark` から）
  - 請求項構造（独立／従属、直接・間接の引用元と下位請求項、多項従属・選択的引用の区別）
  - **指摘漏れ候補**の検出（問題請求項を引用する下位請求項が指摘対象に無い場合。引用経路と根拠つき）
  - 見出し請求項／本文上の指摘集合／結論請求項の三者照合と差分表示
  - 拒絶理由に書かれた引用関係と実際のクレーム引用関係の相互照合
  - 拒絶理由に実在しない請求項番号が記載されていないかの確認
- **未指摘請求項**の表示（全請求項数は請求項構造から取得。未取得時は本文から推定し手動上書き可）
- 問題の要約（テンプレート方式）・解析確度（high/medium/low）・エラー／警告／情報の件数表示
- JSON／CSV 保存・TSV コピー・**別タブの HTML レポート**（JS 不使用、`<details>` で原文展開・印刷対応）

## フォルダ構成

```
rejection_reason_bookmarklet/
├── README.md                  … このファイル
├── package.json               … npm test / npm run build:bookmarklets
├── docs/
│   ├── specification.md       … 仕様書（モジュール間契約・データ構造）
│   └── implementation-report.md … 実装報告書（テスト結果・既知の限界）
├── examples/
│   ├── examples.js            … ゴールデンケース（拒絶理由例の期待構造化データ）
│   └── examples-article29.js  … 29条系の合成ゴールデンケース
├── scripts/
│   └── build-bookmarklets.js  … 連結・1行化・自己検証
├── src/
│   ├── core/                  … DOM 非依存の解析コア（normalizer → claims → splitter →
│   │                            clarity-support → article29 → summarizer → validator →
│   │                            claim-tree → claim-structure → consistency → analyzer）
│   ├── local/                 … ローカル開発・確認用ページ（index.html を開くだけで動作）
│   └── bookmarklet/
│       ├── common/            … ビルド元（sample-data / report-template / analyzer-app）
│       └── new/               … 生成物（collector.js + collector.bookmarklet.js、DO NOT EDIT）
└── tests/                     … テストスイート（node --test）＋ parser-test.html（ブラウザ用）
```

## クイックスタート

1. `src/bookmarklet/new/collector.bookmarklet.js` の中身（`javascript:` で始まる 1 行）をコピーし、
   ブラウザのブックマークの URL 欄に貼り付けて保存する
2. 対象ページ（書類比較・クレームチェッカー）で**先に「クレーム解析」を実行**しておく
3. ブックマークをクリックする → モーダルが開き、**請求項構造は自動で取得・表示される**
4. 拒絶理由通知の全文を貼り付ける（又は「TXTファイルを読み込む」）→「分析する」

請求項の取得は起動時に自動で行われます（クレーム解析が未実行などで取得できない場合も
起動は妨げられず、拒絶理由の文章だけで解析できます）。取得し直したいときは
「ページから請求項を取得」ボタン、ページから取れないときは請求項全文の貼り付けが使えます。

請求項構造を取得すると、全請求項数が特許請求の範囲の実際の値になり、指摘漏れ候補・
請求項の実在確認・引用関係の相互照合が有効になります。取得できない場合は拒絶理由の
文章内だけの整合性検証になります（全請求項数は本文中の最大請求項番号からの推定値）。

ローカルで試すだけなら `src/local/index.html` をブラウザで開き「モーダルを起動」を押してください。

## 使い方（解析結果画面）

- 上部カード: 理由数・明確性／サポート要件／29条系の件数・最終指摘請求項・**未指摘請求項**・
  エラー／警告／情報の件数。「全請求項数」は請求項構造を取得していればその値（ラベル
  「特許請求の範囲から取得」）、未取得なら本文からの推定値で、入力欄から上書きできます
- タブ: 概要／明確性／サポート要件／29条系／その他／**請求項構造**／**整合性チェック**／
  **指摘漏れ候補**／未解析・警告
- 表の行を展開すると原文全文・比較対象の記載・引用関係の内訳・警告詳細を確認できます
- 「レポートを別タブで開く」で全項目を省略なしで一覧できる印刷対応レポートを表示します
  （ポップアップがブロックされた場合は HTML ファイル保存にフォールバック）
- 出力: 表コピー（TSV）／JSON コピー・保存／CSV 保存（BOM 付き UTF-8、Excel 対応）

## 対象ページと動作確認

- 対象スナップショット: [`fixtures/claim-checker/new/書類比較・クレームチェッカー_特願2024-203064.html`](../fixtures/claim-checker/new/)
  （`file://` で開いた保存版ページ上での動作を確認。ページには CSP メタタグ
  `script-src 'self'` があるため、実行時に eval・`<script>` 挿入・外部読込を一切使わない設計）
- 2026 年の新 UI スナップショット: [`fixtures/claim-checker/new/書類比較・クレームチェッカー_特願2025-557197.html`](../fixtures/claim-checker/new/)
  （請求項境界が `span.claim_num`、表示用番号が `cited_word` / `jump_link show_word`、
  引用一覧が「直接＋間接の全引用元」形式。`tests/new-ui-fixture.test.js` で固定）
- 解析サンプル: [`fixtures/rejection-reason/拒絶理由例.txt`](../fixtures/rejection-reason/拒絶理由例.txt)
  （モーダルの「サンプルを読み込む」で同じ内容を読み込めます）
- 解析はページ DOM に依存しないため、新旧どちらのチェッカー画面でも（他のページでも）動作します

## 開発

- テスト: `npm test`（`node --test`。共有 `fixtures/` を読むテストを含むためモノレポの
  チェックアウトで実行すること）
- ブラウザ上での解析テスト: `tests/parser-test.html` をブラウザで開く（`file://` で可。
  コアモジュールを読み込んで主要ケースの合否表を表示する。Node のテストとは独立）
- ビルド: `npm run build:bookmarklets`（`src/bookmarklet/new/` に生成。生成物には
  DO NOT EDIT バナーが付く。手編集しないこと）
- **他プロジェクトへの依存はなし**（ルート README.md「プロジェクト間の独立性」のルール）。
  罫線ツリー記法の解析は `claim_relation_writer/src/core/parser.js` のアルゴリズムを
  `src/core/claim-tree.js` へ**取り込んだ独立実装**であり、相対パス参照はしていない。
  記法の解釈を変える場合は両方のプロジェクトを確認すること
  （本プロジェクト側の検証は `tests/claim-tree.test.js`）
- 設計・データ構造は [`docs/specification.md`](docs/specification.md)、
  テスト結果と既知の限界は [`docs/implementation-report.md`](docs/implementation-report.md) を参照
- 解析ロジック（`src/core/`）と表示（`src/bookmarklet/common/`、`src/local/`）は分離されている。
  解析パターンを追加する場合は、先に `examples/` へ期待値を足してから
  対応するモジュールとテストを更新する

## 旧版（archive）

なし（初版）。
