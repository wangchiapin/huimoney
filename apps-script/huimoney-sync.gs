/**
 * huimoney → Google 試算表 每日同步（Apps Script）
 *
 * 做什麼：每天從 Firebase（Firestore）讀「一個帳號」的 huimoney 資料，寫進這份試算表的幾個分頁：
 *   每月總覽、持股、股票買進、股票賣出、財務總覽、保險、記帳支出、記帳收入、共同基金、記帳月備註、記帳分類、更新紀錄
 * 每次都整頁重寫（以 Firebase 為準），所以不要在這些分頁裡手動改資料；要加公式或圖表請放在別的分頁。
 *
 * 要先在「專案設定 → 指令碼屬性」放兩個值（不要寫在程式碼裡）：
 *   FIREBASE_SERVICE_ACCOUNT   Firebase 服務帳戶金鑰 .json 檔的「完整內容」
 *   FIREBASE_UID               要同步的那個登入帳號的 UID
 * 選用：
 *   BACKUP_FOLDER_NAME         有填的話，每天另外存一份 JSON 原始備份到雲端硬碟這個資料夾（保留最近 30 份）
 *
 * 第一次使用：先執行 syncAll 測試，成功後執行 setupDailyTrigger 設定每天自動跑。
 */

const SHEETS = {
  monthly: '每月總覽',
  holdings: '持股',
  buys: '股票買進',
  sales: '股票賣出',
  finance: '財務總覽',
  insurance: '保險',
  ledgerExp: '記帳支出',
  ledgerInc: '記帳收入',
  fund: '共同基金',
  ledgerNotes: '記帳月備註',
  ledgerCats: '記帳分類',
  log: '更新紀錄'
};
const DAILY_HOUR = 5;          // 每天幾點跑（台灣時間，請把專案時區設成 Asia/Taipei）
const KEEP_BACKUPS = 30;       // JSON 備份保留幾份

/* ====== 試算表上方多一個「huimoney」選單 ====== */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('huimoney')
    .addItem('立即更新', 'syncAll')
    .addItem('設定每天自動更新', 'setupDailyTrigger')
    .addToUi();
}

/* ====== 主程式 ====== */
function syncAll() {
  const started = new Date();
  try {
    const props = PropertiesService.getScriptProperties();
    const uid = (props.getProperty('FIREBASE_UID') || '').trim();
    if (!uid) throw new Error('指令碼屬性還沒有 FIREBASE_UID');
    const sa = getServiceAccount_();

    const finance = getDoc_(sa, 'financeAssets', uid);
    const stock = getDoc_(sa, 'stockAssets', uid);
    const insurance = getDoc_(sa, 'insuranceAssets', uid);
    const monthly = getDoc_(sa, 'overviewMonthly', uid);
    const ledger = getDoc_(sa, 'ledger', uid);
    if (!finance && !stock && !insurance && !monthly && !ledger) {
      throw new Error('這個 UID 在 Firebase 裡一份資料都沒有：請確認 UID 對不對、網頁有沒有登入並上傳過');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const counts = {};
    counts.monthly = writeTable_(ss, SHEETS.monthly, buildMonthly_(monthly));
    counts.holdings = writeTable_(ss, SHEETS.holdings, buildHoldings_(stock));
    counts.buys = writeTable_(ss, SHEETS.buys, buildBuys_(stock));
    counts.sales = writeTable_(ss, SHEETS.sales, buildSales_(stock));
    counts.finance = writeTable_(ss, SHEETS.finance, buildFinance_(finance));
    counts.insurance = writeTable_(ss, SHEETS.insurance, buildInsurance_(insurance));
    counts.ledgerExp = writeTable_(ss, SHEETS.ledgerExp, buildLedgerExpenses_(ledger));
    counts.ledgerInc = writeTable_(ss, SHEETS.ledgerInc, buildLedgerIncomes_(ledger));
    counts.fund = writeTable_(ss, SHEETS.fund, buildFund_(ledger));
    counts.ledgerNotes = writeTable_(ss, SHEETS.ledgerNotes, buildLedgerNotes_(ledger));
    counts.ledgerCats = writeTable_(ss, SHEETS.ledgerCats, buildLedgerCats_(ledger));

    let backup = '';
    const folderName = (props.getProperty('BACKUP_FOLDER_NAME') || '').trim();
    if (folderName) backup = saveJsonBackup_(folderName, { finance, stock, insurance, monthly, ledger });

    const summary = Object.keys(counts).map(k => SHEETS[k] + ' ' + counts[k] + ' 列').join('、');
    log_(ss, started, '成功', summary + (backup ? '；備份：' + backup : ''));
  } catch (e) {
    log_(SpreadsheetApp.getActiveSpreadsheet(), started, '失敗', String(e && e.message || e));
    throw e;   // 讓 Apps Script 也記錄失敗（自動執行失敗時 Google 會寄信通知你）
  }
}

/* ====== 每天自動執行：先清掉舊的，再設一個新的 ====== */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAll')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAll').timeBased().everyDays(1).atHour(DAILY_HOUR).create();
  const msg = '已設定：每天 ' + DAILY_HOUR + ' 點到 ' + (DAILY_HOUR + 1) + ' 點之間自動更新一次';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

/* ====== 1. 服務帳戶 → 取得通行證（存在快取 50 分鐘） ====== */
function getServiceAccount_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVICE_ACCOUNT');
  if (!raw) throw new Error('指令碼屬性還沒有 FIREBASE_SERVICE_ACCOUNT');
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT 不是完整的 JSON：請把整個 .json 檔的內容貼上，從 { 到 }'); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT 少了 client_email / private_key / project_id，請確認貼的是服務帳戶金鑰檔');
  return sa;
}

function getAccessToken_(sa) {
  const cache = CacheService.getScriptCache();
  const key = 'fs_token_' + sa.client_email;
  const hit = cache.get(key);
  if (hit) return hit;

  const now = Math.floor(Date.now() / 1000);
  const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const head = b64(Utilities.newBlob(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).getBytes());
  const claim = b64(Utilities.newBlob(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })).getBytes());
  const sig = b64(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key));

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('取得 Firebase 通行證失敗（' + res.getResponseCode() + '）：' + res.getContentText().slice(0, 300));
  const token = JSON.parse(res.getContentText()).access_token;
  cache.put(key, token, 3000);
  return token;
}

/* ====== 2. 讀一份 Firestore 文件，轉成一般的物件；沒有這份就回傳 null ====== */
function getDoc_(sa, collection, docId) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(sa.project_id) +
    '/databases/(default)/documents/' + encodeURIComponent(collection) + '/' + encodeURIComponent(docId);
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + getAccessToken_(sa) },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('讀取 ' + collection + ' 失敗（' + code + '）：' + res.getContentText().slice(0, 300));
  return fromFields_(JSON.parse(res.getContentText()).fields || {});
}

function fromFields_(fields) {
  const out = {};
  Object.keys(fields).forEach(k => { out[k] = fromValue_(fields[k]); });
  return out;
}

function fromValue_(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fromFields_(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  return null;
}

/* ====== 3. 把資料整理成表格：{ headers: [...], rows: [[...]], textCols: [欄位序號] } ====== */
function num_(x) {
  if (x === '' || x == null) return '';
  const n = Number(String(x).replace(/,/g, ''));
  return isNaN(n) ? '' : n;
}
function str_(x) { return x == null ? '' : String(x); }

function buildMonthly_(doc) {
  const months = (doc && doc.months) || {};
  const rows = Object.keys(months).sort().reverse().map(k => {
    const r = months[k] || {};
    return [k, num_(r.total), num_(r.cashTwd), num_(r.cashUsd), num_(r.cashUsdTwd), num_(r.stockValue),
      num_(r.stockCost), num_(r.insurance), num_(r.badDebt), num_(r.usdRate), r.finalized ? '是' : '', str_(r.savedAt)];
  });
  return {
    headers: ['月份', '總資產（台幣）', '現金・台幣', '現金・美元（US$）', '美元換台幣', '股票現值', '股票成本', '保險現值', '呆帳（另計）', '美元匯率', '月底已固定', '記錄時間'],
    rows: rows, textCols: [0, 11]
  };
}

function buildHoldings_(doc) {
  const stocks = (doc && doc.stocks) || [];
  const rows = stocks.filter(s => s && !s.archived).map(s => {
    const us = s.account === '美股複委託' || s.category === '美股';
    return [str_(s.account), str_(s.code), str_(s.name), str_(s.category), us ? 'US$' : 'NT$',
      num_(s.shares), num_(s.totalCost), num_(s.currentPrice), num_(s.marketVal),
      num_(s.cashDividends), num_(s.stockDividends), num_(s.lentShares)];
  });
  return {
    headers: ['證券帳戶', '代號', '名稱', '類別', '幣別', '持有股數', '成本', '現價', '市值', '現金股利', '股票股利', '出借股數'],
    rows: rows, textCols: [0, 1, 2, 3, 4]
  };
}

function buildBuys_(doc) {
  const list = (doc && doc.stockBuys) || [];
  const rows = list.map(b => [str_(b.date), str_(b.account), str_(b.code), str_(b.name), num_(b.shares),
    num_(b.price), num_(b.amount), num_(b.fee), num_(b.cost), str_(b.note)]);
  return {
    headers: ['日期（民國）', '證券帳戶', '代號', '名稱', '股數', '成交價', '成交金額', '手續費', '成本', '備註'],
    rows: rows, textCols: [0, 1, 2, 3, 9]
  };
}

function buildSales_(doc) {
  const list = (doc && doc.stockSales) || [];
  const rows = list.map(s => [str_(s.date), str_(s.name), num_(s.shares), num_(s.buyPrice), num_(s.sellPrice),
    num_(s.cost), num_(s.sellAmt), num_(s.spread), num_(s.returnRate), num_(s.buyFee), num_(s.sellFee),
    num_(s.tax), str_(s.status), str_(s.note)]);
  return {
    headers: ['日期（民國）', '名稱', '股數', '買價', '賣價', '成本', '賣出金額', '價差', '報酬率', '買進手續費', '賣出手續費', '證交稅', '狀態', '備註'],
    rows: rows, textCols: [0, 1, 12, 13]
  };
}

/* 財務總覽：一列一個項目、一欄一個紀錄日期，跟網頁上的表格同一個方向 */
function buildFinance_(doc) {
  const st = (doc && doc.state) || {};
  const dates = st.dates || [];
  const values = st.values || {};
  const groups = [
    ['銀行與現金', st.bankItems],
    ['保險資產', st.insuranceItems],
    ['股票資產', st.stockItems],
    ['呆帳', st.badDebtItems]
  ];
  const suffixName = { '': '', '_cost': '（成本）', '_usd': '（美元）' };
  const rows = [];
  groups.forEach(([group, items]) => {
    (items || []).forEach(it => {
      if (!it || it.archived) return;
      Object.keys(suffixName).forEach(suf => {
        const arr = values[it.id + suf];
        if (!arr) return;
        rows.push([group, str_(it.name) + suffixName[suf]].concat(dates.map((_, i) => cell_(arr[i]))));
      });
    });
  });
  if (st.rates && st.rates.length) rows.push(['匯率', '美金匯率'].concat(dates.map((_, i) => cell_(st.rates[i]))));
  return { headers: ['分類', '項目'].concat(dates.map(str_)), rows: rows, textCols: [0, 1] };
}
function cell_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.charAt(0) === '=') return "'" + s;        // 網頁裡的算式：當文字顯示，不讓試算表去算
  const n = Number(s.replace(/,/g, ''));
  return isNaN(n) ? s : n;
}

function buildInsurance_(doc) {
  const list = (doc && doc.policies) || [];
  const rows = list.filter(p => p && !p.archived).map(p => [str_(p.name), str_(p.insurer), str_(p.type),
    str_(p.status), num_(p.premium), str_(p.paymentFrequency), str_(p.paymentDate), num_(p.currentValue), str_(p.note)]);
  return {
    headers: ['保單名稱', '保險公司', '險種', '狀態', '保費', '繳費方式', '繳費日', '目前現值', '備註'],
    rows: rows, textCols: [0, 1, 2, 3, 5, 6, 8]
  };
}

/* ====== 記帳（huimoney 的 ledger 文件）====== */
const WHO_ = { wife: '老婆', husband: '老公' };
const FUND_KIND_ = { deposit: '匯入', expense: '支出', settle: '結算', opening: '期初餘額' };
const SOURCE_ = { manual: '手動', statement: '對帳單', excel: 'Excel' };
const PAYTYPE_ = { cash: '現金', bank: '轉帳／金融卡', card: '信用卡' };

function nameMap_(list) {
  const m = {};
  (list || []).forEach(c => { if (c && c.id !== undefined) m[c.id] = c.name || c.id; });
  return m;
}
function byDate_(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }

function buildLedgerExpenses_(doc) {
  const cat = nameMap_(doc && doc.categories);
  const pay = nameMap_(doc && doc.payMethods);
  const rows = ((doc && doc.expenses) || []).map(e => [
    str_(e.date), str_(cat[e.category] || e.category), str_(e.item), num_(e.price),
    str_(pay[e.payMethod] || e.payMethod), str_(e.note),
    e.fund ? '是' : '', e.fund ? str_(WHO_[e.fund.payer] || e.fund.payer) : '',
    e.fund ? (e.fund.from === 'self' ? '個人先墊' : '基金帳戶直接付') : '',
    str_(SOURCE_[e.source] || e.source), e.stmt && e.stmt.key ? '是' : '', str_(e.id)
  ]).sort(byDate_);
  return {
    headers: ['日期', '分類', '項目', '金額', '付款方式', '備註', '共同基金支出', '付款人', '錢從哪來', '來源', '已和銀行核對', '編號'],
    rows: rows, textCols: [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]
  };
}

function buildLedgerIncomes_(doc) {
  const cat = nameMap_(doc && doc.incomeCategories);
  const rows = ((doc && doc.incomes) || []).map(i => [
    str_(i.date), str_(cat[i.category] || i.category), str_(i.item), num_(i.amount), str_(i.note),
    str_(SOURCE_[i.source] || i.source), i.stmt && i.stmt.key ? '是' : '', str_(i.id)
  ]).sort(byDate_);
  return {
    headers: ['日期', '分類', '項目', '金額', '備註', '來源', '已和銀行核對', '編號'],
    rows: rows, textCols: [0, 1, 2, 4, 5, 6, 7]
  };
}

// 只有「在共同基金分頁另外記的」：老公匯入、老公支出、結算、期初餘額。
// 老婆匯入（分類：共同基金）和基金支出本來就記在「記帳支出」。
function buildFund_(doc) {
  const rows = ((doc && doc.fundTxns) || []).map(t => [
    str_(t.date), str_(FUND_KIND_[t.kind] || t.kind), str_(WHO_[t.who] || t.who), str_(t.item), num_(t.amount),
    t.from === 'self' ? '個人先墊' : (t.from === 'fund' ? '基金帳戶直接付' : ''), str_(t.note), str_(t.id)
  ]).sort(byDate_);
  return {
    headers: ['日期', '類型', '誰', '項目', '金額', '錢從哪來', '備註', '編號'],
    rows: rows, textCols: [0, 1, 2, 3, 5, 6, 7]
  };
}

function buildLedgerNotes_(doc) {
  const rows = ((doc && doc.monthlyNotes) || []).map(n => [str_(n.month), str_(n.text), str_(n.id)])
    .sort(byDate_);
  return { headers: ['月份', '內容', '編號'], rows: rows, textCols: [0, 1, 2] };
}

function buildLedgerCats_(doc) {
  const rows = [];
  ((doc && doc.categories) || []).forEach(c => rows.push(['支出分類', str_(c.id), str_(c.name)]));
  ((doc && doc.incomeCategories) || []).forEach(c => rows.push(['收入分類', str_(c.id), str_(c.name)]));
  ((doc && doc.payMethods) || []).forEach(m => rows.push(['付款方式', str_(m.id), str_(m.name) + '（' + (PAYTYPE_[m.type] || m.type) + '）']));
  return { headers: ['種類', '代號', '名稱'], rows: rows, textCols: [0, 1, 2] };
}

/* ====== 4. 寫進分頁（整頁重寫） ====== */
function writeTable_(ss, name, table) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear();
  const width = table.headers.length;
  const data = [table.headers].concat(table.rows.map(r => {
    const row = r.slice(0, width);
    while (row.length < width) row.push('');
    return row;
  }));
  (table.textCols || []).forEach(c => sheet.getRange(1, c + 1, data.length, 1).setNumberFormat('@'));
  sheet.getRange(1, 1, data.length, width).setValues(data);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#ece6d9');
  sheet.setFrozenRows(1);
  return table.rows.length;
}

function log_(ss, started, status, detail) {
  const sheet = ss.getSheetByName(SHEETS.log) || ss.insertSheet(SHEETS.log);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['時間', '結果', '說明']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#ece6d9');
    sheet.setFrozenRows(1);
  }
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 3).setValues([[started, status, detail]]);
  if (sheet.getLastRow() > 201) sheet.deleteRows(202, sheet.getLastRow() - 201);   // 只留最近 200 筆
}

/* ====== 5. 選用：每天存一份 JSON 原始備份到雲端硬碟 ====== */
function saveJsonBackup_(folderName, data) {
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const name = 'huimoney-備份-' + stamp + '.json';
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  folder.createFile(name, JSON.stringify(data, null, 1), 'application/json');

  const files = [];
  const all = folder.getFiles();
  while (all.hasNext()) { const f = all.next(); if (/^huimoney-備份-/.test(f.getName())) files.push(f); }
  files.sort((a, b) => b.getName() < a.getName() ? -1 : 1);
  files.slice(KEEP_BACKUPS).forEach(f => f.setTrashed(true));
  return folderName + '/' + name;
}