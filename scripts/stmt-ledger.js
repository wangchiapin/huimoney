/* ====================================================================
   對帳單 → 📒 記帳（銀行對帳單的每一筆明細，和手動記的帳比對）
   接在 stmt-import.js 的確認畫面裡（那邊只有幾個小接點，邏輯都在這個檔）：
     stmtLgBuildItems(results, imported) ← stmtBuildItems 呼叫
     stmtLgDescribe / stmtLgExtraHtml    ← 確認畫面顯示
     stmtLgApply(it, bump, problems)     ← stmtApply 寫入
   規則：
   - 每一筆銀行明細：存入＝收入、提出＝支出
   - 先和「手動記的帳」比對：金額一樣、日期差 5 天內、一對一（先配日期最近的）
       ‧ 對上了 → 保留你手動寫的項目名稱，只標記「✓ 已對帳」（放在「更新」區，不會新增）
       ‧ 沒對上 → 放在「新增」區，分類猜好、你可以改，勾了才會記進去
   - 提出款項比對時：付款方式是「現金」「信用卡」的不比對（那不是直接從銀行出去的錢）；
       「繳卡費」那一筆只和分類「卡費」的手動紀錄比對
   - 股票：交割款（買進＝支出、賣出入帳＝收入，分類「股票交割」）、現金股息、權益息 → 股利、借券費 → 借券收入。
       股票的已實現損益完全不進記帳。
   - 兩個自己的帳戶之間互轉（同金額、差 1 天內、不同帳戶）→ 放在「需要你看」，預設不記
   - 同一行明細不會記兩次（每行有識別碼 stmt.key）；整份已匯入的對帳單本來就整份略過
   - 外幣帳戶的明細不列入
   需要 ledger.js、stmt-import.js
   ==================================================================== */

const STMT_LG_SETTLE = '股票交割';
const STMT_LG_DAYS = 5;

function stmtLgBankPayMethod() {
  const m = lg.payMethods.find(x => x.type === 'bank');
  return m ? m.id : '';
}

// 一筆銀行明細 → { dir:'in'|'out', kind:'expense'|'income', category, item, tag }
function stmtLgClassify(t) {
  const amt = Number(t.amount) || 0;
  const dir = amt > 0 ? 'in' : 'out';
  const desc = String(t.desc || '').replace(/\s+/g, ' ').trim();
  let category = '', tag = '';
  if (t.category === 'securitiesSettlement') { category = STMT_LG_SETTLE; tag = '股票交割'; }
  else if (t.category === 'cashDividend') { category = '股利'; tag = '現金股息'; }
  else if (t.category === 'compensationRef') { category = '股利'; tag = '權益息'; }
  else if (t.category === 'lendingFeeRef') { category = '借券收入'; tag = '借券費'; }
  else if (dir === 'out' && /卡費|信用卡|卡款/.test(desc)) { category = LG_CARD_FEE_ID; tag = '繳卡費'; }
  else if (dir === 'in' && /薪/.test(desc)) { category = '薪資收入'; }
  else if (dir === 'out') { category = lgGuessCategory(desc) || '其他'; }
  else { category = '其他'; }
  return { dir, kind: dir === 'in' ? 'income' : 'expense', category, item: desc || (dir === 'in' ? '存入' : '提出'), tag };
}

// 手動紀錄裡，哪些可以和這筆銀行明細比對
function stmtLgCandidates(x, usedIds) {
  const abs = Math.abs(Number(x.t.amount) || 0);
  const list = x.kind === 'income' ? lg.incomes : lg.expenses;
  return list.filter(e => {
    if (e.stmt || usedIds.has(e.id)) return false;
    const amount = x.kind === 'income' ? e.amount : e.price;
    if (Math.abs((Number(amount) || 0) - abs) > 0.5) return false;
    if (x.kind === 'expense') {
      if (x.category === LG_CARD_FEE_ID) return e.category === LG_CARD_FEE_ID;       // 繳卡費只配「卡費」
      const pt = lgPayType(e.payMethod);
      if (pt === 'card' || pt === 'cash') return false;                                // 刷卡、現金不是直接從銀行出去
      if (e.fund && e.fund.from === 'fund') return false;                              // 基金帳戶直接付的，不經過這個銀行帳戶
    }
    return stmtDaysApart(e.date, x.t.date) <= STMT_LG_DAYS;
  });
}

function stmtLgBuildItems(results, imported) {
  const txs = [];
  let foreign = 0;
  results.forEach(res => {
    if (res.kind !== 'bank') return;
    const sid = res.statementId;
    const reprocess = imported.has(sid) && stmtReprocess.has(sid);
    if (imported.has(sid) && !reprocess) return;
    const base = { sid, src: res.label, failed: !res.allChecksOk, reprocess };
    (res.bankTx || []).forEach(t => {
      const target = stmtBankTarget(res, { accountNo: t.accountNo, currency: t.currency || 'TWD' });
      if (target && target.skip) return;                       // 這個帳戶設定成「不匯入」
      if (t.currency && t.currency !== 'TWD') { foreign++; return; }
      if (!(Number(t.amount) || 0)) return;
      const c = stmtLgClassify(t);
      txs.push(Object.assign({ base, res, t }, c, { key: [sid, t.accountNo, t.date, Number(t.amount), t.balance].join('|') }));
    });
  });
  if (!txs.length && !foreign) return;

  // 1. 已經記過的（重新處理時）
  txs.forEach(x => { x.done = lgStmtKeyUsed(x.key); });

  // 2. 一對一配對：日期最近的先配
  const used = new Set();
  const pairs = [];
  txs.forEach((x, xi) => {
    if (x.done) return;
    stmtLgCandidates(x, new Set()).forEach(e => pairs.push({ xi, e, days: stmtDaysApart(e.date, x.t.date) }));
  });
  pairs.sort((a, b) => a.days - b.days || String(a.e.date).localeCompare(String(b.e.date)));
  const matchOf = {};
  pairs.forEach(p => {
    if (matchOf[p.xi] !== undefined || used.has(p.e.id)) return;
    matchOf[p.xi] = p;
    used.add(p.e.id);
  });

  // 3. 自己兩個帳戶之間互轉：沒配對到、分類是「其他」、同金額、差 1 天內、不同帳戶、一進一出
  const transfer = {};
  txs.forEach((a, ai) => {
    if (a.done || matchOf[ai] || a.category !== '其他' || a.dir !== 'out') return;
    txs.forEach((b, bi) => {
      if (transfer[ai] || transfer[bi] || bi === ai || b.done || matchOf[bi] || b.category !== '其他' || b.dir !== 'in') return;
      if (Math.abs(Math.abs(a.t.amount) - b.t.amount) > 0.5 || a.t.accountNo === b.t.accountNo) return;
      if (stmtDaysApart(a.t.date, b.t.date) > 1) return;
      transfer[ai] = b; transfer[bi] = a;
    });
  });

  // 4. 組成確認畫面的項目
  const payMethod = stmtLgBankPayMethod();
  txs.forEach((x, xi) => {
    const m = matchOf[xi];
    const data = { date: x.t.date, item: x.item, amount: Math.abs(x.t.amount), category: x.category, dir: x.dir, kind: x.kind, payMethod: x.kind === 'expense' ? payMethod : '', key: x.key, tag: x.tag, acc: String(x.t.accountNo || '').slice(-4) };
    const it = stmtItem(Object.assign({}, x.base, {
      type: 'ledgerTx', date: x.t.date, data,
      edit: [['item', '項目', 'text'], ['amount', '金額'], ['date', '日期 (YYYY-MM-DD)', 'text']]
    }));
    if (x.done) {
      it.group = 'skip'; it.checked = false; it.note = '這一行之前已經記進記帳了';
    } else if (m) {
      const e = m.e;
      it.group = 'update'; it.checked = true;
      it.matchId = e.id;
      it.matchInfo = { kind: x.kind, item: e.item || '（沒寫項目）', date: e.date, days: m.days, category: e.category, amount: x.kind === 'income' ? e.amount : e.price };
      it.edit = [];
    } else if (transfer[xi]) {
      const o = transfer[xi];
      it.group = 'review'; it.checked = false;
      it.note = `可能是自己帳戶之間的轉帳（另一邊：${stmtRoc(o.t.date)} ${o.res.label} …${String(o.t.accountNo || '').slice(-4)} ${o.dir === 'in' ? '存入' : '提出'}）。兩邊都不要記就不用勾。`;
    } else {
      it.group = 'add'; it.checked = true;
    }
    stmtItems.push(it);
  });
  if (foreign) stmtItems.push(stmtItem({ type: 'info', group: 'skip', checked: false, title: `外幣帳戶的明細 ${foreign} 筆`, detail: '記帳只記台幣，這些沒有列入' }));
}

/* ---------- 確認畫面 ---------- */
function stmtLgCatName(kind, id) {
  const c = lgCatMap(kind)[id];
  return c ? c.name : id;
}
function stmtLgDescribe(it) {
  const d = it.data;
  const sign = d.dir === 'in' ? '+' : '－';
  const title = `${stmtEsc(stmtRoc(d.date))} ${stmtEsc(d.item)}　${sign}$${stmtFmt(d.amount)}`;
  if (it.matchInfo) {
    const mi = it.matchInfo;
    return {
      tag: '記帳', title,
      detail: `✓ 和你手動記的「${stmtEsc(mi.item)}」（${stmtEsc(mi.date)}、${stmtEsc(stmtLgCatName(mi.kind, mi.category))}）對上了${mi.days ? `，日期差 ${mi.days} 天` : ''}。只標記「已對帳」，不會新增、項目名稱保留你寫的。`,
      amount: d.amount
    };
  }
  return {
    tag: '記帳', title,
    detail: `…${stmtEsc(d.acc)} 帳戶・記成${d.kind === 'income' ? '收入' : '支出'}${d.tag ? `（${stmtEsc(d.tag)}）` : ''}${d.kind === 'expense' && d.payMethod ? `・${stmtEsc(lgPayName(d.payMethod))}` : ''}`,
    amount: d.amount
  };
}
function stmtLgExtraHtml(it) {
  if (it.type !== 'ledgerTx') return '';
  if (it.matchInfo) return `<div style="margin-top:6px;"><button class="stmt-edit-btn" onclick="stmtLgUnmatch(${it.id})">這不是同一筆，改成新增一筆</button></div>`;
  const d = it.data;
  const cats = lgCatList(d.kind);
  const known = cats.some(c => c.id === d.category);
  return `
    <div class="stmt-choice">
      <label>分類
        <select onchange="stmtLgSetCat(${it.id}, this.value)">
          ${(known ? cats : cats.concat([{ id: d.category, name: d.category }])).map(c => `<option value="${stmtEsc(c.id)}" ${c.id === d.category ? 'selected' : ''}>${stmtEsc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>項目 <input type="text" value="${stmtEsc(d.item)}" onchange="stmtEditField(${it.id}, 'item', this.value, 'text')" /></label>
    </div>`;
}
function stmtLgSetCat(id, v) { const it = stmtFind(id); if (it) it.data.category = v; }
function stmtLgUnmatch(id) {
  const it = stmtFind(id);
  if (!it || !it.matchInfo) return;
  delete it.matchId; delete it.matchInfo;
  it.group = 'add'; it.checked = true;
  it.edit = [['item', '項目', 'text'], ['amount', '金額'], ['date', '日期 (YYYY-MM-DD)', 'text']];
  stmtRefreshKeepScroll();
}

/* ---------- 寫入 ---------- */
function stmtLgApply(it, bump, problems) {
  const d = it.data;
  const link = { sid: it.sid, key: d.key };
  if (lgStmtKeyUsed(d.key)) { problems.push(`${d.item}：這一行已經在記帳裡了，沒有重複記`); return; }
  if (it.matchId) {
    const list = d.kind === 'income' ? lg.incomes : lg.expenses;
    const target = list.find(e => e.id === it.matchId);
    if (!target) { problems.push(`${d.item}：找不到要對帳的那筆手動紀錄（可能已經被刪掉）`); return; }
    if (d.kind === 'income') lgUpdateIncome(target.id, { stmt: link }); else lgUpdateExpense(target.id, { stmt: link });
    bump('記帳：標記已對帳');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) { problems.push(`${d.item}：日期格式不對`); return; }
  if (d.kind === 'income') {
    lgEnsureCategory('income', d.category);
    lgAddIncome({ date: d.date, category: d.category, item: d.item, amount: Number(d.amount) || 0, note: '', source: 'statement', stmt: link });
    bump('記帳：新增收入');
  } else {
    lgEnsureCategory('expense', d.category);
    lgAddExpense({ date: d.date, category: d.category, item: d.item, price: Number(d.amount) || 0, note: '', payMethod: d.payMethod || '', source: 'statement', stmt: link });
    bump('記帳：新增支出');
  }
}

/* ---------- 復原／寫完後更新畫面 ---------- */
function lgRestoreSnapshot(snap) {
  lg = lgNormalize(snap);
  lgSave();
  if (typeof lgOnDataReplaced === 'function') lgOnDataReplaced();
  if (typeof lgAfterLedgerChange === 'function') lgAfterLedgerChange();
}
function lgAfterStmtApply() {
  if (typeof lgIsVisible === 'function' && lgIsVisible()) renderLedger();
  if (typeof lgAfterLedgerChange === 'function') lgAfterLedgerChange();
}
