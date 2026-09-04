/*
 * segmatch.js — 段落どうしの対応付け（簡易機能・DOM 非依存）
 *
 * 目的は「グルーピング後の閲覧を少し助ける」ことだけ。グルーピング本体より複雑にしない。
 * 意味解析も動的計画法も 1 対多対応もグループ全体のアラインメントも持たない。
 * 選択された段落と、相手の請求項の**全段落**を素朴に比べ、最も似た段落を 1 つ選ぶだけ。
 *
 * 配分（settings.SEGMENT_WEIGHTS）:
 *   共通単語の割合        50%
 *   文字3-gram の類似度   25%
 *   共通する連続文字列    15%
 *   段落の長さの近さ      10%
 *   ＋ 共通する用語クラス（zenki_wdXX）への小さな加点
 *
 * 誤対応の防止（settings.SEGMENT_RULES）:
 *   - 点が最も高いというだけでは選ばない。次のいずれかを満たすことを最低条件にする
 *       * 共通語が複数ある
 *       * 十分な長さの共通連続文字列がある
 *       * 共通する用語クラスがある
 *   - 1 位と 2 位がほぼ同点なら、迷うので選ばない
 *   - 十分に似た段落が無いとき、**同じ段落番号へフォールバックしない**
 *     （誤った段落を強調するより、何も強調しないことを優先する）
 *   - 段落番号は、点が同じ候補が複数あるときの補助条件としてだけ使う
 *
 * 段落ごとの比較用データ（正規化文字列・単語集合・文字3-gram・用語クラス）は
 * createMatcher() の時点で全部作ってキャッシュする。クリックのたびに抽出も正規化もしない。
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

  /*
   * createMatcher(claims)
   *   claims: extractor が返す請求項レコードの配列
   *           （normalizedSegments と、あれば segmentTermClasses を使う）
   */
  function createMatcher(claims) {
    const list = claims || [];
    const perClaim = new Map(); // 請求項番号 → [{ text, words, g3, g2, long, classes }]

    for (const claim of list) {
      const normalizedSegments = claim.normalizedSegments || [];
      const segmentClasses = claim.segmentTermClasses || [];
      perClaim.set(claim.number, normalizedSegments.map((text, i) => ({
        text,
        words: normalize.keyTerms(text),
        g3: similarity.ngrams(text, 3),
        g2: similarity.ngrams(text, 2),
        // 「十分な長さの共通連続文字列」を安く判定するための n-gram 集合
        long: similarity.ngrams(text, RULES.substringLength),
        classes: new Set(segmentClasses[i] || []),
      })));
    }

    function scoreSegments(a, b) {
      const base = WEIGHTS.words * similarity.dice(a.words, b.words)
        + WEIGHTS.char3 * similarity.dice(a.g3, b.g3)
        + WEIGHTS.char2 * similarity.dice(a.g2, b.g2)
        + WEIGHTS.length * similarity.ratio(a.text.length, b.text.length);
      const classBonus = (a.classes.size && b.classes.size)
        ? RULES.termClassBonus * similarity.jaccard(a.classes, b.classes) : 0;
      return Math.min(1, base + classBonus);
    }

    // 最低条件（要件 2.6）。どれか 1 つでも満たせばよい
    function meetsMinimum(a, b) {
      if (similarity.intersectionSize(a.words, b.words) >= RULES.minSharedWords) return true;
      if (a.long.size && b.long.size && similarity.intersectionSize(a.long, b.long) >= 1) return true;
      if (a.classes.size && b.classes.size && similarity.intersectionSize(a.classes, b.classes) >= 1) return true;
      return false;
    }

    const cache = new Map();

    /*
     * 選択された段落（sourceNumber の第 sourceIndex 段落）に最も似ている、
     * targetNumber の段落を 1 つ返す。
     * → { index, score, runnerUp } / 選ばないときは null
     */
    function bestMatch(sourceNumber, sourceIndex, targetNumber) {
      const key = sourceNumber + ':' + sourceIndex + ':' + targetNumber;
      if (cache.has(key)) return cache.get(key);

      const sourceSegments = perClaim.get(sourceNumber);
      const targetSegments = perClaim.get(targetNumber);
      let result = null;

      if (sourceSegments && targetSegments && sourceIndex >= 1 && sourceIndex <= sourceSegments.length) {
        const source = sourceSegments[sourceIndex - 1];
        let best = null;
        let second = null;
        for (let i = 0; i < targetSegments.length; i += 1) {
          const target = targetSegments[i];
          if (!meetsMinimum(source, target)) continue; // 最低条件を満たさない候補は見ない
          const score = scoreSegments(source, target);
          const entry = { index: i + 1, score };
          if (!best || score > best.score + 1e-9
            // 同点のときだけ段落番号を補助条件に使う
            || (Math.abs(score - best.score) <= 1e-9
              && Math.abs(entry.index - sourceIndex) < Math.abs(best.index - sourceIndex))) {
            second = best;
            best = entry;
          } else if (!second || score > second.score) {
            second = entry;
          }
        }
        if (best && best.score >= RULES.minScore) {
          // 1 位と 2 位が僅差なら、どちらとも決められないので選ばない
          const tooClose = second && (best.score - second.score) < RULES.tieMargin;
          if (!tooClose) result = { index: best.index, score: best.score, runnerUp: second };
        }
      }

      cache.set(key, result);
      return result;
    }

    /*
     * 表示側が使う解決関数。
     *   - 自分自身なら選んだ段落そのもの
     *   - 十分に似た段落があればそれ
     *   - 無ければ null（同じ段落番号へは落とさない ＝「類似段落なし」）
     * → { index, score, kind: 'self' | 'similar' } | null
     */
    function resolve(sourceNumber, sourceIndex, targetNumber, targetSegmentCount) {
      if (targetNumber === sourceNumber) {
        return sourceIndex >= 1 && sourceIndex <= targetSegmentCount
          ? { index: sourceIndex, score: 1, kind: 'self' } : null;
      }
      const match = bestMatch(sourceNumber, sourceIndex, targetNumber);
      if (!match) return null;
      return { index: match.index, score: match.score, kind: 'similar' };
    }

    return {
      bestMatch,
      resolve,
      scoreSegments,
      meetsMinimum,
      segmentsOf(number) { return perClaim.get(number) || []; },
      cacheSize() { return cache.size; },
      rules: RULES,
      weights: WEIGHTS,
    };
  }

  return { createMatcher, WEIGHTS, RULES };
});
