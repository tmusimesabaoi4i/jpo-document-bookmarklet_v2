/*
 * examples.js — サンプルの木構造とゴールデンケース（期待出力）
 *
 * tests/（node --test）・tests/browser-test.html・ローカルUIのサンプル読込の
 * 3箇所から参照される単一ソース。file:// では fetch が使えないため JS として保持する。
 * 木構造のテキストは提供された原文どおり（全角スペース混在を含む）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.CRW = root.CRW || {};
    root.CRW.examples = factory();
  }
})(globalThis, function () {
  'use strict';

  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  const trees = {
    tree1: {
      name: '木構造1（30項・標準的なツリー）',
      text: `  1 ┳  2 ━  3
    ┣  4 ┳  5
    ┃    ┣  6
    ┃    ┗  7
    ┣  8
    ┣  9 ┳ 10
    ┃    ┗ 11
    ┣ 12
    ┗ 13 ┳ 14
　        ┣ 15
　        ┣ 16
　        ┣ 17
　        ┣ 18
　        ┣ 19
　        ┗ 20
 21 ┳ 22
    ┣ 23
    ┣ 24
    ┗ 25 ━ 26
 27 ┳ 28
    ┗ 29
 30`,
    },
    tree2: {
      name: '木構造2（多項従属: 請求項12が多数を引用）',
      text: `  1 ┳  2 ┳  4 ━ 12
    ┃    ┗ 12
    ┣  3 ━ 12
    ┣  5 ━ 12
    ┣  6 ━ 12
    ┣  7 ━ 12
    ┗ 12
  8 ┳  9 ┳ 10 ━ 12
    ┃    ┣ 11 ━ 12
    ┃    ┗ 12
    ┗ 12`,
    },
    tree3: {
      name: '木構造3（単一の独立請求項）',
      text: '  1',
    },
    tree4: {
      name: '木構造4（独立請求項3つ）',
      text: `  1 ┳  2
    ┗  3
  4 ┳  5
    ┗  6
  7 ┳  8
    ┗  9`,
    },
    tree5: {
      name: '木構造5（多項従属12 + 独立項13）',
      text: `  1 ┳  2 ━ 12
    ┣  3 ━ 12
    ┣  4 ━ 12
    ┣  5 ━ 12
    ┣  6 ━ 12
    ┣  7 ━ 12
    ┣  8 ━ 12
    ┣  9 ━ 12
    ┣ 10 ━ 12
    ┣ 11 ━ 12
    ┗ 12
 13`,
    },
    tree6: {
      name: '木構造6（書類比較・クレームチェッカー実ページ形・24項）',
      // 「書類比較・クレームチェッカー」の #claim_tree .div_tree から抽出される形。
      // 各行末に半角スペース1個・全体の末尾に改行が付く（<br> 行終端の変換結果）。
      // エディタの行末トリムで壊れないよう、行配列から組み立てる。
      text: [
        '  1 ┳  2',
        '    ┣  3',
        '    ┣  4 ┳  5',
        '    ┃    ┣  6 ┳  7',
        '    ┃    ┃    ┗  8',
        '    ┃    ┗  9',
        '    ┣ 10',
        '    ┗ 11 ━ 12',
        ' 13 ┳ 14',
        '    ┣ 15',
        '    ┣ 16 ┳ 17 ━ 18',
        '    ┃    ┗ 19',
        '    ┣ 20',
        '    ┗ 21',
        ' 22',
        ' 23',
        ' 24',
      ].map((line) => line + ' ').join('\n') + '\n',
    },
  };

  // 引用一覧（#claim_cite）のサンプル。cite1 は tree6 と同一案件の実ページ形なので、
  // 「引用一覧から作ったグラフ＝木構造から作ったグラフ」という等価性テストに使える。
  // 行頭と「引用パターンの数」の前は全角スペース U+3000（実ページどおり）。
  const cites = {
    cite1: {
      name: '引用一覧1（書類比較・クレームチェッカー実ページ形・24項／木構造6と同一案件）',
      equivalentTree: 'tree6',
      text: [
        '合計請求項数: 24  (独立請求項: 1,13,22,23,24)',
        '',
        '[1]請求項1 『・・中継ノード』 独立請求項',
        '　被引用請求項: 2,3,4,5,6,7,8,9,10,11,12(うち間接被引用: 5,6,7,8,9,12)',
        '[2]請求項2 『・・中継ノード』 従属請求項',
        '　引用請求項: 1　引用パターンの数: 1',
        '[3]請求項3 『・・中継ノード』 従属請求項',
        '　引用請求項: 1　引用パターンの数: 1',
        '[4]請求項4 『・・中継ノード』 従属請求項',
        '　引用請求項: 1　引用パターンの数: 1',
        '　被引用請求項: 5,6,7,8,9(うち間接被引用: 7,8)',
        '[5]請求項5 『・・中継ノード』 従属請求項',
        '　引用請求項: 4 (間接引用: 1)　引用パターンの数: 1',
        '[6]請求項6 『・・中継ノード』 従属請求項',
        '　引用請求項: 4 (間接引用: 1)　引用パターンの数: 1',
        '　被引用請求項: 7,8',
        '[7]請求項7 『・・中継ノード』 従属請求項',
        '　引用請求項: 6 (間接引用: 1,4)　引用パターンの数: 1',
        '[8]請求項8 『・・中継ノード』 従属請求項',
        '　引用請求項: 6 (間接引用: 1,4)　引用パターンの数: 1',
        '[9]請求項9 『・・中継ノード』 従属請求項',
        '　引用請求項: 4 (間接引用: 1)　引用パターンの数: 1',
        '[10]請求項10 『・・中継ノード』 従属請求項',
        '　引用請求項: 1　引用パターンの数: 1',
        '[11]請求項11 『・・中継ノード』 従属請求項',
        '　引用請求項: 1　引用パターンの数: 1',
        '　被引用請求項: 12',
        '[12]請求項12 『・・中継ノード』 従属請求項',
        '　引用請求項: 11 (間接引用: 1)　引用パターンの数: 1',
        '[13]請求項13 『・・ネットワークノード』 独立請求項',
        '　被引用請求項: 14,15,16,17,18,19,20,21(うち間接被引用: 17,18,19)',
        '[14]請求項14 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 13　引用パターンの数: 1',
        '[15]請求項15 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 13　引用パターンの数: 1',
        '[16]請求項16 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 13　引用パターンの数: 1',
        '　被引用請求項: 17,18,19(うち間接被引用: 18)',
        '[17]請求項17 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 16 (間接引用: 13)　引用パターンの数: 1',
        '　被引用請求項: 18',
        '[18]請求項18 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 17 (間接引用: 16,13)　引用パターンの数: 1',
        '[19]請求項19 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 16 (間接引用: 13)　引用パターンの数: 1',
        '[20]請求項20 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 13　引用パターンの数: 1',
        '[21]請求項21 『・・ネットワークノード』 従属請求項',
        '　引用請求項: 13　引用パターンの数: 1',
        '[22]請求項22 『・・集積回路』 独立請求項',
        '[23]請求項23 『・・集積回路』 独立請求項',
        '[24]請求項24 『・・方法』 独立請求項',
      ].join('\n') + '\n',
    },
  };

  // 期待出力は仕様確定済みの表記（1文目も句点あり・数字は全角・ハイフンは半角 U+002D・
  // 区切りは読点 U+3001・各文の行頭は全角スペース U+3000）
  const goldenCases = [
    {
      id: 'case1-clarity',
      title: '木構造1: 指摘=1, 関連=21（明確性）— 提示例1',
      tree: 'tree1',
      issueType: 'clarity',
      issueClaims: [1],
      relatedClaims: [21],
      expectedSets: {
        issueClaims: [1],
        relatedClaims: [21],
        dependentClaims: range(2, 20).concat(range(22, 26)),
        allAffectedClaims: range(1, 26),
        citedSeeds: [1, 21],
      },
      expectedText: [
        '　請求項２１にも同様の点が指摘される。',
        '　請求項１、２１を引用する請求項２-２０、２２-２６にも同様の点が指摘される。',
        '　よって、請求項１-２６に係る発明は明確でない。',
      ].join('\n'),
    },
    {
      id: 'case1-support',
      title: '木構造1: 指摘=1, 関連=21（サポート要件）— 提示例1',
      tree: 'tree1',
      issueType: 'support',
      issueClaims: [1],
      relatedClaims: [21],
      expectedSets: {
        issueClaims: [1],
        relatedClaims: [21],
        dependentClaims: range(2, 20).concat(range(22, 26)),
        allAffectedClaims: range(1, 26),
        citedSeeds: [1, 21],
      },
      expectedText: [
        '　請求項２１にも同様の点が指摘される。',
        '　請求項１、２１を引用する請求項２-２０、２２-２６にも同様の点が指摘される。',
        '　よって、請求項１-２６に係る発明は、発明の詳細な説明に記載したものでない。',
      ].join('\n'),
    },
    {
      id: 'case2-clarity',
      title: '木構造1: 指摘=2,4, 関連=9,13,25（明確性）— 提示例2',
      tree: 'tree1',
      issueType: 'clarity',
      issueClaims: [2, 4],
      relatedClaims: [9, 13, 25],
      expectedSets: {
        issueClaims: [2, 4],
        relatedClaims: [9, 13, 25],
        dependentClaims: [3].concat(range(5, 7), [10, 11], range(14, 20), [26]),
        allAffectedClaims: range(2, 7).concat(range(9, 11), range(13, 20), [25, 26]),
        citedSeeds: [2, 4, 9, 13, 25],
      },
      expectedText: [
        '　請求項９、１３、２５にも同様の点が指摘される。',
        '　請求項２、４、９、１３、２５を引用する請求項３、５-７、１０-１１、１４-２０、２６にも同様の点が指摘される。',
        '　よって、請求項２-７、９-１１、１３-２０、２５-２６に係る発明は明確でない。',
      ].join('\n'),
    },
    {
      id: 'case2-support',
      title: '木構造1: 指摘=2,4, 関連=9,13,25（サポート要件）— 提示例2',
      tree: 'tree1',
      issueType: 'support',
      issueClaims: [2, 4],
      relatedClaims: [9, 13, 25],
      expectedSets: {
        issueClaims: [2, 4],
        relatedClaims: [9, 13, 25],
        dependentClaims: [3].concat(range(5, 7), [10, 11], range(14, 20), [26]),
        allAffectedClaims: range(2, 7).concat(range(9, 11), range(13, 20), [25, 26]),
        citedSeeds: [2, 4, 9, 13, 25],
      },
      expectedText: [
        '　請求項９、１３、２５にも同様の点が指摘される。',
        '　請求項２、４、９、１３、２５を引用する請求項３、５-７、１０-１１、１４-２０、２６にも同様の点が指摘される。',
        '　よって、請求項２-７、９-１１、１３-２０、２５-２６に係る発明は、発明の詳細な説明に記載したものでない。',
      ].join('\n'),
    },
    {
      id: 'case3-single',
      title: '木構造3: 指摘=1, 関連なし（明確性）— 従属項なし・3文目のみ',
      tree: 'tree3',
      issueType: 'clarity',
      issueClaims: [1],
      relatedClaims: [],
      expectedSets: {
        issueClaims: [1],
        relatedClaims: [],
        dependentClaims: [],
        allAffectedClaims: [1],
        citedSeeds: [],
      },
      expectedText: '　よって、請求項１に係る発明は明確でない。',
    },
    {
      id: 'case4-uncited-related',
      title: '木構造5: 指摘=1, 関連=13（明確性）— 誰からも引用されない関連項は2文目の主語に載せない',
      tree: 'tree5',
      issueType: 'clarity',
      issueClaims: [1],
      relatedClaims: [13],
      expectedSets: {
        issueClaims: [1],
        relatedClaims: [13],
        dependentClaims: range(2, 12),
        allAffectedClaims: range(1, 13),
        citedSeeds: [1],
      },
      expectedText: [
        '　請求項１３にも同様の点が指摘される。',
        '　請求項１を引用する請求項２-１２にも同様の点が指摘される。',
        '　よって、請求項１-１３に係る発明は明確でない。',
      ].join('\n'),
    },
    {
      id: 'case5-multipath',
      title: '木構造2: 指摘=1, 関連=8（サポート要件）— 多重経路でも12は一度だけ',
      tree: 'tree2',
      issueType: 'support',
      issueClaims: [1],
      relatedClaims: [8],
      expectedSets: {
        issueClaims: [1],
        relatedClaims: [8],
        dependentClaims: range(2, 7).concat(range(9, 12)),
        allAffectedClaims: range(1, 12),
        citedSeeds: [1, 8],
      },
      expectedText: [
        '　請求項８にも同様の点が指摘される。',
        '　請求項１、８を引用する請求項２-７、９-１２にも同様の点が指摘される。',
        '　よって、請求項１-１２に係る発明は、発明の詳細な説明に記載したものでない。',
      ].join('\n'),
    },
    {
      id: 'case6-multiroot',
      title: '木構造4: 指摘=1,4, 関連=7（明確性）— 複数の独立項',
      tree: 'tree4',
      issueType: 'clarity',
      issueClaims: [1, 4],
      relatedClaims: [7],
      expectedSets: {
        issueClaims: [1, 4],
        relatedClaims: [7],
        dependentClaims: [2, 3, 5, 6, 8, 9],
        allAffectedClaims: range(1, 9),
        citedSeeds: [1, 4, 7],
      },
      expectedText: [
        '　請求項７にも同様の点が指摘される。',
        '　請求項１、４、７を引用する請求項２-３、５-６、８-９にも同様の点が指摘される。',
        '　よって、請求項１-９に係る発明は明確でない。',
      ].join('\n'),
    },
    {
      id: 'case7-no-dependents',
      title: '木構造4: 指摘=2, 関連=3（明確性）— 従属項ゼロで2文目を省略',
      tree: 'tree4',
      issueType: 'clarity',
      issueClaims: [2],
      relatedClaims: [3],
      expectedSets: {
        issueClaims: [2],
        relatedClaims: [3],
        dependentClaims: [],
        allAffectedClaims: [2, 3],
        citedSeeds: [],
      },
      expectedText: [
        '　請求項３にも同様の点が指摘される。',
        '　よって、請求項２-３に係る発明は明確でない。',
      ].join('\n'),
    },
    {
      id: 'case8-checker-page',
      title: '木構造6: 指摘=1, 関連=13（明確性）— チェッカー実ページのツリー',
      tree: 'tree6',
      issueType: 'clarity',
      issueClaims: [1],
      relatedClaims: [13],
      expectedSets: {
        issueClaims: [1],
        relatedClaims: [13],
        dependentClaims: range(2, 12).concat(range(14, 21)),
        allAffectedClaims: range(1, 21),
        citedSeeds: [1, 13],
      },
      expectedText: [
        '　請求項１３にも同様の点が指摘される。',
        '　請求項１、１３を引用する請求項２-１２、１４-２１にも同様の点が指摘される。',
        '　よって、請求項１-２１に係る発明は明確でない。',
      ].join('\n'),
    },
  ];

  return { trees, cites, goldenCases };
});
