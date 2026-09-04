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
