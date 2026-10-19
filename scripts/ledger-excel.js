/* ====================================================================
   📊 記帳 Excel 匯出／匯入（放在 記帳 → 設定 → 備份）
   匯出一個 .xlsx，四張表：支出、收入、共同基金、月備註。每筆有「編號」欄。
   匯入：
   - 有編號 → 編號已經有的就略過
   - 沒編號（自己手打的表）→ 「日期＋分類＋項目＋金額」一樣的就略過
   - 分類不存在會自動新增；日期、金額看不懂的列會略過並告訴你筆數
   - 認得 moneybook 舊備份的「支出」表（日期、分類、項目、金額、備註）
   用 ExcelJS（index.html 已經從 CDN 載入）
   ==================================================================== */

const LG_XL_KIND = { deposit: '匯入', expense: '支出', settle: '結算領出', opening: '期初餘額' };
const LG_XL_KIND_REV = Object.fromEntries(Object.entries(LG_XL_KIND).map(([k, v]) => [v, k]));
const LG_XL_WHO = { wife: '老婆', husband: '老公' };
const LG_XL_WHO_REV = { 老婆: 'wife', 老公: 'husband' };

// 付款方式名稱 → id（沒有這個名稱就先當新的付款方式，匯入時會補進清單）
function lgPayIdByName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  const m = lg.payMethods.find(x => x.name === n) || lg.payMethods.find(x => x.id === n);
  return m ? m.id : n;
}

function lgXlStyleSheet(ws, widths) {
  ws.columns.forEach((c, i) => { c.width = widths[i] || 14; });
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FF5B4333' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1E2C9' } };
  head.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function lgExportXlsx() {
  if (typeof ExcelJS === 'undefined') { alert('Excel 匯出套件尚未載入完成（需要網路），請稍後再試一次。'); return; }
  try {
    const eMap = lgCatMap('expense'), iMap = lgCatMap('income');
    const wb = new ExcelJS.Workbook();
    wb.creator = '個人財務資產狀況管理';
    wb.created = new Date();

    const wsE = wb.addWorksheet('支出');
    wsE.addRow(['編號', '日期', '分類', '項目', '金額', '備註', '共同基金支出', '付款人', '錢從哪來', '付款方式']);
    lg.expenses.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(e => {
      wsE.addRow([e.id, e.date, (eMap[e.category] || { name: e.category }).name, e.item, e.price, e.note,
        e.fund ? '是' : '', e.fund ? LG_XL_WHO[e.fund.payer] : '', e.fund ? (e.fund.from === 'self' ? '個人先墊' : '基金帳戶直接付') : '', e.payMethod ? lgPayName(e.payMethod) : '']);
    });
    lgXlStyleSheet(wsE, [18, 12, 12, 24, 12, 24, 14, 10, 16, 16]);
    wsE.getColumn(5).numFmt = '#,##0';

    const wsI = wb.addWorksheet('收入');
    wsI.addRow(['編號', '日期', '分類', '項目', '金額', '備註']);
    lg.incomes.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(i => {
      wsI.addRow([i.id, i.date, (iMap[i.category] || { name: i.category }).name, i.item, i.amount, i.note]);
    });
    lgXlStyleSheet(wsI, [18, 12, 12, 24, 12, 24]);
    wsI.getColumn(5).numFmt = '#,##0';

    const wsF = wb.addWorksheet('共同基金');
    wsF.addRow(['編號', '日期', '類型', '誰', '項目', '金額', '錢從哪來', '備註']);
    lg.fundTxns.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(t => {
      wsF.addRow([t.id, t.date, LG_XL_KIND[t.kind], LG_XL_WHO[t.who] || '', t.item, t.amount, t.from === 'self' ? '個人先墊' : (t.from === 'fund' ? '基金帳戶直接付' : ''), t.note]);
    });
    lgXlStyleSheet(wsF, [18, 12, 12, 8, 24, 12, 16, 24]);
    wsF.getColumn(6).numFmt = '#,##0';
    wsF.addRow([]);
    wsF.addRow(['說明：老婆的匯入、基金支出記在「支出」表（分類：共同基金／共同基金支出=是），這張表只有老公匯入、老公支出、結算、期初餘額。']);

    const wsN = wb.addWorksheet('月備註');
    wsN.addRow(['編號', '月份', '內容']);
    lg.monthlyNotes.slice().sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0)).forEach(n => wsN.addRow([n.id, n.month, n.text]));
    lgXlStyleSheet(wsN, [18, 10, 60]);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `記帳_${lgTodayISO()}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    lgToast('已匯出 Excel', 'success');
  } catch (e) {
    console.error('記帳 Excel 匯出失敗', e);
    alert('匯出失敗：' + (e && e.message ? e.message : e));
  }
}

/* ---------- 匯入 ---------- */
function lgXlText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return lgXlDate(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('').trim();
    if ('result' in v) return lgXlText(v.result);
    if ('text' in v) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}
function lgXlNum(v) {
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  const n = typeof v === 'number' ? v : Number(String(v === null || v === undefined ? '' : v).replace(/[,\s$＄]/g, ''));
  return isFinite(n) ? n : NaN;
}
function lgXlDate(v) {
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (v && typeof v === 'object' && 'result' in v) return lgXlDate(v.result);
  if (typeof v === 'number' && v > 20000 && v < 80000) return lgXlDate(new Date(Math.round((v - 25569) * 86400000)));   // Excel 日期序號
  const s = String(v === null || v === undefined ? '' : v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^民國\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
  if (m) return `${+m[1] + 1911}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return '';
}
// 讀一張表：第一列是欄名，回傳 [{欄名: 儲存格原值}]
function lgXlRows(ws) {
  if (!ws) return [];
  const head = {};
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { head[col] = lgXlText(cell.value); });
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const o = {};
    let any = false;
    Object.keys(head).forEach(col => { const v = row.getCell(Number(col)).value; o[head[col]] = v; if (lgXlText(v) !== '') any = true; });
    if (any) rows.push(o);
  });
  return rows;
}

// 把工作簿轉成 lgImportRecords 要的格式；看不懂的列計入 bad
function lgXlParseWorkbook(wb) {
  const rec = { expenses: [], incomes: [], fundTxns: [], notes: [] };
  let bad = 0;
  const sheet = name => wb.worksheets.find(w => w.name === name);

  lgXlRows(sheet('支出')).forEach(r => {
    const date = lgXlDate(r['日期']), price = lgXlNum(r['金額']);
    if (!date || !isFinite(price) || price < 0) { bad++; return; }
    const fundOn = lgXlText(r['共同基金支出']) === '是';
    rec.expenses.push({
      id: lgXlText(r['編號']), date, category: lgCatIdByName('expense', lgXlText(r['分類'])), item: lgXlText(r['項目']), price, note: lgXlText(r['備註']),
      fund: fundOn ? { payer: LG_XL_WHO_REV[lgXlText(r['付款人'])] || 'wife', from: lgXlText(r['錢從哪來']) === '個人先墊' ? 'self' : 'fund' } : null,
      payMethod: lgPayIdByName(lgXlText(r['付款方式'])),
      source: 'excel'
    });
  });
  lgXlRows(sheet('收入')).forEach(r => {
    const date = lgXlDate(r['日期']), amount = lgXlNum(r['金額']);
    if (!date || !isFinite(amount) || amount < 0) { bad++; return; }
    rec.incomes.push({ id: lgXlText(r['編號']), date, category: lgCatIdByName('income', lgXlText(r['分類'])), item: lgXlText(r['項目']), amount, note: lgXlText(r['備註']), source: 'excel' });
  });
  lgXlRows(sheet('共同基金')).forEach(r => {
    const kind = LG_XL_KIND_REV[lgXlText(r['類型'])];
    if (!kind && !lgXlText(r['日期'])) return;           // 說明文字那一列
    const date = lgXlDate(r['日期']), amount = lgXlNum(r['金額']);
    if (!kind || !date || !isFinite(amount) || amount <= 0) { bad++; return; }
    rec.fundTxns.push({ id: lgXlText(r['編號']), date, kind, who: LG_XL_WHO_REV[lgXlText(r['誰'])] || '', item: lgXlText(r['項目']), amount, from: lgXlText(r['錢從哪來']) === '個人先墊' ? 'self' : (lgXlText(r['錢從哪來']) ? 'fund' : ''), note: lgXlText(r['備註']) });
  });
  lgXlRows(sheet('月備註')).forEach(r => {
    const month = lgXlText(r['月份']).slice(0, 7), text = lgXlText(r['內容']);
    if (!/^\d{4}-\d{2}$/.test(month) || !text) { bad++; return; }
    rec.notes.push({ id: lgXlText(r['編號']), month, text });
  });
  return { rec, bad };
}

async function lgImportXlsxFile(file) {
  if (typeof ExcelJS === 'undefined') { alert('Excel 套件尚未載入完成（需要網路），請稍後再試一次。'); return null; }
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const { rec, bad } = lgXlParseWorkbook(wb);
    if (!rec.expenses.length && !rec.incomes.length && !rec.fundTxns.length && !rec.notes.length) {
      alert('這個檔案裡找不到可以匯入的資料。\n請確認有「支出」「收入」「共同基金」「月備註」其中一張表，且第一列是欄名（例如：日期、分類、項目、金額）。');
      return null;
    }
    const res = lgImportRecords(rec);
    res.bad = bad;
    return res;
  } catch (e) {
    console.error('記帳 Excel 匯入失敗', e);
    alert('讀取 Excel 失敗，請確認這是有效的 .xlsx 檔案。');
    return null;
  }
}
