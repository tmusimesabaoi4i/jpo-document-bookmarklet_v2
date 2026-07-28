/*
 * analyzer-app.js — 拒絶理由分析のモーダル UI（namespace: RRB.analyzerApp）
 *
 * 対象ページの CSP（script-src 'self'）のもとで動くブックマークレット本体。
 * 実行時に eval・Function コンストラクタでの動的コード生成・<script> 挿入・
 * 外部リソース読込は一切行わない。
 * DOM は Shadow DOM (open) に隔離し、ページ側の DOM・グローバル・スタイルには
 * 一切影響を与えない（追加するグローバルは globalThis.RRB のみ、ページに触れる
 * DOM は #rrb-host 1 個のみ）。
 *
 * 依存モジュール（RRB.analyzer / RRB.validator / RRB.claims / RRB.reportTemplate /
 * RRB.sampleData / RRB.pageClaims）はビルド時にこのファイルより前に連結される想定だが、
 * Node/モジュール環境（テストなど）で require されても落ちないよう、依存は launch() 実行時に
 * globalThis.RRB から遅延取得する（factory() 自体は引数を取らない）。
 *
 * RRB.pageClaims は対象ページの特許請求の範囲（#claim_mark 等）を読む唯一の窓口。
 * 取得した claimStructure は分析（analyze）に渡すだけで、取得できなくても分析自体は
 * 可能（その場合は文章内だけの整合性検証に限定される旨を結果画面に info 表示する）。
 *
 * ユーザー入力・解析結果はすべて textContent / value 経由で DOM に注入し、動的な値を
 * innerHTML に渡すことはしない（静的テンプレート文字列（STYLE_TEXT・PANEL_HTML）の
 * innerHTML 代入のみ許可）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.RRB = root.RRB || {};
    root.RRB.analyzerApp = factory();
  }
})(globalThis, function () {
  'use strict';

  // =====================================================================
  // STYLE_TEXT — Shadow root 内 <style> にそのまま設定する（ユーザ由来データなし）
  // =====================================================================

  const STYLE_TEXT = [
    // [hidden] は最優先・!important で確実に効かせる（後続ルールとの詳細度勝負を避ける）
    '[hidden]{display:none!important;}',
    ':host{position:fixed;inset:0;z-index:2147483000;overflow:auto;' +
      'font-family:"Segoe UI","Yu Gothic UI",Meiryo,system-ui,sans-serif;font-size:14px;' +
      'line-height:1.6;color:#1f2430;text-align:left;letter-spacing:normal;word-spacing:normal;text-transform:none;}',
    '*,*::before,*::after{box-sizing:border-box;font-family:inherit;}',
    '.rrb-modal{position:static;}',
    '.rrb-backdrop{position:absolute;inset:0;background:rgba(15,20,30,.4);}',
    '.rrb-panel{position:absolute;top:3vh;left:50%;transform:translateX(-50%);' +
      'width:min(1150px,96vw);max-height:94vh;overflow:auto;background:#fff;color:#1f2430;' +
      'border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:18px 22px 22px;}',
    '.rrb-screen{display:block;}',
    '.rrb-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;}',
    '.rrb-head h2{margin:0;font-size:1.15rem;font-weight:700;}',
    'h3,h4,h5{margin:14px 0 6px;font-weight:700;color:#1f2430;}',
    'h4{font-size:.95rem;}',
    'h5{font-size:.85rem;color:#454d59;}',
    'p{margin:0 0 8px;}',
    'button{appearance:auto;font:inherit;font-size:13px;line-height:1.4;margin:0;padding:7px 14px;' +
      'border:1px solid #c7cdd6;border-radius:6px;background:#eef1f5;color:#1f2430;cursor:pointer;' +
      'text-transform:none;box-shadow:none;touch-action:manipulation;white-space:nowrap;}',
    'button:hover{background:#e1e6ec;}',
    'button:disabled{opacity:.5;cursor:not-allowed;}',
    'button:focus-visible{outline:2px solid #1d4e89;outline-offset:1px;}',
    'button.rrb-primary{background:#1d4e89;border-color:#1d4e89;color:#fff;}',
    'button.rrb-primary:hover{background:#163f6f;}',
    'button.rrb-x{padding:0 8px;font-size:20px;line-height:1.6;background:none;border:none;color:#626b78;}',
    'button.rrb-x:hover{background:none;color:#1f2430;}',
    '.rrb-msg{margin:0 0 10px;padding:8px 12px;border-radius:6px;font-size:.85rem;white-space:pre-wrap;border:1px solid transparent;}',
    '.rrb-msg.rrb-warn{background:#fff6e5;color:#8a5a00;border-color:#f0dca8;}',
    '.rrb-msg.rrb-error{background:#fbeae9;color:#a4302a;border-color:#f1c4c0;}',
    '.rrb-msg.rrb-success{background:#e7f5ea;color:#226a3b;border-color:#bfe2c8;}',
    '.rrb-msg.rrb-info{background:#e6edf7;color:#1d4e89;border-color:#c7d6ec;}',
    '.rrb-claim-source{border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin:0 0 12px;background:#fafbfc;}',
    '.rrb-claim-source h3{margin:0 0 6px;font-size:.9rem;}',
    '.rrb-claim-structure-preview{margin-top:10px;}',
    '.rrb-claim-structure-preview .rrb-table-wrap{margin:8px 0 0;}',
    '.rrb-details{margin:8px 0 0;border:1px solid #e3e6ea;border-radius:6px;padding:8px 12px;}',
    '.rrb-details summary{cursor:pointer;color:#454d59;font-size:.85rem;}',
    '.rrb-paste-textarea{display:block;width:100%;min-height:10em;margin:8px 0;padding:8px 10px;' +
      'border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;resize:vertical;' +
      'font:12.5px/1.6 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;white-space:pre;overflow:auto;}',
    '.rrb-input-textarea{display:block;width:100%;min-height:44vh;margin:0 0 10px;padding:10px 12px;' +
      'border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;resize:vertical;' +
      'font:13.5px/1.7 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;white-space:pre;overflow:auto;}',
    '.rrb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;}',
    '.rrb-input-actions{justify-content:flex-start;}',
    '.rrb-spacer{flex:1 1 auto;}',
    '.rrb-cards{display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 14px;}',
    '.rrb-card{flex:0 0 auto;min-width:120px;padding:8px 14px;border:1px solid #d8dde3;border-radius:8px;background:#f7f8fa;}',
    '.rrb-card-label{font-size:.72rem;color:#626b78;font-weight:600;margin-bottom:2px;}',
    '.rrb-card-value{font-size:1.05rem;font-weight:700;color:#1f2430;word-break:break-word;}',
    '.rrb-card-wide{flex:1 1 260px;}',
    '.rrb-card-highlight{background:#e7f5ea;border-color:#bfe2c8;}',
    '.rrb-card-highlight .rrb-card-value{color:#226a3b;}',
    // エラー件数カードは黄色（警告）に埋もれさせず、赤で明確に目立たせる（§10）
    '.rrb-card-error{background:#fbeae9;border-color:#e3a49e;border-width:2px;}',
    '.rrb-card-error .rrb-card-value{color:#a4302a;}',
    '.rrb-total-claims-row{align-items:center;}',
    '.rrb-total-claims-row label{font-size:.85rem;font-weight:600;}',
    'input[type="number"]{font:inherit;width:6em;padding:5px 8px;border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;}',
    'input[type="number"]:focus-visible{outline:2px solid #1d4e89;outline-offset:1px;}',
    '.rrb-sub-text{font-size:.78rem;color:#626b78;}',
    '.rrb-note-caution{color:#8a5a00;}',
    '.rrb-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px;border-bottom:1px solid #d8dde3;padding-bottom:8px;}',
    'button.rrb-tab-btn{background:none;border:1px solid transparent;border-radius:6px 6px 0 0;padding:7px 12px;color:#454d59;}',
    'button.rrb-tab-btn:hover{background:#eef1f5;}',
    'button.rrb-tab-btn[aria-selected="true"]{background:#e6edf7;border-color:#c7d6ec;color:#1d4e89;font-weight:700;}',
    '.rrb-tabpanel{min-height:120px;}',
    '.rrb-reason-heading{margin-top:18px;}',
    '.rrb-empty{color:#8a93a0;font-size:.85rem;margin:6px 0 14px;}',
    '.rrb-table-wrap{overflow-x:auto;margin:0 0 16px;border:1px solid #e3e6ea;border-radius:6px;}',
    'table.rrb-table{border-collapse:collapse;width:100%;font-size:.82rem;}',
    '.rrb-table th,.rrb-table td{border-bottom:1px solid #e3e6ea;border-right:1px solid #eef0f3;padding:6px 8px;text-align:left;vertical-align:top;}',
    '.rrb-table th:last-child,.rrb-table td:last-child{border-right:none;}',
    '.rrb-table thead th{background:#f2f4f7;position:sticky;top:0;font-weight:700;}',
    '.rrb-item-row{cursor:pointer;}',
    '.rrb-item-row:hover{background:#f7f9fc;}',
    '.rrb-detail-row td{background:#f7f8fa;cursor:default;}',
    '.rrb-detail-content{padding:4px 2px;}',
    '.rrb-detail-block{margin:0 0 10px;}',
    '.rrb-detail-block ul{margin:0;padding-left:1.3em;}',
    '.rrb-detail-block li{margin:0 0 4px;}',
    '.rrb-pre{white-space:pre-wrap;word-break:break-word;background:#f2f4f7;border:1px solid #d8dde3;' +
      'border-radius:4px;padding:8px;font:12.5px/1.6 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;margin:0;}',
    '.rrb-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:.72rem;font-weight:700;margin-right:4px;white-space:nowrap;}',
    '.rrb-badge-direct{background:#e6edf7;color:#1d4e89;font-weight:800;}',
    '.rrb-badge-same{background:#e1f3f0;color:#1d7a70;}',
    '.rrb-badge-cited{background:#f0e6f7;color:#6a2fa0;}',
    '.rrb-badge-warn{background:#fff6e5;color:#8a5a00;}',
    '.rrb-badge-error{background:#fbeae9;color:#a4302a;}',
    '.rrb-badge-low{background:#eef1f5;color:#626b78;}',
    '.rrb-badge-ok{background:#e7f5ea;color:#226a3b;}',
    'button.rrb-detail-toggle{padding:4px 10px;font-size:.75rem;}',
    '.rrb-footer{border-top:1px solid #e3e6ea;padding-top:12px;margin-top:8px;}',
    '.rrb-feedback{font-size:.8rem;font-weight:700;}',
    '.rrb-feedback.rrb-feedback-ok{color:#226a3b;}',
    '.rrb-feedback.rrb-feedback-ng{color:#a4302a;}',
    '#rrb-source-details{margin-top:10px;}',
    '.rrb-overview-list{margin:0 0 10px;padding-left:1.3em;}',
    '.rrb-overview-list li{margin:0 0 6px;}',
    '.rrb-copy-helper{position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0;pointer-events:none;}',
  ].join('\n');

  // =====================================================================
  // PANEL_HTML — 静的テンプレート（ユーザ由来データを一切含まない）
  // =====================================================================

  const PANEL_HTML = [
    '<div class="rrb-backdrop"></div>',
    '<div class="rrb-panel" role="dialog" aria-modal="true" aria-labelledby="rrb-title">',

    '  <section id="rrb-screen-input" class="rrb-screen">',
    '    <div class="rrb-head">',
    '      <h2 id="rrb-title">拒絶理由分析</h2>',
    '      <button type="button" id="rrb-close-input-btn" class="rrb-x" aria-label="閉じる">×</button>',
    '    </div>',
    '    <div id="rrb-input-warning" class="rrb-msg rrb-warn" hidden></div>',

    '    <div class="rrb-claim-source">',
    '      <h3>請求項の取得元（任意・指摘漏れ候補と請求項の実在確認に使用）</h3>',
    '      <div id="rrb-claim-source-message" class="rrb-msg" hidden></div>',
    '      <div class="rrb-row">',
    '        <button type="button" id="rrb-collect-claims-btn">ページから請求項を取得</button>',
    '      </div>',
    '      <details class="rrb-details" id="rrb-paste-claims-details">',
    '        <summary>請求項全文を貼り付けて使う</summary>',
    '        <textarea id="rrb-paste-claims-text" class="rrb-paste-textarea" spellcheck="false"',
    '          placeholder="【請求項1】…&#10;【請求項2】…（見出し形式で請求項全文を貼り付けてください）"></textarea>',
    '        <div class="rrb-row">',
    '          <button type="button" id="rrb-paste-claims-btn">貼り付けた請求項を使う</button>',
    '        </div>',
    '      </details>',

    '      <div id="rrb-claim-structure-preview" class="rrb-claim-structure-preview" hidden>',
    '        <p id="rrb-claim-structure-summary" class="rrb-sub-text"></p>',
    '        <details class="rrb-details" id="rrb-claim-structure-details">',
    '          <summary id="rrb-claim-structure-details-summary">請求項構造を表示</summary>',
    '          <div id="rrb-claim-structure-warnings"></div>',
    '          <div id="rrb-claim-structure-table-wrap" class="rrb-table-wrap"></div>',
    '        </details>',
    '      </div>',
    '    </div>',

    '    <textarea id="rrb-input-text" class="rrb-input-textarea" spellcheck="false"',
    '      placeholder="拒絶理由通知書の本文をここに貼り付けてください（「・請求項」「よって、」などの記載を含む全文を推奨します）。"></textarea>',
    '    <input type="file" id="rrb-file-input" accept=".txt,text/plain" hidden>',
    '    <div class="rrb-row rrb-input-actions">',
    '      <button type="button" id="rrb-load-file-btn">TXTファイルを読み込む</button>',
    '      <button type="button" id="rrb-load-sample-btn">サンプルを読み込む</button>',
    '      <button type="button" id="rrb-clear-btn">クリア</button>',
    '      <span class="rrb-spacer"></span>',
    '      <button type="button" id="rrb-analyze-btn" class="rrb-primary">分析する</button>',
    '      <button type="button" id="rrb-close-input-btn2">閉じる</button>',
    '    </div>',
    '  </section>',

    '  <section id="rrb-screen-result" class="rrb-screen" hidden>',
    '    <div class="rrb-head">',
    '      <h2>拒絶理由分析結果</h2>',
    '      <div class="rrb-row">',
    '        <button type="button" id="rrb-back-btn">入力へ戻る</button>',
    '        <button type="button" id="rrb-reanalyze-btn">再解析</button>',
    '        <button type="button" id="rrb-close-result-btn">閉じる</button>',
    '      </div>',
    '    </div>',

    '    <div id="rrb-claim-structure-info" class="rrb-msg rrb-info" hidden></div>',

    '    <div id="rrb-summary-cards" class="rrb-cards"></div>',

    '    <div class="rrb-row rrb-total-claims-row">',
    '      <label for="rrb-total-claims-input">全請求項数</label>',
    '      <input type="number" min="1" id="rrb-total-claims-input">',
    '      <span id="rrb-total-claims-note" class="rrb-sub-text"></span>',
    '    </div>',

    '    <div id="rrb-tabs" class="rrb-tabs" role="tablist"></div>',
    '    <div id="rrb-tabpanel" class="rrb-tabpanel" role="tabpanel"></div>',

    '    <div class="rrb-row rrb-footer">',
    '      <button type="button" id="rrb-copy-table-btn">表をコピー (TSV)</button>',
    '      <button type="button" id="rrb-copy-json-btn">JSONをコピー</button>',
    '      <button type="button" id="rrb-save-json-btn">JSON保存</button>',
    '      <button type="button" id="rrb-save-csv-btn">CSV保存</button>',
    '      <button type="button" id="rrb-open-report-btn">レポートを別タブで開く</button>',
    '      <button type="button" id="rrb-toggle-source-btn">原文全文を表示</button>',
    '      <span id="rrb-footer-feedback" class="rrb-feedback" role="status" aria-live="polite"></span>',
    '    </div>',
    '    <details id="rrb-source-details">',
    '      <summary>入力した原文全文</summary>',
    '      <pre id="rrb-source-pre" class="rrb-pre"></pre>',
    '    </details>',
    '  </section>',

    '  <textarea id="rrb-copy-helper" class="rrb-copy-helper" tabindex="-1" aria-hidden="true"></textarea>',
    '</div>',
  ].join('\n');

  // タブ定義（表示順・ラベルはここで一元管理する）
  const TAB_DEFS = [
    { id: 'overview', label: '概要' },
    { id: 'clarity', label: '明確性' },
    { id: 'support', label: 'サポート要件' },
    { id: 'article29', label: '29条系' },
    { id: 'other', label: 'その他' },
    { id: 'unparsed', label: '未解析・警告' },
    { id: 'claimStructure', label: '請求項構造' },
    { id: 'consistency', label: '整合性チェック' },
    { id: 'omitted', label: '指摘漏れ候補' },
  ];

  const ARTICLE29_GROUPS = [
    ['novelty', '新規性'],
    ['inventiveStep', '進歩性'],
    ['article29-unknown', '29条系（区分不明）'],
  ];

  // =====================================================================
  // 純粋ヘルパ（DOM構築を伴わないもの）
  // =====================================================================

  // 起動時に必要な依存モジュールを globalThis.RRB から遅延取得する
  function resolveDeps() {
    const ns = globalThis.RRB || {};
    const required = {
      analyzer: ns.analyzer,
      validator: ns.validator,
      claims: ns.claims,
      reportTemplate: ns.reportTemplate,
      sampleData: ns.sampleData,
      pageClaims: ns.pageClaims,
    };
    const missing = Object.keys(required).filter((k) => !required[k]);
    return Object.assign({ ok: missing.length === 0, missing }, required);
  }

  function truncateText(text, max) {
    const s = String(text == null ? '' : text);
    return s.length <= max ? s : s.slice(0, max) + '…';
  }

  // 複数の請求項番号配列の和集合（昇順・重複なし）
  function unionClaims(...arrays) {
    const set = new Set();
    for (const arr of arrays) {
      for (const n of arr || []) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }

  function sumItemsByCategory(reasons, category) {
    return (reasons || [])
      .filter((r) => r.category === category)
      .reduce((n, r) => n + ((r.items || []).length), 0);
  }

  function confidenceLabel(c) {
    if (c === 'high') return '高';
    if (c === 'medium') return '中';
    if (c === 'low') return '低';
    return c || '不明';
  }

  function groupPhrasesByRole(phrases) {
    const order = ['problem', 'comparison', 'spec', 'unknown'];
    const map = new Map();
    for (const p of phrases || []) {
      const key = p.role || 'unknown';
      if (!map.has(key)) map.set(key, { role: key, roleLabel: p.roleLabel || key, phrases: [] });
      map.get(key).phrases.push(p);
    }
    return order.filter((r) => map.has(r)).map((r) => map.get(r));
  }

  // 「請求項Pを引用する請求項Aにも同様の点が指摘される」の内訳を文章化する
  function describeDependencyRelation(claimsMod, rel) {
    return '請求項' + claimsMod.compressClaimNumbers(rel.parentClaims) +
      'を引用する請求項' + claimsMod.compressClaimNumbers(rel.affectedClaims);
  }

  // 請求項番号配列を圧縮せず「、」区切りでそのまま並べる（請求項構造タブの直接下位／全下位用。
  // 引用元側は範囲圧縮を使うのに対し、下位側は個々の番号をそのまま確認したいための意図的な区別）
  function joinPlain(arr) {
    return (arr || []).join('、');
  }

  // consistencyChecks.issues は severity 'warn' を、omittedClaimCandidates は 'warning' を使う
  // （コアモジュール間で表記が異なる）ため、UI 表示ではまとめて統一ラベルにする
  function severityLabel(sev) {
    if (sev === 'error') return 'エラー';
    if (sev === 'warn' || sev === 'warning') return '要確認';
    return '参考';
  }

  function severityBadgeClass(sev) {
    if (sev === 'error') return 'rrb-badge-error';
    if (sev === 'warn' || sev === 'warning') return 'rrb-badge-warn';
    return 'rrb-badge-low';
  }

  const STATUS_LABEL = { ok: '整合', warning: '要確認', error: '不一致' };

  // 全請求項数の由来ラベル（「全請求項数」欄の小さな注記に使う）
  const TOTAL_CLAIM_SOURCE_LABEL = {
    claimStructure: '特許請求の範囲から取得',
    manual: '手動設定',
    estimated: '本文からの推定',
  };

  function statusBadgeClass(status) {
    if (status === 'error') return 'rrb-badge-error';
    if (status === 'warning') return 'rrb-badge-warn';
    return 'rrb-badge-ok';
  }

  // 差分セル: 非空の項目だけを「見出し−結論: 2-7」のように列挙する（§7 の6集合の突き合わせ）
  function buildDiffSummary(claimsMod, check) {
    const parts = [];
    const push = (label, arr) => {
      if ((arr || []).length > 0) parts.push(label + ': ' + claimsMod.compressClaimNumbers(arr));
    };
    push('見出し−結論', check.missingFromConclusion);
    push('結論−見出し', check.unexpectedInConclusion);
    push('本文−結論', check.bodyMissingFromConclusion);
    push('結論−本文', check.conclusionMissingFromBody);
    push('本文−見出し', check.missingFromHeading);
    push('見出し−本文', check.missingFromBody);
    return parts.join(' ／ ');
  }

  // reasonNumber・itemNumber から元の ITEM を引く（consistencyChecks は直接指摘／同様指摘／
  // 引用による指摘の請求項配列を保持していないため、詳細表示のために逆引きする）
  function findSourceItem(result, reasonNumber, itemNumber) {
    const reason = (result.reasons || []).find((r) => r.reasonNumber === reasonNumber);
    if (!reason) return null;
    return (reason.items || []).find((it) => it.itemNumber === itemNumber) || null;
  }

  // 文書全体・理由・項目・29条マッピングの警告を「箇所」ラベル付きでフラット化する
  function collectAllWarnings(result) {
    const out = [];
    const metadata = result.metadata || {};
    for (const w of metadata.warnings || []) {
      out.push({ location: '文書全体', code: w.code, message: w.message, severity: w.severity });
    }
    for (const reason of result.reasons || []) {
      for (const w of reason.warnings || []) {
        out.push({ location: '理由' + reason.reasonNumber, code: w.code, message: w.message, severity: w.severity });
      }
      for (const item of reason.items || []) {
        for (const w of item.warnings || []) {
          out.push({
            location: '理由' + reason.reasonNumber + ' 項目' + item.itemNumber,
            code: w.code, message: w.message, severity: w.severity,
          });
        }
      }
    }
    const mappings = ((result.noveltyInventiveStep || {}).mappings) || [];
    for (const m of mappings) {
      for (const w of m.warnings || []) {
        out.push({
          location: '理由' + m.reasonNumber + ' ' + (m.subCategoryLabel || '29条系'),
          code: w.code, message: w.message, severity: w.severity,
        });
      }
    }
    return out;
  }

  // =====================================================================
  // DOM 構築ヘルパ（result → DOM の小さな写像関数）
  // =====================================================================

  function makeBadge(doc, className, text) {
    const span = doc.createElement('span');
    span.className = 'rrb-badge ' + className;
    span.textContent = text;
    return span;
  }

  function cellText(doc, text) {
    const td = doc.createElement('td');
    td.textContent = text;
    return td;
  }

  function claimBadgeCell(doc, className, label, arr, claimsMod) {
    const td = doc.createElement('td');
    const list = arr || [];
    if (list.length === 0) {
      td.textContent = '—';
      return td;
    }
    td.appendChild(makeBadge(doc, className, label));
    td.appendChild(doc.createTextNode(' ' + claimsMod.compressClaimNumbers(list)));
    return td;
  }

  function buildEmptyNotice(doc, text) {
    const p = doc.createElement('p');
    p.className = 'rrb-empty';
    p.textContent = text;
    return p;
  }

  function detailBlock(doc, label, contentEl) {
    const block = doc.createElement('div');
    block.className = 'rrb-detail-block';
    const h = doc.createElement('h5');
    h.textContent = label;
    block.appendChild(h);
    block.appendChild(contentEl);
    return block;
  }

  function preText(doc, text) {
    const pre = doc.createElement('pre');
    pre.className = 'rrb-pre';
    pre.textContent = text;
    return pre;
  }

  function buildCard(doc, label, value, extraClass) {
    const card = doc.createElement('div');
    card.className = 'rrb-card' + (extraClass ? ' ' + extraClass : '');
    const l = doc.createElement('div');
    l.className = 'rrb-card-label';
    l.textContent = label;
    const v = doc.createElement('div');
    v.className = 'rrb-card-value';
    v.textContent = value;
    card.appendChild(l);
    card.appendChild(v);
    return card;
  }

  function renderSummaryCards(doc, container, result, claimsMod) {
    container.textContent = '';
    const metadata = result.metadata || {};
    const claimStats = metadata.claimStats || {};
    const reasons = result.reasons || [];
    const clarityCount = sumItemsByCategory(reasons, 'clarity');
    const supportCount = sumItemsByCategory(reasons, 'support');
    const article29Count = ((result.noveltyInventiveStep || {}).mappings || []).length;
    const warningsCount = collectAllWarnings(result).length;

    container.appendChild(buildCard(doc, '理由数', String(metadata.totalReasonCount != null ? metadata.totalReasonCount : reasons.length)));
    container.appendChild(buildCard(doc, '明確性 件数', String(clarityCount)));
    container.appendChild(buildCard(doc, 'サポート要件 件数', String(supportCount)));
    container.appendChild(buildCard(doc, '29条系 件数', String(article29Count)));
    container.appendChild(buildCard(doc, '警告 件数', String(warningsCount)));

    // 整合性チェック（claim-structure・consistency 由来）のエラー/警告/情報件数。
    // エラーは黄色の警告カードに埋もれさせず赤で目立たせる（rrb-card-error）
    const issueCounts = metadata.issueCounts || { error: 0, warning: 0, info: 0 };
    container.appendChild(buildCard(doc, 'エラー', String(issueCounts.error || 0),
      issueCounts.error > 0 ? 'rrb-card-error' : ''));
    container.appendChild(buildCard(doc, '警告（整合性）', String(issueCounts.warning || 0)));
    container.appendChild(buildCard(doc, '情報', String(issueCounts.info || 0)));

    const finalClaimsText = claimsMod.compressClaimNumbers(claimStats.allFinalClaims || []) || 'なし';
    const unflaggedText = claimsMod.compressClaimNumbers(claimStats.unflaggedClaims || []) || 'なし';
    container.appendChild(buildCard(doc, '最終指摘された請求項', finalClaimsText, 'rrb-card-wide'));
    container.appendChild(buildCard(doc, '未指摘の請求項', unflaggedText, 'rrb-card-wide rrb-card-highlight'));
  }

  // ---- 明確性・サポート要件・その他 タブ ----

  function buildItemDetailContent(doc, item, claimsMod) {
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-detail-content';

    wrap.appendChild(detailBlock(doc, '原文全文', preText(doc, item.sourceText || '')));

    const groups = groupPhrasesByRole(item.problematicPhrases);
    if (groups.length > 0) {
      const ul = doc.createElement('ul');
      for (const g of groups) {
        for (const p of g.phrases) {
          const li = doc.createElement('li');
          const strong = doc.createElement('strong');
          strong.textContent = g.roleLabel;
          li.appendChild(strong);
          const claimNote = (p.claimNumbers && p.claimNumbers.length)
            ? '（請求項' + claimsMod.compressClaimNumbers(p.claimNumbers) + '）' : '';
          li.appendChild(doc.createTextNode(': ' + p.text + claimNote));
          ul.appendChild(li);
        }
      }
      wrap.appendChild(detailBlock(doc, '抽出された記載', ul));
    }

    const relations = item.dependencyRelations || [];
    if (relations.length > 0) {
      const ul = doc.createElement('ul');
      for (const rel of relations) {
        const li = doc.createElement('li');
        li.textContent = describeDependencyRelation(claimsMod, rel);
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '引用関係の内訳', ul));
    }

    const concl = doc.createElement('p');
    concl.textContent = item.conclusionText || 'なし';
    wrap.appendChild(detailBlock(doc, '結論文', concl));

    const conf = doc.createElement('p');
    conf.textContent = confidenceLabel(item.confidence);
    wrap.appendChild(detailBlock(doc, '確度', conf));

    const warnings = item.warnings || [];
    if (warnings.length > 0) {
      const ul = doc.createElement('ul');
      for (const w of warnings) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity === 'error' ? 'エラー' : '警告'));
        li.appendChild(doc.createTextNode(' ' + w.message));
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '警告', ul));
    }

    const unmatched = item.unmatchedSentences || [];
    if (unmatched.length > 0) {
      const ul = doc.createElement('ul');
      for (const s of unmatched) {
        const li = doc.createElement('li');
        li.textContent = s;
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '未解析の文', ul));
    }

    return wrap;
  }

  function appendItemRows(doc, tbody, item, claimsMod) {
    const citedParents = unionClaims(item.citedParentClaims, ...(item.dependencyRelations || []).map((d) => d.parentClaims));

    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';

    tr.appendChild(cellText(doc, item.itemNumber != null ? String(item.itemNumber) : ''));

    const headingCell = doc.createElement('td');
    const headingMain = doc.createElement('div');
    headingMain.textContent = claimsMod.compressClaimNumbers(item.effectiveHeadingClaims);
    headingCell.appendChild(headingMain);
    if (item.correctionNote) {
      const sub = doc.createElement('div');
      sub.className = 'rrb-sub-text';
      sub.textContent = '原文: ' + (item.headingClaimsRaw || '');
      headingCell.appendChild(sub);
    }
    tr.appendChild(headingCell);

    const problemPhrase = (item.problematicPhrases || []).find((p) => p.role === 'problem');
    const problemCell = doc.createElement('td');
    if (problemPhrase) {
      problemCell.textContent = truncateText(problemPhrase.text, 40);
      problemCell.title = problemPhrase.text;
    } else {
      problemCell.textContent = '—';
    }
    tr.appendChild(problemCell);

    tr.appendChild(claimBadgeCell(doc, 'rrb-badge-direct', '直接', item.directClaims, claimsMod));
    tr.appendChild(claimBadgeCell(doc, 'rrb-badge-same', '同様', item.sameIssueClaims, claimsMod));
    tr.appendChild(claimBadgeCell(doc, 'rrb-badge-cited', '引用先', citedParents, claimsMod));

    const affectedCell = doc.createElement('td');
    const relations = item.dependencyRelations || [];
    if (relations.length === 0) {
      affectedCell.textContent = '—';
    } else {
      for (const rel of relations) {
        const line = doc.createElement('div');
        line.appendChild(makeBadge(doc, 'rrb-badge-cited', '引用先'));
        line.appendChild(doc.createTextNode(
          ' ' + claimsMod.compressClaimNumbers(rel.parentClaims) + ' → ' + claimsMod.compressClaimNumbers(rel.affectedClaims)
        ));
        affectedCell.appendChild(line);
      }
    }
    tr.appendChild(affectedCell);

    const finalCell = doc.createElement('td');
    finalCell.textContent = (item.finalClaims && item.finalClaims.length)
      ? claimsMod.compressClaimNumbers(item.finalClaims) : (item.finalClaimsRaw || '—');
    tr.appendChild(finalCell);

    const summaryCell = doc.createElement('td');
    summaryCell.appendChild(doc.createTextNode(item.issueSummary || ''));
    if (item.summaryReliable === false) {
      const note = doc.createElement('div');
      note.className = 'rrb-sub-text rrb-note-caution';
      note.textContent = '自動要約の確度が低い';
      summaryCell.appendChild(note);
    }
    tr.appendChild(summaryCell);

    const warnCell = doc.createElement('td');
    const warnings = item.warnings || [];
    if (warnings.length > 0) {
      const hasError = warnings.some((w) => w.severity === 'error');
      warnCell.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', '警告 ' + warnings.length));
    }
    if (item.confidence === 'low') {
      warnCell.appendChild(makeBadge(doc, 'rrb-badge-low', '確度低'));
    }
    if (warnings.length === 0 && item.confidence !== 'low') warnCell.textContent = '—';
    tr.appendChild(warnCell);

    const toggleCell = doc.createElement('td');
    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'rrb-detail-toggle';
    toggleBtn.textContent = '詳細';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleCell.appendChild(toggleBtn);
    tr.appendChild(toggleCell);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 11;
    detailTd.appendChild(buildItemDetailContent(doc, item, claimsMod));
    detailTr.appendChild(detailTd);

    // 行クリック・「詳細」ボタンいずれからも開閉できる（ボタンのクリックは行へバブリングする）
    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      toggleBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function buildReasonItemTable(doc, reason, claimsMod) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['No.', '見出し請求項', '問題となる記載', '直接指摘', '同様指摘', '引用元', '引用による指摘', '最終指摘', '問題の要約', '警告', '詳細']
      .forEach((label) => {
        const th = doc.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
      });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const item of reason.items || []) appendItemRows(doc, tbody, item, claimsMod);
    table.appendChild(tbody);
    return table;
  }

  function renderItemCategoryTab(doc, container, result, category, claimsMod) {
    container.textContent = '';
    const reasons = (result.reasons || []).filter((r) => r.category === category);
    if (reasons.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    for (const reason of reasons) {
      const heading = doc.createElement('h4');
      heading.className = 'rrb-reason-heading';
      heading.textContent = '理由' + reason.reasonNumber + '（' + (reason.categoryLabel || '') + '）' +
        (reason.legalBasis ? ' - ' + reason.legalBasis : '');
      container.appendChild(heading);
      if (!reason.items || reason.items.length === 0) {
        container.appendChild(buildEmptyNotice(doc, '項目なし'));
        continue;
      }
      const wrap = doc.createElement('div');
      wrap.className = 'rrb-table-wrap';
      wrap.appendChild(buildReasonItemTable(doc, reason, claimsMod));
      container.appendChild(wrap);
    }
  }

  // ---- 29条系 タブ ----

  function buildReferenceListTable(doc, references) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['番号', '名称', '対応'].forEach((l) => {
      const th = doc.createElement('th');
      th.textContent = l;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const ref of references) {
      const tr = doc.createElement('tr');
      tr.appendChild(cellText(doc, ref.number != null ? String(ref.number) : ''));
      tr.appendChild(cellText(doc, ref.name || ''));
      const statusTd = doc.createElement('td');
      if (ref.matched) {
        statusTd.textContent = '対応済み';
      } else {
        statusTd.appendChild(makeBadge(doc, 'rrb-badge-warn', '未対応'));
      }
      tr.appendChild(statusTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function buildMappingDetailContent(doc, mapping) {
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-detail-content';
    wrap.appendChild(detailBlock(doc, '原文全文', preText(doc, mapping.sourceText || '')));
    const conf = doc.createElement('p');
    conf.textContent = confidenceLabel(mapping.confidence);
    wrap.appendChild(detailBlock(doc, '確度', conf));
    const warnings = mapping.warnings || [];
    if (warnings.length > 0) {
      const ul = doc.createElement('ul');
      for (const w of warnings) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity === 'error' ? 'エラー' : '警告'));
        li.appendChild(doc.createTextNode(' ' + w.message));
        ul.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '警告', ul));
    }
    return wrap;
  }

  function appendMappingRows(doc, tbody, mapping, claimsMod) {
    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';
    tr.appendChild(cellText(doc, mapping.claimsRaw || claimsMod.compressClaimNumbers(mapping.claims)));
    tr.appendChild(cellText(doc, mapping.referenceNumbersRaw || claimsMod.compressClaimNumbers(mapping.referenceNumbers)));
    const refNames = (mapping.referenceNames || []).map((n) => n || '(不明)').join('、');
    tr.appendChild(cellText(doc, refNames));
    tr.appendChild(cellText(doc, mapping.application || '—'));

    const remarksTd = doc.createElement('td');
    const remarks = mapping.remarks || '';
    remarksTd.textContent = remarks ? truncateText(remarks, 40) : '—';
    if (remarks) remarksTd.title = remarks;
    tr.appendChild(remarksTd);

    const warnTd = doc.createElement('td');
    const warnings = mapping.warnings || [];
    if (warnings.length > 0) {
      const hasError = warnings.some((w) => w.severity === 'error');
      warnTd.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', '警告 ' + warnings.length));
    } else {
      warnTd.textContent = '—';
    }
    tr.appendChild(warnTd);

    const toggleTd = doc.createElement('td');
    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'rrb-detail-toggle';
    toggleBtn.textContent = '詳細';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleTd.appendChild(toggleBtn);
    tr.appendChild(toggleTd);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 7;
    detailTd.appendChild(buildMappingDetailContent(doc, mapping));
    detailTr.appendChild(detailTd);

    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      toggleBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function buildMappingTable(doc, mappings, claimsMod) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['請求項', '引用文献番号', '引用文献名', '適用関係', '備考', '警告', '詳細'].forEach((l) => {
      const th = doc.createElement('th');
      th.textContent = l;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const mapping of mappings) appendMappingRows(doc, tbody, mapping, claimsMod);
    table.appendChild(tbody);
    return table;
  }

  function renderArticle29Tab(doc, container, result, claimsMod) {
    container.textContent = '';
    const novelty = result.noveltyInventiveStep || {};
    const references = novelty.references || [];
    const mappings = novelty.mappings || [];
    if (references.length === 0 && mappings.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    if (references.length > 0) {
      const heading = doc.createElement('h4');
      heading.textContent = '引用文献一覧';
      container.appendChild(heading);
      const wrap = doc.createElement('div');
      wrap.className = 'rrb-table-wrap';
      wrap.appendChild(buildReferenceListTable(doc, references));
      container.appendChild(wrap);
    }
    for (const [key, label] of ARTICLE29_GROUPS) {
      const matched = mappings.filter((m) => m.subCategory === key);
      if (matched.length === 0 && key === 'article29-unknown') continue; // 区分不明が無ければ表自体を省略
      const heading = doc.createElement('h4');
      heading.textContent = label;
      container.appendChild(heading);
      if (matched.length === 0) {
        container.appendChild(buildEmptyNotice(doc, '該当なし'));
        continue;
      }
      const wrap = doc.createElement('div');
      wrap.className = 'rrb-table-wrap';
      wrap.appendChild(buildMappingTable(doc, matched, claimsMod));
      container.appendChild(wrap);
    }
  }

  // ---- 概要 タブ ----

  function renderOverviewTab(doc, container, result) {
    container.textContent = '';
    const reasons = result.reasons || [];
    const heading1 = doc.createElement('h4');
    heading1.textContent = '理由一覧';
    container.appendChild(heading1);
    if (reasons.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
    } else {
      const ul = doc.createElement('ul');
      ul.className = 'rrb-overview-list';
      for (const reason of reasons) {
        const li = doc.createElement('li');
        const article29Count = ((reason.article29 && reason.article29.mappings) || []).length;
        const itemCount = (reason.items || []).length + article29Count;
        const warnCount = (reason.warnings || []).length;
        li.textContent = '理由' + reason.reasonNumber + '（' + (reason.categoryLabel || '') + '）' +
          (reason.legalBasis ? ' - ' + reason.legalBasis : '') +
          ' ／ 項目数: ' + itemCount + ' ／ 警告: ' + warnCount + '件';
        ul.appendChild(li);
      }
      container.appendChild(ul);
    }

    const heading2 = doc.createElement('h4');
    heading2.textContent = '文書全体の警告';
    container.appendChild(heading2);
    const docWarnings = (result.metadata && result.metadata.warnings) || [];
    if (docWarnings.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    const ul = doc.createElement('ul');
    ul.className = 'rrb-overview-list';
    for (const w of docWarnings) {
      const li = doc.createElement('li');
      li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity || ''));
      li.appendChild(doc.createTextNode(' ' + w.message));
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  // ---- 未解析・警告 タブ ----

  function renderUnparsedWarningsTab(doc, container, result) {
    container.textContent = '';
    const heading1 = doc.createElement('h4');
    heading1.textContent = '未解析原文';
    container.appendChild(heading1);
    const unparsed = result.unparsedSections || [];
    if (unparsed.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
    } else {
      for (const u of unparsed) {
        const block = doc.createElement('div');
        block.className = 'rrb-detail-block';
        const sub = doc.createElement('div');
        sub.className = 'rrb-sub-text';
        sub.textContent = (u.location || '') + (u.note ? '（' + u.note + '）' : '');
        block.appendChild(sub);
        block.appendChild(preText(doc, u.text || ''));
        container.appendChild(block);
      }
    }

    const heading2 = doc.createElement('h4');
    heading2.textContent = '警告一覧';
    container.appendChild(heading2);
    const allWarnings = collectAllWarnings(result);
    if (allWarnings.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['箇所', 'コード', '重大度', '内容'].forEach((l) => {
      const th = doc.createElement('th');
      th.textContent = l;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const w of allWarnings) {
      const tr = doc.createElement('tr');
      tr.appendChild(cellText(doc, w.location));
      tr.appendChild(cellText(doc, w.code || ''));
      tr.appendChild(cellText(doc, w.severity || ''));
      tr.appendChild(cellText(doc, w.message || ''));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // ---- 請求項構造 タブ ----

  const DEPENDENCY_TYPE_LABEL = { single: '単独', selective: '選択的', cumulative: '累積的' };

  function appendClaimRows(doc, tbody, claim, claimsMod) {
    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';

    // 請求項番号セルをクリック（またはボタン操作）すると請求項全文を展開する
    const numCell = doc.createElement('td');
    const numBtn = doc.createElement('button');
    numBtn.type = 'button';
    numBtn.className = 'rrb-detail-toggle';
    numBtn.textContent = String(claim.claimNumber);
    numBtn.setAttribute('aria-expanded', 'false');
    numCell.appendChild(numBtn);
    tr.appendChild(numCell);

    const typeCell = doc.createElement('td');
    typeCell.appendChild(makeBadge(doc,
      claim.type === 'independent' ? 'rrb-badge-direct' : 'rrb-badge-low',
      claim.type === 'independent' ? '独立' : '従属'));
    tr.appendChild(typeCell);

    // 引用元側は範囲圧縮、下位側は個々の番号をそのまま「、」区切りで表示する（joinPlain）
    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(claim.directParents) || '—'));
    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(claim.allAncestors) || '—'));
    tr.appendChild(cellText(doc, joinPlain(claim.directChildren) || '—'));
    tr.appendChild(cellText(doc, joinPlain(claim.allDescendants) || '—'));
    tr.appendChild(cellText(doc,
      claim.dependencyType ? (DEPENDENCY_TYPE_LABEL[claim.dependencyType] || claim.dependencyType) : '—'));

    const warnCell = doc.createElement('td');
    const warnings = claim.warnings || [];
    if (warnings.length > 0) {
      const hasError = warnings.some((w) => w.severity === 'error');
      warnCell.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', '警告 ' + warnings.length));
    } else {
      warnCell.textContent = '—';
    }
    tr.appendChild(warnCell);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 8;
    detailTd.appendChild(preText(doc, claim.text || ''));
    detailTr.appendChild(detailTd);

    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      numBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function buildClaimStructureTable(doc, structure, claimsMod) {
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['請求項', '種別', '直接引用元', '全引用元', '直接下位', '全下位', '引用種別', '警告'].forEach((label) => {
      const th = doc.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const claim of structure.claims || []) appendClaimRows(doc, tbody, claim, claimsMod);
    table.appendChild(tbody);
    return table;
  }

  function renderClaimStructureTab(doc, container, result, claimsMod) {
    container.textContent = '';
    const structure = result.claimStructure;
    if (!structure) {
      container.appendChild(buildEmptyNotice(doc, '該当なし（請求項が未取得です）'));
      return;
    }
    const structIssues = (structure.warnings || []).concat(structure.crossChecks || []);
    const info = doc.createElement('p');
    info.className = 'rrb-sub-text';
    info.textContent = '総数: ' + structure.totalClaimCount +
      ' ／ 独立請求項: ' + (joinPlain(structure.independentClaims) || 'なし') +
      ' ／ 取得元: ' + (structure.sourceLabel || structure.source || '不明') +
      ' ／ 構造警告: ' + structIssues.length + '件';
    container.appendChild(info);

    if (structIssues.length > 0) {
      const ul = doc.createElement('ul');
      ul.className = 'rrb-overview-list';
      for (const w of structIssues) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn', w.severity === 'error' ? 'エラー' : '警告'));
        li.appendChild(doc.createTextNode(' ' + w.message));
        ul.appendChild(li);
      }
      container.appendChild(ul);
    }

    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    wrap.appendChild(buildClaimStructureTable(doc, structure, claimsMod));
    container.appendChild(wrap);
  }

  // ---- 整合性チェック タブ ----

  function buildConsistencyDetailContent(doc, result, check, claimsMod) {
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-detail-content';

    // consistencyChecks 自体は直接指摘／同様指摘／引用による指摘の請求項配列を持たないため、
    // 元の ITEM を逆引きして §8 の9行比較表を組み立てる
    const item = findSourceItem(result, check.reasonNumber, check.itemNumber);
    const directClaims = item ? item.directClaims : [];
    const sameIssueClaims = item ? item.sameIssueClaims : [];
    const citedInfluence = item ? unionClaims(...(item.dependencyRelations || []).map((d) => d.affectedClaims)) : [];

    const rows = [
      ['見出し請求項', check.headingClaims],
      ['修正後見出し請求項', check.effectiveHeadingClaims],
      ['直接指摘請求項', directClaims],
      ['同様指摘請求項', sameIssueClaims],
      ['引用による指摘請求項', citedInfluence],
      ['本文上の指摘集合', check.bodyAffectedClaims],
      ['結論請求項', check.finalClaims],
      ['クレーム構造上の承継候補', check.inheritedCandidates],
      ['指摘漏れ候補', check.omittedClaims],
    ];
    const ul = doc.createElement('ul');
    for (const [label, arr] of rows) {
      const li = doc.createElement('li');
      const strong = doc.createElement('strong');
      strong.textContent = label;
      li.appendChild(strong);
      li.appendChild(doc.createTextNode(': ' + (claimsMod.compressClaimNumbers(arr) || 'なし')));
      ul.appendChild(li);
    }
    wrap.appendChild(detailBlock(doc, '請求項の比較（§8）', ul));

    const issues = check.issues || [];
    if (issues.length > 0) {
      const issueUl = doc.createElement('ul');
      for (const i of issues) {
        const li = doc.createElement('li');
        li.appendChild(makeBadge(doc, severityBadgeClass(i.severity), severityLabel(i.severity)));
        li.appendChild(doc.createTextNode(' ' + i.text));
        issueUl.appendChild(li);
      }
      wrap.appendChild(detailBlock(doc, '検出された不整合', issueUl));
    }
    return wrap;
  }

  function appendConsistencyRows(doc, tbody, result, check, index, claimsMod) {
    const tr = doc.createElement('tr');
    tr.className = 'rrb-item-row';

    tr.appendChild(cellText(doc, String(index + 1)));

    const reasonCell = doc.createElement('td');
    reasonCell.textContent = '理由' + check.reasonNumber + ' 項目' + check.itemNumber + '（' + (check.categoryLabel || '') + '）';
    tr.appendChild(reasonCell);

    const headingRaw = claimsMod.compressClaimNumbers(check.headingClaims);
    const headingFixed = claimsMod.compressClaimNumbers(check.effectiveHeadingClaims);
    const headingCell = doc.createElement('td');
    const headingMain = doc.createElement('div');
    headingMain.textContent = headingFixed;
    headingCell.appendChild(headingMain);
    if (headingRaw !== headingFixed) {
      const sub = doc.createElement('div');
      sub.className = 'rrb-sub-text';
      sub.textContent = '原文: ' + headingRaw;
      headingCell.appendChild(sub);
    }
    tr.appendChild(headingCell);

    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(check.bodyAffectedClaims) || '—'));
    tr.appendChild(cellText(doc, claimsMod.compressClaimNumbers(check.finalClaims) || '—'));

    const statusCell = doc.createElement('td');
    statusCell.appendChild(makeBadge(doc, statusBadgeClass(check.status), STATUS_LABEL[check.status] || check.status));
    tr.appendChild(statusCell);

    tr.appendChild(cellText(doc, buildDiffSummary(claimsMod, check) || '—'));

    const errorCell = doc.createElement('td');
    const issues = check.issues || [];
    if (issues.length > 0) {
      const hasError = issues.some((i) => i.severity === 'error');
      errorCell.appendChild(makeBadge(doc, hasError ? 'rrb-badge-error' : 'rrb-badge-warn', issues.length + '件'));
    } else {
      errorCell.textContent = '—';
    }
    tr.appendChild(errorCell);

    const toggleCell = doc.createElement('td');
    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'rrb-detail-toggle';
    toggleBtn.textContent = '詳細';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleCell.appendChild(toggleBtn);
    tr.appendChild(toggleCell);

    const detailTr = doc.createElement('tr');
    detailTr.className = 'rrb-detail-row';
    detailTr.hidden = true;
    const detailTd = doc.createElement('td');
    detailTd.colSpan = 9;
    detailTd.appendChild(buildConsistencyDetailContent(doc, result, check, claimsMod));
    detailTr.appendChild(detailTd);

    tr.addEventListener('click', () => {
      const willShow = detailTr.hidden;
      detailTr.hidden = !willShow;
      toggleBtn.setAttribute('aria-expanded', String(willShow));
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
  }

  function renderConsistencyTab(doc, container, result, claimsMod) {
    container.textContent = '';
    const checks = result.consistencyChecks || [];
    if (checks.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '該当なし'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['No.', '理由', '見出し', '本文上の対象', '結論', '一致判定', '差分', 'エラー', '詳細'].forEach((label) => {
      const th = doc.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    checks.forEach((check, index) => appendConsistencyRows(doc, tbody, result, check, index, claimsMod));
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // ---- 指摘漏れ候補 タブ ----

  function buildOmittedRow(doc, candidate) {
    const tr = doc.createElement('tr');

    const reasonCell = doc.createElement('td');
    reasonCell.textContent = '理由' + candidate.reasonNumber + ' 項目' + candidate.itemNumber +
      '（' + (candidate.categoryLabel || '') + '）';
    tr.appendChild(reasonCell);

    tr.appendChild(cellText(doc, String(candidate.sourceClaim)));

    const omittedCell = doc.createElement('td');
    omittedCell.appendChild(doc.createTextNode(String(candidate.omittedClaim) + ' '));
    if (candidate.coveredElsewhereInReason) {
      omittedCell.appendChild(makeBadge(doc, 'rrb-badge-direct', '他項目で指摘済'));
    }
    tr.appendChild(omittedCell);

    tr.appendChild(cellText(doc, candidate.dependencyPathText || ''));

    const sevCell = doc.createElement('td');
    sevCell.appendChild(makeBadge(doc, severityBadgeClass(candidate.severity), severityLabel(candidate.severity)));
    tr.appendChild(sevCell);

    tr.appendChild(cellText(doc, candidate.basis || ''));
    return tr;
  }

  function renderOmittedTab(doc, container, result) {
    container.textContent = '';
    const list = result.omittedClaimCandidates || [];
    if (list.length === 0) {
      container.appendChild(buildEmptyNotice(doc, '指摘漏れ候補は検出されませんでした。'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'rrb-table-wrap';
    const table = doc.createElement('table');
    table.className = 'rrb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['理由項目', '問題請求項', '漏れている可能性のある請求項', '引用経路', '判定', '根拠'].forEach((label) => {
      const th = doc.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const candidate of list) tbody.appendChild(buildOmittedRow(doc, candidate));
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // =====================================================================
  // 起動・イベント配線
  // =====================================================================

  let activeApp = null; // 開いているモーダルの再表示・後片付け窓口（再実行時の重複生成を防ぐ）

  function launch(config) {
    const cfg = config || {};
    const doc = document;
    const win = window;

    // 既に開いているモーダルがあれば再利用する（再実行で重複生成しない）。
    // ただしページ側の描き換え等でホストが文書から外れている場合は、
    // 再利用すると「押しても何も出ない」状態になるため、作り直す。
    if (activeApp) {
      if (activeApp.isAttached()) {
        activeApp.show(cfg);
        return;
      }
      activeApp.dispose();
    }
    const stale = doc.getElementById('rrb-host');
    if (stale) stale.remove(); // 前回の後片付けが不完全だった場合の保険

    const deps = resolveDeps();
    if (!deps.ok) {
      win.alert(
        '拒絶理由分析: 起動に必要なモジュールが読み込まれていません（連結順を確認してください）。\n' +
        '不足: ' + deps.missing.join(', ')
      );
      return;
    }

    const host = doc.createElement('div');
    host.id = 'rrb-host';
    doc.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = doc.createElement('style');
    styleEl.textContent = STYLE_TEXT;
    shadow.appendChild(styleEl);

    const rootEl = doc.createElement('div');
    rootEl.className = 'rrb-modal';
    rootEl.innerHTML = PANEL_HTML; // 静的テンプレートのみ（ユーザ由来データを含まない）
    shadow.appendChild(rootEl);

    const q = (id) => shadow.getElementById(id);
    const dom = {
      title: q('rrb-title'),
      screenInput: q('rrb-screen-input'),
      screenResult: q('rrb-screen-result'),
      closeInputBtn: q('rrb-close-input-btn'),
      closeInputBtn2: q('rrb-close-input-btn2'),
      inputWarning: q('rrb-input-warning'),
      claimSourceMessage: q('rrb-claim-source-message'),
      collectClaimsBtn: q('rrb-collect-claims-btn'),
      pasteClaimsDetails: q('rrb-paste-claims-details'),
      pasteClaimsText: q('rrb-paste-claims-text'),
      pasteClaimsBtn: q('rrb-paste-claims-btn'),
      claimStructurePreview: q('rrb-claim-structure-preview'),
      claimStructureSummary: q('rrb-claim-structure-summary'),
      claimStructureDetails: q('rrb-claim-structure-details'),
      claimStructureDetailsSummary: q('rrb-claim-structure-details-summary'),
      claimStructureWarnings: q('rrb-claim-structure-warnings'),
      claimStructureTableWrap: q('rrb-claim-structure-table-wrap'),
      claimStructureInfo: q('rrb-claim-structure-info'),
      inputText: q('rrb-input-text'),
      fileInput: q('rrb-file-input'),
      loadFileBtn: q('rrb-load-file-btn'),
      loadSampleBtn: q('rrb-load-sample-btn'),
      clearBtn: q('rrb-clear-btn'),
      analyzeBtn: q('rrb-analyze-btn'),
      backBtn: q('rrb-back-btn'),
      reanalyzeBtn: q('rrb-reanalyze-btn'),
      closeResultBtn: q('rrb-close-result-btn'),
      summaryCards: q('rrb-summary-cards'),
      totalClaimsInput: q('rrb-total-claims-input'),
      totalClaimsNote: q('rrb-total-claims-note'),
      tabs: q('rrb-tabs'),
      tabpanel: q('rrb-tabpanel'),
      copyTableBtn: q('rrb-copy-table-btn'),
      copyJsonBtn: q('rrb-copy-json-btn'),
      saveJsonBtn: q('rrb-save-json-btn'),
      saveCsvBtn: q('rrb-save-csv-btn'),
      openReportBtn: q('rrb-open-report-btn'),
      toggleSourceBtn: q('rrb-toggle-source-btn'),
      footerFeedback: q('rrb-footer-feedback'),
      sourceDetails: q('rrb-source-details'),
      sourcePre: q('rrb-source-pre'),
      copyHelper: q('rrb-copy-helper'),
    };

    const state = { result: null, sourceText: '', activeTab: 'overview', claimStructure: null };

    // ---- タイトル ----
    function applyLabel(c) {
      dom.title.textContent = (c && c.label) || '拒絶理由分析';
    }
    applyLabel(cfg);

    // ---- 入力画面の警告 ----
    function showInputWarning(message) {
      dom.inputWarning.textContent = message;
      dom.inputWarning.hidden = false;
    }
    function hideInputWarning() {
      dom.inputWarning.hidden = true;
      dom.inputWarning.textContent = '';
    }

    // ---- 請求項の取得元（任意。alert は使わずインライン表示のみ） ----
    function showClaimSourceMessage(kind, message) {
      dom.claimSourceMessage.className = 'rrb-msg rrb-' + kind;
      dom.claimSourceMessage.textContent = message;
      dom.claimSourceMessage.hidden = false;
    }

    // 入力画面に常時見えるサマリ行 + <details>（既定は閉じる）で請求項構造そのものを表示する。
    // 結果画面「請求項構造」タブと同じ描画関数（buildClaimStructureTable）を再利用する
    function renderClaimStructurePreview() {
      const structure = state.claimStructure;
      if (!structure) {
        dom.claimStructurePreview.hidden = true;
        return;
      }
      const structIssues = (structure.warnings || []).concat(structure.crossChecks || []);
      dom.claimStructureSummary.textContent =
        '総数: ' + structure.totalClaimCount +
        ' ／ 独立請求項: ' + (joinPlain(structure.independentClaims) || 'なし') +
        ' ／ 取得元: ' + (structure.sourceLabel || structure.source || '不明') +
        ' ／ 構造警告: ' + structIssues.length + '件';
      dom.claimStructureDetailsSummary.textContent =
        '請求項構造を表示（' + structure.totalClaimCount + '項）';
      // テキスト入力欄が下に押し出されないよう、取得（再取得）のたびに既定の閉状態へ戻す
      dom.claimStructureDetails.open = false;

      dom.claimStructureWarnings.textContent = '';
      if (structIssues.length > 0) {
        const ul = doc.createElement('ul');
        ul.className = 'rrb-overview-list';
        for (const w of structIssues) {
          const li = doc.createElement('li');
          li.appendChild(makeBadge(doc, w.severity === 'error' ? 'rrb-badge-error' : 'rrb-badge-warn',
            w.severity === 'error' ? 'エラー' : '警告'));
          li.appendChild(doc.createTextNode(' ' + w.message));
          ul.appendChild(li);
        }
        dom.claimStructureWarnings.appendChild(ul);
      }

      dom.claimStructureTableWrap.textContent = '';
      dom.claimStructureTableWrap.appendChild(buildClaimStructureTable(doc, structure, deps.claims));

      dom.claimStructurePreview.hidden = false;
    }

    function applyClaimStructure(structure, auto) {
      state.claimStructure = structure;
      showClaimSourceMessage('success',
        (auto ? '自動取得: ' : '') +
        '請求項' + structure.totalClaimCount + '件を取得しました（独立請求項: ' +
        (joinPlain(structure.independentClaims) || 'なし') + '／取得元: ' +
        (structure.sourceLabel || structure.source || '不明') + '）。');
      renderClaimStructurePreview();
    }
    function handleCollectClaims() {
      const res = deps.pageClaims.collect(doc);
      if (!res.ok) {
        showClaimSourceMessage('warn', res.error);
        return;
      }
      applyClaimStructure(res.structure);
    }
    // 起動直後の自動取得。ボタン操作を経ないため、失敗してもエラー扱いにせず
    // 情報メッセージに留め、入力画面の表示を絶対に妨げない（例外は握りつぶす）
    function autoCollectClaimsOnLaunch() {
      if (state.claimStructure) return; // 既に取得済みなら上書きしない
      try {
        const res = deps.pageClaims.collect(doc);
        if (res && res.ok) {
          applyClaimStructure(res.structure, true);
        } else {
          showClaimSourceMessage('info',
            '自動取得: ' + ((res && res.error) || '請求項を自動取得できませんでした。'));
        }
      } catch (e) {
        showClaimSourceMessage('info',
          '自動取得: 請求項の取得中にエラーが発生しました。手動で取得するか、下欄に貼り付けてください。');
      }
    }
    function handlePasteClaims() {
      const text = dom.pasteClaimsText.value;
      if (text.trim() === '') {
        showClaimSourceMessage('warn', '請求項全文を貼り付けてください。');
        return;
      }
      const res = deps.pageClaims.fromText(text);
      if (!res.ok) {
        showClaimSourceMessage('warn', res.error);
        return;
      }
      applyClaimStructure(res.structure);
    }

    // ---- タブ ----
    function renderTabs() {
      dom.tabs.textContent = '';
      for (const def of TAB_DEFS) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'rrb-tab-btn';
        btn.textContent = def.label;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(state.activeTab === def.id));
        btn.addEventListener('click', () => {
          if (state.activeTab === def.id) return;
          state.activeTab = def.id;
          renderTabs();
          renderActiveTabPanel();
        });
        dom.tabs.appendChild(btn);
      }
    }

    function renderActiveTabPanel() {
      dom.tabpanel.textContent = '';
      const result = state.result;
      if (!result) return;
      switch (state.activeTab) {
        case 'overview': renderOverviewTab(doc, dom.tabpanel, result); break;
        case 'clarity': renderItemCategoryTab(doc, dom.tabpanel, result, 'clarity', deps.claims); break;
        case 'support': renderItemCategoryTab(doc, dom.tabpanel, result, 'support', deps.claims); break;
        case 'article29': renderArticle29Tab(doc, dom.tabpanel, result, deps.claims); break;
        case 'other': renderItemCategoryTab(doc, dom.tabpanel, result, 'other', deps.claims); break;
        case 'unparsed': renderUnparsedWarningsTab(doc, dom.tabpanel, result); break;
        case 'claimStructure': renderClaimStructureTab(doc, dom.tabpanel, result, deps.claims); break;
        case 'consistency': renderConsistencyTab(doc, dom.tabpanel, result, deps.claims); break;
        case 'omitted': renderOmittedTab(doc, dom.tabpanel, result); break;
        default: break;
      }
    }

    // ---- 画面切替 ----
    function showResultScreen() {
      const claimStats = state.result.metadata.claimStats || {};
      dom.totalClaimsInput.value = claimStats.totalClaimCount != null ? String(claimStats.totalClaimCount) : '';
      dom.totalClaimsNote.textContent = TOTAL_CLAIM_SOURCE_LABEL[claimStats.totalClaimCountSource] || '本文からの推定';
      if (state.result.claimStructure) {
        dom.claimStructureInfo.hidden = true;
        dom.claimStructureInfo.textContent = '';
      } else {
        dom.claimStructureInfo.textContent =
          '請求項構造が未取得のため、指摘漏れ候補と請求項の実在確認は実行されていません。';
        dom.claimStructureInfo.hidden = false;
      }
      renderSummaryCards(doc, dom.summaryCards, state.result, deps.claims);
      renderTabs();
      renderActiveTabPanel();
      dom.sourcePre.textContent = state.sourceText || '';
      dom.sourceDetails.open = false;
      dom.toggleSourceBtn.textContent = '原文全文を表示';
      dom.screenInput.hidden = true;
      dom.screenResult.hidden = false;
    }

    function showInputScreen() {
      dom.screenResult.hidden = true;
      dom.screenInput.hidden = false;
      dom.inputText.focus();
    }

    // ---- 解析 ----
    function runAnalyze() {
      const text = dom.inputText.value;
      if (text.trim() === '') {
        showInputWarning('本文を入力してください。');
        return;
      }
      hideInputWarning();
      let result;
      try {
        result = deps.analyzer.analyze(text, state.claimStructure ? { claimStructure: state.claimStructure } : undefined);
      } catch (e) {
        showInputWarning('解析中にエラーが発生しました: ' + ((e && e.message) || e));
        return;
      }
      result.metadata = result.metadata || {};
      result.metadata.analyzedAt = new Date().toISOString(); // UI側で確定（analyze()自体は空のまま返す決定論仕様）
      state.result = result;
      state.sourceText = text;
      state.activeTab = 'overview';
      showResultScreen();
    }

    // ---- 全請求項数の手動変更 ----
    function handleTotalClaimsChange() {
      const raw = parseInt(dom.totalClaimsInput.value, 10);
      const current = state.result.metadata.claimStats || {};
      if (!Number.isFinite(raw) || raw < 1) {
        dom.totalClaimsInput.value = current.totalClaimCount != null ? String(current.totalClaimCount) : '1';
        return;
      }
      const claimStats = deps.validator.computeClaimStats(state.result, raw);
      // computeClaimStats は純関数で totalClaimCountSource を持たないため、UI 側で明示する
      claimStats.totalClaimCountSource = 'manual';
      state.result.metadata.claimStats = claimStats;
      dom.totalClaimsNote.textContent = TOTAL_CLAIM_SOURCE_LABEL.manual;
      renderSummaryCards(doc, dom.summaryCards, state.result, deps.claims);
    }

    // ---- ファイル読み込み ----
    function handleFileChange() {
      const file = dom.fileInput.files && dom.fileInput.files[0];
      dom.fileInput.value = ''; // 同じファイルを連続で選び直せるようにする
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        dom.inputText.value = String(reader.result == null ? '' : reader.result);
        hideInputWarning();
      };
      reader.onerror = () => {
        showInputWarning('ファイルの読み込みに失敗しました。');
      };
      reader.readAsText(file, 'utf-8');
    }

    // ---- コピー・保存 ----
    let feedbackTimer = null;
    function flashFeedback(message, ok) {
      dom.footerFeedback.textContent = message;
      dom.footerFeedback.classList.toggle('rrb-feedback-ok', ok);
      dom.footerFeedback.classList.toggle('rrb-feedback-ng', !ok);
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        dom.footerFeedback.textContent = '';
        dom.footerFeedback.classList.remove('rrb-feedback-ok', 'rrb-feedback-ng');
      }, 2500);
    }

    function copyText(text) {
      if (!text) return;
      const fallback = () => {
        let ok = false;
        try {
          dom.copyHelper.value = text;
          dom.copyHelper.focus();
          dom.copyHelper.select();
          ok = doc.execCommand('copy');
        } catch (e) {
          ok = false;
        }
        if (win.getSelection) win.getSelection().removeAllRanges();
        flashFeedback(ok ? 'コピーしました ✓' : 'コピーできませんでした。手動でコピーしてください。', ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flashFeedback('コピーしました ✓', true), fallback);
      } else {
        fallback();
      }
    }

    function saveBlob(content, mime, filename) {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function handleCopyTable() {
      copyText(deps.reportTemplate.buildTsv(state.result));
    }
    function handleCopyJson() {
      copyText(JSON.stringify(state.result, null, 2));
    }
    function handleSaveJson() {
      saveBlob(JSON.stringify(state.result, null, 2), 'application/json', 'rejection-analysis.json');
    }
    function handleSaveCsv() {
      // Excel等での文字化けを避けるため UTF-8 BOM（U+FEFF）を付与する（BOM付与はUI側の責務。
      // report-template.buildCsv() 自体は BOM を付けない純関数のまま保つ）
      const BOM = String.fromCharCode(0xfeff);
      saveBlob(BOM + deps.reportTemplate.buildCsv(state.result), 'text/csv;charset=utf-8', 'rejection-analysis.csv');
    }
    function handleOpenReport() {
      const html = deps.reportTemplate.build(state.result);
      let w = null;
      try {
        w = win.open('', '_blank');
      } catch (e) {
        w = null;
      }
      if (w) {
        try {
          w.document.open();
          w.document.write(html);
          w.document.close();
          return;
        } catch (e) {
          // フォールバックへ
        }
      }
      saveBlob(html, 'text/html;charset=utf-8', 'rejection-analysis-report.html');
      flashFeedback('ポップアップがブロックされたため、HTMLファイルとして保存しました', true);
    }
    function handleToggleSource() {
      dom.sourceDetails.open = !dom.sourceDetails.open;
      dom.toggleSourceBtn.textContent = dom.sourceDetails.open ? '原文全文を隠す' : '原文全文を表示';
    }

    // ---- 終了処理 ----
    function onKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return; // IME 変換中の Escape は奪わない
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    }

    function close() {
      dispose();
      host.remove();
    }

    // ページに残した痕跡（イベントリスナ・タイマー）だけを片付ける。
    // ホスト要素が既に文書から外れている場合の作り直しでも使う。
    function dispose() {
      win.removeEventListener('keydown', onKeydown, true);
      clearTimeout(feedbackTimer);
      activeApp = null;
    }

    // ホストがまだ文書に繋がっているか（外れていたら再表示しても見えない）
    function isAttached() {
      return !!(host.isConnected && doc.contains(host));
    }

    function show(c) {
      applyLabel(c);
      (dom.screenResult.hidden ? dom.inputText : dom.totalClaimsInput).focus();
    }

    // ---- 配線 ----
    dom.closeInputBtn.addEventListener('click', close);
    dom.closeInputBtn2.addEventListener('click', close);
    dom.closeResultBtn.addEventListener('click', close);
    win.addEventListener('keydown', onKeydown, true);

    dom.collectClaimsBtn.addEventListener('click', handleCollectClaims);
    dom.pasteClaimsBtn.addEventListener('click', handlePasteClaims);

    dom.loadFileBtn.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', handleFileChange);
    dom.loadSampleBtn.addEventListener('click', () => {
      dom.inputText.value = deps.sampleData.text;
      hideInputWarning();
      dom.inputText.focus();
    });
    dom.clearBtn.addEventListener('click', () => {
      dom.inputText.value = '';
      hideInputWarning();
      dom.inputText.focus();
    });
    dom.analyzeBtn.addEventListener('click', runAnalyze);

    dom.backBtn.addEventListener('click', showInputScreen);
    dom.reanalyzeBtn.addEventListener('click', runAnalyze);

    dom.totalClaimsInput.addEventListener('change', handleTotalClaimsChange);

    dom.copyTableBtn.addEventListener('click', handleCopyTable);
    dom.copyJsonBtn.addEventListener('click', handleCopyJson);
    dom.saveJsonBtn.addEventListener('click', handleSaveJson);
    dom.saveCsvBtn.addEventListener('click', handleSaveCsv);
    dom.openReportBtn.addEventListener('click', handleOpenReport);
    dom.toggleSourceBtn.addEventListener('click', handleToggleSource);

    activeApp = { show, close, dispose, isAttached };

    // 起動直後に請求項構造を自動取得する（ボタンは手動の再取得手段として残す）。
    // 例外や取得失敗があっても入力画面の表示自体は必ず継続する
    autoCollectClaimsOnLaunch();

    dom.inputText.focus();
  }

  return { launch };
});
