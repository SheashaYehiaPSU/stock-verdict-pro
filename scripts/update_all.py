"""Download every data source the site uses.

Usage: python3 -I scripts/update_all.py <raw_dir> [previous site data.json]

Runs each downloader in turn, each with a time limit. A source that fails or
runs out of time is reported but does not stop the others; process.py then
reuses the last published values for anything missing, and refuses to publish
if prices or the economy are missing.

Earnings history (SEC EDGAR and its Yahoo fallback) only changes when companies
report, so it is downloaded on Mondays, or whenever there is no earlier data to
reuse (set FULL_UPDATE=1 to force it).
"""
import datetime as dt
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PRESETS = os.path.join(ROOT, "data", "presets.json")

# (label, script, arguments, time limit in minutes, weekly only)
STEPS = [
    ("Prices (Yahoo Finance)", "fetch_prices.py", [PRESETS, "raw_yahoo"], 15, False),
    ("Economy (FRED)", "fetch_fred.py", ["raw_fred"], 5, False),
    ("Earnings dates, estimates and fund ownership (Nasdaq)", "fetch_nasdaq.py", [PRESETS, "raw_nasdaq"], 15, False),
    ("Insider trades (OpenInsider)", "fetch_openinsider.py", [PRESETS, "raw_oi"], 8, False),
    ("Earnings history (SEC EDGAR)", "fetch_sec.py", [PRESETS, "raw_sec"], 12, True),
    ("Earnings history fallback (Yahoo Finance)", "fetch_yts.py", [PRESETS, "raw_yts"], 5, True),
]


def main(raw, prev=None):
    os.makedirs(raw, exist_ok=True)
    full = (os.environ.get("FULL_UPDATE") == "1" or dt.datetime.utcnow().weekday() == 0
            or not prev or not os.path.exists(prev))
    failed = []
    for label, script, args, minutes, weekly in STEPS:
        if weekly and not full:
            print(f"== {label}: reusing the saved figures (refreshed on Mondays)", flush=True)
            continue
        args = [a if a == PRESETS else os.path.join(raw, a) for a in args]
        t0 = time.time()
        print(f"== {label}", flush=True)
        try:
            res = subprocess.run([sys.executable, "-I", os.path.join(HERE, script), *args], timeout=minutes * 60)
            ok = res.returncode == 0
        except subprocess.TimeoutExpired:
            print(f"   stopped after {minutes} min", flush=True)
            ok = False
        print(f"   {'done' if ok else 'INCOMPLETE'} in {time.time() - t0:.0f}s", flush=True)
        if not ok:
            failed.append(label)
    if failed:
        print("Some sources were incomplete and will reuse the last published data:", ", ".join(failed))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
