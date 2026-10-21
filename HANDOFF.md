# huimoney 交接說明（2026-10-19 校正：雲端已接上、備份與記帳說明對齊現況）

## 專案基本資料
- 倉庫：wangchiapin/huimoney，主分支 main。
- 性質：給其他使用者試用的記帳與資產管理網頁。
- 資料先存在使用者瀏覽器（localStorage）；**登入後會同步到雲端（Firebase 專案 `huy-money`，Email／密碼登入）**。也可用 JSON 或 Excel 備份。GitHub Pages 上線。
- 舊的 All-MoneyBook 倉庫不要動，除非擁有者開口。

## 2026-10-16 換底：跟上 All-MoneyBook 最新版（af6976b）
以 All-MoneyBook 當時最新版為底，做了這些差異：
1. **雲端同步（Firebase）已接上（現況，2026-10-19 校正）**：這一點在 2026-10-16 最初是「保留但不接上」，之後已改成接上，舊的說法（firebaseConfig 空白、三行程式庫被註解掉、登入只跳「還沒開放」提示）已經不對。現況：
   - `scripts/shared.js` 的 `firebaseConfig` 已填入 `huy-money` 專案；`index.html` 的三行 Firebase 程式庫是啟用的。
   - 標題列「🔑 登入雲端同步」會跳出 Email／密碼輸入；找不到帳號時會先問要不要建立新帳號。登入後財務、股票、保險、資產總覽每月紀錄、記帳（含共同基金）、📬 自動收到的對帳單都會同步。
   - 標題列狀態字：登入前是「☁️ 確認登入狀態中…」→「☁️ 未登入（資料只存在這個瀏覽器）」；登入後「☁️ 已連線：email」→「☁️ 已同步」。只有 Firebase 程式庫沒載入成功（網路問題）時，才會顯示「☁️ 雲端沒有連上」，退回只存本機。
   - 標題列狀態由 `scripts/cloud-guard.js` 合併財務總覽／股票／保險／記帳四塊回報：全部成功才是「已同步」；有失敗或暫停會直接寫出哪一塊；本機有未上傳修改時顯示「有變更還沒上傳」。
   - 雲端覆蓋保護：`CLOUD_SYNC_META_V1`（每塊的 dirty／lastKnown）。本機有未上傳修改且雲端被別台改過時會詢問，選用雲端前自動下載備份。記帳沿用自己的 `HUI_LEDGER_META_V1` 機制。
   - JSON 備份（combined_v1）新增 `ledgerData`、`retirementData`、`overviewMonthly`；清空重置會清這些並可選擇連雲端（含 `ledger`）一起清。復原對帳單匯入的記帳部分改為只還原該次匯入的變動（`lgUndoImportChanges`）。
2. **密碼鎖定、子分頁隱藏**：設定選單和設定視窗拿掉；程式裡上百處檢查改用 shared.js 的「永遠不鎖」替身（isPageLocked、isFieldLocked、isTabHidden、lockPlaceholderHtml），這樣其他檔案跟 All-MoneyBook 幾乎一樣，以後同步比較容易。
3. **媽的永豐拿掉**：stock-yf.js 刪除；它裡面的共用日期工具改放 scripts/date-utils.js，名稱改成 parseRocDateInt、autoSortByDate（All-MoneyBook 叫 yfParseDateInt、yfAutoSortByDate，以後同步時要記得改名）。股票分頁、手機分區列、Excel 匯出入、JSON 備份、資產總覽、小提醒卡片的永豐部分都拿掉。
   - **刻意保留、不是漏刪（2026-10-19 檢查確認）**：`scripts/stmt-import.js` 裡還有永豐金證券寫進「媽的永豐」的程式（`stmtUseYf`、`stmtBuildYfItems`、`yfBuy`／`yfAppCost` 項目、`yfAutoSortByDate`），以及 `stock-add.js` 的 `YONG_FENG_TAB`、各 CSS 裡的 `yf-*` 樣式。這些是跟 All-MoneyBook 共用的檔案：`stmtUseYf()` 會檢查有沒有 `yfDetail`／`yfOverview`，huimoney 沒有，所以永遠回傳 false，永豐金證券的對帳單就自動當一般券商處理（寫進股票買進）。**這段程式在 huimoney 不會執行、不會報錯**，留著是為了之後跟 All-MoneyBook 同步時差異最小。
   - 唯一要注意：那段裡呼叫的 `yfAutoSortByDate` 在 huimoney 叫 `autoSortByDate`，如果哪天讓 `stmtUseYf()` 變成 true，會出現找不到函式的錯誤；沒有這個打算就不用管。4. **📬 待確認保留**（stmt-pending.js）：資料來自擁有者私人的 Gmail 自動程式＋雲端，沒登入時按鈕不會出現。雲端已接上，但那支自動程式只抓擁有者的 Gmail、只放進擁有者的帳號，給其他人用需要另外規劃。**📥 匯入對帳單保留**（最初只有國泰證券、富邦證券、台北富邦銀行、國泰世華銀行；後來解析檔陸續加了很多家，完整名單看 All-MoneyBook 的 `scripts/stmt-parsers.js` 裡的 `LABELS`，也見下面第 4、5 批）。
5. **股價與匯率**：用 All-MoneyBook 的抓價程式（.github/scripts/fetch_prices.py、workflow prices.yml，平日 16:10），另外加上美元匯率（open.er-api.com → usdTwd、fxDate）。舊的 tools/update_prices.py 和 update-prices.yml 刪掉。data/prices.json 已先換成新格式（股價取自 All-MoneyBook 10/15 的檔案、匯率取自舊 huimoney 檔案）。
6. **匯率**：用 All-MoneyBook 的標題列「💵 美元匯率」（getUsdRate／applyUsdRate，存 USD_DEFAULT_RATE_V1）。開網頁時有新一天的匯率就自動套用一次（USD_FX_APPLIED_DATE_V1 記錄），手動改的會留到下次新匯率；舊版 huimoney 的 USD_FX_V1 第一次開啟時會搬過來。
7. **保留 huimoney 自己的東西**：退休試算分頁（含手機底部分頁、重新整理後回到退休頁）、「含借出股數」預設勾選、新使用者預設只有「證券帳戶」且可刪（固定保留「美股複委託」）。
8. 手機版退休試算的設定區改成一欄（styles/retirement.css 最後一行）。

## 瀏覽器儲存名稱加前綴（2026-10-19）
- **問題**：huimoney 和 All-MoneyBook 都在 `wangchiapin.github.io` 底下，瀏覽器的 localStorage 是整個網域共用；兩邊財務總覽、股票、保險、對帳單設定等名稱一模一樣。同一個瀏覽器開兩個網站會互相讀到、甚至登入雲端時把對方資料上傳（雲端沒資料時會把本機資料第一次推上去）。
- **做法**：新檔 `scripts/storage-prefix.js`，在 index.html **所有 script 之前**載入，把 `localStorage.getItem／setItem／removeItem` 包起來，名稱自動加 `HUI_`。其他程式檔一行都沒改。已經是 `HUI_` 開頭的（記帳、貓咪）、Firebase 登入自己用的（`firebase` 開頭、`__` 開頭）不加。
- **搬家（只跑一次，記在 `HUI_PREFIX_MIGRATED_V1`）**：第一次開新版時，把舊名稱的資料**複製**到新名稱（舊的不刪、新名稱已有資料的不蓋）。
  - 只搬 huimoney 用到的 31 個名稱（清單在檔案裡的 `MIGRATE_KEYS`），同網域其他網站的資料不碰。
  - 只有確認這個瀏覽器「用過 huimoney」才搬（有 huimoney 才會寫的名稱，`HUI_ONLY_MARKERS`：記帳、退休試算、新版匯率日期…）；只開過 All-MoneyBook 的瀏覽器不搬，避免把 All-MoneyBook 的資料帶進來。
  - 已知限制：如果一個瀏覽器兩個網站都用過，舊名稱裡是兩邊混在一起的資料，搬家會把混合資料帶進來（無法分辨）。登入雲端會用雲端資料取代；舊名稱沒有刪，所以沒有資料遺失。
- **舊名稱沒有刪**：搬家後舊名稱的資料還在瀏覽器裡（沒用了，但「清空重置」不會清它們）。如果這個瀏覽器之後會開 All-MoneyBook，舊名稱就是它的名稱，會讀到這份舊資料；確認 huimoney 正常之後可以清掉。
- **之後新增儲存名稱**：不用改這支檔案，新名稱自動加前綴（`MIGRATE_KEYS` 只管舊資料搬家）。
- **跟 All-MoneyBook 同步時**：All-MoneyBook 的 scripts 直接複製進來就好，名稱不用改；只要確認 index.html 第一支 script 還是 `storage-prefix.js`。
- 測試：無頭瀏覽器實測 36 項（舊版→新版搬家、其他網站與 firebase 名稱不動、新版存檔不碰舊名稱、只開過 All-MoneyBook 的瀏覽器不搬、清空重置、備份匯出→重置→匯入、新版沒有多出錯誤）；對照組（前綴程式換成空的）會有 12 項失敗，確認測試有效。

## 退休試算設定上雲端（2026-10-19）
- 放在「股票管理」那份雲端文件（`stockAssets/{uid}`）的 `settings.retirement`，Firebase 規則不用改。存股試算、貓咪開關、「目前停在哪一頁」**不同步**（Ben 決定）。
- 規則（`scripts/stock-sync.js`）：本機改過（`touched`）才上傳，範例數字不上傳；按「還原範例」上傳 `null` 清掉雲端那份（`retirementClearPending`）；登入時雲端有就帶入本機；舊帳號（雲端沒有、本機改過）登入後補上傳一次；本機沒碰退休時整份覆蓋不會刪掉雲端那份。
- `retirement.js` 的 `saveRetirementSettings()` 會呼叫 `scheduleCloudSync()`（2 秒後上傳）。`stock-sync.js` 與 All-MoneyBook 共用，All-MoneyBook 沒有退休試算（`retirementSettings` 不存在），整段自動略過；同步檔案時注意不要把這段蓋掉。
- Apps Script：每日 JSON 備份自動包含這份；`huimoney-sync.gs` 沒有顯示它的分頁（Ben 決定不顯示），不用重貼。
- 測試：假雲端資料庫 27 項（上傳、新裝置帶入、舊帳號補上傳、衝突時不被刪、還原範例清雲端、沒登入）。

## 2026-10-19 新增 📒 記帳分頁（第 1 批，僅 huimoney 有，All-MoneyBook 沒有）
- 檔案：`scripts/ledger.js`（資料層＋雲端同步）、`scripts/ledger-ui.js`（畫面）、`styles/ledger.css`；index.html、shared.js（switchAppView）、stock.js（nav state）有小改。
- 本機儲存：`HUI_LEDGER_V1`（整包）、`HUI_LEDGER_META_V1`（lastSynced/dirty）、`HUI_LEDGER_PRE_SYNC_BACKUP_V1`（採用雲端前的本機備份）。
- 雲端：Firestore 集合 `ledger`，文件 id = uid；改動後 3 秒 debounce 上傳；兩邊都有新變更時跳確認。第 2 批共同基金也會放在同一份文件。
- Firebase 規則（huy-money 專案）：`match /{col}/{uid}` 的白名單是 `col in ['financeAssets','stockAssets','insuranceAssets','overviewMonthly','ledger']`，另有 `stmtPending/{uid}/items/{itemId}`。**線上規則已確認包含 `ledger`（2026-10-19，擁有者貼出線上規則核對）**，不用再改。之後若新增集合，記得同步加進這份白名單並重新發布。
- 預留欄位（第 1 批未使用）：支出 `payMethod`、`fund`、`source`；收入 `source`。
- 特殊分類：`卡費`、`共同基金`（可改名、不可刪）。
- **記帳不會從股票分頁自動連動**：股票分頁的已實現損益、股利、借券收入不會自己寫進記帳。**但「銀行對帳單比對」（第 4 批）會寫**：交割款記成分類「股票交割」的支出（買進）或收入（賣出入帳）、股息記成收入「股利」、借券費記成收入「借券收入」，已實現損益不進記帳。
  - ⚠️ 現況注意：記帳的月支出／月收入統計只排除「卡費」和共同基金，**沒有排除「股票交割」**，所以買一筆大額股票，當月個人支出會跟著變大。**2026-10-19 Ben 決定：不排除，維持現狀。**
- 沒搬：媽媽分類、Gemini AI、統計密碼鎖、Firebase 登入畫面、華語文教學自動同步、moneybook 任何資料。
- 後續計畫：第 2 批共同基金分頁（基金為虛擬帳戶，不出現在財務總覽／資產總覽）；第 3 批圖表、搜尋、隨手記、Excel 匯出入；再之後付款方式與對帳單比對。

## 2026-10-19 新增 🏦 共同基金分頁（第 2 批，只有 huimoney 有）
- 檔案：`scripts/fund-ui.js`（畫面）；算帳與資料在 `scripts/ledger.js`（`lgFundEntries`、`lgFundSummary`、`fundTxns`）；樣式併在 `styles/ledger.css`（`#fundView` 與 `#ledgerView` 共用）。
- 資料跟記帳同一份文件 `ledger/{uid}`，Firebase 規則不用再改。多了 `fundTxns`（老公匯入／老公支出／結算／期初餘額），記帳支出的 `fund` 欄位現在是 `{payer:'wife'|'husband', from:'fund'|'self'}` 或 null。
- 規則：分類「共同基金」的支出＝老婆匯入（基金分頁的老婆匯入與它是同一筆，改刪同步）；有 `fund` 的支出不算個人月支出（`lgMonthStats().fundExcluded`）。
- 算法：實際餘額＝匯入＋期初－基金直接付－結算領出；欠某人＝他先墊－他已結算（不小於 0，各算各的）；可用＝餘額－欠老婆－欠老公。
- 基金不出現在財務總覽／資產總覽；手機底部 7 個分頁可左右滑。
- 後續：第 3 批 圖表、搜尋、隨手記、Excel 匯出入；再之後付款方式與對帳單比對。

## 2026-10-19 記帳第 3 批：圖表、搜尋、隨手記、Excel（只有 huimoney 有）
- 新檔：`scripts/ledger-charts.js`（圖表，手寫 SVG／HTML，不靠 Chart.js；支出 #b5424d、收入 #3a74b0 通過色盲檢查）、`ledger-search.js`、`ledger-quicknote.js`、`ledger-excel.js`（用 index.html 已載入的 ExcelJS）。
- 記帳子分頁現在是 記帳／統計／圖表／搜尋；頁首有 📝 隨手記、⚙️ 設定。
- 隨手記草稿存在 `lg.quickNoteDraft`（跟雲端同步）；加入的支出 `source:'quicknote'`；格式 `0913 早餐 500 午餐300`，沒日期的行不猜。
- Excel 匯出四張表：支出、收入、共同基金、月備註（每筆有「編號」）。匯入有編號比編號、沒編號比「日期＋分類＋項目＋金額」，重複的略過；不存在的分類自動新增；看不懂的列略過並回報。
- 測試時 Chart.js／ExcelJS 都從 CDN 載入，沙盒連不到，測試改用本機 ExcelJS 套件攔截。
- 未做：基金分頁的圖表、金額欄算式（moneybook 有「=100-10」）、付款方式與對帳單比對。

## 📒 記帳 第 4 批（付款方式＋銀行對帳單比對）
- **付款方式**：`lg.payMethods`（現金／轉帳／金融卡預設，可新增信用卡）；支出有 `payMethod`；設定 → 付款方式可新增／改名／改類型，已被使用的不能刪。Excel「支出」表有「付款方式」欄。
- **銀行對帳單 → 記帳**：新檔 `scripts/stmt-ledger.js`，接進原本的「📥 匯入對帳單」（stmt-import.js 只有幾個小接點，都搜 `ledgerTx` / `stmtLg`）。
  - 每筆銀行明細（台幣）一行；配對規則：同金額、日差 ≤5 天、一對一（日期最近先配）；現金、信用卡付款方式的不配；繳卡費只配分類「卡費」。配上 → 「更新」區，只在手動紀錄加 `stmt:{sid,key}`（「✓ 已對帳」），保留原項目名稱；沒配上 → 「新增」區。
  - 股票：交割款買進＝支出「股票交割」、賣出入帳＝收入「股票交割」；現金股息／權益息→收入「股利」；借券費→收入「借券收入」。已實現損益不進記帳。
  - 兩個自己的帳戶互轉（同額、差1天內）→ 「需要你看」不預設勾。每行有識別碼 `sid|帳號|日期|金額|餘額`，不會記兩次；復原會連記帳一起還原（備份有 `lg`）。
- **第 B 步**：已做，見下面「第 5 批」。
- 測試：test-stmt.js(26)、test-pay.js(5)，加上原有四組全過。

## 第 4 批延伸：新銀行、關鍵字、OCR、退撫儲金（2026-10-19）
- **解析檔在 All-MoneyBook**（`scripts/stmt-parsers.js`，huimoney 直接載入網站上的那份）：新增 `bot_bank` 台灣銀行、`kaohsiung_bank` 高雄銀行、`pension_fund` 公教退撫儲金；修將來銀行（定存口袋、活存口袋讀成帳戶）和中信（帳號印在每筆明細前面時漏讀第一筆）。
- **OCR**：圖片型 PDF（`isImageOnly`）才會載入 tesseract.js 5.1.1＋chi_tra（`@tesseract.js-data/chi_tra/4.0.0_best_int`，約 1.6 MB 資料＋程式，jsdelivr）。每頁畫成 300dpi 圖 → 單字座標整理成跟一般 PDF 一樣的格子（`ocrWordsToPage`）。OCR 讀的對帳單一定要自我檢查全過才算通過；高雄銀行帳號 OCR 讀不準，改用順序代號（活存1、定存1…）。
- **分類關鍵字**：`BANK_KEYWORDS`（股息／權益補償／借券／交割各家寫法，集中在解析檔，缺的直接補）；huimoney 確認畫面可「記住關鍵字」（`stmtSettings.ledgerKeywords`，會同步），看不出類別的銀行明細放「需要你看」。
- **退撫儲金**：`scripts/stmt-pension.js`（huimoney、All-MoneyBook 各一份，內容相同）：帳戶價值寫進退休試算某個專戶的餘額（萬）和／或財務總覽某個項目；All-MoneyBook 沒有退休試算，只寫財務總覽。對應存在 `stmtSettings.accountMap['pension_fund|公教人員專戶']`。復原一起還原退休試算。
- 測試：test-stmt2（五份真實 PDF 含 OCR 全流程）、test-stmt3（關鍵字）、test-am（All-MoneyBook）。測試時要把 pdf.js 換成 legacy 版（沙盒 Chromium 太舊）。
- 信用卡對帳單：見「第 5 批」。

## 第 5 批：玉山、私校退撫、信用卡（2026-10-19）
- 共用解析檔 All-MoneyBook `scripts/stmt-parsers.js` 新增：
  - `esun_bank` 玉山銀行（圖片型，OCR）。帳號被遮、OCR 又不準，所以帳號用「活存1／外幣活存1」。提款／存款用欄位位置分（表頭「提款」與「存款」中間線），再用餘額一筆接一筆核對；最後餘額＝帳戶餘額、第 1 頁資產合計＝存款加總。偵測只看第 1 頁最上面幾行（別家明細也可能出現「玉山銀行」）。
  - `obank` 王道銀行（2026-10-21，解析檔在 All-MoneyBook；只有一份 2026/09 樣本驗證過）。標題和 LOGO 是圖片，靠權益通知的「王道銀行提醒您」或網址 obank.tw／o-bank.com 認，且 `detect()` 要排在最前面（明細裡會出現「華南銀行」等別家名字）。**臺幣明細沒有逐筆餘額**，餘額是用期末餘額往回推的，沒辦法自動核對有沒有漏讀（結果畫面會有提醒）。外幣定存每一筆各算一個帳戶；外幣活存的交易明細還沒讀（沒有樣本）。「連加電子」往來沒加關鍵字，歸「其他」。
  - `pension_private` 私校退撫儲金（圖片型）。偵測：有「私校」和「儲金」（**不能**用「投資組合績效概況」，公教那份也有）。三種儲金類別＋兩個投資組合，檢查：各列提存＋損益＝價值、加總＝小計、單位數×淨值≈現值（OCR 把淨值認錯一位數時會試著改一個數字，改了剛好吻合才採用，並寫在檢查文字裡）、投資組合現值加總＝帳戶價值。小數點被認成逗號（27,5195）也收。轉換（轉入／轉出）是內部轉換，不算提存。結果同樣是 `res.pension`，多了 `portfolios`、`categories`。
  - 信用卡：`kind 'card'`，`res.card`（結帳日、繳款截止日、額度、應繳總額、最低應繳）＋`res.cardTx`（消費為正、退款為負；`last4`、`currency`、`foreignAmount`）。`cathay_card` 國泰世華（用真實帳單驗證，但那份沒有消費明細，消費列的解析是用模擬資料測的）；`fubon_card` 台北富邦（**沒有真實樣本**，用通用規則讀，一律會帶警告、要逐筆核對）。富邦的偵測改成要有「富邦」或 fubon，原本「本期應繳總額＋信用卡」會把國泰世華誤認成富邦。
- huimoney：
  - `stmt-pension.js`（兩站共用同一份）不再寫死「公教退撫儲金」，名稱用 `res.label`；猜退休試算專戶時，私校先找名字含「私校」、公教先找「公教」。
  - `stmt-ledger.js`：信用卡消費進同一個比對流程（`stmtLgCardCollect`）。只配付款方式是「信用卡」的手動支出（金額一樣、日差 ≤5 天、一對一；同一張卡優先）；沒配上 → 新增支出，付款方式用「這張卡記住的設定」→ 名稱含銀行名（國泰／富邦）且只有一張 → 只有一張信用卡；猜不出來 → 「需要你看」要你選卡（選了存在 `stmtSettings.cardPay`，key 是 `來源|卡號後四碼`，會同步、管理清單可刪）。繳款、零元（年費減免）不記；退款放「需要你看」；帳單總覽（結帳日、應繳總額…）顯示成一行略過項目。識別碼 `sid|card|末四碼|日期|金額|店名|序號`。
  - 沒有記帳功能的網站（All-MoneyBook）遇到信用卡帳單只提醒、不寫入（`stmt-import.js`）。
- 測試：`test-stmt4.js`（真實 3 份 PDF＋OCR＋模擬信用卡，28 項）、`test-am.js` 多 2 項。
- 還沒做：真正有消費明細的國泰世華／富邦帳單驗證；信用卡循環利息、分期等特殊列；外幣明細表（玉山）。

## 還沒確認
- 上線後到 Actions 手動跑一次「每日更新收盤價」，確認美股與匯率有抓到。
- 上櫃股票價格欄位名稱（新抓價程式用 SecuritiesCompanyCode／Close，跟 All-MoneyBook 一樣）。
- 沙盒沒有真的對帳單 PDF，只測過「認不出的檔案」會正確顯示；要用真的對帳單在實際環境試。

## 風險與未做的建議（未獲同意，不要自己動手）
- ~~同網域（wangchiapin.github.io）的網頁共用 localStorage，huimoney 會讀到 All-MoneyBook 的資料~~：**2026-10-19 已解決**，huimoney 的儲存名稱統一加 `HUI_` 前綴，見上面「瀏覽器儲存名稱加前綴」。（2026-10-16 當時先不改，後來 huimoney 接上雲端，登入新帳號時會把本機資料第一次上傳，風險變大，所以改了。）
- 其他：備份提醒、匯入 JSON 前先詢問、第一次使用導覽、授權與隱私聲明、清掉未使用的 CSS（例如永豐、密碼鎖的樣式）。

## 以後再跟 All-MoneyBook 同步的做法
1. 複製 All-MoneyBook 最新版檔案進來（不要 stock-yf.js）。
2. 照上面 1～8 點重做；可以拿這次的版本跟 All-MoneyBook 比對，差異都集中在上面這些地方。
3. 保留 `scripts/storage-prefix.js`，且 index.html 裡它要是第一支 script（見「瀏覽器儲存名稱加前綴」）。

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

## 用語簡化（2026-10-19）
畫面用語改成：數字核對 OK／數字對不上、請你確認、不會寫入、這份要放到哪裡、我學會的設定、再讀一次（補漏）、已和銀行核對、自動收到的對帳單（原待確認）、全部資產一覽（原資產總覽）。

## 選單直接新增（2026-10-19）
對應設定的選單多了「➕ 新增成新項目」（銀行，名稱＝銀行＋種類＋末幾碼，只限 TWD／USD，同名不重複建）和「➕ 新增證券帳戶」（名稱＝券商名稱，已有就加帳號末四碼）。選了就當場建立；「復原這次匯入」不會把建好的項目拿掉（要自己封存）。

## 幣別防呆與新增日期欄（2026-10-19）
銀行對應：美元帳戶只能對美元項目、台幣帳戶只能對台幣項目、其他外幣只能「不匯入」（舊的錯誤對應會進「請你確認」，套用時也再擋一次）。日期欄選單多了「➕ 新增日期欄…」（預設對帳單月底，格式跟現有日期一致）。
