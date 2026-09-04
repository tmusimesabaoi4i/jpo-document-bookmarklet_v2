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
