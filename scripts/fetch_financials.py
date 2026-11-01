"""Download each company's XBRL "company facts" from SEC EDGAR.

Usage: python3 -I fetch_financials.py <presets.json> <raw_dir>

One JSON file per company (all its reported financial-statement values);
scripts/financials.py turns it into trailing-twelve-month figures. Set
SEC_CONTACT to an email or URL to identify these requests, as the SEC asks.
"""
import json
import os
import subprocess
import sys
import time

UA = "StockVerdictPro " + (os.environ.get("SEC_CONTACT") or "research-contact@example.com")


def curl(url, out):
    """Download url to out; return the HTTP status."""
    res = subprocess.run(["curl", "-s", "-m", "120", "-A", UA, "-o", out, "-w", "%{http_code}", url],
                         capture_output=True, timeout=150)
    return int(res.stdout or 0)


def main(presets_path, raw_dir):
    presets = json.load(open(presets_path))["PRESETS"]
    os.makedirs(raw_dir, exist_ok=True)
    tickers_path = os.path.join(raw_dir, "_company_tickers.json")
    if not os.path.exists(tickers_path) and curl("https://www.sec.gov/files/company_tickers.json", tickers_path) != 200:
        sys.exit("SEC ticker list failed")
    cik = {v["ticker"].upper(): int(v["cik_str"]) for v in json.load(open(tickers_path)).values()}
    for c in presets:
        t = c["ticker"]
        k = cik.get(t) or cik.get(t.replace(".", "-"))
        if not k:
            print("no CIK", t)
            continue
        out = os.path.join(raw_dir, f"{t}.json")
        for attempt in range(2):
            code = curl(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{k:010d}.json", out + ".tmp")
            if code == 200:
                os.replace(out + ".tmp", out)
                break
            print("http", t, code)
            time.sleep(2)
        if os.path.exists(out + ".tmp"):
            os.remove(out + ".tmp")
        time.sleep(0.15)
    print("company facts saved for", sum(1 for f in os.listdir(raw_dir) if f.endswith(".json") and not f.startswith("_")), "companies")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
