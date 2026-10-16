/* 股票管理：整理全部資料、JSON 合併匯入、股票資料匯出/匯入
   從 stock.js 拆出來的檔案，功能沒有改變。
   跟其他 script 一樣靠瀏覽器共用的全域變數運作（stocks、saveToStorage、renderTable 等都在 stock.js），
   index.html 要放在 stock.js 後面載入。 */

    /* ====== 整理／套用全部股票資料（匯出、匯入備份用） ====== */
    function gatherAllData() {
      return {
        stocks, pastColumns, customAccounts, stockSales, stockBuys, stmtSettings, stmtImported, salesHistory, stockLending,
        lendingIncomeRows, lendingIncomeManualYearly, dcaRows,
        dividendEstimates, exRightsInfo,
        snapshots: JSON.parse(localStorage.getItem('ASSET_SNAPSHOTS_V1') || '[]'),
        usdRate: (typeof getUsdRate === 'function') ? getUsdRate() : 29,
        updatedAt: new Date().toISOString()
      };
    }

    function applyAllData(data) {
      if (!data) return;
      if (data.stocks) stocks = data.stocks;
      if (data.pastColumns) pastColumns = data.pastColumns;
      if (data.customAccounts) customAccounts = data.customAccounts;
      if (data.stockSales) stockSales = data.stockSales;
      if (data.stockBuys) stockBuys = data.stockBuys;
      if (data.stmtSettings) stmtSettings = data.stmtSettings;
      if (data.stmtImported) stmtImported = data.stmtImported;
      if (data.salesHistory) salesHistory = data.salesHistory;
      if (data.stockLending) stockLending = data.stockLending;
      if (data.lendingIncomeRows) lendingIncomeRows = data.lendingIncomeRows;
      if (data.lendingIncomeManualYearly) lendingIncomeManualYearly = data.lendingIncomeManualYearly;
      if (data.dcaRows) dcaRows = data.dcaRows;
      if (data.dividendEstimates) dividendEstimates = data.dividendEstimates;
      if (data.exRightsInfo) exRightsInfo = data.exRightsInfo;
      if (data.snapshots) localStorage.setItem('ASSET_SNAPSHOTS_V1', JSON.stringify(data.snapshots));
      if (data.usdRate && typeof applyUsdRate === 'function') applyUsdRate(data.usdRate, { silent: true });

      localStorage.setItem(STORAGE_KEY_STOCKS, JSON.stringify(stocks));
      localStorage.setItem(STORAGE_KEY_PAST, JSON.stringify(pastColumns));
      localStorage.setItem(STORAGE_KEY_CUSTOM_ACCOUNTS, JSON.stringify(customAccounts));
      localStorage.setItem(STORAGE_KEY_STOCK_SALES, JSON.stringify(stockSales));
      localStorage.setItem(STORAGE_KEY_STOCK_BUYS, JSON.stringify(stockBuys));
      localStorage.setItem(STORAGE_KEY_STMT_SETTINGS, JSON.stringify(stmtSettings || {}));
      localStorage.setItem(STORAGE_KEY_STMT_IMPORTED, JSON.stringify(stmtImported || []));
      localStorage.setItem(STORAGE_KEY_SALES_HISTORY, JSON.stringify(salesHistory));
      localStorage.setItem(STORAGE_KEY_STOCK_LENDING, JSON.stringify(stockLending));
      localStorage.setItem(STORAGE_KEY_LENDING_INCOME, JSON.stringify(lendingIncomeRows));
      localStorage.setItem(STORAGE_KEY_LENDING_INCOME_YEARLY, JSON.stringify(lendingIncomeManualYearly));
      localStorage.setItem(STORAGE_KEY_DCA, JSON.stringify(dcaRows));
      localStorage.setItem('STOCK_INVESTMENT_DIVIDEND_ESTIMATES_V1', JSON.stringify(dividendEstimates));
      localStorage.setItem('STOCK_INVESTMENT_EXRIGHTS_INFO_V1', JSON.stringify(exRightsInfo));

      renderTabs();
      renderTable();
    }

    /* ====== JSON 備份「合併」匯入：保留現有資料，只把匯入檔裡「本地沒有的」項目加進來，
       不會覆蓋或刪除任何既有資料。與 applyAllData()（整份覆蓋，僅供「讀取雲端」時使用）分開。 ====== */
    function mergeApplyAllData(data) {
      if (!data) return { added: 0, skipped: 0 };
      let added = 0, skipped = 0;

      // 1) 有明確唯一鍵的資料：已存在的鍵一律略過（保留舊資料），只新增本地沒有的
      function upsertByKey(existingArr, importedArr, keyFn) {
        if (!Array.isArray(importedArr)) return;
        const existingKeys = new Set(existingArr.map(keyFn));
        importedArr.forEach(item => {
          const k = keyFn(item);
          if (k && existingKeys.has(k)) { skipped++; return; }
          existingArr.push(item);
          if (k) existingKeys.add(k);
          added++;
        });
      }

      upsertByKey(stocks, data.stocks, s => (s.code ? String(s.code).trim() : '') + '|' + (s.name || '').trim() + '|' + (s.account || ''));
      upsertByKey(salesHistory, data.salesHistory, h => String(h.year || ''));
      upsertByKey(stockLending, data.stockLending, l => (l.name || '').trim());
      upsertByKey(dcaRows, data.dcaRows, r => (r.name || '').trim());
      // 股票買進：每筆有自己的 id；持股那邊已經含這些買進的股數，所以只補紀錄、不再加到持股
      upsertByKey(stockBuys, data.stockBuys, r => String(r.id || ''));
      upsertByKey(pastColumns, data.pastColumns, c => String(c.year || ''));
      if (Array.isArray(data.customAccounts)) {
        data.customAccounts.forEach(acc => {
          if (!customAccounts.includes(acc)) { customAccounts.push(acc); added++; }
          else skipped++;
        });
      }

      // 2) 沒有天然唯一鍵的交易明細記錄：直接附加在後面（保留舊資料，不覆蓋，可能重複匯入需自行檢查）
      ['stockSales', 'lendingIncomeRows'].forEach(key => {
        if (Array.isArray(data[key]) && data[key].length) {
          const target = { stockSales, lendingIncomeRows }[key];
          target.push(...data[key]);
          added += data[key].length;
        }
      });

      // 3) 物件型資料 (以鍵值儲存)：只補本地沒有的鍵，不覆蓋既有的
      if (data.lendingIncomeManualYearly) {
        Object.keys(data.lendingIncomeManualYearly).forEach(y => {
          if (lendingIncomeManualYearly[y] === undefined) { lendingIncomeManualYearly[y] = data.lendingIncomeManualYearly[y]; added++; }
          else skipped++;
        });
      }
      if (data.dividendEstimates) {
        Object.keys(data.dividendEstimates).forEach(k => {
          if (dividendEstimates[k] === undefined) { dividendEstimates[k] = data.dividendEstimates[k]; added++; }
          else skipped++;
        });
      }
      if (data.exRightsInfo) {
        Object.keys(data.exRightsInfo).forEach(k => {
          if (exRightsInfo[k] === undefined) { exRightsInfo[k] = data.exRightsInfo[k]; added++; }
          else skipped++;
        });
      }

      // 4) 各股紀錄快照：以「快照日期」為鍵，本地沒有的日期才加入
      if (Array.isArray(data.snapshots) && data.snapshots.length) {
        let existingSnaps = [];
        try { existingSnaps = JSON.parse(localStorage.getItem('ASSET_SNAPSHOTS_V1') || '[]'); } catch (e) { existingSnaps = []; }
        const existingDates = new Set(existingSnaps.map(s => s.date));
        data.snapshots.forEach(s => {
          if (s && s.date && !existingDates.has(s.date)) { existingSnaps.push(s); existingDates.add(s.date); added++; }
          else skipped++;
        });
        localStorage.setItem('ASSET_SNAPSHOTS_V1', JSON.stringify(existingSnaps));
      }

      saveToStorage();
      renderTabs();
      renderTable();
      return { added, skipped };
    }

    function exportStockData() {
      const exportObj = {
        stocks: stocks,
        pastColumns: pastColumns,
        customAccounts: customAccounts,
        stockSales: stockSales,
        stockBuys: stockBuys,
        salesHistory: salesHistory,
        stockLending: stockLending,
        lendingIncomeRows: lendingIncomeRows,
        lendingIncomeManualYearly: lendingIncomeManualYearly,
        dcaRows: dcaRows,
        snapshots: JSON.parse(localStorage.getItem('ASSET_SNAPSHOTS_V1') || '[]'),
        version: "V56",
        exportDate: new Date().toISOString()
      };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
      const dl = document.createElement('a');
      dl.setAttribute("href", dataStr);
      dl.setAttribute("download", `股票資產備份_${new Date().toISOString().slice(0,10)}.json`);
      dl.click();
    }

    function importStockData(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const imported = JSON.parse(e.target.result);
          recordSnapshot();
          let result;
          if (Array.isArray(imported)) {
            result = mergeApplyAllData({ stocks: imported });
          } else if (imported && imported.stocks) {
            result = mergeApplyAllData(imported);
          } else {
            alert('匯入失敗：檔案格式不正確');
            return;
          }
          alert(`匯入完成！\n新增：${result.added} 筆\n略過（本地已有，未覆蓋）：${result.skipped} 筆`);
        } catch (err) {
          alert('匯入失敗：檔案格式不正確');
        }
      };
      reader.readAsText(file);
    }
