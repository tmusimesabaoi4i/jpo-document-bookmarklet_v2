# jpo-document-bookmarklet_v2

特許庁（JPO）の Web ページ向けブラウザツール集（モノレポ）です。すべてのツールは完全にブラウザ内で動作し、外部にデータを送信しません。依存パッケージなし（開発ツールは Node.js 18 以降のみ）。

## プロジェクト一覧

| プロジェクト | プロファイル | 内容 |
|---|---|---|
| [`document_downloader/`](document_downloader/README.md) | 軽量版 | JPO 文書一覧ページから、国内書類（テキスト / HTML / 画像 / PDF / 印刷）と OPD 書類（他庁公開情報）を一括保存するブックマークレット。ダウンロード後に出願番号ごとへ仕分ける `sort_jpo_downloads.bat` 付き |
| [`claim_relation_writer/`](claim_relation_writer/README.md) | フル版 | クレームの引用関係（クレームツリー）を解析し、明確性・サポート要件の拒絶理由定型文を生成するツール。ローカル版 UI とブックマークレット版の両方あり |
| [`blank_note_printer/`](blank_note_printer/README.md) | 軽量版 | JPO 文書一覧ページの出願番号から、空白 A4 約 30 枚を印刷して `出願番号_note.pdf` を作るブックマークレット |
| [`rejection_reason_bookmarklet/`](rejection_reason_bookmarklet/README.md) | フル版 | 拒絶理由通知の全文を解析し、指摘事項（明確性・サポート要件・29条系）を構造化して表形式・別タブレポートで表示するブックマークレット |
| [`term_marker/`](term_marker/README.md) | 軽量版 | JPO 文書 HTML（請求の範囲・明細書・手続補正書）上で「前記XXXX」の語句を自動抽出し、語句ごとに 25 色で塗り分けるブックマークレット。右上パネルで対応表を編集して再適用、印刷、対応表付き HTML 出力 |
| [`claim_group_comparator/`](claim_group_comparator/README.md) | フル版 | 書類比較・クレームチェッカーから請求項を取り出し、字面・段落構造・カテゴリー・クレームツリーから比較候補のグループを自動作成して、別タブで並べて見比べるブックマークレット。段落は「同じ番号」ではなく最も似ている段落どうしを同期強調 |

**ダウンロードファイルの命名は出願番号を先頭に統一しています**（国内書類 `出願番号_YYYYMMDD_文書名.拡張子` /
OPD `出願番号_元のZIPファイル名` / 空白ノート `出願番号_note.pdf`）。
そのため `document_downloader/src/sort_jpo_downloads.bat` が、ダウンロードフォルダを出願番号ごとの
`HTML` / `TXT` / `PDF` / `IMG` / `OPD` フォルダへまとめて仕分けられます。

## フォルダ構成

```
jpo-document-bookmarklet_v2/
├── README.md                  … このファイル
├── fixtures/                  … 【共有】対象JPOページのHTMLスナップショット（台帳: fixtures/README.md）
│   ├── document-list/         … 文書一覧ページ（new/ と legacy/）
│   ├── claim-checker/         … 書類比較・クレームチェッカー（new/ と legacy/）
│   ├── rejection-reason/      … 拒絶理由通知のテキストサンプル
│   └── document-html/         … 文書 HTML（本文表示。手続補正書の実物）
├── templates/                 … 【共有】新規プロジェクト用の雛形（full/ と lite/。手順: templates/README.md）
├── document_downloader/       … 軽量版プロジェクト（+ 生成スクリプトとテスト）
│   ├── src/bookmarklet/       … collector.js（編集用＝正本）+ collector.bookmarklet.js（1行版・生成物）
│   ├── src/sort_jpo_downloads.bat … ダウンロードフォルダを出願番号ごとに仕分ける BAT（Windows）
│   ├── scripts/               … build-bookmarklet.js（1行版の生成。依存ゼロ）
│   ├── tests/                 … node --test 用（依存ゼロ。BAT は一時フォルダで実行して検証）
│   └── archive/               … ツール旧世代（v1 / v2 / v3）の退避
├── blank_note_printer/        … 軽量版プロジェクト（空白ノート印刷）
│   ├── src/bookmarklet/       … collector.js（編集用）+ collector.bookmarklet.js（1行版）
│   ├── tests/                 … node --test 用（依存ゼロ。出願番号取得と1行版の同期を検証）
│   └── archive/               … （現在は空）
├── claim_relation_writer/     … フル版プロジェクト
│   ├── package.json           … npm test / npm run build:bookmarklets
│   ├── src/
│   │   ├── core/              … DOM 非依存のコアロジック
│   │   ├── local/             … ローカル版 UI（index.html を開くだけで動作）
│   │   └── bookmarklet/       … ブックマークレット版（common/ がソース、new/・legacy/ が生成物）
│   ├── scripts/               … ビルドスクリプト
│   ├── tests/                 … テストスイート（node --test）
│   ├── examples/              … ロジックのゴールデンケース
│   └── docs/                  … 詳細仕様書
├── rejection_reason_bookmarklet/ … フル版プロジェクト（拒絶理由通知の解析・可視化。構成は同上）
├── term_marker/               … 軽量版プロジェクト（「前記XXXX」語句カラーマーキング）
│   ├── src/bookmarklet/       … marker.js（編集用＝正本）+ marker.bookmarklet.js（1行版・生成物）
│   ├── scripts/               … build-bookmarklet.js（1行版の生成。依存ゼロ）
│   ├── tests/                 … node --test 用（依存ゼロ。fixtures/document-html を読む）
│   └── docs/                  … 設計メモ
└── claim_group_comparator/    … フル版プロジェクト（請求項グループ比較）
    ├── src/core/              … DOM 非依存のコア（正規化・引用解析・ツリー・類似度・グルーピング・段落対応・状態・レイアウト・設定）
    ├── src/extract/           … クレームチェッカーとの接続部分（ここだけがページの DOM を知る）
    ├── src/view/              … 比較タブの画面（別タブへ DOM API だけで描画）
    ├── src/bookmarklet/       … common/launcher-app.js（編集用）+ comparator*.js（生成物）
    ├── scripts/               … build-bookmarklets.js（1行版の生成。依存ゼロ）
    ├── tests/                 … node --test 用（fixtures/claim-checker と人工データの両方で検証）
    └── docs/                  … 設計メモ
```

## クイックスタート

- **文書を一括保存したい** → `document_downloader/src/bookmarklet/collector.bookmarklet.js` の中身をブラウザのブックマーク URL 欄に貼り付け（詳細は [document_downloader/README.md](document_downloader/README.md)）
- **拒絶理由の定型文を作りたい** → `claim_relation_writer/src/local/index.html` をブラウザで開くだけ（詳細は [claim_relation_writer/README.md](claim_relation_writer/README.md)）
- **空白ノート PDF（`出願番号_note.pdf`）を作りたい** → `blank_note_printer/src/bookmarklet/collector.bookmarklet.js` の中身をブラウザのブックマーク URL 欄に貼り付け（詳細は [blank_note_printer/README.md](blank_note_printer/README.md)）
- **請求項の「前記〜」語句を色分けして読みたい** → `term_marker/src/bookmarklet/marker.bookmarklet.js` の中身をブラウザのブックマーク URL 欄に貼り付け、文書 HTML 上で実行（詳細は [term_marker/README.md](term_marker/README.md)）
- **似ている請求項を並べて文言差を探したい** → `claim_group_comparator/src/bookmarklet/comparator.bookmarklet.js` の中身をブラウザのブックマーク URL 欄に貼り付け、クレーム解析後の書類比較・クレームチェッカー上で実行（詳細は [claim_group_comparator/README.md](claim_group_comparator/README.md)）

## 共有リソースと用語

- **`fixtures/`** = 対象 JPO ページの実物 HTML スナップショット。ブックマークレットの開発・動作確認・テストの土台として、複数プロジェクトから参照される共有資産です。構成規約は `fixtures/<ページ種別>/<世代>/<ページ名>.html`。詳細は [fixtures/README.md](fixtures/README.md)。
- **`examples/`（各プロジェクト内）** = ロジックのゴールデンケース（入力と期待出力）。ページスナップショット（fixtures）とは別物なので混同しないこと。
- **世代の語彙**: `new` / `legacy` は「対象ページの世代」（新版 www.beta.jpo.go.jp 系／旧版 gem.prototype.jpo.go.jp 系）を指します。**ツール自体の旧版**は各プロジェクトの `archive/v{N}-<名前>/` に退避します（`legacy` をツール旧版の意味では使いません）。

## 標準プロジェクト構成（新規プロジェクトの追加）

プロジェクトは次の 2 プロファイルのどちらかで作ります。**軽量版はフル版の厳密な部分集合**なので、軽量版で始めてフォルダを足せばフル版に昇格できます。

- **軽量版**（ブックマークレットのみ）: `README.md` + `src/bookmarklet/`（編集用 `X.js` と 1 行版 `X.bookmarklet.js` のペア）+ `archive/`（任意）。ビルドなし・手動反映。
  - 例外: `document_downloader` はソースが大きく手作業での 1 行化が現実的でないため、依存ゼロの `scripts/build-bookmarklet.js`（1 行版の生成）と `tests/`（`node --test`）だけを足しています。ローカル UI もコアモジュール分割も持たないので軽量版のままです。`package.json` は置かず、テストはリポジトリルートから実行します。
  - `blank_note_printer` も `tests/` だけを足しています（ビルドは無いまま。1 行版が古くならないよう、テストが同じエンコードを再現して同期を検査します）。
- **フル版**（ローカル UI + ブックマークレット + テスト + ビルド）: 軽量版 + `package.json` + `src/core/` + `src/local/` + `src/bookmarklet/common/`（ビルド元）+ `scripts/` + `tests/` + `examples/` + `docs/`。

命名規約:

- `X.js`（読みやすい版）と `X.bookmarklet.js`（1 行版）は必ず同じフォルダにペアで置く。
- 自動生成物の先頭には必ず DO NOT EDIT バナーを付ける（フル版のビルドが付与）。**バナーの有無が「編集してよいか」の目印**（バナーなし = 手編集ソース）。
- README の見出しは「概要 → フォルダ構成 → クイックスタート →（プロジェクト固有の使い方）→ 対象ページと動作確認 → 開発（ビルド有無を明示）→ 旧版（archive）」の順に揃える。

新規プロジェクトは [`templates/`](templates/README.md) の `full/` または `lite/` をコピーして開始してください。

## ルール: プロジェクト間の独立性

**各プロジェクトは他のプロジェクトに依存してはいけません。** 各プロジェクトは単体で完結させます。

- 他プロジェクトのファイルを**相対パスで参照しない**（`require('../other_project/...')`、ビルドの連結対象への `../other_project/...`、`<script src="../other_project/...">` はすべて禁止）。
- 他プロジェクトの仕組みを使いたい場合は、**そのプロジェクト内へ機構を取り込む（コピーする）**。取り込んだファイルの冒頭コメントに「どこから取り込んだか」と「一方を直したら他方も直すか判断すること」を明記し、取り込み側でもテストを持つ。
- 共有してよいのは**データだけ**です（`fixtures/` の対象ページスナップショットなど）。実行コードは共有しません。
- 理由: プロジェクトを単独でコピー・配布でき、片方の変更が他方のビルドやテストを壊さないようにするため。取り込みによる重複は、この独立性を守るための意図的なコストです。
- 共有されるのは `fixtures/`（データ）と `templates/`（雛形のコピー元）のみで、いずれも依存関係を作りません。

## 注意

- 各プロジェクトに同名の `collector.js` / `collector.bookmarklet.js` がありますが中身は無関係の別物です。検索時はフォルダ名まで確認してください。
- `claim_relation_writer` の `npm test` は共有の `fixtures/` を読むテストを含むため、リポジトリ全体をチェックアウトした状態で実行してください。
- `term_marker` のテストは共有の `fixtures/document-html/` を読みます。リポジトリルートから `node --test "term_marker/tests/*.test.js"` で実行してください（`package.json` なし・依存ゼロ）。
- `claim_group_comparator` のテストも共有の `fixtures/claim-checker/` を読みます。リポジトリルートから `node --test "claim_group_comparator/tests/*.test.js"`（または同フォルダで `npm test`）で実行してください。fixtures を読まない人工データのテスト（`tests/generic.test.js`）が別にあり、案件に依存しないことはそちらで検査します。
- `document_downloader` と `blank_note_printer` のテストも共有の `fixtures/` を読みます。リポジトリルートから `node --test "document_downloader/tests/*.test.js"` / `node --test "blank_note_printer/tests/*.test.js"` で実行してください（`package.json` なし・依存ゼロ）。`document_downloader/tests/sort-bat.test.js` は Windows でのみ実行され（それ以外はスキップ）、OS の一時フォルダに作った実験用フォルダで BAT を動かすので本物のダウンロードフォルダには触れません。
- 新版 JPO ページの出願番号取得（`#lappnum` のリンク文言が「Evrikaでスクリーニング」に変わった問題への対応）は `document_downloader` と `blank_note_printer` の**2 か所に独立実装**があります（「プロジェクト間の独立性」に従った意図的な取り込み）。取得順序を変える場合は両方を確認してください。テスト用の最小 DOM（`tests/minidom.js`）も同様に各プロジェクトへコピーしています。
- 罫線ツリー記法の解析は `claim_relation_writer/src/core/parser.js` と `rejection_reason_bookmarklet/src/core/claim-tree.js` の**2か所に独立実装**があります（上記「プロジェクト間の独立性」のルールに従った意図的な取り込み）。記法の解釈を変える場合は両方を確認してください。
