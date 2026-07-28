'use strict';
/*
 * examples-article29.js — 29条系（新規性・進歩性）のゴールデンケース
 *
 * 実際の拒絶理由通知の書式に倣った合成サンプル（実案件の文言ではない）。
 * 全角数字・段落番号の範囲表記（００１５－００２３）・`１及び３` の列挙・
 * 末尾の＜引用文献等一覧＞と＜先行技術文献調査結果の記録＞を含む。
 * 引用文献一覧は罫線＋調査結果の記録より前にあるため、
 * normalizer.removeNonReasonSections で切り落とされてはならない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.examplesArticle29 = factory();
  }
})(globalThis, function () {
  'use strict';

  const text = `１．（新規性）この出願の下記の請求項に係る発明は、その出願前に日本国内又は外国において、頒布された下記の刊行物に記載された発明であるから、特許法第２９条第１項第３号に該当し、特許を受けることができない。

２．（進歩性）この出願の下記の請求項に係る発明は、その出願前に日本国内又は外国において、頒布された下記の刊行物に記載された発明に基いて、その出願前にその発明の属する技術の分野における通常の知識を有する者が容易に発明をすることができたものであるから、特許法第２９条第２項の規定により特許を受けることができない。

　　　　　　　　　　　　　　　　　記

●理由１（新規性）について

・請求項 １、８
・引用文献等 １
・備考
　引用文献１には、情報処理装置が所定の接続を介して設定情報を通信装置に送信する構成が記載されている（段落００１５－００２３、図３）。
　したがって、請求項１に係る発明は、引用文献１に記載された発明である。
　請求項８にも同様の点が指摘される。

●理由２（進歩性）について

・請求項 ２-４
・引用文献等 １、２
・備考
　引用文献２には、接続条件に応じて接続設定処理を切り替える構成が記載されている（段落００３１）。
　引用文献１に記載された発明に引用文献２に記載された技術を適用することは、当業者が容易に想到し得たことである。

・請求項 ５-７
・引用文献等 １及び３
・備考
　引用文献３には、周知の周波数帯に応じた接続制御が記載されている。

　　　　　　　　＜引用文献等一覧＞
１．特開２０２０－１２３４５６号公報
２．特開２０１９－６５４３２１号公報
３．米国特許出願公開第２０１８／０１２３４５６号明細書
－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－－
　　　　　　　　　　＜先行技術文献調査結果の記録＞
・調査した分野　　ＩＰＣ　　Ｈ０４Ｗ　４／００－９９／００
　この先行技術文献調査結果の記録は、拒絶理由を構成するものではありません。
`;

  const expected = {
    // 冒頭の理由一覧（splitter.parseLeadingReasonList）
    leadingList: [
      { num: 1, label: '新規性', category: 'novelty', legalBasis: '特許法第29条第1項第3号' },
      { num: 2, label: '進歩性', category: 'inventiveStep', legalBasis: '特許法第29条第2項' },
    ],
    // 引用文献一覧（article29.parseReferenceList）— 名称は原文どおり（全角）
    references: [
      { number: 1, name: '特開２０２０－１２３４５６号公報', raw: '１．特開２０２０－１２３４５６号公報' },
      { number: 2, name: '特開２０１９－６５４３２１号公報', raw: '２．特開２０１９－６５４３２１号公報' },
      { number: 3, name: '米国特許出願公開第２０１８／０１２３４５６号明細書', raw: '３．米国特許出願公開第２０１８／０１２３４５６号明細書' },
    ],
    // 請求項（群）× 引用文献の対応（article29.parseArticle29Section）
    mappings: [
      {
        reasonNumber: 1,
        subCategory: 'novelty',
        subCategoryLabel: '新規性',
        claims: [1, 8],
        claimsRaw: '１、８',
        referenceNumbers: [1],
        referenceNumbersRaw: '１',
        referenceNames: ['特開２０２０－１２３４５６号公報'],
        application: '単独引用',
        remarksIncludes: '（段落００１５－００２３、図３）',
        confidence: 'high',
      },
      {
        reasonNumber: 2,
        subCategory: 'inventiveStep',
        subCategoryLabel: '進歩性',
        claims: [2, 3, 4],
        claimsRaw: '２-４',
        referenceNumbers: [1, 2],
        referenceNumbersRaw: '１、２',
        referenceNames: ['特開２０２０－１２３４５６号公報', '特開２０１９－６５４３２１号公報'],
        application: '組合せ',
        remarksIncludes: '（段落００３１）',
        confidence: 'high',
      },
      {
        // 備考に「周知」があるため、引用文献が 2 件でも適用関係は周知技術と判定する
        reasonNumber: 2,
        subCategory: 'inventiveStep',
        subCategoryLabel: '進歩性',
        claims: [5, 6, 7],
        claimsRaw: '５-７',
        referenceNumbers: [1, 3],
        referenceNumbersRaw: '１及び３',
        referenceNames: ['特開２０２０－１２３４５６号公報', '米国特許出願公開第２０１８／０１２３４５６号明細書'],
        application: '周知技術',
        remarksIncludes: '周知の周波数帯',
        confidence: 'high',
      },
    ],
    // removeNonReasonSections の期待挙動
    survivingText: '＜引用文献等一覧＞',
    removedText: '先行技術文献調査結果の記録',
    removedNote: '先行技術文献調査結果の記録および連絡先の記載を解析対象から除外しました。',
  };

  return { name: '29条系（新規性・進歩性）合成サンプル', text, expected };
});
