/*
 * relation-workspace.js — 比較タブの画面（手動関連付け版）
 *
 * 自動関連付け版（workspace.js）とは別ファイル。**類似段落の計算を一切行わない**
 * （segmatch.js を読み込まないので、内部で走ることもない）。
 *
 * 自動版と同じもの: 骨組み・淡い青の配色・カード表示・段落分割・可変レイアウト（最大100枚）・
 *   グループ選択・請求項の自動グルーピング・グループ編集（editor.js）・縦スクロール
 * 自動版と違うもの:
 *   - 段落に選択用チェックボックスが付く
 *   - 選択中の段落を画面下の固定領域にいつでも表示する
 *   - 選択から「関連」を作る。関連はグループごとに保持され、初期状態は 0 件
 *   - 関連を選ぶと、その関連に登録された段落だけが強調される
 *   - 関連の名前・メモ・段落を後から編集できる
 *   - JSON への書き出しと読み戻し（置換／追加）
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../core/layout'),
      require('../core/groupstate'),
      require('../core/grouping'),
      require('../core/relations'),
      require('./dom'),
      require('./styles'),
      require('./relation-styles'),
      require('./editor')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['layout', 'groupstate', 'grouping', 'relations', 'dom', 'styles', 'relationStyles', 'editor']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.relationWorkspace = factory(root.JCGC.layout, root.JCGC.groupstate, root.JCGC.grouping,
      root.JCGC.relations, root.JCGC.dom, root.JCGC.styles, root.JCGC.relationStyles, root.JCGC.editor);
  }
})(globalThis, function (layout, groupstate, grouping, relationsCore, dom, styles, relationStyles, editor) {
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
    // 関連は最初 0 件。利用者が作るまで、どの段落も関連付かない
    const relationStore = opts.relationStore || relationsCore.createRelationStore({ claims });

    const ui = {};
    let cardMeta = [];          // [{ number, segmentCount, items, checks }]
    let highlighted = [];
    let checkedElements = [];
    let lastCardsKey = '';

    // 画面状態（グループとは別に持つ）
    const view = {
      selectedRelationId: null,   // 表示中の関連（null = 関連なし）
      editingRelationId: null,    // 編集中の関連（null = 新規作成の選択中）
      selection: new Map(),       // 請求項番号 → Set<段落番号>
      draftName: '',
      draftNote: '',
      importText: '',
      importResult: null,
      showImport: false,
    };

    /* ---- 骨組み ---------------------------------------------------- */
    function buildSkeleton() {
      if (doc.documentElement && doc.documentElement.setAttribute) doc.documentElement.setAttribute('lang', 'ja');
      try { doc.title = '請求項グループ比較（段落関連 手動設定）'; } catch (e) { /* about:blank 直後は無視 */ }

      const head = doc.head || doc.documentElement;
      head.appendChild(h(doc, 'style', {
        id: 'jcgc-style',
        text: styles.WORKSPACE_CSS + '\n' + relationStyles.RELATION_CSS,
      }));
      if (!(doc.querySelector && doc.querySelector('title'))) {
        head.appendChild(h(doc, 'title', { text: '請求項グループ比較（段落関連 手動設定）' }));
      }

      const body = doc.body || doc.documentElement;
      dom.clear(body);
      body.setAttribute('class', 'jcgc-density-normal');

      ui.root = h(doc, 'div', { id: 'jcgc-app' });
      body.appendChild(ui.root);

      buildHeader();
      buildBanner();
      buildToolbar();
      buildRelationBar();

      ui.compare = h(doc, 'main', { id: 'jcgc-view-compare', class: 'jcgc-main' });
      ui.editView = h(doc, 'main', { id: 'jcgc-view-edit', class: 'jcgc-main jcgc-hidden' });
      ui.root.appendChild(ui.compare);
      ui.root.appendChild(ui.editView);

      ui.io = h(doc, 'section', { class: 'jcgcr-io jcgc-hidden', id: 'jcgcr-io' });
      ui.relationInfo = h(doc, 'section', { class: 'jcgcr-info jcgc-hidden', id: 'jcgcr-info' });
      ui.groupInfo = h(doc, 'section', { class: 'jcgc-groupinfo', id: 'jcgc-groupinfo' });
      ui.grid = h(doc, 'div', { class: 'jcgc-grid', id: 'jcgc-grid' });
      ui.spacer = h(doc, 'div', { class: 'jcgcr-spacer jcgc-hidden', id: 'jcgcr-spacer' });
      ui.compare.appendChild(ui.io);
      ui.compare.appendChild(ui.groupInfo);
      ui.compare.appendChild(ui.relationInfo);
      ui.compare.appendChild(ui.grid);
      ui.compare.appendChild(ui.spacer);

      // 選択中の段落を、スクロールしても見える固定領域に出す
      ui.tray = h(doc, 'div', { class: 'jcgcr-tray jcgc-hidden', id: 'jcgcr-tray' });
      body.appendChild(ui.tray);

      if (ui.grid.addEventListener) ui.grid.addEventListener('click', onGridClick);
      if (win && win.addEventListener) win.addEventListener('resize', debounce(applyLayout, 120));
    }

    function buildHeader() {
      const metaBits = [];
      if (meta.lappnum) metaBits.push('出願番号 ' + meta.lappnum);
      metaBits.push('全' + claims.length + '請求項');
      metaBits.push('段落関連: 手動設定');

      ui.tabCompare = h(doc, 'button', { class: 'jcgc-tab is-active', type: 'button', text: '比較' });
      ui.tabEdit = h(doc, 'button', { class: 'jcgc-tab', type: 'button', text: 'グループ編集' });
      if (ui.tabCompare.addEventListener) ui.tabCompare.addEventListener('click', () => store.setViewMode('compare'));
      if (ui.tabEdit.addEventListener) ui.tabEdit.addEventListener('click', () => store.setViewMode('edit'));

      ui.header = h(doc, 'header', { class: 'jcgc-header' }, [
        h(doc, 'div', { class: 'jcgc-header-row' }, [
          h(doc, 'h1', { class: 'jcgc-title', text: '請求項グループ比較（段落関連 手動設定）' }),
          h(doc, 'span', { class: 'jcgc-meta', text: metaBits.join('　/　') }),
          h(doc, 'nav', { class: 'jcgc-tabs' }, [ui.tabCompare, ui.tabEdit]),
        ]),
      ]);
      ui.root.appendChild(ui.header);
    }

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
        store.selectGroup((ev.target || ev.currentTarget).value);
      }, { id: 'jcgc-group-select' });

      ui.presetButtons = {};
      const presetGroup = h(doc, 'div', { class: 'jcgc-btn-group' });
      for (const key of Object.keys(grouping.PRESETS)) {
        const preset = grouping.PRESETS[key];
        const btn = dom.button(doc, preset.label, () => onPresetChange(key), {
          title: preset.description, attrs: { 'data-preset': key },
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

      ui.exportButton = dom.button(doc, 'JSONで書き出す', exportJson, { id: 'jcgcr-export' });
      ui.importButton = dom.button(doc, '読み込む', () => {
        view.showImport = !view.showImport;
        view.importResult = null;
        render();
      }, { id: 'jcgcr-import' });

      ui.toolbar = h(doc, 'div', { class: 'jcgc-toolbar' }, [
        h(doc, 'div', { class: 'jcgc-field' }, [h(doc, 'label', { text: 'グループ選択' }), ui.groupSelect]),
        ui.regroupButton,
        h(doc, 'div', { class: 'jcgc-field' }, [h(doc, 'label', { text: 'グルーピング強度' }), presetGroup]),
        h(doc, 'div', { class: 'jcgc-field' }, [h(doc, 'label', { text: '列数' }), ui.columnSelect]),
        h(doc, 'div', { class: 'jcgc-field' }, [h(doc, 'label', { text: '表示密度' }), ui.densitySelect]),
        h(doc, 'div', { class: 'jcgc-field' }, [
          h(doc, 'label', { text: '関連データ' }),
          h(doc, 'div', { class: 'jcgc-btn-group' }, [ui.exportButton, ui.importButton]),
        ]),
      ]);
      ui.root.appendChild(ui.toolbar);
    }

    function buildRelationBar() {
      ui.relationBar = h(doc, 'div', { class: 'jcgcr-bar', id: 'jcgcr-bar' });
      if (ui.relationBar.addEventListener) ui.relationBar.addEventListener('click', onRelationBarClick);
      ui.root.appendChild(ui.relationBar);
    }

    /* ---- 操作ハンドラ ----------------------------------------------- */
    function onPresetChange(key) {
      store.setPreset(key);
      applyAuto(key);
    }

    function onRegroupClick() {
      const key = store.getState().preset;
      const warn = relationStore.hasAny()
        ? '作成済みの関連は、対象のグループが作り直されると一緒に消えます。'
        : null;
      if (store.hasManualWork() || warn) {
        askConfirm(
          (warn ? warn + ' ' : '')
          + '手動で作成・編集したグループを残したまま、自動グループだけ作り直しますか。',
          '残して再実行', () => applyAuto(key)
        );
        return;
      }
      applyAuto(key);
    }

    function applyAuto(presetKey) {
      store.applyAutoGroups(regroup(presetKey), {});
      // 無くなったグループの関連は片付ける
      relationStore.dropGroups(store.getGroups().map((g) => g.id));
      resetSelection();
    }

    function onRelationBarClick(ev) {
      const target = dom.closestWithAttr(ev.target || ev.srcElement, 'data-relation', ui.relationBar);
      if (!target) return;
      const id = target.getAttribute('data-relation');
      view.selectedRelationId = id === '' ? null : id;
      view.editingRelationId = null;
      view.selection = new Map();
      render();
    }

    function onGridClick(ev) {
      const node = ev.target || ev.srcElement;
      const seg = dom.closestWithAttr(node, 'data-seg', ui.grid);
      if (!seg) return;
      const card = dom.closestWithAttr(seg, 'data-claim', ui.grid);
      if (!card) return;
      toggleParagraph(Number(card.getAttribute('data-claim')), Number(seg.getAttribute('data-seg')));
    }

    function toggleParagraph(claimNumber, paragraphIndex) {
      if (!view.selection.has(claimNumber)) view.selection.set(claimNumber, new Set());
      const set = view.selection.get(claimNumber);
      if (set.has(paragraphIndex)) set.delete(paragraphIndex);
      else set.add(paragraphIndex);
      if (!set.size) view.selection.delete(claimNumber);
      render();
    }

    function resetSelection() {
      view.selection = new Map();
      view.editingRelationId = null;
      view.draftName = '';
      view.draftNote = '';
      render();
    }

    function selectionCount() {
      let total = 0;
      view.selection.forEach((set) => { total += set.size; });
      return total;
    }

    function debounce(fn, wait) {
      let timer = null;
      return function debounced() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(); }, wait);
      };
    }

    /* ---- 関連の作成・編集 -------------------------------------------- */
    function currentGroupId() {
      const group = store.getSelectedGroup();
      return group ? group.id : null;
    }

    function createRelationFromSelection() {
      const groupId = currentGroupId();
      if (!groupId || !selectionCount()) return;
      const relation = relationStore.createRelation(groupId, {
        name: view.draftName,
        note: view.draftNote,
        selection: view.selection,
      });
      if (!relation) return;
      view.selectedRelationId = relation.id;
      resetSelection();
    }

    function startEditRelation(relationId) {
      const groupId = currentGroupId();
      const relation = relationStore.getRelation(groupId, relationId);
      if (!relation) return;
      view.editingRelationId = relationId;
      view.selectedRelationId = relationId;
      view.selection = relationsCore.itemsToSelection(relation.items);
      view.draftName = relation.name;
      view.draftNote = relation.note;
      render();
    }

    function saveEditedRelation() {
      const groupId = currentGroupId();
      if (!groupId || !view.editingRelationId) return;
      if (!selectionCount()) {
        showNotice('段落が 0 件の関連は保存できません。段落を選ぶか、関連を削除してください。');
        return;
      }
      relationStore.updateRelation(groupId, view.editingRelationId, {
        name: view.draftName,
        note: view.draftNote,
        selection: view.selection,
      });
      resetSelection();
    }

    /* ---- 書き出し・読み込み ------------------------------------------ */
    function exportPayload() {
      return relationsCore.buildExport({
        groups: store.getGroups(),
        relationStore,
        claims,
        meta,
      });
    }

    function download(filename, text, mime) {
      const blob = win && win.Blob ? new win.Blob([text], { type: mime || 'application/json' }) : null;
      const urlApi = win && win.URL ? win.URL : null;
      if (!blob || !urlApi || !urlApi.createObjectURL) {
        // 保存できない環境では、貼り付けてコピーできるように画面へ出す
        showExportFallback(text);
        return false;
      }
      const url = urlApi.createObjectURL(blob);
      const link = h(doc, 'a', { attrs: { href: url, download: filename } });
      (doc.body || doc.documentElement).appendChild(link);
      if (link.click) link.click();
      if (link.parentNode) link.parentNode.removeChild(link);
      if (win.setTimeout) win.setTimeout(() => urlApi.revokeObjectURL(url), 1000);
      return true;
    }

    function fileStem() {
      const base = meta.lappnum ? String(meta.lappnum).replace(/[\\/:*?"<>|]/g, '_') : '請求項段落関連';
      return base + '_段落関連';
    }

    function exportJson() {
      const text = JSON.stringify(exportPayload(), null, 2);
      if (download(fileStem() + '.json', text, 'application/json')) {
        showNotice('JSON を書き出しました（' + fileStem() + '.json）。');
      }
    }

    function exportText() {
      const text = relationsCore.buildTextReport(exportPayload());
      if (download(fileStem() + '.txt', text, 'text/plain')) {
        showNotice('テキストを書き出しました（閲覧用。読み戻しは JSON を使ってください）。');
      }
    }

    function showExportFallback(text) {
      view.showImport = true;
      view.importText = text;
      view.importResult = null;
      render();
      showNotice('ダウンロードできない環境のため、下の欄に内容を出しました。全選択してコピーしてください。');
    }

    function validateImportText() {
      let data = null;
      if (!String(view.importText || '').trim()) {
        view.importResult = {
          ok: false,
          errors: ['読み込む内容がありません。ファイルを選ぶか、書き出した JSON を下の欄へ貼り付けてください。'],
          unresolved: [], groups: [],
        };
        render();
        return;
      }
      try {
        data = JSON.parse(view.importText);
      } catch (e) {
        view.importResult = { ok: false, errors: ['JSON として読み取れませんでした: ' + ((e && e.message) || e)], unresolved: [], groups: [] };
        render();
        return;
      }
      view.importResult = relationsCore.validateImport(data, claims);
      render();
    }

    function applyImport(mode) {
      const result = view.importResult;
      if (!result || !result.ok) return;

      if (mode === 'replace') {
        relationStore.clear();
        // 書き出したときの属性（自動/手動の別・根拠・追加候補）をそのまま復元する。
        // 属性の無い JSON でも validateImport が既定値を補うので、グループが失われることはない。
        const groups = result.groups.map((group, index) => ({
          id: group.id || ('imported-' + (index + 1)),
          name: group.name,
          claimNumbers: group.claimNumbers,
          candidateNumbers: group.candidateNumbers || [],
          source: group.source,
          strategy: group.strategy,
          score: group.score,
          reasons: group.reasons,
          manuallyEdited: group.manuallyEdited,
          order: index + 1,
        }));
        store.applyAutoGroups(groups, { overwriteManual: true });
        result.groups.forEach((group, index) => {
          relationStore.setRelations(groups[index].id, group.relations);
        });
      } else {
        for (const group of result.groups) {
          const created = store.addGroup({ name: group.name, claimNumbers: group.claimNumbers });
          relationStore.appendRelations(created.id, group.relations);
        }
      }

      view.showImport = false;
      view.importResult = null;
      view.importText = '';
      view.selectedRelationId = null;
      resetSelection();
      showNotice(mode === 'replace' ? '読み込んだ内容で置き換えました。' : '読み込んだ内容を追加しました。');
    }

    /* ---- 描画 --------------------------------------------------------- */
    function renderGroupSelect() {
      const state = store.getState();
      dom.clear(ui.groupSelect);
      if (!state.groups.length) {
        ui.groupSelect.appendChild(h(doc, 'option', { value: '', text: 'グループがありません' }));
        return;
      }
      for (const group of state.groups) {
        const badge = group.source === 'manual' ? '手動' : (group.manuallyEdited ? '手動編集済み' : '自動');
        const count = relationStore.countRelations(group.id);
        const label = group.name + '　' + group.claimNumbers.length + '項｜'
          + formatNumbers(group.claimNumbers) + '｜' + badge
          + '｜関連' + count + '件';
        const opt = h(doc, 'option', { value: group.id, text: label });
        if (group.id === state.selectedGroupId) opt.setAttribute('selected', 'selected');
        ui.groupSelect.appendChild(opt);
      }
      if ('value' in ui.groupSelect) ui.groupSelect.value = state.selectedGroupId || '';
    }

    function renderRelationBar(groupId) {
      dom.clear(ui.relationBar);
      ui.relationBar.appendChild(h(doc, 'span', { class: 'jcgc-meta', text: '関連' }));

      const none = h(doc, 'button', {
        class: 'jcgcr-relbtn' + (view.selectedRelationId == null ? ' is-active' : ''),
        type: 'button', text: '関連なし', attrs: { 'data-relation': '' },
      });
      ui.relationBar.appendChild(none);

      const relations = groupId ? relationStore.getRelations(groupId) : [];
      for (const relation of relations) {
        const active = view.selectedRelationId === relation.id;
        const editing = view.editingRelationId === relation.id;
        ui.relationBar.appendChild(h(doc, 'button', {
          class: 'jcgcr-relbtn' + (editing ? ' is-editing' : (active ? ' is-active' : '')),
          type: 'button',
          text: relation.name + '（' + relationsCore.countParagraphs(relation) + '段落）',
          attrs: { 'data-relation': relation.id },
        }));
      }

      if (!relations.length) {
        ui.relationBar.appendChild(h(doc, 'span', {
          class: 'jcgc-note',
          text: 'まだ関連はありません。段落のチェックボックスを選んで「関連を作成」を押してください。',
        }));
      }
    }

    function renderGroupInfo(group) {
      dom.clear(ui.groupInfo);
      if (!group) return;
      const badge = group.source === 'manual' ? '手動' : (group.manuallyEdited ? '手動編集済み' : '自動');
      const head = h(doc, 'h2', {}, [
        h(doc, 'span', { text: group.name }),
        h(doc, 'span', { class: 'jcgc-badge' + (badge === '自動' ? '' : ' is-manual'), text: badge }),
        h(doc, 'span', { class: 'jcgc-badge', text: group.claimNumbers.length + '項' }),
        h(doc, 'span', { class: 'jcgc-badge', text: formatNumbers(group.claimNumbers) }),
        h(doc, 'span', { class: 'jcgc-badge', text: '関連 ' + relationStore.countRelations(group.id) + '件' }),
      ]);
      ui.groupInfo.appendChild(head);
      if (group.reasons && group.reasons.length) {
        const list = h(doc, 'ul', { class: 'jcgc-reasons' });
        for (const reason of group.reasons) list.appendChild(h(doc, 'li', { text: reason }));
        ui.groupInfo.appendChild(list);
      }
      ui.groupInfo.appendChild(h(doc, 'p', {
        class: 'jcgc-note',
        text: '請求項のグループ分けは自動です（根拠は上のとおり）。'
          + '段落の関連付けは自動推定せず、この画面で選んだものだけを保持します。',
      }));
    }

    function renderRelationInfo(groupId) {
      dom.clear(ui.relationInfo);
      const relation = view.selectedRelationId
        ? relationStore.getRelation(groupId, view.selectedRelationId) : null;
      dom.toggleClass(ui.relationInfo, 'jcgc-hidden', !relation);
      if (!relation) return;

      ui.relationInfo.appendChild(h(doc, 'h3', {}, [
        h(doc, 'span', { text: relation.name }),
        h(doc, 'span', { class: 'jcgc-badge', text: relationsCore.countParagraphs(relation) + '段落' }),
        h(doc, 'span', {
          class: 'jcgc-badge',
          text: '請求項' + relationsCore.claimNumbersOf(relation).join('・'),
        }),
      ]));
      ui.relationInfo.appendChild(h(doc, 'p', {
        class: 'jcgcr-info-list', text: relationsCore.describeRelation(relation),
      }));
      if (relation.note) {
        ui.relationInfo.appendChild(h(doc, 'p', { class: 'jcgc-note', text: 'メモ: ' + relation.note }));
      }

      const nameInput = h(doc, 'input', { class: 'jcgc-input', type: 'text', value: relation.name });
      const noteInput = h(doc, 'input', { class: 'jcgc-input', type: 'text', value: relation.note, title: '短いメモ' });
      ui.relationInfo.appendChild(h(doc, 'div', { class: 'jcgcr-info-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '関連名' }), nameInput,
        h(doc, 'span', { class: 'jcgc-editor-label', text: 'メモ' }), noteInput,
        dom.button(doc, '名前とメモを保存', () => {
          relationStore.updateRelation(groupId, relation.id, {
            name: nameInput.value, note: noteInput.value,
          });
          render();
        }),
      ]));

      ui.relationInfo.appendChild(h(doc, 'div', { class: 'jcgcr-info-row' }, [
        dom.button(doc, '関連を編集（段落を選び直す）', () => startEditRelation(relation.id),
          { class: 'jcgc-btn is-primary' }),
        dom.button(doc, '複製', () => {
          const copy = relationStore.duplicateRelation(groupId, relation.id);
          if (copy) view.selectedRelationId = copy.id;
          render();
        }),
        dom.button(doc, '削除', () => {
          askConfirm('関連「' + relation.name + '」を削除します。', '削除する', () => {
            relationStore.deleteRelation(groupId, relation.id);
            view.selectedRelationId = null;
            resetSelection();
          });
        }, { class: 'jcgc-btn is-danger' }),
      ]));
    }

    function renderIo() {
      dom.toggleClass(ui.io, 'jcgc-hidden', !view.showImport);
      if (!view.showImport) return;
      dom.clear(ui.io);
      ui.io.appendChild(h(doc, 'h3', { text: '関連データの読み込み' }));
      ui.io.appendChild(h(doc, 'p', {
        class: 'jcgc-note',
        text: '書き出した JSON を選ぶか、内容を貼り付けて「検証」を押してください。'
          + '請求項番号や段落番号が現在の文書に無い項目は、勝手に別の段落へ割り当てず未解決として表示します。',
      }));

      const file = h(doc, 'input', { type: 'file', attrs: { accept: '.json,application/json' }, id: 'jcgcr-file' });
      if (file.addEventListener) {
        file.addEventListener('change', (ev) => {
          const input = ev.target || ev.currentTarget;
          const chosen = input.files && input.files[0];
          if (!chosen || !win || !win.FileReader) return;
          const reader = new win.FileReader();
          reader.onload = () => {
            view.importText = String(reader.result || '');
            validateImportText();
          };
          reader.readAsText(chosen);
        });
      }

      const area = h(doc, 'textarea', { class: 'jcgc-textarea', id: 'jcgcr-import-text' });
      area.textContent = view.importText;
      if ('value' in area) area.value = view.importText;
      if (area.addEventListener) {
        area.addEventListener('input', (ev) => { view.importText = (ev.target || ev.currentTarget).value; });
      }

      ui.io.appendChild(h(doc, 'div', { class: 'jcgcr-io-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: 'ファイル' }), file,
        dom.button(doc, '検証', validateImportText, { class: 'jcgc-btn is-primary' }),
        dom.button(doc, 'テキストで書き出す（閲覧用）', exportText),
        dom.button(doc, '閉じる', () => { view.showImport = false; view.importResult = null; render(); }),
      ]));
      ui.io.appendChild(area);

      const result = view.importResult;
      if (!result) return;

      if (result.errors.length) {
        const errors = h(doc, 'ul', { class: 'jcgc-errors' });
        for (const message of result.errors) errors.appendChild(h(doc, 'li', { text: message }));
        ui.io.appendChild(errors);
      }
      if (result.unresolved.length) {
        ui.io.appendChild(h(doc, 'p', { class: 'jcgc-note', text: '未解決の項目（取り込みません）:' }));
        const list = h(doc, 'ul', { class: 'jcgcr-unresolved' });
        for (const message of result.unresolved) list.appendChild(h(doc, 'li', { text: message }));
        ui.io.appendChild(list);
      }
      if (result.ok) {
        const preview = h(doc, 'ul', { class: 'jcgcr-preview' });
        for (const group of result.groups) {
          preview.appendChild(h(doc, 'li', {
            text: group.name + '（請求項 ' + group.claimNumbers.join('・') + '）… 関連 '
              + group.relations.length + '件',
          }));
        }
        ui.io.appendChild(h(doc, 'p', { class: 'jcgc-note', text: '読み込める内容:' }));
        ui.io.appendChild(preview);
        ui.io.appendChild(h(doc, 'div', { class: 'jcgcr-io-row' }, [
          dom.button(doc, '現在の設定を置き換える', () => {
            askConfirm('現在のグループと関連をすべて置き換えます。', '置き換える', () => applyImport('replace'));
          }, { class: 'jcgc-btn is-danger' }),
          dom.button(doc, '現在の設定へ追加する', () => applyImport('merge'), { class: 'jcgc-btn is-primary' }),
          dom.button(doc, 'キャンセル', () => { view.importResult = null; render(); }),
        ]));
      }
    }

    /* ---- カード ------------------------------------------------------ */
    function buildCard(claim) {
      const tags = [claim.isIndependent ? '独立項' : '従属項'];
      const cite = formatCitations(claim.citations);
      if (cite) tags.push(cite);
      if (claim.categoryLabel) tags.push(claim.categoryLabel);

      const list = h(doc, 'ol', { class: 'jcgc-segs' });
      const items = [];
      const checks = [];
      for (const seg of claim.segments) {
        const check = h(doc, 'input', {
          class: 'jcgcr-check', type: 'checkbox',
          attrs: { 'data-check': String(seg.index), title: 'この段落を選ぶ' },
        });
        const li = h(doc, 'li', {
          class: 'jcgc-seg',
          attrs: { 'data-seg': String(seg.index), 'data-depth': String(Math.min(seg.depth, 3)) },
        }, [
          check,
          h(doc, 'span', { class: 'jcgc-seg-no', text: String(seg.index) }),
          h(doc, 'span', { class: 'jcgc-seg-text', text: seg.text }),
        ]);
        list.appendChild(li);
        items.push(li);
        checks.push(check);
      }

      const card = h(doc, 'article', {
        class: 'jcgc-card', attrs: { 'data-claim': String(claim.number) },
      }, [
        h(doc, 'header', { class: 'jcgc-card-head' }, [
          h(doc, 'span', { class: 'jcgc-card-no', text: '請求項' + claim.number }),
          h(doc, 'span', { class: 'jcgc-card-tags', text: tags.join('｜') }),
        ]),
        list,
      ]);

      return { card, items, checks };
    }

    function renderCards(members, force) {
      const state = store.getState();
      const key = state.selectedGroupId + '|' + members.map((c) => c.number).join(',');
      if (!force && key === lastCardsKey) return;
      lastCardsKey = key;

      dom.clear(ui.grid);
      cardMeta = [];
      highlighted = [];
      checkedElements = [];

      if (!members.length) {
        ui.grid.appendChild(h(doc, 'p', { class: 'jcgc-empty', text: 'このグループには請求項がありません。' }));
        return;
      }

      const frag = dom.fragment(doc);
      for (const claim of members) {
        const built = buildCard(claim);
        cardMeta.push({
          number: claim.number,
          segmentCount: claim.segmentCount,
          items: built.items,
          checks: built.checks,
        });
        frag.appendChild(built.card);
      }
      ui.grid.appendChild(frag);
    }

    /*
     * 表示の反映。**類似段落の計算は一切しない。**
     * 強調するのは「利用者が関連に登録した段落」だけ。
     */
    function applyHighlight(groupId) {
      for (const el of highlighted) dom.removeClass(el, 'is-selected');
      for (const el of checkedElements) dom.removeClass(el, 'is-checked');
      highlighted = [];
      checkedElements = [];

      const relation = view.selectedRelationId
        ? relationStore.getRelation(groupId, view.selectedRelationId) : null;
      const registered = relation ? relationsCore.itemsToSelection(relation.items) : new Map();

      for (const info of cardMeta) {
        const marked = registered.get(info.number);
        const picked = view.selection.get(info.number);
        info.items.forEach((el, i) => {
          const index = i + 1;
          if (marked && marked.has(index)) {
            dom.addClass(el, 'is-selected');
            highlighted.push(el);
          }
          const isChecked = !!(picked && picked.has(index));
          if (isChecked) {
            dom.addClass(el, 'is-checked');
            checkedElements.push(el);
          }
          const box = info.checks[i];
          if (box) {
            if (isChecked) box.setAttribute('checked', 'checked');
            else box.removeAttribute('checked');
            if ('checked' in box) box.checked = isChecked;
          }
        });
      }

      // 関連を表示中は、登録されていない段落を薄くする
      dom.toggleClass(ui.grid, 'is-dim', !!relation);
    }

    /* ---- 選択中バー --------------------------------------------------- */
    function renderTray() {
      const count = selectionCount();
      const editing = view.editingRelationId != null;
      const visible = count > 0 || editing;
      dom.toggleClass(ui.tray, 'jcgc-hidden', !visible);
      dom.toggleClass(ui.spacer, 'jcgc-hidden', !visible);
      if (!visible) return;

      dom.clear(ui.tray);
      const head = h(doc, 'div', { class: 'jcgcr-tray-head' }, [
        h(doc, 'span', { class: 'jcgcr-tray-count', text: count + '段落を選択中' }),
      ]);
      if (editing) {
        head.appendChild(h(doc, 'span', {
          class: 'jcgc-badge is-manual',
          text: '関連「' + view.draftName + '」を編集中',
        }));
      }

      const actions = h(doc, 'div', { class: 'jcgcr-tray-actions' });
      if (editing) {
        actions.appendChild(dom.button(doc, '保存', saveEditedRelation, { class: 'jcgc-btn is-primary' }));
        actions.appendChild(dom.button(doc, 'キャンセル', resetSelection));
      } else {
        actions.appendChild(dom.button(doc, '関連を作成', createRelationFromSelection,
          { class: 'jcgc-btn is-primary' }));
        actions.appendChild(dom.button(doc, '選択解除', resetSelection));
      }
      head.appendChild(actions);
      ui.tray.appendChild(head);

      const list = h(doc, 'ul', { class: 'jcgcr-tray-list' });
      const numbers = Array.from(view.selection.keys()).sort((a, b) => a - b);
      for (const claimNumber of numbers) {
        const indexes = Array.from(view.selection.get(claimNumber)).sort((a, b) => a - b);
        list.appendChild(h(doc, 'li', { text: '請求項' + claimNumber + '：段落' + indexes.join('、') }));
      }
      if (!numbers.length) {
        list.appendChild(h(doc, 'li', { text: '（段落が選ばれていません）' }));
      }
      ui.tray.appendChild(list);

      const nameInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'text', value: view.draftName,
        title: '関連名（空欄なら 関連1・関連2… と自動で付きます）',
      });
      if (nameInput.addEventListener) {
        nameInput.addEventListener('input', (ev) => { view.draftName = (ev.target || ev.currentTarget).value; });
      }
      const noteInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'text', value: view.draftNote, title: '短いメモ（任意）',
      });
      if (noteInput.addEventListener) {
        noteInput.addEventListener('input', (ev) => { view.draftNote = (ev.target || ev.currentTarget).value; });
      }
      ui.tray.appendChild(h(doc, 'div', { class: 'jcgcr-tray-fields' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '関連名' }), nameInput,
        h(doc, 'span', { class: 'jcgc-editor-label', text: 'メモ' }), noteInput,
      ]));
    }

    /* ---- レイアウト --------------------------------------------------- */
    function viewportWidth() {
      if (win && win.innerWidth) return win.innerWidth;
      if (doc.documentElement && doc.documentElement.clientWidth) return doc.documentElement.clientWidth;
      return 1280;
    }

    function applyStickyOffsets() {
      const heights = [ui.header, ui.toolbar, ui.relationBar].map((el) => (el && el.offsetHeight) || 0);
      if (!heights[0]) return;
      const [headerH, toolbarH, barH] = heights;
      ui.root.setAttribute('style', [
        '--jcgc-header-h:' + headerH + 'px',
        '--jcgc-toolbar-h:' + (headerH + toolbarH) + 'px',
        '--jcgc-segbar-h:' + (headerH + toolbarH + barH) + 'px',
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
    function render() {
      const state = store.getState();
      const group = store.getSelectedGroup();
      const groupId = group ? group.id : null;
      const members = group
        ? group.claimNumbers.map((n) => claimMap.get(n)).filter(Boolean)
        : [];

      // 表示中のグループに無い関連を選んだままにしない
      if (view.selectedRelationId && !relationStore.getRelation(groupId, view.selectedRelationId)) {
        view.selectedRelationId = null;
        view.editingRelationId = null;
      }

      renderGroupSelect();
      for (const key of Object.keys(ui.presetButtons)) {
        dom.toggleClass(ui.presetButtons[key], 'is-active', key === state.preset);
      }
      if ('value' in ui.columnSelect) ui.columnSelect.value = String(state.columns);
      if ('value' in ui.densitySelect) ui.densitySelect.value = String(state.density);

      dom.toggleClass(ui.tabCompare, 'is-active', state.viewMode === 'compare');
      dom.toggleClass(ui.tabEdit, 'is-active', state.viewMode === 'edit');
      dom.toggleClass(ui.compare, 'jcgc-hidden', state.viewMode !== 'compare');
      dom.toggleClass(ui.editView, 'jcgc-hidden', state.viewMode !== 'edit');
      dom.toggleClass(ui.relationBar, 'jcgc-hidden', state.viewMode !== 'compare');

      if (state.viewMode === 'compare') {
        renderIo();
        renderGroupInfo(group);
        renderRelationBar(groupId);
        renderRelationInfo(groupId);
        renderCards(members, false);
        applyHighlight(groupId);
        renderTray();
        applyLayout();
      } else {
        dom.addClass(ui.tray, 'jcgc-hidden');
        editor.render({
          doc,
          container: ui.editView,
          store,
          claims,
          askConfirm,
          showNotice,
          onRegroup: (presetKey) => applyAuto(presetKey),
        });
      }
    }

    buildSkeleton();
    store.subscribe(render);
    relationStore.subscribe(render);
    render();

    function markDetached() {
      showNotice('元のクレームチェッカーのタブが閉じられました。表示中の内容はこのまま読めますが、'
        + '関連の作成・編集や書き出しなどの操作はできません。');
    }

    return {
      store,
      relationStore,
      ui,
      view,
      render,
      applyLayout,
      applyHighlight,
      markDetached,
      exportPayload,
      // テスト・確認用
      toggleParagraph,
      createRelationFromSelection,
      startEditRelation,
      saveEditedRelation,
      resetSelection,
      selectionCount,
      setImportText(text) { view.importText = text; view.showImport = true; },
      validateImportText,
      applyImport,
      getCardMeta() { return cardMeta; },
      askConfirm,
      showNotice,
      hideBanner,
    };
  }

  return { createWorkspace, formatCitations };
});
