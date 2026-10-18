/*
 * このファイルは自動生成です — 直接編集しないでください (DO NOT EDIT)。
 * 生成元: src/core/*.js + src/extract/*.js + src/view/*.js + src/bookmarklet/common/launcher-app.js
 * 再生成: npm run build:bookmarklets
 */
(function () {
var module, exports; /* ページ側の偶発的な window.module による UMD 誤分岐を遮断 */
try {
/*
 * settings.js — 重みとしきい値の一元管理（DOM 非依存）
 *
 * 類似度の重み・グループ化のしきい値・段落対応のしきい値は、すべてここにある。
 * 調整するときは他のファイルを触らない。
 *
 * ここに置いてよいのは **案件に依存しない数値だけ**。特定の請求項番号・技術用語・
 * カテゴリー名・期待するグループ構成は書かない（辞書も持たない）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.settings = factory();
  }
})(globalThis, function () {
  'use strict';

  /*
   * 請求項どうしの類似度の重み（合計 1.0）。
   * 配分の考え方:
   *   文字3-gram                       40%
   *   共通単語・共通連続文字列          30%
   *   段落構造                          15%
   *   共通用語クラス                    10%
   *   引用関係・ツリー位置・カテゴリー・項種別  5%
   */
  const CLAIM_WEIGHTS = {
    char3: 0.40,       // 正規化全文の文字3-gram Dice
    words: 0.18,       // 共通する単語の割合
    char2: 0.12,       // 共通する連続文字列（文字2-gram Dice）
    segCount: 0.05,    // 段落数の近さ
    segProfile: 0.04,  // 各段落の長さの近さ
    segAligned: 0.06,  // 同じ位置の段落どうしの近さ
    termClass: 0.10,   // 解析画面の用語クラス（両方に無ければ按分から外す）
    tree: 0.02,        // クレームツリー上の相対位置・サブツリー形状
    category: 0.015,   // 請求項カテゴリーの一致
    role: 0.01,        // 独立項どうし／従属項どうし
    cite: 0.005,       // 引用先集合の重なり
  };

  /*
   * グループ生成のしきい値（強度プリセットごと）。
   *   seedPair       … グループの起点にするペアの最小類似度
   *   memberAverage  … グループ全体との平均がこれ以上なら正式メンバー
   *   memberMinimum  … かつ、どのメンバーとの類似度もこれ以上であること
   *   candidate      … いずれかのメンバーとこれ以上似ていれば「追加候補」
   *   sibling        … 同じ請求項を引く従属項どうしをまとめる下限
   *   category       … 独立項をカテゴリーでまとめるときの字面の下限
   *   rootAffinity   … 並行サブツリーを認めるときの起点どうしの下限
   */
  const GROUPING_PRESETS = {
    broad: {
      key: 'broad',
      label: '広め',
      description: '多少過剰でも比較候補を多く拾う',
      seedPair: 0.55,
      memberAverage: 0.50,
      memberMinimum: 0.38,
      candidate: 0.45,
      sibling: 0.45,
      category: 0.25,
      rootAffinity: 0.0,
      looseShape: true,
    },
    standard: {
      key: 'standard',
      label: '標準',
      description: '明確に字面や構造が近いものをまとめる',
      seedPair: 0.65,
      memberAverage: 0.60,
      memberMinimum: 0.48,
      candidate: 0.55,
      sibling: 0.58,
      category: 0.42,
      rootAffinity: 0.25,
      looseShape: false,
    },
    strict: {
      key: 'strict',
      label: '厳密',
      description: 'ほぼカテゴリー変更又は定型的変更だけのものをまとめる',
      seedPair: 0.78,
      memberAverage: 0.74,
      memberMinimum: 0.62,
      candidate: 0.70,
      sibling: 0.70,
      category: 0.56,
      rootAffinity: 0.45,
      looseShape: false,
    },
  };

  // 1 グループに載せる追加候補の上限（多すぎると候補が候補でなくなる）
  const MAX_CANDIDATES = 10;

  /*
   * 段落どうしの対応付け。
   * 配分:
   *   共通単語の割合        35%
   *   末尾（述語）の一致    25%
   *   文字3-gram            20%
   *   共通する連続文字列    10%
   *   段落の長さの近さ      10%
   * 用語クラスの一致は小さな加点（按分の外）。
   *
   * 「末尾」を独立の特徴量にしているのは、日本語のクレームでは **構成要件の述語が段落の
   * 末尾に来る**ため。「…測定レポートを蓄積し」「…蓄積測定レポートを生成し」
   * 「…無線通信ネットワークに対して送信し」は前半がほぼ同文で、違うのは末尾の動作だけ、
   * ということが普通に起きる。前半の共通部分に引きずられて別の構成要件へ対応しないよう、
   * 末尾に相応の重みを置く。日本語の語順の話なので、技術分野には依存しない。
   */
  const SEGMENT_WEIGHTS = {
    words: 0.35,
    tail: 0.25,
    char3: 0.20,
    char2: 0.10,
    length: 0.10,
  };

  const SEGMENT_RULES = {
    termClassBonus: 0.06,   // 共通する用語クラスへの小さな加点
    minScore: 0.55,         // これ未満なら「類似段落なし」（同じ段落番号へは落とさない）
    minSharedWords: 2,      // 最低条件: 共通語がこの数以上
    substringLength: 6,     // 最低条件: この長さの共通連続文字列があること
    tailLength: 24,         // 「末尾」として見る文字数（述語のあたり）
    relatedMargin: 0.08,    // 最高点からこの差以内の候補は、まとめて対応しているとみなす
    maxMatches: 3,          // 1 請求項あたりに強調する段落の上限
  };

  /*
   * 段落の対応付けだけで畳む「向きが逆なだけの対」。
   *
   * 「◯◯において XX を送信すること」と「△△において XX を受信すること」は、
   * 主体が入れ替わっただけで**同じやり取りを指している**。段落を並べて見比べるときは
   * この 2 つが対応していないと困るので、対応付けの計算では同じ語として扱う。
   *
   * ただし畳んだ文字列で置き換えるのではなく、**素の文字列と畳んだ文字列の両方で計算して
   * 高い方を採る**（rawScore と foldedScore の max）。こうすると、
   *   - 向きが同じ段落どうしの一致は今までどおり最高点のまま
   *   - 向きが逆の対応は、他に候補が無いときだけ浮かび上がる
   * となり、畳み込みが誤対応を増やさない。
   *
   * ここは「向きが逆なだけの対」だけを置く場所で、技術用語辞書ではない。
   * 自動グルーピングの正規化と画面表示には一切適用しないので、
   * 送信／受信の違いそのものは今までどおり読めるし、グループ分けにも効かない。
   */
  const SEGMENT_DIRECTION_PAIRS = [
    ['送信', '受信'],
    ['発信', '着信'],
    ['送出', '受入'],
    ['出力', '入力'],
    ['供給', '受給'],
  ];

  /*
   * 段落をひと塊にまとめる接続語（段落の対応付けでのみ使う）。
   *
   * 「…に基づいて、選択するか、又は、」／「…に基づいて、選択する」のように、
   * 1 つの構成要件の選択肢が段落に割れていることがある。段落の末尾（又は次の段落の先頭）が
   * これらの接続語なら、そこで文が終わっていないので **続きの段落と 1 つの塊** として扱う。
   * どれか 1 つが対応すれば塊ごと反応するので、割れている側と、まとめて書かれている側の
   * 対応が取れる。
   *
   * ここは日本語の接続表現だけを置く場所で、技術用語辞書ではない。
   * 段落の表示（原文・段落番号）は塊にせず、元のまま分けて出す。
   */
  const SEGMENT_BLOCK_CONNECTIVES = [
    '又は', 'または', '若しくは', 'もしくは',
    '及び', 'および', '並びに', 'ならびに',
    'かつ', 'あるいは',
  ];

  /*
   * 「文がそこで終わっていない」ことを示す段落の末尾（段落の対応付けでのみ使う）。
   *
   * 「前記インフラストラクチャ機器は、前記蓄積測定レポートとして、」のように、主題や役割を
   * 述べただけで述語が来ていない段落は、次の段落と合わせて 1 つの構成要件になる。
   * 接続語と同じく、日本語の書き方の話であって技術用語ではない。
   */
  const SEGMENT_CONTINUATION_SUFFIXES = ['として', 'は', 'が', 'について', 'に関して'];

  // 1 つの塊にまとめる段落数の上限（接続語が連なっても際限なく広げない）
  const MAX_BLOCK_SEGMENTS = 6;

  return {
    CLAIM_WEIGHTS,
    GROUPING_PRESETS,
    SEGMENT_WEIGHTS,
    SEGMENT_RULES,
    SEGMENT_DIRECTION_PAIRS,
    SEGMENT_BLOCK_CONNECTIVES,
    SEGMENT_CONTINUATION_SUFFIXES,
    MAX_BLOCK_SEGMENTS,
    MAX_CANDIDATES,
    DEFAULT_PRESET: 'broad',
    MAX_GROUP_SIZE: 100,
  };
});

/*
 * citation.js — 引用関係の解析（DOM 非依存・依存ゼロ）
 *
 * 請求項本文に現れる引用表現を、位置（span）付きで取り出す。位置を返すのは
 * normalize.js が「引用定型句を取り除いた比較用文字列」を作るために使うため。
 *
 * 対応する記載（実物のクレームから採取）:
 *   請求項1に記載の
 *   請求項11又は12に記載の
 *   請求項1から14のいずれか一項に記載の
 *   請求項1から請求項14のいずれか一項に記載の
 *   請求項1、請求項17、請求項26又は請求項35に記載の
 *   請求項1～7に記載の / 請求項1乃至7 / 請求項1-7
 *
 * 方針:
 *   - 「請求項」を起点に、数値と接続語だけを前方へ食べていく決定論的スキャン。
 *     接続語は「次に（請求項＋）数字が続くとき」しか食べないので、
 *     「請求項1に記載の方法であって、前記…」の読点を巻き込まない。
 *   - 全角数字は等長の半角へ写してから走査する（1文字↔1文字なので元文字列の
 *     インデックスがずれない）。
 *   - ここでの結果は「グループ化の正解」ではなく補助情報。呼び出し側は
 *     引用一覧（#claim_cite）を優先し、これはフォールバック兼クロスチェックに使う。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.citation = factory();
  }
})(globalThis, function () {
  'use strict';

  const CLAIM_WORD = '請求項';

  // 列挙の接続語（範囲ではない）。長いものから順に試す
  const LIST_CONNECTORS = [
    '若しくは', 'もしくは', '並びに', 'ならびに', 'または', '及び', 'および', '又は',
    'かつ', '、', '，', ',', '・',
  ];

  // 範囲の接続語。長いものから順に試す
  const RANGE_CONNECTORS = ['乃至', 'ないし', 'から', '〜', '～', '~', '―', '‐', '−', '－', '—', '-'];

  // 引用表現の直後に続く定型句（span に含めて丸ごと除去できるようにする）
  const TRAILING_PHRASES = [
    'のいずれか一項に記載の', 'のいずれか１項に記載の', 'のいずれか1項に記載の',
    'のいずれかに記載の', 'のうちのいずれか一項に記載の', 'のいずれか一項記載の',
    'のいずれか一項に記載された', 'のいずれか一項に記載', 'のいずれか一項',
    'に記載された', 'に記載の', 'に記載', '記載の', 'に従属する',
  ];

  // 全角数字 → 半角数字（1文字→1文字なのでインデックスが保存される）
  function toAsciiDigits(text) {
    return String(text == null ? '' : text).replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30));
  }

  // pos から prefix 群のいずれかに一致すれば、その長さを返す（最長一致）
  function matchAny(s, pos, candidates) {
    let best = 0;
    for (const cand of candidates) {
      if (cand.length > best && s.startsWith(cand, pos)) best = cand.length;
    }
    return best;
  }

  function skipSpaces(s, pos) {
    while (pos < s.length && (s[pos] === ' ' || s[pos] === '　' || s[pos] === '\t')) pos += 1;
    return pos;
  }

  // pos から「（請求項）?数字」を読む。読めなければ null
  function readNumberRef(s, pos) {
    let p = skipSpaces(s, pos);
    if (s.startsWith(CLAIM_WORD, p)) p = skipSpaces(s, p + CLAIM_WORD.length);
    const m = /^\d+/.exec(s.slice(p));
    if (!m) return null;
    return { value: Number(m[0]), end: p + m[0].length };
  }

  /*
   * 1 つの引用表現を pos（「請求項」の先頭）から読む。
   * 返り値 { numbers, start, end } / 読めなければ null
   */
  function readCitation(scan, pos) {
    const first = readNumberRef(scan, pos);
    if (!first) return null;

    const numbers = [first.value];
    let cursor = first.end;
    let last = first.value;

    for (;;) {
      // 接続語は続けて現れうる（「、又は」「、及び」など）。まとめて読む
      let pos = skipSpaces(scan, cursor);
      let consumed = 0;
      let rangeLen = 0;
      for (let k = 0; k < 3; k += 1) {
        const r = matchAny(scan, pos, RANGE_CONNECTORS);
        if (r) { rangeLen = r; pos = skipSpaces(scan, pos + r); consumed += r; continue; }
        const l = matchAny(scan, pos, LIST_CONNECTORS);
        if (l) { pos = skipSpaces(scan, pos + l); consumed += l; continue; }
        break;
      }
      if (!consumed) break;

      const next = readNumberRef(scan, pos);
      // 接続語の先に数字が無ければ、その接続語は引用表現の一部ではない
      if (!next) break;

      if (rangeLen) {
        // 範囲: last+1 〜 next を補う（降順・異常値は無視して端点だけ採る）
        if (next.value > last) {
          for (let n = last + 1; n <= next.value; n += 1) numbers.push(n);
        } else {
          numbers.push(next.value);
        }
      } else {
        numbers.push(next.value);
      }
      last = next.value;
      cursor = next.end;
    }

    // 後続の定型句まで span に含める
    const afterNums = skipSpaces(scan, cursor);
    const trailing = matchAny(scan, afterNums, TRAILING_PHRASES);
    const end = trailing ? afterNums + trailing : cursor;

    return { numbers, start: pos, end };
  }

  /*
   * 本文から引用表現をすべて取り出す。
   * → { numbers: 昇順ユニークな引用先, spans: [{ start, end, numbers }] }
   */
  function parseCitations(text) {
    const src = String(text == null ? '' : text);
    const scan = toAsciiDigits(src);
    const spans = [];
    const all = new Set();

    let idx = scan.indexOf(CLAIM_WORD);
    while (idx !== -1) {
      const hit = readCitation(scan, idx);
      if (hit) {
        spans.push(hit);
        for (const n of hit.numbers) all.add(n);
        idx = scan.indexOf(CLAIM_WORD, hit.end);
      } else {
        idx = scan.indexOf(CLAIM_WORD, idx + CLAIM_WORD.length);
      }
    }

    return {
      numbers: Array.from(all).sort((a, b) => a - b),
      spans,
    };
  }

  /*
   * 引用表現の span を取り除いた文字列を返す（比較用文字列の材料）。
   * 表示用の原文には使わないこと。
   */
  function stripCitations(text) {
    const src = String(text == null ? '' : text);
    const { spans } = parseCitations(src);
    if (!spans.length) return src;
    let out = '';
    let cursor = 0;
    for (const span of spans) {
      out += src.slice(cursor, span.start);
      cursor = span.end;
    }
    out += src.slice(cursor);
    return out;
  }

  /*
   * 引用一覧（#claim_cite）のテキストから直接引用を読む。
   *   [12]請求項12 『・・方法』 従属請求項　引用請求項: 8　引用パターンの数: 1　被引用請求項: 13,14
   * 新 UI は「引用請求項」に**全引用元**（直接＋間接）を並べ、括弧内に間接引用を示す:
   *   引用請求項： 1,2（うち間接引用: 1）
   * 旧 UI は直接引用元だけを並べ、括弧内に間接引用を示す:
   *   引用請求項: 5 (間接引用: 1)
   * どちらも「間接引用の番号は直接引用元ではない」ので、間接側に載る番号を差し引く
   * （新旧どちらの書式でも差し引きは no-op か正しい除去になる）。
   * 「被引用請求項」は上限到達時に不完全になるため使わない（fixtures/README.md 参照）。
   * → { claims: [{ number, categoryLabel, isIndependent, citations }], total, independents }
   */
  function parseCiteList(text) {
    const src = toAsciiDigits(String(text == null ? '' : text));
    const claims = [];
    // 「[n]請求項n 『…』 独立請求項/従属請求項」を境界にレコードへ切る
    const head = /\[(\d+)\]請求項(\d+)/g;
    const starts = [];
    let m;
    while ((m = head.exec(src)) !== null) starts.push({ index: m.index, number: Number(m[2]) });

    for (let i = 0; i < starts.length; i += 1) {
      const begin = starts[i].index;
      const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
      const body = src.slice(begin, end);
      const categoryMatch = /『(.*?)』/.exec(body);
      // 「被引用請求項」を拾わないよう、直前が区切り文字であることを要求する。
      // 被引用は上限到達時に不完全になるため、引用関係の復元に使ってはいけない。
      const citeMatch = /[\s　]引用請求項\s*[:：]\s*([\d,\s]+)/.exec(body);
      const indirectMatch = /引用請求項\s*[:：][^（(\n]*[（(]\s*うち間接引用\s*[:：]\s*([\d,\s]+)/.exec(body);
      const indirect = indirectMatch
        ? indirectMatch[1].split(/[,\s]+/).filter((s) => s !== '').map(Number)
        : [];
      const indirectSet = new Set(indirect);
      const citations = citeMatch
        ? citeMatch[1].split(/[,\s]+/).filter((s) => s !== '').map(Number)
          .filter((n) => !indirectSet.has(n))
          .sort((a, b) => a - b)
        : [];
      claims.push({
        number: starts[i].number,
        categoryLabel: categoryMatch ? categoryMatch[1].replace(/^[・･]+/, '').trim() : '',
        isIndependent: body.indexOf('独立請求項') !== -1,
        citations,
      });
    }

    const totalMatch = /合計請求項数\s*[:：]\s*(\d+)/.exec(src);
    const indMatch = /独立請求項\s*[:：]\s*([\d,\s]+)[)）]/.exec(src);
    return {
      claims,
      total: totalMatch ? Number(totalMatch[1]) : claims.length,
      independents: indMatch
        ? indMatch[1].split(/[,\s]+/).filter((s) => s !== '').map(Number)
        : claims.filter((c) => c.isIndependent).map((c) => c.number),
    };
  }

  return { parseCitations, stripCitations, parseCiteList, toAsciiDigits };
});

/*
 * normalize.js — 比較用の文字列正規化（DOM 非依存）
 *
 * 「表示は原文のまま、比較だけ正規化」が原則。ここで作るのは **比較専用** の文字列で、
 * 画面に出す本文は絶対にこれを使わない（原文がそのまま読めることが要件）。
 *
 * 正規化するもの:
 *   - Unicode 正規化（NFKC）＝ 全角・半角の統一もこれで済む
 *   - 英字の大文字・小文字の統一（小文字へ）
 *   - 連続する空白・改行・全角空白の整理（比較用は完全除去）
 *     ※段落分割は正規化より **先に** 済ませておくこと
 *   - 句読点・括弧などの装飾文字の除去
 *   - 解析表示用の番号（[1-1] 等）の除去
 *   - 数字表記（漢数字 → 算用数字）
 *   - 「前記」の削除（「前記◯◯」と「◯◯」を同じ語として扱うため）
 *
 * **辞書を持たない。** 定型語の一覧・ストップワード辞書・技術用語辞書・案件別辞書は作らない。
 * 例外は「前記」だけで、これは日本語クレームの参照表現そのものなので単独で扱う。
 *
 * 引用表現（「請求項◯に記載の…」）だけは citation.js が本文から見つけた範囲を丸ごと落とす。
 * これは語の一覧ではなく、その文書の記載から求めた位置に対する構造的な処理で、
 * 「引用先が違うだけ」の請求項を遠ざけないために必要（引用関係は補助情報として別に使う）。
 *
 * 正規化しないもの（意図的）:
 *   - 送信/受信、同じ/異なる のような意味的な違い。まさにそれを人が見つけるための道具なので、
 *     機械的に潰してはいけない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./citation'));
  } else {
    root.JCGC = root.JCGC || {};
    if (!root.JCGC.citation) throw new Error('JCGC.citation が未読み込みです（連結順を確認）');
    root.JCGC.normalize = factory(root.JCGC.citation);
  }
})(globalThis, function (citation) {
  'use strict';

  const KANJI_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  // 日本語クレームの参照表現。唯一これだけを個別に落とす（辞書ではない）
  const REFERENCE_PREFIX = /前記/g;

  /*
   * 句読点・括弧・記号。**長音符（ー）とダッシュ類は落とさない**
   * ——「レポート」が「レポト」になるなど、カタカナ語そのものを壊してしまうため。
   */
  const PUNCTUATION = /[、。，．・：；「」『』（）()［］[\]【】〔〕｛｝{}"'`,.:;!?！？…]/g;

  // 表示用番号 [12-3] を落とす。claimNumber を渡したときはその請求項の番号だけを対象にする
  function stripDisplayNumbers(text, claimNumber) {
    const src = String(text == null ? '' : text);
    if (claimNumber == null) return src.replace(/\[\d+-\d+\]/g, '');
    const re = new RegExp('\\[' + String(claimNumber) + '-\\d+\\]', 'g');
    return src.replace(re, '');
  }

  // 漢数字 → 算用数字（十の位まで。比較用なので厳密な数詞解析はしない）
  function kanjiDigitsToArabic(text) {
    let out = String(text == null ? '' : text);
    out = out.replace(/([一二三四五六七八九])?十([一二三四五六七八九])?/g, (m, tens, ones) => {
      const t = tens ? KANJI_DIGIT[tens] : 1;
      const o = ones ? KANJI_DIGIT[ones] : 0;
      return String(t * 10 + o);
    });
    out = out.replace(/[〇零一二三四五六七八九]/g, (c) => String(KANJI_DIGIT[c]));
    return out;
  }

  function toNfkc(text) {
    const src = String(text == null ? '' : text);
    return typeof src.normalize === 'function' ? src.normalize('NFKC') : src;
  }

  /*
   * 比較用文字列を作る。請求項全文にも段落にも同じものを使う。
   * options: { claimNumber, keepCitations }
   */
  function normalizeForCompare(text, options) {
    const opts = options || {};
    let out = String(text == null ? '' : text);
    out = stripDisplayNumbers(out, opts.claimNumber);
    if (!opts.keepCitations) out = citation.stripCitations(out);
    out = toNfkc(out);
    out = out.toLowerCase();
    out = kanjiDigitsToArabic(out);
    out = out.replace(/[\s　]+/g, '');
    out = out.replace(PUNCTUATION, '');
    out = out.replace(REFERENCE_PREFIX, '');
    return out;
  }

  // 段落 1 つ分の比較用文字列（請求項全文と同じ正規化）
  function normalizeSegment(text, options) {
    return normalizeForCompare(text, options);
  }

  /*
   * 単語の切り出し。漢字・カタカナ・英数の連なり（2文字以上）を語とみなす。
   * ひらがなが自然な区切りになるので、形態素解析も辞書も要らない。
   */
  // 長音符（ー）はカタカナ語の一部なので語に含める（「レポート」を割らない）
  const TERM_RE = /[一-鿿々ァ-ヺーｦ-ﾝa-z0-9]{2,}/g;

  function keyTerms(normalized) {
    const out = new Set();
    const src = String(normalized == null ? '' : normalized);
    let m;
    TERM_RE.lastIndex = 0;
    while ((m = TERM_RE.exec(src)) !== null) {
      const w = m[0];
      out.add(w);
      // 長い連なりは 3 文字の部分語にも割る（複合語の部分一致を拾うため）
      if (w.length > 4) {
        for (let i = 0; i + 3 <= w.length; i += 1) out.add(w.slice(i, i + 3));
      }
    }
    return out;
  }

  return {
    stripDisplayNumbers,
    kanjiDigitsToArabic,
    toNfkc,
    normalizeForCompare,
    normalizeSegment,
    keyTerms,
    REFERENCE_PREFIX,
  };
});

/*
 * segment.js — 請求項本文の段落（構成要件）分割（DOM 非依存）
 *
 * 重要: **正規化する前の原文** から段落境界を取る。空白を潰してから分割しようとすると
 * 境界が消えるため（要件どおり、抽出 → 分割 → 正規化 の順を守る）。
 *
 * 優先順位:
 *   1. 元の改行（<br> 由来の \n）
 *   2. 全角空白（U+3000）の連なり = 構成要件区切り。連なりの長さをインデント深さとして持つ
 *   3. 行頭の半角インデント
 *   （ここまでで区切れたら、これ以上は分けない）
 *   4. どれも取れないときだけ、句点・読点によるフォールバック分割
 *
 * 極端に短い断片（MIN_LENGTH 未満）は直前（無ければ直後）の段落へ結合する。
 * 「方法。」「装置。」のような末尾のカテゴリー宣言はこれで前の段落に吸収され、
 * 請求項どうしの段落数が比べやすくなる。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.segment = factory();
  }
})(globalThis, function () {
  'use strict';

  // これ未満の断片は前後へ結合する（文字数）
  const MIN_LENGTH = 8;
  // フォールバック分割で読点を区切りとみなす最小の蓄積長
  const FALLBACK_MIN_LENGTH = 60;

  const IDEOGRAPHIC_SPACE = '　';

  function isBlank(s) {
    return String(s).replace(/[\s　]/g, '') === '';
  }

  // 区切り文字列 → インデント深さ（全角空白の個数。半角インデントだけなら 1）
  function depthOf(sep) {
    let full = 0;
    for (const ch of sep) if (ch === IDEOGRAPHIC_SPACE) full += 1;
    if (full > 0) return full;
    return /[ \t]{2,}/.test(sep) ? 1 : 0;
  }

  /*
   * 原文を「素片（piece）」へ割る。piece = { text, sep, depth }
   *   sep   … その素片の直前にあった区切り文字列（結合時に復元するため保持）
   *   depth … 全角空白の連なりの長さ（0 = 行頭）
   */
  function splitPieces(text) {
    const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const pieces = [];
    const lines = src.split('\n');

    for (let li = 0; li < lines.length; li += 1) {
      const line = lines[li];
      // 行頭の半角インデントも区切りとして扱う
      const re = /[　]+|^[ \t]{2,}/g;
      let cursor = 0;
      let pendingSep = li === 0 ? '' : '\n';
      let m;
      while ((m = re.exec(line)) !== null) {
        const chunk = line.slice(cursor, m.index);
        if (isBlank(chunk)) {
          // 素片が空なら区切りを繋いで持ち越す（連なりの長さがそのまま深さになる）
          pendingSep += chunk + m[0];
        } else {
          pieces.push({ text: chunk, sep: pendingSep, depth: depthOf(pendingSep) });
          pendingSep = m[0];
        }
        cursor = m.index + m[0].length;
      }
      const tail = line.slice(cursor);
      if (!isBlank(tail)) pieces.push({ text: tail, sep: pendingSep, depth: depthOf(pendingSep) });
    }

    return pieces;
  }

  /*
   * 区切りが 1 つも取れなかったときのフォールバック。
   * 句点で必ず切り、読点は蓄積が FALLBACK_MIN_LENGTH 以上のときだけ切る。
   */
  function fallbackSplit(text) {
    const src = String(text == null ? '' : text);
    const out = [];
    let buf = '';
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      buf += ch;
      if (ch === '。') {
        out.push(buf);
        buf = '';
      } else if ((ch === '、' || ch === '，') && buf.length >= FALLBACK_MIN_LENGTH) {
        out.push(buf);
        buf = '';
      }
    }
    if (!isBlank(buf)) out.push(buf);
    return out.filter((s) => !isBlank(s)).map((s, i) => ({ text: s, sep: i === 0 ? '' : '', depth: 0 }));
  }

  // 短すぎる素片を前（無ければ後ろ）へ結合する
  function mergeShort(pieces, minLength) {
    const limit = minLength == null ? MIN_LENGTH : minLength;
    const out = [];
    for (const piece of pieces) {
      const len = piece.text.replace(/[\s　]/g, '').length;
      if (len < limit && out.length > 0) {
        const prev = out[out.length - 1];
        prev.text = prev.text + piece.sep + piece.text;
        continue;
      }
      out.push({ text: piece.text, sep: piece.sep, depth: piece.depth });
    }
    // 先頭が短いままなら次へ吸収させる
    if (out.length > 1) {
      const firstLen = out[0].text.replace(/[\s　]/g, '').length;
      if (firstLen < limit) {
        out[1].text = out[0].text + out[1].sep + out[1].text;
        out[1].depth = out[0].depth;
        out.shift();
      }
    }
    return out;
  }

  /*
   * 請求項本文 → 段落配列
   * options: { minLength }
   * → [{ index, text, depth, source }]（index は 1 始まりの表示用番号）
   */
  function splitSegments(text, options) {
    const opts = options || {};
    let pieces = splitPieces(text);
    let source = 'structural';
    if (pieces.length <= 1) {
      const fallback = fallbackSplit(pieces.length === 1 ? pieces[0].text : text);
      if (fallback.length > 1) {
        pieces = fallback;
        source = 'fallback';
      }
    }
    const merged = mergeShort(pieces, opts.minLength);
    return merged.map((p, i) => ({
      index: i + 1,
      text: p.text.replace(/^[\s　]+|[\s　]+$/g, ''),
      depth: p.depth,
      source,
    })).filter((s) => s.text !== '');
  }

  return { splitSegments, splitPieces, fallbackSplit, mergeShort, MIN_LENGTH };
});

/*
 * tree.js — クレームツリーの生成（DOM 非依存）
 *
 * 引用関係から「主ツリー」を組む。主ツリーに入るのは **直接引用が 1 件だけ** の請求項で、
 * 多項従属（2 件以上を引用）はツリー上の位置が一意に決まらないため枝には載せない
 * （載せると、多項従属を引く独立項だけ部分木の形が崩れ、並行ツリーの対応が取れなくなる）。
 * 多項従属は multiDependent: true として別枠で扱い、グルーピング側で
 * 「同一引用集合」の候補にする。
 *
 * 請求項番号は識別子としてしか使わない。連番であること・欠番が無いこと・
 * 系列ごとの請求項数が同じであること等は前提にしていない。
 *
 * 各ノードが持つ情報:
 *   parents        … 直接引用（自分より小さい番号のみ）
 *   children       … 主ツリー上の子（番号昇順）
 *   depth          … 独立項を 0 とする深さ
 *   siblingIndex   … 親から見た兄弟内の順番
 *   path           … ルートからの相対位置（兄弟インデックスの列）
 *   rootNumber     … 属するサブツリーの起点
 *   shape          … サブツリーの正準形（"( ( ) ( ) )" 相当の文字列）
 *   size / height  … サブツリーのノード数・高さ
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.tree = factory();
  }
})(globalThis, function () {
  'use strict';

  function buildTree(claims) {
    const nodes = new Map();
    const numbers = claims.map((c) => c.number);
    const known = new Set(numbers);

    for (const claim of claims) {
      const parents = (claim.citations || [])
        .filter((n) => known.has(n) && n < claim.number)
        .sort((a, b) => a - b);
      nodes.set(claim.number, {
        number: claim.number,
        parents,
        multiDependent: parents.length > 1,
        primaryParent: parents.length === 1 ? parents[0] : null,
        children: [],
        depth: 0,
        siblingIndex: 0,
        path: [],
        rootNumber: claim.number,
        shape: '()',
        size: 1,
        height: 0,
      });
    }

    // 主ツリーの親子付け（単一引用のみ）
    for (const node of nodes.values()) {
      if (node.primaryParent == null) continue;
      const parent = nodes.get(node.primaryParent);
      if (parent) parent.children.push(node.number);
    }
    for (const node of nodes.values()) node.children.sort((a, b) => a - b);

    // 主ツリーの根 = 引用が 1 件も無い請求項（＝独立項）
    const roots = numbers
      .filter((n) => nodes.get(n).parents.length === 0)
      .sort((a, b) => a - b);

    // 深さ・相対位置・ルート（多項従属は枝に載らないので、最小の親の深さ+1 を持たせるだけ）
    const visited = new Set();
    for (const rootNumber of roots) {
      const stack = [{ number: rootNumber, depth: 0, path: [], siblingIndex: 0 }];
      while (stack.length) {
        const item = stack.pop();
        const node = nodes.get(item.number);
        if (!node || visited.has(item.number)) continue;
        visited.add(item.number);
        node.depth = item.depth;
        node.path = item.path;
        node.siblingIndex = item.siblingIndex;
        node.rootNumber = rootNumber;
        node.children.forEach((childNumber, index) => {
          stack.push({
            number: childNumber,
            depth: item.depth + 1,
            path: item.path.concat([index]),
            siblingIndex: index,
          });
        });
      }
    }
    for (const node of nodes.values()) {
      if (visited.has(node.number)) continue;
      // 多項従属など、主ツリーに載らなかったノード
      const parentDepths = node.parents
        .map((p) => (nodes.get(p) ? nodes.get(p).depth : 0));
      node.depth = parentDepths.length ? Math.min.apply(null, parentDepths) + 1 : 0;
      node.path = [];
      node.rootNumber = node.parents.length ? node.parents[0] : node.number;
    }

    // サブツリーの正準形・サイズ・高さ（葉から順に確定させる）
    const order = numbers.slice().sort((a, b) => b - a);
    for (const number of order) {
      const node = nodes.get(number);
      let size = 1;
      let height = 0;
      let shape = '';
      for (const childNumber of node.children) {
        const child = nodes.get(childNumber);
        size += child.size;
        height = Math.max(height, child.height + 1);
        shape += child.shape;
      }
      node.size = size;
      node.height = height;
      node.shape = '(' + shape + ')';
    }

    return {
      nodes,
      roots,
      get(number) { return nodes.get(number) || null; },
      // ルート起点のサブツリーを DFS 前順で並べる（相対位置の対応付けに使う）
      preorder(rootNumber) {
        const out = [];
        const walk = (number) => {
          const node = nodes.get(number);
          if (!node) return;
          out.push(number);
          for (const childNumber of node.children) walk(childNumber);
        };
        walk(rootNumber);
        return out;
      },
      pathKey(number) {
        const node = nodes.get(number);
        return node ? node.path.join('.') : '';
      },
    };
  }

  return { buildTree };
});

/*
 * similarity.js — 請求項どうしの類似度（DOM 非依存）
 *
 * 単一の指標では決めない。単純な指標を重み付きで合成するだけで、機械学習も外部 API も
 * 意味解析も使わない。重みとしきい値は settings.js に集めてある。
 *
 * 配分（settings.CLAIM_WEIGHTS）:
 *   文字3-gram                            40%
 *   共通単語・共通連続文字列               30%
 *   段落構造（段落数・長さ・並び）          15%
 *   共通用語クラス（zenki_wdXX）            10%
 *   引用関係・ツリー位置・カテゴリー・項種別  5%
 *
 * 用語クラスは、両方の請求項に 1 つも無ければ按分から外す（無い文書で点が下駄を履かない）。
 *
 * 意味的な違い（送信/受信、同じ/異なる 等）でここから除外することは **しない**。
 * その微妙な差を人が見つけるための候補づくりが目的なので、機械が先に捨ててはいけない。
 *
 * 計算結果はペア単位でキャッシュする（100 請求項 = 4950 ペアでも一度きり）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalize'), require('./settings'));
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['normalize', 'settings']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.similarity = factory(root.JCGC.normalize, root.JCGC.settings);
  }
})(globalThis, function (normalize, settings) {
  'use strict';

  const WEIGHTS = settings.CLAIM_WEIGHTS;

  function ngrams(text, n) {
    const out = new Set();
    const s = String(text == null ? '' : text);
    if (s.length < n) {
      if (s) out.add(s);
      return out;
    }
    for (let i = 0; i + n <= s.length; i += 1) out.add(s.slice(i, i + n));
    return out;
  }

  // Dice 係数（集合版）
  function dice(a, b) {
    if (!a.size && !b.size) return 1;
    if (!a.size || !b.size) return 0;
    let inter = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const v of small) if (large.has(v)) inter += 1;
    return (2 * inter) / (a.size + b.size);
  }

  function jaccard(a, b) {
    if (!a.size && !b.size) return 1;
    if (!a.size || !b.size) return 0;
    let inter = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const v of small) if (large.has(v)) inter += 1;
    return inter / (a.size + b.size - inter);
  }

  function intersectionSize(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const v of small) if (large.has(v)) inter += 1;
    return inter;
  }

  function ratio(a, b) {
    const hi = Math.max(a, b);
    if (hi === 0) return 1;
    return Math.min(a, b) / hi;
  }

  /*
   * 請求項レコードに、比較用の派生データ（正規化文字列・単語集合・n-gram）を一度だけ載せる。
   * 段落をクリックするたびに作り直さないためのキャッシュでもある。
   */
  function prepare(claim) {
    if (claim.__sim) return claim.__sim;
    const normalized = claim.normalized || '';
    const sim = {
      normalized,
      g2: ngrams(normalized, 2),
      g3: ngrams(normalized, 3),
      words: normalize.keyTerms(normalized),
      termClasses: new Set(claim.termClasses || []),
      segLengths: (claim.normalizedSegments || []).map((s) => s.length),
      segGrams: (claim.normalizedSegments || []).map((s) => ngrams(s, 3)),
      citations: new Set(claim.citations || []),
    };
    Object.defineProperty(claim, '__sim', { value: sim, enumerable: false, writable: true });
    return sim;
  }

  // 段落長プロファイルの近さ（先頭から重ね合わせ、余った分は不一致として数える）
  function segmentProfileScore(a, b) {
    const n = Math.max(a.length, b.length);
    if (n === 0) return 1;
    let acc = 0;
    for (let i = 0; i < n; i += 1) acc += ratio(a[i] || 0, b[i] || 0);
    return acc / n;
  }

  // 同じ位置の段落どうしの字面の近さ（段落の並び順を見る）
  function segmentAlignedScore(a, b) {
    const n = Math.max(a.length, b.length);
    if (n === 0) return 1;
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      if (!a[i] || !b[i]) continue;
      acc += dice(a[i], b[i]);
    }
    return acc / n;
  }

  /*
   * ツリー上の位置の近さ。請求項番号の差は使わず、実際の親子関係と形だけを見る。
   *   - サブツリーの形が同じ・相対位置も同じ    → 1.0
   *   - 形は同じで位置が違う                    → 0.9
   *   - 深さ・兄弟内順番・子の数が同じ          → 0.75
   *   - 深さだけ同じ                            → 0.5
   *   - それ以外                                → 深さ差に応じて減衰
   */
  function treeScore(treeInfo, a, b) {
    if (!treeInfo) return 0.5;
    const na = treeInfo.get(a.number);
    const nb = treeInfo.get(b.number);
    if (!na || !nb) return 0.5;
    if (na.shape === nb.shape && na.depth === nb.depth) {
      return na.path.join('.') === nb.path.join('.') ? 1 : 0.9;
    }
    if (na.depth === nb.depth) {
      if (na.siblingIndex === nb.siblingIndex && na.children.length === nb.children.length) return 0.75;
      return 0.5;
    }
    return Math.max(0, 0.5 - 0.15 * Math.abs(na.depth - nb.depth));
  }

  function citeScore(sa, sb) {
    if (!sa.citations.size && !sb.citations.size) return 1; // どちらも独立項
    return jaccard(sa.citations, sb.citations);
  }

  function pairKey(a, b) {
    return a.number < b.number ? a.number + ':' + b.number : b.number + ':' + a.number;
  }

  /*
   * 2 請求項の特徴量。値が null の特徴量は按分から外れる（用語クラスが無い文書向け）。
   */
  function computeFeatures(a, b, treeInfo) {
    const sa = prepare(a);
    const sb = prepare(b);
    const hasClasses = sa.termClasses.size > 0 && sb.termClasses.size > 0;
    return {
      char3: dice(sa.g3, sb.g3),
      words: dice(sa.words, sb.words),
      char2: dice(sa.g2, sb.g2),
      segCount: ratio(sa.segLengths.length, sb.segLengths.length),
      segProfile: segmentProfileScore(sa.segLengths, sb.segLengths),
      segAligned: segmentAlignedScore(sa.segGrams, sb.segGrams),
      termClass: hasClasses ? jaccard(sa.termClasses, sb.termClasses) : null,
      tree: treeScore(treeInfo, a, b),
      category: a.categoryKey === b.categoryKey ? 1 : 0,
      role: a.isIndependent === b.isIndependent ? 1 : 0,
      cite: citeScore(sa, sb),
    };
  }

  // 使える特徴量だけで按分する
  function combine(features, weights) {
    const w = weights || WEIGHTS;
    let sum = 0;
    let total = 0;
    for (const key of Object.keys(w)) {
      const value = features[key];
      if (value == null) continue;
      sum += w[key] * value;
      total += w[key];
    }
    return total ? sum / total : 0;
  }

  /*
   * キャッシュ付きの比較器。
   */
  function createComparer(treeInfo, weights) {
    const cache = new Map();
    const effective = weights || WEIGHTS;
    return {
      weights: effective,
      compare(a, b) {
        if (a.number === b.number) return { score: 1, features: null };
        const key = pairKey(a, b);
        let hit = cache.get(key);
        if (!hit) {
          const features = computeFeatures(a, b, treeInfo);
          hit = { score: combine(features, effective), features };
          cache.set(key, hit);
        }
        return hit;
      },
      score(a, b) { return this.compare(a, b).score; },
      size() { return cache.size; },
      clear() { cache.clear(); },
    };
  }

  return {
    WEIGHTS,
    ngrams,
    dice,
    jaccard,
    intersectionSize,
    ratio,
    prepare,
    computeFeatures,
    combine,
    createComparer,
    segmentProfileScore,
    segmentAlignedScore,
    treeScore,
  };
});

/*
 * grouping.js — 自動グルーピング（DOM 非依存）
 *
 * 意味解析はしない。決定論的な文字列処理とクレームツリー解析で「比較候補」を作る。
 * 目的は法的同一性の判定ではなく、**人が見比べるための束**を広めに作ることなので、
 * 送信/受信・同じ/異なる のような意味差でここから除外することはしない。
 * 引用先が違うという理由だけで候補から外すこともしない（引用関係は補助情報）。
 *
 * 4 つの作り方（strategy）を併走させ、結果を重ねて出す。1 つの請求項が複数の
 * グループに属してよい。
 *
 *   tree     … 並行サブツリー。複数の独立項を起点とする部分木の形が一致するとき、
 *              親から見た相対位置（DFS 前順の同じ位置）どうしを対応させる。
 *              請求項番号の差を固定加算するのではないので、番号が飛んでいても成立する。
 *   category … 独立項を請求項カテゴリー（末尾語から判定。未知の語でも系列として扱う）でまとめる。
 *   text     … 字面の類似度による「種を作って育てる」クラスタリング（下記）。
 *   cite     … 同じ請求項集合を引用する請求項／同じ親を引く兄弟従属項。
 *
 * グループの育て方:
 *   「A と B が似ている、B と C が似ている」だけで A・B・C を無条件にまとめない。
 *   最も似ているペアを種にし、追加は **グループ全体との平均** と
 *   **どのメンバーとも最低限似ていること** の両方で判断する。
 *   1 件とだけ似ているものは確定せず「追加候補」として別に持つ。
 *   どのグループにも入らなかった請求項は「未グループ」として最後にまとめて出す。
 *
 * 案件固有のものは一切書かない。請求項番号・番号差・技術用語・グループ数・系列数・
 * ツリー形状のいずれも定数として持たず、すべて対象案件から抽出した情報だけで決める。
 * 重みとしきい値は settings.js に集約している。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./similarity'), require('./tree'), require('./settings'));
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['similarity', 'tree', 'settings']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.grouping = factory(root.JCGC.similarity, root.JCGC.tree, root.JCGC.settings);
  }
})(globalThis, function (similarity, treeModule, settings) {
  'use strict';

  const PRESETS = settings.GROUPING_PRESETS;
  const DEFAULT_PRESET = settings.DEFAULT_PRESET;
  const MAX_GROUP_SIZE = settings.MAX_GROUP_SIZE;
  const MAX_CANDIDATES = settings.MAX_CANDIDATES;
  // サブツリー対応を試す最小のサブツリー規模（葉だけの独立項は形が同じでも束ねない）
  const MIN_SUBTREE_SIZE = 2;
  // 根拠に載せる最大件数（多すぎるとカードが押し下げられて読めない）
  const MAX_REASONS = 8;

  function getPreset(name) {
    return PRESETS[name] || PRESETS[DEFAULT_PRESET];
  }

  // カテゴリーの表示名。記録が欠けていても "undefined" を画面へ出さない
  function categoryLabelOf(claim) {
    return (claim && (claim.categoryGroupLabel || claim.categoryLabel)) || 'カテゴリー不明';
  }

  function byNumber(claims) {
    const map = new Map();
    for (const c of claims) map.set(c.number, c);
    return map;
  }

  function meanPairScore(members, comparer) {
    if (members.length < 2) return 1;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        sum += comparer.score(members[i], members[j]);
        n += 1;
      }
    }
    return n ? sum / n : 1;
  }

  function meanFeatures(members, comparer) {
    const acc = {};
    const counts = {};
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const f = comparer.compare(members[i], members[j]).features;
        if (!f) continue;
        for (const key of Object.keys(f)) {
          if (f[key] == null) continue;
          acc[key] = (acc[key] || 0) + f[key];
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    }
    if (!Object.keys(acc).length) return null;
    for (const key of Object.keys(acc)) acc[key] /= counts[key];
    return acc;
  }

  // 冒頭段落どうしの一致度（「冒頭構造が類似」の根拠に使う）
  function leadSimilarity(members) {
    if (members.length < 2) return 1;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = (members[i].normalizedSegments || [])[0] || '';
        const b = (members[j].normalizedSegments || [])[0] || '';
        sum += similarity.dice(similarity.ngrams(a, 3), similarity.ngrams(b, 3));
        n += 1;
      }
    }
    return n ? sum / n : 1;
  }

  /*
   * グループ化の根拠（人が読む用）。数値ではなく「なぜ束ねたか」を並べる。
   * 同じ論点（topic）は 1 行だけ残すので、strategy 側の説明と特徴量からの説明が
   * 二重に出たり、食い違ったりしない。
   * extra は [{ topic, text }]（strategy 固有の説明。同じ topic があればこちらが勝つ）。
   */
  function buildReasons(members, comparer, extra) {
    const entries = extra ? extra.slice() : [];
    if (members.length >= 2) {
      if (members.every((m) => m.isIndependent)) entries.push({ topic: 'role', text: 'すべて独立項' });
      else if (members.every((m) => !m.isIndependent)) entries.push({ topic: 'role', text: 'すべて従属項' });

      const categories = new Set(members.map((m) => m.categoryKey));
      if (categories.size === 1) {
        entries.push({ topic: 'category', text: categoryLabelOf(members[0]) + 'カテゴリー' });
      } else if (categories.size === members.length) {
        entries.push({ topic: 'category', text: 'カテゴリーが互いに異なる（カテゴリー違いの対応候補）' });
      }

      const f = meanFeatures(members, comparer);
      if (f) {
        if (f.char3 >= 0.50) entries.push({ topic: 'chars', text: '字面がほぼ一致（文字3-gram）' });
        else if (f.char3 >= 0.25) entries.push({ topic: 'chars', text: '字面が部分的に一致（文字3-gram）' });
        if (f.words >= 0.35) entries.push({ topic: 'words', text: '共通する単語が多い' });
        if (f.termClass != null && f.termClass >= 0.40) {
          entries.push({ topic: 'termclass', text: '解析画面の用語クラス（前記語）が共通' });
        }
        if (f.segCount >= 0.80) entries.push({ topic: 'segcount', text: '段落数が近い' });
        if (f.segAligned >= 0.30) entries.push({ topic: 'segorder', text: '段落の順番と内容が対応' });
        if (f.tree >= 0.85) entries.push({ topic: 'tree-position', text: 'クレームツリー上の相対位置が対応' });
        if (f.cite >= 0.90) entries.push({ topic: 'cite', text: '引用先が同じ' });
      }
      if (leadSimilarity(members) >= 0.40) entries.push({ topic: 'lead', text: '冒頭部分の文字列が類似' });
    }

    const seenTopic = new Set();
    const out = [];
    for (const entry of entries) {
      if (seenTopic.has(entry.topic)) continue;
      seenTopic.add(entry.topic);
      out.push(entry.text);
      if (out.length >= MAX_REASONS) break;
    }
    return out;
  }

  /* ---- 種を作って育てるクラスタリング -------------------------------- */
  /*
   * items をグループへ分ける。
   * thresholds: { seedPair, memberAverage, memberMinimum, candidate }
   * → [{ members: [claim], candidates: [{ claim, score }] }]
   *
   * 正式メンバーはこの strategy 内で重複させない（帰属を一意にする）。
   * 追加候補は確定ではないので、複数のグループに現れてよい。
   */
  function seedAndGrow(items, comparer, thresholds, maxSize) {
    const limit = maxSize || MAX_GROUP_SIZE;
    const list = items.slice().sort((a, b) => a.number - b.number);
    if (list.length < 2) return [];

    // 種にできるペアを類似度の高い順に（同点は請求項番号で決める）
    const seeds = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const score = comparer.score(list[i], list[j]);
        if (score >= thresholds.seedPair) seeds.push({ a: list[i], b: list[j], score });
      }
    }
    seeds.sort((x, y) => (y.score - x.score) || (x.a.number - y.a.number) || (x.b.number - y.b.number));

    const assigned = new Set();
    const groups = [];

    for (const seed of seeds) {
      if (assigned.has(seed.a.number) || assigned.has(seed.b.number)) continue;
      const members = [seed.a, seed.b];
      assigned.add(seed.a.number);
      assigned.add(seed.b.number);

      // グループ全体との関係を見ながら、1 件ずつ育てる
      for (;;) {
        if (members.length >= limit) break;
        let best = null;
        for (const candidate of list) {
          if (assigned.has(candidate.number)) continue;
          const scores = members.map((m) => comparer.score(candidate, m));
          const average = scores.reduce((s, v) => s + v, 0) / scores.length;
          const minimum = Math.min.apply(null, scores);
          if (average < thresholds.memberAverage || minimum < thresholds.memberMinimum) continue;
          if (!best || average > best.average + 1e-12
            || (Math.abs(average - best.average) <= 1e-12 && candidate.number < best.claim.number)) {
            best = { claim: candidate, average };
          }
        }
        if (!best) break;
        members.push(best.claim);
        assigned.add(best.claim.number);
      }

      members.sort((a, b) => a.number - b.number);

      // 「1 件とだけ似ている」ものは確定せず追加候補にする
      const candidates = [];
      for (const claim of list) {
        if (members.indexOf(claim) !== -1) continue;
        let top = 0;
        for (const member of members) top = Math.max(top, comparer.score(claim, member));
        if (top >= thresholds.candidate) candidates.push({ claim, score: top });
      }
      candidates.sort((x, y) => (y.score - x.score) || (x.claim.number - y.claim.number));

      const room = Math.max(0, Math.min(MAX_CANDIDATES, limit - members.length));
      groups.push({ members, candidates: candidates.slice(0, room) });
    }

    return groups.sort((a, b) => a.members[0].number - b.members[0].number);
  }

  /* ---- strategy: 並行サブツリー --------------------------------------- */
  function shapeKey(node, loose) {
    return loose
      ? 'L' + node.size + ':' + node.height + ':' + node.children.length
      : 'S' + node.shape;
  }

  function treeGroups(claims, treeInfo, comparer, preset) {
    const map = byNumber(claims);
    const buckets = new Map();

    for (const rootNumber of treeInfo.roots) {
      const node = treeInfo.get(rootNumber);
      if (!node || node.size < MIN_SUBTREE_SIZE) continue;
      const key = shapeKey(node, false);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(rootNumber);
    }

    if (preset.looseShape) {
      // 形が完全一致した起点は厳密側で拾えているので、近似側では扱わない
      // （同じ顔ぶれのグループが「完全一致」「近似」の両方の根拠を持ってしまうため）
      const strictCovered = new Set();
      for (const roots of buckets.values()) {
        if (roots.length >= 2) for (const rootNumber of roots) strictCovered.add(rootNumber);
      }
      const loose = new Map();
      for (const rootNumber of treeInfo.roots) {
        if (strictCovered.has(rootNumber)) continue;
        const node = treeInfo.get(rootNumber);
        if (!node || node.size < MIN_SUBTREE_SIZE) continue;
        const key = shapeKey(node, true);
        if (!loose.has(key)) loose.set(key, []);
        loose.get(key).push(rootNumber);
      }
      for (const [key, roots] of loose) {
        if (roots.length < 2) continue;
        if (!buckets.has(key)) buckets.set(key, roots);
      }
    }

    const groups = [];
    for (const [key, roots] of buckets) {
      if (roots.length < 2) continue;
      const preorders = roots.map((r) => treeInfo.preorder(r));
      const length = preorders[0].length;
      if (!preorders.every((p) => p.length === length)) continue;

      // 起点どうしの字面が近いことも（強度に応じて）確かめる
      const rootMembers = roots.map((r) => map.get(r)).filter(Boolean);
      if (rootMembers.length < 2) continue;
      if (preset.rootAffinity > 0 && meanPairScore(rootMembers, comparer) < preset.rootAffinity) continue;

      for (let position = 0; position < length; position += 1) {
        const numbers = preorders.map((p) => p[position]);
        const members = numbers.map((n) => map.get(n)).filter(Boolean);
        if (members.length < 2) continue;
        const node = treeInfo.get(numbers[0]);
        const depthLabel = (node ? node.depth : 0) + 1;
        const branch = node && node.path.length
          ? '（枝 ' + node.path.map((i) => i + 1).join('-') + '）'
          : '';
        groups.push({
          strategy: 'tree',
          claimNumbers: members.map((m) => m.number).sort((a, b) => a - b),
          candidateNumbers: [],
          name: '並行ツリー ' + depthLabel + '段目' + branch,
          score: meanPairScore(members, comparer),
          reasons: buildReasons(members, comparer, [
            {
              topic: 'tree-shape',
              text: key.charAt(0) === 'L'
                ? '複数の独立項を起点とするサブツリーの規模と高さが一致（形は近似）'
                : '複数の独立項を起点とするサブツリーの形が完全に一致',
            },
            { topic: 'tree-position', text: 'クレームツリー上の相対位置（親から見た枝の順番）が対応' },
          ]),
        });
      }
    }
    return groups;
  }

  /* ---- strategy: 独立項のカテゴリー ----------------------------------- */
  function categoryGroups(claims, comparer, preset) {
    const independents = claims.filter((c) => c.isIndependent);
    const buckets = new Map();
    for (const claim of independents) {
      const key = claim.categoryKey;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(claim);
    }
    const groups = [];
    for (const members of buckets.values()) {
      if (members.length < 2 || members.length > MAX_GROUP_SIZE) continue;
      const f = meanFeatures(members, comparer);
      // カテゴリーが同じというだけでは束ねない。字面の下限を強度で変える
      if (!f || f.char3 < preset.category) continue;
      groups.push({
        strategy: 'category',
        claimNumbers: members.map((m) => m.number).sort((a, b) => a - b),
        candidateNumbers: [],
        name: '独立項・' + categoryLabelOf(members[0]),
        score: meanPairScore(members, comparer),
        reasons: buildReasons(members, comparer, [
          { topic: 'method', text: '独立項どうしを請求項カテゴリー（' + categoryLabelOf(members[0]) + '）でまとめた' },
        ]),
      });
    }
    return groups;
  }

  /* ---- strategy: 字面クラスタリング ----------------------------------- */
  function textGroups(claims, comparer, preset) {
    const clusters = seedAndGrow(claims, comparer, {
      seedPair: preset.seedPair,
      memberAverage: preset.memberAverage,
      memberMinimum: preset.memberMinimum,
      candidate: preset.candidate,
    });
    const groups = [];
    for (const cluster of clusters) {
      const members = cluster.members;
      if (members.length < 2) continue;
      const categories = new Set(members.map((m) => m.categoryKey));
      const suffix = categories.size === 1 ? '・' + categoryLabelOf(members[0]) : '';
      groups.push({
        strategy: 'text',
        claimNumbers: members.map((m) => m.number).sort((a, b) => a - b),
        candidateNumbers: cluster.candidates.map((c) => c.claim.number),
        name: '類似記載' + suffix,
        score: meanPairScore(members, comparer),
        reasons: buildReasons(members, comparer, [
          { topic: 'method', text: '字面の類似度でまとめた（グループ全体との平均と最低値の両方を確認）' },
        ]),
      });
    }
    return groups;
  }

  /* ---- strategy: 同一引用集合 ----------------------------------------- */
  function citeGroups(claims, comparer, preset) {
    const buckets = new Map();
    for (const claim of claims) {
      if (!claim.citations || !claim.citations.length) continue;
      const key = claim.citations.join(',');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(claim);
    }

    const groups = [];
    for (const [key, members] of buckets) {
      if (members.length < 2) continue;
      const citedNumbers = key.split(',').map(Number);
      const citedLabel = citedNumbers.length > 3
        ? '請求項' + citedNumbers[0] + '〜' + citedNumbers[citedNumbers.length - 1]
        : citedNumbers.map((n) => '請求項' + n).join('・');

      // 多項従属が同じ集合を引くケースは、それ自体が強い対応の手がかり
      if (citedNumbers.length >= 2 && members.length <= MAX_GROUP_SIZE) {
        groups.push({
          strategy: 'cite',
          claimNumbers: members.map((m) => m.number).sort((a, b) => a - b),
          candidateNumbers: [],
          name: '同一引用（' + citedLabel + '）',
          score: meanPairScore(members, comparer),
          reasons: buildReasons(members, comparer, [
            { topic: 'cite', text: citedLabel + ' を同じ組み合わせで引用している' },
          ]),
        });
      }

      // 兄弟（同じ親を引く従属項）どうしの近さでも束ねる
      const siblingClusters = seedAndGrow(members, comparer, {
        seedPair: preset.sibling,
        memberAverage: preset.sibling * 0.85,
        memberMinimum: preset.sibling * 0.6,
        candidate: preset.sibling * 0.8,
      });
      for (const cluster of siblingClusters) {
        if (cluster.members.length < 2) continue;
        if (cluster.members.length === members.length && citedNumbers.length >= 2) continue;
        groups.push({
          strategy: 'sibling',
          claimNumbers: cluster.members.map((m) => m.number).sort((a, b) => a - b),
          candidateNumbers: cluster.candidates.map((c) => c.claim.number),
          name: '兄弟従属項（' + citedLabel + 'の下位）',
          score: meanPairScore(cluster.members, comparer),
          reasons: buildReasons(cluster.members, comparer, [
            { topic: 'cite', text: '同じ請求項（' + citedLabel + '）を引用する従属項どうし' },
          ]),
        });
      }
    }
    return groups;
  }

  /* ---- まとめ --------------------------------------------------------- */
  const STRATEGY_ORDER = ['tree', 'category', 'text', 'cite', 'sibling', 'ungrouped'];

  function dedupe(groups) {
    const seen = new Map();
    for (const group of groups) {
      const key = group.claimNumbers.join(',');
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, group);
        continue;
      }
      // 同じ顔ぶれなら、根拠を統合して優先度の高い strategy を残す
      const prevRank = STRATEGY_ORDER.indexOf(prev.strategy);
      const rank = STRATEGY_ORDER.indexOf(group.strategy);
      const keep = rank < prevRank ? group : prev;
      const drop = keep === group ? prev : group;
      keep.reasons = keep.reasons
        .concat(drop.reasons.filter((r) => keep.reasons.indexOf(r) === -1))
        .slice(0, MAX_REASONS);
      keep.score = Math.max(keep.score, drop.score);
      if (!keep.candidateNumbers.length) keep.candidateNumbers = drop.candidateNumbers;
      seen.set(key, keep);
    }

    const list = Array.from(seen.values());
    // 同じ strategy 内で、他のグループに完全に含まれるものは落とす
    return list.filter((group) => !list.some((other) => other !== group
      && other.strategy === group.strategy
      && other.claimNumbers.length > group.claimNumbers.length
      && group.claimNumbers.every((n) => other.claimNumbers.indexOf(n) !== -1)));
  }

  /*
   * 自動グルーピング本体。
   * options: { preset, weights, tree, comparer }
   * → { groups, ungrouped, preset, comparer, tree }
   *   groups[].claimNumbers      … 正式メンバー
   *   groups[].candidateNumbers  … 追加候補（自動では確定しない）
   */
  function autoGroup(claims, options) {
    const opts = options || {};
    const preset = getPreset(opts.preset);
    const list = (claims || []).slice().sort((a, b) => a.number - b.number);
    const treeInfo = opts.tree || treeModule.buildTree(list);
    const comparer = opts.comparer || similarity.createComparer(treeInfo, opts.weights);

    if (list.length < 2) {
      return { groups: [], ungrouped: list.map((c) => c.number), preset, comparer, tree: treeInfo };
    }

    const collected = []
      .concat(treeGroups(list, treeInfo, comparer, preset))
      .concat(categoryGroups(list, comparer, preset))
      .concat(textGroups(list, comparer, preset))
      .concat(citeGroups(list, comparer, preset));

    const deduped = dedupe(collected).sort((a, b) => {
      const rank = STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy);
      if (rank !== 0) return rank;
      if (a.claimNumbers[0] !== b.claimNumbers[0]) return a.claimNumbers[0] - b.claimNumbers[0];
      return a.claimNumbers.length - b.claimNumbers.length;
    });

    // どのグループにも正式メンバーとして入らなかった請求項
    const grouped = new Set();
    for (const group of deduped) for (const n of group.claimNumbers) grouped.add(n);
    const ungrouped = list.map((c) => c.number).filter((n) => !grouped.has(n));

    if (ungrouped.length) {
      deduped.push({
        strategy: 'ungrouped',
        claimNumbers: ungrouped.slice(0, MAX_GROUP_SIZE),
        candidateNumbers: [],
        name: '未グループの請求項',
        score: null,
        reasons: ['どのグループにも十分には似ていなかった請求項です。手動でグループへ入れられます。'],
      });
    }

    const groups = deduped.map((group, index) => ({
      id: 'auto-' + preset.key + '-' + (index + 1),
      name: group.name,
      claimNumbers: group.claimNumbers,
      candidateNumbers: group.candidateNumbers || [],
      source: 'auto',
      strategy: group.strategy,
      score: group.score == null ? null : Math.round(group.score * 1000) / 1000,
      reasons: group.reasons,
      manuallyEdited: false,
      order: index + 1,
    }));

    return { groups, ungrouped, preset, comparer, tree: treeInfo };
  }

  return {
    PRESETS,
    DEFAULT_PRESET,
    MAX_GROUP_SIZE,
    getPreset,
    autoGroup,
    seedAndGrow,
    treeGroups,
    categoryGroups,
    textGroups,
    citeGroups,
    buildReasons,
    categoryLabelOf,
    meanPairScore,
    meanFeatures,
  };
});

/*
 * segmatch.js — 段落どうしの対応付け（DOM 非依存）
 *
 * 意味は分からないまま、日本語クレームの**書き方に共通する構造**だけを手掛かりに、
 * 「見比べたい段落」を対応させる。意味解析も動的計画法も学習も使わない。
 * 案件固有の語・番号・対応表は一切持たない。
 *
 * ── 使っている一般則 ────────────────────────────────────────
 *
 * (1) 塊（block）を作る。1 つの構成要件が段落に割れていることがあるため。
 *     a. 段落の末尾が接続語（又は・若しくは・及び・並びに・かつ…）→ 次の段落と同じ塊
 *     b. 次の段落の先頭がその接続語 → 前の段落と同じ塊
 *     c. 段落の末尾が「…は、」「…として、」のように述語が来ていない形 → 次の段落と同じ塊
 *     d. 次の段落のインデント（全角空白の連なり）が塊の先頭より深い → 同じ塊（列挙の入れ子）
 *     いずれも日本語の書き方の話で、技術分野に依存しない。
 *     表示（原文と段落番号）は塊にせず元のまま分けて出し、**反応だけ**を塊単位にする。
 *     塊は「1 つの構成要件かもしれない」という仮説にすぎないので、相手側は
 *     「塊」と「その中の個々の段落」の両方を候補にして良い方を採る
 *     （塊にまとめたせいで本来の対応が消えないようにする）。
 *
 * (2) 向きが逆なだけの対応を認める。
 *     「◯◯において XX を送信すること」と「△△において XX を受信すること」は、
 *     主体が入れ替わっただけで同じやり取りを指す。素の文字列と、向きの語を畳んだ文字列の
 *     **両方で計算して高い方を採る**ので、向きが同じ一致は最高点のまま、
 *     向きが逆の対応は他に候補が無いときだけ浮かび上がる。
 *
 * (3) 対応は 1 対 1 とはかぎらない。
 *     一方で 2 段落に割れている内容が、他方では 1 段落にまとまっていることがある。
 *     最高点から relatedMargin 以内の候補と、逆向きに引くと戻ってくる候補（相互対応）を
 *     まとめて拾うので、どちらの側を選んでも同じ組が反応する。
 *
 * (4) 点が拮抗したときだけ、**相対位置**（i/n と j/m）が近い方を先に出す。
 *     構成要件は書かれた順に並ぶので、段落数が違う請求項どうしでも順序は保たれやすい。
 *     絶対的な段落番号では段落数の違う請求項を比べられないため、相対位置を使う。
 *
 * ── 誤対応の防止 ────────────────────────────────────────────
 *   - 最低条件（共通語が複数／十分な長さの共通連続文字列／共通用語クラス）を満たさない候補は見ない
 *   - 合計点が minScore 未満なら選ばない
 *   - 十分に似た段落が無いとき、**同じ段落番号へフォールバックしない**
 *     （誤った段落を強調するより、何も強調しないことを優先する）
 *
 * 比較用データ（正規化文字列・単語集合・文字3-gram・用語クラス・塊）は createMatcher() の
 * 時点で全部作ってキャッシュする。クリックのたびに抽出も正規化もしない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./normalize'), require('./similarity'), require('./settings'));
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['normalize', 'similarity', 'settings']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.segmatch = factory(root.JCGC.normalize, root.JCGC.similarity, root.JCGC.settings);
  }
})(globalThis, function (normalize, similarity, settings) {
  'use strict';

  const WEIGHTS = settings.SEGMENT_WEIGHTS;
  const RULES = settings.SEGMENT_RULES;
  const DIRECTION_PAIRS = settings.SEGMENT_DIRECTION_PAIRS || [];
  const CONNECTIVES = settings.SEGMENT_BLOCK_CONNECTIVES || [];
  const CONTINUATIONS = settings.SEGMENT_CONTINUATION_SUFFIXES || [];
  const MAX_BLOCK_SEGMENTS = settings.MAX_BLOCK_SEGMENTS || 4;

  const TRAILING_PUNCT = /[、，,。．.\s　]+$/;
  const LEADING_PUNCT = /^[、，,\s　]+/;

  // 向きが逆なだけの語を、対ごとの共通トークンへ畳む（段落の対応付けでのみ使う）
  function foldDirections(text) {
    let out = String(text == null ? '' : text);
    DIRECTION_PAIRS.forEach((pair, index) => {
      // 本文に出ない私用領域の 1 文字へ寄せる（長さの差は length 特徴が吸収する）
      const token = String.fromCharCode(0xe000 + index);
      for (const word of pair) out = out.split(word).join(token);
    });
    return out;
  }

  function hasDirectionWord(text) {
    for (const pair of DIRECTION_PAIRS) {
      for (const word of pair) if (text.indexOf(word) !== -1) return true;
    }
    return false;
  }

  function endsWithAny(text, words) {
    const trimmed = String(text || '').replace(TRAILING_PUNCT, '');
    return words.some((word) => trimmed.endsWith(word));
  }

  function startsWithAny(text, words) {
    const trimmed = String(text || '').replace(LEADING_PUNCT, '');
    return words.some((word) => trimmed.startsWith(word));
  }

  /*
   * 段落を塊へまとめる（一般則 (1)）。
   * segments: [{ index, text, depth }]（原文。正規化前のものを使う）
   * → [[段落番号...], ...]
   */
  function buildBlocks(segments) {
    const list = segments || [];
    const blocks = [];
    let current = null;

    for (let i = 0; i < list.length; i += 1) {
      const segment = list[i];
      const previous = i > 0 ? list[i - 1] : null;
      const continues = current && current.length < MAX_BLOCK_SEGMENTS && previous && (
        // a. 前の段落の末尾が接続語
        endsWithAny(previous.text, CONNECTIVES)
        // b. この段落の先頭が接続語
        || startsWithAny(segment.text, CONNECTIVES)
        // c. 前の段落が「…は、」「…として、」で終わり、述語が来ていない
        || endsWithAny(previous.text, CONTINUATIONS)
        // d. 塊の先頭より深いインデント（列挙の入れ子）
        || (current.depth != null && segment.depth > current.depth)
      );

      if (continues) {
        current.push(segment.index);
      } else {
        current = [segment.index];
        current.depth = segment.depth;
        blocks.push(current);
      }
    }

    return blocks.map((block) => block.slice());
  }

  /*
   * createMatcher(claims)
   *   claims: extractor が返す請求項レコードの配列
   *           （normalizedSegments を必須、segments / segmentTermClasses があれば使う）
   */
  function createMatcher(claims) {
    const list = claims || [];
    const perClaim = new Map();      // 請求項番号 → { blocks, byIndex }

    // 1 まとまり分の比較用データ。folded は「向きの語を畳んだ版」（無ければ raw と同じ）
    function buildView(text) {
      // 末尾（述語のあたり）。構成要件の動作は日本語では文末に来る
      const tail = text.length > RULES.tailLength ? text.slice(-RULES.tailLength) : text;
      return {
        text,
        words: normalize.keyTerms(text),
        g3: similarity.ngrams(text, 3),
        g2: similarity.ngrams(text, 2),
        tail: similarity.ngrams(tail, 3),
        // 「十分な長さの共通連続文字列」を安く判定するための n-gram 集合
        long: similarity.ngrams(text, RULES.substringLength),
      };
    }

    for (const claim of list) {
      const normalizedSegments = claim.normalizedSegments || [];
      const segmentClasses = claim.segmentTermClasses || [];
      const segments = claim.segments && claim.segments.length === normalizedSegments.length
        ? claim.segments
        : normalizedSegments.map((t, i) => ({ index: i + 1, text: t, depth: 1 }));

      const indexBlocks = buildBlocks(segments);

      const makeUnit = (indexes, position, isBlock) => {
        const text = indexes.map((n) => normalizedSegments[n - 1] || '').join('');
        const raw = buildView(text);
        const folded = foldDirections(text);
        const classes = new Set();
        for (const n of indexes) for (const cls of (segmentClasses[n - 1] || [])) classes.add(cls);
        return {
          indexes: indexes.slice(),
          position,
          isBlock,
          raw,
          folded: folded === text ? raw : buildView(folded),
          hasDirection: hasDirectionWord(text),
          classes,
        };
      };

      const blocks = indexBlocks.map((indexes, position) => makeUnit(indexes, position, true));

      /*
       * 照合の単位。塊は「1 つの構成要件かもしれない」という**仮説**にすぎないので、
       * 塊にまとめたせいで本来の対応が消えないよう、
       * 相手側は「塊」と「その中の個々の段落」の両方を候補にして良い方を採る。
       * 相対位置は、単独の段落でも属する塊の位置を使う（順序の手掛かりを保つ）。
       */
      const units = blocks.slice();
      blocks.forEach((block) => {
        if (block.indexes.length < 2) return;
        for (const n of block.indexes) units.push(makeUnit([n], block.position, false));
      });

      const byIndex = new Map();
      for (const block of blocks) for (const n of block.indexes) byIndex.set(n, block);
      perClaim.set(claim.number, { blocks, units, byIndex });
    }

    function viewScore(a, b) {
      return WEIGHTS.words * similarity.dice(a.words, b.words)
        + WEIGHTS.tail * similarity.dice(a.tail, b.tail)
        + WEIGHTS.char3 * similarity.dice(a.g3, b.g3)
        + WEIGHTS.char2 * similarity.dice(a.g2, b.g2)
        + WEIGHTS.length * similarity.ratio(a.text.length, b.text.length);
    }

    /*
     * 素の文字列と、向きの語を畳んだ文字列の両方で計算して高い方を採る（一般則 (2)）。
     * direct=false は「向きを畳んで初めて一致した」ことを表し、同点のときは
     * 向きが同じ候補（direct=true）を優先する。
     */
    function scoreBlocks(a, b) {
      const rawScore = viewScore(a.raw, b.raw);
      let score = rawScore;
      let direct = true;
      if (a.hasDirection || b.hasDirection) {
        const foldedScore = viewScore(a.folded, b.folded);
        if (foldedScore > rawScore) { score = foldedScore; direct = false; }
      }
      const classBonus = (a.classes.size && b.classes.size)
        ? RULES.termClassBonus * similarity.jaccard(a.classes, b.classes) : 0;
      return { score: Math.min(1, score + classBonus), direct };
    }

    // 最低条件。どれか 1 つでも満たせばよい（畳んだ版でも見る）
    function meetsMinimum(a, b) {
      if (a.classes.size && b.classes.size
        && similarity.intersectionSize(a.classes, b.classes) >= 1) return true;
      const views = (a.hasDirection || b.hasDirection)
        ? [[a.raw, b.raw], [a.folded, b.folded]] : [[a.raw, b.raw]];
      for (const [x, y] of views) {
        if (similarity.intersectionSize(x.words, y.words) >= RULES.minSharedWords) return true;
        if (x.long.size && y.long.size && similarity.intersectionSize(x.long, y.long) >= 1) return true;
      }
      return false;
    }

    // 塊の相対位置（0〜1）。段落数の違う請求項どうしを比べるため、絶対番号は使わない
    function relativePosition(entry, total) {
      return total <= 1 ? 0 : entry.position / (total - 1);
    }

    const rankCache = new Map();
    const matchCache = new Map();

    /*
     * source の塊に対する target の塊を、点の高い順に並べる。
     * 同点のときだけ「向きが同じ」→「相対位置が近い」の順で優劣を付ける（一般則 (4)）。
     */
    function rankBlocks(sourceNumber, sourceIndex, targetNumber) {
      const key = sourceNumber + ':' + sourceIndex + ':' + targetNumber;
      if (rankCache.has(key)) return rankCache.get(key);

      const source = perClaim.get(sourceNumber);
      const target = perClaim.get(targetNumber);
      const ranked = [];
      const sourceBlock = source && source.byIndex.get(sourceIndex);

      if (sourceBlock && target) {
        const sourcePos = relativePosition(sourceBlock, source.blocks.length);
        /*
         * 選択側も「塊」と「その段落だけ」の両方で当ててみて、良い方の点を使う。
         * 強調は塊単位のまま（割れた選択肢は一緒に光る）だが、塊にまとめたことで
         * 対応が消えてしまうのを防ぐ。
         */
        const sourceUnits = [sourceBlock];
        if (sourceBlock.indexes.length > 1) {
          const single = source.units.find((u) => !u.isBlock && u.indexes[0] === sourceIndex);
          if (single) sourceUnits.push(single);
        }

        for (const block of target.units) {
          let scored = null;
          for (const unit of sourceUnits) {
            if (!meetsMinimum(unit, block)) continue;
            const candidate = scoreBlocks(unit, block);
            if (!scored || candidate.score > scored.score) scored = candidate;
          }
          if (!scored || scored.score < RULES.minScore) continue;
          ranked.push({
            block,
            indexes: block.indexes,
            index: block.indexes[0],
            score: scored.score,
            direct: scored.direct,
            positionGap: Math.abs(relativePosition(block, target.blocks.length) - sourcePos),
          });
        }
        ranked.sort((x, y) => (y.score - x.score)
          || ((x.direct === y.direct) ? 0 : (x.direct ? -1 : 1))
          || (x.positionGap - y.positionGap)
          || (y.indexes.length - x.indexes.length)
          || (x.index - y.index));
        // 同じ段落を含む単位が重複して並ばないよう、上位から見て既出の段落は落とす
        const taken = new Set();
        const unique = [];
        for (const entry of ranked) {
          if (entry.indexes.some((n) => taken.has(n))) continue;
          for (const n of entry.indexes) taken.add(n);
          unique.push(entry);
        }
        ranked.length = 0;
        for (const entry of unique) ranked.push(entry);
      }

      rankCache.set(key, ranked);
      return ranked;
    }

    /*
     * 最も対応する塊を 1 つ返す（互換用）。無ければ null
     * → { index（塊の先頭段落番号）, indexes, score }
     */
    function bestMatch(sourceNumber, sourceIndex, targetNumber) {
      const ranked = rankBlocks(sourceNumber, sourceIndex, targetNumber);
      if (!ranked.length) return null;
      const top = ranked[0];
      return { index: top.index, indexes: top.indexes.slice(), score: top.score };
    }

    /*
     * 対応する段落を **すべて** 返す（一般則 (3)）。
     *   a) 最高点から relatedMargin 以内の塊
     *   b) 逆向きに引いたとき選択中の段落へ戻ってくる塊（相互対応）
     * → [{ index, indexes, score, mutual }]（点の高い順・最大 maxMatches 塊）
     */
    function matchAll(sourceNumber, sourceIndex, targetNumber) {
      const key = sourceNumber + ':' + sourceIndex + ':' + targetNumber;
      if (matchCache.has(key)) return matchCache.get(key);

      const ranked = rankBlocks(sourceNumber, sourceIndex, targetNumber);
      let picked = [];
      if (ranked.length) {
        const top = ranked[0].score;
        for (const candidate of ranked) {
          const near = (top - candidate.score) <= RULES.relatedMargin;
          // 逆向きに引くと選択中の段落を含む塊へ戻る＝相互に対応している
          const back = rankBlocks(targetNumber, candidate.index, sourceNumber);
          const mutual = back.length > 0 && back[0].indexes.indexOf(sourceIndex) !== -1;
          if (near || mutual) {
            picked.push({
              index: candidate.index,
              indexes: candidate.indexes.slice(),
              score: candidate.score,
              mutual,
            });
          }
        }
        picked = picked.slice(0, RULES.maxMatches);
      }

      matchCache.set(key, picked);
      return picked;
    }

    /*
     * 表示側が使う解決関数。
     *   - 自分自身なら、選んだ段落が属する塊すべて（割れた選択肢を一緒に見せる）
     *   - 対応する塊があればその段落すべて
     *   - 無ければ null（同じ段落番号へは落とさない ＝「類似段落なし」）
     * → { indexes, scores, kind: 'self' | 'similar' } | null
     */
    function resolve(sourceNumber, sourceIndex, targetNumber, targetSegmentCount) {
      if (targetNumber === sourceNumber) {
        const source = perClaim.get(sourceNumber);
        const block = source && source.byIndex.get(sourceIndex);
        if (!block) {
          return sourceIndex >= 1 && sourceIndex <= targetSegmentCount
            ? { indexes: [sourceIndex], scores: [1], kind: 'self' } : null;
        }
        return { indexes: block.indexes.slice(), scores: block.indexes.map(() => 1), kind: 'self' };
      }
      const matches = matchAll(sourceNumber, sourceIndex, targetNumber);
      if (!matches.length) return null;
      const indexes = [];
      const scores = [];
      for (const match of matches) {
        for (const index of match.indexes) {
          if (indexes.indexOf(index) !== -1) continue;
          indexes.push(index);
          scores.push(match.score);
        }
      }
      return { indexes, scores, kind: 'similar' };
    }

    return {
      bestMatch,
      matchAll,
      resolve,
      rankBlocks,
      scoreBlocks,
      meetsMinimum,
      blocksOf(number) { return (perClaim.get(number) || { blocks: [] }).blocks; },
      unitsOf(number) { return (perClaim.get(number) || { units: [] }).units; },
      segmentsOf(number) { return (perClaim.get(number) || { blocks: [] }).blocks; },
      cacheSize() { return rankCache.size; },
      rules: RULES,
      weights: WEIGHTS,
    };
  }

  return { createMatcher, foldDirections, buildBlocks, WEIGHTS, RULES, DIRECTION_PAIRS };
});

/*
 * groupstate.js — グループと表示状態の管理（DOM 非依存・純粋）
 *
 * 画面（view/）はこのストアを読むだけにして、再描画のたびに手動編集が失われないようにする。
 * 「後から localStorage / JSON 保存を足せる構造」という要件のため、状態は
 * toJSON() / loadJSON() で丸ごと出し入れできる素の値だけで持つ。
 *
 * グループの形:
 *   { id, name, claimNumbers, candidateNumbers, source: 'auto'|'manual', strategy, score,
 *     reasons, manuallyEdited, order }
 *   claimNumbers     … 正式メンバー
 *   candidateNumbers … 追加候補（自動では確定しなかったもの。昇格・除外は手動）
 * 1 つの請求項が複数のグループに属してよい。1 グループ 100 請求項まで。
 *
 * 自動再グルーピングの規則（要件）:
 *   source==='manual' か manuallyEdited===true のグループは、明示的な上書き指示が
 *   ないかぎり消さない・書き換えない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.groupstate = factory();
  }
})(globalThis, function () {
  'use strict';

  const MAX_GROUP_SIZE = 100;
  const HISTORY_LIMIT = 50;

  function cloneGroups(groups) {
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      claimNumbers: g.claimNumbers.slice(),
      candidateNumbers: (g.candidateNumbers || []).slice(),
      source: g.source,
      strategy: g.strategy || '',
      score: g.score == null ? null : g.score,
      reasons: (g.reasons || []).slice(),
      manuallyEdited: !!g.manuallyEdited,
      order: g.order,
    }));
  }

  function uniqueNumbers(numbers) {
    const seen = new Set();
    const out = [];
    for (const n of numbers) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }

  /*
   * 「1,5,12,20」形式の一括入力を読む。
   * → { numbers, errors, duplicates, unknown }
   */
  function parseNumberList(text, validNumbers) {
    const valid = validNumbers ? new Set(validNumbers) : null;
    const raw = String(text == null ? '' : text)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
      .split(/[^0-9]+/)
      .filter((s) => s !== '');
    const tokens = String(text == null ? '' : text).replace(/[\s　]/g, '');
    const errors = [];
    const numbers = [];
    const duplicates = [];
    const unknown = [];

    if (tokens !== '' && /[^0-9０-９,、，・\-　\s]/.test(tokens)) {
      errors.push('数字とカンマ以外の文字が含まれています: ' + tokens.replace(/[0-9０-９,、，・\-]/g, '').slice(0, 20));
    }

    for (const token of raw) {
      const n = Number(token);
      if (!Number.isFinite(n) || n <= 0) { errors.push('請求項番号として読めません: ' + token); continue; }
      if (valid && !valid.has(n)) { unknown.push(n); continue; }
      if (numbers.indexOf(n) !== -1) { duplicates.push(n); continue; }
      numbers.push(n);
    }
    if (unknown.length) errors.push('存在しない請求項番号: ' + uniqueNumbers(unknown).join('、'));
    if (duplicates.length) errors.push('重複した請求項番号: ' + uniqueNumbers(duplicates).join('、'));
    if (numbers.length > MAX_GROUP_SIZE) {
      errors.push('1グループの上限（' + MAX_GROUP_SIZE + '請求項）を超えています: ' + numbers.length);
    }
    return { numbers, errors, duplicates: uniqueNumbers(duplicates), unknown: uniqueNumbers(unknown) };
  }

  /*
   * 複数グループのテキスト形式を読む。
   *   # グループ名
   *   1,5,12,20
   */
  function parseGroupsText(text, validNumbers) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const groups = [];
    const errors = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      if (!current.claimNumbers.length) {
        errors.push('「' + current.name + '」に請求項がありません');
      } else {
        groups.push(current);
      }
      current = null;
    };

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      if (trimmed.charAt(0) === '#') {
        flush();
        current = { name: trimmed.replace(/^#+\s*/, '') || ('グループ' + (groups.length + 1)), claimNumbers: [] };
        return;
      }
      if (!current) current = { name: 'グループ' + (groups.length + 1), claimNumbers: [] };
      const parsed = parseNumberList(trimmed, validNumbers);
      for (const e of parsed.errors) errors.push((i + 1) + '行目: ' + e);
      current.claimNumbers = uniqueNumbers(current.claimNumbers.concat(parsed.numbers));
    });
    flush();

    if (!groups.length && !errors.length) errors.push('グループを1つも読み取れませんでした');
    return { groups, errors };
  }

  function formatGroupsText(groups) {
    return groups.map((g) => '# ' + g.name + '\n' + g.claimNumbers.join(',')).join('\n\n') + '\n';
  }

  /* ---- ストア --------------------------------------------------------- */

  function createStore(init) {
    const options = init || {};
    const claims = (options.claims || []).slice().sort((a, b) => a.number - b.number);
    const claimNumbers = claims.map((c) => c.number);
    const validNumbers = new Set(claimNumbers);

    let autoBaseline = cloneGroups(options.autoGroups || []);
    let sequence = 0;

    const state = {
      groups: cloneGroups(autoBaseline),
      selectedGroupId: autoBaseline.length ? autoBaseline[0].id : null,
      selectedSegment: 0, // 0 = 全体
      // どの請求項の段落を選んだか（他カードはこれに似た段落を探す）。null = グループ先頭
      selectedSourceClaim: null,
      highlightMode: 'dim', // 'dim' = 選択段落を強調 / 'only' = 選択段落のみ
      columns: 'auto',
      density: 'normal',
      preset: options.preset || 'broad',
      viewMode: 'compare', // 'compare' | 'edit'
    };

    const history = [];
    const listeners = [];

    function snapshot() {
      history.push({ groups: cloneGroups(state.groups), selectedGroupId: state.selectedGroupId });
      if (history.length > HISTORY_LIMIT) history.shift();
    }

    function notify() {
      for (const fn of listeners.slice()) fn(state);
    }

    function nextId(prefix) {
      sequence += 1;
      return (prefix || 'group') + '-' + sequence + '-' + Date.now().toString(36);
    }

    function findGroup(id) {
      return state.groups.find((g) => g.id === id) || null;
    }

    function reorder() {
      state.groups.forEach((g, i) => { g.order = i + 1; });
    }

    function markEdited(group) {
      if (group.source === 'auto') group.manuallyEdited = true;
    }

    function ensureSelection() {
      if (state.selectedGroupId && findGroup(state.selectedGroupId)) return;
      state.selectedGroupId = state.groups.length ? state.groups[0].id : null;
    }

    const api = {
      /* --- 参照 --- */
      getState() { return state; },
      getClaims() { return claims; },
      getClaimNumbers() { return claimNumbers.slice(); },
      getClaim(number) { return claims.find((c) => c.number === number) || null; },
      getGroups() { return state.groups; },
      getGroup(id) { return findGroup(id); },
      getSelectedGroup() { return findGroup(state.selectedGroupId); },
      canUndo() { return history.length > 0; },
      isValidNumber(n) { return validNumbers.has(n); },
      parseNumberList(text) { return parseNumberList(text, claimNumbers); },
      parseGroupsText(text) { return parseGroupsText(text, claimNumbers); },
      formatGroupsText(groups) { return formatGroupsText(groups || state.groups); },

      subscribe(fn) {
        listeners.push(fn);
        return function unsubscribe() {
          const i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        };
      },

      /* --- 表示状態（履歴に積まない） --- */
      selectGroup(id) {
        state.selectedGroupId = id;
        state.selectedSegment = 0;
        state.selectedSourceClaim = null;
        notify();
      },
      /*
       * 段落を選ぶ。sourceClaim を渡すと「その請求項のその段落」が基準になり、
       * 他のカードは似ている段落を探す。省略時（上部の段落ボタン）は
       * グループ先頭の請求項が基準になる。
       */
      selectSegment(index, sourceClaim) {
        state.selectedSegment = Number(index) || 0;
        state.selectedSourceClaim = state.selectedSegment
          ? (sourceClaim == null ? null : Number(sourceClaim)) : null;
        notify();
      },
      setHighlightMode(mode) { state.highlightMode = mode === 'only' ? 'only' : 'dim'; notify(); },
      setColumns(columns) { state.columns = columns; notify(); },
      setDensity(density) { state.density = density; notify(); },
      setViewMode(mode) { state.viewMode = mode === 'edit' ? 'edit' : 'compare'; notify(); },
      setPreset(preset) { state.preset = preset; notify(); },

      /* --- グループ操作（履歴に積む） --- */
      addGroup(input) {
        const spec = input || {};
        snapshot();
        const group = {
          id: nextId('manual'),
          name: spec.name || ('新しいグループ ' + (state.groups.length + 1)),
          claimNumbers: uniqueNumbers((spec.claimNumbers || []).filter((n) => validNumbers.has(n)))
            .slice(0, MAX_GROUP_SIZE),
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['手動で作成したグループ'],
          manuallyEdited: false,
          order: state.groups.length + 1,
        };
        state.groups.push(group);
        reorder();
        state.selectedGroupId = group.id;
        notify();
        return group;
      },

      renameGroup(id, name) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        group.name = String(name || '').trim() || group.name;
        markEdited(group);
        notify();
        return group;
      },

      setGroupMembers(id, numbers) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        group.claimNumbers = uniqueNumbers(numbers.filter((n) => validNumbers.has(n))).slice(0, MAX_GROUP_SIZE);
        group.candidateNumbers = group.candidateNumbers.filter((n) => group.claimNumbers.indexOf(n) === -1);
        markEdited(group);
        notify();
        return group;
      },

      addMemberToGroup(id, number) {
        const group = findGroup(id);
        if (!group || !validNumbers.has(number)) return null;
        if (group.claimNumbers.indexOf(number) !== -1) return group;
        if (group.claimNumbers.length >= MAX_GROUP_SIZE) return group;
        snapshot();
        group.claimNumbers.push(number);
        group.candidateNumbers = group.candidateNumbers.filter((n) => n !== number);
        markEdited(group);
        notify();
        return group;
      },

      removeMemberFromGroup(id, number) {
        const group = findGroup(id);
        if (!group) return null;
        const i = group.claimNumbers.indexOf(number);
        if (i === -1) return group;
        snapshot();
        group.claimNumbers.splice(i, 1);
        markEdited(group);
        notify();
        return group;
      },

      /*
       * 追加候補（自動グルーピングが「1件とだけ似ている」等で確定しなかった請求項）の操作。
       * 昇格＝正式メンバーにする、除外＝候補から落とす。どちらも手動編集として記録する。
       */
      promoteCandidate(id, number) {
        const group = findGroup(id);
        if (!group || group.candidateNumbers.indexOf(number) === -1) return null;
        if (group.claimNumbers.length >= MAX_GROUP_SIZE) return group;
        snapshot();
        group.candidateNumbers = group.candidateNumbers.filter((n) => n !== number);
        if (group.claimNumbers.indexOf(number) === -1) group.claimNumbers.push(number);
        markEdited(group);
        notify();
        return group;
      },

      dismissCandidate(id, number) {
        const group = findGroup(id);
        if (!group || group.candidateNumbers.indexOf(number) === -1) return null;
        snapshot();
        group.candidateNumbers = group.candidateNumbers.filter((n) => n !== number);
        markEdited(group);
        notify();
        return group;
      },

      moveMemberWithin(id, number, delta) {
        const group = findGroup(id);
        if (!group) return null;
        const from = group.claimNumbers.indexOf(number);
        const to = from + delta;
        if (from === -1 || to < 0 || to >= group.claimNumbers.length) return group;
        snapshot();
        group.claimNumbers.splice(from, 1);
        group.claimNumbers.splice(to, 0, number);
        markEdited(group);
        notify();
        return group;
      },

      // ドラッグ＆ドロップの着地点（index 指定の並べ替え）
      moveMemberTo(id, number, index) {
        const group = findGroup(id);
        if (!group) return null;
        const from = group.claimNumbers.indexOf(number);
        if (from === -1) return group;
        const to = Math.max(0, Math.min(index, group.claimNumbers.length - 1));
        if (from === to) return group;
        snapshot();
        group.claimNumbers.splice(from, 1);
        group.claimNumbers.splice(to, 0, number);
        markEdited(group);
        notify();
        return group;
      },

      // 別グループへ移動 / 複製
      transferMember(spec) {
        const from = findGroup(spec.fromId);
        const to = findGroup(spec.toId);
        if (!from || !to || from === to) return null;
        if (from.claimNumbers.indexOf(spec.number) === -1) return null;
        snapshot();
        if (to.claimNumbers.indexOf(spec.number) === -1 && to.claimNumbers.length < MAX_GROUP_SIZE) {
          to.claimNumbers.push(spec.number);
          markEdited(to);
        }
        if (!spec.copy) {
          from.claimNumbers.splice(from.claimNumbers.indexOf(spec.number), 1);
          markEdited(from);
        }
        notify();
        return { from, to };
      },

      splitGroup(id, index) {
        const group = findGroup(id);
        if (!group) return null;
        const at = Math.max(1, Math.min(Number(index) || 1, group.claimNumbers.length - 1));
        if (group.claimNumbers.length < 2) return null;
        snapshot();
        const tail = group.claimNumbers.slice(at);
        group.claimNumbers = group.claimNumbers.slice(0, at);
        markEdited(group);
        const created = {
          id: nextId('manual'),
          name: group.name + '（分割）',
          claimNumbers: tail,
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['「' + group.name + '」から分割'],
          manuallyEdited: false,
          order: 0,
        };
        state.groups.splice(state.groups.indexOf(group) + 1, 0, created);
        reorder();
        notify();
        return [group, created];
      },

      mergeGroups(ids, name) {
        const targets = ids.map((id) => findGroup(id)).filter(Boolean);
        if (targets.length < 2) return null;
        snapshot();
        const numbers = uniqueNumbers([].concat.apply([], targets.map((g) => g.claimNumbers)))
          .slice(0, MAX_GROUP_SIZE);
        const merged = {
          id: nextId('manual'),
          name: name || targets.map((g) => g.name).join(' + '),
          claimNumbers: numbers,
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['次のグループを統合: ' + targets.map((g) => g.name).join('、')],
          manuallyEdited: false,
          order: 0,
        };
        const firstIndex = state.groups.indexOf(targets[0]);
        state.groups = state.groups.filter((g) => targets.indexOf(g) === -1);
        state.groups.splice(Math.max(0, firstIndex), 0, merged);
        reorder();
        state.selectedGroupId = merged.id;
        notify();
        return merged;
      },

      duplicateGroup(id) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        const copy = {
          id: nextId('manual'),
          name: group.name + '（複製）',
          claimNumbers: group.claimNumbers.slice(),
          candidateNumbers: group.candidateNumbers.slice(),
          source: 'manual',
          strategy: 'manual',
          score: group.score,
          reasons: ['「' + group.name + '」の複製'],
          manuallyEdited: false,
          order: 0,
        };
        state.groups.splice(state.groups.indexOf(group) + 1, 0, copy);
        reorder();
        notify();
        return copy;
      },

      deleteGroup(id) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        state.groups = state.groups.filter((g) => g !== group);
        reorder();
        ensureSelection();
        notify();
        return group;
      },

      reorderGroups(ids) {
        snapshot();
        const map = new Map(state.groups.map((g) => [g.id, g]));
        const next = [];
        for (const id of ids) { if (map.has(id)) { next.push(map.get(id)); map.delete(id); } }
        for (const rest of map.values()) next.push(rest);
        state.groups = next;
        reorder();
        notify();
        return state.groups;
      },

      // 一括テキストからグループ全体を置き換える
      replaceGroupsFromText(text) {
        const parsed = parseGroupsText(text, claimNumbers);
        if (parsed.errors.length) return parsed;
        snapshot();
        state.groups = parsed.groups.map((g, i) => ({
          id: nextId('manual'),
          name: g.name,
          claimNumbers: g.claimNumbers.slice(0, MAX_GROUP_SIZE),
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['一括編集で作成'],
          manuallyEdited: false,
          order: i + 1,
        }));
        ensureSelection();
        notify();
        return parsed;
      },

      /*
       * 自動グルーピングの結果を反映する。
       * overwriteManual を渡さないかぎり、手動作成・手動編集済みのグループは温存する。
       * → { added, kept, replaced }
       */
      applyAutoGroups(autoGroups, options2) {
        const opts = options2 || {};
        snapshot();
        autoBaseline = cloneGroups(autoGroups || []);
        const kept = opts.overwriteManual
          ? []
          : state.groups.filter((g) => g.source === 'manual' || g.manuallyEdited);
        const incoming = cloneGroups(autoBaseline);
        state.groups = kept.concat(incoming);
        reorder();
        ensureSelection();
        notify();
        return { added: incoming.length, kept: kept.length, replaced: !!opts.overwriteManual };
      },

      // 自動生成時の状態へ戻す（手動グループは消える。UI 側で必ず確認を取る）
      resetToAuto() {
        snapshot();
        state.groups = cloneGroups(autoBaseline);
        reorder();
        ensureSelection();
        notify();
        return state.groups;
      },

      hasManualWork() {
        return state.groups.some((g) => g.source === 'manual' || g.manuallyEdited);
      },

      undo() {
        const prev = history.pop();
        if (!prev) return false;
        state.groups = cloneGroups(prev.groups);
        state.selectedGroupId = prev.selectedGroupId;
        ensureSelection();
        notify();
        return true;
      },

      /* --- 保存・復元（将来 localStorage を足すための入口） --- */
      toJSON() {
        return {
          version: 1,
          preset: state.preset,
          columns: state.columns,
          density: state.density,
          highlightMode: state.highlightMode,
          selectedGroupId: state.selectedGroupId,
          selectedSegment: state.selectedSegment,
          selectedSourceClaim: state.selectedSourceClaim,
          groups: cloneGroups(state.groups),
          autoBaseline: cloneGroups(autoBaseline),
        };
      },

      loadJSON(data) {
        if (!data || !data.groups) return false;
        snapshot();
        state.groups = cloneGroups(data.groups);
        if (data.autoBaseline) autoBaseline = cloneGroups(data.autoBaseline);
        if (data.preset) state.preset = data.preset;
        if (data.columns) state.columns = data.columns;
        if (data.density) state.density = data.density;
        if (data.highlightMode) state.highlightMode = data.highlightMode;
        state.selectedSegment = Number(data.selectedSegment) || 0;
        state.selectedSourceClaim = data.selectedSourceClaim == null ? null : Number(data.selectedSourceClaim);
        state.selectedGroupId = data.selectedGroupId || null;
        reorder();
        ensureSelection();
        notify();
        return true;
      },
    };

    ensureSelection();
    return api;
  }

  return { createStore, parseNumberList, parseGroupsText, formatGroupsText, MAX_GROUP_SIZE };
});

/*
 * layout.js — カードの列数と表示密度（DOM 非依存・純関数）
 *
 * 「カード数だけを見た if 文」で列数を決めない。使える画面幅・カードの最小幅・
 * カード数の 3 つから自然に決める。最大 4 枚のような上限は設けず、
 * 1 グループ 100 枚まで折り返して縦スクロールで読む。
 *
 * 決め方:
 *   幅から入る上限   maxByWidth = floor((width - padding + gap) / (minCardWidth + gap))
 *   読みやすさの上限 softCap(n)  … 少数枚では列を増やしすぎない
 *   列数 = clamp(1, min(cardCount, maxByWidth, softCap), …)
 *
 * softCap は「枚数に対して自然な列数」の緩い天井で、幅が足りなければ常に幅が勝つ。
 *   1〜4 枚 … その枚数まで（1枚なら1列＝中央に読みやすい幅で置く）
 *   5〜8 枚 … 4 列まで
 *   9 枚〜  … 6 列まで
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.layout = factory();
  }
})(globalThis, function () {
  'use strict';

  // 表示密度ごとの「カードがこれ以上細くなると読めない」幅（px）
  const DENSITIES = {
    compact: { key: 'compact', label: 'コンパクト', minCardWidth: 250, gap: 10, fontSize: 12.5, cardPadding: 8 },
    normal: { key: 'normal', label: '標準', minCardWidth: 300, gap: 16, fontSize: 13.5, cardPadding: 12 },
    roomy: { key: 'roomy', label: 'ゆったり', minCardWidth: 380, gap: 22, fontSize: 15, cardPadding: 16 },
  };

  const PAGE_PADDING = 32; // 本文左右の余白合計（styles.js と揃える）
  const SINGLE_CARD_MAX_WIDTH = 900; // 1 枚のときの読みやすい最大幅

  function getDensity(key) {
    return DENSITIES[key] || DENSITIES.normal;
  }

  function softCap(cardCount) {
    if (cardCount <= 4) return Math.max(1, cardCount);
    if (cardCount <= 8) return 4;
    return 6;
  }

  /*
   * options: { viewportWidth, cardCount, density, columns ('auto' | 数値) }
   * → { columns, minCardWidth, gap, maxByWidth, softCap, singleMaxWidth }
   */
  function computeLayout(options) {
    const opts = options || {};
    const density = getDensity(opts.density);
    const cardCount = Math.max(0, Number(opts.cardCount) || 0);
    const width = Math.max(320, Number(opts.viewportWidth) || 1280);
    const usable = Math.max(density.minCardWidth, width - PAGE_PADDING);
    const maxByWidth = Math.max(1, Math.floor((usable + density.gap) / (density.minCardWidth + density.gap)));

    let columns;
    const requested = Number(opts.columns);
    if (opts.columns && opts.columns !== 'auto' && Number.isFinite(requested) && requested >= 1) {
      // 明示指定でも、幅が足りないときは読めなくならないよう幅を優先する
      columns = Math.max(1, Math.min(requested, maxByWidth, Math.max(1, cardCount)));
    } else {
      columns = Math.max(1, Math.min(cardCount || 1, maxByWidth, softCap(cardCount)));
    }

    return {
      columns,
      minCardWidth: density.minCardWidth,
      gap: density.gap,
      fontSize: density.fontSize,
      cardPadding: density.cardPadding,
      maxByWidth,
      softCap: softCap(cardCount),
      densityKey: density.key,
      singleMaxWidth: SINGLE_CARD_MAX_WIDTH,
      // 1 枚だけのときは中央に読みやすい幅で置く
      centered: columns === 1 && cardCount === 1,
    };
  }

  return { computeLayout, getDensity, softCap, DENSITIES, PAGE_PADDING, SINGLE_CARD_MAX_WIDTH };
});

/*
 * extractor.js — 「書類比較・クレームチェッカー」から請求項を取り出す
 *
 * 収集元の優先順位:
 *   1. #claim_mark（クレーム解析済みの本文）… 既定。請求項見出しを境界に請求項へ切る
 *      旧 UI は span#CLMNM<n>、新 UI（2026 年〜）は span.claim_num#claim<n> が境界。
 *   2. #claim_cite（引用一覧）… 引用請求項・独立/従属・カテゴリー末尾語の権威ある出所。
 *      上限到達時も全請求項を列挙するため欠落しない（fixtures/README.md 参照）
 *   3. #doc1 / #doc2 の入力欄 …「【請求項○】」を検出するフォールバック
 *
 * 元ページを一切書き換えない（読むだけ）。document は引数で受け取るのでテストから
 * 最小 DOM を渡せる。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../core/citation'),
      require('../core/normalize'),
      require('../core/segment')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['citation', 'normalize', 'segment']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.extractor = factory(root.JCGC.citation, root.JCGC.normalize, root.JCGC.segment);
  }
})(globalThis, function (citation, normalize, segment) {
  'use strict';

  const NO_CLAIMS_MESSAGE = '請求項を取得できませんでした。先にクレーム解析を実行してください。';

  const CLAIM_MARK_SELECTORS = ['#claim_mark', '#claim_dialog #claim_mark'];
  const CITE_SELECTORS = ['#claim_cite', '#claim_dialog #claim_cite'];
  const INPUT_SELECTORS = ['#doc1', '#doc2', 'textarea'];

  /*
   * カテゴリー判定の補助表。上から順に当てる（媒体をデバイス系より先に見るなど順序に意味がある）。
   *
   * ここに並ぶのは特定の案件の用語ではなく、**日本語クレームの末尾に置かれる一般的な
   * 対象語**（カテゴリー宣言）。この表に載らない末尾語（未知のカテゴリー）が来ても処理は続き、
   * その場合は末尾語そのものからキーを作る（下の classifyCategory を参照）。
   * したがって、この表は「分野が変わると動かなくなる」種類の依存ではない。
   */
  const CATEGORY_RULES = [
    { key: 'program', label: 'プログラム', re: /(プログラム|ソフトウェア)$/ },
    { key: 'medium', label: '記録媒体', re: /(媒体|メディア)$/ },
    { key: 'method', label: '方法', re: /(方法|工程|プロセス|手順)$/ },
    { key: 'circuit', label: '回路', re: /(回路|回路構成|チップ)$/ },
    { key: 'system', label: 'システム', re: /(システム|ネットワーク)$/ },
    {
      key: 'apparatus',
      label: '装置',
      re: /(装置|機器|デバイス|端末|ノード|サーバ[ー]?|基地局|局|機|器|体|ユニット|モジュール|コンピュータ|部|手段)$/,
    },
  ];

  function hasClass(el, name) {
    const cls = el && el.className;
    if (!cls) return false;
    return String(cls).split(/\s+/).indexOf(name) !== -1;
  }

  function classListOf(el) {
    const cls = el && el.className;
    return cls ? String(cls).split(/\s+/).filter((s) => s !== '') : [];
  }

  function firstElement(doc, selectors) {
    for (const selector of selectors) {
      const el = doc.querySelector && doc.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /*
   * 請求項の境界マーカーかどうか。次の 2 世代を扱う:
   *   旧 UI: <span id="CLMNM1">…</span>
   *   新 UI: <span class="claim_num" id="claim1"><b>【請求項 1】</b></span>
   * 新 UI は id が無い/変わっても見出し文言から番号を拾えるよう、本文も見る。
   */
  function claimNumberOfMarker(el) {
    const id = el && el.id ? String(el.id) : '';
    const oldFormat = /^CLMNM(\d+)$/.exec(id);
    if (oldFormat) return Number(oldFormat[1]);

    const cls = classListOf(el);
    if (cls.indexOf('claim_num') === -1 && !/^claim\d+$/.test(id)) return null;
    const fromId = /^claim(\d+)$/.exec(id);
    if (fromId) return Number(fromId[1]);
    const fromText = /【\s*請求項\s*(\d+)\s*】/.exec(String(el.textContent || ''));
    return fromText ? Number(fromText[1]) : null;
  }

  /*
   * ページが本文へ挿入した表示用番号（[1-1] 等）のノードか。
   * 旧 UI は span.showCiteCited、新 UI は span.cited_word / span.jump_link.show_word
   * の中に番号だけが入る。class だけでなく中身が番号であることも確かめ、
   * 語を包む span（target_word 等）を誤って捨てないようにする。
   */
  function isDisplayNumber(el) {
    const cls = el && el.className ? String(el.className) : '';
    if (cls.indexOf('showCiteCited') !== -1) return true;
    if (/(^|\s)(cited_word|show_word)(\s|$)/.test(cls)) {
      return /^\[\d+-\d+\]$/.test(String(el.textContent || '').trim());
    }
    return false;
  }

  /*
   * #claim_mark を文書順に歩き、請求項見出しを境界として請求項へ切る。
   * 表示用番号（[1-1] 等）のノードは捨て、用語クラス（zenki_wdXX）は拾う。
   * 新 UI は用語を包むクラスを持たないため termClasses は空になる（処理は継続する）。
   */
  function readClaimMark(markEl) {
    const claims = [];
    let current = null;

    function pushText(text) {
      if (!current || text === '') return;
      current.parts.push(text);
    }

    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        pushText(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;

      const num = claimNumberOfMarker(node);
      if (num != null) {
        current = { number: num, parts: [], termClasses: new Set(), terms: [], termPairs: [] };
        claims.push(current);
        return; // 【請求項 n】の見出しは本文に含めない
      }
      if (isDisplayNumber(node) || hasClass(node, 'hidden')) return;

      if (current) {
        for (const cls of classListOf(node)) {
          if (cls.indexOf('zenki_wd') === 0) {
            current.termClasses.add(cls);
            const t = String(node.textContent || '').replace(/\[\d+-\d+\]/g, '').trim();
            if (t) {
              current.terms.push(t);
              // 用語クラスと、その語の実際の文字列。どの段落に出たかを後で突き合わせる
              current.termPairs.push({ cls, text: t });
            }
          }
        }
      }

      if (node.localName === 'br' || node.tagName === 'BR') {
        pushText('\n');
        return;
      }
      for (const child of node.childNodes) walk(child);
    }

    for (const child of markEl.childNodes) walk(child);

    return claims
      .filter((c) => c.parts.join('').replace(/[\s　]/g, '') !== '')
      .map((c) => ({
        number: c.number,
        rawText: c.parts.join(''),
        termClasses: Array.from(c.termClasses).sort(),
        terms: Array.from(new Set(c.terms)),
        termPairs: c.termPairs,
      }));
  }

  // 入力欄テキストから【請求項○】を検出するフォールバック
  function readInputText(text) {
    const src = citation.toAsciiDigits(String(text == null ? '' : text).replace(/\r\n?/g, '\n'));
    const re = /【\s*請求項\s*(\d+)\s*】/g;
    const heads = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      heads.push({ number: Number(m[1]), start: m.index, bodyStart: m.index + m[0].length });
    }
    return heads.map((h, i) => ({
      number: h.number,
      rawText: src.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : src.length),
      termClasses: [],
      terms: [],
      termPairs: [],
    })).filter((c) => c.rawText.replace(/[\s　]/g, '') !== '');
  }

  function elementText(el) {
    if (!el) return '';
    if (typeof el.value === 'string' && el.value !== '') return el.value;
    return String(el.textContent || '');
  }

  // 末尾のカテゴリー宣言を本文から推定する（引用一覧の『・・XXX』が無い/使えないとき）
  function deriveCategoryLabel(segments) {
    if (!segments.length) return '';
    let t = String(segments[segments.length - 1].text || '').replace(/[。．]+\s*$/, '');
    const tosuru = t.lastIndexOf('とする');
    if (tosuru !== -1) t = t.slice(tosuru + 3);
    const comma = Math.max(t.lastIndexOf('、'), t.lastIndexOf('，'));
    if (comma !== -1) t = t.slice(comma + 1);
    const parts = t.split(/[　\s]+/).filter((s) => s !== '');
    if (parts.length) t = parts[parts.length - 1];
    t = t.replace(/[（(][^）)]*[）)]\s*$/, '');
    return t.trim();
  }

  // 用語クラスの付いた語（termPairs）を、その語が現れる段落へ割り当てる
  function segmentTermClasses(segments, termPairs) {
    const pairs = termPairs || [];
    return segments.map((seg) => {
      const found = new Set();
      for (const pair of pairs) {
        if (pair.text && seg.text.indexOf(pair.text) !== -1) found.add(pair.cls);
      }
      return Array.from(found).sort();
    });
  }

  // 未知の末尾語からカテゴリーキーを作るときに見る末尾の文字数。
  // 日本語の複合名詞は主要語が末尾に来るので、末尾数文字が実質の対象語になる
  // （「〇〇樹脂組成物」と「樹脂組成物」を同じ系列として扱える）。
  const UNKNOWN_TAIL_LENGTH = 3;

  /*
   * 末尾語（カテゴリー宣言）を分類する。
   * → { key, groupLabel, known }
   *   known=false のときも処理は続く。キーは末尾語そのものから作るので、
   *   未知のカテゴリーどうしが誤って同じ系列にまとめられることもない。
   */
  function classifyCategory(label) {
    const normalized = normalize.toNfkc(String(label == null ? '' : label)).replace(/[\s　]/g, '');
    for (const rule of CATEGORY_RULES) {
      if (rule.re.test(normalized)) return { key: rule.key, groupLabel: rule.label, known: true };
    }
    if (normalized) {
      const tail = normalized.length > UNKNOWN_TAIL_LENGTH
        ? normalized.slice(-UNKNOWN_TAIL_LENGTH) : normalized;
      return { key: 'tail:' + tail, groupLabel: normalized, known: false };
    }
    return { key: 'unknown', groupLabel: 'カテゴリー不明', known: false };
  }

  /*
   * 抽出結果 1 件を組み立てる（段落分割 → 正規化の順を守る）
   */
  function buildClaim(raw, citeInfo) {
    const cleaned = normalize.stripDisplayNumbers(raw.rawText, raw.number)
      .replace(/\[\d+-\d+\]/g, '');
    const segments = segment.splitSegments(cleaned);

    const citeLabel = citeInfo ? String(citeInfo.categoryLabel || '') : '';
    let categoryLabel = citeLabel;
    let category = classifyCategory(categoryLabel);
    if (!categoryLabel || !category.known) {
      const derived = deriveCategoryLabel(segments);
      const derivedCategory = classifyCategory(derived);
      if (derived && (derivedCategory.known || !categoryLabel)) {
        categoryLabel = derived;
        category = derivedCategory;
      }
    }

    const textCitations = citation.parseCitations(cleaned).numbers.filter((n) => n !== raw.number);
    const citations = citeInfo && citeInfo.citations && citeInfo.citations.length
      ? citeInfo.citations.slice()
      : textCitations;
    const citationSource = citeInfo && citeInfo.citations && citeInfo.citations.length ? 'cite' : 'text';

    const normalized = normalize.normalizeForCompare(cleaned, { claimNumber: raw.number });

    return {
      number: raw.number,
      rawText: cleaned,
      segments,
      segmentCount: segments.length,
      citations,
      textCitations,
      citationSource,
      isIndependent: citeInfo ? citeInfo.isIndependent : citations.length === 0,
      categoryLabel: categoryLabel || '',
      categoryKey: category.key,
      categoryGroupLabel: category.groupLabel,
      categoryKnown: category.known,
      termClasses: raw.termClasses || [],
      terms: raw.terms || [],
      normalized,
      normalizedSegments: segments.map((s) =>
        normalize.normalizeSegment(s.text, { claimNumber: raw.number })),
      // 段落ごとの用語クラス（段落の対応付けの手がかり）。
      // 用語クラスの付いた語の文字列が、その段落に現れるかで割り当てる。
      segmentTermClasses: segmentTermClasses(segments, raw.termPairs),
    };
  }

  /*
   * 末尾語だけではカテゴリーが判定できなかった従属項は、引用先のカテゴリーを継承する。
   * 略語や造語で終わる従属項（表に載らない末尾語）でも、引用元が装置系なら
   * その系列とみなすのが自然。表示ラベルは自分の末尾語のまま残す。
   * 請求項番号の昇順に処理するので、鎖状の従属でも解決する。
   */
  function inheritCategories(claims) {
    const byNumber = new Map();
    for (const c of claims) byNumber.set(c.number, c);
    for (const c of claims) {
      if (c.categoryKnown || !c.citations || !c.citations.length) continue;
      for (const parentNumber of c.citations) {
        const parent = byNumber.get(parentNumber);
        if (parent && parent.categoryKnown) {
          c.categoryKey = parent.categoryKey;
          c.categoryGroupLabel = parent.categoryGroupLabel;
          c.categoryKnown = true;
          c.categoryInherited = true;
          break;
        }
      }
    }
    return claims;
  }

  function readMeta(doc) {
    const meta = { lappnum: '', title: '' };
    for (const id of ['#lappnum2', '#lappnum1']) {
      const el = doc.querySelector && doc.querySelector(id);
      const v = el ? elementText(el) || (el.getAttribute && el.getAttribute('value')) : '';
      if (v && String(v).trim() !== '') { meta.lappnum = String(v).trim(); break; }
    }
    const titleEl = doc.querySelector && doc.querySelector('title');
    if (titleEl) meta.title = String(titleEl.textContent || '').trim();
    return meta;
  }

  /*
   * ページ（または注入された document）から請求項を抽出する。
   * → { ok, claims, source, message, meta, citeSummary }
   */
  function extractClaims(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return { ok: false, claims: [], source: 'none', message: NO_CLAIMS_MESSAGE, meta: {} };

    const citeEl = firstElement(d, CITE_SELECTORS);
    const citeSummary = citeEl ? citation.parseCiteList(citeEl.textContent) : null;
    const citeByNumber = new Map();
    if (citeSummary) for (const c of citeSummary.claims) citeByNumber.set(c.number, c);

    let rawClaims = [];
    let source = 'none';

    const markEl = firstElement(d, CLAIM_MARK_SELECTORS);
    if (markEl) {
      rawClaims = readClaimMark(markEl);
      if (rawClaims.length) source = 'claim_mark';
    }

    if (!rawClaims.length) {
      for (const selector of INPUT_SELECTORS) {
        const nodes = d.querySelectorAll ? d.querySelectorAll(selector) : [];
        for (const el of nodes) {
          const parsed = readInputText(elementText(el));
          if (parsed.length) { rawClaims = parsed; source = 'input'; break; }
        }
        if (rawClaims.length) break;
      }
    }

    if (!rawClaims.length) {
      return { ok: false, claims: [], source: 'none', message: NO_CLAIMS_MESSAGE, meta: readMeta(d), citeSummary };
    }

    const claims = rawClaims
      .map((raw) => buildClaim(raw, citeByNumber.get(raw.number)))
      .sort((a, b) => a.number - b.number);
    inheritCategories(claims);

    return { ok: true, claims, source, message: '', meta: readMeta(d), citeSummary };
  }

  return {
    extractClaims,
    readClaimMark,
    readInputText,
    buildClaim,
    classifyCategory,
    deriveCategoryLabel,
    inheritCategories,
    segmentTermClasses,
    NO_CLAIMS_MESSAGE,
    CATEGORY_RULES,
  };
});

/*
 * dom.js — 最小の DOM 組み立てヘルパ（比較タブの document に対して使う）
 *
 * 重要な約束:
 *   - 文字列は必ず textContent で入れる。innerHTML は一切使わない。
 *     請求項本文をそのまま流し込む経路を作らないことで、HTML エスケープ漏れを構造的に防ぐ。
 *   - class の付け外しは className の文字列操作で行う（classList を使わない）。
 *     テスト用の最小 DOM でも同じコードが動くようにするため。
 *   - data-* は setAttribute / getAttribute で扱う（dataset を使わない。理由は同上）。
 *   - 対象 document は引数で受け取る。別タブの document を親タブの JS から組み立てるため、
 *     グローバルな document には依存しない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.dom = factory();
  }
})(globalThis, function () {
  'use strict';

  function classesOf(el) {
    const cls = el.getAttribute ? el.getAttribute('class') : el.className;
    return String(cls || '').split(/\s+/).filter((s) => s !== '');
  }

  function setClassName(el, list) {
    const value = list.join(' ');
    if (el.setAttribute) el.setAttribute('class', value);
    else el.className = value;
  }

  function hasClass(el, name) {
    return classesOf(el).indexOf(name) !== -1;
  }

  function addClass(el, name) {
    if (!el || !name || hasClass(el, name)) return el;
    setClassName(el, classesOf(el).concat([name]));
    return el;
  }

  function removeClass(el, name) {
    if (!el || !name) return el;
    setClassName(el, classesOf(el).filter((c) => c !== name));
    return el;
  }

  function toggleClass(el, name, on) {
    return on ? addClass(el, name) : removeClass(el, name);
  }

  /*
   * h(doc, tag, props, children)
   *   props: { class, id, text, title, type, value, attrs: {}, on: { click: fn } }
   *   children: 要素 or 文字列の配列
   */
  function h(doc, tag, props, children) {
    const el = doc.createElement(tag);
    const p = props || {};
    if (p.class) el.setAttribute('class', p.class);
    if (p.id) el.setAttribute('id', p.id);
    if (p.type) el.setAttribute('type', p.type);
    if (p.title) el.setAttribute('title', p.title);
    if (p.value != null) {
      el.setAttribute('value', String(p.value));
      if ('value' in el) el.value = String(p.value);
    }
    if (p.attrs) {
      for (const key of Object.keys(p.attrs)) {
        if (p.attrs[key] == null) continue;
        el.setAttribute(key, String(p.attrs[key]));
      }
    }
    if (p.text != null) el.textContent = String(p.text);
    if (p.on && el.addEventListener) {
      for (const type of Object.keys(p.on)) el.addEventListener(type, p.on[type]);
    }
    if (children) {
      for (const child of children) {
        if (child == null) continue;
        el.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
      }
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function button(doc, label, onClick, props) {
    const p = Object.assign({ class: 'jcgc-btn', type: 'button', text: label }, props || {});
    const el = h(doc, 'button', p);
    if (onClick && el.addEventListener) el.addEventListener('click', onClick);
    return el;
  }

  function select(doc, options, value, onChange, props) {
    const el = h(doc, 'select', Object.assign({ class: 'jcgc-select' }, props || {}));
    for (const option of options) {
      const opt = h(doc, 'option', { value: option.value, text: option.label });
      if (String(option.value) === String(value)) opt.setAttribute('selected', 'selected');
      el.appendChild(opt);
    }
    if ('value' in el) el.value = String(value);
    if (onChange && el.addEventListener) el.addEventListener('change', onChange);
    return el;
  }

  function fragment(doc) {
    return doc.createDocumentFragment();
  }

  // イベント委譲: root の中で selector（data 属性名）を持つ最も近い祖先を探す
  function closestWithAttr(node, attrName, root) {
    let current = node;
    while (current && current !== root) {
      if (current.nodeType === 1 && current.getAttribute && current.getAttribute(attrName) != null) {
        return current;
      }
      current = current.parentNode;
    }
    if (current && current.nodeType === 1 && current.getAttribute && current.getAttribute(attrName) != null) {
      return current;
    }
    return null;
  }

  return {
    h, clear, button, select, fragment,
    addClass, removeClass, toggleClass, hasClass, classesOf,
    closestWithAttr,
  };
});

/*
 * styles.js — 比較タブのスタイル（1 本の CSS 文字列）
 *
 * 白と淡い青を基調にした業務用ツールの見た目。濃紺ヘッダー・強い影・過度な角丸は使わない。
 * すべてのクラス・ID に jcgc- 接頭辞を付け、元ページにも他のタブにも干渉しないようにする。
 * 外部フォント・CDN は使わない（オフラインで完結）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.styles = factory();
  }
})(globalThis, function () {
  'use strict';

  const WORKSPACE_CSS = [
    /* ---- 基本 ---- */
    ':root{',
    '  --jcgc-bg:#f7fafd; --jcgc-surface:#ffffff; --jcgc-header:#dfeefb; --jcgc-header-2:#eef6fc;',
    '  --jcgc-line:#c3d6e4; --jcgc-line-soft:#dce8f1; --jcgc-text:#1d2b36; --jcgc-muted:#5b7488;',
    '  --jcgc-accent:#1f6fb2; --jcgc-accent-weak:#e4f0fa; --jcgc-mark:#fff3bf; --jcgc-mark-line:#e8c95a;',
    '  --jcgc-warn:#a4442c; --jcgc-manual:#7a4fb5;',
    '}',
    '*{box-sizing:border-box;}',
    'html,body{margin:0;padding:0;}',
    'body{background:var(--jcgc-bg);color:var(--jcgc-text);',
    '  font-family:"Yu Gothic UI","Yu Gothic","Hiragino Kaku Gothic ProN","Meiryo",system-ui,sans-serif;',
    '  font-size:13.5px;line-height:1.7;-webkit-text-size-adjust:100%;}',
    'button,select,input,textarea{font:inherit;color:inherit;}',

    /* ---- ヘッダー（縦スクロールしても残る） ---- */
    '.jcgc-header{position:sticky;top:0;z-index:30;background:var(--jcgc-header);',
    '  border-bottom:1px solid var(--jcgc-line);padding:8px 16px;}',
    '.jcgc-header-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}',
    '.jcgc-title{font-size:16px;font-weight:700;margin:0;letter-spacing:.02em;}',
    '.jcgc-meta{color:var(--jcgc-muted);font-size:12px;}',
    '.jcgc-tabs{display:flex;gap:4px;margin-left:auto;}',
    '.jcgc-tab{background:var(--jcgc-header-2);border:1px solid var(--jcgc-line);',
    '  border-bottom-color:transparent;padding:4px 14px;cursor:pointer;border-radius:3px 3px 0 0;}',
    '.jcgc-tab.is-active{background:var(--jcgc-surface);font-weight:700;color:var(--jcgc-accent);}',

    /* ---- 操作バー ---- */
    '.jcgc-toolbar{position:sticky;top:var(--jcgc-header-h,48px);z-index:25;background:var(--jcgc-header-2);',
    '  border-bottom:1px solid var(--jcgc-line);padding:6px 16px;display:flex;flex-wrap:wrap;',
    '  align-items:center;gap:8px 14px;}',
    '.jcgc-field{display:flex;align-items:center;gap:5px;}',
    '.jcgc-field > label{color:var(--jcgc-muted);font-size:12px;white-space:nowrap;}',
    '.jcgc-select,.jcgc-input,.jcgc-textarea{background:var(--jcgc-surface);border:1px solid var(--jcgc-line);',
    '  border-radius:3px;padding:3px 6px;max-width:100%;}',
    '.jcgc-select{max-width:min(46vw,560px);}',
    '.jcgc-textarea{width:100%;min-height:84px;font-family:ui-monospace,Consolas,"Courier New",monospace;',
    '  font-size:12.5px;line-height:1.6;resize:vertical;}',
    '.jcgc-btn{background:var(--jcgc-surface);border:1px solid var(--jcgc-line);border-radius:3px;',
    '  padding:3px 10px;cursor:pointer;white-space:nowrap;}',
    '.jcgc-btn:hover{background:var(--jcgc-accent-weak);}',
    '.jcgc-btn.is-primary{background:var(--jcgc-accent);border-color:var(--jcgc-accent);color:#fff;}',
    '.jcgc-btn.is-primary:hover{background:#1a5f99;}',
    '.jcgc-btn.is-active{background:var(--jcgc-accent);border-color:var(--jcgc-accent);color:#fff;}',
    '.jcgc-btn.is-danger{color:var(--jcgc-warn);border-color:#e0bcb2;}',
    '.jcgc-btn[disabled]{opacity:.45;cursor:default;}',
    '.jcgc-btn-group{display:flex;gap:0;}',
    '.jcgc-btn-group .jcgc-btn{border-radius:0;margin-left:-1px;}',
    '.jcgc-btn-group .jcgc-btn:first-child{border-radius:3px 0 0 3px;margin-left:0;}',
    '.jcgc-btn-group .jcgc-btn:last-child{border-radius:0 3px 3px 0;}',

    /* ---- 段落選択バー ---- */
    '.jcgc-segbar{position:sticky;top:var(--jcgc-toolbar-h,96px);z-index:20;background:var(--jcgc-surface);',
    '  border-bottom:1px solid var(--jcgc-line-soft);padding:5px 16px;display:flex;flex-wrap:wrap;',
    '  align-items:center;gap:6px;}',
    '.jcgc-segbtn{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);border-radius:3px;',
    '  padding:2px 9px;cursor:pointer;font-size:12.5px;}',
    '.jcgc-segbtn.is-active{background:var(--jcgc-mark);border-color:var(--jcgc-mark-line);font-weight:700;}',

    /* ---- 本文 ---- */
    '.jcgc-main{padding:12px 16px 64px;}',
    '.jcgc-groupinfo{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);',
    '  border-left:4px solid var(--jcgc-accent);padding:8px 12px;margin-bottom:12px;}',
    '.jcgc-groupinfo h2{margin:0 0 4px;font-size:14px;}',
    '.jcgc-badge{display:inline-block;border:1px solid var(--jcgc-line);border-radius:2px;',
    '  padding:0 6px;font-size:11.5px;color:var(--jcgc-muted);background:var(--jcgc-header-2);',
    '  margin-left:6px;overflow-wrap:anywhere;}',
    '.jcgc-badge.is-manual{color:var(--jcgc-manual);border-color:#d6c6ea;background:#f5eefc;}',
    '.jcgc-badge.is-candidate{color:#7a5a12;border-color:#e6d3a3;background:#fdf7e7;}',
    '.jcgc-reasons{margin:4px 0 0;padding-left:1.2em;color:var(--jcgc-muted);font-size:12.5px;}',
    '.jcgc-note{color:var(--jcgc-muted);font-size:11.5px;margin-top:4px;}',
    '.jcgc-empty{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);padding:24px;text-align:center;',
    '  color:var(--jcgc-muted);}',

    /* ---- カードグリッド（列数は JS が --jcgc-cols で与える） ---- */
    '.jcgc-grid{display:grid;grid-template-columns:repeat(var(--jcgc-cols,3),minmax(0,1fr));',
    '  gap:var(--jcgc-gap,16px);align-items:start;}',
    '.jcgc-grid.is-single{max-width:900px;margin:0 auto;}',
    '.jcgc-card{background:var(--jcgc-surface);border:1px solid var(--jcgc-line);border-radius:3px;',
    '  overflow-wrap:anywhere;}',
    // 追加候補のカードは、正式メンバーと見分けが付くように破線＋淡い地色にする
    '.jcgc-card.is-candidate{border-style:dashed;border-color:#e0c48f;background:#fffdf7;}',
    '.jcgc-card.is-candidate .jcgc-card-head{background:#fdf7e7;}',
    // カード見出しは、上のバー群の下で止まるように sticky の基準をずらす
    '.jcgc-card-head{background:var(--jcgc-header-2);border-bottom:1px solid var(--jcgc-line-soft);',
    '  padding:5px 10px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;',
    '  position:sticky;top:var(--jcgc-segbar-h,136px);z-index:5;}',
    '.jcgc-card-no{font-weight:700;font-size:14px;color:var(--jcgc-accent);}',
    '.jcgc-card-tags{color:var(--jcgc-muted);font-size:12px;}',
    '.jcgc-segs{list-style:none;margin:0;padding:4px 0;}',
    '.jcgc-seg{display:flex;gap:8px;padding:3px 10px;cursor:pointer;border-left:3px solid transparent;}',
    '.jcgc-seg:hover{background:#f2f8fd;}',
    '.jcgc-seg-no{flex:0 0 1.6em;color:var(--jcgc-muted);font-size:11.5px;text-align:right;',
    '  padding-top:.15em;user-select:none;}',
    '.jcgc-seg-text{flex:1 1 auto;white-space:pre-wrap;}',
    '.jcgc-seg[data-depth="2"] .jcgc-seg-text{padding-left:1.2em;}',
    '.jcgc-seg[data-depth="3"] .jcgc-seg-text{padding-left:2.4em;}',
    '.jcgc-seg.is-selected{background:var(--jcgc-mark);border-left-color:var(--jcgc-mark-line);}',
    '.jcgc-missing{margin:0;padding:3px 10px 6px;color:var(--jcgc-muted);font-size:12px;font-style:normal;}',

    /* 選択段落を強調 / 選択段落のみ */
    '.jcgc-grid.is-dim .jcgc-seg:not(.is-selected){opacity:.32;}',
    '.jcgc-grid.is-only .jcgc-seg:not(.is-selected){display:none;}',
    '.jcgc-grid.is-only .jcgc-card-head{position:static;}',

    /* 密度 */
    '.jcgc-density-compact .jcgc-grid{--jcgc-gap:10px;}',
    '.jcgc-density-compact .jcgc-seg-text{font-size:12.5px;}',
    '.jcgc-density-normal .jcgc-grid{--jcgc-gap:16px;}',
    '.jcgc-density-roomy .jcgc-grid{--jcgc-gap:22px;}',
    '.jcgc-density-roomy .jcgc-seg{padding:6px 14px;}',
    '.jcgc-density-roomy .jcgc-seg-text{font-size:15px;}',

    /* ---- グループ編集 ---- */
    '.jcgc-grouplist{display:flex;flex-direction:column;gap:8px;}',
    '.jcgc-grouprow{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);padding:8px 12px;}',
    '.jcgc-grouprow.is-editing{border-color:var(--jcgc-accent);border-left:4px solid var(--jcgc-accent);}',
    '.jcgc-grouprow-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;}',
    '.jcgc-grouprow-name{font-weight:700;}',
    '.jcgc-grouprow-nums{color:var(--jcgc-muted);font-size:12.5px;overflow-wrap:anywhere;}',
    '.jcgc-grouprow-actions{margin-left:auto;display:flex;flex-wrap:wrap;gap:4px;}',
    '.jcgc-editor{border-top:1px dashed var(--jcgc-line-soft);margin-top:8px;padding-top:8px;',
    '  display:flex;flex-direction:column;gap:8px;}',
    '.jcgc-editor-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;}',
    '.jcgc-editor-label{color:var(--jcgc-muted);font-size:12px;min-width:7em;}',
    // チップ置き場は行の残り幅いっぱいを使って内部で折り返す（横へはみ出させない）
    '.jcgc-chips{display:flex;flex-wrap:wrap;gap:5px;min-height:30px;padding:3px;',
    '  flex:1 1 320px;min-width:0;border:1px dashed var(--jcgc-line-soft);border-radius:3px;}',
    '.jcgc-chip{display:inline-flex;align-items:center;gap:4px;background:var(--jcgc-accent-weak);',
    '  border:1px solid var(--jcgc-line);border-radius:3px;padding:1px 4px 1px 8px;cursor:grab;}',
    '.jcgc-chip.is-dragging{opacity:.45;}',
    '.jcgc-chip.is-candidate{background:#fdf7e7;border-color:#e0c48f;border-style:dashed;cursor:default;}',
    '.jcgc-chip.is-dropbefore{box-shadow:-3px 0 0 var(--jcgc-accent);}',
    '.jcgc-chip-x{border:0;background:transparent;cursor:pointer;color:var(--jcgc-warn);padding:0 3px;}',
    '.jcgc-chip-move{border:0;background:transparent;cursor:pointer;color:var(--jcgc-muted);padding:0 1px;}',
    '.jcgc-pool{display:flex;flex-wrap:wrap;gap:5px;max-height:170px;overflow-y:auto;padding:3px;',
    '  flex:1 1 100%;min-width:0;border:1px solid var(--jcgc-line-soft);border-radius:3px;background:#fbfdff;}',
    '.jcgc-pool .jcgc-chip{cursor:pointer;background:var(--jcgc-surface);}',
    '.jcgc-errors{color:var(--jcgc-warn);font-size:12.5px;margin:0;padding-left:1.2em;}',
    '.jcgc-ok{color:#1f6f4a;font-size:12.5px;}',
    '.jcgc-section{background:var(--jcgc-surface);border:1px solid var(--jcgc-line-soft);',
    '  padding:10px 12px;margin-bottom:12px;}',
    '.jcgc-section h2{margin:0 0 6px;font-size:14px;}',
    '.jcgc-hidden{display:none !important;}',
    '.jcgc-banner{background:#fdf3e7;border:1px solid #e6c9a3;color:#7a4a12;padding:6px 16px;font-size:12.5px;}',

    /* 狭い画面 */
    '@media (max-width:820px){',
    '  .jcgc-header,.jcgc-toolbar,.jcgc-segbar,.jcgc-main{padding-left:10px;padding-right:10px;}',
    '  .jcgc-select{max-width:70vw;}',
    '}',
    '@media print{',
    '  .jcgc-toolbar,.jcgc-segbar,.jcgc-tabs{display:none;}',
    '  .jcgc-header{position:static;}',
    '  .jcgc-card{break-inside:avoid;}',
    '}',
  ].join('\n');

  /* 元ページに置く起動ボタンのスタイル（最小限・接頭辞つき） */
  const LAUNCHER_CSS = [
    '#jcgc-launcher{position:fixed;right:14px;bottom:14px;z-index:2147483000;',
    '  font-family:"Yu Gothic UI","Yu Gothic","Hiragino Kaku Gothic ProN","Meiryo",system-ui,sans-serif;',
    '  font-size:13px;line-height:1.6;}',
    '#jcgc-launcher .jcgc-launch-box{background:#eef6fc;border:1px solid #a9c9e2;border-radius:4px;',
    '  padding:8px 10px;box-shadow:0 1px 3px rgba(31,111,178,.18);max-width:320px;}',
    '#jcgc-launcher button{background:#1f6fb2;color:#fff;border:1px solid #1a5f99;border-radius:3px;',
    '  padding:6px 14px;cursor:pointer;font:inherit;}',
    '#jcgc-launcher button:hover{background:#1a5f99;}',
    '#jcgc-launcher .jcgc-launch-msg{margin-top:6px;color:#7a4a12;background:#fdf3e7;',
    '  border:1px solid #e6c9a3;padding:5px 7px;border-radius:3px;}',
    '#jcgc-launcher .jcgc-launch-msg:empty{display:none;}',
  ].join('\n');

  return { WORKSPACE_CSS, LAUNCHER_CSS };
});

/*
 * editor.js — グループ編集ビュー（自動生成済みのグループも後から編集できる）
 *
 * 画面幅を大きく使える別タブなので、小さなモーダルは使わず、グループ一覧の各行から
 * 開くインライン編集領域にしている。
 *
 * できること:
 *   グループ名の変更 / 請求項の追加・削除・並べ替え / 別グループへ移動・複製 /
 *   分割 / 統合 / 複製 / 削除 / 保存 / キャンセル / 直前操作の取り消し / 自動状態へ戻す /
 *   追加候補（自動で確定しなかった請求項）の昇格・除外
 *   100 請求項をドラッグ＆ドロップだけに頼らずに扱えるよう、
 *   「1,5,12,20」形式の一括編集欄と、複数グループのテキスト形式も用意する。
 *
 * 編集中の下書き（draft）は container に紐づけて保持する。ストアの通知で再描画されても
 * 入力中の内容が消えないようにするため。別タブを複数開いても互いに干渉しない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./dom'));
  } else {
    root.JCGC = root.JCGC || {};
    if (!root.JCGC.dom) throw new Error('JCGC.dom が未読み込みです（連結順を確認）');
    root.JCGC.editor = factory(root.JCGC.dom);
  }
})(globalThis, function (dom) {
  'use strict';

  const h = dom.h;

  function getEditorState(container) {
    if (!container.__jcgcEditor) {
      container.__jcgcEditor = {
        editingId: null,
        draftName: '',
        draftNumbers: [],
        errors: [],
        message: '',
        searchText: '',
        mergeSelection: [],
        bulkText: '',
        dragNumber: null,
      };
    }
    return container.__jcgcEditor;
  }

  function badgeOf(group) {
    if (group.source === 'manual') return '手動';
    return group.manuallyEdited ? '手動編集済み' : '自動';
  }

  function render(ctx) {
    const doc = ctx.doc;
    const container = ctx.container;
    const store = ctx.store;
    const claims = ctx.claims;
    const state = getEditorState(container);
    const groups = store.getGroups();

    function rerender() { render(ctx); }

    function startEdit(group) {
      state.editingId = group.id;
      state.draftName = group.name;
      state.draftNumbers = group.claimNumbers.slice();
      state.errors = [];
      state.message = '';
      state.searchText = '';
      rerender();
    }

    function cancelEdit() {
      state.editingId = null;
      state.errors = [];
      state.message = '';
      rerender();
    }

    function commitDraft(group) {
      const parsed = store.parseNumberList(state.draftNumbers.join(','));
      if (parsed.errors.length) { state.errors = parsed.errors; rerender(); return false; }
      store.renameGroup(group.id, state.draftName);
      store.setGroupMembers(group.id, state.draftNumbers);
      state.errors = [];
      return true;
    }

    dom.clear(container);

    /* ---- 全体操作 -------------------------------------------------- */
    const actions = h(doc, 'section', { class: 'jcgc-section' }, [
      h(doc, 'h2', { text: 'グループ編集' }),
    ]);
    const actionRow = h(doc, 'div', { class: 'jcgc-editor-row' });
    actionRow.appendChild(dom.button(doc, '新規グループ作成', () => {
      const group = store.addGroup({ name: '新しいグループ ' + (groups.length + 1), claimNumbers: [] });
      startEdit(group);
    }, { class: 'jcgc-btn is-primary' }));

    actionRow.appendChild(dom.button(doc, '選択したグループを統合', () => {
      const ids = state.mergeSelection.filter((id) => store.getGroup(id));
      if (ids.length < 2) {
        ctx.showNotice('統合するグループを2つ以上選んでください（各行の左のチェックボックス）。');
        return;
      }
      const names = ids.map((id) => store.getGroup(id).name).join('、');
      ctx.askConfirm('次のグループを1つに統合します: ' + names, '統合する', () => {
        store.mergeGroups(ids);
        state.mergeSelection = [];
        rerender();
      });
    }));

    actionRow.appendChild(dom.button(doc, '自動グルーピング再実行', () => {
      const presetKey = store.getState().preset;
      if (store.hasManualWork()) {
        ctx.askConfirm('手動で作成・編集したグループを残したまま、自動グループを作り直します。',
          '残して再実行', () => ctx.onRegroup(presetKey, false));
        return;
      }
      ctx.onRegroup(presetKey, false);
    }));

    actionRow.appendChild(dom.button(doc, '自動生成時の状態へ戻す', () => {
      ctx.askConfirm('手動で作成・編集したグループを破棄し、自動生成時の状態へ戻します。',
        '戻す', () => { store.resetToAuto(); state.editingId = null; state.mergeSelection = []; rerender(); });
    }, { class: 'jcgc-btn is-danger' }));

    const undoBtn = dom.button(doc, '元に戻す（直前操作の取り消し）', () => {
      if (!store.undo()) ctx.showNotice('取り消せる操作がありません。');
    });
    if (!store.canUndo()) undoBtn.setAttribute('disabled', 'disabled');
    actionRow.appendChild(undoBtn);

    actions.appendChild(actionRow);
    actions.appendChild(h(doc, 'p', {
      class: 'jcgc-note',
      text: '1つの請求項を複数のグループに所属させられます。自動グルーピングを再実行しても、'
        + '手動で作成・編集したグループは確認なしに上書きしません。',
    }));
    container.appendChild(actions);

    /* ---- グループ一覧 ---------------------------------------------- */
    const list = h(doc, 'div', { class: 'jcgc-grouplist' });
    if (!groups.length) {
      list.appendChild(h(doc, 'p', { class: 'jcgc-empty', text: 'グループがありません。「新規グループ作成」から作れます。' }));
    }

    for (const group of groups) {
      const editing = state.editingId === group.id;
      const row = h(doc, 'div', { class: 'jcgc-grouprow' + (editing ? ' is-editing' : '') });

      const checkbox = h(doc, 'input', { type: 'checkbox', title: '統合対象に選ぶ' });
      if (state.mergeSelection.indexOf(group.id) !== -1) checkbox.setAttribute('checked', 'checked');
      if (checkbox.addEventListener) {
        checkbox.addEventListener('change', () => {
          const i = state.mergeSelection.indexOf(group.id);
          if (i === -1) state.mergeSelection.push(group.id);
          else state.mergeSelection.splice(i, 1);
        });
      }

      const head = h(doc, 'div', { class: 'jcgc-grouprow-head' }, [
        checkbox,
        h(doc, 'span', { class: 'jcgc-grouprow-name', text: group.name }),
        h(doc, 'span', {
          class: 'jcgc-badge' + (badgeOf(group) === '自動' ? '' : ' is-manual'),
          text: badgeOf(group),
        }),
        h(doc, 'span', {
          class: 'jcgc-grouprow-nums',
          text: group.claimNumbers.length + '項｜' + (group.claimNumbers.join('・') || '（なし）'),
        }),
      ]);
      if (group.candidateNumbers && group.candidateNumbers.length) {
        head.appendChild(h(doc, 'span', {
          class: 'jcgc-badge is-candidate',
          text: '追加候補 ' + group.candidateNumbers.join('・'),
        }));
      }

      const rowActions = h(doc, 'div', { class: 'jcgc-grouprow-actions' });
      rowActions.appendChild(dom.button(doc, '比較で開く', () => {
        store.selectGroup(group.id);
        store.setViewMode('compare');
      }));
      rowActions.appendChild(dom.button(doc, editing ? '編集中' : '編集', () => {
        if (editing) cancelEdit(); else startEdit(group);
      }, { class: 'jcgc-btn' + (editing ? ' is-active' : '') }));
      rowActions.appendChild(dom.button(doc, '複製', () => { store.duplicateGroup(group.id); }));
      rowActions.appendChild(dom.button(doc, '削除', () => {
        ctx.askConfirm('グループ「' + group.name + '」を削除します。', '削除する', () => {
          store.deleteGroup(group.id);
          if (state.editingId === group.id) state.editingId = null;
          rerender();
        });
      }, { class: 'jcgc-btn is-danger' }));
      head.appendChild(rowActions);
      row.appendChild(head);

      if (editing) row.appendChild(buildEditorPanel(group));
      list.appendChild(row);
    }
    container.appendChild(list);

    /* ---- 複数グループの一括編集 ------------------------------------ */
    const bulk = h(doc, 'section', { class: 'jcgc-section' }, [
      h(doc, 'h2', { text: '複数グループの一括編集' }),
      h(doc, 'p', {
        class: 'jcgc-note',
        text: '「# グループ名」の次の行に請求項番号をカンマ区切りで書きます。'
          + '重複・存在しない番号・書式の誤りは、置き換える前に下へ表示します。',
      }),
    ]);
    const bulkArea = h(doc, 'textarea', { class: 'jcgc-textarea', id: 'jcgc-bulk-groups' });
    bulkArea.textContent = state.bulkText || store.formatGroupsText();
    if ('value' in bulkArea) bulkArea.value = state.bulkText || store.formatGroupsText();
    if (bulkArea.addEventListener) {
      bulkArea.addEventListener('input', (ev) => {
        state.bulkText = (ev.target || ev.currentTarget).value;
      });
    }
    bulk.appendChild(bulkArea);

    const bulkErrors = h(doc, 'ul', { class: 'jcgc-errors' });
    const bulkRow = h(doc, 'div', { class: 'jcgc-editor-row' }, [
      dom.button(doc, '現在のグループを書き出す', () => {
        state.bulkText = store.formatGroupsText();
        rerender();
      }),
      dom.button(doc, 'このテキストでグループを置き換える', () => {
        const text = state.bulkText || store.formatGroupsText();
        const check = store.parseGroupsText(text);
        dom.clear(bulkErrors);
        if (check.errors.length) {
          for (const e of check.errors) bulkErrors.appendChild(h(doc, 'li', { text: e }));
          return;
        }
        ctx.askConfirm('現在のグループをすべて置き換えます（' + check.groups.length + 'グループ）。',
          '置き換える', () => {
            store.replaceGroupsFromText(text);
            state.bulkText = '';
            state.editingId = null;
            rerender();
          });
      }, { class: 'jcgc-btn is-danger' }),
    ]);
    bulk.appendChild(bulkRow);
    bulk.appendChild(bulkErrors);
    container.appendChild(bulk);

    /* ---- 1グループ分の編集領域 -------------------------------------- */
    function buildEditorPanel(group) {
      const panel = h(doc, 'div', { class: 'jcgc-editor' });

      // グループ名
      const nameInput = h(doc, 'input', { class: 'jcgc-input', type: 'text', value: state.draftName });
      if (nameInput.addEventListener) {
        nameInput.addEventListener('input', (ev) => { state.draftName = (ev.target || ev.currentTarget).value; });
      }
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: 'グループ名' }), nameInput,
      ]));

      // 所属請求項（チップ。ドラッグ＆ドロップ＋ボタンの両方で並べ替え）
      const chips = h(doc, 'div', { class: 'jcgc-chips', id: 'jcgc-chips' });
      state.draftNumbers.forEach((number, index) => {
        const chip = h(doc, 'span', {
          class: 'jcgc-chip',
          attrs: { 'data-number': String(number), draggable: 'true' },
        }, [h(doc, 'span', { text: '請求項' + number })]);

        chip.appendChild(dom.button(doc, '←', () => {
          state.draftNumbers = moveIn(state.draftNumbers, index, index - 1);
          rerender();
        }, { class: 'jcgc-chip-move', title: '前へ' }));
        chip.appendChild(dom.button(doc, '→', () => {
          state.draftNumbers = moveIn(state.draftNumbers, index, index + 1);
          rerender();
        }, { class: 'jcgc-chip-move', title: '後ろへ' }));
        chip.appendChild(dom.button(doc, '×', () => {
          state.draftNumbers = state.draftNumbers.filter((n) => n !== number);
          rerender();
        }, { class: 'jcgc-chip-x', title: 'このグループから外す' }));

        if (chip.addEventListener) {
          chip.addEventListener('dragstart', () => { state.dragNumber = number; dom.addClass(chip, 'is-dragging'); });
          chip.addEventListener('dragend', () => { state.dragNumber = null; dom.removeClass(chip, 'is-dragging'); });
          chip.addEventListener('dragover', (ev) => { if (ev.preventDefault) ev.preventDefault(); });
          chip.addEventListener('drop', (ev) => {
            if (ev.preventDefault) ev.preventDefault();
            if (state.dragNumber == null) return;
            const from = state.draftNumbers.indexOf(state.dragNumber);
            if (from === -1) return;
            state.draftNumbers = moveIn(state.draftNumbers, from, index);
            state.dragNumber = null;
            rerender();
          });
        }
        chips.appendChild(chip);
      });
      if (!state.draftNumbers.length) {
        chips.appendChild(h(doc, 'span', { class: 'jcgc-note', text: '（請求項がありません）' }));
      }
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '所属する請求項' }), chips,
      ]));

      // 一括編集欄
      const bulkInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'text', value: state.draftNumbers.join(','),
        title: '例: 1,5,12,20',
      });
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '一括編集' }),
        bulkInput,
        dom.button(doc, '反映', () => {
          const parsed = store.parseNumberList(bulkInput.value);
          state.errors = parsed.errors;
          if (!parsed.errors.length) state.draftNumbers = parsed.numbers;
          rerender();
        }),
        h(doc, 'span', { class: 'jcgc-note', text: '例: 1,5,12,20' }),
      ]));

      // 追加候補（自動グルーピングが確定しなかったもの）
      const candidates = (group.candidateNumbers || [])
        .filter((n) => state.draftNumbers.indexOf(n) === -1);
      if (candidates.length) {
        const candidateChips = h(doc, 'div', { class: 'jcgc-chips', id: 'jcgc-candidate-chips' });
        for (const number of candidates) {
          candidateChips.appendChild(h(doc, 'span', {
            class: 'jcgc-chip is-candidate',
            attrs: { 'data-candidate': String(number) },
          }, [
            h(doc, 'span', { text: '請求項' + number }),
            dom.button(doc, '昇格', () => {
              if (!commitDraft(group)) return;
              store.promoteCandidate(group.id, number);
              const fresh = store.getGroup(group.id);
              state.draftNumbers = fresh ? fresh.claimNumbers.slice() : state.draftNumbers;
              state.message = '請求項' + number + ' を正式メンバーにしました';
              rerender();
            }, { class: 'jcgc-chip-move', title: '正式メンバーにする' }),
            dom.button(doc, '×', () => {
              store.dismissCandidate(group.id, number);
              rerender();
            }, { class: 'jcgc-chip-x', title: '候補から外す' }),
          ]));
        }
        panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
          h(doc, 'span', { class: 'jcgc-editor-label', text: '追加候補' }),
          candidateChips,
          h(doc, 'span', {
            class: 'jcgc-note',
            text: 'グループの一部とだけ似ていたため、自動では確定しなかった請求項です',
          }),
        ]));
      }

      // 追加可能な請求項
      const searchInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'text', value: state.searchText,
        title: '請求項番号または本文の一部で絞り込み',
      });
      if (searchInput.addEventListener) {
        searchInput.addEventListener('input', (ev) => {
          state.searchText = (ev.target || ev.currentTarget).value;
          rerender();
        });
      }
      const pool = h(doc, 'div', { class: 'jcgc-pool' });
      const query = String(state.searchText || '').trim();
      let poolCount = 0;
      for (const claim of claims) {
        if (state.draftNumbers.indexOf(claim.number) !== -1) continue;
        if (query && String(claim.number) !== query
          && claim.rawText.indexOf(query) === -1
          && String(claim.number).indexOf(query) !== 0) continue;
        poolCount += 1;
        const chip = h(doc, 'span', { class: 'jcgc-chip' }, [
          h(doc, 'span', { text: '請求項' + claim.number }),
          dom.button(doc, '＋', () => {
            if (state.draftNumbers.indexOf(claim.number) === -1) state.draftNumbers.push(claim.number);
            rerender();
          }, { class: 'jcgc-chip-move', title: 'このグループへ追加' }),
        ]);
        pool.appendChild(chip);
      }
      if (!poolCount) pool.appendChild(h(doc, 'span', { class: 'jcgc-note', text: '該当する請求項がありません' }));
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '追加できる請求項' }),
        searchInput, pool,
      ]));

      // 別グループへ移動 / 複製
      const memberSelect = dom.select(doc,
        state.draftNumbers.map((n) => ({ value: String(n), label: '請求項' + n })), '', null);
      const targetSelect = dom.select(doc,
        store.getGroups().filter((g) => g.id !== group.id).map((g) => ({ value: g.id, label: g.name })), '', null);
      const transfer = (copy) => {
        const number = Number(memberSelect.value);
        const toId = targetSelect.value;
        if (!number || !toId) { state.errors = ['移動する請求項と移動先グループを選んでください']; rerender(); return; }
        if (!commitDraft(group)) return; // 未保存の編集を先に確定させる
        store.transferMember({ fromId: group.id, toId, number, copy });
        const fresh = store.getGroup(group.id);
        state.draftNumbers = fresh ? fresh.claimNumbers.slice() : [];
        state.message = '請求項' + number + ' を'
          + (copy ? '複製しました（元のグループにも残ります）' : '移動しました');
        rerender();
      };
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '別グループへ' }),
        memberSelect, targetSelect,
        dom.button(doc, '移動', () => transfer(false)),
        dom.button(doc, '複製', () => transfer(true)),
        h(doc, 'span', { class: 'jcgc-note', text: '移動＝元から外す／複製＝元に残す（保存してから実行します）' }),
      ]));

      // 分割
      const splitInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'number', value: String(Math.max(1, Math.ceil(state.draftNumbers.length / 2))),
      });
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: 'グループの分割' }),
        h(doc, 'span', { class: 'jcgc-note', text: '先頭から' }), splitInput,
        h(doc, 'span', { class: 'jcgc-note', text: '件目までを残し、残りを新しいグループにする' }),
        dom.button(doc, '分割', () => {
          if (state.draftNumbers.length < 2) { state.errors = ['2請求項以上ないと分割できません']; rerender(); return; }
          if (!commitDraft(group)) return;
          ctx.askConfirm('グループ「' + group.name + '」を2つに分割します。', '分割する', () => {
            store.splitGroup(group.id, Number(splitInput.value) || 1);
            state.editingId = null;
            rerender();
          });
        }),
      ]));

      // エラー・メッセージ
      if (state.errors.length) {
        const errors = h(doc, 'ul', { class: 'jcgc-errors' });
        for (const e of state.errors) errors.appendChild(h(doc, 'li', { text: e }));
        panel.appendChild(errors);
      }
      if (state.message) panel.appendChild(h(doc, 'p', { class: 'jcgc-ok', text: state.message }));

      // 保存・キャンセル
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        dom.button(doc, '保存', () => {
          if (!commitDraft(group)) return;
          state.editingId = null;
          state.message = '';
          rerender();
        }, { class: 'jcgc-btn is-primary' }),
        dom.button(doc, 'キャンセル', cancelEdit),
      ]));

      return panel;
    }

    return container;
  }

  function moveIn(list, from, to) {
    if (to < 0 || to >= list.length || from === to) return list.slice();
    const out = list.slice();
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
  }

  return { render, getEditorState, moveIn };
});

/*
 * workspace.js — 比較専用タブの画面（骨組み・比較ビュー・段落同期）
 *
 * 設計上の要点:
 *   - 新しいタブの document を **親タブの JS から DOM API だけで組み立てる**。
 *     対象ページの CSP は script-src 'self' で、about:blank はその CSP を継承するため、
 *     script 要素の注入も eval も使えない（使わない）。document.write も使わない。
 *   - 本文は必ず textContent で入れる。innerHTML は 1 か所も使わない。
 *   - 段落選択では画面を作り直さない。カードごとの段落要素の配列を描画時に持っておき、
 *     class を付け替えるだけ。強調する段落は segmatch.js が「同じ段落番号」ではなく
 *     「最も似ている段落」で決める（比較用データは起動時に一度だけ作ってキャッシュ）。
 *     十分に似た段落が無ければ、同じ番号へ落とさずに「類似段落なし」と出す。
 *   - カードは DocumentFragment へ一括で組み立てて 1 回だけ挿入する。分割描画（rAF）は
 *     使わない: 上限 100 枚でも実測 6ms で終わる一方、rAF はバックグラウンドのタブで
 *     発火しないため、裏で開いた比較タブが途中までしか描かれない実害が出る。
 *   - 列数は layout.js（純関数）が決める。resize でも作り直さず style だけ更新する。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../core/layout'),
      require('../core/groupstate'),
      require('../core/grouping'),
      require('../core/segmatch'),
      require('./dom'),
      require('./styles'),
      require('./editor')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['layout', 'groupstate', 'grouping', 'segmatch', 'dom', 'styles', 'editor']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.workspace = factory(root.JCGC.layout, root.JCGC.groupstate, root.JCGC.grouping,
      root.JCGC.segmatch, root.JCGC.dom, root.JCGC.styles, root.JCGC.editor);
  }
})(globalThis, function (layout, groupstate, grouping, segmatch, dom, styles, editor) {
  'use strict';

  const h = dom.h;

  const COLUMN_OPTIONS = [
    { value: 'auto', label: '自動' }, { value: '2', label: '2' }, { value: '3', label: '3' },
    { value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' },
  ];
  const DENSITY_OPTIONS = [
    { value: 'normal', label: '標準' }, { value: 'compact', label: 'コンパクト' }, { value: 'roomy', label: 'ゆったり' },
  ];

  function formatCitations(numbers) {
    if (!numbers || !numbers.length) return '';
    if (numbers.length <= 4) return '←' + numbers.map((n) => '請求項' + n).join('・');
    return '←請求項' + numbers[0] + '〜' + numbers[numbers.length - 1] + '（' + numbers.length + '件）';
  }

  // 100 請求項のグループでも一覧やバッジが崩れないよう、長い並びは省略する
  const NUMBER_PREVIEW_LIMIT = 20;

  function formatNumbers(numbers, limit) {
    const max = limit == null ? NUMBER_PREVIEW_LIMIT : limit;
    if (numbers.length <= max) return numbers.join('・');
    return numbers.slice(0, max).join('・') + '…ほか' + (numbers.length - max) + '項';
  }

  function createWorkspace(options) {
    const opts = options || {};
    const doc = opts.doc;
    const win = opts.win || null;
    const claims = (opts.claims || []).slice().sort((a, b) => a.number - b.number);
    const claimMap = new Map(claims.map((c) => [c.number, c]));
    const meta = opts.meta || {};
    const regroup = opts.regroup || function (presetKey) {
      return grouping.autoGroup(claims, { preset: presetKey }).groups;
    };
    const store = groupstate.createStore({
      claims,
      autoGroups: opts.autoGroups || [],
      preset: opts.preset || grouping.DEFAULT_PRESET,
    });
    // 段落の対応付け。比較用データはここで一度だけ作ってキャッシュする
    const matcher = opts.matcher || segmatch.createMatcher(claims);

    const ui = {};
    // 描画のたびに作り直さないための索引
    let cardMeta = [];          // [{ number, segmentCount, items, missingEl }]
    let selectedElements = [];
    let lastCardsKey = '';

    /* ---- 骨組み ---------------------------------------------------- */
    function buildSkeleton() {
      if (doc.documentElement && doc.documentElement.setAttribute) doc.documentElement.setAttribute('lang', 'ja');
      try { doc.title = '請求項グループ比較'; } catch (e) { /* about:blank 直後は無視 */ }

      const head = doc.head || doc.documentElement;
      const style = h(doc, 'style', { id: 'jcgc-style', text: styles.WORKSPACE_CSS });
      head.appendChild(style);
      const titleEl = doc.querySelector && doc.querySelector('title');
      if (!titleEl) head.appendChild(h(doc, 'title', { text: '請求項グループ比較' }));

      const body = doc.body || doc.documentElement;
      dom.clear(body);
      body.setAttribute('class', 'jcgc-density-normal');

      ui.root = h(doc, 'div', { id: 'jcgc-app' });
      body.appendChild(ui.root);

      buildHeader();
      buildBanner();
      buildToolbar();
      buildSegbar();

      ui.compare = h(doc, 'main', { id: 'jcgc-view-compare', class: 'jcgc-main' });
      ui.editView = h(doc, 'main', { id: 'jcgc-view-edit', class: 'jcgc-main jcgc-hidden' });
      ui.root.appendChild(ui.compare);
      ui.root.appendChild(ui.editView);

      ui.groupInfo = h(doc, 'section', { class: 'jcgc-groupinfo', id: 'jcgc-groupinfo' });
      ui.grid = h(doc, 'div', { class: 'jcgc-grid', id: 'jcgc-grid' });
      ui.compare.appendChild(ui.groupInfo);
      ui.compare.appendChild(ui.grid);

      if (ui.grid.addEventListener) ui.grid.addEventListener('click', onGridClick);
      if (win && win.addEventListener) {
        win.addEventListener('resize', debounce(applyLayout, 120));
      }
    }

    function buildHeader() {
      const metaBits = [];
      if (meta.lappnum) metaBits.push('出願番号 ' + meta.lappnum);
      metaBits.push('全' + claims.length + '請求項');
      if (meta.sourceLabel) metaBits.push('抽出元: ' + meta.sourceLabel);

      ui.tabCompare = h(doc, 'button', { class: 'jcgc-tab is-active', type: 'button', text: '比較' });
      ui.tabEdit = h(doc, 'button', { class: 'jcgc-tab', type: 'button', text: 'グループ編集' });
      if (ui.tabCompare.addEventListener) ui.tabCompare.addEventListener('click', () => store.setViewMode('compare'));
      if (ui.tabEdit.addEventListener) ui.tabEdit.addEventListener('click', () => store.setViewMode('edit'));

      ui.header = h(doc, 'header', { class: 'jcgc-header' }, [
        h(doc, 'div', { class: 'jcgc-header-row' }, [
          h(doc, 'h1', { class: 'jcgc-title', text: '請求項グループ比較' }),
          h(doc, 'span', { class: 'jcgc-meta', text: metaBits.join('　/　') }),
          h(doc, 'nav', { class: 'jcgc-tabs' }, [ui.tabCompare, ui.tabEdit]),
        ]),
      ]);
      ui.root.appendChild(ui.header);
    }

    // 影響の大きい操作の確認（ネイティブの confirm は使わず、画面内のバーで尋ねる）
    function buildBanner() {
      ui.banner = h(doc, 'div', { class: 'jcgc-banner jcgc-hidden', id: 'jcgc-banner' });
      ui.root.appendChild(ui.banner);
    }

    function askConfirm(message, yesLabel, onYes) {
      dom.clear(ui.banner);
      ui.banner.appendChild(h(doc, 'span', { text: message }));
      const yes = dom.button(doc, yesLabel, () => { hideBanner(); onYes(); }, { class: 'jcgc-btn is-primary' });
      const no = dom.button(doc, 'キャンセル', hideBanner);
      ui.banner.appendChild(h(doc, 'span', { text: '　' }));
      ui.banner.appendChild(yes);
      ui.banner.appendChild(h(doc, 'span', { text: ' ' }));
      ui.banner.appendChild(no);
      dom.removeClass(ui.banner, 'jcgc-hidden');
      ui.bannerButtons = { yes, no };
    }

    function showNotice(message) {
      dom.clear(ui.banner);
      ui.banner.appendChild(h(doc, 'span', { text: message }));
      ui.banner.appendChild(h(doc, 'span', { text: '　' }));
      ui.banner.appendChild(dom.button(doc, '閉じる', hideBanner));
      dom.removeClass(ui.banner, 'jcgc-hidden');
    }

    function hideBanner() {
      dom.clear(ui.banner);
      dom.addClass(ui.banner, 'jcgc-hidden');
      ui.bannerButtons = null;
    }

    function buildToolbar() {
      ui.groupSelect = dom.select(doc, [], '', (ev) => {
        store.selectGroup(ev.target ? ev.target.value : ev.currentTarget.value);
      }, { id: 'jcgc-group-select' });

      ui.presetButtons = {};
      const presetGroup = h(doc, 'div', { class: 'jcgc-btn-group' });
      for (const key of Object.keys(grouping.PRESETS)) {
        const preset = grouping.PRESETS[key];
        const btn = dom.button(doc, preset.label, () => onPresetChange(key), {
          title: preset.description,
          attrs: { 'data-preset': key },
        });
        ui.presetButtons[key] = btn;
        presetGroup.appendChild(btn);
      }

      ui.regroupButton = dom.button(doc, '自動グルーピング再実行', onRegroupClick, { class: 'jcgc-btn is-primary' });

      ui.columnSelect = dom.select(doc, COLUMN_OPTIONS, 'auto', (ev) => {
        store.setColumns((ev.target || ev.currentTarget).value);
      }, { id: 'jcgc-columns' });
      ui.densitySelect = dom.select(doc, DENSITY_OPTIONS, 'normal', (ev) => {
        store.setDensity((ev.target || ev.currentTarget).value);
      }, { id: 'jcgc-density' });

      ui.modeDim = dom.button(doc, '選択段落を強調', () => store.setHighlightMode('dim'));
      ui.modeOnly = dom.button(doc, '選択段落のみ', () => store.setHighlightMode('only'));

      ui.toolbar = h(doc, 'div', { class: 'jcgc-toolbar' }, [
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: 'グループ選択' }), ui.groupSelect,
        ]),
        ui.regroupButton,
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: 'グルーピング強度' }), presetGroup,
        ]),
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: '列数' }), ui.columnSelect,
        ]),
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: '表示密度' }), ui.densitySelect,
        ]),
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: '強調' }),
          h(doc, 'div', { class: 'jcgc-btn-group' }, [ui.modeDim, ui.modeOnly]),
        ]),
      ]);
      ui.root.appendChild(ui.toolbar);
    }

    function buildSegbar() {
      ui.segbar = h(doc, 'div', { class: 'jcgc-segbar', id: 'jcgc-segbar' });
      if (ui.segbar.addEventListener) ui.segbar.addEventListener('click', onSegbarClick);
      ui.root.appendChild(ui.segbar);
    }

    /* ---- 操作ハンドラ ----------------------------------------------- */
    function onPresetChange(key) {
      store.setPreset(key);
      applyAuto(key, false);
    }

    function onRegroupClick() {
      const key = store.getState().preset;
      if (store.hasManualWork()) {
        askConfirm(
          '手動で作成・編集したグループがあります。それらを残したまま自動グループだけ作り直しますか。',
          '残して再実行',
          () => applyAuto(key, false)
        );
        return;
      }
      applyAuto(key, false);
    }

    function applyAuto(presetKey, overwriteManual) {
      const groups = regroup(presetKey);
      store.applyAutoGroups(groups, { overwriteManual: !!overwriteManual });
    }

    function onSegbarClick(ev) {
      const target = dom.closestWithAttr(ev.target || ev.srcElement, 'data-segbtn', ui.segbar);
      if (!target) return;
      store.selectSegment(Number(target.getAttribute('data-segbtn')), null);
    }

    function onGridClick(ev) {
      const target = dom.closestWithAttr(ev.target || ev.srcElement, 'data-seg', ui.grid);
      if (!target) return;
      const card = dom.closestWithAttr(target, 'data-claim', ui.grid);
      const claimNumber = card ? Number(card.getAttribute('data-claim')) : null;
      const seg = Number(target.getAttribute('data-seg'));
      const state = store.getState();
      // 同じ段落をもう一度押したら「全体」へ戻す
      const isSame = state.selectedSegment === seg && selectionSource() === claimNumber;
      store.selectSegment(isSame ? 0 : seg, isSame ? null : claimNumber);
    }

    function debounce(fn, wait) {
      let timer = null;
      return function debounced() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(); }, wait);
      };
    }

    /* ---- グループ一覧・段落バー ------------------------------------- */
    function groupOptionLabel(group) {
      const badge = group.source === 'manual' ? '手動'
        : (group.manuallyEdited ? '手動編集済み' : '自動');
      return group.name + '　' + group.claimNumbers.length + '項｜'
        + formatNumbers(group.claimNumbers) + '｜' + badge;
    }

    function renderGroupSelect() {
      const state = store.getState();
      dom.clear(ui.groupSelect);
      if (!state.groups.length) {
        ui.groupSelect.appendChild(h(doc, 'option', { value: '', text: 'グループがありません' }));
        return;
      }
      for (const group of state.groups) {
        const opt = h(doc, 'option', { value: group.id, text: groupOptionLabel(group) });
        if (group.id === state.selectedGroupId) opt.setAttribute('selected', 'selected');
        ui.groupSelect.appendChild(opt);
      }
      if ('value' in ui.groupSelect) ui.groupSelect.value = state.selectedGroupId || '';
    }

    function renderSegbar(members) {
      const state = store.getState();
      const maxSegments = members.reduce((max, c) => Math.max(max, c.segmentCount), 0);
      dom.clear(ui.segbar);
      ui.segbar.appendChild(h(doc, 'span', { class: 'jcgc-meta', text: '段落選択' }));
      const all = h(doc, 'button', {
        class: 'jcgc-segbtn' + (state.selectedSegment === 0 ? ' is-active' : ''),
        type: 'button', text: '全体', attrs: { 'data-segbtn': '0' },
      });
      ui.segbar.appendChild(all);
      for (let i = 1; i <= maxSegments; i += 1) {
        ui.segbar.appendChild(h(doc, 'button', {
          class: 'jcgc-segbtn' + (state.selectedSegment === i ? ' is-active' : ''),
          type: 'button', text: '段落' + i, attrs: { 'data-segbtn': String(i) },
        }));
      }
    }

    function renderGroupInfo(group, members) {
      dom.clear(ui.groupInfo);
      if (!group) return;
      const badge = group.source === 'manual' ? '手動'
        : (group.manuallyEdited ? '手動編集済み' : '自動');
      const head = h(doc, 'h2', {}, [
        h(doc, 'span', { text: group.name }),
        h(doc, 'span', {
          class: 'jcgc-badge' + (badge === '自動' ? '' : ' is-manual'),
          text: badge,
        }),
        h(doc, 'span', { class: 'jcgc-badge', text: group.claimNumbers.length + '項' }),
        h(doc, 'span', { class: 'jcgc-badge', text: formatNumbers(group.claimNumbers) }),
      ]);
      if (group.score != null) {
        head.appendChild(h(doc, 'span', { class: 'jcgc-badge', text: '類似度 ' + group.score }));
      }
      if (group.candidateNumbers && group.candidateNumbers.length) {
        head.appendChild(h(doc, 'span', {
          class: 'jcgc-badge is-candidate',
          text: '追加候補 ' + formatNumbers(group.candidateNumbers),
        }));
      }
      ui.groupInfo.appendChild(head);

      if (group.reasons && group.reasons.length) {
        const list = h(doc, 'ul', { class: 'jcgc-reasons' });
        for (const reason of group.reasons) list.appendChild(h(doc, 'li', { text: reason }));
        ui.groupInfo.appendChild(list);
      }
      if (group.candidateNumbers && group.candidateNumbers.length) {
        ui.groupInfo.appendChild(h(doc, 'p', {
          class: 'jcgc-note',
          text: '「追加候補」は、グループの一部とだけ似ていたため自動では確定しなかった請求項です。'
            + '参考として一緒に並べています。グループ編集から正式メンバーへ昇格させられます。',
        }));
      }
      ui.groupInfo.appendChild(h(doc, 'p', {
        class: 'jcgc-note',
        text: 'この根拠は、法的な同一性の判定ではありません。字面・段落構造・カテゴリー・'
          + '引用関係・クレームツリー上の位置から、機械的に比較候補を作成した理由です。',
      }));
    }

    /* ---- カード ------------------------------------------------------ */
    function buildCard(claim, isCandidate) {
      const tags = [claim.isIndependent ? '独立項' : '従属項'];
      const cite = formatCitations(claim.citations);
      if (cite) tags.push(cite);
      if (claim.categoryLabel) tags.push(claim.categoryLabel);

      const list = h(doc, 'ol', { class: 'jcgc-segs' });
      const items = [];
      for (const seg of claim.segments) {
        const li = h(doc, 'li', {
          class: 'jcgc-seg',
          attrs: { 'data-seg': String(seg.index), 'data-depth': String(Math.min(seg.depth, 3)) },
        }, [
          h(doc, 'span', { class: 'jcgc-seg-no', text: String(seg.index) }),
          h(doc, 'span', { class: 'jcgc-seg-text', text: seg.text }),
        ]);
        list.appendChild(li);
        items.push(li);
      }

      const missing = h(doc, 'p', { class: 'jcgc-missing jcgc-hidden' });
      const head = h(doc, 'header', { class: 'jcgc-card-head' }, [
        h(doc, 'span', { class: 'jcgc-card-no', text: '請求項' + claim.number }),
        h(doc, 'span', { class: 'jcgc-card-tags', text: tags.join('｜') }),
      ]);
      if (isCandidate) {
        head.appendChild(h(doc, 'span', {
          class: 'jcgc-badge is-candidate',
          title: '自動グルーピングでは確定しなかった請求項です',
          text: '追加候補',
        }));
      }
      const card = h(doc, 'article', {
        class: 'jcgc-card' + (isCandidate ? ' is-candidate' : ''),
        attrs: { 'data-claim': String(claim.number) },
      }, [head, list, missing]);

      return { card, items, missing, claim };
    }

    /*
     * カードの描画。
     *
     * 分割描画（requestAnimationFrame での遅延挿入）は **使わない**。実測すると
     * 上限の 100 枚（約 3,900 ノード）でも組み立て 5ms・挿入 1ms で終わり、
     * 分割する利益が無い一方、rAF はバックグラウンドのタブで発火せず、
     * setTimeout も背面タブでは 1 秒級に絞られるため、
     * 「裏で開いた比較タブが途中までしか描かれない」という実害が出る。
     * 代わりに DocumentFragment へ一括で組み立てて 1 回だけ挿入する。
     *
     * 同じグループを描き直さない（key が同じならスキップ）ので、
     * 段落選択や密度変更のたびに DOM を作り直すこともない。
     */
    function renderCards(entries, force) {
      const state = store.getState();
      const key = state.selectedGroupId + '|'
        + entries.map((e) => e.claim.number + (e.isCandidate ? 'c' : '')).join(',');
      if (!force && key === lastCardsKey) return;
      lastCardsKey = key;

      dom.clear(ui.grid);
      cardMeta = [];
      selectedElements = [];

      if (!entries.length) {
        ui.grid.appendChild(h(doc, 'p', { class: 'jcgc-empty', text: 'このグループには請求項がありません。' }));
        return;
      }

      const frag = dom.fragment(doc);
      for (const entry of entries) {
        const built = buildCard(entry.claim, entry.isCandidate);
        cardMeta.push({
          number: entry.claim.number,
          segmentCount: entry.claim.segmentCount,
          items: built.items,
          missingEl: built.missing,
        });
        frag.appendChild(built.card);
      }
      ui.grid.appendChild(frag);
      applySelection();
    }

    /*
     * 選択の基準になる請求項。カードの段落をクリックしたときはその請求項、
     * 上部の段落ボタンから選んだときはグループ先頭の請求項。
     */
    function selectionSource() {
      const state = store.getState();
      const source = state.selectedSourceClaim;
      if (source != null && cardMeta.some((info) => info.number === source)) return source;
      return cardMeta.length ? cardMeta[0].number : null;
    }

    /*
     * 段落選択の反映。画面は作り直さず、class を付け替えるだけ。
     *
     * 各カードで強調する段落は「同じ段落番号」ではなく、選択した段落に最も似ている段落
     * （segmatch.js）。1 つの請求項にだけ固有の段落が挟まっていても、その後の段落が
     * 正しく対応する。十分に似た段落が無いときは **何も強調しない**（同じ段落番号へは
     * 落とさない。誤った段落を強調するより、何も強調しないほうがよい）。
     */
    function applySelection() {
      const state = store.getState();
      const seg = state.selectedSegment;
      const sourceNumber = selectionSource();

      for (const el of selectedElements) dom.removeClass(el, 'is-selected');
      selectedElements = [];

      dom.toggleClass(ui.grid, 'is-dim', seg > 0 && state.highlightMode === 'dim');
      dom.toggleClass(ui.grid, 'is-only', seg > 0 && state.highlightMode === 'only');

      for (const info of cardMeta) {
        const hit = seg > 0 && sourceNumber != null
          ? matcher.resolve(sourceNumber, seg, info.number, info.segmentCount)
          : null;
        // 対応は 1 対 1 とはかぎらない。返ってきた段落をすべて強調する
        let marked = 0;
        if (hit) {
          for (const index of hit.indexes) {
            const el = info.items[index - 1];
            if (!el) continue;
            dom.addClass(el, 'is-selected');
            selectedElements.push(el);
            marked += 1;
          }
        }
        const missingHere = seg > 0 && marked === 0;
        info.missingEl.textContent = missingHere ? '類似段落なし' : '';
        dom.toggleClass(info.missingEl, 'jcgc-hidden', !missingHere);
      }

      // 段落ボタンの選択状態
      if (ui.segbar.childNodes) {
        for (const node of ui.segbar.childNodes) {
          if (node.nodeType !== 1 || !node.getAttribute) continue;
          const value = node.getAttribute('data-segbtn');
          if (value == null) continue;
          dom.toggleClass(node, 'is-active', Number(value) === seg);
        }
      }
    }

    /* ---- レイアウト --------------------------------------------------- */
    function viewportWidth() {
      if (win && win.innerWidth) return win.innerWidth;
      if (doc.documentElement && doc.documentElement.clientWidth) return doc.documentElement.clientWidth;
      return 1280;
    }

    /*
     * ヘッダー・操作バー・段落バーの実測高さを CSS 変数へ渡す。
     * 段重ねの sticky を正しい位置で止めるために必要で、カード見出しの sticky も
     * その下に来るようにする（見出しが操作バーの裏へ潜らないように）。
     * 高さを測れない環境（テスト用の最小 DOM）では何もしない。
     */
    function applyStickyOffsets() {
      const heights = [ui.header, ui.toolbar, ui.segbar].map((el) => (el && el.offsetHeight) || 0);
      if (!heights[0]) return;
      const [headerH, toolbarH, segbarH] = heights;
      ui.root.setAttribute('style', [
        '--jcgc-header-h:' + headerH + 'px',
        '--jcgc-toolbar-h:' + (headerH + toolbarH) + 'px',
        '--jcgc-segbar-h:' + (headerH + toolbarH + segbarH) + 'px',
      ].join(';'));
    }

    function applyLayout() {
      const state = store.getState();
      const group = store.getSelectedGroup();
      const cardCount = group ? group.claimNumbers.length : 0;
      const result = layout.computeLayout({
        viewportWidth: viewportWidth(),
        cardCount,
        density: state.density,
        columns: state.columns,
      });
      ui.grid.setAttribute('style', '--jcgc-cols:' + result.columns + ';--jcgc-gap:' + result.gap + 'px');
      dom.toggleClass(ui.grid, 'is-single', result.centered);
      const body = doc.body || doc.documentElement;
      body.setAttribute('class', 'jcgc-density-' + result.densityKey);
      applyStickyOffsets();
      ui.lastLayout = result;
      return result;
    }

    /* ---- 再描画 ------------------------------------------------------- */
    // グループのカード（正式メンバー → 追加候補 の順）
    function groupEntries(group) {
      if (!group) return [];
      const entries = group.claimNumbers
        .map((n) => claimMap.get(n)).filter(Boolean)
        .map((claim) => ({ claim, isCandidate: false }));
      for (const n of group.candidateNumbers || []) {
        const claim = claimMap.get(n);
        if (claim && group.claimNumbers.indexOf(n) === -1) entries.push({ claim, isCandidate: true });
      }
      return entries;
    }

    function render() {
      const state = store.getState();
      const group = store.getSelectedGroup();
      const entries = groupEntries(group);
      const members = entries.map((e) => e.claim);

      renderGroupSelect();

      for (const key of Object.keys(ui.presetButtons)) {
        dom.toggleClass(ui.presetButtons[key], 'is-active', key === state.preset);
      }
      dom.toggleClass(ui.modeDim, 'is-active', state.highlightMode === 'dim');
      dom.toggleClass(ui.modeOnly, 'is-active', state.highlightMode === 'only');
      if ('value' in ui.columnSelect) ui.columnSelect.value = String(state.columns);
      if ('value' in ui.densitySelect) ui.densitySelect.value = String(state.density);

      dom.toggleClass(ui.tabCompare, 'is-active', state.viewMode === 'compare');
      dom.toggleClass(ui.tabEdit, 'is-active', state.viewMode === 'edit');
      dom.toggleClass(ui.compare, 'jcgc-hidden', state.viewMode !== 'compare');
      dom.toggleClass(ui.editView, 'jcgc-hidden', state.viewMode !== 'edit');
      dom.toggleClass(ui.segbar, 'jcgc-hidden', state.viewMode !== 'compare');

      if (state.viewMode === 'compare') {
        renderGroupInfo(group, members);
        renderSegbar(members);
        renderCards(entries, false);
        applySelection();
        applyLayout();
      } else {
        editor.render({
          doc,
          container: ui.editView,
          store,
          claims,
          askConfirm,
          showNotice,
          onRegroup: (presetKey, overwriteManual) => applyAuto(presetKey, overwriteManual),
        });
      }
    }

    buildSkeleton();
    store.subscribe(render);
    render();

    // 元タブが閉じられたら、以降の操作ができないことだけ知らせる（表示内容は読めるまま）
    function markDetached() {
      showNotice('元のクレームチェッカーのタブが閉じられました。表示中の内容はこのまま読めますが、'
        + '再グルーピングや編集などの操作はできません。');
    }

    return {
      store,
      ui,
      render,
      applyLayout,
      applySelection,
      markDetached,
      // テスト・確認用
      getMatcher() { return matcher; },
      getCardMeta() { return cardMeta; },
      askConfirm,
      showNotice,
      hideBanner,
    };
  }

  return { createWorkspace, formatCitations };
});

/*
 * launcher-app.js — 元ページ（書類比較・クレームチェッカー）側の起動口
 *
 * やること:
 *   1. 淡い青のボタン「請求項グループ比較を開く」を 1 つだけ置く（多重実行しても増やさない）
 *   2. クリックイベント内で **同期的に** window.open して新しいタブを確保する
 *      （ポップアップブロック回避。抽出やグルーピングはタブ確保のあとで行う）
 *   3. 抽出 → 自動グルーピング → 比較ワークスペースの描画
 *
 * 守ること（要件 17）:
 *   - 元ページの Checker オブジェクト・既存 DOM を書き換えない。追加するのは
 *     #jcgc-launcher と #jcgc-launcher-style だけで、読むのは document のみ
 *   - 既存 ID を新しいタブへそのまま複製しない（新タブ側はすべて jcgc- 接頭辞）
 *   - eval・document.write・script 要素の注入を使わない（対象ページは CSP script-src 'self'。
 *     about:blank はその CSP を継承するため、新タブでもスクリプトは実行できない。
 *     新タブの中身は親タブの JS から DOM API だけで組み立てる）
 *   - 請求項本文を外部へ送らない・外部ライブラリを読み込まない
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../../extract/extractor'),
      require('../../core/grouping'),
      require('../../view/styles'),
      require('../../view/workspace')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['extractor', 'grouping', 'styles', 'workspace']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.launcherApp = factory(root.JCGC.extractor, root.JCGC.grouping,
      root.JCGC.styles, root.JCGC.workspace);
  }
})(globalThis, function (extractor, grouping, styles, workspace) {
  'use strict';

  const LAUNCHER_ID = 'jcgc-launcher';
  const STYLE_ID = 'jcgc-launcher-style';
  const BUTTON_LABEL = '請求項グループ比較を開く';

  // 開いた比較タブ。元タブを閉じるとき、各タブへ知らせるためだけに持つ
  const openWorkspaces = [];

  function readLappnum(doc, loc) {
    for (const id of ['lappnum2', 'lappnum1']) {
      const el = doc.getElementById ? doc.getElementById(id) : null;
      const value = el && (el.value || el.getAttribute('value'));
      if (value && String(value).trim() !== '') return String(value).trim();
    }
    const search = loc && loc.search ? String(loc.search) : '';
    const m = /[?&]lappnum=(\d{5,})/.exec(search);
    if (m) {
      // 12025557557 → 特願2025-557557（先頭 1 = 特許出願の区分）
      const digits = m[1];
      if (digits.length === 11 && digits.charAt(0) === '1') {
        return '特願' + digits.slice(1, 5) + '-' + digits.slice(5);
      }
      return digits;
    }
    return '';
  }

  const SOURCE_LABELS = {
    claim_mark: 'クレーム解析結果（#claim_mark）',
    input: '入力欄のクレームテキスト',
  };

  /*
   * 新しいタブへ比較ワークスペースを描く。
   * win は必ず「クリックイベント内で同期的に開いた」ウィンドウであること。
   */
  function renderInto(win, payload) {
    const doc = win.document;
    const handle = workspace.createWorkspace({
      doc,
      win,
      claims: payload.claims,
      autoGroups: payload.groups,
      preset: payload.preset,
      meta: payload.meta,
      regroup(presetKey) {
        return grouping.autoGroup(payload.claims, { preset: presetKey }).groups;
      },
    });
    openWorkspaces.push(handle);
    return handle;
  }

  // 抽出できなかったときに、新タブへ案内だけ出す（エラーで止めない）
  function renderMessage(win, message) {
    const doc = win.document;
    try { doc.title = '請求項グループ比較'; } catch (e) { /* noop */ }
    const head = doc.head || doc.documentElement;
    const style = doc.createElement('style');
    style.textContent = styles.WORKSPACE_CSS;
    head.appendChild(style);
    const body = doc.body || doc.documentElement;
    while (body.firstChild) body.removeChild(body.firstChild);

    const header = doc.createElement('header');
    header.setAttribute('class', 'jcgc-header');
    const title = doc.createElement('h1');
    title.setAttribute('class', 'jcgc-title');
    title.textContent = '請求項グループ比較';
    header.appendChild(title);
    body.appendChild(header);

    const main = doc.createElement('main');
    main.setAttribute('class', 'jcgc-main');
    const box = doc.createElement('p');
    box.setAttribute('class', 'jcgc-empty');
    box.textContent = message;
    main.appendChild(box);
    body.appendChild(main);
  }

  /*
   * 自動グルーピング。想定外のデータで例外が出ても全体を止めず、
   * 「全請求項」1グループの縮退状態へ落とす。
   */
  function safeAutoGroup(claims, preset) {
    try {
      const auto = grouping.autoGroup(claims, { preset });
      if (auto.groups.length) return { groups: auto.groups, error: null };
      // グループが1つもできない案件（請求項が1件だけ等）でも、全件のグループは出す
      return { groups: [allClaimsGroup(claims)], error: null };
    } catch (e) {
      return { groups: [allClaimsGroup(claims)], error: (e && e.message) || String(e) };
    }
  }

  function allClaimsGroup(claims) {
    return {
      id: 'all-claims',
      name: '全請求項',
      claimNumbers: claims.map((c) => c.number),
      source: 'auto',
      strategy: 'all',
      score: null,
      reasons: ['自動グループを作れなかったため、抽出できた請求項をそのまま並べています'],
      manuallyEdited: false,
      order: 1,
    };
  }

  function setMessage(el, text) {
    if (!el) return;
    el.textContent = text || '';
  }

  /*
   * ボタンを 1 つだけ置く。すでにあるときは作り直さない（多重実行対策）。
   */
  function launch(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const winRef = opts.window || (typeof window !== 'undefined' ? window : null);

    const existing = doc.getElementById(LAUNCHER_ID);
    if (existing) {
      setMessage(existing.querySelector('.jcgc-launch-msg'), '');
      const btn = existing.querySelector('button');
      if (btn && btn.focus) btn.focus();
      return { created: false, element: existing };
    }

    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = styles.LAUNCHER_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const box = doc.createElement('div');
    box.setAttribute('class', 'jcgc-launch-box');

    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.textContent = BUTTON_LABEL;

    const message = doc.createElement('div');
    message.setAttribute('class', 'jcgc-launch-msg');

    box.appendChild(button);
    box.appendChild(message);

    const container = doc.createElement('div');
    container.id = LAUNCHER_ID;
    container.appendChild(box);
    (doc.body || doc.documentElement).appendChild(container);

    button.addEventListener('click', function onClick() {
      setMessage(message, '');
      // ここは同期的に。抽出より先にタブを確保しないとポップアップブロックに掛かる
      const win = winRef && winRef.open ? winRef.open('', '_blank') : null;
      if (!win) {
        setMessage(message, 'ポップアップがブロックされました。このサイトのポップアップを許可してから、'
          + 'もう一度ボタンを押してください。');
        return;
      }

      let result;
      try {
        result = extractor.extractClaims(doc);
      } catch (e) {
        setMessage(message, '請求項の抽出に失敗しました: ' + ((e && e.message) || e));
        renderMessage(win, '請求項の抽出に失敗しました: ' + ((e && e.message) || e));
        return;
      }

      if (!result.ok || !result.claims.length) {
        setMessage(message, result.message || extractor.NO_CLAIMS_MESSAGE);
        renderMessage(win, result.message || extractor.NO_CLAIMS_MESSAGE);
        return;
      }

      const preset = grouping.DEFAULT_PRESET;
      // グルーピングで想定外のデータに当たっても、抽出できた請求項は必ず見せる。
      // 失敗したときは「全請求項」1グループだけの縮退状態で開く
      const auto = safeAutoGroup(result.claims, preset);
      const meta = {
        lappnum: readLappnum(doc, winRef && winRef.location),
        sourceLabel: SOURCE_LABELS[result.source] || result.source,
      };

      const start = () => {
        try {
          const handle = renderInto(win, {
            claims: result.claims,
            groups: auto.groups,
            preset,
            meta,
          });
          if (auto.error) {
            handle.showNotice('自動グルーピングに失敗したため、全請求項を1つのグループにして表示しています（'
              + auto.error + '）。グループ編集から手動でグループを作れます。');
          }
        } catch (e) {
          renderMessage(win, '比較画面の描画に失敗しました: ' + ((e && e.message) || e));
        }
      };

      // about:blank の document は通常すぐ使えるが、念のため body ができるまで待つ
      if (win.document && win.document.body) start();
      else winRef.setTimeout(start, 0);

      setMessage(message, '比較タブを開きました（' + result.claims.length + '請求項 / '
        + auto.groups.length + 'グループ）。');
    });

    if (winRef && winRef.addEventListener) {
      winRef.addEventListener('beforeunload', () => {
        for (const handle of openWorkspaces) {
          try { handle.markDetached(); } catch (e) { /* 既に閉じられていれば無視 */ }
        }
      });
    }

    return { created: true, element: container, button, message };
  }

  return { launch, LAUNCHER_ID, STYLE_ID, BUTTON_LABEL, readLappnum, renderMessage, safeAutoGroup };
});

globalThis.JCGC.launcherApp.launch({});
} catch (e) {
alert('請求項グループ比較: 起動に失敗しました: ' + ((e && e.message) || e));
}
})();
