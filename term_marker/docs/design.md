# term_marker 設計メモ

`src/bookmarklet/marker.js` の内部設計。節番号はソース中のコメントと対応する。

## 全体の流れ（「実行」1 回分）

```
unmarkAll(body)                 … 6. 自分が付けた span だけ外して normalize
map = buildTextMap(body)        … 3. 論理テキスト + 位置マップ
res = computeRanges(map.text, rows, {mode})   … 5. 一致範囲の算出と優先順位による重複排除
applyMarks(doc, map, res.ranges, rows, {underline})  … 6. ノード単位でまとめて DOM へ適用
render()                        … 10. 表の件数・警告を更新
```

DOM を読むのは `buildTextMap` の 1 回、書くのは `unmarkAll` と `applyMarks` の 2 回だけ。
語句ごとに DOM を走査することはない（25 語 × 数十万文字でも文字列処理と 1 回の DOM 書換えで済む）。

## 3. 論理テキスト＋位置マップ

JPO の文書 HTML は `<pre>` の中で画面折返し位置に `\n` が入っているため、「通信装置」が `通\n信装置` に、
「前記」が `前\n記` に分かれていることがある。さらに補正箇所は `<u>…</u>\n<u>…</u>` のように要素の境界
＋改行で分かれる（fixture では `第１通</u>\n<u>信装置`）。

`buildTextMap(root)`:

1. `collectTextNodes(root)` — 明示スタックで `root` 配下を文書順に走査し、テキストノードを集める。
   `SKIP_TAGS`（script / style / textarea / input / select / button / iframe / svg / head …）と、
   本ツールの UI（`[data-jpo-marker-ui]`）・出力用対応表（`[data-jpo-marker-legend]`）の内側は見ない。
2. 各ノードの文字を順に見て、`IGNORE_CHARS`（`\r` `\n`）以外を論理テキストに積む。
   同時に `nodeIdx[i]`（ノード index）と `offs[i]`（ノード内オフセット）を `Int32Array` に記録する。

これで「論理位置 → 元 DOM の位置」が O(1) で引ける。改行は論理テキストから消えるだけで DOM には残る。

## 4. 自動抽出（前記XXXX）

`extractTerms(text)` は各「前記」（`PREFIXES`）の直後から `scanTerm` で名詞句を読み、受理判定
（`acceptTerm`）を通ったものを初出順に返す（`{term, count, first}`）。形態素解析は使わない。

`scanTerm` の 1 文字ごとの判定（上から順）:

| 条件 | 動作 | 例 |
|---|---|---|
| 先頭が「の」 | 読み飛ばす | 前記**の**通信装置 → 通信装置 |
| 別の「前記」 | 終了 | 前記受信完了通知の**前記**送信元アドレス → 受信完了通知 |
| `BOUNDARY_WORDS`（及び／並びに／又は／若しくは／から／まで／より／に対して／によって／に基づいて／である…） | 終了 | 前記送信元アドレス**及び** → 送信元アドレス |
| `OKURIGANA_WORDS`（組み合わせ／取り付け／読み出し…） | 丸ごと取り込む | 前記**取り付け**部材 → 取り付け部材 |
| 「の」 | 区切りを記録して続行。直後が名詞文字でなければ終了 | 後述 |
| `SUFFIX_WORDS`（自体／以上／以下／未満／近傍…）＋直後が境界 | 終了 | 前記閾値**以上**で → 閾値 |
| `SUFFIX_CHARS`（内外上下中間後前側宛毎際時用）＋直後が境界＋`SUFFIX_EXCEPTIONS` に無い | 終了 | 前記固定ルート**内**の → 固定ルート、前記自装置**宛**で → 自装置。例外: 時間／内側／使用 … |
| 名詞文字（漢字・々・カタカナ・ー・半角カナ・全角/半角英数・ギリシャ文字） | 取り込む | |
| 単独のひらがな（助詞 `をにがはとへでもやかの…` 以外）で前後が名詞文字 | 送り仮名として取り込む | 前記締**め**付け部 |
| それ以外 | 終了 | |

「の」で分かれた区間は、**左の区間が修飾語のときだけ**連結する（`isModifier`: 第N／数字／他／一方／他方／
各／複数／一対／所定／任意／当該…）。

- 前記**第１**の**他**の通信装置 → 第１の他の通信装置（第１・他は修飾語）
- 前記**他**の通信データの通信経路の送信先側 → 他の通信データ（通信データは修飾語ではないので止まる）
- 前記受信完了通知の受信に基づいて → 受信完了通知

受理判定: 空でない、30 文字以下、修飾語だけ（「第１」「他」）ではない。

意図的に単純化している点:

- 「AのB」の A が修飾語でない場合は常に A で切る（出現頻度による連結は行わない。予測しやすさを優先）。
- 1 文字の語（前記軸 → 軸）も受理する。全文一致では広く当たるので、不要なら表で消す。
- 起点語は `PREFIXES = ['前記']` のみ。「該」「当該」を足す場合はここに追加する（テストあり）。

## 5. 一致範囲の算出と重複排除

`computeRanges(text, rows, {mode})`:

1. `occupied = new Uint8Array(text.length)` を用意する。
2. 表の上から順に、`findTermMatches` で語句の出現開始位置を列挙する（`indexOf` の繰り返し。
   同じ語句同士は重ねない。`mode='prefixed'` なら直前が「前記」の位置だけ）。
3. 各候補について `occupied[start..end)` が全部空いていれば採用し、埋める。埋まっていれば捨てる。
4. 採用した範囲を開始位置順に並べて返す。行ごとの `raw`（出現数）と `applied`（採用数）も返す。

「文字数↓」で長い語句を上に置けば、`第１通信装置` の内部の `通信装置` は 3. で捨てられる。
無効行（`enabled: false`）は `raw` だけ数えて採用しない。

## 6. DOM への適用・解除

`applyMarks`:

1. 各範囲の論理位置を 1 文字ずつ `nodeIdx` で見て、同じノードの連続区間にまとめる（範囲がノードをまたぐと
   複数区間になる。区間には同一ノード内の改行が含まれうる）。
2. ノードごとに区間を集め、`DocumentFragment` に「地のテキスト／span／地のテキスト…」を組み立て、
   `parent.replaceChild(frag, node)` で 1 回だけ差し替える。
3. span には `data-jpo-marker="1"`、`data-jpo-term="<行 id>"`、`class="jpo-mk"`、
   `style="background-color:…;color:#000;border-bottom:2px solid …"` を付ける（インラインなので出力 HTML でも
   そのまま色が残る）。

`unmarkAll`: `[data-jpo-marker]` を全部集め、子（テキスト）を親に戻して span を除去し、影響を受けた親だけ
`normalize()` する。ブラウザは HTML 解析時に隣接テキストノードを作らないので、これで元の構造に戻る
（テストで「マーキング → 解除」後の `outerHTML` が元と完全一致することを確認）。

## 7. 出力 HTML

`buildExportHtml(doc, state, stats)`:

- `documentElement.cloneNode(true)` に対してのみ手を入れる（元 DOM は変更しない）。
- 複製から `[data-jpo-marker-ui]`（パネル）・古い対応表・古い状態 JSON を除去。
- `<head>` に `<meta charset="utf-8">` と `<style data-jpo-marker-style>` が無ければ足す。
- `<body>` 先頭に静的な対応表（`[data-jpo-marker-legend]`。語句を自身の色で表示＋件数。折り返すチップ形式）、
  末尾に `<script type="application/json" data-jpo-marker-state>`（`<` は `<` にエスケープ）を置く。
- 元文書に doctype が無ければ足さない（表示モードを変えないため）。
- ブックマークレット起動時に状態 JSON があれば表をそこから復元する（`readEmbeddedState`）。対応表は
  マーキング対象外なので、出力 HTML 上で再実行しても二重に色が付かない。

## 10. UI

- ホスト要素 `div[data-jpo-marker-ui="panel"]` を `body` に 1 つだけ追加し、その Shadow DOM にパネルを作る。
  `:host{all:initial;position:fixed;…}` でページの CSS を受けず、パネルの CSS もページに漏れない。
- 表の行は DOM API で組み立て、語句は `input.value` に入れる（`innerHTML` にユーザー文字列を流し込まない）。
- ドラッグ移動（ヘッダ）・最小化・`resize: both` によるサイズ変更・行のドラッグ並べ替え・↑↓・Enter で実行・
  Escape で閉じる。閉じると位置を右上に戻し、「Marker」ボタンだけ残す。
- 逐次 DOM 書換えはしない。色と下線の変更だけは既存 span の `style` を書き換えて即時反映する（構造は変えない）。

## 11. 二重起動

`window.__jpoTermMarker` があれば `show()` を呼ぶだけ。無ければ `createApp` → `init()`（抽出 → 実行 → パネル）。
グローバルはこの 1 つだけ。

## パレット

Material Design の 100〜300 系から 25 色を選び、色相が大きく飛ぶ順に並べた。
`tests/palette.test.js` で「黒文字のコントラスト比 ≥ 7:1」「隣接色の ΔE76 ≥ 20」「全ペア ΔE76 ≥ 9」を固定している。
下線色は背景色を 0.55 倍した同系の暗色（`accentColor`）。
