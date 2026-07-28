# templates — 新規プロジェクト用の雛形

新しいブックマークレット・プロジェクトを追加するときは、ここから雛形をコピーして始めます。プロファイルの定義と命名規約はルートの [README.md](../README.md) を参照。

## どちらを使うか

- **`lite/`（軽量版）**: ブックマークレットだけ作る場合。ビルドなし・手動反映。
- **`full/`（フル版）**: ローカル版 UI・テスト・ビルドまで揃える場合。軽量版で始めて後からフル版に昇格する（フォルダを足す）のも可。

## 手順

1. `lite/` または `full/` をリポジトリ直下に新しいプロジェクト名でコピーする（例: `cp -r templates/lite my_new_tool`）。プロジェクト名はフォルダ名で表すので、ファイル名にプレフィックスは不要。
2. 対象ページのスナップショットを `fixtures/<ページ種別>/<世代>/<ページ名>.html` に保存し、[`fixtures/README.md`](../fixtures/README.md) の台帳に行を追加する（ページ種別が既存なら追加不要）。
3. コピーした雛形内の `TODO` を検索し、すべて書き換える。主な書き換え箇所:
   - `README.md` … タイトル・概要・フォルダ構成・対象ページ（fixtures への相対リンク）
   - **lite**: `src/bookmarklet/collector.js`（本体の実装）→ `collector.bookmarklet.js` へ手動で 1 行化
   - **full**: `package.json` の `name`・`description` ／ `scripts/build-bookmarklets.js` の `SOURCE_ORDER`・`TARGETS`・名前空間・エラーメッセージ（`TODO(template)` コメントの箇所）／ `src/local/` の UI ／ `examples/examples.js` のゴールデンケース ／ `tests/sample.test.js`
4. ルート `README.md` のプロジェクト一覧・フォルダ構成に 1 行追加する。
5. **full** の場合: `npm run build:bookmarklets` で生成物を作り、`npm test` が通ることを確認する。

## 雛形の構成

```
templates/
├── lite/
│   ├── README.md
│   ├── src/bookmarklet/
│   │   ├── collector.js               … 手編集ソースの骨組み
│   │   └── collector.bookmarklet.js   … 1 行版のプレースホルダ
│   └── archive/                       … ツール旧版の退避先（最初は空）
└── full/
    ├── README.md
    ├── package.json
    ├── scripts/build-bookmarklets.js  … 連結・1 行化・自己検証（書き換え箇所に TODO コメントあり）
    ├── src/
    │   ├── core/                      … DOM 非依存モジュール置き場（最初は空）
    │   ├── local/                     … ローカル版 UI の最小骨組み
    │   └── bookmarklet/common/        … ブックマークレットのソース置き場（最初は空）
    ├── tests/sample.test.js           … node --test の雛形（fixtures 不在時 skip のお手本つき）
    ├── examples/examples.js           … ゴールデンケースの UMD 骨組み
    └── docs/                          … 仕様書置き場（最初は空）
```

## ルール: 他プロジェクトに依存しない

**新しいプロジェクトは他のプロジェクトに依存させないこと。** 他プロジェクトのファイルを相対パスで
参照（`require('../other_project/...')`、ビルドの連結対象、`<script src>`）してはいけません。
既存プロジェクトの仕組みを使いたい場合は、**そのファイルを新プロジェクト内へコピー（取り込み）**し、
冒頭コメントに取り込み元と「一方を直したら他方も直すか判断すること」を明記して、
取り込み側でもテストを持たせてください。共有してよいのは `fixtures/` のデータと
この `templates/` の雛形だけです。詳細はルートの [README.md](../README.md#ルール-プロジェクト間の独立性) を参照。

補足: このリポジトリの外に単独プロジェクトとしてコピーする場合は、ルートの `.gitignore` も一緒にコピーし、fixtures を読むテストは skip される（または fixtures を同梱する）ことを確認してください。
