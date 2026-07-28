/*
 * collector-app.js — ブックマークレット版のモーダルUI（new/legacy 共通ソース）
 *
 * 「書類比較・クレームチェッカー」のページから罫線ツリー（#claim_tree .div_tree）を
 * 収集し、モーダル上で Step 2〜4（指摘事項・請求項指定・生成・コピー）を完結させる。
 *
 * 設計原則:
 *   - 実行時のコード評価（eval 系）・ドキュメントへの write 系API・script 要素の挿入を一切使わない
 *     （対象ページは CSP script-src 'self' のため、ユーザー操作起点の自己完結
 *       ブックマークレットのみが現実的な実行経路。DOM API とクロージャ内関数だけで動く）
 *   - ページを汚さない: 追加するグローバルは window.CRW、DOM は #crw-modal と
 *     #crw-modal-style のみ。localStorage は使わない（状態はモーダル内で完結）
 *   - 上流入力（木構造・指摘種別・請求項指定）の変更で生成文とコピーを必ず無効化
 *     （ローカル版と同じ安全規則）。ページ側で「クレーム解析」が再実行された場合は
 *     MutationObserver で検知して警告し、陳腐化したツリーからの生成を止める
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../../core/parser'),
      require('../../core/formatter'),
      require('../../core/session')
    );
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'formatter', 'resolver', 'generator', 'session']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。連結順を確認してください。');
      }
    }
    root.CRW.collectorApp = factory(root.CRW.parser, root.CRW.formatter, root.CRW.session);
  }
})(globalThis, function (parser, formatter, session) {
  'use strict';

  // 抽出セレクタの優先順。#claim_tree は常駐のデータ保持用（hidden）、
  // #claim_dialog は「木構造」ダイアログ表示中のみ .div_tree を含む
  const TREE_SELECTORS = ['#claim_tree .div_tree', '#claim_dialog .div_tree', '.div_tree'];

  // div_tree の innerHTML をプレーンテキストへ（純関数・Nodeでテスト可能）。
  // 実ページの中身は「テキスト + <br> 行終端」のみだが、将来の変化に備えて
  // 残タグ除去と基本エンティティ復元も行う。&amp; の復元は必ず最後。
  function treeHtmlToText(html) {
    let t = String(html == null ? '' : html);
    t = t.replace(/<br\s*\/?>/gi, '\n');
    t = t.replace(/<[^>]*>/g, '');
    t = t.replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
    return t;
  }

  // ページから木構造テキストを収集する
  function extractTreeText(doc) {
    const d = doc || document;
    for (const selector of TREE_SELECTORS) {
      const nodes = d.querySelectorAll(selector);
      for (const el of nodes) {
        const text = treeHtmlToText(el.innerHTML);
        if (text.trim() !== '') return { ok: true, text, selector };
      }
    }
    return {
      ok: false,
      error: 'クレーム構造が見つかりませんでした。ページ側で「クレーム解析」を実行してから' +
        '「ページから再取得」を押すか、下の欄に木構造を手動で貼り付けてください。',
    };
  }

  // ---------- ここから DOM（launch 時のみ使用） ----------

  const STYLE_TEXT = [
    '#crw-modal{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:"Segoe UI","Yu Gothic UI",Meiryo,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2430;text-align:left;letter-spacing:normal;word-spacing:normal;text-transform:none;}',
    '#crw-modal [hidden]{display:none!important;}',
    '#crw-modal *,#crw-modal *::before,#crw-modal *::after{box-sizing:border-box;font-family:inherit;}',
    '#crw-modal .crw-backdrop{position:absolute;inset:0;background:rgba(15,20,30,.22);}',
    '#crw-modal .crw-panel{position:absolute;top:4vh;right:3vw;width:min(560px,94vw);max-height:92vh;overflow-y:auto;pointer-events:auto;background:#fff;border:1px solid #c7cdd6;border-radius:10px;box-shadow:0 10px 36px rgba(0,0,0,.28);padding:14px 16px 16px;margin:0;}',
    '#crw-modal .crw-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;}',
    '#crw-modal h2{margin:0;font-size:15px;font-weight:700;color:#1f2430;line-height:1.4;}',
    '#crw-modal button{appearance:auto;font:inherit;font-size:13px;line-height:1.4;margin:0;padding:6px 14px;border:1px solid #c7cdd6;border-radius:6px;background:#eef1f5;color:#1f2430;cursor:pointer;text-transform:none;box-shadow:none;touch-action:manipulation;}',
    '#crw-modal button:hover{background:#e1e6ec;}',
    '#crw-modal button:disabled{opacity:.5;cursor:not-allowed;}',
    '#crw-modal button.crw-primary{background:#1d4e89;border-color:#1d4e89;color:#fff;}',
    '#crw-modal button.crw-primary:hover:not(:disabled){background:#163f6f;}',
    '#crw-modal button.crw-x{padding:0 8px;font-size:18px;line-height:1;background:none;border:none;color:#626b78;}',
    '#crw-modal button.crw-x:hover{background:none;color:#1f2430;}',
    '#crw-modal textarea{display:block;width:100%;margin:6px 0;padding:8px;border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;font:12.5px/1.55 "MS Gothic","ＭＳ ゴシック",Consolas,monospace;white-space:pre;overflow:auto;resize:vertical;}',
    '#crw-modal textarea#crw-result{font:13.5px/1.8 "Segoe UI","Yu Gothic UI",Meiryo,system-ui,sans-serif;white-space:pre-wrap;}',
    '#crw-modal input[type="text"]{display:block;width:100%;margin:2px 0 8px;padding:6px 8px;border:1px solid #c7cdd6;border-radius:6px;background:#fff;color:#1f2430;font:inherit;line-height:1.5;}',
    '#crw-modal label{display:block;margin:0;font-size:12.5px;color:#454d59;font-weight:600;}',
    '#crw-modal .crw-radio{display:inline-flex;align-items:center;gap:4px;margin:0 14px 0 0;font-weight:400;font-size:13px;color:#1f2430;}',
    '#crw-modal input[type="radio"]{margin:0;width:auto;accent-color:#1d4e89;}',
    '#crw-modal fieldset{margin:0 0 8px;padding:6px 10px 8px;border:1px solid #dfe3e9;border-radius:6px;min-width:0;}',
    '#crw-modal legend{padding:0 4px;font-size:12px;color:#626b78;float:none;width:auto;margin:0;}',
    '#crw-modal details{margin:0 0 8px;border:1px solid #dfe3e9;border-radius:6px;padding:6px 10px;display:block;}',
    '#crw-modal summary{cursor:pointer;font-size:12.5px;color:#454d59;display:list-item;}',
    '#crw-modal .crw-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0;}',
    '#crw-modal .crw-msg{margin:6px 0;padding:6px 10px;border-radius:6px;font-size:12.5px;white-space:pre-wrap;border:1px solid transparent;}',
    '#crw-modal .crw-success{background:#e7f5ea;color:#226a3b;border-color:#bfe2c8;}',
    '#crw-modal .crw-error{background:#fbeae9;color:#a4302a;border-color:#f1c4c0;}',
    '#crw-modal .crw-warn{background:#fff6e5;color:#8a5a00;border-color:#f0dca8;}',
    '#crw-modal .crw-feedback{font-size:12.5px;}',
    '#crw-modal .crw-feedback.ok{color:#226a3b;}',
    '#crw-modal .crw-feedback.ng{color:#a4302a;}',
    '#crw-modal dl.crw-breakdown{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:8px 0 0;font-size:12.5px;}',
    '#crw-modal dt{color:#626b78;margin:0;font-weight:600;}',
    '#crw-modal dd{margin:0;color:#1f2430;}',
    '#crw-modal .crw-note{margin:10px 0 0;font-size:11.5px;color:#8a93a0;}',
  ].join('\n');

  // 静的なテンプレート（ユーザー由来のデータは含めない。動的な値はすべて
  // textContent / value で後から注入する）
  const PANEL_HTML = [
    '<div class="crw-backdrop"></div>',
    '<div class="crw-panel" role="dialog" aria-labelledby="crw-title">',
    '  <div class="crw-head">',
    '    <h2 id="crw-title"></h2>',
    '    <button type="button" id="crw-close" class="crw-x" aria-label="閉じる">×</button>',
    '  </div>',
    '  <div id="crw-status" class="crw-msg" hidden></div>',
    '  <details id="crw-tree-details">',
    '    <summary>収集した木構造（編集できます）</summary>',
    '    <textarea id="crw-tree" rows="8" spellcheck="false"></textarea>',
    '    <div class="crw-row">',
    '      <button type="button" id="crw-refetch">ページから再取得</button>',
    '    </div>',
    '  </details>',
    '  <div id="crw-tree-warn" class="crw-msg crw-warn" hidden></div>',
    '  <fieldset>',
    '    <legend>指摘する事項</legend>',
    '    <label class="crw-radio"><input type="radio" name="crw-issue-type" value="clarity" checked>明確性</label>',
    '    <label class="crw-radio"><input type="radio" name="crw-issue-type" value="support">サポート要件</label>',
    '  </fieldset>',
    '  <label for="crw-issue-claims">指摘する請求項（必須）</label>',
    '  <input type="text" id="crw-issue-claims" autocomplete="off" placeholder="例: 2、4">',
    '  <label for="crw-related-claims">関連する請求項（同様の点が指摘される請求項・空欄可）</label>',
    '  <input type="text" id="crw-related-claims" autocomplete="off" placeholder="例: 9、13、25">',
    '  <div class="crw-row">',
    '    <button type="button" id="crw-generate" class="crw-primary">生成する</button>',
    '    <button type="button" id="crw-copy" disabled>コピー</button>',
    '    <span id="crw-copy-feedback" class="crw-feedback" role="status" aria-live="polite"></span>',
    '  </div>',
    '  <div id="crw-errors" class="crw-msg crw-error" hidden></div>',
    '  <textarea id="crw-result" rows="5" readonly placeholder="ここに生成された文章が表示されます"></textarea>',
    '  <dl id="crw-breakdown" class="crw-breakdown" hidden></dl>',
    '  <p class="crw-note">処理はこのブラウザ内で完結します（クレーム構造・生成文章の外部送信はありません）。</p>',
    '</div>',
  ].join('\n');

  let cleanup = null; // 開いているモーダルの後片付け（再実行時に先に呼ぶ）

  function launch(config) {
    const cfg = config || {};
    if (cleanup) cleanup();

    const doc = document;
    const style = doc.createElement('style');
    style.id = 'crw-modal-style';
    style.textContent = STYLE_TEXT;
    doc.head.appendChild(style);

    const rootEl = doc.createElement('div');
    rootEl.id = 'crw-modal';
    rootEl.innerHTML = PANEL_HTML;
    doc.body.appendChild(rootEl);

    const q = (id) => doc.getElementById(id);
    const els = {
      title: q('crw-title'),
      close: q('crw-close'),
      status: q('crw-status'),
      treeDetails: q('crw-tree-details'),
      tree: q('crw-tree'),
      refetch: q('crw-refetch'),
      treeWarn: q('crw-tree-warn'),
      issueClaims: q('crw-issue-claims'),
      relatedClaims: q('crw-related-claims'),
      generate: q('crw-generate'),
      copy: q('crw-copy'),
      copyFeedback: q('crw-copy-feedback'),
      errors: q('crw-errors'),
      result: q('crw-result'),
      breakdown: q('crw-breakdown'),
    };
    els.title.textContent = 'Claim Relation Writer — ' + (cfg.label || 'クレーム構造の収集');

    let state = session.createEmptyState();
    let lastCollectedText = '';

    // ---- 表示ヘルパ ----
    function setStatus(kind, message) {
      els.status.className = 'crw-msg crw-' + kind;
      els.status.textContent = message;
      els.status.hidden = false;
    }
    function hideErrors() {
      els.errors.hidden = true;
      els.errors.textContent = '';
    }
    function showErrors(messages) {
      els.errors.textContent = (Array.isArray(messages) ? messages : [messages]).join('\n');
      els.errors.hidden = false;
    }
    function clearResultUI() {
      els.result.value = '';
      els.copy.disabled = true;
      els.breakdown.hidden = true;
      els.breakdown.textContent = '';
      hideErrors();
    }

    // ---- 状態の安全規則: 上流変更で生成済み結果を必ず無効化 ----
    function applyUpstreamChange(field, value) {
      state = session.invalidateDownstream(
        Object.assign({}, state, { [field]: value }),
        field
      );
      clearResultUI();
    }

    // ---- 陳腐化ガード（ページ側でクレーム解析が再実行された場合） ----
    function markStale() {
      els.treeWarn.textContent =
        'ページのクレーム構造が変わりました。「ページから再取得」を押してください。';
      els.treeWarn.hidden = false;
      els.treeDetails.open = true;
      els.generate.disabled = true;
    }
    function clearStale() {
      els.treeWarn.hidden = true;
      els.treeWarn.textContent = '';
      els.generate.disabled = false;
    }

    // ---- 収集と解析 ----
    function tryParseForSummary() {
      const parsed = parser.parseClaimTree(state.treeText);
      if (parsed.ok) {
        state.graph = parsed.graph;
        const f = formatter.formatClaimNumbers;
        setStatus('success',
          '木構造を収集しました: 請求項 ' + parsed.graph.nodes.length + ' 項' +
          '（独立請求項: ' + f(parsed.graph.roots) + '）');
      } else {
        setStatus('error',
          '収集した木構造の解析に失敗しました。下の欄で修正してください。\n' +
          parsed.errors.map((e) => (e.line != null ? e.line + '行目: ' : '') + e.message).join('\n'));
        els.treeDetails.open = true;
      }
    }

    function collectFromPage() {
      // 収集のたびに現行の #claim_tree へ observer を張り直す（起動時に要素が
      // 無かった場合や、ページ側で要素ごと差し替えられた場合の検知漏れを防ぐ）
      bindObserver();
      const res = extractTreeText(doc);
      if (res.ok) {
        els.tree.value = res.text;
        lastCollectedText = res.text;
        applyUpstreamChange('treeText', res.text);
        tryParseForSummary();
        clearStale();
      } else {
        setStatus('error', res.error);
        els.treeDetails.open = true;
        clearStale();
      }
    }

    function handleRefetch() {
      const current = els.tree.value;
      if (current.trim() !== '' && current !== lastCollectedText) {
        if (!window.confirm('編集中の木構造を破棄して、ページから取得し直します。よろしいですか？')) return;
      }
      collectFromPage();
    }

    // ---- 生成（押下時に明示再解析。generateFromState は自前で解析しないため） ----
    function ensureParsed() {
      if (state.graph) return true;
      const parsed = parser.parseClaimTree(state.treeText);
      if (!parsed.ok) {
        showErrors(parsed.errors.map((e) => (e.line != null ? e.line + '行目: ' : '') + e.message));
        els.treeDetails.open = true;
        return false;
      }
      state.graph = parsed.graph;
      return true;
    }

    function handleGenerate() {
      clearResultUI(); // 生成前に必ず前回結果とエラー表示を消す
      if (!ensureParsed()) return; // ensureParsed が行番号付きエラーを表示済み
      const gen = session.generateFromState(state);
      if (!gen.ok) {
        showErrors(gen.error);
        return;
      }
      state.generatedText = gen.text;
      els.result.value = gen.text;
      els.copy.disabled = false;
      renderBreakdown(gen.resolved);
    }

    function renderBreakdown(resolved) {
      const f = formatter.formatClaimNumbers;
      const rows = [
        ['指摘する請求項', f(resolved.issueClaims)],
        ['関連する請求項', f(resolved.relatedClaims) || 'なし'],
        ['引用してくる請求項（従属項）', f(resolved.dependentClaims) || 'なし'],
        ['影響を受ける請求項全体', f(resolved.allAffectedClaims)],
      ];
      els.breakdown.textContent = '';
      for (const row of rows) {
        const dt = doc.createElement('dt');
        dt.textContent = row[0];
        const dd = doc.createElement('dd');
        dd.textContent = row[1];
        els.breakdown.appendChild(dt);
        els.breakdown.appendChild(dd);
      }
      els.breakdown.hidden = false;
    }

    // ---- コピー ----
    let feedbackTimer = null;
    function flashFeedback(message, ok) {
      els.copyFeedback.textContent = message;
      els.copyFeedback.classList.toggle('ok', ok);
      els.copyFeedback.classList.toggle('ng', !ok);
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        els.copyFeedback.textContent = '';
        els.copyFeedback.classList.remove('ok', 'ng');
      }, 2500);
    }

    function handleCopy() {
      const text = els.result.value;
      if (!text) return;
      const fallback = () => {
        let ok = false;
        try {
          els.result.focus();
          els.result.select();
          ok = doc.execCommand('copy');
        } catch (e) {
          ok = false;
        }
        if (window.getSelection) window.getSelection().removeAllRanges();
        flashFeedback(ok ? 'コピーしました' : 'コピーできませんでした。テキストを選択して手動でコピーしてください。', ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => flashFeedback('コピーしました', true),
          fallback
        );
      } else {
        fallback();
      }
    }

    // ---- ページ側の変化検知（収集のたびに bindObserver で張り直す） ----
    let observer = null;
    function bindObserver() {
      if (typeof MutationObserver !== 'function') return;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      const claimTreeHost = doc.getElementById('claim_tree');
      if (claimTreeHost) {
        observer = new MutationObserver(markStale);
        observer.observe(claimTreeHost, { childList: true, subtree: true, characterData: true });
      }
    }

    // ---- 終了処理 ----
    function onKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return; // IME 変換中の Escape は奪わない
      if (e.key === 'Escape') {
        // ページ側（Bootstrap モーダル等）に渡す前に閉じる
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    }

    function close() {
      if (observer) observer.disconnect();
      doc.removeEventListener('keydown', onKeydown, true);
      clearTimeout(feedbackTimer);
      rootEl.remove();
      style.remove();
      cleanup = null;
    }
    cleanup = close;

    // ---- 配線 ----
    els.close.addEventListener('click', close);
    doc.addEventListener('keydown', onKeydown, true);
    els.refetch.addEventListener('click', handleRefetch);
    els.tree.addEventListener('input', () => {
      applyUpstreamChange('treeText', els.tree.value);
      els.status.hidden = true; // 手動編集後のサマリは生成時の再解析で更新される
      clearStale(); // 手動編集はユーザーの意思なので陳腐化警告を解除
    });
    els.issueClaims.addEventListener('input', () => {
      applyUpstreamChange('issueClaimsText', els.issueClaims.value);
    });
    els.relatedClaims.addEventListener('input', () => {
      applyUpstreamChange('relatedClaimsText', els.relatedClaims.value);
    });
    rootEl.querySelectorAll('input[name="crw-issue-type"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) applyUpstreamChange('issueType', radio.value);
      });
    });
    els.generate.addEventListener('click', handleGenerate);
    els.copy.addEventListener('click', handleCopy);

    // ---- 起動時の収集 ----
    collectFromPage();
    els.issueClaims.focus();
  }

  return { TREE_SELECTORS, treeHtmlToText, extractTreeText, launch };
});
