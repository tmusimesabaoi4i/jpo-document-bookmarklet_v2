# TODO: プロジェクト名

TODO: 1〜2 行の概要。  
フル版プロファイル（ローカル版 UI + ブックマークレット + コアロジック + テスト + ビルド）のプロジェクトです。完全にブラウザ内で完結し、外部にデータを送信しません。

## フォルダ構成

```
TODO_プロジェクト名/
├── README.md              … このファイル
├── package.json
├── docs/                  … 詳細仕様書
├── examples/
│   └── examples.js        … ロジックのゴールデンケース（入力と期待出力）
├── scripts/
│   └── build-bookmarklets.js  … ブックマークレット生成物のビルド（`npm run build:bookmarklets`）
├── src/
│   ├── core/              … DOM 非依存の純粋モジュール（UMD）
│   ├── local/             … ローカル版 UI（index.html・app.js・style.css）
│   └── bookmarklet/
│       ├── common/        … ブックマークレットの編集用ソース
│       └── <target>/      … ターゲット（対象ページ世代など）ごとの生成物（collector.js + collector.bookmarklet.js）
└── tests/                 … テストスイート（node --test）
```

対象ページのスナップショットは、リポジトリ共有の `../fixtures/TODO-ページ種別/` にあります。

## クイックスタート

- ローカル版: `src/local/index.html` をブラウザで開くだけ。
- ブックマークレット版: `src/bookmarklet/<target>/collector.bookmarklet.js` の中身（`javascript:` から始まる 1 行）をブラウザのブックマーク URL 欄に貼り付け。

## 使い方

TODO: 画面・操作の説明

## 対象ページと動作確認

- 前提ページ: TODO（依存するセレクタ・URL パターンなど）
- ローカル確認: リポジトリ共有の `../fixtures/TODO-ページ種別/new/TODO-ページ名.html` をブラウザで開く

## 開発（テスト・ビルド）

依存パッケージはありません。Node.js 18 以降で動作します。

- テスト: `npm test`（`node --test`）
- ブックマークレット生成物の再生成: `npm run build:bookmarklets`
- 生成物（`src/bookmarklet/<target>/`）は直接編集しないこと。先頭の自動生成バナー（DO NOT EDIT）が目印。編集対象は常に `src/bookmarklet/common/` と `src/core/`。

## 旧版（archive）

- 旧世代を退避する場合は `archive/v{N}-<名前>/` に置く。
