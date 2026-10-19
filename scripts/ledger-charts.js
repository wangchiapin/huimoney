/* ====================================================================
   📈 圖表（記帳的第三個子分頁）
   - 單月各分類支出（橫條，看的月份跟上方月份切換一致）
   - 年度每月收支趨勢（折線，可選民國年）
   - 全期間每月收支趨勢
   不靠外部圖表套件，直接畫 SVG／HTML，離線也能看。
   顏色：支出 #b5424d、收入 #3a74b0（紅藍，色盲也分得出來；另外用圓點／方塊記號與圖例區分）
   每張圖都有「以表格查看」，滑鼠移上去（手機點一下）會顯示數字。
   需要 ledger.js、ledger-ui.js
   ==================================================================== */

const LG_C_EXP = '#b5424d';
const LG_C_INC = '#3a74b0';
let lgChartYear = 0;   // 民國年；0＝跟著目前看的月份

function lgChartMoneyShort(v) {
  const a = Math.abs(v);
  if (a >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '億';
  if (a >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '萬';
  return lgFmt(v);
}
// 圖的寬度跟著畫面走，文字才會維持原本大小（不會桌機放太大、手機縮太小）
function lgChartWidth() {
  const el = document.getElementById('ledgerContent');
  const w = (el && el.clientWidth) || 640;
  return Math.max(280, Math.min(1400, Math.round(w - 32)));
}
function lgNiceMax(max) {
  if (max <= 0) return 4;
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) || pow * 10;
  return step * 4;
}

// 一組折線圖：labels（x 軸文字）、series [{ name, color, values, shape:'circle'|'square' }]
function lgLineSvg(labels, series, tipTitles) {
  const W = lgChartWidth(), H = W < 520 ? 220 : 260, L = 46, R = 22, T = 14, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const maxV = lgNiceMax(Math.max(0, ...series.flatMap(s => s.values)));
  const n = labels.length;
  const x = i => L + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = v => T + ih - (ih * v) / maxV;
  const grid = [0, 1, 2, 3, 4].map(k => {
    const v = (maxV * k) / 4;
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="lg-ch-grid"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" class="lg-ch-ytick">${lgChartMoneyShort(v)}</text>`;
  }).join('');
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 44))));
  const xl = labels.map((t, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === n - 1 && n > 1 ? 'end' : 'middle'}" class="lg-ch-xtick">${lgEsc(t)}</text>` : '')).join('');
  const lines = series.map(s => {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const marks = s.values.map((v, i) => s.shape === 'square'
      ? `<rect x="${x(i) - 4}" y="${y(v) - 4}" width="8" height="8" rx="1.5" fill="${s.color}" class="lg-ch-mark"/>`
      : `<circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="${s.color}" class="lg-ch-mark"/>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${n <= 24 ? marks : ''}`;
  }).join('');
  const step = n === 1 ? iw : iw / (n - 1);
  const hits = labels.map((t, i) => {
    const tip = [tipTitles[i]].concat(series.map(s => `${s.name} $${lgFmt(s.values[i])}`)).join('|');
    return `<g class="lg-ch-hit"><line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + ih}" class="lg-ch-cross"/><rect x="${x(i) - step / 2}" y="${T}" width="${step}" height="${ih}" fill="transparent" data-tip="${lgEsc(tip)}"/></g>`;
  }).join('');
  return `<svg class="lg-ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${lgEsc(series.map(s => s.name).join('、'))}趨勢圖">${grid}${xl}${lines}${hits}</svg>`;
}
function lgLegendHtml() {
  return `<div class="lg-ch-legend"><span><i class="lg-ch-sw" style="background:${LG_C_EXP}"></i>支出（扣卡費）</span><span><i class="lg-ch-sw sq" style="background:${LG_C_INC}"></i>收入</span></div>`;
}
function lgChartTable(headers, rows) {
  return `<details class="lg-ch-table"><summary>以表格查看</summary><div class="lg-st-scroll"><table class="lg-st-table"><thead><tr>${headers.map(h => `<th>${lgEsc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="lg-st-month"' : ''}>${lgEsc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

function lgChartsHtml() {
  const monthsSet = new Set();
  lg.expenses.forEach(e => monthsSet.add(lgMonthKeyOf(e.date)));
  lg.incomes.forEach(i => monthsSet.add(lgMonthKeyOf(i.date)));
  monthsSet.add(lgViewMonth);
  const months = Array.from(monthsSet).sort();
  const years = Array.from(new Set(months.map(m => lgTwYear(m.split('-')[0])))).sort((a, b) => a - b);
  let year = lgChartYear || lgTwYear(lgViewMonth.split('-')[0]);
  if (!years.includes(year)) year = years[years.length - 1];

  /* 1. 單月分類 */
  const st = lgMonthStats(lgViewMonth);
  const catRows = lg.categories.map(c => ({ c, v: st.categoryTotals[c.id] || 0 })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...catRows.map(r => r.v));
  const barsHtml = catRows.length ? `<div class="lg-bars">${catRows.map(r => `
      <div class="lg-bar-row" data-tip="${lgEsc(`${r.c.name}|$${lgFmt(r.v)}（占 ${Math.round((r.v / st.total) * 100)}%）`)}">
        <span class="lg-bar-name"><span class="lg-dot" style="background:${lgEsc(r.c.color)}"></span>${lgEsc(r.c.name)}</span>
        <span class="lg-bar-track"><span class="lg-bar-fill" style="width:${(r.v / maxCat) * 100}%;background:${lgEsc(r.c.color)}"></span></span>
        <span class="lg-bar-val">$${lgFmt(r.v)}</span>
      </div>`).join('')}</div>` : '<div class="lg-empty">這個月還沒有支出資料</div>';
  const monthTitle = lgMonthLabel(lgViewMonth).tw;

  /* 2. 年度每月 */
  const gy = year + 1911;
  const yMonths = Array.from({ length: 12 }, (_, i) => `${gy}-${String(i + 1).padStart(2, '0')}`);
  const yStats = yMonths.map(mk => lgMonthStats(mk));
  const yLabels = yMonths.map((_, i) => `${i + 1}月`);
  const yTips = yMonths.map((_, i) => `民國 ${year} 年 ${i + 1} 月`);
  const yearSvg = lgLineSvg(yLabels, [
    { name: '支出', color: LG_C_EXP, values: yStats.map(s => s.netExpense), shape: 'circle' },
    { name: '收入', color: LG_C_INC, values: yStats.map(s => s.incomeTotal), shape: 'square' }
  ], yTips);
  const yearTable = lgChartTable(['月份', '支出（扣卡費）', '收入', '收支損益'], yMonths.map((mk, i) => [`${i + 1}月`, lgFmt(yStats[i].netExpense), lgFmt(yStats[i].incomeTotal), lgFmt(yStats[i].balance)]));

  /* 3. 全期間 */
  const aStats = months.map(mk => lgMonthStats(mk));
  const aLabels = months.map(mk => `${lgTwYear(mk.split('-')[0])}/${Number(mk.split('-')[1])}`);
  const allBlock = months.length < 2
    ? '<div class="lg-empty">資料還太少，累積幾個月後這裡會出現趨勢圖</div>'
    : lgLineSvg(aLabels, [
      { name: '支出', color: LG_C_EXP, values: aStats.map(s => s.netExpense), shape: 'circle' },
      { name: '收入', color: LG_C_INC, values: aStats.map(s => s.incomeTotal), shape: 'square' }
    ], months.map(mk => lgMonthLabel(mk).tw)) + lgChartTable(['月份', '支出（扣卡費）', '收入'], months.map((mk, i) => [aLabels[i], lgFmt(aStats[i].netExpense), lgFmt(aStats[i].incomeTotal)]));

  return `
    <div class="lg-charts">
      <div class="lg-card">
        <div class="lg-card-head"><div class="lg-card-title">${lgEsc(monthTitle)}　各分類支出 <small>（換月份請用上方的月份切換）</small></div></div>
        ${barsHtml}
        ${catRows.length ? lgChartTable(['分類', '金額', '占比'], catRows.map(r => [r.c.name, lgFmt(r.v), Math.round((r.v / st.total) * 100) + '%'])) : ''}
      </div>
      <div class="lg-card">
        <div class="lg-card-head"><div class="lg-card-title">年度每月收支趨勢</div>
          <select class="lg-input slim lg-year-select" onchange="lgChartYear = Number(this.value); renderLedger()">${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>民國 ${y} 年</option>`).join('')}</select>
        </div>
        ${lgLegendHtml()}${yearSvg}${yearTable}
      </div>
      <div class="lg-card">
        <div class="lg-card-head"><div class="lg-card-title">全期間每月收支趨勢</div></div>
        ${months.length >= 2 ? lgLegendHtml() : ''}${allBlock}
      </div>
    </div>`;
}

/* ---------- 滑過／點一下顯示數字（整個記帳畫面共用一個提示框） ---------- */
(function () {
  function tipEl() {
    let t = document.getElementById('lgTip');
    if (!t) { t = document.createElement('div'); t.id = 'lgTip'; document.body.appendChild(t); }
    return t;
  }
  function show(target, ev) {
    const raw = target.getAttribute('data-tip');
    if (!raw) return;
    const t = tipEl();
    const parts = raw.split('|');
    t.innerHTML = `<b>${lgEsc(parts[0])}</b>` + parts.slice(1).map(p => `<div>${lgEsc(p)}</div>`).join('');
    t.style.display = 'block';
    const pad = 12, w = t.offsetWidth, h = t.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > window.innerWidth - 6) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 6) y = ev.clientY - h - pad;
    t.style.left = Math.max(6, x) + 'px';
    t.style.top = Math.max(6, y) + 'px';
  }
  function hide() { const t = document.getElementById('lgTip'); if (t) t.style.display = 'none'; }
  document.addEventListener('pointermove', ev => { const el = ev.target.closest && ev.target.closest('#ledgerView [data-tip]'); if (el) show(el, ev); else hide(); });
  document.addEventListener('pointerdown', ev => { const el = ev.target.closest && ev.target.closest('#ledgerView [data-tip]'); if (el) show(el, ev); else hide(); });
  document.addEventListener('pointerleave', hide);
  window.addEventListener('scroll', hide, true);
})();

// 視窗大小改變時，圖表重畫成新的寬度
(function () {
  let t = null, lastW = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (typeof lgIsVisible === 'function' && lgIsVisible() && lgSubTab === 'charts' && Math.abs(window.innerWidth - lastW) > 30) { renderLedger(); }
      lastW = window.innerWidth;
    }, 200);
  });
  lastW = window.innerWidth;
})();
