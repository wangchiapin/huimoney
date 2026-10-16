# huimoney 交接說明（2026-10-16）

## 專案基本資料
- 倉庫：wangchiapin/huimoney，主分支 main。
- 性質：給其他使用者試用的記帳與資產管理網頁，從 All-MoneyBook 複製而來；已拿掉加密鎖定、AI 分析、Firebase。
- 資料只存在使用者瀏覽器（localStorage），用 JSON 或 Excel 備份。GitHub Pages 上線。
- 舊的 All-MoneyBook 倉庫不要動，除非擁有者開口。

## 已完成
1. 股票、基金、記帳、資產總覽。
2. 自動更新股價與匯率：GitHub Action（台灣時間平日 15:30）→ tools/update_prices.py → data/prices.json；美股代號清單 data/us-symbols.txt；頁面按鈕「更新股價與匯率」。
3. 「含借出股數」預設勾選；預設證券帳戶可刪除。
4. 退休試算分頁（scripts/retirement.js）：逐月複利、「我想退休的年齡」、專戶卡片（直接填年額或用薪額算）、欄位旁「？」說明、通膨換算、領取期間與每月可領金額。

## 還沒確認
- 重跑 Action 後美股價格是否抓到（Yahoo 優先、Stooq 備用）。
- 上櫃股票價格欄位名稱未驗證。
- 台股與匯率第一次執行已成功。

## 風險與未做的建議（未獲同意，不要自己動手）
- 同網域（wangchiapin.github.io）的網頁共用 localStorage，huimoney 會讀到 All-MoneyBook 的資料，可能互相覆蓋；建議把儲存名稱改成獨立前綴。
- 其他：備份提醒、匯入 JSON 前先詢問、第一次使用導覽、授權與隱私聲明、清掉未使用的 CSS（含 scripts/finance.css）、手機版股票表格檢查。

## 退休試算背景
- 情境：1993 年生、112/7 以後初任、先私校後公立，很可能適用個人專戶制。提撥比例等細節請向學校人事室確認。
- 專戶也可當定存或儲蓄險試算：填餘額、利率、年繳金額、繳費到幾歲、幾歲開始領。保單利率請用解約金表換算的實際報酬，不是預定利率；中途解約的損失不會顯示。

## 工作規則
- 用白話繁體中文，少用技術名詞。
- 寫程式前先確認做法；測試後先問，只有說「推」才推送。

## 測試備忘
- Playwright 無頭瀏覽器，擋外部連線，改用本機 Chart.js；本機伺服器 python3 -m http.server 8765。
- 不要用 pkill -f http.server（會殺掉終端機）。
- 沙盒連不到證交所、櫃買中心、Yahoo，只能請使用者在真實環境確認。
