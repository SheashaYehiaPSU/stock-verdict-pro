"""Download reported earnings-per-share history from SEC EDGAR (XBRL API).

Usage: python3 -I fetch_sec.py <presets.json> <raw_dir>

Saves every EPS concept a company has used (diluted, basic-and-diluted, basic,
and the IFRS versions for foreign filers); process.py merges them, preferring
diluted EPS. Set SEC_CONTACT to an email or URL to identify these requests,
as the SEC asks automated tools to do.
"""
import json
import os
import subprocess
import sys
import time

UA = "StockVerdictPro " + (os.environ.get("SEC_CONTACT") or "research-contact@example.com")
CONCEPTS = [
    ("us-gaap", "EarningsPerShareDiluted"),
    ("us-gaap", "EarningsPerShareBasicAndDiluted"),
    ("ifrs-full", "DilutedEarningsLossPerShare"),
    ("us-gaap", "EarningsPerShareBasic"),
    ("ifrs-full", "BasicEarningsLossPerShare"),
]


def curl(url):
    """Return (http_status, body). curl is used because Python's TLS client can stall on some networks."""
    res = subprocess.run(["curl", "-s", "-m", "40", "-A", UA, "-w", "\n%{http_code}", url],
                         capture_output=True, timeout=60)
    body, _, code = res.stdout.rpartition(b"\n")
    return int(code or 0), body


def facts_in(path):
    """How many dated facts a saved concept file holds (0 if unreadable)."""
    try:
        units = json.load(open(path)).get("units", {})
        return sum(len(v) for v in units.values() if isinstance(v, list))
    except Exception:
        return 0


def main(presets_path, raw_dir):
    presets = json.load(open(presets_path))["PRESETS"]
    os.makedirs(raw_dir, exist_ok=True)
    tickers_path = os.path.join(raw_dir, "_company_tickers.json")
    if not os.path.exists(tickers_path):
        code, body = curl("https://www.sec.gov/files/company_tickers.json")
        if code != 200:
            sys.exit("SEC ticker list failed: HTTP %d" % code)
        open(tickers_path, "wb").write(body)
    m = json.load(open(tickers_path))
    cik = {v["ticker"].upper(): int(v["cik_str"]) for v in m.values()}
    for c in presets:
        t = c["ticker"]
        k = cik.get(t) or cik.get(t.replace(".", "-"))
        if not k:
            print("no CIK", t)
            continue
        got, last = [], None
        for tax, concept in CONCEPTS:
            # stop once one label holds a real history; keep going for companies
            # that switched labels over the years (e.g. Exxon) or report under none
            if last and facts_in(last) >= 20:
                break
            out = os.path.join(raw_dir, f"{t}_{tax}_{concept}.json")
            if os.path.exists(out):
                got.append(concept)
                last = out
                continue
            url = f"https://data.sec.gov/api/xbrl/companyconcept/CIK{k:010d}/{tax}/{concept}.json"
            for attempt in range(2):
                try:
                    code, body = curl(url)
                    if code == 200:
                        json.loads(body)
                        open(out, "wb").write(body)
                        got.append(concept)
                        last = out
                    elif code not in (404,):
                        print("http", t, concept, code)
                        time.sleep(2)
                        continue
                    break
                except Exception as e:
                    print("err", t, concept, e)
                    time.sleep(2)
            time.sleep(0.15)
        print(t, ", ".join(got) or "no EPS data", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
