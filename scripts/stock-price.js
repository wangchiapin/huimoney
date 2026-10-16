/* ====== 🔄 更新股價（按了才更新，更新後仍可手動改市值） ======
   資料來源：GitHub Action（.github/workflows/prices.yml）每週一到週五 16:10
   自動抓收盤價，存成本網站的 data/prices.json，這裡只讀這個檔案，不直接連外部網站：
     - 台股（上市、上櫃、ETF）：當天收盤價
     - 美股：data/us-symbols.txt 列的代號，前一個美股交易日的收盤價（美元）
     - 美元兌台幣匯率（usdTwd）
   比對方式：用持股的「股票代號」對應（美股要填 BTI 這種代號）。沒填代號、找不到的維持原本數字不動。
   更新內容：
     - 各持股：現價 + 市值（市值 = 收盤價 × 持有股數；美股以美元存，畫面用「💵 美元匯率」換台幣）
     - 💵 美元匯率：換成檔案裡最新的匯率
   跟手動修改一樣會存檔，可以用「復原」(Ctrl+Z) 回到更新前，之後也仍可手動改。
   另外：開網頁時如果檔案裡有「新的一天」的匯率，會自動套用；同一天的匯率只套用一次，
   所以你在標題列手動改的匯率，會用到下一次抓到新匯率為止。 */

const USD_FX_APPLIED_KEY = 'USD_FX_APPLIED_DATE_V1'; // 上次自動套用的匯率是哪一天的

/* 讀 data/prices.json 的匯率 → { rate, date }；沒有就回傳 null */
function pickUsdFx(json) {
  const r = Number(json && json.usdTwd);
  if (!(r > 15 && r < 60)) return null;
  return { rate: Math.round(r * 1000) / 1000, date: String((json && json.fxDate) || '') };
}

/* 讀整個 data/prices.json；讀不到回傳 null */
async function fetchPricesFile() {
  try {
    // 加上時間參數，避免瀏覽器拿到舊的快取檔案
    const res = await fetch('data/prices.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('讀取 data/prices.json 失敗', e);
    return null;
  }
}

/* 回傳 { '0050': { price, date, us:false }, 'VOO': { price, date, us:true } }；讀不到回傳 null */
async function fetchPriceMap(json) {
  try {
    if (json === undefined) json = await fetchPricesFile();
    if (!json) return null;
    const prices = {};
    Object.entries((json && json.prices) || {}).forEach(([code, v]) => {
      const p = Number(v && v.p);
      if (p > 0) prices[String(code).trim().toUpperCase()] = { price: p, date: (v && v.d) || '', us: !!(v && v.us) };
    });
    return Object.keys(prices).length ? prices : null;
  } catch (e) {
    console.warn('讀取 data/prices.json 失敗', e);
    return null;
  }
}

function formatPriceDate(d) {
  const s = String(d || '');
  if (/^\d{7}$/.test(s)) return `${s.slice(0, 3)}/${s.slice(3, 5)}/${s.slice(5, 7)}`; // 民國 1151015 → 115/10/15
  const m = s.match(/^\d{4}-(\d{2})-(\d{2})$/);                                       // 美股 2026-10-14 → 10/14
  return m ? `${m[1]}/${m[2]}` : s;
}

async function updateStockPrices() {
  const btn = document.getElementById('btnUpdatePrices');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 更新中…'; }
  try {
    const json = await fetchPricesFile();
    const prices = await fetchPriceMap(json);
    const fx = pickUsdFx(json);
    if (!prices && !fx) {
      showToast('⚠️ 讀不到股價資料（data/prices.json），股價沒有變動。第一次使用請先到 GitHub Actions 手動執行「每日更新收盤價」', 'error');
      return;
    }

    // 先找出要改的，確定有東西可改才記錄復原點
    const changes = [];
    const missing = [];
    stocks.forEach(s => {
      if (s.archived) return;
      const isUS = isUsStock(s);
      const code = String(s.code || '').trim().toUpperCase();
      const hit = code && prices && prices[code];
      if (!hit || hit.us !== isUS) { missing.push(s.name || code || '（未命名）'); return; }
      changes.push({ s, hit, isUS });
    });

    const fxChanged = !!fx && Math.abs(fx.rate - getUsdRate()) > 1e-9;

    if (changes.length === 0 && !fxChanged) {
      showToast(fx ? '沒有找到可以更新的持股，請確認持股有填「股票代號」（美元匯率已是最新）' : '沒有找到可以更新的持股，請確認持股有填「股票代號」', 'error');
      return;
    }

    recordSnapshot();
    const twDates = new Set(), usDates = new Set();
    let twCount = 0, usCount = 0;
    changes.forEach(({ s, hit, isUS }) => {
      s.currentPrice = hit.price;
      s.marketVal = Math.round(hit.price * (Number(s.shares) || 0) * 100) / 100;
      if (isUS) { usCount++; if (hit.date) usDates.add(hit.date); }
      else { twCount++; if (hit.date) twDates.add(hit.date); }
    });
    if (fxChanged) {
      applyUsdRate(fx.rate, { silent: true });
      try { localStorage.setItem(USD_FX_APPLIED_KEY, fx.date || fx.rate); } catch (e) { /* 略過 */ }
    }
    saveToStorage();
    renderTable();
    if (typeof renderRetirementIfVisible === 'function') renderRetirementIfVisible();

    const fmt = set => set.size ? `（${[...set].map(formatPriceDate).join('、')}）` : '';
    const parts = [];
    if (twCount) parts.push(`台股 ${twCount} 檔${fmt(twDates)}`);
    if (usCount) parts.push(`美股 ${usCount} 檔${fmt(usDates)}`);
    if (fxChanged) parts.push(`美元匯率 ${fx.rate}`);
    let msg = `✅ 已更新：${parts.join('、')}`;
    if (missing.length) msg += `；${missing.length} 檔沒找到，維持原本數字：${missing.slice(0, 5).join('、')}${missing.length > 5 ? '…' : ''}`;
    showToast(msg, 'success');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💹 更新股價與匯率'; }
  }
}

/* 開網頁時：檔案裡有「新的一天」的匯率就自動套用（同一天只套用一次，不會蓋掉你當天手動改的數字） */
(async function autoApplyUsdFx() {
  const fx = pickUsdFx(await fetchPricesFile());
  if (!fx) return;
  let last = null;
  try { last = localStorage.getItem(USD_FX_APPLIED_KEY); } catch (e) { /* 略過 */ }
  const stamp = String(fx.date || fx.rate);
  if (last === stamp) return;
  try { localStorage.setItem(USD_FX_APPLIED_KEY, stamp); } catch (e) { /* 略過 */ }
  if (Math.abs(fx.rate - getUsdRate()) < 1e-9) return;
  applyUsdRate(fx.rate);
})();
