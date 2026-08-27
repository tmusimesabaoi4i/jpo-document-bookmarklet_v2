# blank_note_printer

JPO 文書一覧ページで実行すると、出願番号を取得して**完全に空白の A4 ページ約 30 枚**の印刷用ウィンドウを開き、ブラウザの「PDF に保存」で `出願番号_note.pdf`（例: `特願2024-563143_note.pdf`）を作れるブックマークレット。  
軽量版プロファイル（ブックマークレットのみ・ローカルUIなし・ビルドなし）のプロジェクトです。

## フォルダ構成

```
blank_note_printer/
├── README.md
├── src/
│   └── bookmarklet/
│       ├── collector.js               … 編集用ソース（手編集。自動生成バナーなし）
│       └── collector.bookmarklet.js   … ブックマーク登録用の 1 行版
└── archive/                           … ツール旧世代の退避（現在は空）
```

対象ページのスナップショットは、リポジトリ共有の [`fixtures/document-list/`](../fixtures/document-list/) にあります。

## クイックスタート（ブックマーク登録）

1. `src/bookmarklet/collector.bookmarklet.js` を開く
2. ファイル全体（`javascript:` から始まる 1 行）をコピー
3. ブラウザの新規ブックマーク URL 欄に貼り付け

## 機能

- ページの出願番号（`#lappnum`）を取得し、確認ダイアログ（「◯◯_note（空白A4×30枚）を印刷します」）を表示
- OK すると印刷用ポップアップに空白 A4 × 30 ページを組み立てて `window.print()` を実行
- 印刷用 HTML の `<title>` を `出願番号_note` にするため、「PDF に保存」時の初期ファイル名が `出願番号_note.pdf` になる（ファイル名に使えない文字 `\ / : * ? " < > |` は `_` に置換）
- 空白ページは文字・罫線・ページ番号なしの完全な白紙（`@page { size: A4; margin: 0 }` + 空の block を CSS 改ページで区切る方式）。枚数はソース先頭の定数 `PAGE_COUNT` で変更可能
- 印刷用ウィンドウは名前付きで再利用するため、二重実行しても増えない。印刷後も開いたまま（閉じるのはユーザー操作）

## 対象ページと動作確認

- 前提ページ: JPO 文書一覧ページ（新版 `/core/jsv/` 系を主対象）。出願番号 `#lappnum` の表示文字列に依存
- `#lappnum` が見つからない場合は alert で案内して終了。ポップアップがブロックされた場合も alert で許可を促す
- ⚠ **2026 年の新 UI 未対応**: 現行の JPO 経過情報ページでは `#lappnum` のリンク文言が出願番号ではなく
  「Evrikaでスクリーニング」に変わっており、このツールはファイル名に誤った文字列を使います。
  `fixtures/document-list/new/経過_特願2022-122252.html` で再現します。
  `document_downloader` は v4 でフォールバック（「本願番号」欄の地の文など）を実装済みなので、
  修正する場合は `document_downloader/src/bookmarklet/collector.js` の `resolveAppNo()` を参考にしてください
  （ルート README「プロジェクト間の独立性」に従い、参照ではなく取り込むこと）。
- ローカル確認: リポジトリ共有の [`fixtures/document-list/legacy/特願2024-563143_beta.html`](../fixtures/document-list/legacy/特願2024-563143_beta.html)（`#lappnum` に出願番号が入る世代）／`new/`（現行 UI・上記のとおり未対応）／`legacy/特願2024-563143.html`（旧版ページ）をブラウザで開いてブックマークレットを実行
  - スナップショットはコンパニオンフォルダ（`*_files/`）なしで保存されているため、スタイルなしで表示されます（`#lappnum` の確認には影響しません）

## 開発（ビルドなし）

- このプロジェクトにビルド工程はありません。`src/bookmarklet/collector.js` を修正したら、`collector.bookmarklet.js` へ手動で反映します（`javascript:` プレフィックスを付け、`%` → `%25`、`#` → `%23`、改行 → `%0A` の順にエンコード）。
- `collector.js` は手編集ソースです（自動生成バナー（DO NOT EDIT）なし。バナーの有無が編集可否の目印）。
- 外部通信なし・依存パッケージなしの完全ブラウザ内完結。

## 旧版（archive）

- 旧世代を退避する場合は `archive/v{N}-<名前>/` に置く（現在は空）。
