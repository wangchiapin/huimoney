/* huimoney 專用：瀏覽器儲存名稱統一加上「HUI_」前綴

   為什麼要這樣做：
   huimoney 跟 All-MoneyBook 放在同一個網域（wangchiapin.github.io），瀏覽器把它們放在同一個櫃子裡。
   以前兩邊的資料用一樣的名字（例如 finance_data_v6），同一個瀏覽器開兩個網站時會讀到對方的資料，
   甚至登入雲端時把對方的資料上傳。現在 huimoney 存取任何名稱都會自動變成「HUI_名稱」，
   All-MoneyBook 的名稱完全不會被碰到。

   怎麼做到的：
   這支檔案要放在網頁最前面載入。它把 localStorage 的 getItem／setItem／removeItem 包起來，
   名稱自動加上前綴，所以其他程式檔案一行都不用改。
   不加前綴的：已經是 HUI_ 開頭的（記帳、貓咪等），以及 Firebase 登入自己用的（firebase 開頭、__ 開頭）。

   一次性搬家：
   第一次開啟新版時，把舊名稱的資料「複製」一份到新名稱（舊的不刪，新名稱已經有資料的不蓋）。
   只搬 huimoney 自己用到的名稱（下面 MIGRATE_KEYS），不碰同網域其他網站的資料。
   而且只有確認這個瀏覽器「用過 huimoney」才搬（有 huimoney 才會寫的名稱，見 HUI_ONLY_MARKERS）；
   只開過 All-MoneyBook 的瀏覽器不會搬，避免把 All-MoneyBook 的資料帶進來。
   搬過一次就記下 HUI_PREFIX_MIGRATED_V1，之後不再搬。

   新增儲存名稱時不用改這支：新名稱會自動加前綴。MIGRATE_KEYS 只管「舊資料搬家」，之後加的新名稱沒有舊資料要搬。 */
(function () {
  'use strict';
  if (window.__huiStoragePrefixInstalled) return;
  window.__huiStoragePrefixInstalled = true;

  var PREFIX = 'HUI_';
  var DONE_FLAG = 'HUI_PREFIX_MIGRATED_V1';

  // huimoney 用到、需要把舊資料搬到新名稱的名稱（2026-10-19 從程式裡的 localStorage 用法整理）
  var MIGRATE_KEYS = [
    'APP_NAV_STATE_V1', 'ASSET_SNAPSHOTS_V1', 'CLOUD_SYNC_META_V1', 'INSURANCE_POLICIES_V1',
    'OVERVIEW_MONTHLY_V1', 'RETIREMENT_SETTINGS_V1', 'SAVING_CALC_V1',
    'STMT_IMPORTED_V1', 'STMT_IMPORT_LAST_BACKUP_V1', 'STMT_IMPORT_PASSWORDS_V1', 'STMT_IMPORT_SETTINGS_V1',
    'STOCK_INVESTMENT_DIVIDEND_ESTIMATES_V1', 'STOCK_INVESTMENT_EXRIGHTS_INFO_V1',
    'STOCK_INVESTMENT_EXCEL_PRO_V32_ACCOUNTS', 'STOCK_INVESTMENT_EXCEL_PRO_V32_DCA',
    'STOCK_INVESTMENT_EXCEL_PRO_V32_LENDING_INCOME', 'STOCK_INVESTMENT_EXCEL_PRO_V32_LENDING_INCOME_YEARLY',
    'STOCK_INVESTMENT_EXCEL_PRO_V32_PAST', 'STOCK_INVESTMENT_EXCEL_PRO_V32_SALES_HISTORY',
    'STOCK_INVESTMENT_EXCEL_PRO_V32_STOCKS', 'STOCK_INVESTMENT_EXCEL_PRO_V32_STOCK_BUYS',
    'STOCK_INVESTMENT_EXCEL_PRO_V32_STOCK_LENDING', 'STOCK_INVESTMENT_EXCEL_PRO_V32_STOCK_SALES',
    'USD_DEFAULT_RATE_V1', 'USD_FX_APPLIED_DATE_V1', 'USD_FX_V1',
    'YONG_FENG_ACCOUNT_V1', 'YONG_FENG_DETAIL_V1', 'YONG_FENG_DIVIDEND_V1', 'YONG_FENG_OVERVIEW_V2',
    'finance_data_v6'
  ];

  // 只有 huimoney 才會寫的名稱（All-MoneyBook 沒有）。出現其中任何一個，代表這個瀏覽器用過 huimoney
  var HUI_ONLY_MARKERS = [
    'HUI_LEDGER_V1', 'HUI_LEDGER_META_V1', 'HUI_CAT_PET_V1',
    'RETIREMENT_SETTINGS_V1', 'USD_FX_APPLIED_DATE_V1', 'USD_FX_V1'
  ];

  var ls;
  try { ls = window.localStorage; } catch (e) { return; }   // 瀏覽器不讓存取（例如某些隱私模式）就什麼都不做
  if (!ls || typeof Storage === 'undefined') return;

  var proto = Storage.prototype;
  var origGet = proto.getItem, origSet = proto.setItem, origRemove = proto.removeItem;

  function mapKey(k) {
    k = String(k);
    if (k.indexOf(PREFIX) === 0) return k;                  // 已經有前綴
    if (/^firebase/i.test(k) || k.indexOf('__') === 0) return k;   // Firebase 登入自己用的
    return PREFIX + k;
  }

  proto.getItem = function (k) { return origGet.call(this, this === ls ? mapKey(k) : k); };
  proto.setItem = function (k, v) { return origSet.call(this, this === ls ? mapKey(k) : k, v); };
  proto.removeItem = function (k) { return origRemove.call(this, this === ls ? mapKey(k) : k); };

  // ---- 一次性搬家 ----
  try {
    if (origGet.call(ls, DONE_FLAG) !== '1') {
      var usedHuimoney = HUI_ONLY_MARKERS.some(function (k) { return origGet.call(ls, k) !== null; });
      if (usedHuimoney) {
        MIGRATE_KEYS.forEach(function (k) {
          var nk = mapKey(k);
          if (nk === k) return;
          var oldVal = origGet.call(ls, k);
          if (oldVal !== null && origGet.call(ls, nk) === null) origSet.call(ls, nk, oldVal);
        });
      }
      origSet.call(ls, DONE_FLAG, '1');
    }
  } catch (e) { /* 搬家失敗不影響網頁運作；舊資料沒有刪，雲端與 JSON 備份也還在 */ }
})();
