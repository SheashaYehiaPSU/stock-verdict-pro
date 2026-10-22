"""Download the last 12 months of open-market insider purchases and sales
(SEC Form 4, codes P and S) from OpenInsider's public screener.

Usage: python3 -I fetch_openinsider.py <presets.json> <raw_dir>
Saves one HTML page per ticker; process.py parses the trade table.
"""
import json
import os
import subprocess
import sys
import time

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
URL = ("http://openinsider.com/screener?s={t}&o=&pl=&ph=&ll=&lh=&fd=365&fdr=&td=0&tdr=&fdlyl=&fdlyh=&daysago="
       "&xp=1&xs=1&vl=&vh=&ocl=&och=&sic1=-1&sicl=100&sich=9999&grp=0&nfl=&nfh=&nil=&nih=&nol=&noh=&v2l=&v2h="
       "&oc2l=&oc2h=&sortcol=0&cnt=500&page=1")


def main(presets_path, raw_dir):
    presets = json.load(open(presets_path))["PRESETS"]
    os.makedirs(raw_dir, exist_ok=True)
    for c in presets:
        t = c["ticker"]
        out = os.path.join(raw_dir, t + ".html")
        if os.path.exists(out) and os.path.getsize(out) > 5000:
            continue
        for attempt in range(3):
            res = subprocess.run(["curl", "-s", "-m", "40", "-A", UA, URL.format(t=t)], capture_output=True, timeout=60)
            if res.returncode == 0 and b"tinytable" in res.stdout:
                open(out, "wb").write(res.stdout)
                break
            time.sleep(3 + attempt * 3)
        print("ok" if os.path.exists(out) else "FAIL", t, flush=True)
        time.sleep(0.8)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
