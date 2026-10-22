"""Download price history from Yahoo Finance's public chart API.

Usage: python3 -I fetch_prices.py <presets.json> <raw_dir>

For every company plus a few market series it saves two raw JSON files:
  <SYM>_d.json  10 years of daily bars (split-adjusted close + dividend-adjusted close)
  <SYM>_m.json  full monthly history (for long backtests)
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse

UA = "Mozilla/5.0"
EXTRA = ["^GSPC", "SPY", "QQQ", "^VIX", "^TNX", "CL=F", "GC=F", "DX-Y.NYB", "BTC-USD"]


def ysym(t):
    return t.replace(".", "-")


def get(url):
    # curl rather than urllib: Yahoo stalls Python's default TLS client
    res = subprocess.run(["curl", "-s", "-m", "40", "-A", UA, url], capture_output=True, timeout=60)
    if res.returncode != 0:
        raise RuntimeError("curl exit %d" % res.returncode)
    return res.stdout


def main(presets_path, raw_dir):
    presets = json.load(open(presets_path))["PRESETS"]
    syms = [ysym(c["ticker"]) for c in presets] + EXTRA + ["EURUSD=X", "TWD=X"]
    os.makedirs(raw_dir, exist_ok=True)
    # an explicit date range keeps Yahoo from switching long histories to quarterly bars
    monthly = "period1=1101859200&period2=%d&interval=1mo" % int(time.time())
    for s in syms:
        q = urllib.parse.quote(s)
        for kind, params in (("d", "range=10y&interval=1d"), ("m", monthly)):
            out = os.path.join(raw_dir, f"{s}_{kind}.json")
            if os.path.exists(out) and os.path.getsize(out) > 500:
                continue
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{q}?{params}&events=div%2Csplit&includeAdjustedClose=true"
            for attempt in range(3):
                try:
                    body = get(url)
                    json.loads(body)
                    open(out, "wb").write(body)
                    break
                except Exception as e:  # retry slow or throttled requests
                    print("retry", s, kind, e)
                    time.sleep(2 + attempt * 3)
            time.sleep(0.35)
        print("ok", s)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
