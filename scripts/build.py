"""Assemble the private claude.ai version: one page with everything inside.

Usage: python3 -I scripts/build.py <project dir>
Writes dist/stock-verdict-pro.html (the artifact), dist/preview.html (the same
page with a browser skeleton, for local checks) and dist/app.js (the bare script).
The public website is built by build_site.py from the same sources.
"""
import json
import os
import sys

JS_ORDER = ["core", "shell", "home", "stocks", "stock", "ai", "economy", "compare", "backtest", "learn", "main"]
FONTS = ("https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800"
         "&family=Figtree:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap")


def main(root):
    css = open(os.path.join(root, "src", "styles.css"), encoding="utf-8").read()
    parts = []
    for name in JS_ORDER:
        p = os.path.join(root, "src", "js", name + ".js")
        if os.path.exists(p):
            parts.append(open(p, encoding="utf-8").read())
    js = ("(function () {\n\"use strict\";\nfunction startApp(D) {\n" + "\n".join(parts) + "\n}\n"
          "startApp(JSON.parse(document.getElementById(\"site-data\").textContent));\n})();\n")
    data = json.load(open(os.path.join(root, "data", "site_data.json")))
    blob = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    blob = blob.replace("</", "<\\/").replace("<!--", "<\\!--")
    html = (
        "<title>Stock Verdict Pro</title>\n"
        "<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n"
        "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n"
        "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n"
        f"<link rel=\"stylesheet\" href=\"{FONTS}\">\n"
        f"<style>\n{css}\n</style>\n"
        f"<script type=\"application/json\" id=\"site-data\">{blob}</script>\n"
        f"<script>\n{js}</script>\n"
    )
    os.makedirs(os.path.join(root, "dist"), exist_ok=True)
    out = os.path.join(root, "dist", "stock-verdict-pro.html")
    open(out, "w", encoding="utf-8").write(html)
    open(os.path.join(root, "dist", "app.js"), "w", encoding="utf-8").write(js)
    # local preview: the same skeleton the artifact host wraps around the page
    skeleton = ("<!doctype html><html><head><meta charset=utf8>"
                "<meta name=viewport content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
                "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}"
                "body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>"
                "</head><body>")
    open(os.path.join(root, "dist", "preview.html"), "w", encoding="utf-8").write(skeleton + html + "</body></html>")
    print("wrote", out, round(os.path.getsize(out) / 1024), "KB")


if __name__ == "__main__":
    main(sys.argv[1])
