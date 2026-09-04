/*
 * editor.js — グループ編集ビュー（自動生成済みのグループも後から編集できる）
 *
 * 画面幅を大きく使える別タブなので、小さなモーダルは使わず、グループ一覧の各行から
 * 開くインライン編集領域にしている。
 *
 * できること:
 *   グループ名の変更 / 請求項の追加・削除・並べ替え / 別グループへ移動・複製 /
 *   分割 / 統合 / 複製 / 削除 / 保存 / キャンセル / 直前操作の取り消し / 自動状態へ戻す /
 *   追加候補（自動で確定しなかった請求項）の昇格・除外
 *   100 請求項をドラッグ＆ドロップだけに頼らずに扱えるよう、
 *   「1,5,12,20」形式の一括編集欄と、複数グループのテキスト形式も用意する。
 *
 * 編集中の下書き（draft）は container に紐づけて保持する。ストアの通知で再描画されても
 * 入力中の内容が消えないようにするため。別タブを複数開いても互いに干渉しない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(require('./dom'));
  } else {
    root.JCGC = root.JCGC || {};
    if (!root.JCGC.dom) throw new Error('JCGC.dom が未読み込みです（連結順を確認）');
    root.JCGC.editor = factory(root.JCGC.dom);
  }
})(globalThis, function (dom) {
  'use strict';

  const h = dom.h;

  function getEditorState(container) {
    if (!container.__jcgcEditor) {
      container.__jcgcEditor = {
        editingId: null,
        draftName: '',
        draftNumbers: [],
        errors: [],
        message: '',
        searchText: '',
        mergeSelection: [],
        bulkText: '',
        dragNumber: null,
      };
    }
    return container.__jcgcEditor;
  }

  function badgeOf(group) {
    if (group.source === 'manual') return '手動';
    return group.manuallyEdited ? '手動編集済み' : '自動';
  }

  function render(ctx) {
    const doc = ctx.doc;
    const container = ctx.container;
    const store = ctx.store;
    const claims = ctx.claims;
    const state = getEditorState(container);
    const groups = store.getGroups();

    function rerender() { render(ctx); }

    function startEdit(group) {
      state.editingId = group.id;
      state.draftName = group.name;
      state.draftNumbers = group.claimNumbers.slice();
      state.errors = [];
      state.message = '';
      state.searchText = '';
      rerender();
    }

    function cancelEdit() {
      state.editingId = null;
      state.errors = [];
      state.message = '';
      rerender();
    }

    function commitDraft(group) {
      const parsed = store.parseNumberList(state.draftNumbers.join(','));
      if (parsed.errors.length) { state.errors = parsed.errors; rerender(); return false; }
      store.renameGroup(group.id, state.draftName);
      store.setGroupMembers(group.id, state.draftNumbers);
      state.errors = [];
      return true;
    }

    dom.clear(container);

    /* ---- 全体操作 -------------------------------------------------- */
    const actions = h(doc, 'section', { class: 'jcgc-section' }, [
      h(doc, 'h2', { text: 'グループ編集' }),
    ]);
    const actionRow = h(doc, 'div', { class: 'jcgc-editor-row' });
    actionRow.appendChild(dom.button(doc, '新規グループ作成', () => {
      const group = store.addGroup({ name: '新しいグループ ' + (groups.length + 1), claimNumbers: [] });
      startEdit(group);
    }, { class: 'jcgc-btn is-primary' }));

    actionRow.appendChild(dom.button(doc, '選択したグループを統合', () => {
      const ids = state.mergeSelection.filter((id) => store.getGroup(id));
      if (ids.length < 2) {
        ctx.showNotice('統合するグループを2つ以上選んでください（各行の左のチェックボックス）。');
        return;
      }
      const names = ids.map((id) => store.getGroup(id).name).join('、');
      ctx.askConfirm('次のグループを1つに統合します: ' + names, '統合する', () => {
        store.mergeGroups(ids);
        state.mergeSelection = [];
        rerender();
      });
    }));

    actionRow.appendChild(dom.button(doc, '自動グルーピング再実行', () => {
      const presetKey = store.getState().preset;
      if (store.hasManualWork()) {
        ctx.askConfirm('手動で作成・編集したグループを残したまま、自動グループを作り直します。',
          '残して再実行', () => ctx.onRegroup(presetKey, false));
        return;
      }
      ctx.onRegroup(presetKey, false);
    }));

    actionRow.appendChild(dom.button(doc, '自動生成時の状態へ戻す', () => {
      ctx.askConfirm('手動で作成・編集したグループを破棄し、自動生成時の状態へ戻します。',
        '戻す', () => { store.resetToAuto(); state.editingId = null; state.mergeSelection = []; rerender(); });
    }, { class: 'jcgc-btn is-danger' }));

    const undoBtn = dom.button(doc, '元に戻す（直前操作の取り消し）', () => {
      if (!store.undo()) ctx.showNotice('取り消せる操作がありません。');
    });
    if (!store.canUndo()) undoBtn.setAttribute('disabled', 'disabled');
    actionRow.appendChild(undoBtn);

    actions.appendChild(actionRow);
    actions.appendChild(h(doc, 'p', {
      class: 'jcgc-note',
      text: '1つの請求項を複数のグループに所属させられます。自動グルーピングを再実行しても、'
        + '手動で作成・編集したグループは確認なしに上書きしません。',
    }));
    container.appendChild(actions);

    /* ---- グループ一覧 ---------------------------------------------- */
    const list = h(doc, 'div', { class: 'jcgc-grouplist' });
    if (!groups.length) {
      list.appendChild(h(doc, 'p', { class: 'jcgc-empty', text: 'グループがありません。「新規グループ作成」から作れます。' }));
    }

    for (const group of groups) {
      const editing = state.editingId === group.id;
      const row = h(doc, 'div', { class: 'jcgc-grouprow' + (editing ? ' is-editing' : '') });

      const checkbox = h(doc, 'input', { type: 'checkbox', title: '統合対象に選ぶ' });
      if (state.mergeSelection.indexOf(group.id) !== -1) checkbox.setAttribute('checked', 'checked');
      if (checkbox.addEventListener) {
        checkbox.addEventListener('change', () => {
          const i = state.mergeSelection.indexOf(group.id);
          if (i === -1) state.mergeSelection.push(group.id);
          else state.mergeSelection.splice(i, 1);
        });
      }

      const head = h(doc, 'div', { class: 'jcgc-grouprow-head' }, [
        checkbox,
        h(doc, 'span', { class: 'jcgc-grouprow-name', text: group.name }),
        h(doc, 'span', {
          class: 'jcgc-badge' + (badgeOf(group) === '自動' ? '' : ' is-manual'),
          text: badgeOf(group),
        }),
        h(doc, 'span', {
          class: 'jcgc-grouprow-nums',
          text: group.claimNumbers.length + '項｜' + (group.claimNumbers.join('・') || '（なし）'),
        }),
      ]);
      if (group.candidateNumbers && group.candidateNumbers.length) {
        head.appendChild(h(doc, 'span', {
          class: 'jcgc-badge is-candidate',
          text: '追加候補 ' + group.candidateNumbers.join('・'),
        }));
      }

      const rowActions = h(doc, 'div', { class: 'jcgc-grouprow-actions' });
      rowActions.appendChild(dom.button(doc, '比較で開く', () => {
        store.selectGroup(group.id);
        store.setViewMode('compare');
      }));
      rowActions.appendChild(dom.button(doc, editing ? '編集中' : '編集', () => {
        if (editing) cancelEdit(); else startEdit(group);
      }, { class: 'jcgc-btn' + (editing ? ' is-active' : '') }));
      rowActions.appendChild(dom.button(doc, '複製', () => { store.duplicateGroup(group.id); }));
      rowActions.appendChild(dom.button(doc, '削除', () => {
        ctx.askConfirm('グループ「' + group.name + '」を削除します。', '削除する', () => {
          store.deleteGroup(group.id);
          if (state.editingId === group.id) state.editingId = null;
          rerender();
        });
      }, { class: 'jcgc-btn is-danger' }));
      head.appendChild(rowActions);
      row.appendChild(head);

      if (editing) row.appendChild(buildEditorPanel(group));
      list.appendChild(row);
    }
    container.appendChild(list);

    /* ---- 複数グループの一括編集 ------------------------------------ */
    const bulk = h(doc, 'section', { class: 'jcgc-section' }, [
      h(doc, 'h2', { text: '複数グループの一括編集' }),
      h(doc, 'p', {
        class: 'jcgc-note',
        text: '「# グループ名」の次の行に請求項番号をカンマ区切りで書きます。'
          + '重複・存在しない番号・書式の誤りは、置き換える前に下へ表示します。',
      }),
    ]);
    const bulkArea = h(doc, 'textarea', { class: 'jcgc-textarea', id: 'jcgc-bulk-groups' });
    bulkArea.textContent = state.bulkText || store.formatGroupsText();
    if ('value' in bulkArea) bulkArea.value = state.bulkText || store.formatGroupsText();
    if (bulkArea.addEventListener) {
      bulkArea.addEventListener('input', (ev) => {
        state.bulkText = (ev.target || ev.currentTarget).value;
      });
    }
    bulk.appendChild(bulkArea);

    const bulkErrors = h(doc, 'ul', { class: 'jcgc-errors' });
    const bulkRow = h(doc, 'div', { class: 'jcgc-editor-row' }, [
      dom.button(doc, '現在のグループを書き出す', () => {
        state.bulkText = store.formatGroupsText();
        rerender();
      }),
      dom.button(doc, 'このテキストでグループを置き換える', () => {
        const text = state.bulkText || store.formatGroupsText();
        const check = store.parseGroupsText(text);
        dom.clear(bulkErrors);
        if (check.errors.length) {
          for (const e of check.errors) bulkErrors.appendChild(h(doc, 'li', { text: e }));
          return;
        }
        ctx.askConfirm('現在のグループをすべて置き換えます（' + check.groups.length + 'グループ）。',
          '置き換える', () => {
            store.replaceGroupsFromText(text);
            state.bulkText = '';
            state.editingId = null;
            rerender();
          });
      }, { class: 'jcgc-btn is-danger' }),
    ]);
    bulk.appendChild(bulkRow);
    bulk.appendChild(bulkErrors);
    container.appendChild(bulk);

    /* ---- 1グループ分の編集領域 -------------------------------------- */
    function buildEditorPanel(group) {
      const panel = h(doc, 'div', { class: 'jcgc-editor' });

      // グループ名
      const nameInput = h(doc, 'input', { class: 'jcgc-input', type: 'text', value: state.draftName });
      if (nameInput.addEventListener) {
        nameInput.addEventListener('input', (ev) => { state.draftName = (ev.target || ev.currentTarget).value; });
      }
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: 'グループ名' }), nameInput,
      ]));

      // 所属請求項（チップ。ドラッグ＆ドロップ＋ボタンの両方で並べ替え）
      const chips = h(doc, 'div', { class: 'jcgc-chips', id: 'jcgc-chips' });
      state.draftNumbers.forEach((number, index) => {
        const chip = h(doc, 'span', {
          class: 'jcgc-chip',
          attrs: { 'data-number': String(number), draggable: 'true' },
        }, [h(doc, 'span', { text: '請求項' + number })]);

        chip.appendChild(dom.button(doc, '←', () => {
          state.draftNumbers = moveIn(state.draftNumbers, index, index - 1);
          rerender();
        }, { class: 'jcgc-chip-move', title: '前へ' }));
        chip.appendChild(dom.button(doc, '→', () => {
          state.draftNumbers = moveIn(state.draftNumbers, index, index + 1);
          rerender();
        }, { class: 'jcgc-chip-move', title: '後ろへ' }));
        chip.appendChild(dom.button(doc, '×', () => {
          state.draftNumbers = state.draftNumbers.filter((n) => n !== number);
          rerender();
        }, { class: 'jcgc-chip-x', title: 'このグループから外す' }));

        if (chip.addEventListener) {
          chip.addEventListener('dragstart', () => { state.dragNumber = number; dom.addClass(chip, 'is-dragging'); });
          chip.addEventListener('dragend', () => { state.dragNumber = null; dom.removeClass(chip, 'is-dragging'); });
          chip.addEventListener('dragover', (ev) => { if (ev.preventDefault) ev.preventDefault(); });
          chip.addEventListener('drop', (ev) => {
            if (ev.preventDefault) ev.preventDefault();
            if (state.dragNumber == null) return;
            const from = state.draftNumbers.indexOf(state.dragNumber);
            if (from === -1) return;
            state.draftNumbers = moveIn(state.draftNumbers, from, index);
            state.dragNumber = null;
            rerender();
          });
        }
        chips.appendChild(chip);
      });
      if (!state.draftNumbers.length) {
        chips.appendChild(h(doc, 'span', { class: 'jcgc-note', text: '（請求項がありません）' }));
      }
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '所属する請求項' }), chips,
      ]));

      // 一括編集欄
      const bulkInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'text', value: state.draftNumbers.join(','),
        title: '例: 1,5,12,20',
      });
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '一括編集' }),
        bulkInput,
        dom.button(doc, '反映', () => {
          const parsed = store.parseNumberList(bulkInput.value);
          state.errors = parsed.errors;
          if (!parsed.errors.length) state.draftNumbers = parsed.numbers;
          rerender();
        }),
        h(doc, 'span', { class: 'jcgc-note', text: '例: 1,5,12,20' }),
      ]));

      // 追加候補（自動グルーピングが確定しなかったもの）
      const candidates = (group.candidateNumbers || [])
        .filter((n) => state.draftNumbers.indexOf(n) === -1);
      if (candidates.length) {
        const candidateChips = h(doc, 'div', { class: 'jcgc-chips', id: 'jcgc-candidate-chips' });
        for (const number of candidates) {
          candidateChips.appendChild(h(doc, 'span', {
            class: 'jcgc-chip is-candidate',
            attrs: { 'data-candidate': String(number) },
          }, [
            h(doc, 'span', { text: '請求項' + number }),
            dom.button(doc, '昇格', () => {
              if (!commitDraft(group)) return;
              store.promoteCandidate(group.id, number);
              const fresh = store.getGroup(group.id);
              state.draftNumbers = fresh ? fresh.claimNumbers.slice() : state.draftNumbers;
              state.message = '請求項' + number + ' を正式メンバーにしました';
              rerender();
            }, { class: 'jcgc-chip-move', title: '正式メンバーにする' }),
            dom.button(doc, '×', () => {
              store.dismissCandidate(group.id, number);
              rerender();
            }, { class: 'jcgc-chip-x', title: '候補から外す' }),
          ]));
        }
        panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
          h(doc, 'span', { class: 'jcgc-editor-label', text: '追加候補' }),
          candidateChips,
          h(doc, 'span', {
            class: 'jcgc-note',
            text: 'グループの一部とだけ似ていたため、自動では確定しなかった請求項です',
          }),
        ]));
      }

      // 追加可能な請求項
      const searchInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'text', value: state.searchText,
        title: '請求項番号または本文の一部で絞り込み',
      });
      if (searchInput.addEventListener) {
        searchInput.addEventListener('input', (ev) => {
          state.searchText = (ev.target || ev.currentTarget).value;
          rerender();
        });
      }
      const pool = h(doc, 'div', { class: 'jcgc-pool' });
      const query = String(state.searchText || '').trim();
      let poolCount = 0;
      for (const claim of claims) {
        if (state.draftNumbers.indexOf(claim.number) !== -1) continue;
        if (query && String(claim.number) !== query
          && claim.rawText.indexOf(query) === -1
          && String(claim.number).indexOf(query) !== 0) continue;
        poolCount += 1;
        const chip = h(doc, 'span', { class: 'jcgc-chip' }, [
          h(doc, 'span', { text: '請求項' + claim.number }),
          dom.button(doc, '＋', () => {
            if (state.draftNumbers.indexOf(claim.number) === -1) state.draftNumbers.push(claim.number);
            rerender();
          }, { class: 'jcgc-chip-move', title: 'このグループへ追加' }),
        ]);
        pool.appendChild(chip);
      }
      if (!poolCount) pool.appendChild(h(doc, 'span', { class: 'jcgc-note', text: '該当する請求項がありません' }));
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '追加できる請求項' }),
        searchInput, pool,
      ]));

      // 別グループへ移動 / 複製
      const memberSelect = dom.select(doc,
        state.draftNumbers.map((n) => ({ value: String(n), label: '請求項' + n })), '', null);
      const targetSelect = dom.select(doc,
        store.getGroups().filter((g) => g.id !== group.id).map((g) => ({ value: g.id, label: g.name })), '', null);
      const transfer = (copy) => {
        const number = Number(memberSelect.value);
        const toId = targetSelect.value;
        if (!number || !toId) { state.errors = ['移動する請求項と移動先グループを選んでください']; rerender(); return; }
        if (!commitDraft(group)) return; // 未保存の編集を先に確定させる
        store.transferMember({ fromId: group.id, toId, number, copy });
        const fresh = store.getGroup(group.id);
        state.draftNumbers = fresh ? fresh.claimNumbers.slice() : [];
        state.message = '請求項' + number + ' を'
          + (copy ? '複製しました（元のグループにも残ります）' : '移動しました');
        rerender();
      };
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: '別グループへ' }),
        memberSelect, targetSelect,
        dom.button(doc, '移動', () => transfer(false)),
        dom.button(doc, '複製', () => transfer(true)),
        h(doc, 'span', { class: 'jcgc-note', text: '移動＝元から外す／複製＝元に残す（保存してから実行します）' }),
      ]));

      // 分割
      const splitInput = h(doc, 'input', {
        class: 'jcgc-input', type: 'number', value: String(Math.max(1, Math.ceil(state.draftNumbers.length / 2))),
      });
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        h(doc, 'span', { class: 'jcgc-editor-label', text: 'グループの分割' }),
        h(doc, 'span', { class: 'jcgc-note', text: '先頭から' }), splitInput,
        h(doc, 'span', { class: 'jcgc-note', text: '件目までを残し、残りを新しいグループにする' }),
        dom.button(doc, '分割', () => {
          if (state.draftNumbers.length < 2) { state.errors = ['2請求項以上ないと分割できません']; rerender(); return; }
          if (!commitDraft(group)) return;
          ctx.askConfirm('グループ「' + group.name + '」を2つに分割します。', '分割する', () => {
            store.splitGroup(group.id, Number(splitInput.value) || 1);
            state.editingId = null;
            rerender();
          });
        }),
      ]));

      // エラー・メッセージ
      if (state.errors.length) {
        const errors = h(doc, 'ul', { class: 'jcgc-errors' });
        for (const e of state.errors) errors.appendChild(h(doc, 'li', { text: e }));
        panel.appendChild(errors);
      }
      if (state.message) panel.appendChild(h(doc, 'p', { class: 'jcgc-ok', text: state.message }));

      // 保存・キャンセル
      panel.appendChild(h(doc, 'div', { class: 'jcgc-editor-row' }, [
        dom.button(doc, '保存', () => {
          if (!commitDraft(group)) return;
          state.editingId = null;
          state.message = '';
          rerender();
        }, { class: 'jcgc-btn is-primary' }),
        dom.button(doc, 'キャンセル', cancelEdit),
      ]));

      return panel;
    }

    return container;
  }

  function moveIn(list, from, to) {
    if (to < 0 || to >= list.length || from === to) return list.slice();
    const out = list.slice();
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
  }

  return { render, getEditorState, moveIn };
});
