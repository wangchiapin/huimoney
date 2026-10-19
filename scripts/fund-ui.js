/* ====================================================================
   🏦 共同基金（畫面）：虛擬帳戶，兩個數字、欠款、本月明細、結算
   - 算帳在 ledger.js 的 lgFundSummary / lgFundEntries
   - 老婆的匯入＝記帳裡分類「共同基金」的支出（同一筆，這裡改、那邊跟著變）
   - 老公的匯入、支出、結算、期初餘額：只記在這裡（fundTxns）
   - 這個分頁不會出現在財務總覽／資產總覽
   需要 ledger.js、ledger-ui.js（共用彈出視窗與樣式）
   ==================================================================== */

let fdViewMonth = lgMonthKeyOf(lgTodayISO());
let fdSheet = null;          // { kind, src, id, from }
let fdConfirmKey = '';
let fdConfirmTimer = null;

function fdIsVisible() {
  const el = document.getElementById('fundView');
  return !!el && el.style.display !== 'none';
}
function showFund() { renderFund(); }
function lgAfterLedgerChange() { if (fdIsVisible()) renderFund(); }
// 雲端資料換進來時，記帳畫面和基金畫面都要重畫
(function () {
  const prev = typeof lgOnDataReplaced === 'function' ? lgOnDataReplaced : null;
  window.lgOnDataReplaced = function () { if (prev) prev(); if (fdIsVisible()) renderFund(); };
})();

const FD_KIND_LABEL = { deposit: '匯入', expense: '支出', settle: '結算領出', opening: '期初餘額' };

function renderFund() {
  const root = document.getElementById('fundContent');
  if (!root) return;
  const sm = fdSummary();
  const { tw, greg } = lgMonthLabel(fdViewMonth);
  root.innerHTML = `
    <div class="lg-top">
      <div class="lg-month-nav">
        <button type="button" class="lg-icon-btn" onclick="fdShiftView(-1)" aria-label="上個月">‹</button>
        <button type="button" class="lg-month-btn" onclick="fdPickMonth()"><b>${tw}</b><small>${greg}</small></button>
        <button type="button" class="lg-icon-btn" onclick="fdShiftView(1)" aria-label="下個月">›</button>
      </div>
      <div class="lg-fund-title">🏦 共同基金 <small>（虛擬帳戶，不算進財務總覽／資產總覽）</small></div>
    </div>
    <div class="lg-kpis">
      <div class="lg-kpi"><div class="lg-kpi-label">帳戶實際餘額</div><div class="lg-kpi-value">$${lgFmt(sm.balance)}</div></div>
      <div class="lg-kpi"><div class="lg-kpi-label">欠老婆</div><div class="lg-kpi-value ${sm.owedWife ? 'lg-out' : 'lg-dim'}">$${lgFmt(sm.owedWife)}</div></div>
      <div class="lg-kpi"><div class="lg-kpi-label">欠老公</div><div class="lg-kpi-value ${sm.owedHusband ? 'lg-out' : 'lg-dim'}">$${lgFmt(sm.owedHusband)}</div></div>
      <div class="lg-kpi lg-kpi-main"><div class="lg-kpi-label">扣掉欠款後可用</div><div class="lg-kpi-value ${sm.available >= 0 ? 'lg-in' : 'lg-out'}">${sm.available >= 0 ? '' : '－'}$${lgFmt(Math.abs(sm.available))}</div></div>
    </div>
    <div class="lg-card lg-fund-actions">
      <button type="button" class="lg-add-btn in" onclick="fdOpenSheet('wifeDeposit')">＋ 老婆匯入</button>
      <button type="button" class="lg-add-btn in" onclick="fdOpenSheet('husbandDeposit')">＋ 老公匯入</button>
      <button type="button" class="lg-add-btn out" onclick="fdOpenSheet('husbandExpense')">＋ 老公支出／墊錢</button>
      <button type="button" class="lg-add-btn settle" onclick="fdOpenSheet('settle')">🤝 結算</button>
      <button type="button" class="lg-add-btn plain" onclick="fdOpenSheet('opening')">期初餘額</button>
    </div>
    <div class="lg-hint" style="margin:0 2px 12px">老婆的基金支出請在 📒 記帳 新增（選「共同基金的支出」，選分類「共同基金」＝匯入）。這裡的老婆匯入和記帳是同一筆，改哪邊都會同步。</div>
    ${fdListHtml()}`;
}
function fdSummary() { return lgFundSummary(); }
function fdShiftView(d) { fdViewMonth = lgShiftMonth(fdViewMonth, d); fdConfirmKey = ''; renderFund(); }

/* ---------- 本月明細 ---------- */
function fdListHtml() {
  const all = lgFundEntries();
  const items = all.filter(x => lgMonthKeyOf(x.date) === fdViewMonth);
  let inSum = 0, outSum = 0, settleSum = 0;
  items.forEach(x => {
    if (x.kind === 'deposit' || x.kind === 'opening') inSum += x.amount;
    else if (x.kind === 'settle') settleSum += x.amount;
    else if (x.kind === 'expense') outSum += x.amount;
  });
  const byDate = {};
  items.forEach(x => { (byDate[x.date] = byDate[x.date] || []).push(x); });
  const dates = Object.keys(byDate).sort().reverse();
  const groups = dates.map(d => `
    <div class="lg-day">
      <div class="lg-day-head"><span>${lgDateLabel(d)}</span></div>
      ${byDate[d].map(fdRowHtml).join('')}
    </div>`).join('');
  return `
    <div class="lg-card lg-list">
      <div class="lg-card-head"><div class="lg-card-title">本月明細</div>
        <div class="lg-day-sub">匯入 <b class="lg-in">$${lgFmt(inSum)}</b>　支出 <b>$${lgFmt(outSum)}</b>　結算領出 <b>$${lgFmt(settleSum)}</b></div>
      </div>
      ${groups || '<div class="lg-empty">這個月還沒有基金紀錄</div>'}
    </div>`;
}
function fdRowHtml(x) {
  const who = LG_WHO_LABEL[x.who] || '';
  let name = x.item || FD_KIND_LABEL[x.kind];
  let sub = '', color = '#98806a', amtCls = '', sign = '';
  if (x.kind === 'deposit') { sub = `${who}匯入`; color = '#4a8a5a'; amtCls = 'lg-in'; sign = '+'; }
  else if (x.kind === 'opening') { sub = '期初餘額'; color = '#4a8a5a'; amtCls = 'lg-in'; sign = '+'; }
  else if (x.kind === 'settle') { sub = `${who}結算領出`; color = '#b5846a'; sign = '－'; }
  else { sub = `${who}${x.from === 'self' ? '先墊（基金欠' + who + '）' : '・基金帳戶直接付'}`; color = '#b5424d'; sign = x.from === 'self' ? '' : '－'; }
  if (x.note) sub += ' · ' + x.note;
  const key = x.src + ':' + x.id;
  const link = x.src === 'ledger' ? '<span class="lg-tag">📒 記帳</span>' : '';
  return `
    <div class="lg-row" data-src="${x.src}" data-id="${lgEsc(x.id)}" data-kind="${x.kind}" onclick="fdRowClick(this)">
      <span class="lg-dot" style="background:${color}"></span>
      <div class="lg-row-main">
        <div class="lg-row-name">${lgEsc(name)} ${link}</div>
        <div class="lg-row-sub">${lgEsc(sub)}</div>
      </div>
      <span class="lg-row-amt ${amtCls}">${sign}$${lgFmt(x.amount)}</span>
      ${fdConfirmKey === key
        ? `<button type="button" class="lg-del-confirm" onclick="event.stopPropagation(); fdDoDelete(this.parentNode)">🗑 確定</button>`
        : `<button type="button" class="lg-del" onclick="event.stopPropagation(); fdAskDelete(this.parentNode)" aria-label="刪除">🗑</button>`}
    </div>`;
}
function fdRowClick(el) {
  if (fdConfirmKey) { fdConfirmKey = ''; renderFund(); return; }
  const { src, id, kind } = el.dataset;
  if (src === 'ledger') {
    if (kind === 'deposit') fdOpenSheet('wifeDeposit', id);
    else lgOpenSheet('expense', id);           // 老婆的基金支出：用記帳的視窗改
    return;
  }
  const t = lg.fundTxns.find(x => x.id === id);
  if (!t) return;
  const map = { deposit: 'husbandDeposit', expense: 'husbandExpense', settle: 'settle', opening: 'opening' };
  fdOpenSheet(map[t.kind], id);
}
function fdAskDelete(el) {
  fdConfirmKey = el.dataset.src + ':' + el.dataset.id;
  clearTimeout(fdConfirmTimer);
  fdConfirmTimer = setTimeout(() => { if (fdConfirmKey) { fdConfirmKey = ''; if (fdIsVisible()) renderFund(); } }, 4000);
  renderFund();
}
function fdDoDelete(el) {
  const { src, id } = el.dataset;
  fdConfirmKey = '';
  if (src === 'ledger') lgDeleteExpense(id); else lgDeleteFundTxn(id);
  renderFund();
}

/* ---------- 月份選擇（沿用記帳的選月視窗，選完回到基金畫面） ---------- */
function fdPickMonth() {
  lgPickYear = lgTwYear(fdViewMonth.split('-')[0]);
  fdRenderMonthPicker();
}
function fdRenderMonthPicker() {
  const cells = Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
    const mk = `${lgPickYear + 1911}-${String(m).padStart(2, '0')}`;
    return `<button type="button" class="lg-pick-cell ${mk === fdViewMonth ? 'active' : ''}" data-month="${mk}" onclick="fdSetMonth(this.dataset.month)">${m}月</button>`;
  }).join('');
  lgOverlayRoot().innerHTML = `
    <div class="lg-overlay center" onclick="lgCloseOverlay()">
      <div class="lg-sheet small" onclick="event.stopPropagation()">
        <div class="lg-pick-head">
          <button type="button" class="lg-icon-btn" onclick="lgPickYear--; fdRenderMonthPicker()">‹</button>
          <b>民國 ${lgPickYear} 年</b>
          <button type="button" class="lg-icon-btn" onclick="lgPickYear++; fdRenderMonthPicker()">›</button>
        </div>
        <div class="lg-pick-grid">${cells}</div>
        <button type="button" class="btn btn-outline lg-pick-today" onclick="fdSetMonth(lgMonthKeyOf(lgTodayISO()))">回到本月</button>
      </div>
    </div>`;
}
function fdSetMonth(mk) { fdViewMonth = mk; lgCloseOverlay(); renderFund(); }

/* ====================================================================
   新增／修改視窗
   kind：wifeDeposit 老婆匯入（存成記帳的「共同基金」支出）、husbandDeposit 老公匯入、
         husbandExpense 老公支出／墊錢、settle 結算、opening 期初餘額
   ==================================================================== */
function fdOpenSheet(kind, id) {
  let ex = null;
  if (id) {
    ex = kind === 'wifeDeposit' ? lg.expenses.find(e => e.id === id) : lg.fundTxns.find(t => t.id === id);
    if (!ex) return;
  }
  const today = lgTodayISO();
  const date = ex ? ex.date : (lgMonthKeyOf(today) === fdViewMonth ? today : `${fdViewMonth}-01`);
  const amount = ex ? (kind === 'wifeDeposit' ? ex.price : ex.amount) : '';
  const sm = lgFundSummary();
  fdSheet = { kind, id: id || '', who: ex && ex.who ? ex.who : 'wife', from: ex && ex.from ? ex.from : 'fund' };
  const titles = { wifeDeposit: '老婆匯入共同基金', husbandDeposit: '老公匯入共同基金', husbandExpense: '老公的支出／墊錢', settle: '結算：從基金拿錢出來', opening: '期初餘額（基金目前已經有的錢）' };
  const itemPh = { wifeDeposit: '共同基金匯入', husbandDeposit: '例如：10月匯入', husbandExpense: '例如：超市、瓦斯費', settle: '', opening: '' }[kind];
  const defaultItem = ex ? ex.item : (kind === 'wifeDeposit' ? '共同基金匯入' : '');
  const showItem = kind !== 'settle' && kind !== 'opening';
  let extra = '';
  if (kind === 'husbandExpense') {
    extra = `
      <label class="lg-label">錢從哪來</label>
      <div class="lg-seg" id="fdFromSeg"></div>
      <div class="lg-fund-hint">「個人先墊」＝基金欠老公這筆錢，之後結算；「基金帳戶直接付」＝直接從基金餘額扣。</div>`;
  } else if (kind === 'settle') {
    extra = `
      <label class="lg-label">誰從基金拿錢</label>
      <div class="lg-seg" id="fdWhoSeg"></div>
      <div class="lg-fund-hint" id="fdSettleHint"></div>`;
  }
  lgOverlayRoot().innerHTML = `
    <div class="lg-overlay" onclick="lgCloseOverlay()">
      <div class="lg-sheet" onclick="event.stopPropagation()">
        <div class="lg-sheet-head"><h3>${titles[kind]}</h3><button type="button" class="lg-x" onclick="lgCloseOverlay()" aria-label="關閉">✕</button></div>
        <label class="lg-label">日期</label>
        <input type="date" id="fdFDate" class="lg-input" value="${lgEsc(date)}">
        ${showItem ? `<label class="lg-label">項目${kind === 'husbandExpense' ? '' : '（選填）'}</label>
        <input type="text" id="fdFItem" class="lg-input" placeholder="${lgEsc(itemPh)}" value="${lgEsc(defaultItem)}">` : ''}
        ${extra}
        <label class="lg-label">金額</label>
        <input type="number" id="fdFAmount" class="lg-input lg-amount-input" inputmode="decimal" step="any" min="0" placeholder="0" value="${amount === '' ? '' : lgEsc(amount)}">
        <label class="lg-label">備註（選填）</label>
        <input type="text" id="fdFNote" class="lg-input" value="${lgEsc(ex ? ex.note : '')}">
        ${kind === 'wifeDeposit' ? '<div class="lg-fund-hint">這筆會同時出現在 📒 記帳的支出（分類：共同基金）。</div>' : ''}
        <button type="button" class="lg-submit ${kind === 'husbandExpense' ? 'out' : 'in'}" onclick="fdSubmitSheet()">${ex ? '更新' : '記下來'}</button>
      </div>
    </div>`;
  if (kind === 'husbandExpense') fdRenderFromSeg();
  if (kind === 'settle') { fdRenderWhoSeg(); fdSettleHintUpdate(!ex); }
  ['fdFItem', 'fdFAmount', 'fdFNote'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') fdSubmitSheet(); });
  });
}
function fdRenderFromSeg() {
  const seg = document.getElementById('fdFromSeg');
  if (!seg || !fdSheet) return;
  seg.innerHTML = [['fund', '基金帳戶直接付'], ['self', '個人先墊']].map(([v, l]) =>
    `<button type="button" class="${fdSheet.from === v ? 'active' : ''}" onclick="fdSheet.from='${v}'; fdRenderFromSeg()">${l}</button>`).join('');
}
function fdRenderWhoSeg() {
  const seg = document.getElementById('fdWhoSeg');
  if (!seg || !fdSheet) return;
  seg.innerHTML = [['wife', '老婆'], ['husband', '老公']].map(([v, l]) =>
    `<button type="button" class="${fdSheet.who === v ? 'active' : ''}" onclick="fdSheet.who='${v}'; fdRenderWhoSeg(); fdSettleHintUpdate(true)">${l}</button>`).join('');
}
// 結算視窗：顯示目前欠這個人多少，新增時順便把金額預設填成欠款
function fdSettleHintUpdate(fillAmount) {
  const sm = lgFundSummary();
  const owed = fdSheet.who === 'husband' ? sm.owedHusband : sm.owedWife;
  const hint = document.getElementById('fdSettleHint');
  if (hint) hint.textContent = `目前基金欠${LG_WHO_LABEL[fdSheet.who]} $${lgFmt(owed)}。可以只結算一部分；結算的金額會從基金餘額扣掉，也會先抵掉欠款。`;
  const amt = document.getElementById('fdFAmount');
  if (fillAmount && amt && !fdSheet.id) amt.value = owed > 0 ? owed : '';
}
function fdSubmitSheet() {
  if (!fdSheet) return;
  const { kind, id } = fdSheet;
  const date = document.getElementById('fdFDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { lgToast('請選擇日期', 'error'); return; }
  const num = Number(document.getElementById('fdFAmount').value);
  if (!isFinite(num) || num <= 0) { lgToast('金額要大於 0', 'error'); return; }
  const itemEl = document.getElementById('fdFItem');
  const item = itemEl ? itemEl.value.trim() : '';
  const note = document.getElementById('fdFNote').value.trim();
  if (kind === 'husbandExpense' && !item) { lgToast('請填項目', 'error'); return; }

  if (kind === 'wifeDeposit') {
    const e = { date, category: LG_FUND_CATEGORY_ID, item: item || '共同基金匯入', price: num, note, fund: null };
    if (id) lgUpdateExpense(id, e); else lgAddExpense(e);
  } else {
    const t = { date, amount: num, note, item };
    if (kind === 'husbandDeposit') Object.assign(t, { kind: 'deposit', who: 'husband', from: '' });
    else if (kind === 'husbandExpense') Object.assign(t, { kind: 'expense', who: 'husband', from: fdSheet.from });
    else if (kind === 'settle') Object.assign(t, { kind: 'settle', who: fdSheet.who, from: '', item: '' });
    else Object.assign(t, { kind: 'opening', who: '', from: '', item: '' });
    if (id) lgUpdateFundTxn(id, t); else lgAddFundTxn(t);
  }
  lgCloseOverlay();
  if (lgMonthKeyOf(date) !== fdViewMonth) lgToast(`已記到 ${lgMonthLabel(lgMonthKeyOf(date)).tw}（目前畫面看的是別的月份）`, 'success');
  renderFund();
}
