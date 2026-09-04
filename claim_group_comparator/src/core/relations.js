/*
 * relations.js — 段落の「関連」の管理（手動関連付け版・DOM 非依存・純粋）
 *
 * ここでいう言葉の区別:
 *   請求項グループ … 比較対象としてまとめた複数の請求項（groupstate.js が持つ）
 *   関連           … その請求項グループの中で、対応すると **利用者が判断した** 段落の集合
 *
 * 1 つの請求項グループに、関連をいくつでも作れる。
 *   請求項グループA ├─ 関連1 ├─ 関連2 └─ 関連3
 *
 * **自動推定は一切しない。** 類似段落の推定・共通単語・文字列類似度・同じ段落番号の
 * 自動対応づけ・初期状態での自動生成は、この版には存在しない（segmatch.js を読み込まない）。
 * 初期状態はどのグループも関連 0 件で、利用者がチェックして作るまで何も関連付かない。
 *
 * 関連の形（要件どおりの汎用データ。請求項番号も段落番号も技術用語も埋め込まない）:
 *   { id, name, note, items: [ { claimNumber, paragraphIndexes: [..] } ] }
 * グループごとに保持する:
 *   { groupId, relations: [ ... ] }
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.JCGC = root.JCGC || {};
    root.JCGC.relations = factory();
  }
})(globalThis, function () {
  'use strict';

  const FORMAT = 'claim-paragraph-relations';
  const VERSION = 1;

  function uniqueSorted(numbers) {
    return Array.from(new Set(numbers.map(Number).filter((n) => Number.isFinite(n) && n > 0)))
      .sort((a, b) => a - b);
  }

  function cloneItems(items) {
    return (items || [])
      .map((item) => ({
        claimNumber: Number(item.claimNumber),
        paragraphIndexes: uniqueSorted(item.paragraphIndexes || []),
      }))
      .filter((item) => Number.isFinite(item.claimNumber) && item.paragraphIndexes.length)
      .sort((a, b) => a.claimNumber - b.claimNumber);
  }

  function cloneRelation(relation) {
    return {
      id: relation.id,
      name: relation.name,
      note: relation.note || '',
      items: cloneItems(relation.items),
    };
  }

  function countParagraphs(relation) {
    return (relation.items || []).reduce((sum, item) => sum + item.paragraphIndexes.length, 0);
  }

  function claimNumbersOf(relation) {
    return (relation.items || []).map((item) => item.claimNumber);
  }

  // 「請求項1：段落1、2 / 請求項2：段落4」形式の要約（画面にも書き出しにも使う）
  function describeRelation(relation) {
    return (relation.items || [])
      .map((item) => '請求項' + item.claimNumber + '：段落' + item.paragraphIndexes.join('、'))
      .join(' / ');
  }

  /*
   * 選択状態（Map<請求項番号, Set<段落番号>> でも配列でも可）を items へ整える
   */
  function selectionToItems(selection) {
    if (!selection) return [];
    if (Array.isArray(selection)) return cloneItems(selection);
    const items = [];
    selection.forEach((indexes, claimNumber) => {
      const list = indexes instanceof Set ? Array.from(indexes) : (indexes || []);
      if (list.length) items.push({ claimNumber: Number(claimNumber), paragraphIndexes: list });
    });
    return cloneItems(items);
  }

  function itemsToSelection(items) {
    const selection = new Map();
    for (const item of cloneItems(items)) {
      selection.set(item.claimNumber, new Set(item.paragraphIndexes));
    }
    return selection;
  }

  /* ---- ストア --------------------------------------------------------- */

  /*
   * createRelationStore({ claims })
   *   claims … 段落数の検証に使う（number と segmentCount だけ見る）
   */
  function createRelationStore(options) {
    const opts = options || {};
    const segmentCounts = new Map();
    for (const claim of opts.claims || []) {
      segmentCounts.set(claim.number, claim.segmentCount || (claim.segments || []).length || 0);
    }

    const byGroup = new Map();  // groupId → relations[]
    const listeners = [];
    let sequence = 0;

    function notify() {
      for (const fn of listeners.slice()) fn();
    }

    function listOf(groupId) {
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      return byGroup.get(groupId);
    }

    function nextId() {
      sequence += 1;
      return 'relation-' + sequence;
    }

    // 既定の関連名は「関連1」「関連2」…（グループごとに採番）
    function nextName(groupId) {
      const used = new Set(listOf(groupId).map((r) => r.name));
      let n = listOf(groupId).length + 1;
      for (;;) {
        const name = '関連' + n;
        if (!used.has(name)) return name;
        n += 1;
      }
    }

    const api = {
      FORMAT,
      VERSION,

      subscribe(fn) {
        listeners.push(fn);
        return function unsubscribe() {
          const i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        };
      },

      /* --- 参照 --- */
      getRelations(groupId) { return listOf(groupId).map(cloneRelation); },
      getRelation(groupId, relationId) {
        const found = listOf(groupId).find((r) => r.id === relationId);
        return found ? cloneRelation(found) : null;
      },
      countRelations(groupId) { return listOf(groupId).length; },
      groupIds() { return Array.from(byGroup.keys()); },
      hasAny() {
        for (const relations of byGroup.values()) if (relations.length) return true;
        return false;
      },
      // 段落数の検証（この請求項にその段落があるか）
      isValidParagraph(claimNumber, paragraphIndex) {
        const count = segmentCounts.get(Number(claimNumber));
        return count != null && paragraphIndex >= 1 && paragraphIndex <= count;
      },

      /* --- 作成・編集 --- */
      createRelation(groupId, spec) {
        const input = spec || {};
        const items = selectionToItems(input.selection || input.items);
        if (!items.length) return null;
        const relation = {
          id: nextId(),
          name: String(input.name || '').trim() || nextName(groupId),
          note: String(input.note || ''),
          items,
        };
        listOf(groupId).push(relation);
        notify();
        return cloneRelation(relation);
      },

      updateRelation(groupId, relationId, patch) {
        const relation = listOf(groupId).find((r) => r.id === relationId);
        if (!relation) return null;
        const input = patch || {};
        if (input.name != null) relation.name = String(input.name).trim() || relation.name;
        if (input.note != null) relation.note = String(input.note);
        if (input.selection || input.items) {
          const items = selectionToItems(input.selection || input.items);
          if (!items.length) return null; // 段落 0 件の関連は作らない
          relation.items = items;
        }
        notify();
        return cloneRelation(relation);
      },

      // 段落の追加（同じ段落を複数の関連へ登録してよい）
      addParagraph(groupId, relationId, claimNumber, paragraphIndex) {
        const relation = listOf(groupId).find((r) => r.id === relationId);
        if (!relation) return null;
        const selection = itemsToSelection(relation.items);
        if (!selection.has(Number(claimNumber))) selection.set(Number(claimNumber), new Set());
        selection.get(Number(claimNumber)).add(Number(paragraphIndex));
        relation.items = selectionToItems(selection);
        notify();
        return cloneRelation(relation);
      },

      removeParagraph(groupId, relationId, claimNumber, paragraphIndex) {
        const relation = listOf(groupId).find((r) => r.id === relationId);
        if (!relation) return null;
        const selection = itemsToSelection(relation.items);
        const set = selection.get(Number(claimNumber));
        if (set) {
          set.delete(Number(paragraphIndex));
          if (!set.size) selection.delete(Number(claimNumber));
        }
        const items = selectionToItems(selection);
        if (!items.length) return null; // 最後の 1 段落は消させない（削除は deleteRelation で）
        relation.items = items;
        notify();
        return cloneRelation(relation);
      },

      duplicateRelation(groupId, relationId) {
        const relation = listOf(groupId).find((r) => r.id === relationId);
        if (!relation) return null;
        const copy = {
          id: nextId(),
          name: relation.name + '（複製）',
          note: relation.note,
          items: cloneItems(relation.items),
        };
        const list = listOf(groupId);
        list.splice(list.indexOf(relation) + 1, 0, copy);
        notify();
        return cloneRelation(copy);
      },

      deleteRelation(groupId, relationId) {
        const list = listOf(groupId);
        const index = list.findIndex((r) => r.id === relationId);
        if (index === -1) return false;
        list.splice(index, 1);
        notify();
        return true;
      },

      // グループが消えたときに、その関連も片付ける
      dropGroups(keepGroupIds) {
        const keep = new Set(keepGroupIds);
        let changed = false;
        for (const groupId of Array.from(byGroup.keys())) {
          if (keep.has(groupId)) continue;
          byGroup.delete(groupId);
          changed = true;
        }
        if (changed) notify();
        return changed;
      },

      clear() {
        byGroup.clear();
        notify();
      },

      // 取り込み用（検証済みのデータを入れる）
      setRelations(groupId, relations) {
        byGroup.set(groupId, (relations || []).map((relation) => ({
          id: relation.id && !listOf(groupId).some((r) => r.id === relation.id) ? relation.id : nextId(),
          name: relation.name || nextName(groupId),
          note: relation.note || '',
          items: cloneItems(relation.items),
        })).filter((r) => r.items.length));
        notify();
      },

      appendRelations(groupId, relations) {
        const list = listOf(groupId);
        for (const relation of relations || []) {
          const items = cloneItems(relation.items);
          if (!items.length) continue;
          list.push({
            id: nextId(),
            name: relation.name || nextName(groupId),
            note: relation.note || '',
            items,
          });
        }
        notify();
      },
    };

    return api;
  }

  /* ---- 書き出し ------------------------------------------------------- */

  /*
   * buildExport({ groups, relationStore, claims, meta })
   * → 要件どおりの JSON（構造を失わず、そのまま読み戻せる形）
   *   段落の原文（paragraphTexts）は、利用者が後から中身を確かめるための参考情報。
   *   **読み戻しの自動対応づけには使わない。**
   */
  function buildExport(input) {
    const spec = input || {};
    const claims = spec.claims || [];
    const meta = spec.meta || {};
    const textOf = (claimNumber, paragraphIndex) => {
      const claim = claims.find((c) => c.number === claimNumber);
      if (!claim) return '';
      const segment = (claim.segments || [])[paragraphIndex - 1];
      return segment ? segment.text : '';
    };

    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date(spec.now || Date.now()).toISOString(),
      source: {
        title: meta.title || '書類比較・クレームチェッカー',
        applicationNumber: meta.lappnum || '',
      },
      groups: (spec.groups || []).map((group) => ({
        id: group.id,
        name: group.name,
        claimNumbers: group.claimNumbers.slice(),
        // 読み戻したときにグループがそのまま復元できるよう、
        // 表示に関わる属性（自動/手動の別・グループ化の根拠・追加候補）も一緒に持たせる。
        // 古い形式（この欄が無い JSON）でも読めるよう、読み込み側で既定値を補う。
        candidateNumbers: (group.candidateNumbers || []).slice(),
        source: group.source || 'manual',
        strategy: group.strategy || '',
        score: group.score == null ? null : group.score,
        reasons: (group.reasons || []).slice(),
        manuallyEdited: !!group.manuallyEdited,
        relations: (spec.relationStore ? spec.relationStore.getRelations(group.id) : []).map((relation) => ({
          id: relation.id,
          name: relation.name,
          note: relation.note || '',
          items: relation.items.map((item) => ({
            claimNumber: item.claimNumber,
            paragraphIndexes: item.paragraphIndexes.slice(),
            paragraphTexts: item.paragraphIndexes.map((index) => textOf(item.claimNumber, index)),
          })),
        })),
      })),
    };
  }

  // 閲覧用のテキスト出力（正式な読み戻し形式は JSON）
  function buildTextReport(payload) {
    const lines = [];
    lines.push('# 請求項グループと段落の関連');
    if (payload.source && payload.source.applicationNumber) lines.push('出願番号: ' + payload.source.applicationNumber);
    lines.push('書き出し日時: ' + payload.exportedAt);
    for (const group of payload.groups || []) {
      lines.push('');
      lines.push('## ' + group.name + '（請求項 ' + group.claimNumbers.join('・') + '）');
      if (!group.relations.length) {
        lines.push('  関連なし');
        continue;
      }
      for (const relation of group.relations) {
        lines.push('  - ' + relation.name + (relation.note ? '（' + relation.note + '）' : ''));
        for (const item of relation.items) {
          lines.push('      請求項' + item.claimNumber + '：段落' + item.paragraphIndexes.join('、'));
          (item.paragraphTexts || []).forEach((text, i) => {
            if (text) lines.push('        [' + item.paragraphIndexes[i] + '] ' + text);
          });
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  /* ---- 読み込み（検証） ------------------------------------------------ */

  /*
   * validateImport(data, claims)
   * → { ok, errors, unresolved, groups }
   *   errors     … 形式・版・必須項目の誤り（これがあると取り込めない）
   *   unresolved … 現在の文書に無い請求項・段落（勝手に別の段落へ割り当てない）
   *   groups     … 解決できた分だけを整えたもの
   *
   * **文字列類似度等による自動対応づけは一切しない。** 見つからないものは見つからないと出す。
   */
  function validateImport(data, claims) {
    const errors = [];
    const unresolved = [];
    const groups = [];

    if (!data || typeof data !== 'object') {
      return { ok: false, errors: ['JSON として読み取れませんでした'], unresolved, groups };
    }
    if (data.format !== FORMAT) {
      errors.push('対応していないファイル形式です（format: ' + JSON.stringify(data.format) + '）');
    }
    const version = Number(data.version);
    if (!Number.isFinite(version)) errors.push('version がありません');
    else if (version > VERSION) errors.push('対応していないバージョンです（version: ' + version + '）');
    if (!Array.isArray(data.groups)) errors.push('groups がありません');
    if (errors.length) return { ok: false, errors, unresolved, groups };

    const segmentCounts = new Map();
    for (const claim of claims || []) {
      segmentCounts.set(claim.number, claim.segmentCount || (claim.segments || []).length || 0);
    }

    data.groups.forEach((group, groupIndex) => {
      if (!group || typeof group !== 'object') {
        errors.push((groupIndex + 1) + '番目のグループが読み取れません');
        return;
      }
      const name = String(group.name || ('取り込んだグループ' + (groupIndex + 1)));
      const claimNumbers = [];
      for (const number of (group.claimNumbers || [])) {
        const n = Number(number);
        if (!segmentCounts.has(n)) {
          unresolved.push('請求項' + number + ' が見つかりません（グループ「' + name + '」）');
          continue;
        }
        claimNumbers.push(n);
      }

      const relations = [];
      for (const relation of (group.relations || [])) {
        if (!relation || typeof relation !== 'object') {
          errors.push('グループ「' + name + '」の関連が読み取れません');
          continue;
        }
        const relationName = String(relation.name || '関連');
        const items = [];
        for (const item of (relation.items || [])) {
          const claimNumber = Number(item && item.claimNumber);
          if (!segmentCounts.has(claimNumber)) {
            unresolved.push('請求項' + (item ? item.claimNumber : '?') + ' が見つかりません'
              + '（' + name + ' / ' + relationName + '）');
            continue;
          }
          const count = segmentCounts.get(claimNumber);
          const indexes = [];
          for (const raw of (item.paragraphIndexes || [])) {
            const index = Number(raw);
            if (!Number.isFinite(index) || index < 1 || index > count) {
              unresolved.push('請求項' + claimNumber + 'の段落' + raw + 'が見つかりません'
                + '（' + name + ' / ' + relationName + '）');
              continue;
            }
            indexes.push(index);
          }
          if (indexes.length) items.push({ claimNumber, paragraphIndexes: uniqueSorted(indexes) });
        }
        if (items.length) {
          relations.push({ id: relation.id, name: relationName, note: String(relation.note || ''), items });
        } else if ((relation.items || []).length) {
          unresolved.push('関連「' + relationName + '」は、対応する段落が現在の文書に見つかりませんでした');
        }
      }

      // 属性が無い JSON（要件の最小形式）でも読めるよう、既定値を補う
      const candidateNumbers = [];
      for (const number of (group.candidateNumbers || [])) {
        const n = Number(number);
        if (segmentCounts.has(n)) candidateNumbers.push(n);
      }
      groups.push({
        id: group.id,
        name,
        claimNumbers,
        candidateNumbers,
        source: group.source === 'auto' ? 'auto' : 'manual',
        strategy: String(group.strategy || 'imported'),
        score: typeof group.score === 'number' ? group.score : null,
        reasons: Array.isArray(group.reasons) && group.reasons.length
          ? group.reasons.map(String) : ['読み込んだファイルから復元'],
        manuallyEdited: !!group.manuallyEdited,
        relations,
      });
    });

    return { ok: errors.length === 0, errors, unresolved, groups };
  }

  return {
    FORMAT,
    VERSION,
    createRelationStore,
    buildExport,
    buildTextReport,
    validateImport,
    selectionToItems,
    itemsToSelection,
    countParagraphs,
    claimNumbersOf,
    describeRelation,
  };
});
