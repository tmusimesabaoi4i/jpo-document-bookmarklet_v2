/*!
 * JPO Term Marker v1 — 「前記XXXX」語句カラーマーキング
 * --------------------------------------------------------------
 * J-PlatPat / JPO 由来の特許文書 HTML（<pre> ベースの請求の範囲・明細書・手続補正書など）
 * 上で実行し、「前記固定ルート」「前記第１の他の通信装置」のような「前記XXXX」の XXXX を
 * 自動抽出して、語句ごとに異なる色でマーキングするブックマークレット。
 *
 * 編集用ソース: marker.js（このファイル。手編集する正本）
 * ブックマーク登録用: marker.bookmarklet.js
 *   → node term_marker/scripts/build-bookmarklet.js で生成（1 行版）
 *
 * 責務分離（節番号）:
 *   1 定数 / 2 パレット / 3 論理テキスト＋DOM位置マップ / 4 自動抽出（前記XXXX）
 *   5 一致範囲の算出と優先順位による重複排除 / 6 DOM への適用・解除
 *   7 出力 HTML / 8 状態ユーティリティ / 9 CORE 公開 / 10 UI（フローティングパネル）/ 11 main
 *
 * 設計上の要点:
 *   - innerHTML 置換は一切しない。Text Node だけを分割して <span data-jpo-marker> で包む。
 *   - 画面折返しの改行（\r \n）を除いた「論理テキスト」上で検索し、論理位置→(テキストノード, オフセット)
 *     の写像で元 DOM に戻す。改行や <u>…</u> の境界をまたぐ語句もマーキングできる。
 *   - 表の上から下を優先順位として範囲を確定し、既に確定した範囲と重なる候補は捨てる。
 *   - 再実行は「自分が付けた span だけを解除 → normalize → 再マーキング」なので何度でも安全。
 *   - 外部通信・外部ライブラリなし。eval / new Function も使わない。
 * --------------------------------------------------------------
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const NS = '__jpoTermMarker'; // window 上に置く唯一の名前空間

  /* ============================================================
   * 1. 定数
   * ============================================================ */
  const ATTR_MARK = 'data-jpo-marker';          // マーキング span
  const ATTR_TERM = 'data-jpo-term';            // span が属する行 id
  const ATTR_UI = 'data-jpo-marker-ui';         // パネルのホスト要素
  const ATTR_STYLE = 'data-jpo-marker-style';   // ページに注入する <style>
  const ATTR_LEGEND = 'data-jpo-marker-legend'; // 出力 HTML 冒頭の静的な対応表
  const ATTR_STATE = 'data-jpo-marker-state';   // 出力 HTML に埋め込む状態 JSON
  const MARK_CLASS = 'jpo-mk';
  const MAX_COLORS = 25;
  const IGNORE_CHARS = '\r\n';                  // 論理テキストから除外するレイアウト由来の文字
  const PREFIXES = ['前記'];                    // 抽出の起点。「該」「当該」などを足す場合はここ
  const MAX_TERM_LENGTH = 30;                   // これより長い候補は誤抽出とみなす

  /* マーキング対象外の要素 */
  const SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1,
    OPTION: 1, BUTTON: 1, IFRAME: 1, CANVAS: 1, SVG: 1, MATH: 1, HEAD: 1, TITLE: 1,
  };

  /* ============================================================
   * 2. パレット（25 色）
   *   白背景・黒文字で読みやすく、隣接色が似すぎないよう色相を大きく飛ばして並べている。
   *   前半 13 色は彩度高めの淡色、後半はさらに淡い色・グレー系で差を付ける。
   * ============================================================ */
  const PALETTE = [
    '#fff176', // 1  黄
    '#90caf9', // 2  青
    '#ef9a9a', // 3  赤
    '#a5d6a7', // 4  緑
    '#ce93d8', // 5  紫
    '#ffcc80', // 6  橙
    '#80deea', // 7  シアン
    '#f48fb1', // 8  ピンク
    '#e6ee9c', // 9  ライム
    '#9fa8da', // 10 藍
    '#ffab91', // 11 サーモン
    '#80cbc4', // 12 ティール
    '#b39ddb', // 13 薄紫
    '#ffe082', // 14 琥珀
    '#bbdefb', // 15 淡青
    '#bcaaa4', // 16 ブラウン
    '#c5e1a5', // 17 黄緑
    '#f8bbd0', // 18 淡ピンク
    '#b0bec5', // 19 ブルーグレー
    '#ffe0b2', // 20 淡橙
    '#b2ebf2', // 21 淡シアン
    '#e1bee7', // 22 淡紫
    '#dce775', // 23 濃ライム
    '#ffcdd2', // 24 淡赤
    '#c8e6c9', // 25 淡緑
  ];

  function parseHex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function toHex(rgb) {
    return '#' + rgb.map((c) => ('0' + Math.max(0, Math.min(255, Math.round(c))).toString(16)).slice(-2)).join('');
  }

  function normalizeColor(hex, fallback) {
    const rgb = parseHex(hex);
    return rgb ? toHex(rgb) : (fallback || PALETTE[0]);
  }

  /* 背景色から下線用の濃い色を作る */
  function accentColor(hex) {
    const rgb = parseHex(hex) || [200, 200, 200];
    return toHex(rgb.map((c) => c * 0.55));
  }

  /* ============================================================
   * 3. 論理テキスト＋DOM位置マップ
   * ============================================================ */
  function isSkippedElement(el) {
    const tag = el.tagName ? String(el.tagName).toUpperCase() : '';
    if (SKIP_TAGS[tag]) return true;
    if (typeof el.hasAttribute === 'function' && (el.hasAttribute(ATTR_UI) || el.hasAttribute(ATTR_LEGEND))) return true;
    return false;
  }

  /* root 配下のテキストノードを文書順に集める（除外要素の内側は見ない。再帰しない） */
  function collectTextNodes(root) {
    const out = [];
    if (!root) return out;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const type = node.nodeType;
      if (type === 3) { out.push(node); continue; }
      if (type !== 1 && type !== 9 && type !== 11) continue;
      if (type === 1 && isSkippedElement(node)) continue;
      const kids = node.childNodes;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }

  /*
   * 論理テキスト（改行を除いた連結文字列）と、論理位置 → (テキストノード index, ノード内オフセット)
   * の写像を作る。改行はテキストから消えるが DOM には残るので、元の表示は変わらない。
   */
  function buildTextMap(root, options) {
    const ignore = (options && typeof options.ignoreChars === 'string') ? options.ignoreChars : IGNORE_CHARS;
    const nodes = collectTextNodes(root);
    let total = 0;
    for (let i = 0; i < nodes.length; i++) total += nodes[i].nodeValue.length;
    const nodeIdx = new Int32Array(total);
    const offs = new Int32Array(total);
    const parts = [];
    let len = 0;
    for (let ni = 0; ni < nodes.length; ni++) {
      const s = nodes[ni].nodeValue;
      let runStart = -1;
      for (let i = 0; i < s.length; i++) {
        if (ignore.indexOf(s.charAt(i)) !== -1) {
          if (runStart !== -1) { parts.push(s.slice(runStart, i)); runStart = -1; }
          continue;
        }
        if (runStart === -1) runStart = i;
        nodeIdx[len] = ni;
        offs[len] = i;
        len++;
      }
      if (runStart !== -1) parts.push(s.slice(runStart));
    }
    return {
      text: parts.join(''),
      nodes,
      nodeIdx: nodeIdx.subarray(0, len),
      offs: offs.subarray(0, len),
      length: len,
    };
  }

  /* ============================================================
   * 4. 自動抽出（前記XXXX）
   *   形態素解析は使わず、文字種と少数の語彙表で「名詞句らしい部分」を推定する。
   *   完全一致を狙うのではなく「かなりの割合を当て、外れは表で直せる」ことが目標。
   *   独立した純関数なので、改善はこの節だけで完結する。
   * ============================================================ */

  /* 名詞句を構成しうる文字: 漢字・々〆・カタカナ（ー含む、・は含まない）・半角カナ・英数字（全角/半角）・ギリシャ文字 */
  const RE_NOUN_CHAR = /[一-鿿㐀-䶿々〆ァ-ヺー-ヾｦ-ﾟ０-９Ａ-Ｚａ-ｚ0-9A-Za-zΑ-Ωα-ω]/;
  const RE_HIRAGANA = /[ぁ-ゟ]/;

  /* 単独で文節を切る仮名（送り仮名として語句に含めない） */
  const PARTICLES = 'をにがはとへでもやかのねよぞわ';

  /* ここから始まる語は語句の終端とみなす（接続表現・接続助詞など） */
  const BOUNDARY_WORDS = [
    '及び', '並びに', '又は', '若しくは', '乃至', '或いは', 'あるいは', 'および', 'または',
    'から', 'まで', 'より', 'など', 'ごと', 'にて', 'として', 'について', 'における', 'において',
    'に対して', 'によって', 'に基づいて', 'であって', 'である', 'ではない', 'とともに', 'と共に',
  ];

  /* 直後が文節境界のとき語句に含めない接尾語（例: 固定ルート「内」の、自装置「宛」で、閾値「以上」で） */
  const SUFFIX_CHARS = '内外上下中間後前側宛毎際時用';
  const SUFFIX_WORDS = ['自体', '全体', '以外', '以上', '以下', '以内', '以降', '以前', '未満', '同士', '付近', '近傍', '周囲', '周辺', '直前', '直後', '相互', '同等'];
  /*
   * 上記の接尾語で終わるが独立した名詞として扱う 2 文字語（切らない）。
   * 特許文書では「筐体内」「反応炉内」「燃焼室内」「表面上」「設定時」のように、
   * 前の名詞＋接尾語の形が多いので、「体内」「炉内」「室内」「面上」「定時」のような
   * 「名詞の末尾＋接尾語」と衝突しやすい語はあえて載せていない。
   */
  const SUFFIX_EXCEPTIONS = new Set([
    '時間', '期間', '空間', '区間', '瞬間', '中間', '人間', '年間', '週間', '日間', '月間', '夜間', '昼間', '民間', '手間',
    '途中', '集中', '命中', '的中',
    '向上', '頂上', '地上', '海上', '路上', '机上', '卓上', '屋上', '頭上', '史上',
    '天下', '地下', '廊下', '靴下', '直下', '真下', '低下', '落下', '降下', '却下', '投下',
    '案内', '国内', '屋内', '家内', '社内', '圏内', '境内',
    '海外', '屋外', '郊外', '例外', '意外', '除外', '内外', '番外', '圏外', '対外',
    '前後', '直後', '最後', '午後', '背後', '事後', '今後', '以後', '食後', '産後', '戦後',
    '午前', '事前', '手前', '直前', '以前', '生前', '目前', '眼前', '面前', '人前', '駅前', '名前', '建前',
    '両側', '片側', '内側', '外側', '左側', '右側', '上側', '下側', '表側', '裏側', '前側', '後側', '北側', '南側', '東側', '西側',
    '実際', '国際', '交際', '学際',
    '日時', '当時', '同時', '臨時', '常時', '随時', '瞬時', '適時', '何時', '往時', '平時',
    '使用', '利用', '応用', '作用', '費用', '適用', '採用', '運用', '専用', '汎用', '兼用', '併用', '通用', '実用', '活用',
    '有用', '無用', '引用', '雇用', '代用', '借用', '効用', '器用', '薬用', '食用', '商用', '共用', '公用', '私用',
    '乗用', '常用', '慣用', '転用', '装用', '服用', '外用', '内用', '充用', '流用', '起用', '登用', '徴用', '不用', '多用',
    '宛先', '宛名',
  ]);

  /* 「Aの」の A が単独で語句にならない修飾語なら「AのB」を 1 語として連結する */
  const MODIFIER_WORDS = new Set(['他', '一方', '他方', '各', '各々', '複数', '一対', '一', '二', '単一', '所定', '任意', '上記', '当該', '該', '同', '別', '各種', '一連']);
  const RE_ORDINAL = /^第[0-9０-９〇一二三四五六七八九十百千]+$/;
  const RE_NUMBER = /^[0-9０-９〇一二三四五六七八九十百千]+$/;

  function isModifier(seg) {
    return RE_ORDINAL.test(seg) || RE_NUMBER.test(seg) || MODIFIER_WORDS.has(seg);
  }

  /* 送り仮名を含むが 1 語として扱う語（辞書にある語は丸ごと取り込む） */
  const OKURIGANA_WORDS = [
    '組み合わせ', '組み合せ', '組合せ', '取り付け', '取付け', '取り外し', '取り出し', '取り込み', '取り扱い', '取り決め',
    '受け入れ', '受け付け', '受け渡し', '受け取り', '立ち上がり', '立ち上げ', '立ち下がり', '切り替え', '切替え', '切り換え',
    '切り欠き', '問い合わせ', '貼り合わせ', '張り合わせ', '巻き取り', '巻き付け', '引き出し', '引き込み', '引き渡し',
    '押し出し', '押し込み', '押し付け', '読み出し', '読み取り', '書き込み', '呼び出し', '折り曲げ', '折り返し', '差し込み',
    '送り出し', '締め付け', '位置決め', '重ね合わせ', '突き当て', '突き合わせ', '打ち込み', '張り出し', '見積り', '見積もり',
    '嵌め込み', 'はめ込み', '埋め込み', '積み重ね', '塗り分け', '割り当て', '割り込み', '繰り返し', '繰返し', '乗り換え',
    '入れ替え', '入れ換え', '置き換え', '詰め替え', '積み込み', '吹き付け', '締め込み', '振り分け', '支払い', '申し込み',
    '仕上げ', '仕組み', '手続き', '手掛かり', '取っ手', '引っ掛け', '引っ張り', '組み立て', '組立て', '持ち上げ', '引き上げ',
  ];

  function startsWithAny(text, i, words) {
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (text.startsWith(w, i)) return w;
    }
    return '';
  }

  /* 位置 j が文節境界か（文字列末尾・名詞文字以外＝助詞/句読点/空白など） */
  function isBoundaryAt(text, j) {
    return j >= text.length || !RE_NOUN_CHAR.test(text.charAt(j));
  }

  /*
   * 「前記」直後（start）から名詞句らしい部分を読み取る。
   * 戻り値は語句（空文字なら候補なし）。
   */
  function scanTerm(text, start, prefixes) {
    const n = text.length;
    let i = start;
    if (text.charAt(i) === 'の') i++; // 「前記の〜」
    const segs = [];
    let cur = '';
    while (i < n) {
      const ch = text.charAt(i);
      if (startsWithAny(text, i, prefixes)) break;            // 前記受信完了通知の「前記」送信元アドレス
      if (startsWithAny(text, i, BOUNDARY_WORDS)) break;      // 送信元アドレス「及び」
      const ok = startsWithAny(text, i, OKURIGANA_WORDS);     // 「組み合わせ」などは丸ごと
      if (ok) { cur += ok; i += ok.length; continue; }
      if (ch === 'の') {
        segs.push(cur);
        cur = '';
        i++;
        if (i >= n || !RE_NOUN_CHAR.test(text.charAt(i)) || startsWithAny(text, i, prefixes)) break;
        continue;
      }
      if (cur.length > 0) {
        const sw = startsWithAny(text, i, SUFFIX_WORDS);
        if (sw && isBoundaryAt(text, i + sw.length)) break;   // 閾値「以上」で
        if (SUFFIX_CHARS.indexOf(ch) !== -1 && isBoundaryAt(text, i + 1) &&
            !SUFFIX_EXCEPTIONS.has(text.charAt(i - 1) + ch)) break; // 固定ルート「内」の / 自装置「宛」で
      }
      if (RE_NOUN_CHAR.test(ch)) { cur += ch; i++; continue; }
      /* 送り仮名: 単独の仮名で助詞ではなく、前後が名詞文字（例: 取「り」付け部） */
      if (RE_HIRAGANA.test(ch) && cur.length > 0 && PARTICLES.indexOf(ch) === -1 &&
          i + 1 < n && RE_NOUN_CHAR.test(text.charAt(i + 1))) {
        cur += ch; i++; continue;
      }
      break;
    }
    segs.push(cur);
    /* 「の」で分かれた区間を、左が修飾語（第１／他／複数…）の間だけ連結する */
    let term = segs[0];
    for (let k = 1; k < segs.length; k++) {
      if (!segs[k] || !isModifier(segs[k - 1])) break;
      term += 'の' + segs[k];
    }
    return term;
  }

  function acceptTerm(term) {
    if (!term) return false;
    if (term.length > MAX_TERM_LENGTH) return false;
    if (isModifier(term)) return false; // 「第１」「他」だけの候補は捨てる
    return true;
  }

  /*
   * 論理テキストから「前記XXXX」の XXXX を抽出する。
   * 戻り値: [{ term, count（前記付きの出現数）, first（初出位置）}] を初出順で。
   */
  function extractTerms(text, options) {
    const prefixes = (options && options.prefixes) || PREFIXES;
    const found = new Map();
    for (let k = 0; k < prefixes.length; k++) {
      const prefix = prefixes[k];
      let p = -1;
      while ((p = text.indexOf(prefix, p + 1)) !== -1) {
        const term = scanTerm(text, p + prefix.length, prefixes);
        if (!acceptTerm(term)) continue;
        const e = found.get(term);
        if (e) e.count++;
        else found.set(term, { term, count: 1, first: p });
      }
    }
    return Array.from(found.values()).sort((a, b) => a.first - b.first);
  }

  /* ============================================================
   * 5. 一致範囲の算出と優先順位による重複排除
   * ============================================================ */
  function normalizeTerm(term) {
    return String(term == null ? '' : term).replace(/[\r\n]/g, '').trim();
  }

  function hasPrefixBefore(text, pos, prefixes) {
    for (let k = 0; k < prefixes.length; k++) {
      const p = prefixes[k];
      if (pos >= p.length && text.substring(pos - p.length, pos) === p) return true;
    }
    return false;
  }

  /* term の出現開始位置一覧（同一語句同士は重ねない）。mode='prefixed' なら直前が「前記」の箇所だけ */
  function findTermMatches(text, term, mode, prefixes) {
    const out = [];
    if (!term) return out;
    const pre = prefixes || PREFIXES;
    let pos = 0;
    while ((pos = text.indexOf(term, pos)) !== -1) {
      if (mode !== 'prefixed' || hasPrefixBefore(text, pos, pre)) out.push(pos);
      pos += term.length;
    }
    return out;
  }

  /*
   * rows（表の上から順＝優先順位）に対して、重ならない最終範囲を決める。
   * 戻り値: { ranges: [{start,end,row}]（開始位置順）, stats: { [row.id]: { raw, applied } } }
   *   raw     … 論理テキスト中の出現数（無効行も数える）
   *   applied … 実際にマーキングされた数（上位の語句と重なった分は含まない）
   */
  function computeRanges(text, rows, options) {
    const mode = (options && options.mode) || 'all';
    const prefixes = (options && options.prefixes) || PREFIXES;
    const occupied = new Uint8Array(text.length);
    const ranges = [];
    const stats = {};
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const st = { raw: 0, applied: 0 };
      stats[row.id] = st;
      const term = normalizeTerm(row.term);
      if (!term) continue;
      const starts = findTermMatches(text, term, mode, prefixes);
      st.raw = starts.length;
      if (row.enabled === false) continue;
      for (let k = 0; k < starts.length; k++) {
        const s = starts[k];
        const e = s + term.length;
        let free = true;
        for (let i = s; i < e; i++) { if (occupied[i]) { free = false; break; } }
        if (!free) continue;
        for (let i = s; i < e; i++) occupied[i] = 1;
        ranges.push({ start: s, end: e, row: ri });
        st.applied++;
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    return { ranges, stats };
  }

  /* ============================================================
   * 6. DOM への適用・解除
   * ============================================================ */
  function markStyle(color, options) {
    const c = normalizeColor(color);
    let s = 'background-color:' + c + ';color:#000;';
    if (!options || options.underline !== false) s += 'border-bottom:2px solid ' + accentColor(c) + ';';
    return s;
  }

  /*
   * 論理範囲をテキストノードごとの区間に分解し、ノード単位で 1 回だけ分割・置換する。
   * 1 つの範囲が複数ノード（改行ノードや <u> の境界）にまたがる場合は複数の span になる。
   */
  function applyMarks(doc, map, ranges, rows, options) {
    const perNode = new Map();
    for (let r = 0; r < ranges.length; r++) {
      const range = ranges[r];
      let cur = null;
      for (let i = range.start; i < range.end; i++) {
        const ni = map.nodeIdx[i];
        const off = map.offs[i];
        if (cur && cur.node === ni) { cur.e = off + 1; continue; }
        cur = { node: ni, s: off, e: off + 1, row: range.row };
        let list = perNode.get(ni);
        if (!list) { list = []; perNode.set(ni, list); }
        list.push(cur);
      }
    }
    let spans = 0;
    perNode.forEach((segs, ni) => {
      const node = map.nodes[ni];
      const parent = node.parentNode;
      if (!parent) return;
      const value = node.nodeValue;
      const frag = doc.createDocumentFragment();
      let cursor = 0;
      for (let k = 0; k < segs.length; k++) {
        const seg = segs[k];
        if (seg.s > cursor) frag.appendChild(doc.createTextNode(value.slice(cursor, seg.s)));
        const row = rows[seg.row];
        const span = doc.createElement('span');
        span.setAttribute(ATTR_MARK, '1');
        span.setAttribute(ATTR_TERM, String(row.id));
        span.setAttribute('class', MARK_CLASS);
        span.setAttribute('style', markStyle(row.color, options));
        span.appendChild(doc.createTextNode(value.slice(seg.s, seg.e)));
        frag.appendChild(span);
        spans++;
        cursor = seg.e;
      }
      if (cursor < value.length) frag.appendChild(doc.createTextNode(value.slice(cursor)));
      parent.replaceChild(frag, node);
    });
    return spans;
  }

  /* このツールが付けた span だけを外し、テキストノードを元どおり結合する */
  function unmarkAll(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    const marks = Array.prototype.slice.call(root.querySelectorAll('[' + ATTR_MARK + ']'));
    const parents = new Set();
    let n = 0;
    for (let i = 0; i < marks.length; i++) {
      const span = marks[i];
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parents.add(parent);
      n++;
    }
    parents.forEach((p) => { if (typeof p.normalize === 'function') p.normalize(); });
    return n;
  }

  /* 既存 span のスタイルだけ更新（色変更・下線切替。構造は変えない） */
  function restyleMarks(root, rows, options) {
    const byId = {};
    for (let i = 0; i < rows.length; i++) byId[String(rows[i].id)] = rows[i];
    const marks = root.querySelectorAll('[' + ATTR_MARK + ']');
    for (let i = 0; i < marks.length; i++) {
      const row = byId[marks[i].getAttribute(ATTR_TERM)];
      if (row) marks[i].setAttribute('style', markStyle(row.color, options));
    }
  }

  function pageStyleText() {
    return '.' + MARK_CLASS + '{print-color-adjust:exact;-webkit-print-color-adjust:exact;}' +
      '@media print{[' + ATTR_UI + ']{display:none !important;}}';
  }

  function ensurePageStyle(doc) {
    if (doc.querySelector('style[' + ATTR_STYLE + ']')) return;
    const st = doc.createElement('style');
    st.setAttribute(ATTR_STYLE, '1');
    st.appendChild(doc.createTextNode(pageStyleText()));
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ============================================================
   * 7. 出力 HTML
   * ============================================================ */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatTimestamp(d) {
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  function formatDateTime(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* 元ファイル名_marked.html（取得できなければ jpo_marked_YYYYMMDD_HHMMSS.html） */
  function exportFileName(loc, now) {
    try {
      const path = decodeURIComponent(String((loc && loc.pathname) || ''));
      const base = path.split('/').pop();
      const m = /^(.+)\.(html?|xhtml)$/i.exec(base || '');
      if (m && m[1]) {
        const stem = m[1].replace(/_marked$/i, '');
        return stem + '_marked.html';
      }
    } catch (e) { /* decodeURIComponent 失敗など */ }
    return 'jpo_marked_' + formatTimestamp(now || new Date()) + '.html';
  }

  function serializeState(state) {
    const out = {
      version: VERSION,
      mode: state.mode,
      underline: state.underline !== false,
      rows: state.rows.map((r) => ({ id: r.id, term: r.term, color: r.color, enabled: r.enabled !== false })),
    };
    return JSON.stringify(out).replace(/</g, '\\u003c');
  }

  function sanitizeState(raw) {
    if (!raw || !Array.isArray(raw.rows)) return null;
    const rows = [];
    let nextId = 1;
    for (let i = 0; i < raw.rows.length; i++) {
      const r = raw.rows[i] || {};
      const term = normalizeTerm(r.term);
      const id = Number.isInteger(r.id) && r.id > 0 ? r.id : nextId;
      rows.push({ id, term, color: normalizeColor(r.color, PALETTE[i % PALETTE.length]), enabled: r.enabled !== false });
      nextId = Math.max(nextId, id + 1);
    }
    return {
      mode: raw.mode === 'prefixed' ? 'prefixed' : 'all',
      underline: raw.underline !== false,
      rows,
      nextId,
    };
  }

  function readEmbeddedState(doc) {
    const el = doc.querySelector('script[' + ATTR_STATE + ']');
    if (!el) return null;
    try { return sanitizeState(JSON.parse(el.textContent || '')); } catch (e) { return null; }
  }

  function removeAll(root, selector) {
    const list = Array.prototype.slice.call(root.querySelectorAll(selector));
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }

  function buildLegend(doc, state, stats, now) {
    const box = doc.createElement('div');
    box.setAttribute(ATTR_LEGEND, '1');
    box.setAttribute('style', 'font:13px/1.6 system-ui,-apple-system,"Segoe UI","Yu Gothic UI",Meiryo,sans-serif;color:#111;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;margin:8px;max-width:680px;white-space:normal;');
    const title = doc.createElement('div');
    title.setAttribute('style', 'font-weight:600;margin-bottom:6px;');
    title.appendChild(doc.createTextNode('Marker 語句と色の対応表'));
    const sub = doc.createElement('span');
    sub.setAttribute('style', 'font-weight:400;color:#64748b;font-size:12px;margin-left:8px;');
    sub.appendChild(doc.createTextNode('（一致: ' + (state.mode === 'prefixed' ? '前記付きのみ' : '全文一致') + ' / 生成: ' + formatDateTime(now) + '）'));
    title.appendChild(sub);
    box.appendChild(title);
    /* 語句は折り返すチップ形式（1 列の表より縦に短く、印刷でも 1 ページに収まりやすい） */
    const list = doc.createElement('div');
    list.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;');
    const rows = state.rows.filter((r) => r.enabled !== false && normalizeTerm(r.term));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const item = doc.createElement('span');
      item.setAttribute('style', 'white-space:nowrap;');
      const sw = doc.createElement('span');
      sw.setAttribute('class', MARK_CLASS);
      sw.setAttribute('style', markStyle(r.color, { underline: state.underline !== false }) + 'padding:0 4px;');
      sw.appendChild(doc.createTextNode(normalizeTerm(r.term)));
      item.appendChild(sw);
      const cnt = doc.createElement('span');
      cnt.setAttribute('style', 'color:#64748b;font-size:11px;margin-left:3px;');
      const st = stats && stats[r.id];
      cnt.appendChild(doc.createTextNode(st ? st.applied + '件' : ''));
      item.appendChild(cnt);
      list.appendChild(item);
    }
    box.appendChild(list);
    return box;
  }

  /*
   * 現在の文書（マーキング済み DOM）を、対応表と状態 JSON を付けて HTML 文字列にする。
   * 元本文の DOM は変更しない（複製に対してのみ手を入れる）。
   */
  function buildExportHtml(doc, state, stats, options) {
    const now = (options && options.now) || new Date();
    const root = doc.documentElement.cloneNode(true);
    removeAll(root, '[' + ATTR_UI + ']');
    removeAll(root, '[' + ATTR_LEGEND + ']');
    removeAll(root, 'script[' + ATTR_STATE + ']');

    let head = root.querySelector('head');
    if (!head) {
      head = doc.createElement('head');
      root.insertBefore(head, root.firstChild);
    }
    if (!head.querySelector('meta[charset]') && !head.querySelector('meta[http-equiv]')) {
      const meta = doc.createElement('meta');
      meta.setAttribute('charset', 'utf-8');
      head.insertBefore(meta, head.firstChild);
    }
    if (!head.querySelector('style[' + ATTR_STYLE + ']')) {
      const st = doc.createElement('style');
      st.setAttribute(ATTR_STYLE, '1');
      st.appendChild(doc.createTextNode(pageStyleText()));
      head.appendChild(st);
    }

    const body = root.querySelector('body') || root;
    body.insertBefore(buildLegend(doc, state, stats, now), body.firstChild);
    const script = doc.createElement('script');
    script.setAttribute('type', 'application/json');
    script.setAttribute(ATTR_STATE, '1');
    script.appendChild(doc.createTextNode(serializeState(state)));
    body.appendChild(script);

    const doctype = doc.doctype ? '<!DOCTYPE ' + doc.doctype.name + '>\n' : '';
    return doctype + root.outerHTML;
  }

  function downloadText(doc, filename, text) {
    const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.setAttribute(ATTR_UI, 'download');
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ============================================================
   * 8. 状態ユーティリティ（表の行）
   * ============================================================ */
  function sortRowsByLength(rows) {
    return rows.map((r, i) => ({ r, i }))
      .sort((a, b) => (normalizeTerm(b.r.term).length - normalizeTerm(a.r.term).length) || (a.i - b.i))
      .map((x) => x.r);
  }

  function assignColors(rows, palette) {
    const pal = palette || PALETTE;
    for (let i = 0; i < rows.length; i++) rows[i].color = pal[i % pal.length];
    return rows;
  }

  function nextFreeColor(rows, palette) {
    const pal = palette || PALETTE;
    const used = new Set(rows.map((r) => normalizeColor(r.color)));
    for (let i = 0; i < pal.length; i++) if (!used.has(pal[i])) return pal[i];
    return pal[rows.length % pal.length];
  }

  /* 抽出結果 → 表の行（初期状態は文字数の長い順。表の順序＝優先順位なので包含問題を初期状態から避ける） */
  function createRows(terms, startId) {
    let id = startId || 1;
    const rows = terms.map((t) => ({ id: id++, term: t.term, color: PALETTE[0], enabled: true }));
    const sorted = sortRowsByLength(rows);
    assignColors(sorted);
    return { rows: sorted, nextId: id };
  }

  /*
   * 包含関係の情報。各行について
   *   shadowedBy … 上位にある、この語句に含まれる短い語句（＝この語句の一部が上位の色になる: 要注意）
   *   contains   … この語句に含まれる他の語句（位置を問わない: 参考）
   *   duplicate  … 同じ語句が上位にある
   */
  function containmentInfo(rows) {
    const terms = rows.map((r) => (r.enabled === false ? '' : normalizeTerm(r.term)));
    return rows.map((row, i) => {
      const info = { shadowedBy: [], contains: [], duplicate: false };
      const t = terms[i];
      if (!t) return info;
      for (let j = 0; j < rows.length; j++) {
        if (j === i) continue;
        const u = terms[j];
        if (!u) continue;
        if (u === t) { if (j < i) info.duplicate = true; continue; }
        if (t.indexOf(u) !== -1) {
          info.contains.push(u);
          if (j < i) info.shadowedBy.push(u);
        }
      }
      return info;
    });
  }

  /* ============================================================
   * 9. CORE 公開（Node の自動テストからはここだけを使う）
   * ============================================================ */
  const CORE = {
    VERSION, PALETTE, PREFIXES, MAX_COLORS, IGNORE_CHARS,
    ATTR_MARK, ATTR_TERM, ATTR_UI, ATTR_STYLE, ATTR_LEGEND, ATTR_STATE, MARK_CLASS,
    accentColor, normalizeColor,
    collectTextNodes, buildTextMap,
    scanTerm, extractTerms, acceptTerm, isModifier,
    normalizeTerm, findTermMatches, computeRanges,
    markStyle, applyMarks, unmarkAll, restyleMarks, ensurePageStyle, pageStyleText,
    formatTimestamp, exportFileName, serializeState, sanitizeState, readEmbeddedState, buildExportHtml,
    sortRowsByLength, assignColors, nextFreeColor, createRows, containmentInfo,
  };

  /* ============================================================
   * 10. UI（右上フローティングパネル。Shadow DOM でページの CSS と相互に干渉しない）
   * ============================================================ */
  const PANEL_CSS = [
    ':host{all:initial;position:fixed;top:16px;right:16px;z-index:2147483000;',
    'font:13px/1.4 system-ui,-apple-system,"Segoe UI","Yu Gothic UI",Meiryo,sans-serif;color:#1f2937;}',
    '*{box-sizing:border-box;}',
    '.panel{display:flex;flex-direction:column;width:450px;min-width:340px;max-width:96vw;max-height:80vh;',
    'background:#fff;border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);overflow:hidden;resize:both;}',
    '.panel.min{resize:none;height:auto !important;}',
    '.hd{display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;background:#1f2937;color:#fff;cursor:move;user-select:none;flex:0 0 auto;}',
    '.hd .title{font-weight:600;font-size:14px;letter-spacing:.3px;}',
    '.hd .ver{opacity:.55;font-size:11px;margin-left:2px;}',
    '.hd .stat{margin-left:auto;font-size:11.5px;opacity:.85;white-space:nowrap;}',
    '.ib{width:26px;height:24px;border:0;border-radius:6px;background:transparent;color:#fff;font-size:15px;cursor:pointer;line-height:1;font-family:inherit;}',
    '.ib:hover{background:rgba(255,255,255,.18);}',
    '.body{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;}',
    '.tb{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid #e5e7eb;flex:0 0 auto;align-items:center;}',
    '.tb2{background:#f9fafb;}',
    '.b{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#111827;cursor:pointer;white-space:nowrap;}',
    '.b:hover{background:#f3f4f6;}',
    '.b.primary{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600;}',
    '.b.primary:hover{background:#1d4ed8;}',
    '.b.on{background:#e0e7ff;border-color:#a5b4fc;}',
    '.b.danger:hover{background:#fee2e2;border-color:#fca5a5;}',
    '.opts{display:flex;gap:14px;align-items:center;padding:6px 10px;font-size:12px;border-bottom:1px solid #e5e7eb;flex:0 0 auto;color:#374151;}',
    '.opts label{display:inline-flex;align-items:center;gap:4px;cursor:pointer;}',
    '.opts select{font:inherit;font-size:12px;padding:2px 4px;border-radius:4px;border:1px solid #d1d5db;background:#fff;}',
    '.wrap{overflow:auto;flex:1 1 auto;min-height:0;}',
    'table{border-collapse:collapse;width:100%;}',
    'td{padding:3px 3px;border-bottom:1px solid #f1f5f9;vertical-align:middle;white-space:nowrap;}',
    'tr.dragging{opacity:.4;}',
    'tr.over-top td{border-top:2px solid #2563eb;}',
    'tr.over-bottom td{border-bottom:2px solid #2563eb;}',
    '.c-drag{cursor:grab;color:#9ca3af;width:18px;text-align:center;font-size:12px;letter-spacing:-2px;}',
    '.c-term{width:100%;}',
    'input.term{width:100%;min-width:110px;font:inherit;font-size:13px;padding:3px 6px;border:1px solid #e5e7eb;border-radius:5px;background:#fff;color:#111827;}',
    'input.term:focus{outline:2px solid #93c5fd;border-color:#60a5fa;}',
    'tr.off input.term{color:#9ca3af;text-decoration:line-through;}',
    'input.en{width:14px;height:14px;cursor:pointer;margin:0;}',
    'input.col{width:28px;height:24px;padding:0;border:1px solid #d1d5db;border-radius:5px;background:none;cursor:pointer;}',
    'input.col::-webkit-color-swatch-wrapper{padding:2px;}',
    'input.col::-webkit-color-swatch{border:none;border-radius:3px;}',
    '.cnt{text-align:right;font-variant-numeric:tabular-nums;color:#374151;min-width:40px;font-size:12px;}',
    '.cnt.zero{color:#b45309;background:#fffbeb;}',
    '.cnt.pending{color:#6b7280;font-style:italic;}',
    '.cnt.off{color:#9ca3af;}',
    '.badge{font-size:10.5px;padding:1px 5px;border-radius:999px;background:#f3f4f6;color:#6b7280;cursor:help;}',
    '.badge.warn{background:#fef3c7;color:#b45309;}',
    '.badge.dup{background:#fee2e2;color:#b91c1c;}',
    '.mini{width:20px;height:20px;padding:0;border:1px solid transparent;border-radius:4px;background:transparent;cursor:pointer;color:#6b7280;font-size:12px;line-height:1;font-family:inherit;}',
    '.mini:hover{background:#f3f4f6;color:#111827;border-color:#e5e7eb;}',
    '.mini.del:hover{background:#fee2e2;color:#b91c1c;}',
    '.ft{padding:6px 10px;font-size:11.5px;color:#6b7280;border-top:1px solid #e5e7eb;flex:0 0 auto;display:flex;gap:8px;align-items:center;}',
    '.ft .msg{flex:1 1 auto;white-space:normal;}',
    '.empty{padding:18px 12px;color:#6b7280;font-size:12px;text-align:center;}',
    '.fab{display:none;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:#1f2937;color:#fff;font-weight:600;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28);border:0;font-family:inherit;}',
    '.fab .dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#fff176,#90caf9 50%,#ef9a9a);}',
    ':host(.closed) .panel{display:none;}',
    ':host(.closed) .fab{display:inline-flex;}',
    '.panel.min .body{display:none;}',
    '.hidden{display:none !important;}',
  ].join('');

  function createApp(win, doc) {
    const state = { mode: 'all', underline: true, rows: [], nextId: 1 };
    let stats = {};            // row.id → { raw, applied }（直近の実行時点）
    let lastMap = null;        // 直近の論理テキスト（入力中の件数表示に使う）
    let lastRun = { spans: 0, ms: 0 };
    let host = null;
    let shadow = null;
    const els = {};
    let tableVisible = true;
    let resetArmed = 0;
    let dragRowId = null;

    /* ---- 小さな DOM ヘルパ ---- */
    function h(tag, attrs) {
      const el = doc.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach((k) => {
          const v = attrs[k];
          if (v == null) return;
          if (k === 'class') el.className = v;
          else if (k === 'text') el.textContent = v;
          else if (k === 'checked') el.checked = !!v;
          else if (k === 'value') el.value = v;
          else el.setAttribute(k, v);
        });
      }
      for (let i = 2; i < arguments.length; i++) {
        const c = arguments[i];
        if (c == null) continue;
        el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
      }
      return el;
    }

    function btn(label, act, cls, title) {
      return h('button', { class: 'b' + (cls ? ' ' + cls : ''), 'data-act': act, type: 'button', title: title || null }, label);
    }

    function setMsg(text) {
      if (els.msg) els.msg.textContent = text;
    }

    function rowById(id) {
      for (let i = 0; i < state.rows.length; i++) if (String(state.rows[i].id) === String(id)) return state.rows[i];
      return null;
    }

    function rowIndex(id) {
      for (let i = 0; i < state.rows.length; i++) if (String(state.rows[i].id) === String(id)) return i;
      return -1;
    }

    function now() {
      return (win.performance && win.performance.now) ? win.performance.now() : Date.now();
    }

    /* ---- 中核操作 ---- */
    function run() {
      const t0 = now();
      unmarkAll(doc.body);
      const map = buildTextMap(doc.body);
      lastMap = map;
      const res = computeRanges(map.text, state.rows, { mode: state.mode });
      stats = res.stats;
      const spans = applyMarks(doc, map, res.ranges, state.rows, { underline: state.underline });
      lastRun = { spans, ranges: res.ranges.length, ms: Math.round((now() - t0) * 10) / 10 };
      render();
      const active = state.rows.filter((r) => r.enabled !== false && normalizeTerm(r.term)).length;
      setMsg(active + '語・' + res.ranges.length + '箇所をマーキングしました（' + lastRun.ms + 'ms）');
      return res;
    }

    function clearMarks() {
      const n = unmarkAll(doc.body);
      lastRun = { spans: 0, ranges: 0, ms: 0 };
      stats = {};
      render();
      setMsg('マーキングを解除しました（' + n + '箇所。表の設定は保持）');
    }

    /* merge=true: 既存行を維持し、未登録の候補だけ末尾に追加 */
    function autoExtract(merge) {
      const map = buildTextMap(doc.body);
      lastMap = map;
      const terms = extractTerms(map.text);
      if (!merge) {
        const made = createRows(terms, 1);
        state.rows = made.rows;
        state.nextId = made.nextId;
        run();
        setMsg('初期化して ' + state.rows.length + ' 語を再抽出しました');
        return;
      }
      const existing = new Set(state.rows.map((r) => normalizeTerm(r.term)));
      let added = 0;
      for (let i = 0; i < terms.length; i++) {
        if (existing.has(terms[i].term)) continue;
        state.rows.push({ id: state.nextId++, term: terms[i].term, color: nextFreeColor(state.rows), enabled: true });
        existing.add(terms[i].term);
        added++;
      }
      render();
      setMsg(added ? added + ' 語を追加しました（既存 ' + (state.rows.length - added) + ' 語は維持）。「実行」で反映します' : '未登録の候補はありませんでした');
    }

    function addRow() {
      const row = { id: state.nextId++, term: '', color: nextFreeColor(state.rows), enabled: true };
      state.rows.push(row);
      render();
      const input = shadow.querySelector('tr[data-id="' + row.id + '"] input.term');
      if (input) input.focus();
      setMsg('語句を入力して「実行」を押してください');
    }

    function deleteRow(id) {
      const i = rowIndex(id);
      if (i === -1) return;
      state.rows.splice(i, 1);
      render();
      setMsg('行を削除しました。「実行」で反映します');
    }

    function moveRow(id, delta) {
      const i = rowIndex(id);
      const j = i + delta;
      if (i === -1 || j < 0 || j >= state.rows.length) return;
      const tmp = state.rows[i];
      state.rows[i] = state.rows[j];
      state.rows[j] = tmp;
      render();
    }

    function moveRowTo(id, targetIndex) {
      const i = rowIndex(id);
      if (i === -1) return;
      const row = state.rows.splice(i, 1)[0];
      if (targetIndex > i) targetIndex--;
      state.rows.splice(Math.max(0, Math.min(state.rows.length, targetIndex)), 0, row);
      render();
    }

    function sortByLength() {
      state.rows = sortRowsByLength(state.rows);
      render();
      setMsg('文字数の長い順に並べ替えました。「実行」で反映します');
    }

    function recolor() {
      assignColors(state.rows);
      restyleMarks(doc.body, state.rows, { underline: state.underline });
      render();
      setMsg('上から順にパレット ' + PALETTE.length + ' 色を再割当てしました');
    }

    function doExport() {
      const name = exportFileName(win.location, new Date());
      const html = buildExportHtml(doc, state, stats, { now: new Date() });
      downloadText(doc, name, html);
      setMsg('HTML を出力しました: ' + name);
    }

    function doPrint() {
      setMsg('印刷ダイアログを開きます（パネルは印刷されません）');
      setTimeout(() => { win.print(); }, 50);
    }

    /* ---- 表示制御 ---- */
    function show() {
      if (!host) return;
      if (!doc.body.contains(host)) doc.body.appendChild(host);
      host.classList.remove('closed');
    }

    function hide() {
      if (!host) return;
      host.classList.add('closed');
      host.style.left = '';
      host.style.top = '';
      host.style.right = '';
    }

    function toggleMin() {
      els.panel.classList.toggle('min');
      els.minBtn.textContent = els.panel.classList.contains('min') ? '□' : '－';
    }

    function toggleTable() {
      tableVisible = !tableVisible;
      [els.tb2, els.opts, els.wrap].forEach((el) => el.classList.toggle('hidden', !tableVisible));
      els.tableBtn.classList.toggle('on', tableVisible);
    }

    /* ---- 描画 ---- */
    function countCell(td, row) {
      const st = stats[row.id];
      td.className = 'cnt';
      if (!normalizeTerm(row.term)) { td.textContent = ''; return; }
      if (!st) { td.textContent = '－'; td.title = '未実行'; return; }
      if (row.enabled === false) { td.textContent = st.raw + '件'; td.classList.add('off'); td.title = '無効（有効にすると ' + st.raw + ' 件）'; return; }
      td.textContent = st.applied + '件';
      if (st.applied === 0) td.classList.add('zero');
      td.title = st.raw !== st.applied ? '出現 ' + st.raw + ' 件のうち ' + st.applied + ' 件をマーキング（残りは上位の語句と重複）' : '出現 ' + st.raw + ' 件';
    }

    function badgeFor(info) {
      if (!info) return null;
      if (info.duplicate) return h('span', { class: 'badge dup', title: '同じ語句が上位にあります（この行は無視されます）' }, '重複');
      if (info.shadowedBy.length) {
        return h('span', { class: 'badge warn', title: '上位の「' + info.shadowedBy.join('」「') + '」がこの語句に含まれるため、一部が上位の色になります。「文字数↓」で解決できます' }, '⚠包含');
      }
      if (info.contains.length) {
        return h('span', { class: 'badge', title: '「' + info.contains.join('」「') + '」を含みます（この行が上位なので問題ありません）' }, '包含');
      }
      return null;
    }

    function renderRows() {
      const tbody = els.tbody;
      tbody.textContent = '';
      els.empty.classList.toggle('hidden', state.rows.length > 0);
      const info = containmentInfo(state.rows);
      state.rows.forEach((row, idx) => {
        const tr = h('tr', { 'data-id': String(row.id), draggable: 'true', class: row.enabled === false ? 'off' : '' });
        tr.appendChild(h('td', { class: 'c-drag', title: 'ドラッグで並べ替え（表の順序＝優先順位）' }, '⋮⋮'));
        tr.appendChild(h('td', null, h('input', { type: 'checkbox', class: 'en', checked: row.enabled !== false, title: '有効／無効' })));
        tr.appendChild(h('td', null, h('input', { type: 'color', class: 'col', value: normalizeColor(row.color), title: '色を変更' })));
        tr.appendChild(h('td', { class: 'c-term' }, h('input', { type: 'text', class: 'term', value: row.term, placeholder: '語句を入力', spellcheck: 'false', autocomplete: 'off' })));
        const cnt = h('td');
        countCell(cnt, row);
        tr.appendChild(cnt);
        tr.appendChild(h('td', { class: 'c-badge' }, badgeFor(info[idx])));
        tr.appendChild(h('td', { class: 'c-mv' },
          h('button', { class: 'mini', 'data-act': 'up', type: 'button', title: '上へ（優先度を上げる）' }, '↑'),
          h('button', { class: 'mini', 'data-act': 'down', type: 'button', title: '下へ' }, '↓')));
        tr.appendChild(h('td', null, h('button', { class: 'mini del', 'data-act': 'del', type: 'button', title: '削除' }, '×')));
        tbody.appendChild(tr);
      });
    }

    function render() {
      if (!shadow) return;
      renderRows();
      const active = state.rows.filter((r) => r.enabled !== false && normalizeTerm(r.term)).length;
      els.stat.textContent = active + '語 / ' + (lastRun.ranges || 0) + '箇所';
      els.mode.value = state.mode;
      els.underline.checked = state.underline !== false;
      if (state.rows.length > MAX_COLORS) {
        els.note.textContent = '※ ' + MAX_COLORS + ' 語を超えたため色が重複します';
      } else {
        els.note.textContent = '';
      }
    }

    /* 入力中の語句の件数を（直近の論理テキストで）仮表示する */
    function livePreviewCount(tr, row) {
      const td = tr.querySelector('td.cnt');
      if (!td || !lastMap) return;
      const term = normalizeTerm(row.term);
      td.className = 'cnt pending';
      td.textContent = term ? findTermMatches(lastMap.text, term, state.mode).length + '件*' : '';
      td.title = '未確定（「実行」で反映）';
    }

    /* ---- イベント ---- */
    function onClick(e) {
      const target = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!target) return;
      const act = target.getAttribute('data-act');
      const tr = target.closest('tr[data-id]');
      const id = tr ? tr.getAttribute('data-id') : null;
      if (act !== 'reset' && resetArmed) { resetArmed = 0; els.resetBtn.textContent = '初期化して再抽出'; }
      switch (act) {
        case 'close': hide(); break;
        case 'min': toggleMin(); break;
        case 'table': toggleTable(); break;
        case 'extract': autoExtract(true); break;
        case 'print': doPrint(); break;
        case 'export': doExport(); break;
        case 'run': run(); break;
        case 'add': addRow(); break;
        case 'sortlen': sortByLength(); break;
        case 'recolor': recolor(); break;
        case 'clear': clearMarks(); break;
        case 'reset':
          if (Date.now() - resetArmed < 4000) { resetArmed = 0; els.resetBtn.textContent = '初期化して再抽出'; autoExtract(false); }
          else { resetArmed = Date.now(); els.resetBtn.textContent = 'もう一度押すと初期化'; setMsg('表を破棄して再抽出します。よければもう一度「初期化」を押してください'); setTimeout(() => { if (resetArmed) { resetArmed = 0; els.resetBtn.textContent = '初期化して再抽出'; } }, 4000); }
          break;
        case 'up': moveRow(id, -1); break;
        case 'down': moveRow(id, 1); break;
        case 'del': deleteRow(id); break;
        case 'fab': show(); break;
        default: break;
      }
    }

    function onInput(e) {
      const t = e.target;
      const tr = t.closest ? t.closest('tr[data-id]') : null;
      if (tr && t.classList.contains('term')) {
        const row = rowById(tr.getAttribute('data-id'));
        if (row) { row.term = t.value; livePreviewCount(tr, row); }
      } else if (tr && t.classList.contains('col')) {
        const row = rowById(tr.getAttribute('data-id'));
        if (row) { row.color = normalizeColor(t.value, row.color); restyleMarks(doc.body, state.rows, { underline: state.underline }); }
      }
    }

    function onChange(e) {
      const t = e.target;
      const tr = t.closest ? t.closest('tr[data-id]') : null;
      if (tr && t.classList.contains('en')) {
        const row = rowById(tr.getAttribute('data-id'));
        if (row) { row.enabled = t.checked; tr.classList.toggle('off', !t.checked); setMsg('「実行」で反映します'); }
      } else if (t === els.mode) {
        state.mode = t.value === 'prefixed' ? 'prefixed' : 'all';
        setMsg('一致方法を変更しました。「実行」で反映します');
      } else if (t === els.underline) {
        state.underline = t.checked;
        restyleMarks(doc.body, state.rows, { underline: state.underline });
      }
    }

    function onKeydown(e) {
      if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('term')) {
        e.preventDefault();
        run();
      } else if (e.key === 'Escape') {
        hide();
      }
    }

    /* 行のドラッグ並べ替え */
    function clearDropMarks() {
      const list = els.tbody.querySelectorAll('tr.over-top, tr.over-bottom');
      for (let i = 0; i < list.length; i++) list[i].classList.remove('over-top', 'over-bottom');
    }

    function onDragStart(e) {
      const tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
      if (!tr) return;
      dragRowId = tr.getAttribute('data-id');
      tr.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', dragRowId); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* noop */ }
    }

    function onDragOver(e) {
      if (dragRowId == null) return;
      const tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
      if (!tr) return;
      e.preventDefault();
      clearDropMarks();
      const rect = tr.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      tr.classList.add(before ? 'over-top' : 'over-bottom');
    }

    function onDrop(e) {
      if (dragRowId == null) return;
      const tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
      if (!tr) return;
      e.preventDefault();
      const rect = tr.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      const targetIndex = rowIndex(tr.getAttribute('data-id')) + (before ? 0 : 1);
      const id = dragRowId;
      dragRowId = null;
      moveRowTo(id, targetIndex);
      setMsg('並べ替えました。「実行」で反映します');
    }

    function onDragEnd() {
      dragRowId = null;
      clearDropMarks();
      const list = els.tbody.querySelectorAll('tr.dragging');
      for (let i = 0; i < list.length; i++) list[i].classList.remove('dragging');
    }

    /* パネルのドラッグ移動（ヘッダをつかむ） */
    function onHeaderPointerDown(e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
      const rect = host.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const move = (ev) => {
        /* パネル全体が画面内に収まる範囲で動かす（画面より大きいときはヘッダだけは残す） */
        const maxX = Math.max(0, win.innerWidth - rect.width);
        const maxY = Math.max(0, win.innerHeight - Math.min(rect.height, win.innerHeight - 36));
        const x = Math.max(0, Math.min(maxX, ev.clientX - dx));
        const y = Math.max(0, Math.min(maxY, ev.clientY - dy));
        host.style.left = x + 'px';
        host.style.top = y + 'px';
        host.style.right = 'auto';
      };
      const up = () => {
        doc.removeEventListener('pointermove', move, true);
        doc.removeEventListener('pointerup', up, true);
      };
      doc.addEventListener('pointermove', move, true);
      doc.addEventListener('pointerup', up, true);
      e.preventDefault();
    }

    /* ---- パネル構築 ---- */
    function buildPanel() {
      host = doc.createElement('div');
      host.setAttribute(ATTR_UI, 'panel');
      shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

      const style = doc.createElement('style');
      style.textContent = PANEL_CSS;
      shadow.appendChild(style);

      els.stat = h('span', { class: 'stat' });
      els.minBtn = h('button', { class: 'ib', 'data-act': 'min', type: 'button', title: '最小化' }, '－');
      const hd = h('div', { class: 'hd' },
        h('span', { class: 'title' }, 'Marker'),
        h('span', { class: 'ver' }, 'v' + VERSION),
        els.stat,
        els.minBtn,
        h('button', { class: 'ib', 'data-act': 'close', type: 'button', title: '閉じる（マーキングは残ります）' }, '×'));
      hd.addEventListener('pointerdown', onHeaderPointerDown);

      els.tableBtn = btn('表', 'table', 'on', '語句と色の対応表の表示／非表示');
      const tb1 = h('div', { class: 'tb' },
        els.tableBtn,
        btn('自動抽出', 'extract', '', '現在のページから「前記XXXX」を再解析し、未登録の語句だけ追加'),
        btn('印刷', 'print', '', 'ブラウザの印刷画面を開く（パネルは印刷しない）'),
        btn('出力', 'export', '', 'マーキング済み HTML をダウンロード'),
        btn('実行', 'run', 'primary', '現在の表でマーキングを再生成'));

      els.resetBtn = btn('初期化して再抽出', 'reset', 'danger', '表を破棄して抽出し直す（2 回押しで実行）');
      els.tb2 = h('div', { class: 'tb tb2' },
        btn('＋追加', 'add', '', '空行を追加'),
        btn('文字数↓', 'sortlen', '', '長い語句から順に並べ替え（包含問題の回避）'),
        btn('色を再割当て', 'recolor', '', '上から順にパレットを再配置'),
        btn('全解除', 'clear', '', 'マーキングだけ解除（表は残す）'),
        els.resetBtn);

      els.mode = h('select', { 'data-opt': 'mode' },
        h('option', { value: 'all' }, '全文一致'),
        h('option', { value: 'prefixed' }, '「前記」付きのみ'));
      els.underline = h('input', { type: 'checkbox', 'data-opt': 'underline' });
      els.note = h('span', { class: 'note' });
      els.opts = h('div', { class: 'opts' },
        h('label', null, '一致: ', els.mode),
        h('label', null, els.underline, '下線'),
        els.note);

      els.tbody = h('tbody');
      els.empty = h('div', { class: 'empty hidden' }, '「前記〜」の語句が見つかりませんでした。「＋追加」で語句を登録できます。');
      els.wrap = h('div', { class: 'wrap' }, h('table', null, els.tbody), els.empty);

      els.msg = h('span', { class: 'msg' });
      const ft = h('div', { class: 'ft' }, els.msg);

      const body = h('div', { class: 'body' }, tb1, els.tb2, els.opts, els.wrap, ft);
      els.panel = h('div', { class: 'panel' }, hd, body);
      shadow.appendChild(els.panel);

      const fab = h('button', { class: 'fab', 'data-act': 'fab', type: 'button', title: 'Marker パネルを再表示' }, h('span', { class: 'dot' }), 'Marker');
      shadow.appendChild(fab);

      shadow.addEventListener('click', onClick);
      shadow.addEventListener('input', onInput);
      shadow.addEventListener('change', onChange);
      shadow.addEventListener('keydown', onKeydown);
      els.tbody.addEventListener('dragstart', onDragStart);
      els.tbody.addEventListener('dragover', onDragOver);
      els.tbody.addEventListener('drop', onDrop);
      els.tbody.addEventListener('dragend', onDragEnd);

      doc.body.appendChild(host);
    }

    function init() {
      ensurePageStyle(doc);
      const embedded = readEmbeddedState(doc);
      if (embedded) {
        state.mode = embedded.mode;
        state.underline = embedded.underline;
        state.rows = embedded.rows;
        state.nextId = embedded.nextId;
      } else {
        const map = buildTextMap(doc.body);
        const made = createRows(extractTerms(map.text), 1);
        state.rows = made.rows;
        state.nextId = made.nextId;
      }
      buildPanel();
      run();
      if (embedded) setMsg('出力 HTML に保存された対応表を読み込みました');
      else if (!state.rows.length) setMsg('「前記〜」の語句が見つかりませんでした');
      else setMsg(state.rows.length + ' 語を自動抽出し、' + (lastRun.ranges || 0) + ' 箇所をマーキングしました（' + lastRun.ms + 'ms）');
    }

    const api = {
      version: VERSION,
      show, hide, run, clearMarks,
      extract: autoExtract,
      getState: () => JSON.parse(serializeState(state)),
      setState: (raw) => {
        const st = sanitizeState(raw);
        if (!st) return false;
        state.mode = st.mode; state.underline = st.underline; state.rows = st.rows; state.nextId = st.nextId;
        render();
        return true;
      },
      getStats: () => JSON.parse(JSON.stringify(stats)),
      exportHtml: () => buildExportHtml(doc, state, stats, { now: new Date() }),
      exportFileName: () => exportFileName(win.location, new Date()),
      core: CORE,
    };

    return { init, api };
  }

  /* ============================================================
   * 11. main / エクスポート
   * ============================================================ */
  function main() {
    const win = window;
    const doc = document;
    if (win[NS] && typeof win[NS].show === 'function') {
      win[NS].show(); // 二重起動: 既存パネルを表示するだけ
      return;
    }
    const app = createApp(win, doc);
    win[NS] = app.api;
    try {
      app.init();
    } catch (e) {
      delete win[NS];
      throw e;
    }
  }

  if (typeof module === 'object' && module !== null && typeof module.exports === 'object') {
    /* Node（自動テスト）からは CORE だけを読む。UI は起動しない */
    module.exports = CORE;
  } else if (typeof window !== 'undefined' && window.document) {
    main();
  }
})();
