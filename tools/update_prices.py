#!/usr/bin/env python3
"""每天由 GitHub Action 執行：抓台股收盤價、美股收盤價、美元匯率，存到 data/prices.json。
任何一個來源失敗都不會中斷，會保留上一次成功抓到的舊資料。只用 Python 內建模組。"""
import csv, io, json, os, sys, urllib.request
from datetime import datetime, timezone, timedelta

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'prices.json')
US_LIST = os.path.join(os.path.dirname(__file__), '..', 'data', 'us-symbols.txt')
UA = {'User-Agent': 'Mozilla/5.0 (huimoney price updater)'}

def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8-sig')

def num(v):
    try:
        f = float(str(v).replace(',', '').strip())
        return f if f > 0 else None
    except Exception:
        return None

def roc_to_iso(s):
    s = str(s).strip()
    try:
        if len(s) == 7:
            return '%04d-%s-%s' % (int(s[:3]) + 1911, s[3:5], s[5:7])
        if len(s) == 8:
            return '%s-%s-%s' % (s[:4], s[4:6], s[6:8])
    except Exception:
        pass
    return None

def load_old():
    try:
        with open(OUT, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def fetch_twse():
    rows = json.loads(get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'))
    prices, date = {}, None
    for r in rows:
        p = num(r.get('ClosingPrice'))
        if p and r.get('Code'):
            prices[str(r['Code']).strip()] = p
            date = date or roc_to_iso(r.get('Date', ''))
    if len(prices) < 500:
        raise ValueError('上市資料筆數異常：%d' % len(prices))
    return prices, date

def pick(r, names):
    for n in names:
        if n in r and r[n] not in (None, ''):
            return r[n]
    return None

def fetch_tpex():
    rows = json.loads(get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'))
    prices = {}
    for r in rows:
        code = pick(r, ['SecuritiesCompanyCode', 'Code', '代號'])
        p = num(pick(r, ['Close', 'ClosingPrice', '收盤']))
        if code and p:
            prices[str(code).strip()] = p
    if len(prices) < 300:
        raise ValueError('上櫃資料筆數異常：%d' % len(prices))
    return prices

def fetch_fx():
    j = json.loads(get('https://open.er-api.com/v6/latest/USD'))
    v = num(j['rates']['TWD'])
    if not v or not (15 < v < 60):
        raise ValueError('匯率數字異常：%r' % v)
    return round(v, 4)

def fetch_us(symbols):
    out = {}
    for sym in symbols:
        try:
            text = get('https://stooq.com/q/l/?s=%s.us&f=sd2c&h&e=csv' % sym.lower(), timeout=15)
            row = next(csv.DictReader(io.StringIO(text)))
            p = num(row.get('Close'))
            if p:
                out[sym.upper()] = p
        except Exception as e:
            print('  美股略過 %s：%s' % (sym, e))
    return out

def main():
    old = load_old()
    now = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')
    res = {'updatedAt': now, 'tw': old.get('tw', {}), 'us': old.get('us', {}),
           'usdTwd': old.get('usdTwd'), 'twDate': old.get('twDate'), 'errors': []}
    try:
        tw, d = fetch_twse(); res['tw'] = tw; res['twDate'] = d
        print('上市 %d 檔，日期 %s' % (len(tw), d))
    except Exception as e:
        res['errors'].append('上市：%s' % e); print('上市失敗：', e)
    try:
        otc = fetch_tpex(); res['tw'].update(otc); print('上櫃 %d 檔' % len(otc))
    except Exception as e:
        res['errors'].append('上櫃：%s' % e); print('上櫃失敗：', e)
    try:
        res['usdTwd'] = fetch_fx(); print('USD/TWD', res['usdTwd'])
    except Exception as e:
        res['errors'].append('匯率：%s' % e); print('匯率失敗：', e)
    try:
        syms = [l.strip() for l in open(US_LIST, encoding='utf-8') if l.strip() and not l.startswith('#')]
        us = fetch_us(syms)
        if us: res['us'].update(us)
        print('美股 %d/%d 檔' % (len(us), len(syms)))
    except FileNotFoundError:
        pass
    except Exception as e:
        res['errors'].append('美股：%s' % e)
    if len(res['errors']) >= 3 and not res['tw']:
        print('全部失敗，不寫檔'); sys.exit(1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

if __name__ == '__main__':
    main()
