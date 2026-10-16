# huimoney 交接說明（2026-10-16 晚上更新）

## 專案基本資料
- 倉庫：wangchiapin/huimoney，主分支 main。
- 性質：給其他使用者試用的記帳與資產管理網頁。
- 資料只存在使用者瀏覽器（localStorage），用 JSON 或 Excel 備份。GitHub Pages 上線。
- 舊的 All-MoneyBook 倉庫不要動，除非擁有者開口。

## 2026-10-16 換底：跟上 All-MoneyBook 最新版（af6976b）
以 All-MoneyBook 當時最新版為底，做了這些差異：
1. **雲端同步（Firebase）真的拿掉**：shared.js 的設定與登入、finance／insurance／stock-sync／overview 的雲端程式都刪掉；標題列改成「💾 資料僅存在本機」。
2. **密碼鎖定、子分頁隱藏**：設定選單和設定視窗拿掉；程式裡上百處檢查改用 shared.js 的「永遠不鎖」替身（isPageLocked、isFieldLocked、isTabHidden、lockPlaceholderHtml），這樣其他檔案跟 All-MoneyBook 幾乎一樣，以後同步比較容易。
3. **媽的永豐拿掉**：stock-yf.js 刪除；它裡面的共用日期工具改放 scripts/date-utils.js，名稱改成 parseRocDateInt、autoSortByDate（All-MoneyBook 叫 yfParseDateInt、yfAutoSortByDate，以後同步時要記得改名）。股票分頁、手機分區列、Excel 匯出入、JSON 備份、資產總覽、小提醒卡片的永豐部分都拿掉。
4. **📬 待確認拿掉**（stmt-pending.js）：它的資料來自擁有者私人的 Gmail 自動程式＋雲端，試用者用不到。**📥 匯入對帳單保留**（國泰證券、富邦證券、台北富邦銀行、國泰世華銀行）。
5. **股價與匯率**：用 All-MoneyBook 的抓價程式（.github/scripts/fetch_prices.py、workflow prices.yml，平日 16:10），另外加上美元匯率（open.er-api.com → usdTwd、fxDate）。舊的 tools/update_prices.py 和 update-prices.yml 刪掉。data/prices.json 已先換成新格式（股價取自 All-MoneyBook 10/15 的檔案、匯率取自舊 huimoney 檔案）。
6. **匯率**：用 All-MoneyBook 的標題列「💵 美元匯率」（getUsdRate／applyUsdRate，存 USD_DEFAULT_RATE_V1）。開網頁時有新一天的匯率就自動套用一次（USD_FX_APPLIED_DATE_V1 記錄），手動改的會留到下次新匯率；舊版 huimoney 的 USD_FX_V1 第一次開啟時會搬過來。
7. **保留 huimoney 自己的東西**：退休試算分頁（含手機底部分頁、重新整理後回到退休頁）、「含借出股數」預設勾選、新使用者預設只有「證券帳戶」且可刪（固定保留「美股複委託」）。
8. 手機版退休試算的設定區改成一欄（styles/retirement.css 最後一行）。

## 還沒確認
- 上線後到 Actions 手動跑一次「每日更新收盤價」，確認美股與匯率有抓到。
- 上櫃股票價格欄位名稱（新抓價程式用 SecuritiesCompanyCode／Close，跟 All-MoneyBook 一樣）。
- 沙盒沒有真的對帳單 PDF，只測過「認不出的檔案」會正確顯示；要用真的對帳單在實際環境試。

## 風險與未做的建議（未獲同意，不要自己動手）
- 同網域（wangchiapin.github.io）的網頁共用 localStorage，huimoney 會讀到 All-MoneyBook 的資料，可能互相覆蓋。擁有者用不同瀏覽器開兩個網頁，2026-10-16 決定**先不改**儲存名稱。
- 其他：備份提醒、匯入 JSON 前先詢問、第一次使用導覽、授權與隱私聲明、清掉未使用的 CSS（例如永豐、密碼鎖的樣式）。

## 以後再跟 All-MoneyBook 同步的做法
1. 複製 All-MoneyBook 最新版檔案進來（不要 stock-yf.js、stmt-pending.js）。
2. 照上面 1～8 點重做；可以拿這次的版本跟 All-MoneyBook 比對，差異都集中在上面這些地方。

## 退休試算背景
- 情境：1993 年生、112/7 以後初任、先私校後公立，很可能適用個人專戶制。提撥比例等細節請向學校人事室確認。
- 專戶也可當定存或儲蓄險試算：填餘額、利率、年繳金額、繳費到幾歲、幾歲開始領。保單利率請用解約金表換算的實際報酬，不是預定利率；中途解約的損失不會顯示。

## 工作規則
- 用白話繁體中文，少用技術名詞。
- 寫程式前先確認做法；測試後先問，只有說「推」才推送。

## 測試備忘
- Playwright 無頭瀏覽器，擋外部連線，改用本機 Chart.js、ExcelJS、pdfjs-dist；本機伺服器 python3 -m http.server 8765。
- 不要用 pkill -f http.server（會殺掉終端機）。
- 沙盒連不到證交所、櫃買中心、Yahoo、匯率網站，只能請使用者在真實環境確認。
