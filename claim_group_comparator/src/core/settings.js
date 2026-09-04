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
   *   共通単語の割合        50%
   *   文字3-gram            25%
   *   共通する連続文字列    15%
   *   段落の長さの近さ      10%
   * 用語クラスの一致は小さな加点（按分の外）。
   */
  const SEGMENT_WEIGHTS = {
    words: 0.50,
    char3: 0.25,
    char2: 0.15,
    length: 0.10,
  };

  const SEGMENT_RULES = {
    termClassBonus: 0.06,   // 共通する用語クラスへの小さな加点
    minScore: 0.38,         // これ未満なら「類似段落なし」（同じ段落番号へは落とさない）
    minSharedWords: 2,      // 最低条件: 共通語がこの数以上
    substringLength: 6,     // 最低条件: この長さの共通連続文字列があること
    tieMargin: 0.04,        // 1位と2位がこの差未満なら、迷うので選ばない
  };

  return {
    CLAIM_WEIGHTS,
    GROUPING_PRESETS,
    SEGMENT_WEIGHTS,
    SEGMENT_RULES,
    MAX_CANDIDATES,
    DEFAULT_PRESET: 'broad',
    MAX_GROUP_SIZE: 100,
  };
});
