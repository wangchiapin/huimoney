# huimoney → Google 試算表 每日同步腳本（Apps Script）

- 檔案：`huimoney-sync.gs`（貼進 Google Apps Script 專案，函式 `syncAll`，`setupDailyTrigger` 設每天 5 點自動跑）
- 讀的資料（Firebase 專案 `huy-money`）：`financeAssets`、`stockAssets`、`insuranceAssets`、`overviewMonthly`、`ledger`（記帳：支出／收入／月備註／共同基金往來／分類）
- 寫入分頁：每月總覽、持股、股票買進、股票賣出、財務總覽、保險、記帳支出、記帳收入、共同基金、記帳月備註、記帳分類、更新紀錄
- 指令碼屬性：`FIREBASE_SERVICE_ACCOUNT`、`FIREBASE_UID`；選用 `BACKUP_FOLDER_NAME`（每天另存 JSON 備份）
- 退休試算只存在瀏覽器本機，沒上雲端，腳本讀不到

## ⚠️ 改了下面這些，就要同步改這支腳本（並提醒 Ben 重新貼到 Apps Script）
- 上述五份文件的欄位名稱、結構（例如記帳的 `expenses／incomes／monthlyNotes／fundTxns／categories／incomeCategories／payMethods`）
- 集合名稱或文件路徑（例如記帳若改成「每月一份」）
- 新增了應該備份的資料（新的集合或欄位）

## weekly-report.gs（每週資產週報）
每週日晚上 8 點（台北時間）寄「全部資產一覽」週報。獨立一個檔案，貼成 Apps Script 的新檔案 `WeeklyReport` 即可，不動原本的同步程式。
- 上方數字取自 Firestore `overviewMonthly`（打開「全部資產一覽」分頁時自動記錄），信上會註明更新時間，超過一週沒更新會警告；「股票配置（依證券帳戶）」與「每年被動收入」另外讀 `stockAssets`（持股、歷史股利、借券、媽的永豐）。
- 圖表用 Apps Script 內建 Charts 服務畫成圖片嵌入信件；任何一張畫失敗只會少那一張。
- 先執行 `previewWeeklyReport` 試寄，再執行 `installWeeklyReportTrigger` 設定排程；`removeWeeklyReportTrigger` 取消。
- 收件人一定要先到「專案設定 → 指令碼屬性」新增 `REPORT_EMAIL`（值填收件信箱），沒設會停下來提醒；信箱不寫在程式碼裡（倉庫是公開的）。重新貼新版程式不會清掉屬性。
- 若改動 `overviewMonthly` 或 `stockAssets`（stocks、pastColumns、lendingIncomeRows…）的欄位，記得同步修改這支。
