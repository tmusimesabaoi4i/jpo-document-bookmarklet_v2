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
