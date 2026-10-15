/* ====== 讀取 data/prices.json（由 GitHub Action 每天更新）：更新現價與美元匯率 ======
   - 台股：用股票代號對照收盤價；美股：用英文代號對照（代號清單在 data/us-symbols.txt）
   - 找不到代號的股票不會動，維持原本手動輸入的市值
   - 按下按鈕才會改「現價（市值）」；匯率則在開啟頁面時就會自動套用 */
async function loadPricesFile() {
  const res = await fetch('data/prices.json?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function applyUsdFxFromData(data) {
  const r = Number(data && data.usdTwd);
  if (!(r > 15 && r < 60)) return false;
  const before = usdFx();
  try { localStorage.setItem(USD_FX_KEY, JSON.stringify({ rate: r, date: data.updatedAt || '' })); } catch (e) {}
  return Math.abs(before - r) > 1e-9;
}

async function updatePricesFromFile() {
  const btn = document.getElementById('btnUpdatePrices');
  if (btn) btn.disabled = true;
  try {
    const data = await loadPricesFile();
    const tw = data.tw || {}, us = data.us || {};
    if (!Object.keys(tw).length && !Object.keys(us).length && !data.usdTwd) {
      showToast('⚠️ 還沒有股價資料（網站的自動更新可能還沒跑過）', 'error'); return;
    }
    if (typeof recordSnapshot === 'function') recordSnapshot();
    let updated = 0; const missing = [];
    stocks.forEach(s => {
      const code = String(s.code || '').trim();
      if (!code) return;
      const price = isUsStock(s) ? us[code.toUpperCase()] : tw[code];
      if (price > 0) {
        s.currentPrice = price;
        s.marketVal = Math.round(price * (Number(s.shares) || 0) * 100) / 100;
        updated++;
      } else missing.push(s.name || code);
    });
    const fxChanged = applyUsdFxFromData(data);
    saveToStorage();
    if (typeof renderTabs === 'function') renderTabs();
    renderTable();
    if (typeof renderRetirement === 'function' && document.getElementById('retirementView') && document.getElementById('retirementView').style.display !== 'none') renderRetirement();
    let msg = `✅ 已更新 ${updated} 檔現價`;
    if (data.twDate) msg += `（台股收盤日 ${data.twDate}）`;
    if (data.usdTwd) msg += `，美元匯率 ${data.usdTwd}`;
    if (missing.length) msg += `；${missing.length} 檔找不到代號沒有更新：${missing.slice(0, 5).join('、')}${missing.length > 5 ? '…' : ''}`;
    showToast(msg, 'success');
  } catch (e) {
    showToast('⚠️ 讀不到股價檔案（' + e.message + '）。部署到 GitHub Pages 並讓自動更新跑過一次後才會有資料', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 開啟頁面時只悄悄套用匯率；有變動就重畫
(function autoApplyFx() {
  loadPricesFile().then(data => {
    if (applyUsdFxFromData(data)) {
      if (typeof renderTable === 'function') { try { renderTable(); } catch (e) {} }
      const rv = document.getElementById('retirementView');
      if (rv && rv.style.display !== 'none' && typeof renderRetirement === 'function') renderRetirement();
    }
  }).catch(() => {});
})();
