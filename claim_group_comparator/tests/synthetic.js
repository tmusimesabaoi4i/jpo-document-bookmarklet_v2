'use strict';
/*
 * synthetic.js — 人工の「書類比較・クレームチェッカー」ページを組み立てるテスト用ヘルパ
 *
 * 添付の実案件だけで検証すると、その案件の請求項番号・技術用語・ツリー形状に
 * 寄りかかった実装になっていても気づけない。ここでは
 *   - 請求項番号（開始番号・欠番・並び順）
 *   - 技術分野の語彙
 *   - 独立項の数と系列ごとの請求項数
 *   - カテゴリー（未知のものを含む）
 *   - 段落数と、系列の一部にだけ入る固有段落
 * を自由に変えた人工ページを作り、抽出 → グルーピング → 描画の全体を回す。
 *
 * DOM の形（#claim_mark / CLMNM<n> / #claim_cite / zenki_wdXX / 表示用番号）は
 * 実ページに合わせてある。ここが「クレームチェッカーとの接続部分」の再現。
 */
const { parseHTML } = require('./minidom');

/* ---- 語彙（分野を丸ごと入れ替えられるようにしておく） -------------------- */
const DOMAINS = {
  mechanical: {
    actor: '搬送装置', peer: '受入装置', item: '被搬送物', prop: '搬送速度',
    unit: '搬送部', record: '搬送記録', trigger: '停止条件', group: '搬送群',
    terms: ['搬送装置', '被搬送物', '搬送速度', '搬送記録'],
  },
  chemical: {
    actor: '反応容器', peer: '回収容器', item: '第1の化合物', prop: '反応温度',
    unit: '撹拌部', record: '分析結果', trigger: '析出条件', group: '結晶群',
    terms: ['反応容器', '第1の化合物', '反応温度', '分析結果'],
  },
  medical: {
    actor: '測定機器', peer: '解析機器', item: '検体', prop: '吸光度',
    unit: '検出部', record: '測定記録', trigger: '判定条件', group: '検体群',
    terms: ['測定機器', '検体', '吸光度', '測定記録'],
  },
};

/*
 * 系列（1 つの独立項とその従属項）の構造テンプレート。
 * 段落の内容は語彙から組み立てるので、分野を変えれば語だけが総入れ替えになる。
 * offset は「系列内での相対位置」で、実際の請求項番号は呼び出し側が決める。
 */
function seriesParagraphs(v, category, kind) {
  if (kind === 'root') {
    return [
      v.actor + 'を動作させる' + category + 'であって、',
      '前記' + v.actor + 'から前記' + v.item + 'に関する' + v.prop + 'を取得することと、',
      '前記取得した' + v.prop + 'に基づいて' + v.record + 'を生成することと、',
      '前記生成した' + v.record + 'を前記' + v.peer + 'に対して送信することと、',
    ];
  }
  if (kind === 'childA') {
    return ['前記' + v.record + 'は、前記' + v.item + 'の識別子と前記' + v.prop + 'とを含む'];
  }
  if (kind === 'childB') {
    return ['前記' + v.prop + 'は、前記' + v.unit + 'により所定の周期で測定される'];
  }
  if (kind === 'grandchild') {
    return ['前記所定の周期は、前記' + v.trigger + 'が満たされたときに変更される'];
  }
  return ['前記' + v.group + 'は、前記' + v.item + 'を複数まとめたものである'];
}

/*
 * 並行する系列を作る。
 *   options.startNumbers … 各系列の先頭請求項番号（欠番・順不同でも良い）
 *   options.categories   … 各系列のカテゴリー宣言（未知の語でも良い）
 *   options.domain       … 語彙
 *   options.extraParagraphAt … この系列番号（0 始まり）の独立項にだけ固有段落を挿す
 *   options.dropChildren … この系列番号の従属項を作らない
 * 各系列は 独立項 → childA（→ grandchild）／childB という同じ形。
 */
function parallelSeries(options) {
  const opts = options || {};
  const v = DOMAINS[opts.domain || 'mechanical'];
  const starts = opts.startNumbers || [1, 10, 20];
  const categories = opts.categories || ['方法', '装置', 'プログラム'];
  const claims = [];

  starts.forEach((start, seriesIndex) => {
    const category = categories[seriesIndex % categories.length];
    const rootParagraphs = seriesParagraphs(v, category, 'root').slice();
    if (opts.extraParagraphAt === seriesIndex) {
      // この系列にだけ固有の段落を差し込む（段落番号がずれる）
      rootParagraphs.splice(1, 0, '前記' + v.actor + 'は前記' + v.unit + 'と制御部とを備え、前記制御部は、');
    }
    claims.push({ number: start, cites: [], category, paragraphs: rootParagraphs });
    if (opts.dropChildren === seriesIndex) return;
    claims.push({ number: start + 1, cites: [start], category, paragraphs: seriesParagraphs(v, category, 'childA') });
    claims.push({ number: start + 2, cites: [start + 1], category, paragraphs: seriesParagraphs(v, category, 'grandchild') });
    claims.push({ number: start + 3, cites: [start], category, paragraphs: seriesParagraphs(v, category, 'childB') });
  });

  return claims.sort((a, b) => a.number - b.number);
}

/* ---- HTML 生成（実ページの DOM に合わせる） ------------------------------ */

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 語彙の語に用語クラス（zenki_wdXX）を巻く。実ページの解析結果の再現
function decorate(text, termIndex) {
  let out = escapeHtml(text);
  for (const term of Object.keys(termIndex)) {
    const cls = termIndex[term];
    out = out.split(escapeHtml(term))
      .join('<span class="' + cls + '">' + escapeHtml(term) + '</span>');
  }
  return out;
}

/*
 * 請求項記述子の配列 → クレームチェッカーのページ HTML
 * options: { withCite: false で引用一覧を省略（本文解析のフォールバックを試す） }
 */
function toHtml(claims, options) {
  const opts = options || {};
  const termIndex = {};
  let termCounter = 1;
  for (const domain of Object.keys(DOMAINS)) {
    for (const term of DOMAINS[domain].terms) {
      if (!termIndex[term]) {
        termIndex[term] = 'zenki_wd' + String(termCounter).padStart(2, '0');
        termCounter += 1;
      }
    }
  }

  const markParts = [];
  for (const claim of claims) {
    markParts.push('<span class="showClaimNoUL" id="CLMNM' + claim.number + '"><b>【請求項 '
      + claim.number + '】</b></span><br>');
    const body = [];
    const citation = claim.cites && claim.cites.length ? citationPhrase(claim) : '';
    claim.paragraphs.forEach((paragraph, i) => {
      // 実ページと同じく、段落の頭に全角空白、随所に表示用番号のスパンが入る
      const marker = '<span id="SN' + claim.number + '-' + (i + 1)
        + '" class="showCiteCitedNoUL">[' + claim.number + '-' + (i + 1) + ']</span>';
      const text = i === 0 && citation ? citation + paragraph : paragraph;
      body.push('　' + marker + decorate(text, termIndex));
    });
    body.push('　' + escapeHtml(claim.category) + '。');
    markParts.push(body.join('') + '<br>');
  }

  const citeText = opts.withCite === false ? '' : buildCiteText(claims);

  return '<!DOCTYPE html><html lang="ja"><head><title>書類比較・クレームチェッカー</title></head><body>'
    + '<div class="p-2 border border-dark div_textarea" id="claim_mark">' + markParts.join('') + '</div>'
    + '<div class="p-2 border border-dark div_textarea" id="claim_cite">' + escapeHtml(citeText) + '</div>'
    + '<textarea id="doc1"></textarea>'
    + '</body></html>';
}

// 引用定型句（本文側）。複数引用なら「又は」で並べる
function citationPhrase(claim) {
  const numbers = claim.cites.slice().sort((a, b) => a - b);
  const listed = numbers.length === 1
    ? '請求項' + numbers[0]
    : numbers.map((n) => '請求項' + n).join('又は');
  return listed + 'に記載の' + claim.category + 'であって、';
}

// 引用一覧（#claim_cite）。実ページの書式に合わせる
function buildCiteText(claims) {
  const independents = claims.filter((c) => !c.cites || !c.cites.length).map((c) => c.number);
  const head = '合計請求項数: ' + claims.length + '  (独立請求項: ' + independents.join(',') + ')';
  const rows = claims.map((claim, i) => {
    const isIndependent = !claim.cites || !claim.cites.length;
    const parts = ['[' + (i + 1) + ']請求項' + claim.number + ' 『・・' + claim.category + '』 '
      + (isIndependent ? '独立請求項' : '従属請求項')];
    if (!isIndependent) {
      parts.push('　引用請求項: ' + claim.cites.slice().sort((a, b) => a - b).join(','));
      parts.push('　引用パターンの数: ' + claim.cites.length);
    }
    // 被引用請求項もページ同様に付ける（実装が誤って拾わないことの確認になる）
    const citedBy = claims.filter((c) => (c.cites || []).indexOf(claim.number) !== -1).map((c) => c.number);
    if (citedBy.length) parts.push('　被引用請求項: ' + citedBy.join(','));
    return parts.join('');
  });
  return head + rows.join('');
}

function buildDocument(claims, options) {
  return parseHTML(toHtml(claims, options));
}

// 抽出まで通した結果を返す（後続処理のテストはここから始める）
function extract(claims, options) {
  const extractor = require('../src/extract/extractor');
  return extractor.extractClaims(buildDocument(claims, options));
}

module.exports = { DOMAINS, parallelSeries, seriesParagraphs, toHtml, buildDocument, extract, buildCiteText };
