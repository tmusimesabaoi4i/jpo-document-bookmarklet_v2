# TODO: プロジェクト名

TODO: 1〜2 行の概要（何のページで何をするブックマークレットか）。  
軽量版プロファイル（ブックマークレットのみ・ローカルUIなし・ビルドなし）のプロジェクトです。

## フォルダ構成

```
TODO_プロジェクト名/
├── README.md
├── src/
│   └── bookmarklet/
│       ├── collector.js               … 編集用ソース（手編集。自動生成バナーなし）
│       └── collector.bookmarklet.js   … ブックマーク登録用の 1 行版
└── archive/                           … ツール旧世代の退避（v{N}-<名前>/）
```

対象ページのスナップショットは、リポジトリ共有の `../fixtures/TODO-ページ種別/` にあります。

## クイックスタート（ブックマーク登録）

1. `src/bookmarklet/collector.bookmarklet.js` を開く
2. ファイル全体（`javascript:` から始まる 1 行）をコピー
3. ブラウザの新規ブックマーク URL 欄に貼り付け

## 機能

- TODO: 箇条書きで

## 対象ページと動作確認

- 前提ページ: TODO（依存するセレクタ・URL パターンなど）
- ローカル確認: リポジトリ共有の `../fixtures/TODO-ページ種別/new/TODO-ページ名.html` をブラウザで開く

## 開発（ビルドなし）

- このプロジェクトにビルド工程はありません。`src/bookmarklet/collector.js` を修正したら、`collector.bookmarklet.js` へ手動で反映します（`javascript:` プレフィックスを付け、`%` → `%25`、`#` → `%23`、改行 → `%0A` の順にエンコード）。
- `collector.js` は手編集ソースです（自動生成バナー（DO NOT EDIT）なし。バナーの有無が編集可否の目印）。

## 旧版（archive）

- 旧世代を退避する場合は `archive/v{N}-<名前>/` に置く（最初は空）。
