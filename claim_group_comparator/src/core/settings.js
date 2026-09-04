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
