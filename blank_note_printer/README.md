# blank_note_printer

JPO 文書一覧（経過情報）ページで実行すると、出願番号を取得して**完全に空白の A4 ページ約 30 枚**の印刷用ウィンドウを開き、ブラウザの「PDF に保存」で `出願番号_note.pdf`（例: `特願2022-122252_note.pdf`）を作れるブックマークレット。  
軽量版プロファイル（ブックマークレットのみ・ローカルUIなし・ビルドなし）のプロジェクトです。

## フォルダ構成

```
blank_note_printer/
├── README.md
├── src/
│   └── bookmarklet/
│       ├── collector.js               … 編集用ソース（手編集。自動生成バナーなし）
│       └── collector.bookmarklet.js   … ブックマーク登録用の 1 行版
├── tests/
│   ├── collector.test.js              … fixtures に対する出願番号取得の検証（node --test）
│   ├── bookmarklet.test.js            … collector.js と 1 行版が同期しているかの検証
│   └── minidom.js                     … テスト専用の最小 DOM（依存ゼロ）
└── archive/                           … ツール旧世代の退避（現在は空）
```

対象ページのスナップショットは、リポジトリ共有の [`fixtures/document-list/`](../fixtures/document-list/) にあります。

## クイックスタート（ブックマーク登録）

1. `src/bookmarklet/collector.bookmarklet.js` を開く
2. ファイル全体（`javascript:` から始まる 1 行）をコピー
3. ブラウザの新規ブックマーク URL 欄に貼り付け

## 機能

- ページから出願番号を取得し、確認ダイアログ（「◯◯_note（空白A4×30枚）を印刷します」）を表示
- OK すると印刷用ポップアップに空白 A4 × 30 ページを組み立てて `window.print()` を実行
- 印刷用 HTML の `<title>` を `出願番号_note` にするため、「PDF に保存」時の初期ファイル名が `出願番号_note.pdf` になる（ファイル名に使えない文字 `\ / : * ? " < > |` は `_` に置換）
- 空白ページは文字・罫線・ページ番号なしの完全な白紙（`@page { size: A4; margin: 0 }` + 空の block を CSS 改ページで区切る方式）。枚数はソース先頭の定数 `PAGE_COUNT` で変更可能
- 印刷用ウィンドウは名前付きで再利用するため、二重実行しても増えない。印刷後も開いたまま（閉じるのはユーザー操作）

## 出願番号の取得（新旧ページ対応）

**`#lappnum` の表示文字列だけには依存しません。** 2026 年の新 JPO ページでは `#lappnum` の
リンク文言が出願番号ではなく「Evrikaでスクリーニング」に変わったため、そのままではファイル名が
誤った文字列になります。次の順に試し、最初に**出願番号の形（`特願`/`実願`/`意願`/`商願` + 西暦4桁 +
連番6桁）として読めた**ものを採用します。

| 順 | 取得元 | 主に効くページ |
|---|---|---|
| 1 | `meta[data-title="LappnumStr"]` | 旧世代（新版では JS が削除するため空振りしうる） |
| 2 | `#lappnum` の表示文字列 | 旧世代／旧版（新版では「Evrikaでスクリーニング」なので不採用） |
| 3 | 「本願番号」欄の地の文（`<th>本願番号</th>` の隣のセル） | **新版（現行）の主経路** |
| 4 | 文書リンクの `data-title`（`特願2022-122252:図面(20220729)`） | 新版・旧版 |
| 5 | `meta[data-title="Lappnum"]`（11 桁の数値形式） | 旧世代 |
| 6 | 一族出願テーブルの `input[name="lappnum"]`（11 桁） | 新版 |
| 7 | URL 中の 11 桁出願番号 | 実ページ全般 |
| 8 | `<title>`（`経過:特願2022-122252`） | 保存済み HTML を含む全般 |

どこからも読めなかった場合は、**誤った名前で保存せずに** alert（確認した箇所の一覧つき）で終了します。

このフォールバックの考え方は `document_downloader/src/bookmarklet/collector.js` の `resolveAppNo()` から
**取り込んだ（コピーした）**ものです。ルート README「プロジェクト間の独立性」に従い実行時参照はしません。
JPO ページの DOM が変わったときは、両方を直すか判断してください。

## 対象ページと動作確認

- 前提ページ: JPO 文書一覧（経過情報）ページ（新版 `/main/core/jsv/` 系を主対象。旧版 `/core/docs/jsv/` 系も可）
- ポップアップがブロックされた場合は alert で許可を促します
- 自動テスト（依存ゼロ・Node 18 以降。リポジトリルートから実行）:

  ```
  node --test "blank_note_printer/tests/*.test.js"
  ```

  共有の `fixtures/document-list/` の実 HTML に対して、次を検証します。

  - `new/経過_特願2022-122252.html` → `特願2022-122252`（`#lappnum` の「Evrikaでスクリーニング」を採用しない）
  - `new/経過_特願2023-170613.html` → `特願2023-170613`
  - `legacy/特願2024-563143_beta.html` / `legacy/特願2024-563143.html` → `特願2024-563143`（従来動作の維持）
  - 取得できないときに空を返すこと（誤った名前で保存しない）
  - `collector.js` と `collector.bookmarklet.js` が同期していること

- ローカルでの手動確認: 上記 fixture をブラウザで開いてブックマークレットを実行
  - スナップショットはコンパニオンフォルダ（`*_files/`）なしで保存されているため、スタイルなしで表示されます（出願番号の確認には影響しません）

## 開発（ビルドなし）

- このプロジェクトにビルド工程はありません。`src/bookmarklet/collector.js` を修正したら、`collector.bookmarklet.js` へ手動で反映します（`javascript:` プレフィックスを付け、`%` → `%25`、`#` → `%23`、改行 → `%0A` の順にエンコード）。
- 反映漏れは `tests/bookmarklet.test.js` が検出します（同じ変換を再現して差分を比較）。**`collector.js` だけ直して 1 行版が古い状態は許容しません。**
- `collector.js` は手編集ソースです（自動生成バナー（DO NOT EDIT）なし。バナーの有無が編集可否の目印）。
- `collector.js` は「純粋処理（文字列ユーティリティ / 出願番号の取得 / 空白 A4 の組み立て）」と「main」を分けており、Node からは `CORE` だけを `require()` できます（ブラウザでは `window.__JPO_NOTE_PRINTER_CORE__` にも出ます）。`window` の有無で分岐するので、ページ側に `window.module` があっても誤動作しません。
- 対象ページの CSP（`script-src 'self'`）に合わせ、実行時コードに `eval` / `new Function` を含めません（テストで検査しています）。
- 外部通信なし・依存パッケージなしの完全ブラウザ内完結。

## 関連

- ダウンロードした `出願番号_note.pdf` は、`document_downloader/src/sort_jpo_downloads.bat` が
  出願番号ごとの `PDF` フォルダへ仕分けます（詳細は [document_downloader/README.md](../document_downloader/README.md)）。

## 旧版（archive）

- 旧世代を退避する場合は `archive/v{N}-<名前>/` に置く（現在は空）。
