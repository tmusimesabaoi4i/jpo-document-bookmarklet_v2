/*
 * launcher-app.js — 元ページ（書類比較・クレームチェッカー）側の起動口
 *
 * やること:
 *   1. 淡い青のボタン「請求項グループ比較を開く」を 1 つだけ置く（多重実行しても増やさない）
 *   2. クリックイベント内で **同期的に** window.open して新しいタブを確保する
 *      （ポップアップブロック回避。抽出やグルーピングはタブ確保のあとで行う）
 *   3. 抽出 → 自動グルーピング → 比較ワークスペースの描画
 *
 * 守ること（要件 17）:
 *   - 元ページの Checker オブジェクト・既存 DOM を書き換えない。追加するのは
 *     #jcgc-launcher と #jcgc-launcher-style だけで、読むのは document のみ
 *   - 既存 ID を新しいタブへそのまま複製しない（新タブ側はすべて jcgc- 接頭辞）
 *   - eval・document.write・script 要素の注入を使わない（対象ページは CSP script-src 'self'。
 *     about:blank はその CSP を継承するため、新タブでもスクリプトは実行できない。
 *     新タブの中身は親タブの JS から DOM API だけで組み立てる）
 *   - 請求項本文を外部へ送らない・外部ライブラリを読み込まない
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory(
      require('../../extract/extractor'),
      require('../../core/grouping'),
      require('../../view/styles'),
      require('../../view/workspace')
    );
  } else {
    root.JCGC = root.JCGC || {};
    for (const dep of ['extractor', 'grouping', 'styles', 'workspace']) {
      if (!root.JCGC[dep]) throw new Error('JCGC.' + dep + ' が未読み込みです（連結順を確認）');
    }
    root.JCGC.launcherApp = factory(root.JCGC.extractor, root.JCGC.grouping,
      root.JCGC.styles, root.JCGC.workspace);
  }
})(globalThis, function (extractor, grouping, styles, workspace) {
  'use strict';

  const LAUNCHER_ID = 'jcgc-launcher';
  const STYLE_ID = 'jcgc-launcher-style';
  const BUTTON_LABEL = '請求項グループ比較を開く';

  // 開いた比較タブ。元タブを閉じるとき、各タブへ知らせるためだけに持つ
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
      // 12025557557 → 特願2025-557557（先頭 1 = 特許出願の区分）
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

  /*
   * 新しいタブへ比較ワークスペースを描く。
   * win は必ず「クリックイベント内で同期的に開いた」ウィンドウであること。
   */
  function renderInto(win, payload) {
    const doc = win.document;
    const handle = workspace.createWorkspace({
      doc,
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

  // 抽出できなかったときに、新タブへ案内だけ出す（エラーで止めない）
  function renderMessage(win, message) {
    const doc = win.document;
    try { doc.title = '請求項グループ比較'; } catch (e) { /* noop */ }
    const head = doc.head || doc.documentElement;
    const style = doc.createElement('style');
    style.textContent = styles.WORKSPACE_CSS;
    head.appendChild(style);
    const body = doc.body || doc.documentElement;
    while (body.firstChild) body.removeChild(body.firstChild);

    const header = doc.createElement('header');
    header.setAttribute('class', 'jcgc-header');
    const title = doc.createElement('h1');
    title.setAttribute('class', 'jcgc-title');
    title.textContent = '請求項グループ比較';
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
   * 自動グルーピング。想定外のデータで例外が出ても全体を止めず、
   * 「全請求項」1グループの縮退状態へ落とす。
   */
  function safeAutoGroup(claims, preset) {
    try {
      const auto = grouping.autoGroup(claims, { preset });
      if (auto.groups.length) return { groups: auto.groups, error: null };
      // グループが1つもできない案件（請求項が1件だけ等）でも、全件のグループは出す
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

  /*
   * ボタンを 1 つだけ置く。すでにあるときは作り直さない（多重実行対策）。
   */
  function launch(options) {
    const opts = options || {};
    const doc = opts.document || document;
    const winRef = opts.window || (typeof window !== 'undefined' ? window : null);

    const existing = doc.getElementById(LAUNCHER_ID);
    if (existing) {
      setMessage(existing.querySelector('.jcgc-launch-msg'), '');
      const btn = existing.querySelector('button');
      if (btn && btn.focus) btn.focus();
      return { created: false, element: existing };
    }

    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = styles.LAUNCHER_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const box = doc.createElement('div');
    box.setAttribute('class', 'jcgc-launch-box');

    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.textContent = BUTTON_LABEL;

    const message = doc.createElement('div');
    message.setAttribute('class', 'jcgc-launch-msg');

    box.appendChild(button);
    box.appendChild(message);

    const container = doc.createElement('div');
    container.id = LAUNCHER_ID;
    container.appendChild(box);
    (doc.body || doc.documentElement).appendChild(container);

    button.addEventListener('click', function onClick() {
      setMessage(message, '');
      // ここは同期的に。抽出より先にタブを確保しないとポップアップブロックに掛かる
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
      // グルーピングで想定外のデータに当たっても、抽出できた請求項は必ず見せる。
      // 失敗したときは「全請求項」1グループだけの縮退状態で開く
      const auto = safeAutoGroup(result.claims, preset);
      const meta = {
        lappnum: readLappnum(doc, winRef && winRef.location),
        sourceLabel: SOURCE_LABELS[result.source] || result.source,
      };

      const start = () => {
        try {
          const handle = renderInto(win, {
            claims: result.claims,
            groups: auto.groups,
            preset,
            meta,
          });
          if (auto.error) {
            handle.showNotice('自動グルーピングに失敗したため、全請求項を1つのグループにして表示しています（'
              + auto.error + '）。グループ編集から手動でグループを作れます。');
          }
        } catch (e) {
          renderMessage(win, '比較画面の描画に失敗しました: ' + ((e && e.message) || e));
        }
      };

      // about:blank の document は通常すぐ使えるが、念のため body ができるまで待つ
      if (win.document && win.document.body) start();
      else winRef.setTimeout(start, 0);

      setMessage(message, '比較タブを開きました（' + result.claims.length + '請求項 / '
        + auto.groups.length + 'グループ）。');
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
