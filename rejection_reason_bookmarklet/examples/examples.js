'use strict';
/*
 * examples.js — ロジックのゴールデンケース（fixtures/rejection-reason/拒絶理由例.txt の期待構造化データ）
 *
 * 期待値は原文（拒絶理由例）から手作業で導出したもの。analyzer.test.js の統合テストが
 * 実際の解析結果とここを突き合わせる。29条系の合成ゴールデンケースは
 * examples-article29.js（別ファイル）にある。
 * 対象ページのスナップショットはここではなく、リポジトリ共有の fixtures/ に置く。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.examples = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {
    // fixtures/rejection-reason/拒絶理由例.txt に対する期待値
    fixture36: {
      totalReasonCount: 2,
      // クレーム構造を渡さずに解析した場合（全請求項数は本文中の最大番号からの推定）
      claimStats: {
        maxClaimNumber: 20,
        totalClaimCount: 20,
        allFinalClaims: [2, 3, 4, 5, 6, 7, 19, 20],
        allMentionedClaims: [1, 2, 3, 4, 5, 6, 7, 19, 20],
        unflaggedClaims: [1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        byCategory: {
          clarity: [2, 3, 4, 5, 6, 7, 19, 20],
          support: [2, 3, 4, 5, 6, 7, 19, 20],
          novelty: [],
          inventiveStep: [],
          other: [],
        },
        totalClaimCountSource: 'estimated',
      },
      reasons: [
        {
          reasonNumber: 1,
          category: 'clarity',
          categoryLabel: '明確性',
          legalBasis: '特許法第36条第6項第2号',
          items: [
            {
              // 10.1 明確性・第1項目
              itemNumber: 1,
              headingClaimsRaw: '２-７',
              headingClaims: [2, 3, 4, 5, 6, 7],
              effectiveHeadingClaims: [2, 3, 4, 5, 6, 7],
              correctionNote: null,
              directClaims: [2],
              citedParentClaims: [1],
              sameIssueClaims: [3, 4],
              dependencyRelations: [{ parentClaims: [2, 4], affectedClaims: [5, 6, 7] }],
              finalClaims: [2, 3, 4, 5, 6, 7],
              finalClaimsRaw: '２-７',
              finalClaimsSource: 'conclusion',
              conclusionCategory: 'clarity',
              phrases: [
                { role: 'problem', claimNumbers: [2], text: '前記所定の接続を介して前記設定情報を前記通信装置に送信するための第2接続設定処理' },
                { role: 'comparison', claimNumbers: [1], text: '前記情報処理装置の外部のアクセスポイントと接続するための設定情報を、前記所定の接続を介して、前記通信装置に送信する第1送信ステップ' },
                { role: 'problem', claimNumbers: [2], text: '第1送信ステップ' },
                { role: 'problem', claimNumbers: [2], text: '第2接続設定処理' },
              ],
              specMissing: [],
              issueSummary: '請求項2の「第1送信ステップ」と「第2接続設定処理」の異同が不明確。',
              summaryReliable: true,
              warningCodes: [],
              confidence: 'high',
              unmatchedSentences: 0,
            },
            {
              // 10.2 明確性・第2項目（見出しと結論表現の不整合 → 警告・再分類しない）
              itemNumber: 2,
              headingClaimsRaw: '１９-２０',
              headingClaims: [19, 20],
              effectiveHeadingClaims: [19, 20],
              correctionNote: null,
              directClaims: [19],
              citedParentClaims: [1],
              sameIssueClaims: [20],
              dependencyRelations: [],
              finalClaims: [19, 20],
              finalClaimsRaw: '１９-２０',
              finalClaimsSource: 'conclusion',
              conclusionCategory: 'support',
              phrases: [
                { role: 'problem', claimNumbers: [19], text: '前記設定情報を前記通信装置に送信する処理が実行され' },
                { role: 'comparison', claimNumbers: [1], text: '前記情報処理装置の外部のアクセスポイントと接続するための設定情報を、前記所定の接続を介して、前記通信装置に送信する' },
              ],
              specMissing: [],
              issueSummary: '発明特定事項同士の関係が整合しておらず、請求項19に係る発明は不明確である。',
              summaryReliable: true,
              warningCodes: ['HEADING_CONCLUSION_MISMATCH'],
              confidence: 'medium',
              unmatchedSentences: 0,
            },
          ],
        },
        {
          reasonNumber: 2,
          category: 'support',
          categoryLabel: 'サポート要件',
          legalBasis: '特許法第36条第6項第1号',
          items: [
            {
              itemNumber: 1,
              headingClaimsRaw: '２',
              headingClaims: [2],
              effectiveHeadingClaims: [2],
              correctionNote: null,
              directClaims: [2],
              citedParentClaims: [],
              sameIssueClaims: [],
              dependencyRelations: [],
              finalClaims: [2],
              finalClaimsRaw: '２',
              finalClaimsSource: 'conclusion',
              conclusionCategory: 'support',
              phrases: [
                { role: 'problem', claimNumbers: [2], text: '前記所定の接続とは異なる他の接続を介して前記設定情報を前記通信装置に送信するための第1接続設定処理を実行するか、前記所定の接続を介して前記設定情報を前記通信装置に送信するための第2接続設定処理を実行するかを、所定の条件に基づいて制御する' },
              ],
              specMissing: ['任意の条件に基づいて、第1接続設定処理を実行するか、第2接続設定処理を実行するかを制御する'],
              issueSummary: '明細書に「任意の条件に基づいて、第1接続設定処理を実行するか、第2接続設定処理を実行するかを制御する」の記載がない。',
              summaryReliable: true,
              warningCodes: [],
              confidence: 'high',
              unmatchedSentences: 0,
            },
            {
              // 10.3 サポート要件・修正注記のある項目（請求項5の扱いの矛盾 → 警告）
              itemNumber: 2,
              headingClaimsRaw: '３-５、１９-２０',
              headingClaims: [3, 4, 5, 19, 20],
              effectiveHeadingClaims: [3, 4, 19, 20],
              correctionNote: { raw: '修正：５を除く', excluded: [5] },
              directClaims: [3],
              citedParentClaims: [],
              sameIssueClaims: [4, 19, 20],
              dependencyRelations: [{ parentClaims: [4], affectedClaims: [5] }],
              finalClaims: [3, 4, 5, 19, 20],
              finalClaimsRaw: '３-５、１９-２０',
              finalClaimsSource: 'conclusion',
              conclusionCategory: 'support',
              phrases: [
                { role: 'problem', claimNumbers: [3], text: '前記所定の条件は、前記情報処理装置が接続しているアクセスポイントである所定のアクセスポイントが2.4GHzの周波数帯に対応することであり、前記所定の条件が満たされたことに基づいて前記第2接続設定処理が実行され' },
              ],
              specMissing: ['OSのバージョンがAccessorySetupKitに対応しない場合にまで第2接続設定処理を実行する'],
              issueSummary: '明細書に「OSのバージョンがAccessorySetupKitに対応しない場合にまで第2接続設定処理を実行する」の記載がない。',
              summaryReliable: true,
              warningCodes: ['CORRECTION_NOTE_CONFLICT'],
              confidence: 'medium',
              unmatchedSentences: 0,
            },
            {
              itemNumber: 3,
              headingClaimsRaw: '２-７、１９-２０',
              headingClaims: [2, 3, 4, 5, 6, 7, 19, 20],
              effectiveHeadingClaims: [2, 3, 4, 5, 6, 7, 19, 20],
              correctionNote: null,
              directClaims: [2],
              citedParentClaims: [1],
              sameIssueClaims: [3, 4, 19, 20],
              dependencyRelations: [{ parentClaims: [2, 4], affectedClaims: [5, 6, 7] }],
              finalClaims: [2, 3, 4, 5, 6, 7, 19, 20],
              finalClaimsRaw: '２-７、１９-２０',
              finalClaimsSource: 'conclusion',
              conclusionCategory: 'support',
              phrases: [
                { role: 'problem', claimNumbers: [2], text: '前記所定の接続を介して前記設定情報を前記通信装置に送信する' },
                { role: 'comparison', claimNumbers: [1], text: '前記情報処理装置の外部のアクセスポイントと接続するための設定情報を、前記所定の接続を介して、前記通信装置に送信する' },
              ],
              specMissing: ['設定情報を複数回送信する'],
              issueSummary: '明細書に「設定情報を複数回送信する」の記載がない。',
              summaryReliable: true,
              warningCodes: [],
              confidence: 'high',
              unmatchedSentences: 0,
            },
            {
              itemNumber: 4,
              headingClaimsRaw: '１９-２０',
              headingClaims: [19, 20],
              effectiveHeadingClaims: [19, 20],
              correctionNote: null,
              directClaims: [19],
              citedParentClaims: [],
              sameIssueClaims: [20],
              dependencyRelations: [],
              finalClaims: [19, 20],
              finalClaimsRaw: '１９-２０',
              finalClaimsSource: 'conclusion',
              conclusionCategory: 'support',
              phrases: [
                { role: 'problem', claimNumbers: [19], text: null },  // 268字の長文引用（先頭一致のみ検査）
              ],
              phrasePrefixes: ['前記第1検索ステップによる検索、及び、前記OSに標準搭載されている接続設定機能に対応した'],
              specMissing: ['情報処理装置が接続しているアクセスポイントが2.4GHzの周波数帯に対応していない場合にまで第2接続設定処理を実行する'],
              issueSummary: '明細書に「情報処理装置が接続しているアクセスポイントが2.4GHzの周波数帯に対応していない場合にまで第2接続設定処理を実行する」の記載がない。',
              summaryReliable: true,
              warningCodes: [],
              confidence: 'high',
              unmatchedSentences: 0,
            },
          ],
        },
      ],
      // 表示用の圧縮表記の期待値（compressClaimNumbers）
      display: {
        allFinalClaims: '2-7、19-20',
        unflaggedClaims: '1、8-18',
      },
    },

    // fixtures/claim-checker/new/書類比較・クレームチェッカー_特願2024-203064.html の
    // クレーム解析結果（#claim_mark）から抽出した請求項構造の期待値。
    // 拒絶理由例.txt と同じ出願（特願2024-203064）のスナップショットである。
    claimStructure203064: {
      totalClaimCount: 26,
      claimNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
      independentClaims: [1, 25, 26],
      // 請求項ごとの引用関係（本文の引用表現から自前解析した結果。
      // ページ側の計算結果 #claim_cite とも完全一致することを検証済み）
      directParents: {
        1: [], 2: [1], 3: [2], 4: [2], 5: [4], 6: [2], 7: [2],
        8: [1], 9: [1], 10: [1], 11: [1], 12: [1], 13: [1], 14: [13],
        15: [1], 16: [1], 17: [1], 18: [17], 19: [1], 20: [1],
        21: [1], 22: [1], 23: [1], 24: [1], 25: [], 26: [],
      },
      claim1: {
        directChildren: [2, 8, 9, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21, 22, 23, 24],
        allDescendants: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
      },
      claim2: { directChildren: [3, 4, 6, 7], allDescendants: [3, 4, 5, 6, 7], allAncestors: [1] },
      claim5: { allAncestors: [1, 2, 4], dependencyExpression: '請求項4に記載', dependencyType: 'single' },
      paths: { '2->5': [2, 4, 5], '2->6': [2, 6], '19->20': null },
      // 構造を渡して解析した場合の請求項統計（総数がHTML由来の26になる）
      claimStatsWithStructure: {
        totalClaimCount: 26,
        totalClaimCountSource: 'claimStructure',
        unflaggedClaims: [1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26],
        displayUnflagged: '1、8-18、21-26',
      },
      // 整合性検証の期待値（拒絶理由例 × このクレーム構造）
      consistency: {
        checkCount: 6,
        errorItems: [{ reasonNumber: 2, itemNumber: 2, codes: ['CONCLUSION_CLAIMS_NOT_IN_HEADING', 'BODY_CLAIMS_NOT_IN_HEADING'] }],
        omittedCandidateCount: 5,
        omittedClaims: [3, 4, 5, 6, 7],
        omittedAllInfo: true,   // すべて同一理由の他項目で指摘済みのため info
        errorCount: 2,
        // 拒絶理由が述べる引用関係（請求項2、4を引用する請求項5-7）は実構造と矛盾しない
        statedDependencyMismatches: 0,
      },
    },
  };
});
