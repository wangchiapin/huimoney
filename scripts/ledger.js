/* ====================================================================
   📒 記帳（資料層）：支出、逐筆收入、分類、每月備註，本機與雲端儲存
   - 算法與畫面規則參考 moneybook 倉庫，用 huimoney 的寫法重寫；
     不搬任何 moneybook 的資料，也不含 AI 分析、密碼鎖、媽媽分類、教學收入同步
   - 本機：localStorage 'HUI_LEDGER_V1'（整份存成一包）
   - 雲端：集合 ledger／文件 = 使用者 uid（登入後才同步；Firebase 規則見 HANDOFF.md）
   - 預留欄位（第一批還沒用到，先留著，之後不用轉換舊資料）：
       支出 payMethod（付款方式）、fund（共同基金相關）、source（資料來源：manual／對帳單）
       收入 source
   - 股票的買賣損益、股利不會自動記進來；股票相關的錢之後只從銀行對帳單的交割款進記帳
   需要 shared.js（fbAuth／fbDb／showToast）；畫面在 ledger-ui.js
   ==================================================================== */

const LG_STORAGE_KEY = 'HUI_LEDGER_V1';
const LG_META_KEY = 'HUI_LEDGER_META_V1';                 // { lastSynced: 雲端上次同步的 updatedAt, dirty: 本機有還沒上傳的變更 }
const LG_BACKUP_KEY = 'HUI_LEDGER_PRE_SYNC_BACKUP_V1';    // 同步要用雲端覆蓋本機之前，先留一份本機資料
const LG_CLOUD_COLLECTION = 'ledger';

const LG_CARD_FEE_ID = '卡費';          // 「支出總計－卡費」用；可改名、不能刪
const LG_FUND_CATEGORY_ID = '共同基金'; // 第二批共同基金分頁會用；可改名、不能刪

const LG_DEFAULT_CATEGORIES = [
  { id: '食', name: '飲食', color: '#C1622D' },
  { id: '衣', name: '服飾', color: '#B4637A' },
  { id: '共同基金', name: '共同基金', color: '#2F6F62' },
  { id: '行', name: '交通', color: '#4A6FA5' },
  { id: '居家', name: '居家', color: '#A97C50' },
  { id: '卡費', name: '卡費', color: '#5B5B5B' },
  { id: '保險', name: '保險', color: '#4B5A85' },
  { id: '育', name: '教育', color: '#3F7D5C' },
  { id: '樂', name: '娛樂', color: '#C79A2A' },
  { id: '其他', name: '其他', color: '#8C8474' },
  { id: '公益', name: '公益', color: '#A3352A' }
];
const LG_DEFAULT_INCOME_CATEGORIES = [
  { id: '薪資收入', name: '薪資收入', color: '#3F7D5C' },
  { id: '股票獲益', name: '股票獲益', color: '#2F6F62' },
  { id: '股利', name: '股利', color: '#C79A2A' },
  { id: '借券收入', name: '借券收入', color: '#4A6FA5' },
  { id: '其他', name: '其他', color: '#8C8474' }
];
const LG_PALETTE = ['#5C7A4E', '#8B4A2F', '#3F7D4A', '#6B5B3E', '#A98D3E', '#4A6B5C', '#7C6A46', '#8C3B2E', '#57684A', '#3D5A3D', '#9C8B5E', '#6E4A3A'];

/* ---------------- 小工具 ---------------- */
function lgClone(o) { return JSON.parse(JSON.stringify(o)); }
function lgGenId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function lgToast(msg, type) {
  if (typeof showToast === 'function') showToast(msg, type);
  else alert(msg);
}
// 今天的日期（固定用台北時間，半夜記帳也不會記成前一天）
function lgTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function lgMonthKeyOf(iso) { return String(iso).slice(0, 7); }
function lgTwYear(yyyy) { return Number(yyyy) - 1911; }
function lgFmt(n) { return Math.round(Number(n) || 0).toLocaleString('zh-Hant-TW'); }
const LG_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function lgDateLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} (${LG_WEEKDAYS[d.getUTCDay()]})`;
}
function lgMonthLabel(mk) {
  const [y, m] = mk.split('-');
  return { tw: `民國 ${lgTwYear(y)} 年 ${Number(m)} 月`, greg: `${y} · ${Number(m)}月` };
}
function lgShiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* ---------------- 資料整理（讀進來的資料一律先整理成固定格式） ---------------- */
function lgNormalize(d) {
  d = d && typeof d === 'object' ? d : {};
  const arr = v => (Array.isArray(v) ? v : []);
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const cats = arr(d.categories).filter(c => c && c.id !== undefined && c.id !== '').map(c => ({ id: String(c.id), name: String(c.name || c.id), color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#8C8474' }));
  const incCats = arr(d.incomeCategories).filter(c => c && c.id !== undefined && c.id !== '').map(c => ({ id: String(c.id), name: String(c.name || c.id), color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#8C8474' }));
  return {
    version: 1,
    expenses: arr(d.expenses).filter(e => e && e.id && isDate(e.date)).map(e => Object.assign({}, e, {
      id: String(e.id), date: e.date, category: String(e.category || ''), item: String(e.item || ''),
      price: Number(e.price) || 0, note: String(e.note || ''),
      payMethod: e.payMethod || '', fund: e.fund || null, source: e.source || 'manual'
    })),
    incomes: arr(d.incomes).filter(i => i && i.id && isDate(i.date)).map(i => Object.assign({}, i, {
      id: String(i.id), date: i.date, category: String(i.category || ''), item: String(i.item || ''),
      amount: Number(i.amount) || 0, note: String(i.note || ''), source: i.source || 'manual'
    })),
    categories: cats.length ? cats : lgClone(LG_DEFAULT_CATEGORIES),
    incomeCategories: incCats.length ? incCats : lgClone(LG_DEFAULT_INCOME_CATEGORIES),
    monthlyNotes: arr(d.monthlyNotes).filter(n => n && n.id && n.month && typeof n.text === 'string').map(n => ({ id: String(n.id), month: String(n.month), text: n.text, createdAt: Number(n.createdAt) || 0 })),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : ''
  };
}

function lgLoadLocal() {
  try {
    const raw = localStorage.getItem(LG_STORAGE_KEY);
    return lgNormalize(raw ? JSON.parse(raw) : {});
  } catch (e) {
    return lgNormalize({});
  }
}
function lgLoadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(LG_META_KEY) || '{}');
    return { lastSynced: String(m.lastSynced || ''), dirty: !!m.dirty };
  } catch (e) { return { lastSynced: '', dirty: false }; }
}
function lgSaveMeta(m) {
  try { localStorage.setItem(LG_META_KEY, JSON.stringify(m)); } catch (e) { /* 略過 */ }
}

let lg = lgLoadLocal();   // 目前的整份記帳資料

// 沒有任何紀錄（只有預設分類）
function lgIsEmpty(data) {
  const d = data || lg;
  return !d.expenses.length && !d.incomes.length && !d.monthlyNotes.length;
}

// 存到本機，並排定上傳雲端
function lgSave() {
  lg.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(LG_STORAGE_KEY, JSON.stringify(lg));
  } catch (e) {
    lgToast('⚠️ 記帳資料存不進這台裝置的瀏覽器（可能空間不足），請先到「記帳 → 設定 → 備份」匯出備份', 'error');
  }
  const m = lgLoadMeta();
  m.dirty = true;
  lgSaveMeta(m);
  lgScheduleCloudSave();
}

/* ---------------- 支出／收入／備註／分類 的增刪改 ---------------- */
function lgAddExpense(entry) {
  lg.expenses.push(Object.assign({ id: lgGenId(), payMethod: '', fund: null, source: 'manual' }, entry));
  lgSave();
}
function lgUpdateExpense(id, patch) {
  lg.expenses = lg.expenses.map(e => (e.id === id ? Object.assign({}, e, patch) : e));
  lgSave();
}
function lgDeleteExpense(id) {
  lg.expenses = lg.expenses.filter(e => e.id !== id);
  lgSave();
}
function lgAddIncome(entry) {
  lg.incomes.push(Object.assign({ id: lgGenId(), source: 'manual' }, entry));
  lgSave();
}
function lgUpdateIncome(id, patch) {
  lg.incomes = lg.incomes.map(i => (i.id === id ? Object.assign({}, i, patch) : i));
  lgSave();
}
function lgDeleteIncome(id) {
  lg.incomes = lg.incomes.filter(i => i.id !== id);
  lgSave();
}
function lgAddNote(month, text) {
  const t = String(text || '').trim();
  if (!t) return;
  lg.monthlyNotes.push({ id: lgGenId(), month, text: t, createdAt: Date.now() });
  lgSave();
}
function lgUpdateNote(id, text) {
  const t = String(text || '').trim();
  if (!t) return;
  lg.monthlyNotes = lg.monthlyNotes.map(n => (n.id === id ? Object.assign({}, n, { text: t }) : n));
  lgSave();
}
function lgDeleteNote(id) {
  lg.monthlyNotes = lg.monthlyNotes.filter(n => n.id !== id);
  lgSave();
}

function lgCatList(kind) { return kind === 'income' ? lg.incomeCategories : lg.categories; }
function lgCatMap(kind) { return Object.fromEntries(lgCatList(kind).map(c => [c.id, c])); }
function lgCatUsed(kind, id) {
  return kind === 'income' ? lg.incomes.some(i => i.category === id) : lg.expenses.some(e => e.category === id);
}
function lgAddCategory(kind, name, color) {
  const n = String(name || '').trim();
  if (!n) return false;
  const list = lgCatList(kind);
  if (list.some(c => c.id === n)) return false;
  list.push({ id: n, name: n, color: color || LG_PALETTE[0] });
  lgSave();
  return true;
}
function lgRenameCategory(kind, id, name) {
  const n = String(name || '').trim();
  if (!n) return;
  lgCatList(kind).forEach(c => { if (c.id === id) c.name = n; });
  lgSave();
}
function lgRecolorCategory(kind, id, color) {
  lgCatList(kind).forEach(c => { if (c.id === id) c.color = color; });
  lgSave();
}
// 回傳 '' 表示刪掉了，否則回傳不能刪的原因
function lgDeleteCategory(kind, id) {
  if (kind === 'expense' && (id === LG_CARD_FEE_ID || id === LG_FUND_CATEGORY_ID)) return '這個分類有特殊用途，可以改名但不能刪除';
  if (lgCatUsed(kind, id)) return '已有紀錄使用這個分類，不能刪除';
  const list = lgCatList(kind);
  const idx = list.findIndex(c => c.id === id);
  if (idx >= 0) list.splice(idx, 1);
  lgSave();
  return '';
}

/* ---------------- 每月統計 ---------------- */
function lgMonthStats(month) {
  const categoryTotals = {};
  lg.categories.forEach(c => { categoryTotals[c.id] = 0; });
  let total = 0;
  lg.expenses.forEach(e => {
    if (lgMonthKeyOf(e.date) !== month) return;
    const p = Number(e.price) || 0;
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + p;
    total += p;
  });
  const cardFee = categoryTotals[LG_CARD_FEE_ID] || 0;
  const netExpense = total - cardFee;

  const incomeCategoryTotals = {};
  lg.incomeCategories.forEach(c => { incomeCategoryTotals[c.id] = 0; });
  let incomeTotal = 0;
  lg.incomes.forEach(i => {
    if (lgMonthKeyOf(i.date) !== month) return;
    const a = Number(i.amount) || 0;
    incomeCategoryTotals[i.category] = (incomeCategoryTotals[i.category] || 0) + a;
    incomeTotal += a;
  });
  return { categoryTotals, total, cardFee, netExpense, incomeCategoryTotals, incomeTotal, balance: incomeTotal - netExpense };
}

/* ---------------- 備份（JSON）：匯出整份、匯入時合併（已有的 id 不會重複加） ---------------- */
function lgExportJson() {
  const obj = Object.assign({ app: 'huimoney-ledger', exportDate: new Date().toISOString() }, lgClone(lg));
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `記帳備份_${lgTodayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// 回傳 { expenses, incomes, notes, categories } 新增筆數；檔案格式不對回傳 null
function lgImportJsonText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return null; }
  if (!raw || (!Array.isArray(raw.expenses) && !Array.isArray(raw.incomes))) return null;
  const inc = lgNormalize(raw);
  const res = { expenses: 0, incomes: 0, notes: 0, categories: 0 };
  const haveE = new Set(lg.expenses.map(e => e.id));
  const haveI = new Set(lg.incomes.map(i => i.id));
  const haveN = new Set(lg.monthlyNotes.map(n => n.id));
  inc.expenses.forEach(e => { if (!haveE.has(e.id)) { lg.expenses.push(e); res.expenses++; } });
  inc.incomes.forEach(i => { if (!haveI.has(i.id)) { lg.incomes.push(i); res.incomes++; } });
  inc.monthlyNotes.forEach(n => { if (!haveN.has(n.id)) { lg.monthlyNotes.push(n); res.notes++; } });
  if (Array.isArray(raw.categories)) inc.categories.forEach(c => { if (!lg.categories.some(x => x.id === c.id)) { lg.categories.push(c); res.categories++; } });
  if (Array.isArray(raw.incomeCategories)) inc.incomeCategories.forEach(c => { if (!lg.incomeCategories.some(x => x.id === c.id)) { lg.incomeCategories.push(c); res.categories++; } });
  // 匯入的紀錄用到、但分類清單裡沒有的分類，補進來，避免統計對不起來
  lg.expenses.forEach(e => { if (e.category && !lg.categories.some(c => c.id === e.category)) { lg.categories.push({ id: e.category, name: e.category, color: '#8C8474' }); res.categories++; } });
  lg.incomes.forEach(i => { if (i.category && !lg.incomeCategories.some(c => c.id === i.category)) { lg.incomeCategories.push({ id: i.category, name: i.category, color: '#8C8474' }); res.categories++; } });
  lgSave();
  return res;
}
// 清空所有紀錄（分類設定保留）
function lgClearAllRecords() {
  lg.expenses = [];
  lg.incomes = [];
  lg.monthlyNotes = [];
  lgSave();
}

/* ====================================================================
   雲端同步（登入後才會動；沒登入就只存本機）
   - 讀：雲端沒有 → 把本機上傳；雲端有、本機沒有未上傳的變更 → 用雲端；兩邊都有新變更 → 問你
   - 寫：改動後 3 秒上傳；上傳前先看雲端有沒有被別的裝置改過，有的話不直接蓋掉、問你
   - 用雲端覆蓋本機之前，會先把本機資料留一份（HUI_LEDGER_PRE_SYNC_BACKUP_V1）
   ==================================================================== */
let lgCloudReady = false;
let lgCloudSaveTimer = null;
let lgCloudUser = null;
let lgPushing = false;

function lgDocRef() {
  const user = (typeof fbUser !== 'undefined' && fbUser) ? fbUser : lgCloudUser;
  if (typeof fbDb === 'undefined' || !fbDb || !user) return null;
  return fbDb.collection(LG_CLOUD_COLLECTION).doc(user.uid);
}
function lgCloudPayload() {
  const d = lgClone(lg);
  d.updatedAt = lg.updatedAt || new Date().toISOString();
  return d;
}
function lgStashLocalBackup() {
  try { localStorage.setItem(LG_BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: lg })); } catch (e) { /* 略過 */ }
}
function lgAdoptCloud(cloudData) {
  lgStashLocalBackup();
  lg = lgNormalize(cloudData);
  try { localStorage.setItem(LG_STORAGE_KEY, JSON.stringify(lg)); } catch (e) { /* 略過 */ }
  lgSaveMeta({ lastSynced: lg.updatedAt, dirty: false });
  if (typeof lgOnDataReplaced === 'function') lgOnDataReplaced();
}
async function lgForcePush() {
  const ref = lgDocRef();
  if (!ref) return;
  const payload = lgCloudPayload();
  await ref.set(payload);
  lgSaveMeta({ lastSynced: payload.updatedAt, dirty: lg.updatedAt !== payload.updatedAt });
}
// 兩邊都有新的變更時：讓使用者選
async function lgResolveConflict(cloudData) {
  const useCloud = confirm(
    '📒 記帳資料：雲端上的版本，和這台裝置上的版本都有新的變更，兩邊不一樣。\n\n' +
    '按「確定」＝改用雲端的資料（這台裝置還沒上傳的變更會被取代，但會先留一份備份在瀏覽器裡）\n' +
    '按「取消」＝保留這台裝置的資料，並覆蓋雲端'
  );
  if (useCloud) {
    lgAdoptCloud(cloudData);
    lgToast('已改用雲端的記帳資料', 'success');
  } else {
    await lgForcePush();
    lgToast('已用這台裝置的記帳資料覆蓋雲端', 'success');
  }
}
async function lgLoadFromCloud() {
  const ref = lgDocRef();
  if (!ref) return;
  try {
    const snap = await ref.get();
    const meta = lgLoadMeta();
    if (!snap.exists) {
      if (!lgIsEmpty()) await lgForcePush();
      lgCloudReady = true;
      return;
    }
    const cloud = snap.data() || {};
    const cloudAt = String(cloud.updatedAt || '');
    if (!meta.dirty || lgIsEmpty()) {
      lgAdoptCloud(cloud);
    } else if (meta.lastSynced && cloudAt === meta.lastSynced) {
      await lgForcePush();           // 雲端沒人動過，本機有新的 → 上傳
    } else if (cloudAt === lg.updatedAt) {
      lgSaveMeta({ lastSynced: cloudAt, dirty: false });
    } else {
      await lgResolveConflict(cloud);
    }
    lgCloudReady = true;
  } catch (e) {
    console.warn('讀取記帳雲端資料失敗', e);
    lgReportCloudError(e);
  }
}
async function lgPushToCloud() {
  if (!lgCloudReady || lgPushing) return;
  const ref = lgDocRef();
  if (!ref) return;
  const meta = lgLoadMeta();
  if (!meta.dirty) return;
  lgPushing = true;
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const cloudAt = String((snap.data() || {}).updatedAt || '');
      if (cloudAt && cloudAt !== meta.lastSynced && cloudAt !== lg.updatedAt) {
        await lgResolveConflict(snap.data());
        return;
      }
    }
    const payload = lgCloudPayload();
    await ref.set(payload);
    const stillDirty = lg.updatedAt !== payload.updatedAt;
    lgSaveMeta({ lastSynced: payload.updatedAt, dirty: stillDirty });
    if (stillDirty) lgScheduleCloudSave();
  } catch (e) {
    console.warn('記帳雲端同步失敗', e);
    lgReportCloudError(e);
  } finally {
    lgPushing = false;
  }
}
function lgReportCloudError(e) {
  const hint = (e && e.code === 'permission-denied') ? '（Firebase 規則還沒開放 ledger，請看 HANDOFF.md）' : '';
  lgToast('⚠️ 記帳雲端同步失敗' + hint + '，資料已存在這台裝置', 'error');
}
function lgScheduleCloudSave() {
  if (!lgCloudReady) return;
  clearTimeout(lgCloudSaveTimer);
  lgCloudSaveTimer = setTimeout(lgPushToCloud, 3000);
}

if (typeof fbAuth !== 'undefined' && fbAuth) {
  fbAuth.onAuthStateChanged(async (user) => {
    lgCloudUser = user || null;
    lgCloudReady = false;
    clearTimeout(lgCloudSaveTimer);
    if (!user) return;
    await lgLoadFromCloud();
  });
  // 切到別的分頁／把網頁縮到背景時，先把還沒上傳的送出去
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && lgCloudReady && lgLoadMeta().dirty) {
      clearTimeout(lgCloudSaveTimer);
      lgPushToCloud();
    }
  });
}
