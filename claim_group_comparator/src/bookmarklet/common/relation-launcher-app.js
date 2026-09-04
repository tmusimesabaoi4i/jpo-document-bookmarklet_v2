/*
 * relation-launcher-app.js — 元ページ側の起動口（手動関連付け版）
 *
 * 自動関連付け版（launcher-app.js）とは別ファイル・別 ID・別ボタン文言。
 * 同じページで両方を起動しても、ボタンも比較タブも互いに干渉しない。
 *
 * やること・守ることは自動版と同じ:
 *   1. ボタンを 1 つだけ置く（多重実行しても増やさない）
 *   2. クリックイベント内で同期的に window.open（ポップアップブロック回避）
 *   3. 抽出 → 請求項の自動グルーピング → 比較ワークスペースの描画
 *   - 元ページの Checker オブジェクト・既存 DOM を書き換えない
 *   - eval・document.write・script 要素の注入を使わない
 *   - 請求項本文を外部へ送らない・外部ライブラリを読み込まない
 *
 * 違うのは、開く画面が **段落の関連を手動で設定する版** であること。
 * この版は段落の類似度計算（segmatch）を読み込まないので、内部で走ることもない。
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../../extract/extractor'),
      require('../../core/grouping'),
      require('../../view/styles'),
      require('../../view/relation-styles'),
      require('../../view/relation-workspace')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['extractor', 'grouping', 'styles', 'relationStyles', 'relationWorkspace']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.relationLauncherApp = factory(root.JCGC.extractor, root.JCGC.grouping,
      root.JCGC.styles, root.JCGC.relationStyles, root.JCGC.relationWorkspace);
  }
})(globalThis, function (extractor, grouping, styles, relationStyles, relationWorkspace) {
  'use strict';

  const LAUNCHER_ID = 'jcgcr-launcher';
  const STYLE_ID = 'jcgcr-launcher-style';
  const BUTTON_LABEL = '請求項グループ比較を開く（段落関連 手動）';

  const openWorkspaces = [];

  function readLappnum(doc, loc) {
    for (const id of ['lappnum2', 'lappnum1']) {
      const el = doc.getElementById ? doc.getElementById(id) : null;
      const value = el && (el.value || el.getAttribute('value'));
      if (value && String(value).trim() !== '') return String(value).trim();
    }
    const search = loc && loc.search ? String(loc.search) : '';
    const m = /[?&]lappnum=(\d{5,})/.exec(search);
    if (m) {
      const digits = m[1];
      if (digits.length === 11 && digits.charAt(0) === '1') {
        return '特願' + digits.slice(1, 5) + '-' + digits.slice(5);
      }
      return digits;
    }
    return '';
  }

  const SOURCE_LABELS = {
    claim_mark: 'クレーム解析結果（#claim_mark）',
    input: '入力欄のクレームテキスト',
  };

  function renderInto(win, payload) {
    const handle = relationWorkspace.createWorkspace({
      doc: win.document,
      win,
      claims: payload.claims,
      autoGroups: payload.groups,
      preset: payload.preset,
      meta: payload.meta,
      regroup(presetKey) {
        return grouping.autoGroup(payload.claims, { preset: presetKey }).groups;
      },
    });
    openWorkspaces.push(handle);
    return handle;
  }

  function renderMessage(win, message) {
    const doc = win.document;
    try { doc.title = '請求項グループ比較（段落関連 手動設定）'; } catch (e) { /* noop */ }
    const head = doc.head || doc.documentElement;
    const style = doc.createElement('style');
    style.textContent = styles.WORKSPACE_CSS + '\n' + relationStyles.RELATION_CSS;
    head.appendChild(style);
    const body = doc.body || doc.documentElement;
    while (body.firstChild) body.removeChild(body.firstChild);

    const header = doc.createElement('header');
    header.setAttribute('class', 'jcgc-header');
    const title = doc.createElement('h1');
    title.setAttribute('class', 'jcgc-title');
    title.textContent = '請求項グループ比較（段落関連 手動設定）';
    header.appendChild(title);
    body.appendChild(header);

    const main = doc.createElement('main');
    main.setAttribute('class', 'jcgc-main');
    const box = doc.createElement('p');
    box.setAttribute('class', 'jcgc-empty');
    box.textContent = message;
    main.appendChild(box);
    body.appendChild(main);
  }

  /*
   * 請求項の自動グルーピング。想定外のデータで例外が出ても全体を止めず、
   * 「全請求項」1グループの縮退状態へ落とす（段落の関連はどちらにせよ 0 件から始まる）。
   */
  function safeAutoGroup(claims, preset) {
    try {
      const auto = grouping.autoGroup(claims, { preset });
      if (auto.groups.length) return { groups: auto.groups, error: null };
      return { groups: [allClaimsGroup(claims)], error: null };
    } catch (e) {
      return { groups: [allClaimsGroup(claims)], error: (e && e.message) || String(e) };
    }
  }

  function allClaimsGroup(claims) {
    return {
      id: 'all-claims',
      name: '全請求項',
      claimNumbers: claims.map((c) => c.number),
      candidateNumbers: [],
      source: 'auto',
      strategy: 'all',
      score: null,
      reasons: ['自動グループを作れなかったため、抽出できた請求項をそのまま並べています'],
      manuallyEdited: false,
      order: 1,
    };
  }

  function setMessage(el, text) {
    if (!el) return;
    el.textContent = text || '';
  }

  function launch(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const winRef = opts.window || (typeof window !== 'undefined' ? window : null);

    const existing = doc.getElementById(LAUNCHER_ID);
    if (existing) {
      setMessage(existing.querySelector('.jcgcr-launch-msg'), '');
      const btn = existing.querySelector('button');
      if (btn && btn.focus) btn.focus();
      return { created: false, element: existing };
    }

    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = relationStyles.RELATION_LAUNCHER_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const box = doc.createElement('div');
    box.setAttribute('class', 'jcgcr-launch-box');

    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.textContent = BUTTON_LABEL;

    const message = doc.createElement('div');
    message.setAttribute('class', 'jcgcr-launch-msg');

    box.appendChild(button);
    box.appendChild(message);

    const container = doc.createElement('div');
    container.id = LAUNCHER_ID;
    container.appendChild(box);
    (doc.body || doc.documentElement).appendChild(container);

    button.addEventListener('click', function onClick() {
      setMessage(message, '');
      const win = winRef && winRef.open ? winRef.open('', '_blank') : null;
      if (!win) {
        setMessage(message, 'ポップアップがブロックされました。このサイトのポップアップを許可してから、'
          + 'もう一度ボタンを押してください。');
        return;
      }

      let result;
      try {
        result = extractor.extractClaims(doc);
      } catch (e) {
        setMessage(message, '請求項の抽出に失敗しました: ' + ((e && e.message) || e));
        renderMessage(win, '請求項の抽出に失敗しました: ' + ((e && e.message) || e));
        return;
      }

      if (!result.ok || !result.claims.length) {
        setMessage(message, result.message || extractor.NO_CLAIMS_MESSAGE);
        renderMessage(win, result.message || extractor.NO_CLAIMS_MESSAGE);
        return;
      }

      const preset = grouping.DEFAULT_PRESET;
      const auto = safeAutoGroup(result.claims, preset);
      const meta = {
        lappnum: readLappnum(doc, winRef && winRef.location),
        sourceLabel: SOURCE_LABELS[result.source] || result.source,
        title: (doc.querySelector && doc.querySelector('title')
          && String(doc.querySelector('title').textContent || '').trim()) || '',
      };

      const start = () => {
        try {
          const handle = renderInto(win, {
            claims: result.claims, groups: auto.groups, preset, meta,
          });
          if (auto.error) {
            handle.showNotice('請求項の自動グルーピングに失敗したため、全請求項を1つのグループにして'
              + '表示しています（' + auto.error + '）。グループ編集から手動でグループを作れます。');
          }
        } catch (e) {
          renderMessage(win, '比較画面の描画に失敗しました: ' + ((e && e.message) || e));
        }
      };

      if (win.document && win.document.body) start();
      else winRef.setTimeout(start, 0);

      setMessage(message, '比較タブを開きました（' + result.claims.length + '請求項 / '
        + auto.groups.length + 'グループ）。段落の関連は 0 件から始まります。');
    });

    if (winRef && winRef.addEventListener) {
      winRef.addEventListener('beforeunload', () => {
        for (const handle of openWorkspaces) {
          try { handle.markDetached(); } catch (e) { /* 既に閉じられていれば無視 */ }
        }
      });
    }

    return { created: true, element: container, button, message };
  }

  return { launch, LAUNCHER_ID, STYLE_ID, BUTTON_LABEL, readLappnum, renderMessage, safeAutoGroup };
});
