/* ====================================================================
   📝 隨手記：想到什麼先打一行，之後解析成待確認的支出，確認後才加入記帳
   格式例如：0913 早餐 500 午餐300 晚餐600（日期可寫 0913、20260913、2026-09-13、民國115年9月13日）
   - 沒有日期的行不會亂猜，原樣留在文字框裡讓你自己修改
   - 草稿存在 lg.quickNoteDraft，會跟著雲端同步
   - 解析方式沿用 moneybook（去掉「媽媽」分類）
   需要 ledger.js、ledger-ui.js
   ==================================================================== */

let lgQN = null;   // { text, parsed: { candidates, unresolved } | null, msg }

// 項目文字 → 分類的關鍵字（用 id 對應預設分類；分類被刪掉或改了 id 就跳過）
const LG_QN_KEYWORDS = {
  '食': ['早餐', '午餐', '晚餐', '消夜', '宵夜', '咖啡', '飲料', '便當', '小吃', '火鍋', '燒烤', '超商', '超市', '買菜', '食材', '外送', '飲食'],
  '衣': ['衣服', '鞋', '包包', '褲', '裙', '配件', '飾品'],
  '共同基金': ['基金', '共同基金', '提撥', '存款'],
  '行': ['加油', '停車', '計程車', 'uber', '公車', '捷運', '高鐵', '火車', '過路費', '機車', '保養', '燃料稅', '牌照稅'],
  '居家': ['房租', '水電', '瓦斯費', '電費', '水費', '網路費', '家具', '家電', '修繕', '日用品', '衛生紙'],
  '卡費': ['卡費', '信用卡', '刷卡', '分期'],
  '保險': ['保險', '保費', '壽險', '醫療險', '車險'],
  '育': ['學費', '補習', '課程', '教育', '考試', '證照'],
  '樂': ['電影', '唱歌', 'ktv', '遊戲', '旅遊', '展覽', '演唱會', '訂閱', 'netflix', 'spotify'],
  '公益': ['捐款', '公益', '樂捐', '慈善']
};
function lgGuessCategory(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return '';
  const ids = new Set(lg.categories.map(c => c.id));
  for (const id of Object.keys(LG_QN_KEYWORDS)) {
    if (ids.has(id) && LG_QN_KEYWORDS[id].some(k => t.includes(k.toLowerCase()))) return id;
  }
  return '';
}

const LG_QN_DATE_PATTERNS = [
  { re: /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, kind: 'ad' },
  { re: /^民國(\d{2,3})年?(\d{1,2})月(\d{1,2})日?/, kind: 'roc' },
  { re: /^(\d{4})(\d{2})(\d{2})(?!\d)/, kind: 'ad' },
  { re: /^(\d{2})(\d{2})(?!\d)/, kind: 'mmdd' }
];
function lgQNExtractDate(line, todayIso) {
  for (const { re, kind } of LG_QN_DATE_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;
    let y, mo, d;
    if (kind === 'ad') { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if (kind === 'roc') { y = +m[1] + 1911; mo = +m[2]; d = +m[3]; }
    else { y = +todayIso.slice(0, 4); mo = +m[1]; d = +m[2]; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    return { iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, rest: line.slice(m[0].length).trim() };
  }
  return null;
}
// "早餐 500 午餐300" → [{item:'早餐',price:500},{item:'午餐',price:300}]；最後只有項目沒金額 → 金額 0（標紅，要補）
function lgQNExtractPairs(rest) {
  const pairs = [];
  const re = /([^\d]*?)(\d+(?:\.\d+)?)/g;
  let m, last = 0;
  while ((m = re.exec(rest)) !== null) { pairs.push({ item: m[1].trim(), price: Number(m[2]) }); last = re.lastIndex; }
  const trailing = rest.slice(last).trim();
  if (trailing) pairs.push({ item: trailing, price: 0 });
  if (!pairs.length && rest.trim()) pairs.push({ item: rest.trim(), price: 0 });
  return pairs;
}
function lgParseQuickNote(raw, todayIso) {
  const lines = String(raw || '').split('\n').map(l => l.trim()).filter(Boolean);
  const candidates = [], unresolved = [];
  lines.forEach(line => {
    const di = lgQNExtractDate(line, todayIso);
    if (!di) { unresolved.push(line); return; }
    const pairs = lgQNExtractPairs(di.rest);
    if (!pairs.length) { candidates.push({ tempId: lgGenId(), date: di.iso, category: '', item: '', price: 0 }); return; }
    pairs.forEach(p => candidates.push({ tempId: lgGenId(), date: di.iso, category: lgGuessCategory(p.item), item: p.item, price: p.price }));
  });
  return { candidates, unresolved };
}
function lgQNIncomplete(c) { return !c.category || !String(c.item).trim() || !(Number(c.price) > 0); }

/* ---------- 視窗 ---------- */
function lgOpenQuickNote() {
  lgQN = { text: lg.quickNoteDraft || '', parsed: null, msg: '' };
  lgOverlayRoot().innerHTML = `
    <div class="lg-overlay" onclick="lgCloseQuickNote()">
      <div class="lg-sheet" onclick="event.stopPropagation()">
        <div class="lg-sheet-head"><h3>📝 隨手記</h3><button type="button" class="lg-x" onclick="lgCloseQuickNote()" aria-label="關閉">✕</button></div>
        <div class="lg-hint">想到什麼先隨手打一行，之後再整理。格式例如：<br><b>0913 早餐 500 午餐300 晚餐600</b><br>每一行開頭要有日期；沒有日期的行不會亂猜，會原樣留著。</div>
        <textarea id="lgQNText" class="lg-input lg-qn-text" rows="5" oninput="lgQN.text = this.value">${lgEsc(lgQN.text)}</textarea>
        <button type="button" class="lg-submit out" style="margin-top:10px" onclick="lgQNParse()">解析</button>
        <div id="lgQNOut"></div>
      </div>
    </div>`;
}
function lgCloseQuickNote() {
  if (lgQN) lgSetQuickDraft(lgQN.text);
  lgQN = null;
  lgCloseOverlay();
  if (lgIsVisible()) renderLedger();
}
function lgQNParse() {
  if (!lgQN) return;
  lgQN.parsed = lgParseQuickNote(lgQN.text, lgTodayISO());
  lgQN.msg = '';
  lgSetQuickDraft(lgQN.text);
  lgQNRenderOut();
}
function lgQNRenderOut() {
  const out = document.getElementById('lgQNOut');
  if (!out || !lgQN) return;
  const p = lgQN.parsed;
  const cats = lg.categories;
  let html = '';
  if (lgQN.msg) html += `<div class="lg-qn-msg">✅ ${lgEsc(lgQN.msg)}</div>`;
  if (p && p.candidates.length) {
    const bad = p.candidates.filter(lgQNIncomplete).length;
    html += `<div class="lg-label" style="margin-top:14px">待確認新增（${p.candidates.length} 筆）</div>`;
    html += p.candidates.map(c => `
      <div class="lg-qn-card ${lgQNIncomplete(c) ? 'bad' : ''}" data-id="${lgEsc(c.tempId)}">
        <div class="lg-qn-row">
          <input type="date" class="lg-input slim" value="${lgEsc(c.date)}" onchange="lgQNUpdate('${lgEsc(c.tempId)}','date',this.value)">
          <select class="lg-input slim" onchange="lgQNUpdate('${lgEsc(c.tempId)}','category',this.value)">
            <option value="">未分類</option>
            ${cats.map(k => `<option value="${lgEsc(k.id)}" ${k.id === c.category ? 'selected' : ''}>${lgEsc(k.name)}</option>`).join('')}
          </select>
          <button type="button" class="lg-mini dim" onclick="lgQNRemove('${lgEsc(c.tempId)}')" aria-label="移除">🗑</button>
        </div>
        <div class="lg-qn-row">
          <input type="text" class="lg-input slim" style="flex:2" placeholder="項目" value="${lgEsc(c.item)}" onchange="lgQNUpdate('${lgEsc(c.tempId)}','item',this.value)">
          <input type="number" class="lg-input slim" style="flex:1" placeholder="金額" inputmode="decimal" value="${c.price || ''}" onchange="lgQNUpdate('${lgEsc(c.tempId)}','price',this.value)">
        </div>
      </div>`).join('');
    html += bad ? `<div class="lg-fund-hint">有 ${bad} 筆缺分類、項目或金額（紅底），補完才能加入；其他完整的可以先加入。</div>` : '';
    html += `<button type="button" class="lg-submit in" style="margin-top:10px" onclick="lgQNConfirm()">確認並加入記帳（${p.candidates.length - bad} 筆）</button>`;
  }
  if (p && p.unresolved.length) {
    html += `<div class="lg-label" style="margin-top:14px">看不懂的內容（不會加入記帳）</div>
      <div class="lg-qn-unres">${p.unresolved.map(l => `<div>· ${lgEsc(l)}</div>`).join('')}</div>
      <div class="lg-fund-hint">請在上面文字框補上日期再按「解析」；關閉視窗時內容會先幫你留著。</div>`;
  }
  if (p && !p.candidates.length && !p.unresolved.length && !lgQN.msg) html += '<div class="lg-empty-sm" style="margin-top:12px">沒有內容可以解析</div>';
  out.innerHTML = html;
}
function lgQNUpdate(tempId, field, value) {
  if (!lgQN || !lgQN.parsed) return;
  lgQN.parsed.candidates = lgQN.parsed.candidates.map(c => (c.tempId === tempId ? Object.assign({}, c, { [field]: field === 'price' ? (Number(value) || 0) : value }) : c));
  lgQNRenderOut();
}
function lgQNRemove(tempId) {
  if (!lgQN || !lgQN.parsed) return;
  lgQN.parsed.candidates = lgQN.parsed.candidates.filter(c => c.tempId !== tempId);
  lgQNRenderOut();
}
function lgQNConfirm() {
  if (!lgQN || !lgQN.parsed) return;
  const ok = lgQN.parsed.candidates.filter(c => !lgQNIncomplete(c) && /^\d{4}-\d{2}-\d{2}$/.test(c.date));
  if (!ok.length) { lgToast('還沒有完整的紀錄可以加入', 'error'); return; }
  ok.forEach(c => lgAddExpense({ date: c.date, category: c.category, item: String(c.item).trim(), price: Number(c.price), note: '', source: 'quicknote' }));
  const left = lgQN.parsed.candidates.filter(c => !ok.includes(c));
  // 沒加入的（缺資料的）和看不懂的，留在草稿裡，下次還找得到
  const keepLines = lgQN.parsed.unresolved.concat(left.map(c => `${c.date} ${c.item} ${c.price || ''}`.trim()));
  lgQN.text = keepLines.join('\n');
  lgSetQuickDraft(lgQN.text);
  lgQN.parsed = { candidates: left, unresolved: lgQN.parsed.unresolved };
  lgQN.msg = `已新增 ${ok.length} 筆到記帳`;
  const ta = document.getElementById('lgQNText');
  if (ta) ta.value = lgQN.text;
  lgQNRenderOut();
  if (typeof lgAfterLedgerChange === 'function') lgAfterLedgerChange();
}
