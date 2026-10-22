"""Build the public multi-page website into site/.

Usage: python3 -I scripts/build_site.py <project dir> [base path, e.g. /stock-verdict-pro/]

Every page is a real address (index.html, stocks/nvda/index.html, economy/ ...)
that loads the same script and data. Links between pages are relative, so the
site works at any address; the base path is only used by the 404 page.
Holdings are stripped from the data: visitors mark their own stocks, and that
choice stays in their browser.
"""
import hashlib
import html
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import FONTS, JS_ORDER  # noqa: E402  (same sources as the claude.ai version)
import make_icons  # noqa: E402

SITE_NAME = "Stock Verdict Pro"
TAGLINE = "Research, valuation and signals for 50 stocks, updated every weekday."


def short_hash(data):
    return hashlib.sha1(data).hexdigest()[:10]


def slug(t):
    return t.lower().replace(".", "-")


def page_html(root, assets, page, title, desc, ticker=""):
    e = html.escape
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b1f3a">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta name="apple-mobile-web-app-title" content="Verdict">
<link rel="manifest" href="{root}manifest.webmanifest">
<link rel="icon" href="{root}assets/icon.svg" type="image/svg+xml">
<link rel="icon" href="{root}assets/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="{root}assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="{root}assets/{assets['css']}">
<script defer src="{root}assets/{assets['js']}"></script>
</head>
<body data-mode="web" data-page="{page}" data-ticker="{e(ticker)}" data-root="{root}" data-data="{root}assets/{assets['data']}">
<div id="boot" class="boot"><b>Stock Verdict</b><span>Loading the latest data…</span></div>
<noscript><p style="padding:16px">This site needs JavaScript turned on.</p></noscript>
</body>
</html>
"""


def main(root, base="/"):
    if not base.endswith("/"):
        base += "/"
    out = os.path.join(root, "site")
    if os.path.isdir(out):
        shutil.rmtree(out)
    adir = os.path.join(out, "assets")
    os.makedirs(adir)

    # data, without anyone's holdings
    data = json.load(open(os.path.join(root, "data", "site_data.json")))
    for s in data["stocks"]:
        s["own"] = False
    blob = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    # script: the same modules as the claude.ai version, started after the data loads
    parts = []
    for name in JS_ORDER:
        p = os.path.join(root, "src", "js", name + ".js")
        if os.path.exists(p):
            parts.append(open(p, encoding="utf-8").read())
    js = ("(function () {\n\"use strict\";\nfunction startApp(D) {\n" + "\n".join(parts) + "\n}\n"
          "var boot = document.getElementById(\"boot\");\n"
          "fetch(document.body.dataset.data).then(function (r) { if (!r.ok) throw new Error(\"HTTP \" + r.status); return r.json(); })\n"
          "  .then(function (D) { if (boot) boot.remove(); startApp(D); })\n"
          "  .catch(function (e) { console.error(e); if (boot) boot.innerHTML = \"<b>Couldn't load the data</b><span>Check your connection and refresh the page.</span>\"; });\n"
          "})();\n").encode("utf-8")
    css = open(os.path.join(root, "src", "styles.css"), encoding="utf-8").read().encode("utf-8")

    assets = {"js": f"app.{short_hash(js)}.js", "css": f"styles.{short_hash(css)}.css", "data": f"data.{short_hash(blob)}.json"}
    open(os.path.join(adir, assets["js"]), "wb").write(js)
    open(os.path.join(adir, assets["css"]), "wb").write(css)
    open(os.path.join(adir, assets["data"]), "wb").write(blob)
    open(os.path.join(adir, "data.json"), "wb").write(blob)  # stable name, read by the next update as a fallback
    make_icons.main(adir)

    pages = [("", "home", SITE_NAME, TAGLINE, ""),
             ("stocks/", "stocks", "All stocks · " + SITE_NAME, "Scores, valuations and signals for all 50 stocks in one sortable table.", ""),
             ("economy/", "economy", "Economy · " + SITE_NAME, "The Fed, inflation, jobs, growth, bonds and oil, and what they mean for these stocks.", ""),
             ("compare/", "compare", "Compare · " + SITE_NAME, "Up to four stocks side by side.", ""),
             ("backtest/", "backtest", "Backtest · " + SITE_NAME, "Test simple buying rules on 20 years of real prices.", ""),
             ("learn/", "learn", "Learn · " + SITE_NAME, "How to use the site, how every number is calculated, and a glossary.", "")]
    for s in data["stocks"]:
        label = f"{s['n']} · {s['t']}" if "(" in s["n"] else f"{s['n']} ({s['t']})"
        pages.append((f"stocks/{slug(s['t'])}/", "stock", f"{label} · {SITE_NAME}", s.get("sum") or TAGLINE, s["t"]))
    for path, page, title, desc, ticker in pages:
        depth = path.count("/")
        rel = "../" * depth
        d = os.path.join(out, path)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(page_html(rel, assets, page, title, desc, ticker))

    manifest = {"name": SITE_NAME, "short_name": "Verdict", "description": TAGLINE, "start_url": "./", "scope": "./",
                "display": "standalone", "background_color": "#0b1f3a", "theme_color": "#0b1f3a",
                "icons": [{"src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
                          {"src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]}
    open(os.path.join(out, "manifest.webmanifest"), "w").write(json.dumps(manifest, indent=1))
    open(os.path.join(out, "404.html"), "w", encoding="utf-8").write(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page not found · {SITE_NAME}</title><meta name="robots" content="noindex">
<style>body{{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b1f3a;color:#eef3fb;display:grid;place-content:center;min-height:100vh;text-align:center;padding:16px}}a{{color:#46c3dc}}</style>
</head><body><h1>Page not found</h1><p>That page doesn't exist. <a href="{base}">Go to the home page</a>.</p></body></html>
""")
    open(os.path.join(out, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")
    open(os.path.join(out, ".nojekyll"), "w").write("")
    if os.path.exists(os.path.join(root, "CNAME")):  # a custom domain, kept across daily rebuilds
        shutil.copy(os.path.join(root, "CNAME"), os.path.join(out, "CNAME"))
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    print(f"built {len(pages)} pages into {out} ({total // 1024} KB), data {len(blob) // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "/")
