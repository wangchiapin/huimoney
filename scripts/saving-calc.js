/* ====== 🌱 存股試算（股票管理頁面的按鈕，跳出視窗）======
   - 可以同時試算好幾檔（預設 3 檔，可再新增），最後合計。
   - 每一檔可以「從我的持股帶入」（股數、股價、代號帶進來，之後還能自己改，不會動到真正的持股）或「手動輸入」。
   - 殖利率來源：手動填殖利率 % / 手動填每股配息 / 過去一年實際領到（持股才有）/ 股利頁填的預估股利（有代號才有）。
   - 設定存在瀏覽器本機 localStorage（SAVING_CALC_V1）。
   - 計算方式（簡化）：每月月初固定投入、每月依成長率換算股價；股息每年年底發一次，用年底持股計算；
     可選擇股息再投入（以年底股價買進）。沒有扣稅金與二代健保補充保費。 */

const SAVING_CALC_KEY = 'SAVING_CALC_V1';
let savingCalc = null;

function savingNewCard() {
  return { mode: 'manual', holdingId: '', name: '', code: '', price: 0, shares: 0, monthly: 0,
           yieldMode: 'pct', yieldPct: 5, divPerShare: 0, priceGrowth: 0, divGrowth: 0 };
}
function savingDefaultState() {
  return { years: 10, reinvest: true, feePct: 0.1425, view: 'total', cards: [savingNewCard(), savingNewCard(), savingNewCard()] };
}
function savingLoad() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVING_CALC_KEY) || 'null'); } catch (e) { s = null; }
  const d = savingDefaultState();
  if (!s || typeof s !== 'object' || !Array.isArray(s.cards) || !s.cards.length) return d;
  const n = v => (isFinite(Number(v)) ? Number(v) : 0);
  return {
    years: Math.min(60, Math.max(1, Math.round(n(s.years) || d.years))),
    reinvest: s.reinvest !== false, feePct: Math.max(0, n(s.feePct)), view: 'total',
    cards: s.cards.slice(0, 30).map(c => Object.assign(savingNewCard(), c || {}))
  };
}
function savingSave() {
  try { localStorage.setItem(SAVING_CALC_KEY, JSON.stringify(savingCalc)); } catch (e) { /* 存不了就算了 */ }
}

/* 每股每年配息（元）：依殖利率來源決定。回傳 { div, note } */
function savingDivPerShare(c) {
  const price = Number(c.price) || 0;
  if (c.yieldMode === 'pct') return { div: price * (Number(c.yieldPct) || 0) / 100, note: '' };
  if (c.yieldMode === 'div') return { div: Number(c.divPerShare) || 0, note: '' };
  const h = (typeof stocks !== 'undefined' && Array.isArray(stocks)) ? stocks.find(s => String(s.id) === String(c.holdingId)) : null;
  if (c.yieldMode === 'actual') {
    if (!h) return { div: 0, note: '要先選「從我的持股帶入」才能用過去實際領到的' };
    const a = savingActualCash(h);
    const sh = Number(h.shares) || 0;
    if (!sh) return { div: 0, note: '這檔目前沒有股數，算不出來' };
    if (!a.cash) return { div: 0, note: '這檔最近一年沒有現金股利紀錄' };
    return { div: a.cash / sh, note: a.basis };
  }
  if (c.yieldMode === 'estimate') {
    const key = (c.code && String(c.code).trim()) || String(c.name || '').trim();
    const est = (typeof dividendEstimates !== 'undefined' && dividendEstimates) ? (dividendEstimates[key] || dividendEstimates[c.code] || dividendEstimates[c.name]) : null;
    const v = est ? Number(est.expCash) || 0 : 0;
    return { div: v, note: v ? '' : '股利頁沒有這檔的預估現金股利' };
  }
  return { div: 0, note: '' };
}
// 單一持股最近一年實際領到的現金股利（同 retirement.js 的算法，只算這一檔，原幣別）
function savingActualCash(h) {
  const now = new Date();
  const toInt = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const todayInt = toInt(now), cutoffInt = toInt(new Date(now.getTime() - 365 * 24 * 3600 * 1000));
  let cash = 0, dated = 0, undated = [];
  (h.dividendHistory || []).forEach(dh => {
    const v = Number(dh.cash) || 0;
    if (!v) return;
    const di = (typeof parseRocDateInt === 'function') ? parseRocDateInt(dh.cashDate) : 99999999;
    if (di !== 99999999) { dated++; if (di >= cutoffInt && di <= todayInt) cash += v; }
    else undated.push({ year: parseInt(dh.year, 10), v });
  });
  if (dated > 0) return { cash, basis: '依最近 365 天內入帳的現金股利' };
  const ys = undated.map(u => u.year).filter(y => isFinite(y));
  if (ys.length) {
    const latest = Math.max.apply(null, ys);
    return { cash: undated.filter(u => u.year === latest).reduce((s, u) => s + u.v, 0), basis: `依 ${latest} 年的現金股利（紀錄沒有入帳日）` };
  }
  return { cash: 0, basis: '' };
}

/* ====== 純計算 ====== */
function savingSimulate(c, g) {
  const years = g.years, fee = (Number(g.feePct) || 0) / 100;
  const price0 = Number(c.price) || 0;
  const rows = [];
  if (price0 <= 0) return rows;
  const pg = (Number(c.priceGrowth) || 0) / 100, dg = (Number(c.divGrowth) || 0) / 100;
  const div0 = savingDivPerShare(c).div;
  const monthly = Number(c.monthly) || 0;
  let shares = Number(c.shares) || 0, invested = shares * price0, cumDiv = 0;
  for (let y = 1; y <= years; y++) {
    const startP = price0 * Math.pow(1 + pg, y - 1);
    for (let m = 0; m < 12; m++) {
      const p = startP * Math.pow(1 + pg, m / 12);
      if (monthly > 0) { shares += monthly / (1 + fee) / p; invested += monthly; }
    }
    const endP = price0 * Math.pow(1 + pg, y);
    const divYear = shares * div0 * Math.pow(1 + dg, y - 1);
    cumDiv += divYear;
    if (g.reinvest && endP > 0) shares += divYear / (1 + fee) / endP;
    rows.push({ year: y, shares, price: endP, value: shares * endP, invested, divYear, cumDiv });
  }
  return rows;
}
function savingTotals(cards, g) {
  const per = cards.map(c => savingSimulate(c, g));
  const total = [];
  for (let y = 0; y < g.years; y++) {
    const t = { year: y + 1, value: 0, invested: 0, divYear: 0, cumDiv: 0 };
    per.forEach(rows => { const r = rows[y]; if (r) { t.value += r.value; t.invested += r.invested; t.divYear += r.divYear; t.cumDiv += r.cumDiv; } });
    total.push(t);
  }
  return { per, total };
}

/* ====== 畫面 ====== */
const savingFmt = v => Math.round(Number(v) || 0).toLocaleString('en-US');
const savingFmt1 = v => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function openSavingCalcModal() {
  const modal = document.getElementById('savingCalcModal');
  if (!modal) return;
  if (!savingCalc) savingCalc = savingLoad();
  modal.classList.add('open');
  savingRenderAll();
}
function closeSavingCalcModal() {
  const modal = document.getElementById('savingCalcModal');
  if (modal) modal.classList.remove('open');
}

function savingHoldingOptions(selId) {
  const list = (typeof stocks !== 'undefined' && Array.isArray(stocks)) ? stocks : [];
  return '<option value="">（選一檔持股）</option>' + list.map(s =>
    `<option value="${esc(s.id)}"${String(s.id) === String(selId) ? ' selected' : ''}>${esc(s.name)}${s.code ? ' ' + esc(s.code) : ''}（${esc(s.account || '')}）</option>`).join('');
}

function savingCardHtml(c, i) {
  const holding = c.mode === 'holding';
  const f = (field, label, val, step, extra) => `<div class="form-group"><label class="form-label">${label}</label>
    <input type="number" class="form-control" step="${step || 'any'}" value="${esc(val)}" oninput="savingSet(${i},'${field}',this.value)" ${extra || ''} /></div>`;
  const yopt = (v, t) => `<option value="${v}"${c.yieldMode === v ? ' selected' : ''}>${t}</option>`;
  let yieldInput = '';
  if (c.yieldMode === 'pct') yieldInput = f('yieldPct', '殖利率（%）', c.yieldPct);
  else if (c.yieldMode === 'div') yieldInput = f('divPerShare', '每股每年配息（元）', c.divPerShare);
  else yieldInput = `<div class="form-group"><label class="form-label">每股每年配息（自動帶入）</label><div class="form-control" id="savingAutoDiv${i}" style="background:#f6f2ea;"></div></div>`;
  return `<div class="saving-card" style="border:1px solid #e0d8c8; border-radius:10px; padding:12px; margin-bottom:12px;">
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
      <strong>第 ${i + 1} 檔</strong>
      <select class="form-control" style="max-width:150px;" onchange="savingSetMode(${i}, this.value)">
        <option value="manual"${holding ? '' : ' selected'}>手動輸入</option>
        <option value="holding"${holding ? ' selected' : ''}>從我的持股帶入</option>
      </select>
      ${holding ? `<select class="form-control" onchange="savingPickHolding(${i}, this.value)">${savingHoldingOptions(c.holdingId)}</select>` : ''}
      <button class="btn-del" style="margin-left:auto; font-size:1.1rem;" title="刪除這檔" onclick="savingRemove(${i})">✕</button>
    </div>
    <div class="form-grid" style="grid-template-columns: repeat(3, 1fr); gap:8px;">
      <div class="form-group"><label class="form-label">名稱 / 代號</label>
        <input type="text" class="form-control" value="${esc(c.name)}" placeholder="例：00878" oninput="savingSet(${i},'name',this.value,true)" /></div>
      ${f('price', '目前股價（元）', c.price)}
      ${f('shares', '目前已有股數', c.shares, 1)}
      ${f('monthly', '每月投入（元）', c.monthly)}
      ${f('priceGrowth', '股價每年成長（%）', c.priceGrowth)}
      ${f('divGrowth', '股息每年成長（%）', c.divGrowth)}
      <div class="form-group"><label class="form-label">殖利率來源</label>
        <select class="form-control" onchange="savingSetYieldMode(${i}, this.value)">
          ${yopt('pct', '手動填殖利率 %')}${yopt('div', '手動填每股配息')}${yopt('actual', '過去一年實際領到')}${yopt('estimate', '股利頁的預估股利')}
        </select></div>
      ${yieldInput}
      <div class="form-group"><label class="form-label">換算殖利率</label><div class="form-control" id="savingYield${i}" style="background:#f6f2ea;"></div></div>
    </div>
    <div id="savingNote${i}" style="font-size:0.8rem; color:#b6533c; margin-top:4px;"></div>
  </div>`;
}

function savingRenderAll() {
  const body = document.getElementById('savingCalcCards');
  if (!body) return;
  body.innerHTML = savingCalc.cards.map(savingCardHtml).join('');
  document.getElementById('savingYears').value = savingCalc.years;
  document.getElementById('savingFee').value = savingCalc.feePct;
  document.getElementById('savingReinvest').checked = !!savingCalc.reinvest;
  savingRecalc();
}

function savingRecalc() {
  const g = savingCalc;
  g.cards.forEach((c, i) => {
    const r = savingDivPerShare(c);
    const price = Number(c.price) || 0;
    const y = document.getElementById('savingYield' + i), a = document.getElementById('savingAutoDiv' + i), n = document.getElementById('savingNote' + i);
    if (y) y.textContent = price > 0 ? savingFmt1(r.div / price * 100) + ' %' : '—';
    if (a) a.textContent = savingFmt1(r.div) + ' 元';
    if (n) n.textContent = r.note || '';
  });
  const { per, total } = savingTotals(g.cards, g);
  const last = total[total.length - 1] || { value: 0, invested: 0, divYear: 0, cumDiv: 0 };
  const sum = document.getElementById('savingSummary');
  const card = (t, v, s) => `<div style="flex:1; min-width:130px; background:#f6f2ea; border-radius:10px; padding:10px 12px;"><div style="font-size:0.78rem; color:#93897a;">${t}</div><div style="font-size:1.15rem; font-weight:700;">${v}</div><div style="font-size:0.75rem; color:#93897a;">${s || ''}</div></div>`;
  sum.innerHTML = card(`${g.years} 年後總市值`, 'NT$ ' + savingFmt(last.value), `投入本金 ${savingFmt(last.invested)}`)
    + card('第 ' + g.years + ' 年領的股息', 'NT$ ' + savingFmt(last.divYear), '每月約 ' + savingFmt(last.divYear / 12))
    + card('累積領到股息', 'NT$ ' + savingFmt(last.cumDiv), g.reinvest ? '已再投入買股' : '沒有再投入');

  const sel = document.getElementById('savingView');
  const names = g.cards.map((c, i) => c.name || ('第 ' + (i + 1) + ' 檔'));
  sel.innerHTML = '<option value="total">合計</option>' + names.map((n, i) => `<option value="${i}"${String(g.view) === String(i) ? ' selected' : ''}>${esc(n)}</option>`).join('');
  if (g.view === 'total') sel.value = 'total';
  let rows;
  if (g.view === 'total' || !per[g.view]) rows = total.map(t => ({ year: t.year, shares: null, price: null, value: t.value, invested: t.invested, divYear: t.divYear, cumDiv: t.cumDiv }));
  else rows = per[g.view];
  const showSh = !(g.view === 'total' || !per[g.view]);
  document.getElementById('savingTable').innerHTML = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
    <thead><tr style="text-align:right; border-bottom:2px solid #e0d8c8;"><th style="text-align:left;">第幾年</th>${showSh ? '<th>年底股數</th><th>年底股價</th>' : ''}<th>市值</th><th>投入本金</th><th>當年股息</th><th>每月約</th><th>累積股息</th></tr></thead><tbody>`
    + rows.map(r => `<tr style="text-align:right; border-bottom:1px solid #eee6d8;"><td style="text-align:left;">第 ${r.year} 年</td>${showSh ? `<td>${savingFmt(r.shares)}</td><td>${savingFmt1(r.price)}</td>` : ''}<td>${savingFmt(r.value)}</td><td>${savingFmt(r.invested)}</td><td>${savingFmt(r.divYear)}</td><td>${savingFmt(r.divYear / 12)}</td><td>${savingFmt(r.cumDiv)}</td></tr>`).join('')
    + '</tbody></table>';
  savingSave();
}

function savingSet(i, field, val, isText) {
  const c = savingCalc.cards[i]; if (!c) return;
  c[field] = isText ? val : (val === '' ? 0 : Number(val));
  savingRecalc();
}
function savingSetGlobal(field, val) {
  if (field === 'years') savingCalc.years = Math.min(60, Math.max(1, Math.round(Number(val)) || 1));
  else if (field === 'feePct') savingCalc.feePct = Math.max(0, Number(val) || 0);
  else if (field === 'reinvest') savingCalc.reinvest = !!val;
  savingRecalc();
}
function savingSetView(v) { savingCalc.view = v === 'total' ? 'total' : Number(v); savingRecalc(); }
function savingSetMode(i, mode) {
  const c = savingCalc.cards[i]; c.mode = mode;
  if (mode === 'manual') { c.holdingId = ''; if (c.yieldMode === 'actual') c.yieldMode = 'pct'; }
  savingRenderAll();
}
function savingSetYieldMode(i, m) { savingCalc.cards[i].yieldMode = m; savingRenderAll(); }
function savingPickHolding(i, id) {
  const c = savingCalc.cards[i]; c.holdingId = id;
  const h = (typeof stocks !== 'undefined' ? stocks : []).find(s => String(s.id) === String(id));
  if (h) {
    const fx = (typeof isUsStock === 'function' && isUsStock(h)) ? getUsdRate() : 1;
    c.name = h.code || h.name; c.code = h.code || '';
    c.price = Math.round((Number(h.currentPrice) || 0) * fx * 100) / 100;
    c.shares = Number(h.shares) || 0;
    c.yieldMode = 'actual';
  }
  savingRenderAll();
}
function savingAdd() { savingCalc.cards.push(savingNewCard()); savingRenderAll(); }
function savingRemove(i) {
  if (savingCalc.cards.length <= 1) { savingCalc.cards[0] = savingNewCard(); }
  else savingCalc.cards.splice(i, 1);
  savingCalc.view = 'total';
  savingRenderAll();
}
