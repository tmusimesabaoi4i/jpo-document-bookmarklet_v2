/*
 * app.js — ローカル版UI（ステップ切替・保存・コピー）
 *
 * クレーム解析・影響範囲計算・文章生成・状態の整合性管理はすべて CRW.*（DOM非依存の
 * コアモジュール）に委譲し、このファイルは入力欄・ステップ切替・保存・コピーだけを
 * 担当する。
 *
 * ステップ切替は上部のステップ表示（ol.steps 内のボタン）をクリックして行い、
 * 1ステップ＝1画面として遷移する。Step 2 以降へ移るときは、クレーム構造が
 * 未解析なら自動で解析し、失敗したら行番号付きエラーを表示して Step 1 に留まる。
 *
 * 状態保持は二段階:
 *   1) 画面遷移中 …… state オブジェクト（メモリ）
 *   2) ブラウザを閉じた後 …… localStorage（使えない環境ではメモリのみで動作継続）
 *
 * 重要な安全規則: 上流入力（クレーム構造・指摘種別・請求項指定）が変わったら、
 * CRW.session.invalidateDownstream で生成済み文章を必ず無効化し、結果表示と
 * コピーボタンも同時に無効化する。古い生成文が「現在の結果」としてコピー可能な
 * まま残ることを防ぐ（誤った請求項番号の起案文が黙って複製される事故の防止）。
 */
(function () {
  'use strict';

  const CRW = globalThis.CRW || {};
  const REQUIRED_MODULES = [
    'parser', 'cite', 'structure', 'formatter', 'resolver', 'generator', 'session', 'examples',
  ];

  const STORAGE_KEY = 'crw.state';
  const SCHEMA_VERSION = 1;

  const storage = {
    available: true,
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw == null) return null;
        const data = JSON.parse(raw);
        // スキーマが変わった保存データは復元せず破棄する
        return data && data.schemaVersion === SCHEMA_VERSION ? data : null;
      } catch (e) {
        this.available = false;
        return null;
      }
    },
    save(data) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        this.available = true;
      } catch (e) {
        this.available = false;
      }
    },
    clear() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        /* 保存不可の環境では何もしない */
      }
    },
  };

  let state = null; // init() で CRW.session.createEmptyState() から作る

  const els = {};
  const $ = (id) => document.getElementById(id);

  // ---------- 保存 ----------

  function persist() {
    storage.save({
      schemaVersion: SCHEMA_VERSION,
      treeText: state.treeText,
      graph: state.graph,
      issueType: state.issueType,
      issueClaimsText: state.issueClaimsText,
      relatedClaimsText: state.relatedClaimsText,
      generatedText: state.generatedText,
      currentStep: state.currentStep,
    });
    updateStorageNote();
  }

  let persistTimer = null;
  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 200);
  }

  function updateStorageNote() {
    if (storage.available) {
      els.storageNote.hidden = true;
    } else {
      els.storageNote.textContent =
        '※ この環境ではブラウザへの保存（localStorage）が利用できないため、タブを閉じると入力内容は失われます。';
      els.storageNote.hidden = false;
    }
  }

  // ---------- メッセージ表示（ユーザー入力を含むため textContent のみ使用） ----------

  function hideMessage(el) {
    el.hidden = true;
    el.textContent = '';
  }

  function showMessages(el, messages) {
    el.textContent = '';
    for (const msg of Array.isArray(messages) ? messages : [messages]) {
      const div = document.createElement('div');
      div.textContent = msg;
      el.appendChild(div);
    }
    el.hidden = false;
  }

  // ---------- 上流変更の反映（生成済み結果の無効化を一元化） ----------

  function applyUpstreamChange(field, value) {
    state = CRW.session.invalidateDownstream(
      Object.assign({}, state, { [field]: value }),
      field
    );
    clearResultUI();
  }

  function clearResultUI() {
    els.result.value = '';
    els.copyResult.disabled = true;
    els.resultBreakdown.hidden = true;
    els.resultBreakdown.textContent = '';
    hideMessage(els.resultErrors);
  }

  // ---------- ステップ切替（上部インジケータのクリックで画面遷移） ----------

  // クレーム構造が未解析なら解析する。失敗したらエラーを表示して false を返す。
  // 入力が罫線ツリーか引用一覧かは CRW.structure が自動判別する
  function ensureParsed() {
    if (state.graph) return true;
    hideMessage(els.parseErrors);
    const result = CRW.session.parseIntoState(state);
    if (!result.ok) {
      showMessages(
        els.parseErrors,
        result.errors.map((e) => (e.line != null ? e.line + '行目: ' : '') + e.message)
      );
      renderSourceWarnings();
      return false;
    }
    renderParseSummary(state.graph);
    renderSourceWarnings();
    persist();
    return true;
  }

  // ページ側データ由来の注意書き（引用パターン上限到達・独立請求項の不一致など）。
  // 解析自体は成功しているので生成はブロックせず、注意書きとして併記する
  function renderSourceWarnings() {
    const messages = [];
    const meta = state.sourceMeta;
    if (meta && meta.overflow) {
      messages.push(
        'ページ側で引用パターンが上限（' + (meta.overflowLimit || 5000) +
        '）に達しています。この場合、木構造には一部の請求項しか含まれません' +
        '（この引用一覧からは全請求項を解析できています）。'
      );
    }
    for (const w of state.sourceWarnings || []) messages.push(w);
    if (messages.length === 0) {
      hideMessage(els.sourceWarnings);
      return;
    }
    showMessages(els.sourceWarnings, messages);
  }

  function goToStep(n) {
    // Step 2 以降へ移るにはクレーム構造の解析が必要（失敗時は Step 1 に留まる）
    if (n !== 1 && !ensureParsed()) n = 1;

    state.currentStep = n;
    for (let i = 1; i <= 4; i++) {
      els['panel' + i].hidden = i !== n; // 1ステップ＝1画面（パネルごと切替）
    }
    els.stepIndicator.querySelectorAll('li').forEach((li) => {
      const step = Number(li.dataset.step);
      li.classList.toggle('active', step === n);
      li.classList.toggle('done', step < n);
      if (step === n) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    if (n === 3) renderClaimsHint();
    persist();
  }

  // ---------- Step 1: クレーム構造 ----------

  function onTreeTextChanged() {
    applyUpstreamChange('treeText', els.treeInput.value);
    hideMessage(els.parseErrors);
    hideMessage(els.parseSummary);
    hideMessage(els.sourceWarnings);
    persistSoon();
  }

  function renderParseSummary(graph) {
    const f = CRW.formatter.formatClaimNumbers;
    showMessages(
      els.parseSummary,
      CRW.structure.formatLabel(state.sourceFormat) + 'として請求項 ' + graph.nodes.length +
      ' 項を解析しました。独立請求項: ' + f(graph.roots)
    );
    els.relationsPre.textContent = relationsPreview(graph);
  }

  function relationsPreview(graph) {
    const parentsByChild = new Map();
    for (const [from, to] of graph.edges) {
      if (!parentsByChild.has(to)) parentsByChild.set(to, []);
      parentsByChild.get(to).push(from);
    }
    return graph.nodes
      .map((n) => {
        const parents = parentsByChild.get(n);
        return parents
          ? '請求項' + n + ' は 請求項' + parents.sort((a, b) => a - b).join('、') + ' を引用'
          : '請求項' + n + '（独立請求項）';
      })
      .join('\n');
  }

  function loadSampleText(text) {
    if (!text) return;
    if (state.treeText.trim() && state.treeText !== text) {
      if (!window.confirm('入力欄の内容をサンプルで置き換えます。よろしいですか？')) return;
    }
    els.treeInput.value = text;
    onTreeTextChanged();
  }

  function handleLoadSample() {
    const tree = CRW.examples.trees.tree1;
    if (tree) loadSampleText(tree.text);
  }

  function handleLoadSampleCite() {
    const cite = CRW.examples.cites && CRW.examples.cites.cite1;
    if (cite) loadSampleText(cite.text);
  }

  // ---------- Step 3: 請求項指定 ----------

  function renderClaimsHint() {
    if (!state.graph) {
      els.claimsHint.textContent = '';
      return;
    }
    const f = CRW.formatter.formatClaimNumbers;
    els.claimsHint.textContent =
      '解析済みの請求項: ' + f(state.graph.nodes) +
      '（全 ' + state.graph.nodes.length + ' 項、独立請求項: ' + f(state.graph.roots) + '）';
  }

  // ---------- Step 4: 生成・コピー ----------

  function handleGenerate() {
    hideMessage(els.resultErrors);
    const gen = CRW.session.generateFromState(state);
    if (!gen.ok) {
      clearResultUI();
      showMessages(els.resultErrors, gen.error);
      return;
    }
    state.generatedText = gen.text;
    els.result.value = gen.text;
    els.copyResult.disabled = false;
    renderBreakdown(gen.resolved);
    persist();
  }

  function renderBreakdown(resolved) {
    const f = CRW.formatter.formatClaimNumbers;
    const rows = [
      ['指摘する請求項', f(resolved.issueClaims)],
      ['関連する請求項', f(resolved.relatedClaims) || 'なし'],
      ['引用してくる請求項（従属項）', f(resolved.dependentClaims) || 'なし'],
      ['影響を受ける請求項全体', f(resolved.allAffectedClaims)],
    ];
    els.resultBreakdown.textContent = '';
    for (const [label, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      els.resultBreakdown.appendChild(dt);
      els.resultBreakdown.appendChild(dd);
    }
    els.resultBreakdown.hidden = false;
  }

  let copyFeedbackTimer = null;
  function flashCopyFeedback(message, ok) {
    els.copyFeedback.textContent = message;
    els.copyFeedback.classList.toggle('ok', ok);
    els.copyFeedback.classList.toggle('ng', !ok);
    clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => {
      els.copyFeedback.textContent = '';
      els.copyFeedback.classList.remove('ok', 'ng');
    }, 2500);
  }

  async function handleCopy() {
    const text = els.result.value;
    if (!text) return;
    let ok = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {
        ok = false;
      }
    }
    if (!ok) {
      // file:// などで Clipboard API が拒否される環境向けのフォールバック
      try {
        els.result.focus();
        els.result.select();
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      if (window.getSelection) window.getSelection().removeAllRanges();
    }
    flashCopyFeedback(
      ok ? 'コピーしました' : 'コピーできませんでした。テキストを選択して手動でコピーしてください。',
      ok
    );
  }

  function handleReset() {
    if (!window.confirm('入力内容と保存データをすべて消去します。よろしいですか？')) return;
    storage.clear();
    state = CRW.session.createEmptyState();
    syncUIFromState();
    hideMessage(els.parseErrors);
    hideMessage(els.parseSummary);
    hideMessage(els.sourceWarnings);
    clearResultUI();
    goToStep(1);
  }

  // ---------- 復元 ----------

  function restoreSavedState() {
    const saved = storage.load();
    if (!saved) return;
    // 復元の整合性検証（graph の再解析・生成文の再生成照合・ステップのクランプ）は
    // session.restoreState に集約されている
    state = CRW.session.restoreState(saved);
  }

  function syncUIFromState() {
    els.treeInput.value = state.treeText;
    els.issueClaims.value = state.issueClaimsText;
    els.relatedClaims.value = state.relatedClaimsText;
    els.result.value = state.generatedText;
    els.copyResult.disabled = state.generatedText === '';
    document.querySelectorAll('input[name="issue-type"]').forEach((radio) => {
      radio.checked = radio.value === state.issueType;
    });
    if (state.graph) {
      renderParseSummary(state.graph);
      renderSourceWarnings();
      // 生成文が復元された場合（= 現在の入力との一致を session が検証済み）のみ内訳も再構築
      if (state.generatedText) {
        const res = CRW.session.resolveFromState(state);
        if (res.ok) renderBreakdown(res.resolved);
      }
    }
  }

  // ---------- 初期化 ----------

  function handleKeyboardShortcuts(e) {
    if (state.currentStep !== 4 || e.key !== 'Enter') return;
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !els.copyResult.disabled) {
      e.preventDefault();
      handleCopy();
    }
  }

  function wireEvents() {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    for (let i = 1; i <= 4; i++) {
      const step = i;
      els['stepBtn' + i].addEventListener('click', () => goToStep(step));
    }
    els.treeInput.addEventListener('input', onTreeTextChanged);
    els.loadSample.addEventListener('click', handleLoadSample);
    els.loadSampleCite.addEventListener('click', handleLoadSampleCite);
    els.generate.addEventListener('click', handleGenerate);
    els.copyResult.addEventListener('click', handleCopy);
    els.resetAll.addEventListener('click', handleReset);
    els.issueClaims.addEventListener('input', () => {
      applyUpstreamChange('issueClaimsText', els.issueClaims.value);
      persistSoon();
    });
    els.relatedClaims.addEventListener('input', () => {
      applyUpstreamChange('relatedClaimsText', els.relatedClaims.value);
      persistSoon();
    });
    document.querySelectorAll('input[name="issue-type"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          applyUpstreamChange('issueType', radio.value);
          persist();
        }
      });
    });
  }

  function init() {
    const missing = REQUIRED_MODULES.filter((m) => !CRW[m]);
    if (missing.length > 0) {
      const div = document.createElement('div');
      div.className = 'message error';
      div.textContent =
        'スクリプトの読み込みに失敗しました: ' + missing.join(', ') +
        '。ファイル構成と読み込み順を確認してください。';
      document.body.prepend(div);
      return;
    }
    els.stepIndicator = $('step-indicator');
    for (let i = 1; i <= 4; i++) {
      els['panel' + i] = $('panel-' + i);
      els['stepBtn' + i] = $('step-btn-' + i);
    }
    els.loadSample = $('load-sample');
    els.loadSampleCite = $('load-sample-cite');
    els.treeInput = $('tree-input');
    els.parseErrors = $('parse-errors');
    els.parseSummary = $('parse-summary');
    els.sourceWarnings = $('source-warnings');
    els.relationsPre = $('relations-pre');
    els.claimsHint = $('claims-hint');
    els.issueClaims = $('issue-claims');
    els.relatedClaims = $('related-claims');
    els.generate = $('generate');
    els.copyResult = $('copy-result');
    els.copyFeedback = $('copy-feedback');
    els.result = $('result');
    els.resultErrors = $('result-errors');
    els.resultBreakdown = $('result-breakdown');
    els.resetAll = $('reset-all');
    els.storageNote = $('storage-note');

    state = CRW.session.createEmptyState();
    restoreSavedState();
    syncUIFromState();
    wireEvents();
    goToStep(state.currentStep);
    updateStorageNote();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
