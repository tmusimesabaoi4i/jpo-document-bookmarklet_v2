# document_downloader

JPO 文書ページから文書（テキスト / HTML / 画像 / 印刷）を一括保存するブックマークレット。  
軽量版プロファイル（ブックマークレットのみ・ローカルUIなし・ビルドなし）のプロジェクトです。

## フォルダ構成

```
document_downloader/
├── README.md
├── src/
│   └── bookmarklet/
│       ├── collector.js               … 編集用ソース（手編集。自動生成バナーなし）
│       └── collector.bookmarklet.js   … ブックマーク登録用の 1 行版
└── archive/                           … ツール旧世代の退避
    ├── v1-single/                     … v1: テキスト / 画像 / 印刷の単体版
    └── v2-collector/                  … v2: 統合版 Collector
```

対象ページのスナップショットは、リポジトリ共有の [`fixtures/document-list/`](../fixtures/document-list/) にあります。

### 命名ルール

- フォルダ名でプロジェクトを表す（ファイル名には `jpo-document-` などのプレフィックスを付けない）
- `*.js` … 編集用の読みやすいソース
- `*.bookmarklet.js` … ブックマーク URL に貼る 1 行版（`*.js` と同じフォルダにペアで置く）

## クイックスタート（ブックマーク登録）

1. `src/bookmarklet/collector.bookmarklet.js` を開く
2. ファイル全体（`javascript:` から始まる 1 行）をコピー
3. ブラウザの新規ブックマーク URL 欄に貼り付け

旧版を使う場合: `archive/v2-collector/collector.bookmarklet.js`（v2）／`archive/v1-single/*.bookmarklet.js`（v1）

## 機能（現行版 v3）

- 文書を選んで、テキスト / HTML / 画像 / 印刷をまとめて実行
- プリセット・フィルタ・進捗ログあり
- v2 との主な違い: 新版 JPO ページ（`/core/jsv/`）対応、HTML 保存あり

## 対象ページと動作確認

- 前提ページ: 出願番号 `#lappnum`、文書一覧 `tr[data-content-id]`
- ローカル確認: リポジトリ共有の [`fixtures/document-list/new/特願2024-563143.html`](../fixtures/document-list/new/特願2024-563143.html)（新版ページ）／同 `legacy/`（旧版ページ）をブラウザで開く
  - スナップショットはコンパニオンフォルダ（`*_files/`）なしで保存されているため、スタイルなしで表示されます（動作確認には影響しません）
- 保存先はブラウザのダウンロード設定に従う（フォルダ直接保存も選択可）
- 出力ファイル名: `出願番号_日付_文書名_種別.拡張子`（ラベル指定時は先頭に付与）
- ページ DOM 変更・ポップアップブロック・認証制限で動かない場合あり

## 開発（ビルドなし）

- このプロジェクトにビルド工程はありません。`src/bookmarklet/collector.js` を修正したら、`collector.bookmarklet.js` へ手動で反映します。
- `collector.js` は手編集ソースです（フル版プロジェクトの生成物と違い、自動生成バナー（DO NOT EDIT）が付いていません。バナーの有無が編集可否の目印です）。

## 旧版（archive）

| フォルダ | 世代 | 内容 |
|---|---|---|
| `src/bookmarklet/` | 現行（v3） | `collector.js` / `collector.bookmarklet.js` |
| `archive/v2-collector/` | v2 | 統合版 Collector |
| `archive/v1-single/` | v1 | テキスト / 画像 / 印刷の単体版 |
