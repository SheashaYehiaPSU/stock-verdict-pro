# Stock Verdict Pro

A stock research website for 50 companies: a score out of 100, price zones, 8 decision
signals, P/E history, a DCF calculator, insider trades, analyst targets, the economy,
side-by-side comparisons and backtests of simple buying rules.

**Not financial advice.** The site organizes public data and a scoring model; every
score, fair value and signal is an estimate that can be wrong.

## One-time setup

1. Create a free account at github.com/signup. Your username becomes part of the address:
   `https://USERNAME.github.io/stock-verdict-pro/`.
2. Install GitHub Desktop (desktop.github.com) and sign in.
3. In GitHub Desktop: **File → Add Local Repository → Choose…**, pick this folder, then **Add Repository**.
4. Type `First version` in the Summary box (bottom left) and click **Commit to main**.
5. Click **Publish repository**, keep the name `stock-verdict-pro`, untick **Keep this code private**
   (free GitHub Pages needs a public repository), and click **Publish Repository**.
6. On github.com, open the repository: **Actions** tab → **Update data and publish site** →
   **Run workflow**. Wait for the green check (about 15–30 minutes the first time).
7. **Settings → Pages**: Source **Deploy from a branch**, Branch **gh-pages**, folder **/ (root)** → **Save**.
   About a minute later the site is live.

## How it stays up to date

Every weekday at 22:30 UTC (6:30 pm New York time in summer, 5:30 pm in winter) the
**Update data and publish site** workflow in `.github/workflows/` runs on GitHub's servers:

1. `scripts/update_all.py` downloads fresh data: prices (Yahoo Finance), the economy
   (FRED), earnings dates, estimates and fund ownership (Nasdaq), insider trades
   (SEC Form 4 via OpenInsider) and earnings history (SEC EDGAR).
2. `scripts/process.py` turns it into one data file. If a source fails, its last published
   values are reused; if prices or the economy are missing, nothing is published and the
   site keeps yesterday's version.
3. `scripts/build_site.py` builds the pages into `site/`, and the workflow publishes them
   to the `gh-pages` branch, which GitHub Pages serves.

You can also run it any time: **Actions → Update data and publish site → Run workflow**.

What updates automatically: prices, returns, charts, P/E history, valuation inputs that come
from market data, insider trades, fund ownership, earnings dates and estimates, analyst
consensus targets, and every economic chart. What doesn't: the research itself (scores,
summaries, scenarios, the analyst-by-firm table) in `data/presets.json`, and the dated
context and company news in `data/notes.json`. Those change when they're redone.

## Your stocks are private

The published data contains no holdings. Each visitor marks the stocks they own on the
Home page or with **Add to my stocks** on any stock page, and that list is saved only in
their own browser.

## Run it on your computer

Needs Python 3 and curl (both come with macOS):

```bash
python3 scripts/update_all.py raw
python3 scripts/process.py . raw
python3 scripts/build_site.py .
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000.

## Files

- `data/presets.json`: the research for each company (scores, financials, valuation inputs, scenarios).
- `data/notes.json`: dated economic context and company news.
- `scripts/`: the downloaders, `process.py` (data), `build_site.py` (website), `build.py` (the single-page version used inside Claude).
- `src/`: the site's stylesheet and scripts.

## Notes

- Free GitHub Pages needs a public repository, so this code and research are public. No personal data is in it.
- Search engines are asked not to index the site (`robots.txt`); anyone with the link can still open it.
- Price and estimate data come from free public pages (Yahoo Finance, Nasdaq) meant for personal use. For a site you promote widely, use a licensed data provider instead.
- GitHub pauses scheduled workflows in repositories with no activity for 60 days. If that happens you'll get an email; re-enable it on the Actions tab.
- For a custom domain, add a file named `CNAME` containing the domain to this folder, then set the same domain in **Settings → Pages**.
- Optional: set a repository variable `SEC_CONTACT` (an email or URL) so SEC EDGAR knows who is downloading.
