/*
 * workspace.js — 比較専用タブの画面（骨組み・比較ビュー・段落同期）
 *
 * 設計上の要点:
 *   - 新しいタブの document を **親タブの JS から DOM API だけで組み立てる**。
 *     対象ページの CSP は script-src 'self' で、about:blank はその CSP を継承するため、
 *     script 要素の注入も eval も使えない（使わない）。document.write も使わない。
 *   - 本文は必ず textContent で入れる。innerHTML は 1 か所も使わない。
 *   - 段落選択では画面を作り直さない。カードごとの段落要素の配列を描画時に持っておき、
 *     class を付け替えるだけ。強調する段落は segmatch.js が「同じ段落番号」ではなく
 *     「最も似ている段落」で決める（比較用データは起動時に一度だけ作ってキャッシュ）。
 *     十分に似た段落が無ければ、同じ番号へ落とさずに「類似段落なし」と出す。
 *   - カードは DocumentFragment へ一括で組み立てて 1 回だけ挿入する。分割描画（rAF）は
 *     使わない: 上限 100 枚でも実測 6ms で終わる一方、rAF はバックグラウンドのタブで
 *     発火しないため、裏で開いた比較タブが途中までしか描かれない実害が出る。
 *   - 列数は layout.js（純関数）が決める。resize でも作り直さず style だけ更新する。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../core/layout'),
      require('../core/groupstate'),
      require('../core/grouping'),
      require('../core/segmatch'),
      require('./dom'),
      require('./styles'),
      require('./editor')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['layout', 'groupstate', 'grouping', 'segmatch', 'dom', 'styles', 'editor']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.workspace = factory(root.JCGC.layout, root.JCGC.groupstate, root.JCGC.grouping,
      root.JCGC.segmatch, root.JCGC.dom, root.JCGC.styles, root.JCGC.editor);
  }
})(globalThis, function (layout, groupstate, grouping, segmatch, dom, styles, editor) {
  'use strict';

  const h = dom.h;

  const COLUMN_OPTIONS = [
    { value: 'auto', label: '自動' }, { value: '2', label: '2' }, { value: '3', label: '3' },
    { value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' },
  ];
  const DENSITY_OPTIONS = [
    { value: 'normal', label: '標準' }, { value: 'compact', label: 'コンパクト' }, { value: 'roomy', label: 'ゆったり' },
  ];

  function formatCitations(numbers) {
    if (!numbers || !numbers.length) return '';
    if (numbers.length <= 4) return '←' + numbers.map((n) => '請求項' + n).join('・');
    return '←請求項' + numbers[0] + '〜' + numbers[numbers.length - 1] + '（' + numbers.length + '件）';
  }

  // 100 請求項のグループでも一覧やバッジが崩れないよう、長い並びは省略する
  const NUMBER_PREVIEW_LIMIT = 20;

  function formatNumbers(numbers, limit) {
    const max = limit == null ? NUMBER_PREVIEW_LIMIT : limit;
    if (numbers.length <= max) return numbers.join('・');
    return numbers.slice(0, max).join('・') + '…ほか' + (numbers.length - max) + '項';
  }

  function createWorkspace(options) {
    const opts = options || {};
    const doc = opts.doc;
    const win = opts.win || null;
    const claims = (opts.claims || []).slice().sort((a, b) => a.number - b.number);
    const claimMap = new Map(claims.map((c) => [c.number, c]));
    const meta = opts.meta || {};
    const regroup = opts.regroup || function (presetKey) {
      return grouping.autoGroup(claims, { preset: presetKey }).groups;
    };
    const store = groupstate.createStore({
      claims,
      autoGroups: opts.autoGroups || [],
      preset: opts.preset || grouping.DEFAULT_PRESET,
    });
    // 段落の対応付け。比較用データはここで一度だけ作ってキャッシュする
    const matcher = opts.matcher || segmatch.createMatcher(claims);

    const ui = {};
    // 描画のたびに作り直さないための索引
    let cardMeta = [];          // [{ number, segmentCount, items, missingEl }]
    let selectedElements = [];
    let lastCardsKey = '';

    /* ---- 骨組み ---------------------------------------------------- */
    function buildSkeleton() {
      if (doc.documentElement && doc.documentElement.setAttribute) doc.documentElement.setAttribute('lang', 'ja');
      try { doc.title = '請求項グループ比較'; } catch (e) { /* about:blank 直後は無視 */ }

      const head = doc.head || doc.documentElement;
      const style = h(doc, 'style', { id: 'jcgc-style', text: styles.WORKSPACE_CSS });
      head.appendChild(style);
      const titleEl = doc.querySelector && doc.querySelector('title');
      if (!titleEl) head.appendChild(h(doc, 'title', { text: '請求項グループ比較' }));

      const body = doc.body || doc.documentElement;
      dom.clear(body);
      body.setAttribute('class', 'jcgc-density-normal');

      ui.root = h(doc, 'div', { id: 'jcgc-app' });
      body.appendChild(ui.root);

      buildHeader();
      buildBanner();
      buildToolbar();
      buildSegbar();

      ui.compare = h(doc, 'main', { id: 'jcgc-view-compare', class: 'jcgc-main' });
      ui.editView = h(doc, 'main', { id: 'jcgc-view-edit', class: 'jcgc-main jcgc-hidden' });
      ui.root.appendChild(ui.compare);
      ui.root.appendChild(ui.editView);

      ui.groupInfo = h(doc, 'section', { class: 'jcgc-groupinfo', id: 'jcgc-groupinfo' });
      ui.grid = h(doc, 'div', { class: 'jcgc-grid', id: 'jcgc-grid' });
      ui.compare.appendChild(ui.groupInfo);
      ui.compare.appendChild(ui.grid);

      if (ui.grid.addEventListener) ui.grid.addEventListener('click', onGridClick);
      if (win && win.addEventListener) {
        win.addEventListener('resize', debounce(applyLayout, 120));
      }
    }

    function buildHeader() {
      const metaBits = [];
      if (meta.lappnum) metaBits.push('出願番号 ' + meta.lappnum);
      metaBits.push('全' + claims.length + '請求項');
      if (meta.sourceLabel) metaBits.push('抽出元: ' + meta.sourceLabel);

      ui.tabCompare = h(doc, 'button', { class: 'jcgc-tab is-active', type: 'button', text: '比較' });
      ui.tabEdit = h(doc, 'button', { class: 'jcgc-tab', type: 'button', text: 'グループ編集' });
      if (ui.tabCompare.addEventListener) ui.tabCompare.addEventListener('click', () => store.setViewMode('compare'));
      if (ui.tabEdit.addEventListener) ui.tabEdit.addEventListener('click', () => store.setViewMode('edit'));

      ui.header = h(doc, 'header', { class: 'jcgc-header' }, [
        h(doc, 'div', { class: 'jcgc-header-row' }, [
          h(doc, 'h1', { class: 'jcgc-title', text: '請求項グループ比較' }),
          h(doc, 'span', { class: 'jcgc-meta', text: metaBits.join('　/　') }),
          h(doc, 'nav', { class: 'jcgc-tabs' }, [ui.tabCompare, ui.tabEdit]),
        ]),
      ]);
      ui.root.appendChild(ui.header);
    }

    // 影響の大きい操作の確認（ネイティブの confirm は使わず、画面内のバーで尋ねる）
    function buildBanner() {
      ui.banner = h(doc, 'div', { class: 'jcgc-banner jcgc-hidden', id: 'jcgc-banner' });
      ui.root.appendChild(ui.banner);
    }

    function askConfirm(message, yesLabel, onYes) {
      dom.clear(ui.banner);
      ui.banner.appendChild(h(doc, 'span', { text: message }));
      const yes = dom.button(doc, yesLabel, () => { hideBanner(); onYes(); }, { class: 'jcgc-btn is-primary' });
      const no = dom.button(doc, 'キャンセル', hideBanner);
      ui.banner.appendChild(h(doc, 'span', { text: '　' }));
      ui.banner.appendChild(yes);
      ui.banner.appendChild(h(doc, 'span', { text: ' ' }));
      ui.banner.appendChild(no);
      dom.removeClass(ui.banner, 'jcgc-hidden');
      ui.bannerButtons = { yes, no };
    }

    function showNotice(message) {
      dom.clear(ui.banner);
      ui.banner.appendChild(h(doc, 'span', { text: message }));
      ui.banner.appendChild(h(doc, 'span', { text: '　' }));
      ui.banner.appendChild(dom.button(doc, '閉じる', hideBanner));
      dom.removeClass(ui.banner, 'jcgc-hidden');
    }

    function hideBanner() {
      dom.clear(ui.banner);
      dom.addClass(ui.banner, 'jcgc-hidden');
      ui.bannerButtons = null;
    }

    function buildToolbar() {
      ui.groupSelect = dom.select(doc, [], '', (ev) => {
        store.selectGroup(ev.target ? ev.target.value : ev.currentTarget.value);
      }, { id: 'jcgc-group-select' });

      ui.presetButtons = {};
      const presetGroup = h(doc, 'div', { class: 'jcgc-btn-group' });
      for (const key of Object.keys(grouping.PRESETS)) {
        const preset = grouping.PRESETS[key];
        const btn = dom.button(doc, preset.label, () => onPresetChange(key), {
          title: preset.description,
          attrs: { 'data-preset': key },
        });
        ui.presetButtons[key] = btn;
        presetGroup.appendChild(btn);
      }

      ui.regroupButton = dom.button(doc, '自動グルーピング再実行', onRegroupClick, { class: 'jcgc-btn is-primary' });

      ui.columnSelect = dom.select(doc, COLUMN_OPTIONS, 'auto', (ev) => {
        store.setColumns((ev.target || ev.currentTarget).value);
      }, { id: 'jcgc-columns' });
      ui.densitySelect = dom.select(doc, DENSITY_OPTIONS, 'normal', (ev) => {
        store.setDensity((ev.target || ev.currentTarget).value);
      }, { id: 'jcgc-density' });

      ui.modeDim = dom.button(doc, '選択段落を強調', () => store.setHighlightMode('dim'));
      ui.modeOnly = dom.button(doc, '選択段落のみ', () => store.setHighlightMode('only'));

      ui.toolbar = h(doc, 'div', { class: 'jcgc-toolbar' }, [
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: 'グループ選択' }), ui.groupSelect,
        ]),
        ui.regroupButton,
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: 'グルーピング強度' }), presetGroup,
        ]),
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: '列数' }), ui.columnSelect,
        ]),
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: '表示密度' }), ui.densitySelect,
        ]),
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: '強調' }),
          h(doc, 'div', { class: 'jcgc-btn-group' }, [ui.modeDim, ui.modeOnly]),
        ]),
      ]);
      ui.root.appendChild(ui.toolbar);
    }

    function buildSegbar() {
      ui.segbar = h(doc, 'div', { class: 'jcgc-segbar', id: 'jcgc-segbar' });
      if (ui.segbar.addEventListener) ui.segbar.addEventListener('click', onSegbarClick);
      ui.root.appendChild(ui.segbar);
    }

    /* ---- 操作ハンドラ ----------------------------------------------- */
    function onPresetChange(key) {
      store.setPreset(key);
      applyAuto(key, false);
    }

    function onRegroupClick() {
      const key = store.getState().preset;
      if (store.hasManualWork()) {
        askConfirm(
          '手動で作成・編集したグループがあります。それらを残したまま自動グループだけ作り直しますか。',
          '残して再実行',
          () => applyAuto(key, false)
        );
        return;
      }
      applyAuto(key, false);
    }

    function applyAuto(presetKey, overwriteManual) {
      const groups = regroup(presetKey);
      store.applyAutoGroups(groups, { overwriteManual: !!overwriteManual });
    }

    function onSegbarClick(ev) {
      const target = dom.closestWithAttr(ev.target || ev.srcElement, 'data-segbtn', ui.segbar);
      if (!target) return;
      store.selectSegment(Number(target.getAttribute('data-segbtn')), null);
    }

    function onGridClick(ev) {
      const target = dom.closestWithAttr(ev.target || ev.srcElement, 'data-seg', ui.grid);
      if (!target) return;
      const card = dom.closestWithAttr(target, 'data-claim', ui.grid);
      const claimNumber = card ? Number(card.getAttribute('data-claim')) : null;
      const seg = Number(target.getAttribute('data-seg'));
      const state = store.getState();
      // 同じ段落をもう一度押したら「全体」へ戻す
      const isSame = state.selectedSegment === seg && selectionSource() === claimNumber;
      store.selectSegment(isSame ? 0 : seg, isSame ? null : claimNumber);
    }

    function debounce(fn, wait) {
      let timer = null;
      return function debounced() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(); }, wait);
      };
    }

    /* ---- グループ一覧・段落バー ------------------------------------- */
    function groupOptionLabel(group) {
      const badge = group.source === 'manual' ? '手動'
        : (group.manuallyEdited ? '手動編集済み' : '自動');
      return group.name + '　' + group.claimNumbers.length + '項｜'
        + formatNumbers(group.claimNumbers) + '｜' + badge;
    }

    function renderGroupSelect() {
      const state = store.getState();
      dom.clear(ui.groupSelect);
      if (!state.groups.length) {
        ui.groupSelect.appendChild(h(doc, 'option', { value: '', text: 'グループがありません' }));
        return;
      }
      for (const group of state.groups) {
        const opt = h(doc, 'option', { value: group.id, text: groupOptionLabel(group) });
        if (group.id === state.selectedGroupId) opt.setAttribute('selected', 'selected');
        ui.groupSelect.appendChild(opt);
      }
      if ('value' in ui.groupSelect) ui.groupSelect.value = state.selectedGroupId || '';
    }

    function renderSegbar(members) {
      const state = store.getState();
      const maxSegments = members.reduce((max, c) => Math.max(max, c.segmentCount), 0);
      dom.clear(ui.segbar);
      ui.segbar.appendChild(h(doc, 'span', { class: 'jcgc-meta', text: '段落選択' }));
      const all = h(doc, 'button', {
        class: 'jcgc-segbtn' + (state.selectedSegment === 0 ? ' is-active' : ''),
        type: 'button', text: '全体', attrs: { 'data-segbtn': '0' },
      });
      ui.segbar.appendChild(all);
      for (let i = 1; i <= maxSegments; i += 1) {
        ui.segbar.appendChild(h(doc, 'button', {
          class: 'jcgc-segbtn' + (state.selectedSegment === i ? ' is-active' : ''),
          type: 'button', text: '段落' + i, attrs: { 'data-segbtn': String(i) },
        }));
      }
    }

    function renderGroupInfo(group, members) {
      dom.clear(ui.groupInfo);
      if (!group) return;
      const badge = group.source === 'manual' ? '手動'
        : (group.manuallyEdited ? '手動編集済み' : '自動');
      const head = h(doc, 'h2', {}, [
        h(doc, 'span', { text: group.name }),
        h(doc, 'span', {
          class: 'jcgc-badge' + (badge === '自動' ? '' : ' is-manual'),
          text: badge,
        }),
        h(doc, 'span', { class: 'jcgc-badge', text: group.claimNumbers.length + '項' }),
        h(doc, 'span', { class: 'jcgc-badge', text: formatNumbers(group.claimNumbers) }),
      ]);
      if (group.score != null) {
        head.appendChild(h(doc, 'span', { class: 'jcgc-badge', text: '類似度 ' + group.score }));
      }
      if (group.candidateNumbers && group.candidateNumbers.length) {
        head.appendChild(h(doc, 'span', {
          class: 'jcgc-badge is-candidate',
          text: '追加候補 ' + formatNumbers(group.candidateNumbers),
        }));
      }
      ui.groupInfo.appendChild(head);

      if (group.reasons && group.reasons.length) {
        const list = h(doc, 'ul', { class: 'jcgc-reasons' });
        for (const reason of group.reasons) list.appendChild(h(doc, 'li', { text: reason }));
        ui.groupInfo.appendChild(list);
      }
      if (group.candidateNumbers && group.candidateNumbers.length) {
        ui.groupInfo.appendChild(h(doc, 'p', {
          class: 'jcgc-note',
          text: '「追加候補」は、グループの一部とだけ似ていたため自動では確定しなかった請求項です。'
            + '参考として一緒に並べています。グループ編集から正式メンバーへ昇格させられます。',
        }));
      }
      ui.groupInfo.appendChild(h(doc, 'p', {
        class: 'jcgc-note',
        text: 'この根拠は、法的な同一性の判定ではありません。字面・段落構造・カテゴリー・'
          + '引用関係・クレームツリー上の位置から、機械的に比較候補を作成した理由です。',
      }));
    }

    /* ---- カード ------------------------------------------------------ */
    function buildCard(claim, isCandidate) {
      const tags = [claim.isIndependent ? '独立項' : '従属項'];
      const cite = formatCitations(claim.citations);
      if (cite) tags.push(cite);
      if (claim.categoryLabel) tags.push(claim.categoryLabel);

      const list = h(doc, 'ol', { class: 'jcgc-segs' });
      const items = [];
      for (const seg of claim.segments) {
        const li = h(doc, 'li', {
          class: 'jcgc-seg',
          attrs: { 'data-seg': String(seg.index), 'data-depth': String(Math.min(seg.depth, 3)) },
        }, [
          h(doc, 'span', { class: 'jcgc-seg-no', text: String(seg.index) }),
          h(doc, 'span', { class: 'jcgc-seg-text', text: seg.text }),
        ]);
        list.appendChild(li);
        items.push(li);
      }

      const missing = h(doc, 'p', { class: 'jcgc-missing jcgc-hidden' });
      const head = h(doc, 'header', { class: 'jcgc-card-head' }, [
        h(doc, 'span', { class: 'jcgc-card-no', text: '請求項' + claim.number }),
        h(doc, 'span', { class: 'jcgc-card-tags', text: tags.join('｜') }),
      ]);
      if (isCandidate) {
        head.appendChild(h(doc, 'span', {
          class: 'jcgc-badge is-candidate',
          title: '自動グルーピングでは確定しなかった請求項です',
          text: '追加候補',
        }));
      }
      const card = h(doc, 'article', {
        class: 'jcgc-card' + (isCandidate ? ' is-candidate' : ''),
        attrs: { 'data-claim': String(claim.number) },
      }, [head, list, missing]);

      return { card, items, missing, claim };
    }

    /*
     * カードの描画。
     *
     * 分割描画（requestAnimationFrame での遅延挿入）は **使わない**。実測すると
     * 上限の 100 枚（約 3,900 ノード）でも組み立て 5ms・挿入 1ms で終わり、
     * 分割する利益が無い一方、rAF はバックグラウンドのタブで発火せず、
     * setTimeout も背面タブでは 1 秒級に絞られるため、
     * 「裏で開いた比較タブが途中までしか描かれない」という実害が出る。
     * 代わりに DocumentFragment へ一括で組み立てて 1 回だけ挿入する。
     *
     * 同じグループを描き直さない（key が同じならスキップ）ので、
     * 段落選択や密度変更のたびに DOM を作り直すこともない。
     */
    function renderCards(entries, force) {
      const state = store.getState();
      const key = state.selectedGroupId + '|'
        + entries.map((e) => e.claim.number + (e.isCandidate ? 'c' : '')).join(',');
      if (!force && key === lastCardsKey) return;
      lastCardsKey = key;

      dom.clear(ui.grid);
      cardMeta = [];
      selectedElements = [];

      if (!entries.length) {
        ui.grid.appendChild(h(doc, 'p', { class: 'jcgc-empty', text: 'このグループには請求項がありません。' }));
        return;
      }

      const frag = dom.fragment(doc);
      for (const entry of entries) {
        const built = buildCard(entry.claim, entry.isCandidate);
        cardMeta.push({
          number: entry.claim.number,
          segmentCount: entry.claim.segmentCount,
          items: built.items,
          missingEl: built.missing,
        });
        frag.appendChild(built.card);
      }
      ui.grid.appendChild(frag);
      applySelection();
    }

    /*
     * 選択の基準になる請求項。カードの段落をクリックしたときはその請求項、
     * 上部の段落ボタンから選んだときはグループ先頭の請求項。
     */
    function selectionSource() {
      const state = store.getState();
      const source = state.selectedSourceClaim;
      if (source != null && cardMeta.some((info) => info.number === source)) return source;
      return cardMeta.length ? cardMeta[0].number : null;
    }

    /*
     * 段落選択の反映。画面は作り直さず、class を付け替えるだけ。
     *
     * 各カードで強調する段落は「同じ段落番号」ではなく、選択した段落に最も似ている段落
     * （segmatch.js）。1 つの請求項にだけ固有の段落が挟まっていても、その後の段落が
     * 正しく対応する。十分に似た段落が無いときは **何も強調しない**（同じ段落番号へは
     * 落とさない。誤った段落を強調するより、何も強調しないほうがよい）。
     */
    function applySelection() {
      const state = store.getState();
      const seg = state.selectedSegment;
      const sourceNumber = selectionSource();

      for (const el of selectedElements) dom.removeClass(el, 'is-selected');
      selectedElements = [];

      dom.toggleClass(ui.grid, 'is-dim', seg > 0 && state.highlightMode === 'dim');
      dom.toggleClass(ui.grid, 'is-only', seg > 0 && state.highlightMode === 'only');

      for (const info of cardMeta) {
        const hit = seg > 0 && sourceNumber != null
          ? matcher.resolve(sourceNumber, seg, info.number, info.segmentCount)
          : null;
        if (hit && info.items[hit.index - 1]) {
          const el = info.items[hit.index - 1];
          dom.addClass(el, 'is-selected');
          selectedElements.push(el);
        }
        const missingHere = seg > 0 && !hit;
        info.missingEl.textContent = missingHere ? '類似段落なし' : '';
        dom.toggleClass(info.missingEl, 'jcgc-hidden', !missingHere);
      }

      // 段落ボタンの選択状態
      if (ui.segbar.childNodes) {
        for (const node of ui.segbar.childNodes) {
          if (node.nodeType !== 1 || !node.getAttribute) continue;
          const value = node.getAttribute('data-segbtn');
          if (value == null) continue;
          dom.toggleClass(node, 'is-active', Number(value) === seg);
        }
      }
    }

    /* ---- レイアウト --------------------------------------------------- */
    function viewportWidth() {
      if (win && win.innerWidth) return win.innerWidth;
      if (doc.documentElement && doc.documentElement.clientWidth) return doc.documentElement.clientWidth;
      return 1280;
    }

    /*
     * ヘッダー・操作バー・段落バーの実測高さを CSS 変数へ渡す。
     * 段重ねの sticky を正しい位置で止めるために必要で、カード見出しの sticky も
     * その下に来るようにする（見出しが操作バーの裏へ潜らないように）。
     * 高さを測れない環境（テスト用の最小 DOM）では何もしない。
     */
    function applyStickyOffsets() {
      const heights = [ui.header, ui.toolbar, ui.segbar].map((el) => (el && el.offsetHeight) || 0);
      if (!heights[0]) return;
      const [headerH, toolbarH, segbarH] = heights;
      ui.root.setAttribute('style', [
        '--jcgc-header-h:' + headerH + 'px',
        '--jcgc-toolbar-h:' + (headerH + toolbarH) + 'px',
        '--jcgc-segbar-h:' + (headerH + toolbarH + segbarH) + 'px',
      ].join(';'));
    }

    function applyLayout() {
      const state = store.getState();
      const group = store.getSelectedGroup();
      const cardCount = group ? group.claimNumbers.length : 0;
      const result = layout.computeLayout({
        viewportWidth: viewportWidth(),
        cardCount,
        density: state.density,
        columns: state.columns,
      });
      ui.grid.setAttribute('style', '--jcgc-cols:' + result.columns + ';--jcgc-gap:' + result.gap + 'px');
      dom.toggleClass(ui.grid, 'is-single', result.centered);
      const body = doc.body || doc.documentElement;
      body.setAttribute('class', 'jcgc-density-' + result.densityKey);
      applyStickyOffsets();
      ui.lastLayout = result;
      return result;
    }

    /* ---- 再描画 ------------------------------------------------------- */
    // グループのカード（正式メンバー → 追加候補 の順）
    function groupEntries(group) {
      if (!group) return [];
      const entries = group.claimNumbers
        .map((n) => claimMap.get(n)).filter(Boolean)
        .map((claim) => ({ claim, isCandidate: false }));
      for (const n of group.candidateNumbers || []) {
        const claim = claimMap.get(n);
        if (claim && group.claimNumbers.indexOf(n) === -1) entries.push({ claim, isCandidate: true });
      }
      return entries;
    }

    function render() {
      const state = store.getState();
      const group = store.getSelectedGroup();
      const entries = groupEntries(group);
      const members = entries.map((e) => e.claim);

      renderGroupSelect();

      for (const key of Object.keys(ui.presetButtons)) {
        dom.toggleClass(ui.presetButtons[key], 'is-active', key === state.preset);
      }
      dom.toggleClass(ui.modeDim, 'is-active', state.highlightMode === 'dim');
      dom.toggleClass(ui.modeOnly, 'is-active', state.highlightMode === 'only');
      if ('value' in ui.columnSelect) ui.columnSelect.value = String(state.columns);
      if ('value' in ui.densitySelect) ui.densitySelect.value = String(state.density);

      dom.toggleClass(ui.tabCompare, 'is-active', state.viewMode === 'compare');
      dom.toggleClass(ui.tabEdit, 'is-active', state.viewMode === 'edit');
      dom.toggleClass(ui.compare, 'jcgc-hidden', state.viewMode !== 'compare');
      dom.toggleClass(ui.editView, 'jcgc-hidden', state.viewMode !== 'edit');
      dom.toggleClass(ui.segbar, 'jcgc-hidden', state.viewMode !== 'compare');

      if (state.viewMode === 'compare') {
        renderGroupInfo(group, members);
        renderSegbar(members);
        renderCards(entries, false);
        applySelection();
        applyLayout();
      } else {
        editor.render({
          doc,
          container: ui.editView,
          store,
          claims,
          askConfirm,
          showNotice,
          onRegroup: (presetKey, overwriteManual) => applyAuto(presetKey, overwriteManual),
        });
      }
    }

    buildSkeleton();
    store.subscribe(render);
    render();

    // 元タブが閉じられたら、以降の操作ができないことだけ知らせる（表示内容は読めるまま）
    function markDetached() {
      showNotice('元のクレームチェッカーのタブが閉じられました。表示中の内容はこのまま読めますが、'
        + '再グルーピングや編集などの操作はできません。');
    }

    return {
      store,
      ui,
      render,
      applyLayout,
      applySelection,
      markDetached,
      // テスト・確認用
      getMatcher() { return matcher; },
      getCardMeta() { return cardMeta; },
      askConfirm,
      showNotice,
      hideBanner,
    };
  }

  return { createWorkspace, formatCitations };
});
