/*
 * groupstate.js — グループと表示状態の管理（DOM 非依存・純粋）
 *
 * 画面（view/）はこのストアを読むだけにして、再描画のたびに手動編集が失われないようにする。
 * 「後から localStorage / JSON 保存を足せる構造」という要件のため、状態は
 * toJSON() / loadJSON() で丸ごと出し入れできる素の値だけで持つ。
 *
 * グループの形:
 *   { id, name, claimNumbers, candidateNumbers, source: 'auto'|'manual', strategy, score,
 *     reasons, manuallyEdited, order }
 *   claimNumbers     … 正式メンバー
 *   candidateNumbers … 追加候補（自動では確定しなかったもの。昇格・除外は手動）
 * 1 つの請求項が複数のグループに属してよい。1 グループ 100 請求項まで。
 *
 * 自動再グルーピングの規則（要件）:
 *   source==='manual' か manuallyEdited===true のグループは、明示的な上書き指示が
 *   ないかぎり消さない・書き換えない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.groupstate = factory();
  }
})(globalThis, function () {
  'use strict';

  const MAX_GROUP_SIZE = 100;
  const HISTORY_LIMIT = 50;

  function cloneGroups(groups) {
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      claimNumbers: g.claimNumbers.slice(),
      candidateNumbers: (g.candidateNumbers || []).slice(),
      source: g.source,
      strategy: g.strategy || '',
      score: g.score == null ? null : g.score,
      reasons: (g.reasons || []).slice(),
      manuallyEdited: !!g.manuallyEdited,
      order: g.order,
    }));
  }

  function uniqueNumbers(numbers) {
    const seen = new Set();
    const out = [];
    for (const n of numbers) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }

  /*
   * 「1,5,12,20」形式の一括入力を読む。
   * → { numbers, errors, duplicates, unknown }
   */
  function parseNumberList(text, validNumbers) {
    const valid = validNumbers ? new Set(validNumbers) : null;
    const raw = String(text == null ? '' : text)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
      .split(/[^0-9]+/)
      .filter((s) => s !== '');
    const tokens = String(text == null ? '' : text).replace(/[\s　]/g, '');
    const errors = [];
    const numbers = [];
    const duplicates = [];
    const unknown = [];

    if (tokens !== '' && /[^0-9０-９,、，・\-　\s]/.test(tokens)) {
      errors.push('数字とカンマ以外の文字が含まれています: ' + tokens.replace(/[0-9０-９,、，・\-]/g, '').slice(0, 20));
    }

    for (const token of raw) {
      const n = Number(token);
      if (!Number.isFinite(n) || n <= 0) { errors.push('請求項番号として読めません: ' + token); continue; }
      if (valid && !valid.has(n)) { unknown.push(n); continue; }
      if (numbers.indexOf(n) !== -1) { duplicates.push(n); continue; }
      numbers.push(n);
    }
    if (unknown.length) errors.push('存在しない請求項番号: ' + uniqueNumbers(unknown).join('、'));
    if (duplicates.length) errors.push('重複した請求項番号: ' + uniqueNumbers(duplicates).join('、'));
    if (numbers.length > MAX_GROUP_SIZE) {
      errors.push('1グループの上限（' + MAX_GROUP_SIZE + '請求項）を超えています: ' + numbers.length);
    }
    return { numbers, errors, duplicates: uniqueNumbers(duplicates), unknown: uniqueNumbers(unknown) };
  }

  /*
   * 複数グループのテキスト形式を読む。
   *   # グループ名
   *   1,5,12,20
   */
  function parseGroupsText(text, validNumbers) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const groups = [];
    const errors = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      if (!current.claimNumbers.length) {
        errors.push('「' + current.name + '」に請求項がありません');
      } else {
        groups.push(current);
      }
      current = null;
    };

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      if (trimmed.charAt(0) === '#') {
        flush();
        current = { name: trimmed.replace(/^#+\s*/, '') || ('グループ' + (groups.length + 1)), claimNumbers: [] };
        return;
      }
      if (!current) current = { name: 'グループ' + (groups.length + 1), claimNumbers: [] };
      const parsed = parseNumberList(trimmed, validNumbers);
      for (const e of parsed.errors) errors.push((i + 1) + '行目: ' + e);
      current.claimNumbers = uniqueNumbers(current.claimNumbers.concat(parsed.numbers));
    });
    flush();

    if (!groups.length && !errors.length) errors.push('グループを1つも読み取れませんでした');
    return { groups, errors };
  }

  function formatGroupsText(groups) {
    return groups.map((g) => '# ' + g.name + '\n' + g.claimNumbers.join(',')).join('\n\n') + '\n';
  }

  /* ---- ストア --------------------------------------------------------- */

  function createStore(init) {
    const options = init || {};
    const claims = (options.claims || []).slice().sort((a, b) => a.number - b.number);
    const claimNumbers = claims.map((c) => c.number);
    const validNumbers = new Set(claimNumbers);

    let autoBaseline = cloneGroups(options.autoGroups || []);
    let sequence = 0;

    const state = {
      groups: cloneGroups(autoBaseline),
      selectedGroupId: autoBaseline.length ? autoBaseline[0].id : null,
      selectedSegment: 0, // 0 = 全体
      // どの請求項の段落を選んだか（他カードはこれに似た段落を探す）。null = グループ先頭
      selectedSourceClaim: null,
      highlightMode: 'dim', // 'dim' = 選択段落を強調 / 'only' = 選択段落のみ
      columns: 'auto',
      density: 'normal',
      preset: options.preset || 'broad',
      viewMode: 'compare', // 'compare' | 'edit'
    };

    const history = [];
    const listeners = [];

    function snapshot() {
      history.push({ groups: cloneGroups(state.groups), selectedGroupId: state.selectedGroupId });
      if (history.length > HISTORY_LIMIT) history.shift();
    }

    function notify() {
      for (const fn of listeners.slice()) fn(state);
    }

    function nextId(prefix) {
      sequence += 1;
      return (prefix || 'group') + '-' + sequence + '-' + Date.now().toString(36);
    }

    function findGroup(id) {
      return state.groups.find((g) => g.id === id) || null;
    }

    function reorder() {
      state.groups.forEach((g, i) => { g.order = i + 1; });
    }

    function markEdited(group) {
      if (group.source === 'auto') group.manuallyEdited = true;
    }

    function ensureSelection() {
      if (state.selectedGroupId && findGroup(state.selectedGroupId)) return;
      state.selectedGroupId = state.groups.length ? state.groups[0].id : null;
    }

    const api = {
      /* --- 参照 --- */
      getState() { return state; },
      getClaims() { return claims; },
      getClaimNumbers() { return claimNumbers.slice(); },
      getClaim(number) { return claims.find((c) => c.number === number) || null; },
      getGroups() { return state.groups; },
      getGroup(id) { return findGroup(id); },
      getSelectedGroup() { return findGroup(state.selectedGroupId); },
      canUndo() { return history.length > 0; },
      isValidNumber(n) { return validNumbers.has(n); },
      parseNumberList(text) { return parseNumberList(text, claimNumbers); },
      parseGroupsText(text) { return parseGroupsText(text, claimNumbers); },
      formatGroupsText(groups) { return formatGroupsText(groups || state.groups); },

      subscribe(fn) {
        listeners.push(fn);
        return function unsubscribe() {
          const i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        };
      },

      /* --- 表示状態（履歴に積まない） --- */
      selectGroup(id) {
        state.selectedGroupId = id;
        state.selectedSegment = 0;
        state.selectedSourceClaim = null;
        notify();
      },
      /*
       * 段落を選ぶ。sourceClaim を渡すと「その請求項のその段落」が基準になり、
       * 他のカードは似ている段落を探す。省略時（上部の段落ボタン）は
       * グループ先頭の請求項が基準になる。
       */
      selectSegment(index, sourceClaim) {
        state.selectedSegment = Number(index) || 0;
        state.selectedSourceClaim = state.selectedSegment
          ? (sourceClaim == null ? null : Number(sourceClaim)) : null;
        notify();
      },
      setHighlightMode(mode) { state.highlightMode = mode === 'only' ? 'only' : 'dim'; notify(); },
      setColumns(columns) { state.columns = columns; notify(); },
      setDensity(density) { state.density = density; notify(); },
      setViewMode(mode) { state.viewMode = mode === 'edit' ? 'edit' : 'compare'; notify(); },
      setPreset(preset) { state.preset = preset; notify(); },

      /* --- グループ操作（履歴に積む） --- */
      addGroup(input) {
        const spec = input || {};
        snapshot();
        const group = {
          id: nextId('manual'),
          name: spec.name || ('新しいグループ ' + (state.groups.length + 1)),
          claimNumbers: uniqueNumbers((spec.claimNumbers || []).filter((n) => validNumbers.has(n)))
            .slice(0, MAX_GROUP_SIZE),
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['手動で作成したグループ'],
          manuallyEdited: false,
          order: state.groups.length + 1,
        };
        state.groups.push(group);
        reorder();
        state.selectedGroupId = group.id;
        notify();
        return group;
      },

      renameGroup(id, name) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        group.name = String(name || '').trim() || group.name;
        markEdited(group);
        notify();
        return group;
      },

      setGroupMembers(id, numbers) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        group.claimNumbers = uniqueNumbers(numbers.filter((n) => validNumbers.has(n))).slice(0, MAX_GROUP_SIZE);
        group.candidateNumbers = group.candidateNumbers.filter((n) => group.claimNumbers.indexOf(n) === -1);
        markEdited(group);
        notify();
        return group;
      },

      addMemberToGroup(id, number) {
        const group = findGroup(id);
        if (!group || !validNumbers.has(number)) return null;
        if (group.claimNumbers.indexOf(number) !== -1) return group;
        if (group.claimNumbers.length >= MAX_GROUP_SIZE) return group;
        snapshot();
        group.claimNumbers.push(number);
        group.candidateNumbers = group.candidateNumbers.filter((n) => n !== number);
        markEdited(group);
        notify();
        return group;
      },

      removeMemberFromGroup(id, number) {
        const group = findGroup(id);
        if (!group) return null;
        const i = group.claimNumbers.indexOf(number);
        if (i === -1) return group;
        snapshot();
        group.claimNumbers.splice(i, 1);
        markEdited(group);
        notify();
        return group;
      },

      /*
       * 追加候補（自動グルーピングが「1件とだけ似ている」等で確定しなかった請求項）の操作。
       * 昇格＝正式メンバーにする、除外＝候補から落とす。どちらも手動編集として記録する。
       */
      promoteCandidate(id, number) {
        const group = findGroup(id);
        if (!group || group.candidateNumbers.indexOf(number) === -1) return null;
        if (group.claimNumbers.length >= MAX_GROUP_SIZE) return group;
        snapshot();
        group.candidateNumbers = group.candidateNumbers.filter((n) => n !== number);
        if (group.claimNumbers.indexOf(number) === -1) group.claimNumbers.push(number);
        markEdited(group);
        notify();
        return group;
      },

      dismissCandidate(id, number) {
        const group = findGroup(id);
        if (!group || group.candidateNumbers.indexOf(number) === -1) return null;
        snapshot();
        group.candidateNumbers = group.candidateNumbers.filter((n) => n !== number);
        markEdited(group);
        notify();
        return group;
      },

      moveMemberWithin(id, number, delta) {
        const group = findGroup(id);
        if (!group) return null;
        const from = group.claimNumbers.indexOf(number);
        const to = from + delta;
        if (from === -1 || to < 0 || to >= group.claimNumbers.length) return group;
        snapshot();
        group.claimNumbers.splice(from, 1);
        group.claimNumbers.splice(to, 0, number);
        markEdited(group);
        notify();
        return group;
      },

      // ドラッグ＆ドロップの着地点（index 指定の並べ替え）
      moveMemberTo(id, number, index) {
        const group = findGroup(id);
        if (!group) return null;
        const from = group.claimNumbers.indexOf(number);
        if (from === -1) return group;
        const to = Math.max(0, Math.min(index, group.claimNumbers.length - 1));
        if (from === to) return group;
        snapshot();
        group.claimNumbers.splice(from, 1);
        group.claimNumbers.splice(to, 0, number);
        markEdited(group);
        notify();
        return group;
      },

      // 別グループへ移動 / 複製
      transferMember(spec) {
        const from = findGroup(spec.fromId);
        const to = findGroup(spec.toId);
        if (!from || !to || from === to) return null;
        if (from.claimNumbers.indexOf(spec.number) === -1) return null;
        snapshot();
        if (to.claimNumbers.indexOf(spec.number) === -1 && to.claimNumbers.length < MAX_GROUP_SIZE) {
          to.claimNumbers.push(spec.number);
          markEdited(to);
        }
        if (!spec.copy) {
          from.claimNumbers.splice(from.claimNumbers.indexOf(spec.number), 1);
          markEdited(from);
        }
        notify();
        return { from, to };
      },

      splitGroup(id, index) {
        const group = findGroup(id);
        if (!group) return null;
        const at = Math.max(1, Math.min(Number(index) || 1, group.claimNumbers.length - 1));
        if (group.claimNumbers.length < 2) return null;
        snapshot();
        const tail = group.claimNumbers.slice(at);
        group.claimNumbers = group.claimNumbers.slice(0, at);
        markEdited(group);
        const created = {
          id: nextId('manual'),
          name: group.name + '（分割）',
          claimNumbers: tail,
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['「' + group.name + '」から分割'],
          manuallyEdited: false,
          order: 0,
        };
        state.groups.splice(state.groups.indexOf(group) + 1, 0, created);
        reorder();
        notify();
        return [group, created];
      },

      mergeGroups(ids, name) {
        const targets = ids.map((id) => findGroup(id)).filter(Boolean);
        if (targets.length < 2) return null;
        snapshot();
        const numbers = uniqueNumbers([].concat.apply([], targets.map((g) => g.claimNumbers)))
          .slice(0, MAX_GROUP_SIZE);
        const merged = {
          id: nextId('manual'),
          name: name || targets.map((g) => g.name).join(' + '),
          claimNumbers: numbers,
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['次のグループを統合: ' + targets.map((g) => g.name).join('、')],
          manuallyEdited: false,
          order: 0,
        };
        const firstIndex = state.groups.indexOf(targets[0]);
        state.groups = state.groups.filter((g) => targets.indexOf(g) === -1);
        state.groups.splice(Math.max(0, firstIndex), 0, merged);
        reorder();
        state.selectedGroupId = merged.id;
        notify();
        return merged;
      },

      duplicateGroup(id) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        const copy = {
          id: nextId('manual'),
          name: group.name + '（複製）',
          claimNumbers: group.claimNumbers.slice(),
          candidateNumbers: group.candidateNumbers.slice(),
          source: 'manual',
          strategy: 'manual',
          score: group.score,
          reasons: ['「' + group.name + '」の複製'],
          manuallyEdited: false,
          order: 0,
        };
        state.groups.splice(state.groups.indexOf(group) + 1, 0, copy);
        reorder();
        notify();
        return copy;
      },

      deleteGroup(id) {
        const group = findGroup(id);
        if (!group) return null;
        snapshot();
        state.groups = state.groups.filter((g) => g !== group);
        reorder();
        ensureSelection();
        notify();
        return group;
      },

      reorderGroups(ids) {
        snapshot();
        const map = new Map(state.groups.map((g) => [g.id, g]));
        const next = [];
        for (const id of ids) { if (map.has(id)) { next.push(map.get(id)); map.delete(id); } }
        for (const rest of map.values()) next.push(rest);
        state.groups = next;
        reorder();
        notify();
        return state.groups;
      },

      // 一括テキストからグループ全体を置き換える
      replaceGroupsFromText(text) {
        const parsed = parseGroupsText(text, claimNumbers);
        if (parsed.errors.length) return parsed;
        snapshot();
        state.groups = parsed.groups.map((g, i) => ({
          id: nextId('manual'),
          name: g.name,
          claimNumbers: g.claimNumbers.slice(0, MAX_GROUP_SIZE),
          candidateNumbers: [],
          source: 'manual',
          strategy: 'manual',
          score: null,
          reasons: ['一括編集で作成'],
          manuallyEdited: false,
          order: i + 1,
        }));
        ensureSelection();
        notify();
        return parsed;
      },

      /*
       * 自動グルーピングの結果を反映する。
       * overwriteManual を渡さないかぎり、手動作成・手動編集済みのグループは温存する。
       * → { added, kept, replaced }
       */
      applyAutoGroups(autoGroups, options2) {
        const opts = options2 || {};
        snapshot();
        autoBaseline = cloneGroups(autoGroups || []);
        const kept = opts.overwriteManual
          ? []
          : state.groups.filter((g) => g.source === 'manual' || g.manuallyEdited);
        const incoming = cloneGroups(autoBaseline);
        state.groups = kept.concat(incoming);
        reorder();
        ensureSelection();
        notify();
        return { added: incoming.length, kept: kept.length, replaced: !!opts.overwriteManual };
      },

      // 自動生成時の状態へ戻す（手動グループは消える。UI 側で必ず確認を取る）
      resetToAuto() {
        snapshot();
        state.groups = cloneGroups(autoBaseline);
        reorder();
        ensureSelection();
        notify();
        return state.groups;
      },

      hasManualWork() {
        return state.groups.some((g) => g.source === 'manual' || g.manuallyEdited);
      },

      undo() {
        const prev = history.pop();
        if (!prev) return false;
        state.groups = cloneGroups(prev.groups);
        state.selectedGroupId = prev.selectedGroupId;
        ensureSelection();
        notify();
        return true;
      },

      /* --- 保存・復元（将来 localStorage を足すための入口） --- */
      toJSON() {
        return {
          version: 1,
          preset: state.preset,
          columns: state.columns,
          density: state.density,
          highlightMode: state.highlightMode,
          selectedGroupId: state.selectedGroupId,
          selectedSegment: state.selectedSegment,
          selectedSourceClaim: state.selectedSourceClaim,
          groups: cloneGroups(state.groups),
          autoBaseline: cloneGroups(autoBaseline),
        };
      },

      loadJSON(data) {
        if (!data || !data.groups) return false;
        snapshot();
        state.groups = cloneGroups(data.groups);
        if (data.autoBaseline) autoBaseline = cloneGroups(data.autoBaseline);
        if (data.preset) state.preset = data.preset;
        if (data.columns) state.columns = data.columns;
        if (data.density) state.density = data.density;
        if (data.highlightMode) state.highlightMode = data.highlightMode;
        state.selectedSegment = Number(data.selectedSegment) || 0;
        state.selectedSourceClaim = data.selectedSourceClaim == null ? null : Number(data.selectedSourceClaim);
        state.selectedGroupId = data.selectedGroupId || null;
        reorder();
        ensureSelection();
        notify();
        return true;
      },
    };

    ensureSelection();
    return api;
  }

  return { createStore, parseNumberList, parseGroupsText, formatGroupsText, MAX_GROUP_SIZE };
});
