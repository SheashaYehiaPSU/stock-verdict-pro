"""Download economic series from FRED (Federal Reserve Bank of St. Louis).

Usage: python3 -I fetch_fred.py <raw_dir>
Saves one CSV per series, no API key needed.
"""
import os
import subprocess
import sys
import time

SERIES = [
    "DFEDTARU", "DFEDTARL", "DFEDTAR", "FEDFUNDS",  # Fed policy rate (DFEDTAR: single target before Dec 2008)
    "CPIAUCSL", "CPILFESL", "PCEPILFE",          # inflation
    "UNRATE", "PAYEMS", "ICSA",                  # jobs
    "A191RL1Q225SBEA",                           # real GDP growth
    "DGS10", "DGS2", "DGS3MO", "T10Y2Y",         # Treasury yields
    "MORTGAGE30US", "BAMLH0A0HYM2",              # mortgage rate, junk-bond spread
    "UMCSENT", "RSAFS", "INDPRO",                # consumer, retail, industry
    "DCOILWTICO", "T5YIE", "USREC",              # oil, inflation expectations, recessions
]


def main(raw_dir):
    os.makedirs(raw_dir, exist_ok=True)
    for s in SERIES:
        out = os.path.join(raw_dir, s + ".csv")
        url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + s
        for attempt in range(3):
            try:
                # curl rather than urllib: Python's default TLS client stalls on this host
                res = subprocess.run(["curl", "-s", "-m", "60", url], capture_output=True, timeout=90)
                body = res.stdout
                if not body.startswith(b"observation_date"):
                    raise ValueError("unexpected response")
                open(out, "wb").write(body)
                break
            except Exception as e:
                print("retry", s, e)
                time.sleep(3)
        print("ok", s)
        time.sleep(0.4)


if __name__ == "__main__":
    main(sys.argv[1])
