    /* ====== Firebase 雲端同步設定（huimoney：目前不接上） ======
       程式架構跟 All-MoneyBook 一樣保留（財務、股票、保險、資產總覽每月紀錄、📬 待確認），
       但設定先留空，index.html 也沒有載入 Firebase 程式庫，所以不會連到任何雲端，按「登入」只會跳提示。
       以後要接上：1) 在下面填好 Firebase 專案設定；2) 打開 index.html 裡被註解掉的三行 Firebase 程式庫；
       3) 把 handleLoginClick() 裡的提示換成原本的登入流程（All-MoneyBook 的寫法）。 */
    const firebaseConfig = {
  apiKey: "AIzaSyCmMjLxJOtG1Dh368UIEcKu9XVbawMeOj4",
  authDomain: "huy-money.firebaseapp.com",
  projectId: "huy-money",
  storageBucket: "huy-money.firebasestorage.app",
  messagingSenderId: "1081645927764",
  appId: "1:1081645927764:web:09f963b8bdcca060cb8cc1",
  measurementId: "G-ZN5FPVLEWE"
    };

    /* ====== 共用小工具：財務總覽 Excel 匯出/匯入用的「已封存」標記字首，
       讓封存項目也能完整匯出、之後合併匯入時自動以封存狀態還原 ====== */
    const FIN_ARCHIVE_MARK = '🗄️[已封存] ';

    /* ====== 共用小工具：HTML 屬性/內容跳脫，避免名稱、備註打到雙引號等特殊字元時把畫面弄壞 ====== */
    function esc(v) {
      if (v === null || v === undefined) return '';
      return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /* ====== 共用小工具：儲存格公式計算（財務總覽用）======
       儲存格可以直接輸入像 "=100+1" 這樣的算式，以下三個函式統一處理：
       - isFormulaInput：判斷一個原始值是不是公式字串（"=" 開頭）
       - evalCellFormula：計算公式（去掉開頭的 "="），只允許數字與 + - * / ( ) . 空白，
         白名單檢查過才計算，不接受任何其他字元，避免注入風險；算不出來回傳 null
       - resolveCellNumber：把「儲存格原始值」(可能是數字、數字字串、或公式字串)
         統一轉成計算用的數字；全站只要是讀取金額做加總/顯示，都應該經過這裡，
         公式儲存格才能正確被算進總計、圖表、匯出裡 ====== */
    function isFormulaInput(raw) {
      return typeof raw === 'string' && raw.trim().startsWith('=');
    }

    function evalCellFormula(expr) {
      const trimmed = String(expr == null ? '' : expr).trim();
      if (trimmed === '') return null;
      if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) return null;
      try {
        const result = Function('"use strict"; return (' + trimmed + ')')();
        return (typeof result === 'number' && isFinite(result)) ? result : null;
      } catch (e) {
        return null;
      }
    }

    function resolveCellNumber(raw) {
      if (raw === undefined || raw === null || raw === '') return 0;
      if (isFormulaInput(raw)) {
        const result = evalCellFormula(raw.trim().slice(1));
        return result === null ? 0 : result;
      }
      const n = Number(raw);
      return isNaN(n) ? 0 : n;
    }

    /* ====== 共用小工具：判斷一筆持股是否為美股複委託帳戶（原本在 stock.js 多處重複判斷，
       抽成共用函式方便統一維護；接受股票物件，或只有 account/category 兩個欄位的資料） ====== */
    function isUsStock(stock) {
      if (!stock) return false;
      return stock.account === '美股複委託' || stock.category === '美股';
    }

    /* ====== 共用小工具：手機數字鍵盤 (inputmode="decimal")
       整個 App 有很多地方各自用模板字串產生 <input type="number">（股票管理、財務總覽、
       股利、定期定額、借券...等好幾個檔案），逐一手動加屬性容易漏掉。
       改用 MutationObserver 監看整個頁面，任何新出現的數字輸入框都自動補上
       inputmode="decimal"，手機上會穩定跳出含小數點的數字鍵盤，且未來新增的
       輸入框也會自動套用，不用每個 render() 函式各自記得呼叫。 ====== */
    function applyDecimalInputMode(root) {
      (root || document).querySelectorAll('input[type="number"]:not([inputmode])').forEach(el => {
        el.setAttribute('inputmode', 'decimal');
      });
    }
    (function initDecimalInputModeObserver() {
      applyDecimalInputMode(document);
      const observer = new MutationObserver(() => applyDecimalInputMode(document));
      const start = () => observer.observe(document.body, { childList: true, subtree: true });
      if (document.body) start();
      else document.addEventListener('DOMContentLoaded', start);
    })();

    /* ====== 共用小工具：手機版三個懸浮元件（計算機／資產趨勢圖／小提醒卡片）互斥收合
       手機螢幕小，這三個 position:fixed 的面板同時開很容易互相重疊。
       規則只在手機寬度 (<=640px) 生效：桌機完全不受影響，維持原本各自獨立的行為。
       開啟任何一個時呼叫這個函式，把其他兩個收起來即可；各自原本的開啟入口
       （工具列上的 🧮／📈 按鈕、小提醒卡片右上角的展開）不需要改動。 ====== */
    function closeOtherFloatingWidgetsOnMobile(exceptName) {
      if (window.innerWidth > 640) return;
      if (exceptName !== 'calc') {
        const calc = document.getElementById('floatingCalculator');
        if (calc) calc.style.display = 'none';
      }
      if (exceptName !== 'chart') {
        const chart = document.getElementById('floatingChartPanel');
        if (chart) chart.style.display = 'none';
        if (typeof chartPanelVisible !== 'undefined') chartPanelVisible = false;
      }
      if (exceptName !== 'tips') {
        const tips = document.getElementById('tipsWidget');
        const bubble = document.getElementById('tipsWidgetBubble');
        if (tips && tips.style.display !== 'none') {
          tips.style.display = 'none';
          if (bubble) bubble.style.display = 'flex';
          if (typeof tipsWidgetPause === 'function') tipsWidgetPause();
        }
      }
    }

    /* ====== 共用小工具：輕量 Toast 提示（用來取代部分 alert，尤其是「儲存失敗」這種
       不該被使用者忽略、但也不用整個擋住畫面的通知） ====== */
    function showToast(msg, type) {      let box = document.getElementById('globalToastBox');
      if (!box) {
        box = document.createElement('div');
        box.id = 'globalToastBox';
        box.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:99999; display:flex; flex-direction:column; gap:8px; align-items:center; pointer-events:none;';
        document.body.appendChild(box);
      }
      const toast = document.createElement('div');
      const isError = type === 'error';
      toast.textContent = msg;
      toast.style.cssText = `pointer-events:auto; max-width:90vw; padding:10px 18px; border-radius:14px; font-size:0.85rem; font-weight:600; color:#fff; box-shadow:0 6px 18px rgba(120,80,50,0.2); background:${isError ? '#a8543d' : '#4a7c59'};`;
      box.appendChild(toast);
      setTimeout(() => {
        toast.style.transition = 'opacity 0.4s';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
      }, isError ? 6000 : 3000);
    }

    let fbAuth = null, fbDb = null, fbUser = null, cloudSaveTimer = null;

    try {
      // 設定是空的、或沒有載入 Firebase 程式庫，就當作「沒有雲端」，不初始化
      if (!firebaseConfig.apiKey || typeof firebase === 'undefined') throw new Error('huimoney：雲端同步未接上');
      firebase.initializeApp(firebaseConfig);
      fbAuth = firebase.auth();
      fbDb = firebase.firestore();
    } catch (e) {
      fbAuth = null; fbDb = null;   // 目前不接雲端，安靜略過
    }

    function handleLoginClick() {
      if (!fbAuth) {
        alert('☁️ 雲端同步目前還沒開放。\n\n你的資料只存在這台裝置的瀏覽器裡，請記得定期用「設定 → 匯出備份」下載備份。');
        return;
      }
      const email = prompt("Email：");
      if (!email) return;
      const password = prompt("密碼：");
      if (!password) return;
      fbAuth.signInWithEmailAndPassword(email, password)
        .catch(err => {
          if (err.code === 'auth/user-not-found') {
            // 修正：找不到帳號時不要默默自動註冊，先跟使用者確認，
            // 避免 Email 打錯字時誤建立一個全新空白帳號、以為資料不見了。
            const doRegister = confirm(
              `找不到帳號 ${email}。\n\n按「確定」會建立一個全新帳號（資料會是空白的）。\n按「取消」不會建立，請確認 Email 有沒有打錯字。`
            );
            if (doRegister) return fbAuth.createUserWithEmailAndPassword(email, password);
            return;
          }
          throw err;
        })
        .catch(err => { if (err) alert("登入失敗：" + err.message); });
    }

    function firebaseSignOut() {
      if (fbAuth) fbAuth.signOut();
    }


    /* ====== huimoney：密碼鎖定、子分頁隱藏都已拿掉 ======
       All-MoneyBook 的程式很多地方會問「這頁有沒有鎖、這個分頁有沒有藏起來」，
       這裡一律回答「沒有」，其他檔案就能跟 All-MoneyBook 保持一樣，之後同步比較容易。 */
    function isPageLocked() { return false; }
    function isFieldLocked() { return false; }
    function isTabHidden() { return false; }
    function lockPlaceholderHtml() { return ''; }

    /* ====== 分頁切換：個人財務資產狀況管理 <-> 股票管理 ====== */
    function switchAppView(view) {
      const financeView = document.getElementById('financeView');
      const stockView = document.getElementById('stockView');
      const insuranceView = document.getElementById('insuranceView');
      const overviewView = document.getElementById('overviewView');
      const tabFinance = document.getElementById('tabBtnFinance');
      const tabStock = document.getElementById('tabBtnStock');
      const tabInsurance = document.getElementById('tabBtnInsurance');
      const tabOverview = document.getElementById('tabBtnOverview');
      const retirementView = document.getElementById('retirementView');
      const tabRetirement = document.getElementById('tabBtnRetirement');
      const ledgerView = document.getElementById('ledgerView');
      const tabLedger = document.getElementById('tabBtnLedger');
      const fundView = document.getElementById('fundView');
      const tabFund = document.getElementById('tabBtnFund');

      financeView.style.display = 'none';
      stockView.style.display = 'none';
      if (insuranceView) insuranceView.style.display = 'none';
      if (overviewView) overviewView.style.display = 'none';
      if (tabOverview) tabOverview.classList.remove('active');
      if (retirementView) retirementView.style.display = 'none';
      if (tabRetirement) tabRetirement.classList.remove('active');
      if (ledgerView) ledgerView.style.display = 'none';
      if (tabLedger) tabLedger.classList.remove('active');
      if (fundView) fundView.style.display = 'none';
      if (tabFund) tabFund.classList.remove('active');
      tabFinance.classList.remove('active');
      tabStock.classList.remove('active');
      if (tabInsurance) tabInsurance.classList.remove('active');

      if (view === 'stock') {
        stockView.style.display = 'block';
        tabStock.classList.add('active');
        // 每次「進入」股票管理（含從其他分頁切回來），都視為重新進入分頁，
        // 讓對應的分頁/子分頁重新捲動到最新一筆資料
        if (typeof lastEnteredTabContext !== 'undefined') lastEnteredTabContext = null;
        if (typeof renderTable === 'function') renderTable();
      } else if (view === 'insurance') {
        if (insuranceView) insuranceView.style.display = 'block';
        if (tabInsurance) tabInsurance.classList.add('active');
        if (typeof renderInsuranceTable === 'function') renderInsuranceTable();
      } else if (view === 'retirement') {
        if (retirementView) retirementView.style.display = 'block';
        if (tabRetirement) tabRetirement.classList.add('active');
        if (typeof renderRetirement === 'function') renderRetirement();
      } else if (view === 'ledger') {
        if (ledgerView) ledgerView.style.display = 'block';
        if (tabLedger) tabLedger.classList.add('active');
        if (typeof showLedger === 'function') showLedger();
      } else if (view === 'fund') {
        if (fundView) fundView.style.display = 'block';
        if (tabFund) tabFund.classList.add('active');
        if (typeof showFund === 'function') showFund();
      } else if (view === 'overview') {
        if (overviewView) overviewView.style.display = 'block';
        if (tabOverview) tabOverview.classList.add('active');
        if (typeof showOverview === 'function') showOverview();
      } else {
        financeView.style.display = 'block';
        tabFinance.classList.add('active');
        if (typeof render === 'function') render();
        // 每次「進入」財務總覽，都重新捲動到最新日期那一欄
        if (typeof scrollFinanceToLatestDate === 'function') {
          setTimeout(scrollFinanceToLatestDate, 0);
        }
      }
      if (typeof saveNavState === 'function') saveNavState();
    }

    /* ====== 全站美元匯率預設值 ======
       股票管理、股票分析圖、小提醒卡片、Excel 匯出/匯入換算美股台幣時，都用這個值
       （以前寫死 29）。財務總覽每個日期欄位仍然用各自的「美金匯率」那一列，不受影響。
       存在本機 (USD_DEFAULT_RATE_V1)，登入後跟著股票管理資料一起同步到雲端 (stockAssets.usdRate)。每天自動抓到的匯率（data/prices.json）有更新時會自動套用（stock-price.js），
       也可以在標題列自己改；自己改的數字會用到下一次抓到新匯率為止。
       舊版 huimoney 存在 USD_FX_V1 的匯率，第一次開啟時會搬過來。 */
    const USD_RATE_KEY = 'USD_DEFAULT_RATE_V1';
    let usdDefaultRate = (() => {
      try {
        const v = Number(localStorage.getItem(USD_RATE_KEY));
        if (v > 0) return v;
        const old = JSON.parse(localStorage.getItem('USD_FX_V1') || 'null');  // 舊版 huimoney
        const r = old && Number(old.rate);
        if (r > 15 && r < 60) return r;
      } catch (e) { /* 略過 */ }
      return 29;
    })();

    function getUsdRate() { return usdDefaultRate; }

    function applyUsdRate(v, opts = {}) {
      const n = Number(v);
      if (!(n > 0)) return false;
      usdDefaultRate = n;
      try { localStorage.setItem(USD_RATE_KEY, String(n)); } catch (e) { /* 略過 */ }
      const input = document.getElementById('usdRateInput');
      if (input && document.activeElement !== input) input.value = n;
      const desc = document.getElementById('usdRateDesc');
      if (desc) desc.textContent = n;
      if (!opts.silent) {
        if (typeof renderTable === 'function') renderTable();
        if (typeof renderSummary === 'function') renderSummary();
        if (typeof renderRetirementIfVisible === 'function') renderRetirementIfVisible();
      }
      return true;
    }

    function onUsdRateInputChange(input) {
      if (!applyUsdRate(input.value)) {
        alert('請輸入大於 0 的數字');
        input.value = usdDefaultRate;
        return;
      }
      if (typeof scheduleCloudSync === 'function') scheduleCloudSync();
      if (typeof showToast === 'function') showToast('💵 美元匯率已改為 ' + usdDefaultRate, 'success');
    }

    document.addEventListener('DOMContentLoaded', () => applyUsdRate(usdDefaultRate, { silent: true }));

/* 手機底部分頁超過一屏時可以左右滑；切換分頁後把目前這顆滑到看得到的位置 */
(function () {
  const orig = switchAppView;
  switchAppView = function (view) {
    const r = orig.apply(this, arguments);
    try {
      const a = document.querySelector('.app-tabs .app-tab-btn.active');
      if (a && a.scrollIntoView) a.scrollIntoView({ inline: 'center', block: 'nearest' });
    } catch (e) { /* 略過 */ }
    return r;
  };
})();
