/* ====== 共用日期工具（民國年 / 西元日期字串解析、依日期排序） ======
   各分頁（賣出、借出、股利、小提醒）共用，靠 classic <script> 的全域作用域運作。 ====== */

// 把各種日期寫法（例如 1151013、115/10/13、2026-10-13）轉成可比較大小的西元 yyyymmdd 整數；
// 解析不出來就回傳 99999999（排在最後）。
function parseRocDateInt(val) {
  if (!val) return 99999999;
  let str = String(val).trim();
  let match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return parseInt(match[1] + match[2] + match[3], 10);
  let numStr = str.replace(/[^0-9]/g, '');
  if (numStr.length >= 8 && numStr.startsWith('20')) {
    return parseInt(numStr.substring(0, 8), 10);
  } else if (numStr.length === 7 || numStr.length === 6) {
    let cutIndex = numStr.length - 4;
    let rocYear = parseInt(numStr.substring(0, cutIndex), 10);
    let westernYear = rocYear + 1911;
    return parseInt(westernYear + numStr.substring(cutIndex), 10);
  }
  return 99999999;
}

// 依日期欄位由舊到新排序（就地修改陣列）；沒有日期或解析不出來的列排在最後，維持原本相對順序。
function autoSortByDate(arr, dateField) {
  const withDate = [];
  const withoutDate = [];
  arr.forEach(r => {
    const v = r[dateField];
    if (v && String(v).trim() !== '' && parseRocDateInt(v) !== 99999999) {
      withDate.push(r);
    } else {
      withoutDate.push(r);
    }
  });
  withDate.sort((a, b) => parseRocDateInt(a[dateField]) - parseRocDateInt(b[dateField]));
  const newArr = withDate.concat(withoutDate);
  arr.length = 0;
  newArr.forEach(r => arr.push(r));
}
