"""Pull the 50 researched companies out of the old Stock Verdict page.

Usage: python3 -I extract_presets.py <old_page.html> <out_dir>

Cuts the data section (PARTS, PRESETS, mk(), HOT, MORE, PX, PXH) out of the
page's script, runs it in macOS's sandboxed JavaScriptCore shell (no DOM, no
file or network access), and writes the result as JSON.
"""
import json
import os
import subprocess
import sys
import tempfile

JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"


def main(src, out_dir):
    text = open(src, encoding="utf-8").read()
    start = text.index("const PARTS = [")
    end = text.index("function applyPx(c) {")
    js = text[start:end]
    js += "\nprint(JSON.stringify({PARTS, PRESETS, PX, PXH}));\n"
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(js)
        path = f.name
    try:
        res = subprocess.run([JSC, path], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(path)
    if res.returncode != 0:
        sys.exit("jsc failed: " + res.stderr[:2000])
    data = json.loads(res.stdout)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "presets.json"), "w") as f:
        json.dump(data, f, indent=1)
    tickers = [c["ticker"] for c in data["PRESETS"]]
    owned = [c["ticker"] for c in data["PRESETS"] if c.get("owned")]
    print(len(tickers), "companies:", " ".join(tickers))
    print("owned:", " ".join(owned))
    print("PX entries:", len(data["PX"]), "PXH entries:", len(data["PXH"]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
