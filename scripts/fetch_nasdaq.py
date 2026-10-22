"""Download insider trades, fund ownership, earnings dates and EPS forecasts
from Nasdaq's public quote-page API.

Usage: python3 -I fetch_nasdaq.py <presets.json> <raw_dir>
"""
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
HEAD = ["-H", "Accept: application/json, text/plain, */*",
        "-H", "Origin: https://www.nasdaq.com", "-H", "Referer: https://www.nasdaq.com/"]


def curl(url):
    # curl rather than urllib: Python's TLS client times out on this network
    res = subprocess.run(["curl", "-s", "-m", "30", "-A", UA, *HEAD, url], capture_output=True, timeout=45)
    if res.returncode != 0:
        raise RuntimeError("curl exit %d" % res.returncode)
    return res.stdout

ENDPOINTS = {
    "insider": "company/{t}/insider-trades?limit=25&type=ALL&sortColumn=lastDate&sortOrder=DESC",
    "inst": "company/{t}/institutional-holdings?limit=10&type=TOTAL&sortColumn=marketValue&sortOrder=DESC",
    "edate": "analyst/{t}/earnings-date",
    "forecast": "analyst/{t}/earnings-forecast",
    "summary": "quote/{t}/summary?assetclass=stocks",
}


def fetch_company(t, raw_dir):
    nt = t.replace(".", "%25sl%25")  # Nasdaq writes BRK.B as BRK%sl%B
    for key, ep in ENDPOINTS.items():
        out = os.path.join(raw_dir, f"{t}_{key}.json")
        if os.path.exists(out) and os.path.getsize(out) > 200:
            continue
        url = "https://api.nasdaq.com/api/" + ep.format(t=nt)
        for attempt in range(3):
            try:
                body = curl(url)
                json.loads(body)
                open(out, "wb").write(body)
                break
            except Exception as e:
                print("retry", t, key, e, flush=True)
                time.sleep(3 + attempt * 3)
        time.sleep(0.3)
    return t


def main(presets_path, raw_dir):
    presets = json.load(open(presets_path))["PRESETS"]
    os.makedirs(raw_dir, exist_ok=True)
    # Nasdaq answers slowly, so fetch four companies at a time (each one's five requests in order)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for t in pool.map(lambda c: fetch_company(c["ticker"], raw_dir), presets):
            print("ok", t, flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
