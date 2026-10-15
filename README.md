# huimoney 個人財務資產管理（測試版）

純前端網頁：財務總覽、股票管理（持股、股息、賣出、借券、定期定額）、保險總覽、退休試算。

## 資料存在哪裡
所有資料只存在**你自己的瀏覽器**（localStorage），沒有帳號、沒有雲端。
清除瀏覽器資料或換電腦，資料就不見了——請定期用「匯出」功能下載 JSON／Excel 備份，換裝置時再「匯入」。

## 退休試算
- 股票現值、每月定期定額可自動從「股票管理」帶入，也可手動輸入。
- 現金殖利率可選「過去一年實際領到」、「年度預估股利」或手動調整。
- 年齡、報酬率、退休專戶（可自行新增）都能自己改；一開始顯示的是範例數字。
- ⚠️ 這只是依你填的假設做簡單複利的概略推算，沒有考慮通膨、稅負、手續費，**不是投資建議**。

## 部署（GitHub Pages）
Settings → Pages → Source 選 `main` 分支、根目錄 `/`，儲存後即可用網址開啟。

## 本機測試
在資料夾內執行 `python3 -m http.server 8000`，開 http://localhost:8000。
（圖表與 Excel 功能需要連網載入 Chart.js、ExcelJS。）

## 自動更新股價與匯率
- `.github/workflows/update-prices.yml` 會在台灣時間週一到週五 15:30 自動執行，抓台股（上市＋上櫃）收盤價、美股收盤價、美元兌台幣匯率，存成 `data/prices.json`。
- 也可以到 GitHub 的 Actions 頁面手動按「Run workflow」立刻跑一次（第一次部署後請先跑一次）。
- 網頁「股票管理」的「💹 更新股價與匯率」按鈕會讀這個檔，用**股票代號**對照更新現價；找不到代號的不會動。開啟網頁時也會自動套用最新匯率（抓不到時用 29）。
- 美股要追蹤哪些代號，請編輯 `data/us-symbols.txt`。
- 首次使用請到 Settings → Actions → General，把 Workflow permissions 設為「Read and write permissions」。
