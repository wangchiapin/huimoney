/* ====================================================================
   📒 記帳（畫面）：記帳／統計 兩塊、月份切換、新增修改視窗、設定（分類、備份）
   - 版面參考 moneybook：上方四格數字、每日支出、每日收入、分類明細、每月備註
   - 畫面內容放在 #ledgerContent；彈出的視窗放在 #lgOverlayRoot（程式自己建立）
   需要 ledger.js
   ==================================================================== */

let lgViewMonth = lgMonthKeyOf(lgTodayISO());
let lgSubTab = 'ledger';          // 'ledger' | 'stats'
let lgConfirmKey = '';            // 正在確認刪除的那一筆，例如 'expense:abc123'
let lgConfirmTimer = null;
let lgStatsExpandedMonth = '';
let lgNoteDraft = '';
let lgNoteEditId = '';
let lgNoteEditText = '';
let lgNoteConfirmId = '';
let lgSheet = null;               // 新增／修改視窗的狀態 { kind, id, category }
let lgLastCat = { expense: '', income: '' };
let lgPickYear = 0;
let lgSettingsTab = 'expense';    // 'expense' | 'income' | 'backup'
let lgClearArmed = false;

function lgEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function lgIsVisible() {
  const el = document.getElementById('ledgerView');
  return !!el && el.style.display !== 'none';
}
function lgFallbackCat(id) { return { id, name: id || '（未分類）', color: '#999999' }; }

/* 切到記帳分頁時由 switchAppView 呼叫 */
function showLedger() { renderLedger(); }
/* 雲端資料換進來之後重畫 */
function lgOnDataReplaced() { if (lgIsVisible()) renderLedger(); }

/* ====================================================================
   主畫面
   ==================================================================== */
function renderLedger() {
  const root = document.getElementById('ledgerContent');
  if (!root) return;
  root.innerHTML = lgHeaderHtml() + (lgSubTab === 'stats' ? lgStatsHtml() : lgMainHtml());
}

function lgHeaderHtml() {
  const { tw, greg } = lgMonthLabel(lgViewMonth);
  return `
    <div class="lg-top">
      <div class="lg-month-nav">
        <button type="button" class="lg-icon-btn" onclick="lgShiftView(-1)" aria-label="上個月">‹</button>
        <button type="button" class="lg-month-btn" onclick="lgOpenMonthPicker()">
          <b>${tw}</b><small>${greg}</small>
        </button>
        <button type="button" class="lg-icon-btn" onclick="lgShiftView(1)" aria-label="下個月">›</button>
      </div>
      <div class="lg-subtabs">
        <button type="button" class="${lgSubTab === 'ledger' ? 'active' : ''}" onclick="lgSetSubTab('ledger')">📒 記帳</button>
        <button type="button" class="${lgSubTab === 'stats' ? 'active' : ''}" onclick="lgSetSubTab('stats')">📊 統計</button>
      </div>
      <button type="button" class="btn btn-outline lg-settings-btn" onclick="lgOpenSettings()">⚙️ 設定</button>
    </div>`;
}

function lgShiftView(delta) { lgViewMonth = lgShiftMonth(lgViewMonth, delta); lgConfirmKey = ''; renderLedger(); }
function lgSetSubTab(t) { lgSubTab = t; lgConfirmKey = ''; renderLedger(); }
function lgGoMonth(mk) { lgViewMonth = mk; lgSubTab = 'ledger'; renderLedger(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function lgMainHtml() {
  const st = lgMonthStats(lgViewMonth);
  const bal = st.balance;
  return `
    <div class="lg-kpis">
      <div class="lg-kpi"><div class="lg-kpi-label">支出總計</div><div class="lg-kpi-value">$${lgFmt(st.total)}</div></div>
      <div class="lg-kpi"><div class="lg-kpi-label">支出總計－卡費</div><div class="lg-kpi-value">$${lgFmt(st.netExpense)}</div></div>
      <div class="lg-kpi"><div class="lg-kpi-label">收入合計</div><div class="lg-kpi-value lg-in">$${lgFmt(st.incomeTotal)}</div></div>
      <div class="lg-kpi lg-kpi-main"><div class="lg-kpi-label">本月收支損益</div><div class="lg-kpi-value ${bal >= 0 ? 'lg-in' : 'lg-out'}">${bal >= 0 ? '+' : '－'}$${lgFmt(Math.abs(bal))}</div></div>
    </div>
    <div class="lg-grid">
      <div class="lg-col-entries">${lgEntryListHtml('expense')}</div>
      <div class="lg-col-entries">${lgEntryListHtml('income')}</div>
      <div class="lg-col-cats">
        ${lgCategoryCardHtml('expense', st)}
        ${lgCategoryCardHtml('income', st)}
      </div>
    </div>
    ${lgNotesHtml()}`;
}

/* ---------- 每日支出／每日收入 清單 ---------- */
function lgEntryListHtml(kind) {
  const isExp = kind === 'expense';
  const amountKey = isExp ? 'price' : 'amount';
  const catMap = lgCatMap(kind);
  const items = (isExp ? lg.expenses : lg.incomes).filter(e => lgMonthKeyOf(e.date) === lgViewMonth);
  const byDate = {};
  items.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dates = Object.keys(byDate).sort().reverse();
  const title = isExp ? '每日支出狀況' : '每日收入狀況';
  const addLabel = isExp ? '＋ 新增支出' : '＋ 新增收入';
  const empty = isExp ? '本月還沒有支出，點上面的「＋ 新增支出」開始記帳' : '本月還沒有收入，點上面的「＋ 新增收入」開始記錄';

  const groups = dates.map(d => {
    const rows = byDate[d].sort((a, b) => String(b.id).localeCompare(String(a.id)));
    const subtotal = rows.reduce((s, e) => s + (Number(e[amountKey]) || 0), 0);
    const rowsHtml = rows.map(it => {
      const cat = catMap[it.category] || lgFallbackCat(it.category);
      const confirming = lgConfirmKey === kind + ':' + it.id;
      const zero = !(Number(it[amountKey]) > 0);
      return `
        <div class="lg-row" data-kind="${kind}" data-id="${lgEsc(it.id)}" onclick="lgRowClick(this)">
          <span class="lg-dot" style="background:${lgEsc(cat.color)}"></span>
          <div class="lg-row-main">
            <div class="lg-row-name ${zero ? 'lg-zero' : ''}">${lgEsc(it.item || cat.name)}</div>
            <div class="lg-row-sub">${lgEsc(cat.name)}${it.note ? ' · ' + lgEsc(it.note) : ''}</div>
          </div>
          <span class="lg-row-amt ${isExp ? '' : 'lg-in'}">$${lgFmt(it[amountKey])}</span>
          ${confirming
            ? `<button type="button" class="lg-del-confirm" onclick="event.stopPropagation(); lgDoDelete(this.parentNode)">🗑 確定</button>`
            : `<button type="button" class="lg-del" onclick="event.stopPropagation(); lgAskDelete(this.parentNode)" aria-label="刪除">🗑</button>`}
        </div>`;
    }).join('');
    return `
      <div class="lg-day">
        <div class="lg-day-head"><span>${lgDateLabel(d)}</span><span class="lg-day-sub">小計 $${lgFmt(subtotal)}</span></div>
        ${rowsHtml}
      </div>`;
  }).join('');

  return `
    <div class="lg-card lg-list">
      <div class="lg-card-head">
        <div class="lg-card-title">${title}</div>
        <button type="button" class="lg-add-btn ${isExp ? 'out' : 'in'}" onclick="lgOpenSheet('${kind}')">${addLabel}</button>
      </div>
      ${groups || `<div class="lg-empty">${empty}</div>`}
    </div>`;
}

function lgRowClick(el) {
  if (lgConfirmKey) { lgConfirmKey = ''; renderLedger(); return; }
  lgOpenSheet(el.dataset.kind, el.dataset.id);
}
function lgAskDelete(el) {
  lgConfirmKey = el.dataset.kind + ':' + el.dataset.id;
  clearTimeout(lgConfirmTimer);
  lgConfirmTimer = setTimeout(() => { if (lgConfirmKey) { lgConfirmKey = ''; if (lgIsVisible()) renderLedger(); } }, 4000);
  renderLedger();
}
function lgDoDelete(el) {
  const kind = el.dataset.kind, id = el.dataset.id;
  lgConfirmKey = '';
  if (kind === 'expense') lgDeleteExpense(id); else lgDeleteIncome(id);
  renderLedger();
}

/* ---------- 分類明細 ---------- */
function lgCategoryCardHtml(kind, st) {
  const isExp = kind === 'expense';
  const cats = lgCatList(kind);
  const totals = isExp ? st.categoryTotals : st.incomeCategoryTotals;
  const known = new Set(cats.map(c => c.id));
  const extra = Object.keys(totals).filter(id => !known.has(id) && totals[id]).map(lgFallbackCat);
  const rows = cats.concat(extra).map(c => `
    <div class="lg-cat-row">
      <span class="lg-cat-name"><span class="lg-dot" style="background:${lgEsc(c.color)}"></span>${lgEsc(c.name)}</span>
      <span class="lg-cat-amt ${totals[c.id] ? '' : 'lg-dim'}">${lgFmt(totals[c.id])}</span>
    </div>`).join('');
  const sum = isExp ? st.total : st.incomeTotal;
  return `
    <div class="lg-card">
      <div class="lg-card-title">${isExp ? '支出分類明細' : '收入分類明細'}</div>
      ${rows}
      <div class="lg-cat-sum"><span>${isExp ? '支出總計' : '收入共計'}</span><span class="${isExp ? '' : 'lg-in'}">$${lgFmt(sum)}</span></div>
    </div>`;
}

/* ---------- 每月備註 ---------- */
function lgNotesHtml() {
  const notes = lg.monthlyNotes.filter(n => n.month === lgViewMonth).sort((a, b) => a.createdAt - b.createdAt);
  const rows = notes.map(n => {
    if (lgNoteEditId === n.id) {
      return `
        <div class="lg-note-row">
          <input type="text" id="lgNoteEditInput" value="${lgEsc(lgNoteEditText)}" oninput="lgNoteEditText=this.value" onkeydown="if(event.key==='Enter')lgNoteSaveEdit()">
          <button type="button" class="lg-mini ok" onclick="lgNoteSaveEdit()">✓</button>
        </div>`;
    }
    return `
      <div class="lg-note-row" data-id="${lgEsc(n.id)}">
        <div class="lg-note-text">${lgEsc(n.text)}</div>
        <button type="button" class="lg-mini" onclick="lgNoteStartEdit(this.parentNode.dataset.id)" aria-label="修改">✎</button>
        ${lgNoteConfirmId === n.id
          ? `<button type="button" class="lg-del-confirm" onclick="lgNoteDelete(this.parentNode.dataset.id)">🗑 確定</button>`
          : `<button type="button" class="lg-mini dim" onclick="lgNoteAsk(this.parentNode.dataset.id)" aria-label="刪除">🗑</button>`}
      </div>`;
  }).join('');
  return `
    <div class="lg-card lg-notes">
      <div class="lg-card-title">📝 本月備註</div>
      ${notes.length ? rows : '<div class="lg-empty-sm">還沒有備註，例如可以記「帳單金額異常，之後查」。</div>'}
      <div class="lg-note-add">
        <input type="text" id="lgNoteInput" placeholder="新增一則備註…" value="${lgEsc(lgNoteDraft)}" oninput="lgNoteDraft=this.value" onkeydown="if(event.key==='Enter')lgNoteAdd()">
        <button type="button" class="lg-add-btn out" onclick="lgNoteAdd()">＋</button>
      </div>
    </div>`;
}
function lgNoteAdd() {
  if (!lgNoteDraft.trim()) return;
  lgAddNote(lgViewMonth, lgNoteDraft);
  lgNoteDraft = '';
  renderLedger();
}
function lgNoteStartEdit(id) {
  const n = lg.monthlyNotes.find(x => x.id === id);
  if (!n) return;
  lgNoteEditId = id; lgNoteEditText = n.text; lgNoteConfirmId = '';
  renderLedger();
  const inp = document.getElementById('lgNoteEditInput');
  if (inp) inp.focus();
}
function lgNoteSaveEdit() {
  if (lgNoteEditText.trim()) lgUpdateNote(lgNoteEditId, lgNoteEditText);
  lgNoteEditId = ''; lgNoteEditText = '';
  renderLedger();
}
function lgNoteAsk(id) { lgNoteConfirmId = id; renderLedger(); setTimeout(() => { if (lgNoteConfirmId === id) { lgNoteConfirmId = ''; if (lgIsVisible()) renderLedger(); } }, 4000); }
function lgNoteDelete(id) { lgNoteConfirmId = ''; lgDeleteNote(id); renderLedger(); }

/* ====================================================================
   統計：每月（依民國年分組）的支出表、收入表；點一列跳到該月記帳
   ==================================================================== */
function lgStatsHtml() {
  const set = new Set(lg.expenses.map(e => lgMonthKeyOf(e.date)));
  lg.incomes.forEach(i => set.add(lgMonthKeyOf(i.date)));
  set.add(lgViewMonth);
  const months = Array.from(set).sort();
  const stats = {};
  months.forEach(mk => { stats[mk] = lgMonthStats(mk); });

  const byYear = {};
  months.forEach(mk => { const y = lgTwYear(mk.split('-')[0]); (byYear[y] = byYear[y] || []).push(mk); });
  const years = Object.keys(byYear).sort((a, b) => b - a).map(y => ({ year: y, months: byYear[y].sort().reverse() }));
  const cats = lg.categories, incCats = lg.incomeCategories;
  const dash = v => (v ? lgFmt(v) : '－');
  const signed = v => (v >= 0 ? '+' : '－') + lgFmt(Math.abs(v));

  const expRows = years.map(yg => {
    const monthRows = yg.months.map(mk => {
      const s = stats[mk];
      const notes = lg.monthlyNotes.filter(n => n.month === mk);
      const expanded = lgStatsExpandedMonth === mk && notes.length;
      return `
        <tr class="lg-st-row ${mk === lgViewMonth ? 'active' : ''}" data-month="${mk}" onclick="lgGoMonth(this.dataset.month)">
          <td class="lg-st-month">${Number(mk.split('-')[1])}月</td>
          <td class="lg-st-note">${notes.length ? `<button type="button" class="lg-mini" data-month="${mk}" onclick="event.stopPropagation(); lgToggleStatsNote(this.dataset.month)">📝</button>` : ''}</td>
          ${cats.map(c => `<td>${dash(s.categoryTotals[c.id])}</td>`).join('')}
          <td class="b">${lgFmt(s.total)}</td>
          <td>${lgFmt(s.netExpense)}</td>
        </tr>
        ${expanded ? `<tr class="lg-st-notes"><td colspan="${cats.length + 4}">${notes.map(n => `<div>· ${lgEsc(n.text)}</div>`).join('')}</td></tr>` : ''}`;
    }).join('');
    const sums = cats.map(c => yg.months.reduce((a, mk) => a + (stats[mk].categoryTotals[c.id] || 0), 0));
    const totalSum = yg.months.reduce((a, mk) => a + stats[mk].total, 0);
    const netSum = yg.months.reduce((a, mk) => a + stats[mk].netExpense, 0);
    return monthRows + `
        <tr class="lg-st-year"><td class="lg-st-month">${yg.year}年</td><td></td>${sums.map(v => `<td>${dash(v)}</td>`).join('')}<td class="b">${lgFmt(totalSum)}</td><td class="b">${lgFmt(netSum)}</td></tr>`;
  }).join('');

  const incRows = years.map(yg => {
    const monthRows = yg.months.map(mk => {
      const s = stats[mk];
      return `
        <tr class="lg-st-row ${mk === lgViewMonth ? 'active' : ''}" data-month="${mk}" onclick="lgGoMonth(this.dataset.month)">
          <td class="lg-st-month">${Number(mk.split('-')[1])}月</td>
          ${incCats.map(c => `<td>${dash(s.incomeCategoryTotals[c.id])}</td>`).join('')}
          <td class="b lg-in">${dash(s.incomeTotal)}</td>
          <td class="b ${s.balance >= 0 ? 'lg-in' : 'lg-out'}">${signed(s.balance)}</td>
        </tr>`;
    }).join('');
    const sums = incCats.map(c => yg.months.reduce((a, mk) => a + (stats[mk].incomeCategoryTotals[c.id] || 0), 0));
    const incSum = yg.months.reduce((a, mk) => a + stats[mk].incomeTotal, 0);
    const balSum = yg.months.reduce((a, mk) => a + stats[mk].balance, 0);
    return monthRows + `
        <tr class="lg-st-year"><td class="lg-st-month">${yg.year}年</td>${sums.map(v => `<td>${dash(v)}</td>`).join('')}<td class="b lg-in">${lgFmt(incSum)}</td><td class="b ${balSum >= 0 ? 'lg-in' : 'lg-out'}">${signed(balSum)}</td></tr>`;
  }).join('');

  return `
    <div class="lg-stats">
      <div class="lg-card lg-st-card">
        <div class="lg-card-title">支出統計 <small>（點任一列跳到該月記帳）</small></div>
        <div class="lg-st-scroll"><table class="lg-st-table">
          <thead><tr><th>月份</th><th>備註</th>${cats.map(c => `<th style="color:${lgEsc(c.color)}">${lgEsc(c.name)}</th>`).join('')}<th>總計</th><th>總計－卡費</th></tr></thead>
          <tbody>${expRows}</tbody>
        </table></div>
      </div>
      <div class="lg-card lg-st-card">
        <div class="lg-card-title">收入統計 <small>（點任一列跳到該月記帳）</small></div>
        <div class="lg-st-scroll"><table class="lg-st-table">
          <thead><tr><th>月份</th>${incCats.map(c => `<th style="color:${lgEsc(c.color)}">${lgEsc(c.name)}</th>`).join('')}<th>收入合計</th><th>收支損益</th></tr></thead>
          <tbody>${incRows}</tbody>
        </table></div>
      </div>
    </div>`;
}
function lgToggleStatsNote(mk) { lgStatsExpandedMonth = lgStatsExpandedMonth === mk ? '' : mk; renderLedger(); }

/* ====================================================================
   彈出視窗共用
   ==================================================================== */
function lgOverlayRoot() {
  let el = document.getElementById('lgOverlayRoot');
  if (!el) { el = document.createElement('div'); el = Object.assign(el, { id: 'lgOverlayRoot' }); document.body.appendChild(el); }
  return el;
}
function lgCloseOverlay() {
  const el = document.getElementById('lgOverlayRoot');
  if (el) el.innerHTML = '';
  lgSheet = null;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.querySelector('#lgOverlayRoot .lg-overlay')) lgCloseOverlay();
});

/* ---------- 月份選擇 ---------- */
function lgOpenMonthPicker() {
  lgPickYear = lgTwYear(lgViewMonth.split('-')[0]);
  lgRenderMonthPicker();
}
function lgRenderMonthPicker() {
  const cells = Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
    const mk = `${lgPickYear + 1911}-${String(m).padStart(2, '0')}`;
    return `<button type="button" class="lg-pick-cell ${mk === lgViewMonth ? 'active' : ''}" data-month="${mk}" onclick="lgPickMonth(this.dataset.month)">${m}月</button>`;
  }).join('');
  lgOverlayRoot().innerHTML = `
    <div class="lg-overlay center" onclick="lgCloseOverlay()">
      <div class="lg-sheet small" onclick="event.stopPropagation()">
        <div class="lg-pick-head">
          <button type="button" class="lg-icon-btn" onclick="lgPickYear--; lgRenderMonthPicker()">‹</button>
          <b>民國 ${lgPickYear} 年</b>
          <button type="button" class="lg-icon-btn" onclick="lgPickYear++; lgRenderMonthPicker()">›</button>
        </div>
        <div class="lg-pick-grid">${cells}</div>
        <button type="button" class="btn btn-outline lg-pick-today" onclick="lgPickMonth(lgMonthKeyOf(lgTodayISO()))">回到本月</button>
      </div>
    </div>`;
}
function lgPickMonth(mk) { lgViewMonth = mk; lgCloseOverlay(); renderLedger(); }

/* ====================================================================
   新增／修改一筆（支出、收入共用）
   ==================================================================== */
function lgOpenSheet(kind, id) {
  const isExp = kind === 'expense';
  const existing = id ? (isExp ? lg.expenses : lg.incomes).find(x => x.id === id) : null;
  const cats = lgCatList(kind);
  const today = lgTodayISO();
  const date = existing ? existing.date : (lgMonthKeyOf(today) === lgViewMonth ? today : `${lgViewMonth}-01`);
  let category = existing ? existing.category : (cats.some(c => c.id === lgLastCat[kind]) ? lgLastCat[kind] : (cats[0] ? cats[0].id : ''));
  lgSheet = { kind, id: existing ? existing.id : '', category };
  const amount = existing ? (isExp ? existing.price : existing.amount) : '';
  const title = existing ? (isExp ? '修改這筆支出' : '修改這筆收入') : (isExp ? '新增一筆支出' : '新增一筆收入');
  const submitLabel = existing ? (isExp ? '更新這筆支出' : '更新這筆收入') : (isExp ? '記一筆支出' : '記一筆收入');
  const known = cats.some(c => c.id === category);
  const chips = (known ? cats : cats.concat([lgFallbackCat(category)])).map(c => `
    <button type="button" class="lg-chip ${c.id === category ? 'active' : ''}" data-cat="${lgEsc(c.id)}" style="--c:${lgEsc(c.color)}" onclick="lgPickCategory(this)">
      <span class="lg-dot" style="background:${lgEsc(c.color)}"></span>${lgEsc(c.name)}
    </button>`).join('');

  lgOverlayRoot().innerHTML = `
    <div class="lg-overlay" onclick="lgCloseOverlay()">
      <div class="lg-sheet" onclick="event.stopPropagation()">
        <div class="lg-sheet-head"><h3>${title}</h3><button type="button" class="lg-x" onclick="lgCloseOverlay()" aria-label="關閉">✕</button></div>
        <label class="lg-label">日期</label>
        <input type="date" id="lgFDate" class="lg-input" value="${lgEsc(date)}">
        <label class="lg-label">分類</label>
        <div class="lg-chips" id="lgFChips">${chips}</div>
        <label class="lg-label">${isExp ? '項目' : '項目（選填）'}</label>
        <input type="text" id="lgFItem" class="lg-input" placeholder="${isExp ? '例如：晚餐、捷運、咖啡' : '例如：10月薪資'}" value="${lgEsc(existing ? existing.item : '')}">
        <label class="lg-label">金額</label>
        <input type="number" id="lgFAmount" class="lg-input lg-amount-input" inputmode="decimal" step="any" min="0" placeholder="0" value="${amount === '' ? '' : lgEsc(amount)}">
        <label class="lg-label">備註（選填）</label>
        <input type="text" id="lgFNote" class="lg-input" value="${lgEsc(existing ? existing.note : '')}">
        <button type="button" class="lg-submit ${isExp ? 'out' : 'in'}" onclick="lgSubmitSheet()">${submitLabel}</button>
      </div>
    </div>`;
  ['lgFItem', 'lgFAmount', 'lgFNote'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') lgSubmitSheet(); });
  });
  const first = document.getElementById(existing ? 'lgFItem' : 'lgFAmount');
  if (first && !(window.matchMedia && window.matchMedia('(max-width: 760px)').matches)) first.focus();
}
function lgPickCategory(btn) {
  if (!lgSheet) return;
  lgSheet.category = btn.dataset.cat;
  document.querySelectorAll('#lgFChips .lg-chip').forEach(b => b.classList.toggle('active', b === btn));
}
function lgSubmitSheet() {
  if (!lgSheet) return;
  const { kind, id, category } = lgSheet;
  const isExp = kind === 'expense';
  const date = document.getElementById('lgFDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { lgToast('請選擇日期', 'error'); return; }
  if (!category) { lgToast('請先到設定新增一個分類', 'error'); return; }
  const raw = document.getElementById('lgFAmount').value;
  const num = raw === '' ? 0 : Number(raw);
  if (!isFinite(num) || num < 0) { lgToast('金額要是 0 或正數', 'error'); return; }
  const item = document.getElementById('lgFItem').value.trim();
  const note = document.getElementById('lgFNote').value.trim();
  const entry = isExp ? { date, category, item, price: num, note } : { date, category, item, amount: num, note };
  if (id) { if (isExp) lgUpdateExpense(id, entry); else lgUpdateIncome(id, entry); }
  else { if (isExp) lgAddExpense(entry); else lgAddIncome(entry); }
  lgLastCat[kind] = category;
  lgCloseOverlay();
  if (lgMonthKeyOf(date) !== lgViewMonth) {
    const mm = lgMonthLabel(lgMonthKeyOf(date)).tw;
    lgToast(`已記到 ${mm}（目前畫面看的是別的月份）`, 'success');
  }
  renderLedger();
}

/* ====================================================================
   設定：支出分類、收入分類、備份
   ==================================================================== */
function lgOpenSettings(tab) {
  if (tab) lgSettingsTab = tab;
  lgClearArmed = false;
  lgRenderSettings();
}
function lgSetSettingsTab(t) { lgSettingsTab = t; lgClearArmed = false; lgRenderSettings(); }
function lgRenderSettings() {
  const tabs = [['expense', '支出分類'], ['income', '收入分類'], ['backup', '備份']];
  let body = '';
  if (lgSettingsTab === 'backup') body = lgBackupHtml();
  else body = lgCategoryManagerHtml(lgSettingsTab);
  lgOverlayRoot().innerHTML = `
    <div class="lg-overlay" onclick="lgCloseOverlay(); renderLedger();">
      <div class="lg-sheet" onclick="event.stopPropagation()">
        <div class="lg-sheet-head"><h3>記帳設定</h3><button type="button" class="lg-x" onclick="lgCloseOverlay(); renderLedger();" aria-label="關閉">✕</button></div>
        <div class="lg-set-tabs">${tabs.map(([k, l]) => `<button type="button" class="${lgSettingsTab === k ? 'active' : ''}" onclick="lgSetSettingsTab('${k}')">${l}</button>`).join('')}</div>
        ${body}
      </div>
    </div>`;
}
function lgCategoryManagerHtml(kind) {
  const cats = lgCatList(kind);
  const rows = cats.map(c => `
    <div class="lg-catman-row" data-kind="${kind}" data-id="${lgEsc(c.id)}">
      <input type="color" value="${lgEsc(c.color)}" onchange="lgRecolorCategory(this.parentNode.dataset.kind, this.parentNode.dataset.id, this.value)">
      <input type="text" class="lg-input slim" value="${lgEsc(c.name)}" onchange="lgOnRenameCat(this)">
      <button type="button" class="lg-mini dim" onclick="lgOnDeleteCat(this.parentNode)" aria-label="刪除">🗑</button>
    </div>`).join('');
  const color = LG_PALETTE[Math.floor(Math.random() * LG_PALETTE.length)];
  return `
    <div class="lg-hint">${kind === 'expense' ? '「卡費」「共同基金」可以改名、不能刪除。' : '收入分類可以自由新增、改名。'}分類已經有紀錄使用時不能刪除。</div>
    ${rows}
    <div class="lg-catman-row add" data-kind="${kind}">
      <input type="color" id="lgNewCatColor" value="${color}">
      <input type="text" id="lgNewCatName" class="lg-input slim" placeholder="新分類名稱" onkeydown="if(event.key==='Enter')lgOnAddCat('${kind}')">
      <button type="button" class="lg-add-btn out" onclick="lgOnAddCat('${kind}')">＋</button>
    </div>`;
}
function lgOnRenameCat(inp) {
  const row = inp.parentNode;
  if (!inp.value.trim()) { lgRenderSettings(); return; }
  lgRenameCategory(row.dataset.kind, row.dataset.id, inp.value);
}
function lgOnDeleteCat(row) {
  const why = lgDeleteCategory(row.dataset.kind, row.dataset.id);
  if (why) lgToast(why, 'error');
  lgRenderSettings();
}
function lgOnAddCat(kind) {
  const name = document.getElementById('lgNewCatName').value;
  const color = document.getElementById('lgNewCatColor').value;
  if (!name.trim()) return;
  if (!lgAddCategory(kind, name, color)) lgToast('已經有同名的分類了', 'error');
  lgRenderSettings();
}
function lgBackupHtml() {
  return `
    <div class="lg-hint">
      記帳資料會存在這台裝置；登入雲端後也會自動同步。建議偶爾匯出一份備份。<br>
      匯入時「已經有的紀錄不會重複加」，只會補上沒有的。
    </div>
    <button type="button" class="btn btn-primary lg-wide" onclick="lgExportJson()">⬇️ 匯出記帳備份（.json）</button>
    <input type="file" id="lgImportFile" accept=".json,application/json" style="display:none" onchange="lgOnImportFile(this)">
    <button type="button" class="btn btn-outline lg-wide" onclick="document.getElementById('lgImportFile').click()">⬆️ 匯入記帳備份</button>
    <div class="lg-danger">
      <div class="lg-hint">⚠️ 危險區域</div>
      <button type="button" class="btn btn-outline lg-wide lg-danger-btn ${lgClearArmed ? 'armed' : ''}" onclick="lgOnClear()">${lgClearArmed ? '再按一次確定清空所有紀錄' : '清空所有記帳紀錄（分類設定保留）'}</button>
    </div>`;
}
function lgOnImportFile(inp) {
  const f = inp.files && inp.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const res = lgImportJsonText(String(reader.result || ''));
    if (!res) { alert('匯入失敗：檔案格式不正確'); return; }
    alert(`匯入完成！\n新增支出 ${res.expenses} 筆、收入 ${res.incomes} 筆、備註 ${res.notes} 則、分類 ${res.categories} 個\n（本來就有的紀錄沒有重複加）`);
    lgRenderSettings();
  };
  reader.readAsText(f);
  inp.value = '';
}
function lgOnClear() {
  if (!lgClearArmed) {
    lgClearArmed = true;
    lgRenderSettings();
    setTimeout(() => { if (lgClearArmed) { lgClearArmed = false; if (document.querySelector('#lgOverlayRoot .lg-set-tabs')) lgRenderSettings(); } }, 3000);
    return;
  }
  lgClearAllRecords();
  lgClearArmed = false;
  lgToast('已清空所有記帳紀錄', 'success');
  lgCloseOverlay();
  renderLedger();
}
