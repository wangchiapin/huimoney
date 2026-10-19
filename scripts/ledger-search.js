/* ====================================================================
   🔎 搜尋（記帳的第四個子分頁）
   可以用關鍵字（項目、備註、分類、金額）、種類（支出／收入／共同基金）、分類、日期範圍、金額範圍。
   支出、收入、共同基金的紀錄一起找；點一筆就跳到那個月、打開來修改。
   需要 ledger.js、ledger-ui.js、fund-ui.js
   ==================================================================== */

let lgSrch = { kw: '', kind: 'all', cat: 'all', from: '', to: '', min: '', max: '' };
const LG_SRCH_LIMIT = 200;

// 把三種紀錄整理成同一種格式：{ src, id, date, name, sub, color, amount, kind, signed }
function lgSearchPool() {
  const eMap = lgCatMap('expense'), iMap = lgCatMap('income');
  const pool = [];
  lg.expenses.forEach(e => {
    const cat = eMap[e.category] || lgFallbackCat(e.category);
    const fundRel = e.category === LG_FUND_CATEGORY_ID || !!e.fund;
    pool.push({ src: 'expense', id: e.id, date: e.date, name: e.item || cat.name, catName: cat.name, catKey: 'e:' + e.category, color: cat.color, amount: Number(e.price) || 0, note: e.note, kind: 'expense', fundRel, tag: lgFundTagHtml(e, true) });
  });
  lg.incomes.forEach(i => {
    const cat = iMap[i.category] || lgFallbackCat(i.category);
    pool.push({ src: 'income', id: i.id, date: i.date, name: i.item || cat.name, catName: cat.name, catKey: 'i:' + i.category, color: cat.color, amount: Number(i.amount) || 0, note: i.note, kind: 'income', fundRel: false, tag: '' });
  });
  lg.fundTxns.forEach(t => {
    const lbl = { deposit: '匯入', expense: '支出', settle: '結算領出', opening: '期初餘額' }[t.kind];
    const who = LG_WHO_LABEL[t.who] || '';
    pool.push({ src: 'fund', id: t.id, date: t.date, name: t.item || lbl, catName: `共同基金・${who}${lbl}`, catKey: 'f:', color: '#98806a', amount: t.amount, note: t.note, kind: 'fund', fundRel: true, fundKind: t.kind, tag: ' <span class="lg-tag">🏦 基金紀錄</span>' });
  });
  return pool;
}
function lgSearchFilter() {
  const q = lgSrch;
  const kw = q.kw.trim().toLowerCase();
  const min = q.min === '' ? null : Number(q.min), max = q.max === '' ? null : Number(q.max);
  return lgSearchPool().filter(r => {
    if (q.kind === 'expense' && r.kind !== 'expense') return false;
    if (q.kind === 'income' && r.kind !== 'income') return false;
    if (q.kind === 'fund' && !r.fundRel) return false;
    if (q.cat !== 'all' && r.catKey !== q.cat) return false;
    if (q.from && r.date < q.from) return false;
    if (q.to && r.date > q.to) return false;
    if (min !== null && r.amount < min) return false;
    if (max !== null && r.amount > max) return false;
    if (kw && !`${r.name} ${r.note} ${r.catName} ${r.amount}`.toLowerCase().includes(kw)) return false;
    return true;
  }).sort((a, b) => (a.date === b.date ? String(b.id).localeCompare(String(a.id)) : (a.date < b.date ? 1 : -1)));
}
function lgSearchActive() {
  const q = lgSrch;
  return q.kw.trim() !== '' || q.kind !== 'all' || q.cat !== 'all' || q.from || q.to || q.min !== '' || q.max !== '';
}

function lgSearchHtml() {
  const q = lgSrch;
  const catOpts = `<option value="all">所有分類</option>
    <optgroup label="支出分類">${lg.categories.map(c => `<option value="e:${lgEsc(c.id)}" ${q.cat === 'e:' + c.id ? 'selected' : ''}>${lgEsc(c.name)}</option>`).join('')}</optgroup>
    <optgroup label="收入分類">${lg.incomeCategories.map(c => `<option value="i:${lgEsc(c.id)}" ${q.cat === 'i:' + c.id ? 'selected' : ''}>${lgEsc(c.name)}</option>`).join('')}</optgroup>`;
  const kinds = [['all', '全部'], ['expense', '支出'], ['income', '收入'], ['fund', '🏦 共同基金']];
  return `
    <div class="lg-card lg-search-box">
      <input type="search" id="lgSrchKw" class="lg-input" placeholder="搜尋項目、備註、分類或金額，例如：咖啡" value="${lgEsc(q.kw)}" oninput="lgSrch.kw = this.value; lgSearchRun()">
      <div class="lg-seg lg-srch-kinds">${kinds.map(([v, l]) => `<button type="button" class="${q.kind === v ? 'active' : ''}" onclick="lgSrch.kind='${v}'; renderLedger()">${l}</button>`).join('')}</div>
      <div class="lg-srch-grid">
        <label>分類<select class="lg-input slim" onchange="lgSrch.cat = this.value; lgSearchRun()">${catOpts}</select></label>
        <label>從<input type="date" class="lg-input slim" value="${lgEsc(q.from)}" onchange="lgSrch.from = this.value; lgSearchRun()"></label>
        <label>到<input type="date" class="lg-input slim" value="${lgEsc(q.to)}" onchange="lgSrch.to = this.value; lgSearchRun()"></label>
        <label>金額最小<input type="number" class="lg-input slim" inputmode="decimal" value="${lgEsc(q.min)}" oninput="lgSrch.min = this.value; lgSearchRun()"></label>
        <label>金額最大<input type="number" class="lg-input slim" inputmode="decimal" value="${lgEsc(q.max)}" oninput="lgSrch.max = this.value; lgSearchRun()"></label>
      </div>
      <button type="button" class="btn btn-outline" style="margin-top:8px" onclick="lgSearchClear()">清除條件</button>
    </div>
    <div id="lgSrchOut">${lgSearchResultsHtml()}</div>`;
}
function lgSearchClear() {
  lgSrch = { kw: '', kind: 'all', cat: 'all', from: '', to: '', min: '', max: '' };
  renderLedger();
}
// 打字時只更新下面的結果，不重畫整個畫面（輸入框才不會跑掉焦點）
function lgSearchRun() {
  const out = document.getElementById('lgSrchOut');
  if (out) out.innerHTML = lgSearchResultsHtml();
}
function lgSearchResultsHtml() {
  if (!lgSearchActive()) return '<div class="lg-empty">輸入關鍵字，或選種類、分類、日期、金額，就能找到每一筆紀錄</div>';
  const res = lgSearchFilter();
  const expSum = res.filter(r => r.kind === 'expense').reduce((s, r) => s + r.amount, 0);
  const incSum = res.filter(r => r.kind === 'income').reduce((s, r) => s + r.amount, 0);
  const fundN = res.filter(r => r.kind === 'fund').length;
  const byMonth = {};
  res.filter(r => r.kind === 'expense').forEach(r => { const m = lgMonthKeyOf(r.date); byMonth[m] = (byMonth[m] || 0) + r.amount; });
  const mKeys = Object.keys(byMonth).sort();
  const maxM = Math.max(1, ...mKeys.map(m => byMonth[m]));
  const trend = mKeys.length > 1 ? `
    <div class="lg-card">
      <div class="lg-card-title">逐月支出金額</div>
      <div class="lg-bars">${mKeys.map(m => `
        <div class="lg-bar-row" data-tip="${lgEsc(`${lgMonthLabel(m).tw}|$${lgFmt(byMonth[m])}`)}">
          <span class="lg-bar-name">${lgTwYear(m.split('-')[0])}/${Number(m.split('-')[1])}</span>
          <span class="lg-bar-track"><span class="lg-bar-fill" style="width:${(byMonth[m] / maxM) * 100}%;background:${LG_C_EXP}"></span></span>
          <span class="lg-bar-val">$${lgFmt(byMonth[m])}</span>
        </div>`).join('')}</div>
    </div>` : '';
  const shown = res.slice(0, LG_SRCH_LIMIT);
  const rows = shown.map(r => `
    <div class="lg-row" data-src="${r.src}" data-id="${lgEsc(r.id)}" onclick="lgSearchOpen(this)">
      <span class="lg-dot" style="background:${lgEsc(r.color)}"></span>
      <div class="lg-row-main">
        <div class="lg-row-name">${lgEsc(r.name)}${r.tag}</div>
        <div class="lg-row-sub">${lgDateLabel(r.date)}・${lgEsc(r.catName)}${r.note ? ' · ' + lgEsc(r.note) : ''}</div>
      </div>
      <span class="lg-row-amt ${r.kind === 'income' ? 'lg-in' : ''}">$${lgFmt(r.amount)}</span>
    </div>`).join('');
  return `
    <div class="lg-search-sum">
      <span>符合 <b>${res.length}</b> 筆</span>
      ${expSum ? `<span>支出 <b>$${lgFmt(expSum)}</b></span>` : ''}
      ${incSum ? `<span>收入 <b class="lg-in">$${lgFmt(incSum)}</b></span>` : ''}
      ${fundN ? `<span>基金紀錄 <b>${fundN}</b> 筆</span>` : ''}
    </div>
    ${trend}
    <div class="lg-card lg-list" style="max-height:none">
      ${rows || '<div class="lg-empty">沒有符合的紀錄</div>'}
      ${res.length > LG_SRCH_LIMIT ? `<div class="lg-empty-sm" style="text-align:center;margin-top:8px">只顯示最新的 ${LG_SRCH_LIMIT} 筆，請再加條件縮小範圍</div>` : ''}
    </div>`;
}
// 點一筆：跳到那個月並打開修改視窗
function lgSearchOpen(el) {
  const { src, id } = el.dataset;
  if (src === 'fund') {
    const t = lg.fundTxns.find(x => x.id === id);
    if (!t) return;
    fdViewMonth = lgMonthKeyOf(t.date);
    switchAppView('fund');
    fdOpenSheet({ deposit: 'husbandDeposit', expense: 'husbandExpense', settle: 'settle', opening: 'opening' }[t.kind], id);
    return;
  }
  const it = (src === 'expense' ? lg.expenses : lg.incomes).find(x => x.id === id);
  if (!it) return;
  lgViewMonth = lgMonthKeyOf(it.date);
  lgSubTab = 'ledger';
  renderLedger();
  lgOpenSheet(src, id);
}
