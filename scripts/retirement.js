/* ========================================================================
   退休試算（半退休 / 完整退休資產試算）
   ------------------------------------------------------------------------
   - 所有設定存在瀏覽器本機 localStorage（RETIREMENT_SETTINGS_V1），可隨「匯出備份 (JSON)」一起備份。
   - 股票現值、每月定期定額、殖利率可以「自動帶入」股票管理裡已輸入的資料，也可以手動輸入。
   - 退休專戶（例如退撫基金、勞退、其他長期帳戶）由使用者自行新增、命名與設定。
   - 單位：畫面上的金額一律是「萬元」；股票管理裡的資料是「元」，帶入時 ÷ 10000。
   - 計算方式是簡化版：每年複利一次、每年底投入一次，只用來概略比較，不是投資建議。
   ======================================================================== */

const RETIREMENT_STORAGE_KEY = 'RETIREMENT_SETTINGS_V1';


function retirementDefaults() {
  return {
    touched: false,          // 使用者是否改過任何數字（沒改過就顯示「這是範例」提示）
    curAge: 35,
    halfAge: 50,             // 半退休年齡
    fullAge: 60,             // 完整退休年齡（開始領退休專戶）
    crashDrop: 25,           // 股災情境：股票市值下跌 %
    stockMode: 'manual',     // 'auto' 自動帶入持股現值 | 'manual' 手動輸入
    stockManual: 100,        // 萬元
    midYear: true,           // 每年投入的錢是否當成「分散在全年」（只算半年報酬），取消勾選＝年底一次投入
    includeLent: true,       // 自動帶入時，出借中的股票是否另外加算
    dcaMode: 'manual',       // 'auto' | 'manual'
    dcaManual: 1.5,          // 萬元 / 月
    stockReturn: 8,          // 股票年化報酬 %
    yieldMode: 'manual',     // 'manual' | 'actual' 過去一年實際領到 | 'estimate' 年度預估股利
    yieldManual: 5.5,        // %
    accounts: [
      { id: 'acc_demo_1', name: '退休專戶 A（範例）', balance: 50, yearlyAdd: 10, rate: 5, growthMode: 'pct', growth: 0, capAdd: 0, stopAge: 0, pension: 0 },
      { id: 'acc_demo_2', name: '退休專戶 B（範例）', balance: 30, yearlyAdd: 0, rate: 4, growthMode: 'pct', growth: 0, capAdd: 0, stopAge: 0, pension: 0 }
    ]
  };
}

function retirementSanitize(raw) {
  const d = retirementDefaults();
  const out = Object.assign({}, d);
  if (!raw || typeof raw !== 'object') return out;
  const num = (v, fb) => (isFinite(parseFloat(v)) ? parseFloat(v) : fb);
  out.touched = !!raw.touched;
  out.curAge = num(raw.curAge, d.curAge);
  out.halfAge = num(raw.halfAge, d.halfAge);
  out.fullAge = num(raw.fullAge, d.fullAge);
  out.crashDrop = Math.min(95, Math.max(0, num(raw.crashDrop, d.crashDrop)));
  out.stockMode = raw.stockMode === 'auto' ? 'auto' : 'manual';
  out.stockManual = num(raw.stockManual, d.stockManual);
  out.midYear = raw.midYear === undefined ? d.midYear : !!raw.midYear;
  out.includeLent = !!raw.includeLent;
  out.dcaMode = raw.dcaMode === 'auto' ? 'auto' : 'manual';
  out.dcaManual = num(raw.dcaManual, d.dcaManual);
  out.stockReturn = num(raw.stockReturn, d.stockReturn);
  out.yieldMode = ['manual', 'actual', 'estimate'].includes(raw.yieldMode) ? raw.yieldMode : 'manual';
  out.yieldManual = num(raw.yieldManual, d.yieldManual);
  if (Array.isArray(raw.accounts)) {
    out.accounts = raw.accounts.map((a, i) => ({
      id: String((a && a.id) || ('acc_' + Date.now() + '_' + i)),
      name: String((a && a.name) || ''),
      balance: num(a && a.balance, 0),
      yearlyAdd: num(a && a.yearlyAdd, 0),
      rate: num(a && a.rate, 0),
      growthMode: (a && a.growthMode === 'fixed') ? 'fixed' : 'pct',
      growth: num(a && a.growth, 0),
      capAdd: Math.max(0, num(a && a.capAdd, 0)),
      stopAge: Math.max(0, num(a && a.stopAge, 0)),
      pension: Math.max(0, num(a && a.pension, 0))
    }));
  }
  return out;
}

let retirementSettings = (function () {
  try {
    const saved = JSON.parse(localStorage.getItem(RETIREMENT_STORAGE_KEY) || 'null');
    return retirementSanitize(saved);
  } catch (e) { return retirementDefaults(); }
})();

function getRetirementSettings() { return JSON.parse(JSON.stringify(retirementSettings)); }

// 給「匯入備份 (JSON)」用：只有本機還沒改過（仍是範例）時，才採用備份檔裡的退休設定，避免蓋掉使用者自己的數字
function importRetirementSettings(raw) {
  if (retirementSettings.touched) return false;
  retirementSettings = retirementSanitize(raw);
  saveRetirementSettings();
  return true;
}

function saveRetirementSettings() {
  try { localStorage.setItem(RETIREMENT_STORAGE_KEY, JSON.stringify(retirementSettings)); }
  catch (e) { if (typeof showToast === 'function') showToast('⚠️ 退休試算設定儲存失敗', 'error'); }
}

/* ====== 從股票管理資料算出「自動帶入」的數字（單位：元；顯示時再換成萬） ====== */
function retirementAutoData() {
  const res = {
    holdingsValue: 0,    // 持股現值（股數 × 現價，美股折算台幣）
    lentValue: 0,        // 其中出借中的部分（出借股數 × 現價）
    dcaMonthly: 0,       // 每月定期定額總額
    actualAnnualDiv: 0, actualBasis: 'none', // 過去一年實際領到的現金股利
    estimateAnnualDiv: 0, estimateMissing: 0, estimateStocks: 0
  };
  const list = (typeof stocks !== 'undefined' && Array.isArray(stocks)) ? stocks : [];
  const fxOf = s => (typeof isUsStock === 'function' && isUsStock(s)) ? usdFx() : 1;

  list.forEach(s => {
    const fx = fxOf(s);
    const price = (Number(s.currentPrice) || 0) * fx;
    res.holdingsValue += (Number(s.shares) || 0) * price;
    res.lentValue += (Number(s.lentShares) || 0) * price;
  });

  if (typeof dcaRows !== 'undefined' && Array.isArray(dcaRows)) {
    res.dcaMonthly = dcaRows.reduce((sum, r) => sum + (Number(r.amount) || 0) * ((r.dates || []).length), 0);
  }

  // 過去一年實際領到：看每筆股利紀錄的「入帳日」落在最近 365 天內；若所有紀錄都沒填入帳日，改用「最新一個發放年度」
  const now = new Date();
  const toInt = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const todayInt = toInt(now);
  const cutoff = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
  const cutoffInt = toInt(cutoff);
  let datedCount = 0, undated = [];
  list.forEach(s => {
    const fx = fxOf(s);
    (s.dividendHistory || []).forEach(dh => {
      const cash = (Number(dh.cash) || 0) * fx;
      if (!cash) return;
      const di = (typeof parseRocDateInt === 'function') ? parseRocDateInt(dh.cashDate) : 99999999;
      if (di !== 99999999) {
        datedCount++;
        if (di >= cutoffInt && di <= todayInt) res.actualAnnualDiv += cash;
      } else {
        undated.push({ year: parseInt(dh.year, 10), cash });
      }
    });
  });
  if (datedCount > 0) {
    res.actualBasis = 'dated';
  } else if (undated.length > 0) {
    const years = undated.map(u => u.year).filter(y => isFinite(y));
    if (years.length) {
      const latest = Math.max.apply(null, years);
      res.actualAnnualDiv = undated.filter(u => u.year === latest).reduce((sum, u) => sum + u.cash, 0);
      res.actualBasis = 'year:' + latest;
    }
  }

  // 年度預估股利：預估現金股利（每股）× 持有股數
  list.forEach(s => {
    const fx = fxOf(s);
    const key = (s.code && String(s.code).trim()) ? String(s.code).trim() : String(s.name || '').trim();
    const est = (typeof dividendEstimates !== 'undefined' && dividendEstimates) ? (dividendEstimates[key] || dividendEstimates[s.code] || dividendEstimates[s.name]) : null;
    res.estimateStocks++;
    const perShare = est ? (Number(est.expCash) || 0) : 0;
    if (!perShare) res.estimateMissing++;
    res.estimateAnnualDiv += perShare * (Number(s.shares) || 0) * fx;
  });
  return res;
}

/* ====== 純計算（不碰畫面，方便測試） ====== */
function retirementFV(pv, pmtAnnual, rate, n) {
  if (!rate) return pv + pmtAnnual * n;
  const g = Math.pow(1 + rate, n);
  return pv * g + pmtAnnual * ((g - 1) / rate);
}

function retirementCompute(st, auto) {
  const wan = v => v / 10000;
  let stockPV = st.stockManual;
  if (st.stockMode === 'auto') {
    stockPV = wan(auto.holdingsValue) + (st.includeLent ? wan(auto.lentValue) : 0);
  }
  const dca = st.dcaMode === 'auto' ? wan(auto.dcaMonthly) : st.dcaManual;

  let yieldPct = st.yieldManual, yieldNote = '';
  const holdingsWan = wan(auto.holdingsValue);
  if (st.yieldMode === 'actual') {
    yieldPct = holdingsWan > 0 ? (wan(auto.actualAnnualDiv) / holdingsWan) * 100 : 0;
    yieldNote = auto.actualBasis === 'dated' ? '依最近 365 天內有入帳日的現金股利'
      : auto.actualBasis.indexOf('year:') === 0 ? ('股利紀錄沒有入帳日，改用發放年度 ' + auto.actualBasis.slice(5))
      : '目前沒有股利紀錄';
  } else if (st.yieldMode === 'estimate') {
    yieldPct = holdingsWan > 0 ? (wan(auto.estimateAnnualDiv) / holdingsWan) * 100 : 0;
    yieldNote = auto.estimateMissing > 0 ? (auto.estimateMissing + ' 檔還沒填預估股利，以 0 計算，殖利率會偏低') : '依「年度預估股利」';
  }

  const nHalf = Math.max(0, Math.round(st.halfAge - st.curAge));
  const nFull = Math.max(0, Math.round(st.fullAge - st.curAge));
  const years = Math.max(nHalf, nFull);
  const r = st.stockReturn / 100;
  const mid = st.midYear ? 1 : 0;           // 1＝當年投入的錢只算半年報酬
  const stock = [], crash = [], total = [], rows = [];
  const accSeries = st.accounts.map(() => []);
  let sv = stockPV;
  const accNow = st.accounts.map(a => a.balance);
  for (let n = 0; n <= years; n++) {
    if (n > 0) {
      sv = sv * (1 + r) + dca * 12 * (1 + (mid ? r / 2 : 0));
      st.accounts.forEach((a, i) => {
        const ar = a.rate / 100;
        // 這一年有沒有新增：沒設停止年齡＝一直新增；有設＝到那個年齡為止
        let adds = a.growthMode === 'fixed'
          ? a.yearlyAdd + (a.growth || 0) * (n - 1)                    // 每年固定多加同樣的金額（萬）
          : a.yearlyAdd * Math.pow(1 + (a.growth || 0) / 100, n - 1);  // 每年成長幾 %
        if (a.capAdd > 0) adds = Math.min(adds, a.capAdd);             // 到上限就不再增加
        if (a.stopAge && (st.curAge + n) > a.stopAge) adds = 0;        // 超過停止年齡不再新增
        accNow[i] = accNow[i] * (1 + ar) + adds * (1 + (mid ? ar / 2 : 0));
      });
    }
    stock.push(sv);
    crash.push(sv * (1 - st.crashDrop / 100));
    let accSum = 0;
    accNow.forEach((v, i) => { accSeries[i].push(v); accSum += v; });
    total.push(sv + accSum);
    rows.push({ n, age: st.curAge + n, stock: sv, acc: accNow.slice(), accSum, total: sv + accSum });
  }
  const y = yieldPct / 100;
  const accAtFull = st.accounts.map((a, i) => ({ name: a.name || '（未命名）', value: accSeries[i][Math.min(nFull, years)] }));
  return {
    stockPV, dca, yieldPct, yieldNote, nHalf, nFull, years, stock, crash, total, rows,
    pensionMonthly: st.accounts.reduce((sum, a) => sum + (a.pension || 0), 0),
    half: { stock: stock[nHalf], monthlyDiv: stock[nHalf] * y / 12, crash: crash[nHalf], crashMonthlyDiv: crash[nHalf] * y / 12 },
    full: {
      stock: stock[nFull], monthlyDiv: stock[nFull] * y / 12,
      accounts: accAtFull,
      accTotal: accAtFull.reduce((s, a) => s + a.value, 0),
      total: total[nFull]
    }
  };
}

/* ====== 畫面 ====== */
let retirementChart = null;

function retFmt(v, d) {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  return Number(v).toLocaleString('zh-TW', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function retWan(v) { return retFmt(v, 0) + ' 萬'; }

function renderRetirement() {
  renderRetirementSettings();
  updateRetirementResults();
}

function retRadio(name, value, checked, label) {
  return `<label class="ret-radio"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} onchange="retSetMode('${name}', '${value}')"> ${label}</label>`;
}

function renderRetirementSettings() {
  const box = document.getElementById('retirementSettings');
  if (!box) return;
  const st = retirementSettings;
  const auto = retirementAutoData();
  const wan = v => retFmt(v / 10000, 1);
  const noHoldings = auto.holdingsValue <= 0;

  const stockAutoInfo = noHoldings
    ? '股票管理裡還沒有持股資料'
    : `持股現值 ${wan(auto.holdingsValue)} 萬（其中出借中 ${wan(auto.lentValue)} 萬）`;
  const dcaAutoInfo = auto.dcaMonthly <= 0 ? '定期定額分頁還沒有資料' : `每月 ${wan(auto.dcaMonthly)} 萬`;

  let yieldInfo = '';
  const holdingsWan = auto.holdingsValue / 10000;
  const actualPct = holdingsWan > 0 ? (auto.actualAnnualDiv / 10000 / holdingsWan) * 100 : 0;
  const estPct = holdingsWan > 0 ? (auto.estimateAnnualDiv / 10000 / holdingsWan) * 100 : 0;

  const accRows = st.accounts.map((a, i) => `
    <tr>
      <td><input type="text" class="ret-input ret-input-name" value="${esc(a.name)}" placeholder="專戶名稱" oninput="retSetAccount(${i}, 'name', this.value)"></td>
      <td><input type="number" step="any" class="ret-input" value="${esc(a.balance)}" oninput="retSetAccount(${i}, 'balance', this.value)"></td>
      <td><input type="number" step="any" class="ret-input" value="${esc(a.yearlyAdd)}" oninput="retSetAccount(${i}, 'yearlyAdd', this.value)"></td>
      <td><input type="number" step="0.1" class="ret-input" value="${esc(a.rate)}" oninput="retSetAccount(${i}, 'rate', this.value)"></td>
      <td class="ret-growth-cell"><select class="ret-input" onchange="retSetAccountMode(${i}, this.value)"><option value="pct" ${a.growthMode === 'pct' ? 'selected' : ''}>每年成長 %</option><option value="fixed" ${a.growthMode === 'fixed' ? 'selected' : ''}>每年固定增加（萬）</option></select>
        <input type="number" step="any" class="ret-input" value="${esc(a.growth)}" oninput="retSetAccount(${i}, 'growth', this.value)"></td>
      <td><input type="number" step="any" class="ret-input" value="${esc(a.capAdd)}" oninput="retSetAccount(${i}, 'capAdd', this.value)"></td>
      <td><input type="number" step="1" class="ret-input" value="${esc(a.stopAge)}" oninput="retSetAccount(${i}, 'stopAge', this.value)"></td>
      <td><input type="number" step="any" class="ret-input" value="${esc(a.pension)}" oninput="retSetAccount(${i}, 'pension', this.value)"></td>
      <td><button class="btn-del" title="刪除這個專戶" onclick="retRemoveAccount(${i})">✕</button></td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="ret-grid">
      <div class="ret-group">
        <h3>👤 年齡與情境</h3>
        <label class="ret-field"><span>目前年齡</span><input type="number" step="1" class="ret-input" value="${esc(st.curAge)}" oninput="retSetNum('curAge', this.value)"></label>
        <label class="ret-field"><span>半退休年齡</span><input type="number" step="1" class="ret-input" value="${esc(st.halfAge)}" oninput="retSetNum('halfAge', this.value)"></label>
        <label class="ret-field"><span>完整退休年齡（開始領退休專戶）</span><input type="number" step="1" class="ret-input" value="${esc(st.fullAge)}" oninput="retSetNum('fullAge', this.value)"></label>
        <label class="ret-field"><span>股災情境：股票市值下跌 (%)</span><input type="number" step="1" min="0" max="95" class="ret-input" value="${esc(st.crashDrop)}" oninput="retSetNum('crashDrop', this.value)"></label>
      </div>

      <div class="ret-group">
        <h3>📈 股票</h3>
        <div class="ret-sub">目前股票現值</div>
        <div class="ret-radios">
          ${retRadio('stockMode', 'auto', st.stockMode === 'auto', '自動帶入我的持股')}
          ${retRadio('stockMode', 'manual', st.stockMode === 'manual', '手動輸入')}
        </div>
        ${st.stockMode === 'auto'
          ? `<div class="ret-hint">${stockAutoInfo}</div>
             <label class="ret-check"><input type="checkbox" ${st.includeLent ? 'checked' : ''} onchange="retSetCheck('includeLent', this.checked)"> 出借中的股票再另外加算<br><small>（若你的「持有股數」本來就已包含出借的股數，請取消勾選，避免重複計算）</small></label>`
          : `<label class="ret-field"><span>現值（萬元）</span><input type="number" step="any" class="ret-input" value="${esc(st.stockManual)}" oninput="retSetNum('stockManual', this.value)"></label>`}

        <div class="ret-sub">每月定期定額</div>
        <div class="ret-radios">
          ${retRadio('dcaMode', 'auto', st.dcaMode === 'auto', '自動帶入定期定額')}
          ${retRadio('dcaMode', 'manual', st.dcaMode === 'manual', '手動輸入')}
        </div>
        ${st.dcaMode === 'auto'
          ? `<div class="ret-hint">${dcaAutoInfo}</div>`
          : `<div class="ret-slider-row"><input type="range" min="0" max="10" step="0.1" value="${esc(st.dcaManual)}" oninput="retSetNum('dcaManual', this.value); document.getElementById('retDcaLbl').textContent = parseFloat(this.value).toFixed(1) + ' 萬'"><span class="ret-badge" id="retDcaLbl">${retFmt(st.dcaManual, 1)} 萬</span></div>`}

        <div class="ret-sub">股票預估年化報酬率</div>
        <div class="ret-slider-row"><input type="range" min="2" max="12" step="0.5" value="${esc(st.stockReturn)}" oninput="retSetNum('stockReturn', this.value); document.getElementById('retReturnLbl').textContent = parseFloat(this.value).toFixed(1) + '%'"><span class="ret-badge" id="retReturnLbl">${retFmt(st.stockReturn, 1)}%</span></div>
        <label class="ret-check"><input type="checkbox" ${st.midYear ? 'checked' : ''} onchange="retSetCheck('midYear', this.checked)"> 每年投入的錢分散在全年（當年只算半年報酬）<br><small>（定期定額是每個月陸續扣，所以建議勾選；取消勾選會當成每年年底一次投入，結果較保守。專戶新增金額也同樣處理）</small></label>

        <div class="ret-sub">現金殖利率（用來估算每月被動股息）</div>
        <div class="ret-radios ret-radios-col">
          ${retRadio('yieldMode', 'manual', st.yieldMode === 'manual', '手動設定')}
          ${retRadio('yieldMode', 'actual', st.yieldMode === 'actual', `過去一年實際領到的 <b>${retFmt(actualPct, 2)}%</b>`)}
          ${retRadio('yieldMode', 'estimate', st.yieldMode === 'estimate', `年度預估股利 <b>${retFmt(estPct, 2)}%</b>`)}
        </div>
        ${st.yieldMode === 'manual'
          ? `<div class="ret-slider-row"><input type="range" min="2" max="9" step="0.1" value="${esc(st.yieldManual)}" oninput="retSetNum('yieldManual', this.value); document.getElementById('retYieldLbl').textContent = parseFloat(this.value).toFixed(1) + '%'"><span class="ret-badge" id="retYieldLbl">${retFmt(st.yieldManual, 1)}%</span></div>`
          : `<div class="ret-hint" id="retYieldNote"></div>`}
      </div>
    </div>

    <div class="ret-group ret-accounts">
      <h3>🏦 退休專戶 <small>（退撫基金、勞退、年金保險或其他長期存放的帳戶，可自行新增）</small></h3>
      <div class="ret-table-wrap">
        <table class="ret-table">
          <thead><tr><th>名稱</th><th>目前餘額（萬）</th><th>每年新增（萬）</th><th>年化報酬（%）</th><th>每年新增金額的增加方式</th><th>每年新增金額上限（萬，0＝不限）</th><th>新增到幾歲為止（0＝不限）</th><th>退休後每月另領（萬）</th><th></th></tr></thead>
          <tbody>${accRows || '<tr><td colspan="9" class="ret-empty">還沒有專戶，按下面的按鈕新增</td></tr>'}</tbody>
        </table>
      </div>
      <div class="ret-hint">「新增到幾歲為止」填 0 代表一直新增；例如填 59，就是 59 歲之後不再投入。「每年新增金額的增加方式」可用來表示薪水調升帶來的提撥增加：選「成長 %」是每年多存上一年的幾 %；選「每年固定增加」是每年多存同樣的金額（萬）；若有「上限」，增加到上限就不再增加。「退休後每月另領」只用來顯示在摘要，不會算進資產。</div>
      <button class="btn btn-outline" onclick="retAddAccount()">➕ 新增專戶</button>
    </div>
  `;
}

function retTouch() { retirementSettings.touched = true; saveRetirementSettings(); }

function retSetNum(key, value) {
  const v = parseFloat(value);
  retirementSettings[key] = isFinite(v) ? v : 0;
  retTouch();
  updateRetirementResults();
}
function retSetCheck(key, checked) { retirementSettings[key] = !!checked; retTouch(); renderRetirement(); }
function retSetMode(key, value) { retirementSettings[key] = value; retTouch(); renderRetirement(); }
function retSetAccount(i, field, value) {
  const a = retirementSettings.accounts[i];
  if (!a) return;
  if (field === 'name') a.name = value;
  else { const v = parseFloat(value); a[field] = isFinite(v) ? v : 0; }
  retTouch();
  updateRetirementResults();
}
function retSetAccountMode(i, mode) {
  const a = retirementSettings.accounts[i];
  if (!a) return;
  a.growthMode = mode === 'fixed' ? 'fixed' : 'pct';
  retTouch(); updateRetirementResults();
}
function retAddAccount() {
  retirementSettings.accounts.push({ id: 'acc_' + Date.now(), name: '', balance: 0, yearlyAdd: 0, rate: 4, growthMode: 'pct', growth: 0, capAdd: 0, stopAge: 0, pension: 0 });
  retTouch(); renderRetirement();
}
function retRemoveAccount(i) {
  if (!retirementSettings.accounts[i]) return;
  if (!confirm('確定要刪除這個專戶嗎？')) return;
  retirementSettings.accounts.splice(i, 1);
  retTouch(); renderRetirement();
}
function retResetDefaults() {
  if (!confirm('要把退休試算的所有數字還原成範例嗎？（你填的設定會消失）')) return;
  retirementSettings = retirementDefaults();
  saveRetirementSettings();
  renderRetirement();
}

function updateRetirementResults() {
  const st = retirementSettings;
  const auto = retirementAutoData();
  const c = retirementCompute(st, auto);
  const $ = id => document.getElementById(id);

  const sample = $('retSampleNotice');
  if (sample) sample.style.display = st.touched ? 'none' : 'block';

  // 年齡檢查
  const warn = $('retWarning');
  const problems = [];
  if (st.halfAge < st.curAge) problems.push('半退休年齡比目前年齡小，已當成「現在」計算');
  if (st.fullAge < st.halfAge) problems.push('完整退休年齡比半退休年齡小，請檢查');
  if (st.fullAge < st.curAge) problems.push('完整退休年齡比目前年齡小，已當成「現在」計算');
  if (warn) { warn.style.display = problems.length ? 'block' : 'none'; warn.textContent = problems.join('；'); }

  const yn = $('retYieldNote');
  if (yn) yn.textContent = `殖利率 ${retFmt(c.yieldPct, 2)}%：${c.yieldNote}`;

  // 卡片
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  set('retTitleHalf', `${st.halfAge} 歲預估股票市值（${c.nHalf} 年後）`);
  set('retValHalf', retWan(c.half.stock));
  set('retSubHalf', `月被動股息約 ${retFmt(c.half.monthlyDiv, 1)} 萬元`);
  set('retTitleCrash', `${st.halfAge} 歲股災防禦線（跌 ${retFmt(st.crashDrop, 0)}%）`);
  set('retValCrash', retWan(c.half.crash));
  set('retSubCrash', `防禦月股息約 ${retFmt(c.half.crashMonthlyDiv, 1)} 萬元`);
  set('retTitleAcc', `${st.fullAge} 歲退休專戶總額`);
  set('retValAcc', retWan(c.full.accTotal));
  set('retSubAcc', (c.full.accounts.length ? c.full.accounts.map(a => `${a.name} ${retFmt(a.value, 0)}萬`).join(' ＋ ') : '尚未設定專戶')
    + (c.pensionMonthly > 0 ? `；另每月可領 ${retFmt(c.pensionMonthly, 2)} 萬` : ''));
  set('retTitleTotal', `${st.fullAge} 歲全體總身價（${c.nFull} 年後）`);
  set('retValTotal', retWan(c.full.total));
  set('retSubTotal', `其中股票約 ${retFmt(c.full.stock, 0)} 萬，股息月領約 ${retFmt(c.full.monthlyDiv, 1)} 萬`);

  // 說明
  const info = $('retInfo');
  if (info) {
    info.innerHTML = `
      <strong>🎯 兩個人生里程碑：</strong><br>
      • <strong>${esc(st.halfAge)} 歲半退休（${c.nHalf} 年後）</strong>：股票市值約 ${retWan(c.half.stock)}，以殖利率 ${retFmt(c.yieldPct, 1)}% 估算，每月被動股息約 ${retFmt(c.half.monthlyDiv, 1)} 萬元；若市場下跌 ${retFmt(st.crashDrop, 0)}%，市值約 ${retWan(c.half.crash)}，月股息約 ${retFmt(c.half.crashMonthlyDiv, 1)} 萬元。<br>
      • <strong>${esc(st.fullAge)} 歲完整退休（${c.nFull} 年後）</strong>：退休專戶合計約 ${retWan(c.full.accTotal)}，加上股票約 ${retWan(c.full.stock)}，全體總身價約 ${retWan(c.full.total)}。<br>
      <small>算法為簡化版：每年複利一次，${st.midYear ? '每年投入的錢當成分散在全年（只算半年報酬）' : '每年底一次投入'}；沒有考慮通膨、稅負與手續費。這份試算只是幫你概略比較不同情境，不是投資建議。</small>`;
  }

  // 逐年明細表
  const detail = $('retDetail');
  if (detail) {
    const rocNow = new Date().getFullYear() - 1911;
    const head = `<tr><th>年齡（民國年）</th><th>股票市值</th><th>預估月股息</th>${st.accounts.map(a => `<th>${esc(a.name || '（未命名）')}</th>`).join('')}<th>專戶合計</th><th>全體總資產</th></tr>`;
    const body = c.rows.map(r => {
      const hl = (r.age === st.halfAge || r.age === st.fullAge) ? ' class="ret-hl"' : '';
      return `<tr${hl}><td>${esc(r.age)} 歲（${rocNow + r.n} 年）</td><td>${retFmt(r.stock, 1)} 萬</td><td>${retFmt(r.stock * c.yieldPct / 100 / 12 * 10000, 0)} 元</td>${r.acc.map(v => `<td>${retFmt(v, 1)} 萬</td>`).join('')}<td>${retFmt(r.accSum, 1)} 萬</td><td><strong>${retFmt(r.total, 1)} 萬</strong></td></tr>`;
    }).join('');
    detail.innerHTML = `<div class="ret-table-wrap ret-detail-wrap"><table class="ret-table ret-detail"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  // 圖表
  const labels = [];
  for (let n = 0; n <= c.years; n++) labels.push((st.curAge + n) + '歲（' + n + '年）');
  const box = $('retChartBox');
  if (typeof Chart === 'undefined') {
    if (box && !box.dataset.noChart) { box.dataset.noChart = '1'; box.innerHTML = '<div class="ret-hint" style="padding:30px;text-align:center;">圖表套件沒有載入（可能是網路問題），數字仍可正常使用。</div>'; }
    return;
  }
  const canvas = $('retChart');
  if (!canvas) return;
  if (!retirementChart) {
    retirementChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [
        { label: '全體總資產（股票＋退休專戶）', borderColor: '#766c5a', backgroundColor: 'rgba(118,108,90,0.10)', data: c.total, borderWidth: 3, fill: true, tension: 0.2 },
        { label: '股票市值', borderColor: '#4a7c59', borderDash: [5, 5], data: c.stock, borderWidth: 2, tension: 0.2 },
        { label: '股災情境下的股票市值', borderColor: '#a8543d', borderDash: [3, 3], data: c.crash, borderWidth: 1.5, tension: 0.2 }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#5c5445', font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label + '：' + Math.round(ctx.raw).toLocaleString() + ' 萬元' } } },
        scales: { x: { ticks: { color: '#93897a', maxTicksLimit: 8 }, grid: { color: '#ece6d9' } },
          y: { ticks: { color: '#93897a', callback: v => v + '萬' }, grid: { color: '#ece6d9' } } }
      }
    });
  } else {
    retirementChart.data.labels = labels;
    retirementChart.data.datasets[0].data = c.total;
    retirementChart.data.datasets[1].data = c.stock;
    retirementChart.data.datasets[2].data = c.crash;
    retirementChart.update();
  }
}
