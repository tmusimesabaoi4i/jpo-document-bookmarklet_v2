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
