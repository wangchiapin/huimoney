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
   - 信用卡帳單（國泰世華、台北富邦）：每一筆消費和手動記的「信用卡」支出比對（金額一樣、日期差 5 天內、一對一）
       ‧ 對上了 → 標記「✓ 已對帳」；沒對上 → 新增一筆支出，付款方式是你選的那張卡（選過會記住）
       ‧ 繳款、零元項目（年費減免）不記；退款放「需要你看」
   需要 ledger.js、stmt-import.js
   ==================================================================== */

const STMT_LG_SETTLE = '股票交割';
const STMT_LG_DAYS = 5;

function stmtLgBankPayMethod() {
  const m = lg.payMethods.find(x => x.type === 'bank');
  return m ? m.id : '';
}

// 一筆銀行明細 → { dir:'in'|'out', kind:'expense'|'income', category, item, tag }
// 你教過的關鍵字：[{ kw, kind:'income'|'expense', cat }]，字比較長的先比
function stmtLgUserKeywords() {
  const s = stmtSettingsObj();
  if (!Array.isArray(s.ledgerKeywords)) s.ledgerKeywords = [];
  return s.ledgerKeywords;
}
function stmtLgUserMatch(desc, kind) {
  return stmtLgUserKeywords().filter(k => k.kind === kind && k.kw && desc.includes(k.kw)).sort((a, b) => b.kw.length - a.kw.length)[0] || null;
}
function stmtLgClassify(t) {
  const amt = Number(t.amount) || 0;
  const dir = amt > 0 ? 'in' : 'out';
  const desc = String(t.desc || '').replace(/\s+/g, ' ').trim();
  let category = '', tag = '', known = true;
  const taught = stmtLgUserMatch(desc, dir === 'in' ? 'income' : 'expense');
  if (taught) { category = taught.cat; tag = '你教過的關鍵字'; }
  else if (t.category === 'securitiesSettlement') { category = STMT_LG_SETTLE; tag = '股票交割'; }
  else if (t.category === 'cashDividend') { category = '股利'; tag = '現金股息'; }
  else if (t.category === 'compensationRef') { category = '股利'; tag = '權益息'; }
  else if (t.category === 'lendingFeeRef') { category = '借券收入'; tag = '借券費'; }
  else if (dir === 'out' && /卡費|信用卡|卡款/.test(desc)) { category = LG_CARD_FEE_ID; tag = '繳卡費'; }
  else if (dir === 'in' && /薪/.test(desc)) { category = '薪資收入'; }
  else if (dir === 'out' && lgGuessCategory(desc)) { category = lgGuessCategory(desc); }
  else { category = '其他'; known = false; }
  return { dir, kind: dir === 'in' ? 'income' : 'expense', category, item: desc || (dir === 'in' ? '存入' : '提出'), tag, known };
}

// 手動紀錄裡，哪些可以和這筆銀行明細比對
function stmtLgCandidates(x, usedIds) {
  const abs = Math.abs(Number(x.t.amount) || 0);
  const list = x.kind === 'income' ? lg.incomes : lg.expenses;
  return list.filter(e => {
    if (e.stmt || usedIds.has(e.id)) return false;
    const amount = x.kind === 'income' ? e.amount : e.price;
    if (Math.abs((Number(amount) || 0) - abs) > 0.5) return false;
    if (x.isCard) {
      if (lgPayType(e.payMethod) !== 'card') return false;                             // 信用卡帳單只配付款方式是「信用卡」的
    } else if (x.kind === 'expense') {
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
    if (res.kind === 'card') { stmtLgCardCollect(res, imported, txs); return; }
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
  const sameCard = p => (txs[p.xi].isCard && txs[p.xi].payMethod && p.e.payMethod === txs[p.xi].payMethod) ? 0 : 1;
  pairs.sort((a, b) => a.days - b.days || sameCard(a) - sameCard(b) || String(a.e.date).localeCompare(String(b.e.date)));
  const matchOf = {};
  pairs.forEach(p => {
    if (matchOf[p.xi] !== undefined || used.has(p.e.id)) return;
    matchOf[p.xi] = p;
    used.add(p.e.id);
  });

  // 3. 自己兩個帳戶之間互轉：沒配對到、分類是「其他」、同金額、差 1 天內、不同帳戶、一進一出
  const transfer = {};
  txs.forEach((a, ai) => {
    if (a.done || a.isCard || matchOf[ai] || a.category !== '其他' || a.dir !== 'out') return;
    txs.forEach((b, bi) => {
      if (transfer[ai] || transfer[bi] || bi === ai || b.isCard || b.done || matchOf[bi] || b.category !== '其他' || b.dir !== 'in') return;
      if (Math.abs(Math.abs(a.t.amount) - b.t.amount) > 0.5 || a.t.accountNo === b.t.accountNo) return;
      if (stmtDaysApart(a.t.date, b.t.date) > 1) return;
      transfer[ai] = b; transfer[bi] = a;
    });
  });

  // 4. 組成確認畫面的項目
  const payMethod = stmtLgBankPayMethod();
  txs.forEach((x, xi) => {
    const m = matchOf[xi];
    const data = { date: x.t.date, item: x.item, amount: Math.abs(x.t.amount), category: x.category, dir: x.dir, kind: x.kind, payMethod: x.isCard ? (x.payMethod || '') : (x.kind === 'expense' ? payMethod : ''), card: !!x.isCard, key: x.key, tag: x.tag, known: x.known, desc: x.t.desc || '', acc: String(x.t.accountNo || '').slice(-4) };
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
    } else if (x.isCard && x.kind === 'income') {
      it.group = 'review'; it.checked = false;
      it.note = '這是信用卡的退款（或回饋）。要不要記成收入請自己決定；如果當初的消費記過了，也可以去把那筆支出刪掉。';
    } else if (x.isCard && !x.payMethod) {
      it.group = 'review'; it.checked = false;
      it.note = '請選這筆是哪一張信用卡刷的（選過會記住），再勾起來。';
    } else if (!x.known) {
      it.group = 'review'; it.checked = false;
      it.note = '看不出這是哪一類（還沒有符合的關鍵字）。請選分類後勾起來；可以按「記住關鍵字」，下次自動認。';
    } else {
      it.group = 'add'; it.checked = true;
    }
    stmtItems.push(it);
  });
  if (foreign) stmtItems.push(stmtItem({ type: 'info', group: 'skip', checked: false, title: `外幣帳戶的明細 ${foreign} 筆`, detail: '記帳只記台幣，這些沒有列入' }));
}

/* ---------- 信用卡帳單 ---------- */
// 每一張卡（用帳單種類＋卡號後四碼分）要記到記帳的哪個「付款方式」：記在設定裡
const STMT_LG_CARD_HINT = { cathay_card: ['國泰', 'cathay'], fubon_card: ['富邦', 'fubon'] };
function stmtLgCardPayMap() {
  const s = stmtSettingsObj();
  if (!s.cardPay || typeof s.cardPay !== 'object') s.cardPay = {};
  return s.cardPay;
}
function stmtLgCardKey(res, last4) { return `${res.source}|${last4 || ''}`; }
function stmtLgCardMethod(res, last4) {
  const saved = stmtLgCardPayMap()[stmtLgCardKey(res, last4)];
  if (saved && lg.payMethods.some(m => m.id === saved)) return saved;
  const cards = lg.payMethods.filter(m => m.type === 'card');
  const hints = STMT_LG_CARD_HINT[res.source] || [];
  const named = cards.filter(m => hints.some(h => String(m.name).toLowerCase().includes(h)));
  if (named.length === 1) return named[0].id;
  if (!named.length && cards.length === 1) return cards[0].id;
  return '';
}
function stmtLgCardCollect(res, imported, txs) {
  const sid = res.statementId;
  const reprocess = imported.has(sid) && stmtReprocess.has(sid);
  if (imported.has(sid) && !reprocess) return;
  const base = { sid, src: res.label, failed: !res.allChecksOk, reprocess };
  const seen = {};
  let skipped = 0;
  (res.cardTx || []).forEach(t => {
    const amt = Number(t.amount) || 0;
    const desc = String(t.desc || '').replace(/\s+/g, ' ').trim();
    if (!amt || (amt < 0 && /繳款|扣繳|自動轉帳|繳費|轉帳/.test(desc))) { skipped++; return; }   // 零元（年費減免）、繳款都不記
    const spend = amt > 0;
    const k0 = [sid, 'card', t.last4 || '', t.date, amt, desc].join('|');
    seen[k0] = (seen[k0] || 0) + 1;                       // 同一天同金額同店家刷兩次，識別碼加序號
    const taught = stmtLgUserMatch(desc, spend ? 'expense' : 'income');
    let category = '其他', known = !spend, tag = '';
    if (taught) { category = taught.cat; known = true; tag = '你教過的關鍵字'; }
    else if (spend && lgGuessCategory(desc)) { category = lgGuessCategory(desc); known = true; }
    const foreign = t.currency && t.currency !== 'TWD';
    txs.push({
      base, res, isCard: true,
      t: { date: t.date, amount: -amt, desc, accountNo: t.last4 || '', balance: null },
      dir: spend ? 'out' : 'in', kind: spend ? 'expense' : 'income', category, tag, known,
      item: desc + (foreign ? `（${t.currency} ${t.foreignAmount === null ? '' : stmtFmt(t.foreignAmount, 2)}）` : '') || (spend ? '刷卡' : '退款'),
      payMethod: spend ? stmtLgCardMethod(res, t.last4) : '',
      key: k0 + '|' + seen[k0]
    });
  });
  const c = res.card || {};
  const bits = [];
  if (c.closingDate) bits.push(`結帳日 ${stmtEsc(stmtRoc(c.closingDate))}`);
  if (c.totalDue !== null && c.totalDue !== undefined) bits.push(`本期應繳總額 $${stmtFmt(c.totalDue)}`);
  if (c.minDue) bits.push(`最低應繳 $${stmtFmt(c.minDue)}`);
  if (c.dueDate) bits.push(`繳款截止日 ${stmtEsc(stmtRoc(c.dueDate))}`);
  if (skipped) bits.push(`繳款／零元項目 ${skipped} 筆不記`);
  stmtItems.push(stmtItem({ sid, src: res.label, type: 'info', group: 'skip', checked: false, title: `${res.label} ${res.period} 帳單`, detail: bits.join('・') || '信用卡帳單' }));
}
function stmtLgSetCardPay(id, v) {
  const it = stmtFind(id);
  if (!it) return;
  const res = stmtResults().find(r => r.kind === 'card' && r.statementId === it.sid);
  if (!res) { it.data.payMethod = v; return; }
  const map = stmtLgCardPayMap();
  const key = stmtLgCardKey(res, it.data.acc);
  if (v) map[key] = v; else delete map[key];
  stmtAfterSetting();           // 重排一次（同一張卡的其他筆也會跟著換）
}
function stmtLgDelCardPay(key) {
  if (!confirm('確定要刪掉這個設定嗎？')) return;
  delete stmtLgCardPayMap()[key];
  stmtAfterSetting();
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
    detail: d.card
      ? `${stmtEsc(it.src || '信用卡')}${d.acc ? ' 卡號 …' + stmtEsc(d.acc) : ''}・記成${d.kind === 'income' ? '收入（退款）' : '支出'}${d.tag ? `（${stmtEsc(d.tag)}）` : ''}${d.kind === 'expense' ? `・${d.payMethod ? stmtEsc(lgPayName(d.payMethod)) : '還沒選信用卡'}` : ''}`
      : `…${stmtEsc(d.acc)} 帳戶・記成${d.kind === 'income' ? '收入' : '支出'}${d.tag ? `（${stmtEsc(d.tag)}）` : ''}${d.kind === 'expense' && d.payMethod ? `・${stmtEsc(lgPayName(d.payMethod))}` : ''}`,
    amount: d.amount
  };
}
function stmtLgExtraHtml(it) {
  if (it.type !== 'ledgerTx') return '';
  if (it.matchInfo) return `<div style="margin-top:6px;"><button class="stmt-edit-btn" onclick="stmtLgUnmatch(${it.id})">這不是同一筆，改成新增一筆</button></div>`;
  const d = it.data;
  const cats = lgCatList(d.kind);
  const known = cats.some(c => c.id === d.category);
  const cards = d.card && d.kind === 'expense' ? lg.payMethods.filter(m => m.type === 'card') : [];
  const cardSel = d.card && d.kind === 'expense' ? `
      <label>哪一張信用卡
        <select onchange="stmtLgSetCardPay(${it.id}, this.value)">
          <option value="" ${d.payMethod ? '' : 'selected'}>（請選）</option>
          ${cards.map(m => `<option value="${stmtEsc(m.id)}" ${m.id === d.payMethod ? 'selected' : ''}>${stmtEsc(m.name)}</option>`).join('')}
        </select>
      </label>${cards.length ? '' : '<span class="stmt-set-tip">記帳的「付款方式」裡還沒有信用卡，請先到記帳新增。</span>'}` : '';
  return `
    <div class="stmt-choice">${cardSel}
      <label>分類
        <select onchange="stmtLgSetCat(${it.id}, this.value)">
          ${(known ? cats : cats.concat([{ id: d.category, name: d.category }])).map(c => `<option value="${stmtEsc(c.id)}" ${c.id === d.category ? 'selected' : ''}>${stmtEsc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>項目 <input type="text" value="${stmtEsc(d.item)}" onchange="stmtEditField(${it.id}, 'item', this.value, 'text')" /></label>
      <label>記住關鍵字 <input type="text" id="stmtKw${it.id}" value="${stmtEsc(stmtLgKwGuess(d.desc))}" placeholder="例如：配息" /></label>
      <button type="button" class="stmt-edit-btn" onclick="stmtLgTeach(${it.id})">以後看到這個字，都記成「${stmtEsc(stmtLgCatName(d.kind, d.category))}」</button>
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

/* ---------- 教它關鍵字：記在設定裡，會跟著雲端同步 ---------- */
function stmtLgKwGuess(desc) {
  // 去掉數字、日期、符號，留下第一段中文字當建議
  const m = String(desc || '').replace(/[0-9A-Za-z*\/\-_.,:：()（）\s]+/g, ' ').trim().split(' ')[0] || '';
  return m.slice(0, 6);
}
function stmtLgTeach(id) {
  const it = stmtFind(id);
  const input = document.getElementById('stmtKw' + id);
  if (!it || !input) return;
  const kw = input.value.trim();
  if (!kw) { showToast('請先填關鍵字', 'error'); return; }
  const kind = it.data.kind;
  const list = stmtLgUserKeywords();
  const old = list.find(k => k.kw === kw && k.kind === kind);
  if (old) old.cat = it.data.category; else list.push({ kw, kind, cat: it.data.category });
  showToast(`記住了：看到「${kw}」記成「${stmtLgCatName(kind, it.data.category)}」`);
  stmtAfterSetting();
}
function stmtLgDelKw(i) {
  const list = stmtLgUserKeywords();
  if (!confirm('確定要刪掉這個關鍵字嗎？')) return;
  list.splice(i, 1);
  stmtAfterSetting();
}
// 「管理所有記住的設定」裡的一段
function stmtLgManageRows() {
  const cardRows = Object.keys(stmtLgCardPayMap()).map(k => {
    const [src, last4] = k.split('|');
    const label = (typeof StmtParsers !== 'undefined' && StmtParsers.LABELS[src]) || src;
    return `<div class="stmt-set-row"><span>${stmtEsc(label)}${last4 ? ' 卡號 …' + stmtEsc(last4) : ''} → 付款方式「${stmtEsc(lgPayName(stmtLgCardPayMap()[k]))}」</span><span class="stmt-set-ctl"><button type="button" class="stmt-del-btn" onclick="stmtLgDelCardPay('${stmtEsc(k)}')">刪除</button></span></div>`;
  });
  return cardRows.concat(stmtLgUserKeywords().map((k, i) => `<div class="stmt-set-row"><span>看到「${stmtEsc(k.kw)}」（${k.kind === 'income' ? '存入' : '提出'}）→ 記成「${stmtEsc(stmtLgCatName(k.kind, k.cat))}」</span><span class="stmt-set-ctl"><button type="button" class="stmt-del-btn" onclick="stmtLgDelKw(${i})">刪除</button></span></div>`));
}
