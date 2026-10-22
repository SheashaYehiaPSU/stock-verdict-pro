"""Download reported EPS from Yahoo Finance's fundamentals timeseries.

Usage: python3 -I fetch_yts.py <presets.json> <raw_dir>

A fallback for companies whose SEC data can't be read (for example Visa and
Coca-Cola): about 4 years of yearly and 5 quarters of quarterly diluted EPS.
"""
import json
import os
import subprocess
import sys
import time

TYPES = "annualDilutedEPS,quarterlyDilutedEPS"


def main(presets_path, raw_dir):
    presets = json.load(open(presets_path))["PRESETS"]
    os.makedirs(raw_dir, exist_ok=True)
    now = int(time.time())
    for c in presets:
        t = c["ticker"]
        out = os.path.join(raw_dir, t + ".json")
        if os.path.exists(out) and os.path.getsize(out) > 300:
            continue
        sym = t.replace(".", "-")
        url = (f"https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{sym}"
               f"?symbol={sym}&type={TYPES}&period1=1262304000&period2={now}")
        for attempt in range(3):
            res = subprocess.run(["curl", "-s", "-m", "30", "-A", "Mozilla/5.0", url], capture_output=True, timeout=45)
            try:
                json.loads(res.stdout)["timeseries"]
                open(out, "wb").write(res.stdout)
                break
            except Exception:
                time.sleep(2 + attempt * 3)
        time.sleep(0.3)
    print("yahoo eps files:", len([f for f in os.listdir(raw_dir) if f.endswith(".json")]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
