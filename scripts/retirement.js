/* ========================================================================
   退休試算（想退休的年齡 / 開始領退休專戶 的資產試算）
   ------------------------------------------------------------------------
   - 所有設定存在瀏覽器本機 localStorage（RETIREMENT_SETTINGS_V1），可隨「匯出備份 (JSON)」一起備份。
   - 股票現值、每月定期定額、殖利率可以「自動帶入」股票管理裡已輸入的資料，也可以手動輸入。
   - 退休專戶（例如退撫基金、勞退、其他長期帳戶）由使用者自行新增、命名與設定。
   - 單位：畫面上的金額一律是「萬元」；股票管理裡的資料是「元」，帶入時 ÷ 10000。
   - 計算方式：股票與專戶都是「逐月」計算（每月月初投入，年化報酬換成等效月報酬），只用來概略比較，不是投資建議。
   ======================================================================== */

const RETIREMENT_STORAGE_KEY = 'RETIREMENT_SETTINGS_V1';


function retirementDefaults() {
  return {
    touched: false,          // 使用者是否改過任何數字（沒改過就顯示「這是範例」提示）
    curAge: 35,
    halfAge: 50,             // 我想退休的年齡（儲存欄位沿用舊名 halfAge，才不會讓舊設定失效）
    fullAge: 60,             // 開始領退休專戶的年齡（儲存欄位沿用舊名 fullAge）
    crashDrop: 25,           // 股災情境：股票市值下跌 %
    inflation: 2,            // 預估通膨率 %（只用來換算「相當於今天多少錢」，不影響上面的數字）
    stockMode: 'manual',     // 'auto' 自動帶入持股現值 | 'manual' 手動輸入
    stockManual: 100,        // 萬元
    includeLent: true,       // 自動帶入時，出借中的股票是否另外加算
    dcaMode: 'manual',       // 'auto' | 'manual'
    dcaManual: 1.5,          // 萬元 / 月
    stockReturn: 8,          // 股票年化報酬 %
    yieldMode: 'manual',     // 'manual' | 'actual' 過去一年實際領到 | 'estimate' 年度預估股利
    yieldManual: 5.5,        // %
    accounts: [
      retNewAccount({ id: 'acc_demo_1', name: '退休專戶 A（範例）', balance: 50, yearlyAdd: 10, rate: 5 }),
      retNewAccount({ id: 'acc_demo_2', name: '退休專戶 B（範例）', balance: 30, yearlyAdd: 0, rate: 4 })
    ]
  };
}

// 一個專戶的完整欄位（缺的欄位用預設值補齊）
function retNewAccount(o) {
  return Object.assign({
    id: 'acc_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    name: '', balance: 0, rate: 4,
    addMode: 'direct',        // 'direct' 直接填每年新增金額 | 'salary' 用薪額算
    yearlyAdd: 0,             // direct：每年新增（萬）
    salary: 0, salaryMult: 2, salaryRate: 15, salaryInc: 0, salaryCap: 0,  // salary：月薪額（元）、倍數、提撥率 %、每年薪額增加（元）、薪額上限（元）
    stopAge: 0,               // 新增到幾歲為止（0＝不限）
    pension: 0,               // 退休後每月另領（萬），只顯示
    payYears: 0, payRate: 1   // 餘額分幾年領（0＝不計算）、領取期間年化報酬 %
  }, o || {});
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
  out.inflation = Math.min(30, Math.max(0, num(raw.inflation, d.inflation)));
  out.stockMode = raw.stockMode === 'auto' ? 'auto' : 'manual';
  out.stockManual = num(raw.stockManual, d.stockManual);
  out.includeLent = !!raw.includeLent;
  out.dcaMode = raw.dcaMode === 'auto' ? 'auto' : 'manual';
  out.dcaManual = num(raw.dcaManual, d.dcaManual);
  out.stockReturn = num(raw.stockReturn, d.stockReturn);
  out.yieldMode = ['manual', 'actual', 'estimate'].includes(raw.yieldMode) ? raw.yieldMode : 'manual';
  out.yieldManual = num(raw.yieldManual, d.yieldManual);
  if (Array.isArray(raw.accounts)) {
    out.accounts = raw.accounts.map((a, i) => {
      a = a || {};
      const d0 = retNewAccount({});
      return {
        id: String(a.id || ('acc_' + Date.now() + '_' + i)),
        name: String(a.name || ''),
        balance: num(a.balance, 0),
        rate: num(a.rate, d0.rate),
        addMode: a.addMode === 'salary' ? 'salary' : 'direct',
        yearlyAdd: num(a.yearlyAdd, 0),
        salary: Math.max(0, num(a.salary, 0)),
        salaryMult: Math.max(0, num(a.salaryMult, d0.salaryMult)),
        salaryRate: Math.max(0, num(a.salaryRate, d0.salaryRate)),
        salaryInc: Math.max(0, num(a.salaryInc, 0)),
        salaryCap: Math.max(0, num(a.salaryCap, 0)),
        stopAge: Math.max(0, num(a.stopAge, 0)),
        pension: Math.max(0, num(a.pension, 0)),
        payYears: Math.max(0, num(a.payYears, 0)),
        payRate: Math.max(0, num(a.payRate, d0.payRate))
      };
    });
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
// 第 n 年（從現在起算）這個專戶一整年會新增多少（萬）
function retAccountYearAdd(a, curAge, n) {
  if (a.stopAge > 0 && (curAge + n) > a.stopAge) return 0;      // 超過停止年齡就不再新增
  if (a.addMode === 'salary') {
    let sal = a.salary + a.salaryInc * (n - 1);                  // 薪額每年增加固定金額（預估）
    if (a.salaryCap > 0) sal = Math.min(sal, a.salaryCap);       // 到薪額上限就不再增加
    return sal * a.salaryMult * (a.salaryRate / 100) * 12 / 10000;
  }
  return a.yearlyAdd;
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
  // 逐月計算：年化報酬換成「等效月報酬」，每月月初投入當月的錢
  const monthRate = ann => Math.pow(1 + ann / 100, 1 / 12) - 1;
  const iStock = monthRate(st.stockReturn);
  const stock = [], crash = [], total = [], rows = [];
  const accSeries = st.accounts.map(() => []);
  let sv = stockPV;
  const accNow = st.accounts.map(a => a.balance);
  for (let n = 0; n <= years; n++) {
    if (n > 0) {
      for (let m = 0; m < 12; m++) sv = (sv + dca) * (1 + iStock);
      st.accounts.forEach((a, i) => {
        const ia = monthRate(a.rate);
        const monthlyAdd = retAccountYearAdd(a, st.curAge, n) / 12;
        for (let m = 0; m < 12; m++) accNow[i] = (accNow[i] + monthlyAdd) * (1 + ia);
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
  // 退休後分幾年領：每月可領＝把退休那天的餘額，在「領取期間報酬率」下，平均分成 N 年的每月給付
  const monthlyPay = (value, a) => {
    if (!(a.payYears > 0)) return 0;
    const N = Math.round(a.payYears * 12), m = a.payRate / 100 / 12;
    return m > 0 ? value * m / (1 - Math.pow(1 + m, -N)) : value / N;
  };
  const accAtFull = st.accounts.map((a, i) => {
    const value = accSeries[i][Math.min(nFull, years)];
    return { name: a.name || '（未命名）', value, monthly: monthlyPay(value, a) };
  });
  const inflFull = Math.pow(1 + st.inflation / 100, nFull), inflHalf = Math.pow(1 + st.inflation / 100, nHalf);
  return {
    stockPV, dca, yieldPct, yieldNote, nHalf, nFull, years, stock, crash, total, rows,
    pensionMonthly: st.accounts.reduce((sum, a) => sum + (a.pension || 0), 0),
    payoutMonthly: accAtFull.reduce((sum, a) => sum + a.monthly, 0),
    realHalfStock: stock[nHalf] / inflHalf, realFullTotal: total[nFull] / inflFull,
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

/* ====== 欄位旁的「？」說明（點一下展開／收起） ====== */
const RET_HELP = {
  curAge: '你現在幾歲。',
  wantAge: '你希望在幾歲開始不再靠上班賺錢、改靠股票和存款生活。程式會算出那一年你的股票市值與每月股息。這是你自己的目標，不是法定退休年齡。',
  payAge: '退休專戶開始可以領錢的年齡。程式用這個年齡的專戶餘額，算出「專戶總額」與「每月可領」。實際幾歲才能領，請查法規或問服務單位人事室。',
  inflation: '物價每年大概上漲多少 %。只用來把未來的錢換算成「相當於今天多少錢」，不會改變其他數字。',
  crash: '假設在「我想退休的年齡」那一年，股市突然下跌這麼多 %，看看股票還剩多少、每月股息會少多少。',
  stockNow: '你現在手上股票的總價值。選「自動帶入」會從「股票管理」裡抓；也可以自己輸入。',
  dca: '每個月固定投入股票的金額（萬元）。程式假設每個月月初扣一次，每個月都計算一次報酬。',
  stockReturn: '股票每年平均大約賺幾 %（含股息再投入，沒有扣掉通膨）。這是你的假設，沒有人能預知，建議先填保守的數字，再多試幾組看差距。',
  yield: '用來估算每月能領多少股息：股票市值 × 殖利率 ÷ 12。可以手動填、用你過去一年實際領到的，或用「年度預估股利」。',
  accName: '幫這個專戶取個好認的名字，例如「公教專戶」、「勞退」。',
  accBalance: '這個專戶現在帳戶裡有多少錢（萬元）。',
  accRate: '專戶每年大約賺幾 %（沒有扣掉通膨）。這是假設，沒有人能預知。可以查管理單位公布的歷年收益率當參考，建議保守一點，多試幾組。如果你參考的是「扣掉通膨後」的實質報酬，要先加上通膨率再填（例如實質 2% ＋ 通膨 2% ≈ 4%）。',
  accMode: '每年存進專戶的錢要怎麼填：「直接填金額」適合每年固定的金額；「用薪額算」適合每月依薪水比例提撥的專戶（例如公教專戶），可設定薪額每年增加多少、到頂就不再增加。',
  yearlyAdd: '每年存進這個專戶的總金額（萬元），政府或單位出的加上你自己出的都算進去。',
  salary: '你現在的月薪額（元），也就是用來計算提撥的那個薪額。請照薪資單或人事室告知的數字填。',
  salaryMult: '提撥時，薪額要乘以幾倍。之前那份模擬器用 2；實際倍數請以人事室為準。勞退等其他專戶多半是 1。',
  salaryRate: '每月提撥金額佔薪額的百分比。依教師退休金試算網站的說明，教師個人專戶制的法定提撥是 15%（政府 9.75%＋本人 5.25%）；請以人事室為準。',
  salaryInc: '預估每年薪額會增加多少元（例如每年晉一級增加的金額）。這是預估值，實際會依你的晉級和政府調薪而不同。',
  salaryCap: '薪額最高只會加到多少元（薪級表的最高一級）。到了這個數字就不再增加。填 0 代表沒有上限。',
  stopAge: '你預計還在職、還有提撥進專戶的最後年齡。例如 40 歲就不當老師，就填 40；之後專戶裡的錢仍會繼續依年化報酬增長。填 0 代表一直提撥。',
  pension: '退休後每個月固定領到的錢（萬元），例如年金或月領的給付。只顯示在摘要，不會算進資產。',
  payYears: '退休專戶開始領的時候，打算分幾年慢慢領完。填 30，就是平均分成 360 個月，算出每月可領多少。填 0 代表不計算。',
  payRate: '開始領之後，還沒領出來的錢繼續放著，每年賺多少 %。通常比累積期保守。教師退休金試算網站預設是 1%（扣掉通膨後）。'
};
function retHelp(key) {
  const t = RET_HELP[key] || '';
  return `<span class="ret-help" role="button" tabindex="0" title="點一下看說明" onclick="retToggleHelp(event, this)" onkeydown="if(event.key==='Enter'||event.key===' '){retToggleHelp(event, this)}">?</span><span class="ret-help-text">${esc(t)}</span>`;
}
function retToggleHelp(e, el) {
  e.preventDefault(); e.stopPropagation();
  const t = el.nextElementSibling;
  if (t) t.classList.toggle('open');
}

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

  const accField = (label, helpKey, inputHtml) => `<label class="ret-field"><span>${label} ${retHelp(helpKey)}</span>${inputHtml}</label>`;
  const accNum = (i, field, val, step) => `<input type="number" step="${step || 'any'}" class="ret-input" value="${esc(val)}" oninput="retSetAccount(${i}, '${field}', this.value)">`;
  const accCards = st.accounts.map((a, i) => {
    const addFields = a.addMode === 'salary'
      ? accField('目前月薪額（元）', 'salary', accNum(i, 'salary', a.salary, 1))
        + accField('薪額乘以幾倍', 'salaryMult', accNum(i, 'salaryMult', a.salaryMult, 0.1))
        + accField('提撥率（%）', 'salaryRate', accNum(i, 'salaryRate', a.salaryRate, 0.01))
        + accField('預估每年薪額增加（元）', 'salaryInc', accNum(i, 'salaryInc', a.salaryInc, 1))
        + accField('薪額上限（元，0＝不限）', 'salaryCap', accNum(i, 'salaryCap', a.salaryCap, 1))
        + `<div class="ret-hint ret-span">第 1 年新增約 <b id="retAccHint_${i}">${retFmt(retAccountYearAdd(a, st.curAge, 1), 2)}</b> 萬</div>`
      : accField('每年新增（萬）', 'yearlyAdd', accNum(i, 'yearlyAdd', a.yearlyAdd));
    return `
    <div class="ret-acc-card">
      <div class="ret-acc-head">
        <input type="text" class="ret-input ret-input-name" value="${esc(a.name)}" placeholder="專戶名稱，例如：公教專戶" oninput="retSetAccount(${i}, 'name', this.value)">
        ${retHelp('accName')}
        <button class="btn-del" title="刪除這個專戶" onclick="retRemoveAccount(${i})">✕</button>
      </div>
      <div class="ret-acc-grid">
        ${accField('目前餘額（萬）', 'accBalance', accNum(i, 'balance', a.balance))}
        ${accField('年化報酬（%）', 'accRate', accNum(i, 'rate', a.rate, 0.1))}
        ${accField('新增到幾歲為止（0＝不限）', 'stopAge', accNum(i, 'stopAge', a.stopAge, 1))}
        ${accField('每年新增的填法', 'accMode', `<select class="ret-input" onchange="retSetAccountMode(${i}, this.value)"><option value="direct" ${a.addMode === 'direct' ? 'selected' : ''}>直接填金額</option><option value="salary" ${a.addMode === 'salary' ? 'selected' : ''}>用薪額算</option></select>`)}
        ${addFields}
        ${accField('餘額分幾年領（0＝不計算）', 'payYears', accNum(i, 'payYears', a.payYears, 1))}
        ${accField('領取期間年化報酬（%）', 'payRate', accNum(i, 'payRate', a.payRate, 0.1))}
        ${accField('退休後每月另領（萬）', 'pension', accNum(i, 'pension', a.pension))}
      </div>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="ret-grid">
      <div class="ret-group">
        <h3>👤 年齡與情境</h3>
        <label class="ret-field"><span>目前年齡 ${retHelp('curAge')}</span><input type="number" step="1" class="ret-input" value="${esc(st.curAge)}" oninput="retSetNum('curAge', this.value)"></label>
        <label class="ret-field"><span>我想退休的年齡 ${retHelp('wantAge')}</span><input type="number" step="1" class="ret-input" value="${esc(st.halfAge)}" oninput="retSetNum('halfAge', this.value)"></label>
        <label class="ret-field"><span>開始領退休專戶的年齡 ${retHelp('payAge')}</span><input type="number" step="1" class="ret-input" value="${esc(st.fullAge)}" oninput="retSetNum('fullAge', this.value)"></label>
        <label class="ret-field"><span>預估通膨率 (%) ${retHelp('inflation')}</span><input type="number" step="0.1" min="0" max="30" class="ret-input" value="${esc(st.inflation)}" oninput="retSetNum('inflation', this.value)"></label>
        <label class="ret-field"><span>股災情境：股票市值下跌 (%) ${retHelp('crash')}</span><input type="number" step="1" min="0" max="95" class="ret-input" value="${esc(st.crashDrop)}" oninput="retSetNum('crashDrop', this.value)"></label>
      </div>

      <div class="ret-group">
        <h3>📈 股票</h3>
        <div class="ret-sub">目前股票現值 ${retHelp('stockNow')}</div>
        <div class="ret-radios">
          ${retRadio('stockMode', 'auto', st.stockMode === 'auto', '自動帶入我的持股')}
          ${retRadio('stockMode', 'manual', st.stockMode === 'manual', '手動輸入')}
        </div>
        ${st.stockMode === 'auto'
          ? `<div class="ret-hint">${stockAutoInfo}</div>
             <label class="ret-check"><input type="checkbox" ${st.includeLent ? 'checked' : ''} onchange="retSetCheck('includeLent', this.checked)"> 出借中的股票再另外加算<br><small>（若你的「持有股數」本來就已包含出借的股數，請取消勾選，避免重複計算）</small></label>`
          : `<label class="ret-field"><span>現值（萬元）</span><input type="number" step="any" class="ret-input" value="${esc(st.stockManual)}" oninput="retSetNum('stockManual', this.value)"></label>`}

        <div class="ret-sub">每月定期定額 ${retHelp('dca')}</div>
        <div class="ret-radios">
          ${retRadio('dcaMode', 'auto', st.dcaMode === 'auto', '自動帶入定期定額')}
          ${retRadio('dcaMode', 'manual', st.dcaMode === 'manual', '手動輸入')}
        </div>
        ${st.dcaMode === 'auto'
          ? `<div class="ret-hint">${dcaAutoInfo}</div>`
          : `<div class="ret-slider-row"><input type="range" min="0" max="10" step="0.1" value="${esc(st.dcaManual)}" oninput="retSetNum('dcaManual', this.value); document.getElementById('retDcaLbl').textContent = parseFloat(this.value).toFixed(1) + ' 萬'"><span class="ret-badge" id="retDcaLbl">${retFmt(st.dcaManual, 1)} 萬</span></div>`}

        <div class="ret-sub">股票預估年化報酬率 ${retHelp('stockReturn')}</div>
        <div class="ret-slider-row"><input type="range" min="2" max="12" step="0.5" value="${esc(st.stockReturn)}" oninput="retSetNum('stockReturn', this.value); document.getElementById('retReturnLbl').textContent = parseFloat(this.value).toFixed(1) + '%'"><span class="ret-badge" id="retReturnLbl">${retFmt(st.stockReturn, 1)}%</span></div>

        <div class="ret-sub">現金殖利率（用來估算每月被動股息） ${retHelp('yield')}</div>
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
      ${accCards || '<div class="ret-empty">還沒有專戶，按下面的按鈕新增</div>'}
      <div class="ret-hint">💡 公立學校教師若是 112 年 7 月以後初任的「個人專戶制」，依<a href="https://pension-calculation.netlify.app/" target="_blank" rel="noopener noreferrer">教師退休金試算網站</a>的說明，每月提撥是薪額的 15%（政府 9.75%＋本人 5.25%），本人還可以自願多提繳（上限 5.25%）；選「用薪額算」，把提撥率填進去即可。實際制度與金額請以服務單位人事室為準。</div>
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
  const hint = document.getElementById('retAccHint_' + i);
  if (hint) hint.textContent = retFmt(retAccountYearAdd(a, retirementSettings.curAge, 1), 2);
  updateRetirementResults();
}
function retSetAccountMode(i, mode) {
  const a = retirementSettings.accounts[i];
  if (!a) return;
  a.addMode = mode === 'salary' ? 'salary' : 'direct';
  retTouch(); renderRetirement();      // 填法換了，欄位也要跟著換
}
function retAddAccount() {
  retirementSettings.accounts.push(retNewAccount({}));
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
  if (st.halfAge < st.curAge) problems.push('「我想退休的年齡」比目前年齡小，已當成「現在」計算');
  if (st.fullAge < st.halfAge) problems.push('「開始領退休專戶的年齡」比「我想退休的年齡」小，請檢查');
  if (st.fullAge < st.curAge) problems.push('「開始領退休專戶的年齡」比目前年齡小，已當成「現在」計算');
  if (warn) { warn.style.display = problems.length ? 'block' : 'none'; warn.textContent = problems.join('；'); }

  const yn = $('retYieldNote');
  if (yn) yn.textContent = `殖利率 ${retFmt(c.yieldPct, 2)}%：${c.yieldNote}`;

  // 卡片
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  set('retTitleHalf', `${st.halfAge} 歲（我想退休的年齡）預估股票市值（${c.nHalf} 年後）`);
  set('retValHalf', retWan(c.half.stock));
  set('retSubHalf', `月被動股息約 ${retFmt(c.half.monthlyDiv, 1)} 萬元；約等於今天的 ${retFmt(c.realHalfStock, 0)} 萬`);
  set('retTitleCrash', `${st.halfAge} 歲股災防禦線（跌 ${retFmt(st.crashDrop, 0)}%）`);
  set('retValCrash', retWan(c.half.crash));
  set('retSubCrash', `防禦月股息約 ${retFmt(c.half.crashMonthlyDiv, 1)} 萬元`);
  set('retTitleAcc', `${st.fullAge} 歲開始領退休專戶時的專戶總額`);
  set('retValAcc', retWan(c.full.accTotal));
  set('retSubAcc', (c.full.accounts.length ? c.full.accounts.map(a => `${a.name} ${retFmt(a.value, 0)}萬`).join(' ＋ ') : '尚未設定專戶')
    + (c.payoutMonthly > 0 ? `；餘額平均分年領，每月約 ${retFmt(c.payoutMonthly, 2)} 萬` : '')
    + (c.pensionMonthly > 0 ? `；另每月可領 ${retFmt(c.pensionMonthly, 2)} 萬` : ''));
  set('retTitleTotal', `${st.fullAge} 歲全體總身價（${c.nFull} 年後）`);
  set('retValTotal', retWan(c.full.total));
  set('retSubTotal', `其中股票約 ${retFmt(c.full.stock, 0)} 萬，股息月領約 ${retFmt(c.full.monthlyDiv, 1)} 萬；約等於今天的 ${retFmt(c.realFullTotal, 0)} 萬`);

  // 說明
  const info = $('retInfo');
  if (info) {
    info.innerHTML = `
      <strong>🎯 兩個人生里程碑：</strong><br>
      • <strong>${esc(st.halfAge)} 歲，我想退休的年齡（${c.nHalf} 年後）</strong>：股票市值約 ${retWan(c.half.stock)}，以殖利率 ${retFmt(c.yieldPct, 1)}% 估算，每月被動股息約 ${retFmt(c.half.monthlyDiv, 1)} 萬元；若市場下跌 ${retFmt(st.crashDrop, 0)}%，市值約 ${retWan(c.half.crash)}，月股息約 ${retFmt(c.half.crashMonthlyDiv, 1)} 萬元。<br>
      • <strong>${esc(st.fullAge)} 歲，開始領退休專戶（${c.nFull} 年後）</strong>：退休專戶合計約 ${retWan(c.full.accTotal)}，加上股票約 ${retWan(c.full.stock)}，全體總身價約 ${retWan(c.full.total)}。<br>
      <small>算法：股票與專戶都逐月計算（每月月初投入），年化報酬換成等效月報酬；沒有考慮稅負與手續費，通膨只用來換算「相當於今天多少錢」。這份試算只是幫你概略比較不同情境，不是投資建議。</small>`;
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
