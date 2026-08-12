/*
 * session.js — アプリ状態の純粋ロジック（DOM非依存）
 *
 * ローカルUIとブックマークレットの両方から使う「状態の整合性」を一手に担う:
 *   - invalidateDownstream: 上流入力（構造・指摘種別・請求項指定）が変わったら、
 *     生成済み文章（と必要なら解析結果）を必ず無効化する。
 *     ※ 古い生成文がコピー可能なまま残ると、誤った請求項番号を含む起案文が
 *       黙って複製される（本ツールの最悪故障モード）ため、ここで一元管理する。
 *   - restoreState: 保存データの復元時、生成文は「現在の入力から再生成した文と
 *     一致する場合のみ」復元する（不整合ペアの持ち越しを防ぐ）。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('./parser'), require('./resolver'), require('./generator'), require('./structure')
    );
  } else {
    root.CRW = root.CRW || {};
    for (const dep of ['parser', 'resolver', 'generator', 'structure']) {
      if (!root.CRW[dep]) {
        throw new Error('CRW.' + dep + ' が読み込まれていません。script の読み込み順を確認してください。');
      }
    }
    root.CRW.session = factory(root.CRW.parser, root.CRW.resolver, root.CRW.generator, root.CRW.structure);
  }
})(globalThis, function (parser, resolver, generator, structure) {
  'use strict';

  function createEmptyState() {
    return {
      // treeText は「貼り付けた／収集した生テキスト」。罫線ツリーでも引用一覧でもよい
      // （書式は structure.detectFormat が自動判定する）。保存データ互換のため名前は変えない。
      treeText: '',
      graph: null, // 解析済み引用関係（treeText から再計算できるキャッシュ）
      sourceFormat: null, // 'cite' | 'tree' | null（graph と同じライフサイクル）
      sourceMeta: null, // 引用一覧のときの付帯情報（上限到達・合計請求項数など）
      sourceWarnings: [], // ページ側データの自己矛盾など（生成はブロックしない）
      issueType: 'clarity',
      issueClaimsText: '',
      relatedClaimsText: '',
      generatedText: '',
      currentStep: 1,
    };
  }

  /**
   * 上流入力の変更を反映した新しい状態を返す。
   * どのフィールドの変更でも生成済み文章は無効化し、構造の変更では解析結果も捨てる。
   */
  function invalidateDownstream(state, changedField) {
    const next = Object.assign({}, state);
    if (changedField === 'treeText') {
      next.graph = null;
      next.sourceFormat = null;
      next.sourceMeta = null;
      next.sourceWarnings = [];
    }
    next.generatedText = '';
    return next;
  }

  /**
   * 状態のテキストを解析し、graph と付帯情報を書き戻す（失敗時は state を変更しない）。
   * ローカル版・ブックマークレット版の双方から使い、解析結果の格納方法を一元化する。
   * @returns {ok:true, graph, format, warnings} | {ok:false, errors:[{line,message}]}
   */
  function parseIntoState(state) {
    const parsed = structure.parseClaimStructure(state.treeText);
    if (!parsed.ok) return { ok: false, errors: parsed.errors, format: parsed.format };
    state.graph = parsed.graph;
    state.sourceFormat = parsed.format;
    state.sourceMeta = parsed.meta;
    state.sourceWarnings = parsed.warnings || [];
    return { ok: true, graph: parsed.graph, format: parsed.format, warnings: state.sourceWarnings };
  }

  /**
   * 状態（グラフ + 請求項入力文字列）から影響範囲を計算する。
   * @returns {ok:true, resolved} | {ok:false, error:string}
   */
  function resolveFromState(state) {
    if (!state || !state.graph) {
      return { ok: false, error: 'クレーム構造が解析されていません' };
    }
    const issue = parser.parseClaimNumberList(state.issueClaimsText);
    if (!issue.ok) return { ok: false, error: '指摘する請求項: ' + issue.error };
    const related = parser.parseClaimNumberList(state.relatedClaimsText);
    if (!related.ok) return { ok: false, error: '関連する請求項: ' + related.error };
    if (issue.claims.length === 0) {
      return { ok: false, error: '指摘する請求項を1つ以上入力してください' };
    }
    const resolved = resolver.resolveAffectedClaims(state.graph, issue.claims, related.claims);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return { ok: true, resolved };
  }

  /**
   * 状態から文章を生成する。
   * @returns {ok:true, text, resolved} | {ok:false, error:string}
   */
  function generateFromState(state) {
    const res = resolveFromState(state);
    if (!res.ok) return res;
    try {
      const text = generator.generateStatement({ issueType: state.issueType, resolved: res.resolved });
      return { ok: true, text, resolved: res.resolved };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  /**
   * 保存データ（localStorage の中身）から安全な状態を復元する。
   *   - 型が不正なフィールドは既定値に落とす
   *   - graph は保存値を使わず treeText を再解析（デシンク防止）
   *   - 生成文は現在の入力から再生成した文と一致する場合のみ復元
   *   - currentStep は到達可能な範囲にクランプ
   *     （構造なし→Step1、生成文なしのStep4→Step3）
   */
  function restoreState(saved) {
    const state = createEmptyState();
    if (!saved || typeof saved !== 'object') return state;

    if (typeof saved.treeText === 'string') state.treeText = saved.treeText;
    state.issueType = saved.issueType === 'support' ? 'support' : 'clarity';
    if (typeof saved.issueClaimsText === 'string') state.issueClaimsText = saved.issueClaimsText;
    if (typeof saved.relatedClaimsText === 'string') state.relatedClaimsText = saved.relatedClaimsText;

    if (state.treeText.trim()) {
      parseIntoState(state); // 失敗時は graph=null のまま（下でステップが1にクランプされる）
    }

    if (typeof saved.generatedText === 'string' && saved.generatedText !== '' && state.graph) {
      const regen = generateFromState(state);
      if (regen.ok && regen.text === saved.generatedText) {
        state.generatedText = saved.generatedText;
      }
    }

    let step = Number(saved.currentStep);
    if (!Number.isInteger(step) || step < 1 || step > 4) step = 1;
    if (!state.graph) step = 1;
    else if (step === 4 && state.generatedText === '') step = 3; // 生成し直しを促す
    state.currentStep = step;

    return state;
  }

  return {
    createEmptyState, invalidateDownstream, parseIntoState,
    resolveFromState, generateFromState, restoreState,
  };
});
