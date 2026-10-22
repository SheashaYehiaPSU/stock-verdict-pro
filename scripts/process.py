"""Turn the raw downloads into the one data file the site reads.

Usage:
  python3 -I process.py <project dir> <raw dir> [previous site data.json]

<raw dir> holds raw_yahoo/, raw_fred/, raw_nasdaq/, raw_sec/, raw_oi/ and
raw_yts/ (Yahoo fundamentals for companies EDGAR does not cover).
Research comes from data/presets.json, dated notes from data/notes.json.
When a source fails to download, its last good values are reused from the
previous site data, if given. Writes data/site_data.json, and exits with an
error if anything essential is missing, so a broken update never publishes.
"""
import bisect
import csv
import datetime as dt
import json
import math
import os
import re
import statistics as st
import sys
from zoneinfo import ZoneInfo

RISK_PREMIUM = 4.0  # equity risk premium (%) used for DCF discount rates

GROUPS = {
    "Big Tech": ["AAPL", "MSFT", "GOOGL", "AMZN", "META"],
    "Chips": ["NVDA", "AVGO", "AMD", "TSM", "MU", "ASML", "ARM", "INTC"],
    "Software & AI": ["ORCL", "PLTR", "CRWD", "NBIS", "SHOP", "NOW", "CRM", "IONQ"],
    "Finance": ["JPM", "V", "PYPL", "COIN", "HOOD", "SOFI", "BRK.B"],
    "Health": ["LLY", "UNH"],
    "Consumer": ["NKE", "MCD", "COST", "WMT", "KO", "DIS", "HD", "CPNG", "NFLX", "UBER"],
    "Energy & Power": ["VST", "CEG", "OKLO", "GEV", "XOM", "VRT"],
    "Autos, Space & Industrial": ["TSLA", "BA", "RKLB", "SPCX"],
}
GROUP_OF = {t: g for g, ts in GROUPS.items() for t in ts}

# ---------------------------------------------------------------- helpers
def r2(x, n=2):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(x, n)


def sig(x):
    """Round prices compactly: 4 significant figures, at least 2 decimals under $100."""
    if x is None:
        return None
    a = abs(x)
    if a >= 1000:
        return round(x, 1)
    if a >= 1:
        return round(x, 2)
    return round(x, 4)


def pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return (a / b - 1) * 100


def ymd(d):
    return d.strftime("%Y-%m-%d")


def parse_date(s):
    return dt.datetime.strptime(s, "%Y-%m-%d").date()


def period_end(text):
    """Last 'Mon YYYY' in a research period label, as that month's last day."""
    hits = re.findall(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{4})", text or "")
    if not hits:
        return None
    mon, yr = hits[-1]
    m0 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].index(mon) + 1
    y0 = int(yr)
    nxt = dt.date(y0 + (m0 == 12), (m0 % 12) + 1, 1)
    return nxt - dt.timedelta(days=1)


# ---------------------------------------------------------------- Yahoo charts
def read_chart(path):
    d = json.load(open(path))
    r = d["chart"]["result"][0]
    meta = r["meta"]
    off = meta.get("gmtoffset", 0)
    ts = r.get("timestamp") or []
    q = r["indicators"]["quote"][0]
    close = q.get("close") or []
    adj = (r["indicators"].get("adjclose") or [{}])[0].get("adjclose") or close
    rows = []
    for i, t in enumerate(ts):
        c = close[i] if i < len(close) else None
        a = adj[i] if i < len(adj) else None
        if c is None:
            continue
        day = dt.datetime.utcfromtimestamp(t + off).date()
        rows.append((day, float(c), float(a) if a is not None else float(c)))
    # Before the US close, Yahoo's newest daily bar is today's unfinished session: leave it out.
    if meta.get("dataGranularity") == "1d" and rows:
        now_ny = dt.datetime.now(ZoneInfo("America/New_York"))
        if rows[-1][0] == now_ny.date() and now_ny.time() < dt.time(16, 20):
            rows = rows[:-1]
    ev = r.get("events") or {}
    splits = []
    for s in (ev.get("splits") or {}).values():
        day = dt.datetime.utcfromtimestamp(s["date"] + off).date()
        num, den = s.get("numerator"), s.get("denominator")
        if num and den:
            splits.append((day, float(num) / float(den)))
    splits.sort()
    return {"rows": rows, "meta": meta, "splits": splits}


def trim_gaps(rows, max_gap_days=60):
    """Keep only the part after the last long trading gap (e.g. a relisting)."""
    start = 0
    for i in range(1, len(rows)):
        if (rows[i][0] - rows[i - 1][0]).days > max_gap_days:
            start = i
    return rows[start:]


def week_key(d):
    y, w, _ = d.isocalendar()
    return (y, w)


def to_weekly(rows):
    out = {}
    for r in rows:
        out[week_key(r[0])] = r
    return [out[k] for k in sorted(out)]


def to_monthly(rows):
    out = {}
    for r in rows:
        out[(r[0].year, r[0].month)] = r
    return out  # {(y, m): (day, close, adj)}


# ---------------------------------------------------------------- FRED
def read_fred(path):
    out = []
    with open(path) as f:
        rd = csv.reader(f)
        next(rd)
        for row in rd:
            if len(row) < 2 or row[1] in (".", ""):
                continue
            try:
                out.append((parse_date(row[0]), float(row[1])))
            except ValueError:
                pass
    return out


def monthly_avg(series, start=dt.date(2000, 1, 1)):
    acc = {}
    for d, v in series:
        if d < start:
            continue
        acc.setdefault((d.year, d.month), []).append(v)
    return {k: sum(v) / len(v) for k, v in acc.items()}


def monthly_last(series, start=dt.date(2000, 1, 1)):
    acc = {}
    for d, v in series:
        if d < start:
            continue
        acc[(d.year, d.month)] = v
    return acc


def yoy(monthly):
    out = {}
    for (y, m), v in monthly.items():
        prev = monthly.get((y - 1, m))
        if prev:
            out[(y, m)] = (v / prev - 1) * 100
    return out


# ---------------------------------------------------------------- SEC EPS
SEC_PREF = ["us-gaap_EarningsPerShareDiluted", "us-gaap_EarningsPerShareBasicAndDiluted",
            "ifrs-full_DilutedEarningsLossPerShare", "us-gaap_EarningsPerShareBasic", "ifrs-full_BasicEarningsLossPerShare"]
ADR_RATIO = {"TSM": 5.0}  # one TSM ADR = 5 ordinary shares


def sec_quarterly_eps(path, splits, fx=None, adr=1.0):
    """Quarterly diluted EPS in US$ per traded share, split-adjusted to today's share count.

    `fx` maps a currency to {(year, month): US$ per unit}. Returns
    (quarters, annuals, unit) where quarters/annuals are sorted lists of
    (period_end, eps, first_filed_date)."""
    d = json.load(open(path))
    units = {u: a for u, a in d.get("units", {}).items() if u.endswith("/shares")}
    if not units:
        return [], [], None
    unit_name = "USD/shares" if len(units.get("USD/shares", [])) >= 12 else max(units, key=lambda u: len(units[u]))
    ccy = unit_name.split("/")[0]
    if ccy != "USD" and (not fx or ccy not in fx):
        return [], [], unit_name
    facts = [f for f in units[unit_name] if "start" in f and "end" in f and f.get("val") is not None]

    def to_usd(v, end):
        if ccy == "USD":
            return v * adr
        rate = fx[ccy].get((end.year, end.month))
        if rate is None:
            keys = sorted(fx[ccy])
            j = bisect.bisect_right(keys, (end.year, end.month)) - 1
            rate = fx[ccy][keys[max(0, j)]]
        return v * rate * adr

    def factor_after(filed):
        k = 1.0
        for day, ratio in splits:
            if day > filed:
                k *= ratio
        return k

    by_period = {}
    for f in facts:
        s, e, filed = parse_date(f["start"]), parse_date(f["end"]), parse_date(f["filed"])
        days = (e - s).days
        v = to_usd(float(f["val"]), e) / factor_after(filed)
        key = (s, e)
        cur = by_period.get(key)
        if cur is None:
            by_period[key] = {"start": s, "end": e, "days": days, "val": v, "filed_last": filed, "filed_first": filed}
        else:
            if filed >= cur["filed_last"]:
                cur["val"], cur["filed_last"] = v, filed
            if filed < cur["filed_first"]:
                cur["filed_first"] = filed

    quarters = {}
    for p in by_period.values():
        if 80 <= p["days"] <= 100:
            quarters[p["end"]] = (p["val"], p["filed_first"])
    # derive missing fourth quarters: annual minus the three quarters inside it
    for p in by_period.values():
        if 350 <= p["days"] <= 380 and p["end"] not in quarters:
            inside = sorted(e for e in quarters if p["start"] < e < p["end"])
            if len(inside) == 3:
                q4 = p["val"] - sum(quarters[e][0] for e in inside)
                quarters[p["end"]] = (q4, p["filed_first"])
    out = sorted((e, v, f) for e, (v, f) in quarters.items())
    annual = sorted((p["end"], p["val"], p["filed_first"]) for p in by_period.values() if 350 <= p["days"] <= 380)
    return out, annual, unit_name


def ttm_series(quarters, annual=()):
    """TTM EPS at each quarter end where the last four quarters are consecutive,
    plus fiscal-year EPS for years the quarterly data does not reach."""
    out = []
    for i in range(3, len(quarters)):
        win = quarters[i - 3:i + 1]
        span = (win[-1][0] - win[0][0]).days
        if 250 <= span <= 300:
            out.append((win[-1][0], sum(q[1] for q in win), max(q[2] for q in win)))
    first = out[0][0] if out else None
    for a in annual:
        if first is None or a[0] < first:
            out.append(a)
    return sorted(out)


def yahoo_ts_eps(path):
    """Fallback for companies EDGAR does not cover: Yahoo fundamentals timeseries."""
    d = json.load(open(path))
    q, a = [], []
    for r in d.get("timeseries", {}).get("result", []):
        t = r["meta"]["type"][0]
        for v in r.get(t) or []:
            if not v:
                continue
            day = parse_date(v["asOfDate"])
            val = v["reportedValue"]["raw"]
            if t == "quarterlyDilutedEPS":
                q.append((day, val))
            elif t == "annualDilutedEPS":
                a.append((day, val))
    q.sort()
    a.sort()
    return q, a


# ---------------------------------------------------------------- Nasdaq
def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip().replace("$", "").replace(",", "").replace("%", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def nasdaq(raw, t, key):
    p = os.path.join(raw, f"{t}_{key}.json")
    if not os.path.exists(p):
        return None
    try:
        return json.load(open(p)).get("data")
    except Exception:
        return None


def parse_insider(d):
    if not d:
        return None
    out = {"trades": {}, "shares": {}, "recent": []}
    for row in (d.get("numberOfTrades") or {}).get("rows") or []:
        out["trades"][row["insiderTrade"]] = [num(row.get("months3")), num(row.get("months12"))]
    for row in (d.get("numberOfSharesTraded") or {}).get("rows") or []:
        out["shares"][row["insiderTrade"]] = [num(row.get("months3")), num(row.get("months12"))]
    rows = (((d.get("transactionTable") or {}).get("table") or {}).get("rows")) or []
    for r in rows[:25]:
        out["recent"].append([
            (r.get("insider") or "").title(), r.get("relation") or "", r.get("lastDate") or "",
            r.get("transactionType") or "", num(r.get("sharesTraded")), num(r.get("lastPrice")), num(r.get("sharesHeld")),
        ])
    T = out["trades"]
    S = out["shares"]
    return {
        "buys3": (T.get("Number of Open Market Buys") or [None, None])[0],
        "buys12": (T.get("Number of Open Market Buys") or [None, None])[1],
        "sells3": (T.get("Number of Sells") or [None, None])[0],
        "sells12": (T.get("Number of Sells") or [None, None])[1],
        "shBought3": (S.get("Number of Shares Bought") or [None, None])[0],
        "shBought12": (S.get("Number of Shares Bought") or [None, None])[1],
        "shSold3": (S.get("Number of Shares Sold") or [None, None])[0],
        "shSold12": (S.get("Number of Shares Sold") or [None, None])[1],
        "net3": (S.get("Net Activity") or [None, None])[0],
        "net12": (S.get("Net Activity") or [None, None])[1],
        "recent": out["recent"],
    }


def parse_inst(d):
    if not d:
        return None
    s = d.get("ownershipSummary") or {}
    out = {
        "pct": num((s.get("SharesOutstandingPCT") or {}).get("value")),
        "valueM": num((s.get("TotalHoldingsValue") or {}).get("value")),
    }
    for row in (d.get("activePositions") or {}).get("rows") or []:
        k = {"Increased Positions": "inc", "Decreased Positions": "dec", "Held Positions": "held",
             "Total Institutional Shares": "total"}.get(row.get("positions"))
        if k:
            out[k] = [num(row.get("holders")), num(row.get("shares"))]
    for row in (d.get("newSoldOutPositions") or {}).get("rows") or []:
        k = {"New Positions": "new", "Sold Out Positions": "soldOut"}.get(row.get("positions"))
        if k:
            out[k] = [num(row.get("holders")), num(row.get("shares"))]
    top = []
    rows = ((((d.get("holdingsTransactions") or {}).get("table")) or {}).get("rows")) or []
    for r in rows[:10]:
        top.append([r.get("ownerName") or "", r.get("date") or "", num(r.get("sharesHeld")),
                    num(r.get("sharesChangePCT")), num(r.get("marketValue"))])
    out["top"] = top
    return out


MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def parse_edate(d):
    if not d:
        return None
    txt = d.get("reportText") or ""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", txt)
    if not m:
        return None
    day = dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    when = "after the close" if "after market close" in txt else ("before the open" if "before market open" in txt else "")
    estimated = "estimated to report" in txt or "derived from an algorithm" in txt
    cons = re.search(r"consensus EPS forecast for the quarter is \$(-?[\d.]+)", txt)
    last = re.search(r"reported EPS for the same quarter last year was \$(-?[\d.]+)", txt)
    return {"date": ymd(day), "when": when, "estimated": estimated,
            "epsEst": float(cons.group(1).rstrip(".")) if cons else None,
            "epsYearAgo": float(last.group(1).rstrip(".")) if last else None}


def parse_forecast(d):
    if not d:
        return None
    q = [[r.get("fiscalEnd"), num(r.get("consensusEPSForecast")), num(r.get("noOfEstimates")), num(r.get("up")), num(r.get("down"))]
         for r in ((d.get("quarterlyForecast") or {}).get("rows") or [])]
    y = [[r.get("fiscalEnd"), num(r.get("consensusEPSForecast")), num(r.get("noOfEstimates")), num(r.get("up")), num(r.get("down"))]
         for r in ((d.get("yearlyForecast") or {}).get("rows") or [])]
    ntm = None
    if len(q) >= 4 and all(r[1] is not None for r in q[:4]):
        ntm = sum(r[1] for r in q[:4])
    up = sum((r[3] or 0) for r in q + y)
    down = sum((r[4] or 0) for r in q + y)
    return {"q": q, "y": y, "ntm": r2(ntm), "revUp": up, "revDown": down}


def parse_summary(d):
    if not d:
        return None
    s = d.get("summaryData") or {}
    g = lambda k: (s.get(k) or {}).get("value")
    return {"target1y": num(g("OneYrTarget")), "divYield": num(g("Yield")), "annualDiv": num(g("AnnualizedDividend")),
            "exDiv": g("ExDividendDate"), "mcap": num(g("MarketCap")), "industry": g("Industry"), "exchange": g("Exchange")}


# ---------------------------------------------------------------- OpenInsider (Form 4 purchases and sales)
from html.parser import HTMLParser


class _TinyTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.on, self.rows, self.cur, self.cell = False, [], None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table" and "tinytable" in (a.get("class") or ""):
            self.on = True
        elif self.on and tag == "tr":
            self.cur = []
        elif self.on and tag in ("td", "th"):
            self.cell = ""

    def handle_endtag(self, tag):
        if not self.on:
            return
        if tag in ("td", "th") and self.cell is not None:
            self.cur.append(self.cell.strip().replace("\xa0", " "))
            self.cell = None
        elif tag == "tr" and self.cur is not None:
            self.rows.append(self.cur)
            self.cur = None
        elif tag == "table":
            self.on = False

    def handle_data(self, d):
        if self.cell is not None:
            self.cell += d


def parse_openinsider(path, as_of):
    if not os.path.exists(path):
        return None
    g = _TinyTable()
    g.feed(open(path, encoding="utf-8", errors="replace").read())
    if not g.rows:
        return None
    head = g.rows[0]
    col = {name: i for i, name in enumerate(head)}
    need = ["Trade Date", "Insider Name", "Title", "Trade Type", "Price", "Qty", "Value"]
    if any(n not in col for n in need):
        return None
    trades = []
    for r in g.rows[1:]:
        if len(r) < len(head):
            continue
        kind = r[col["Trade Type"]][:1]
        if kind not in ("P", "S"):
            continue
        try:
            day = parse_date(r[col["Trade Date"]][:10])
        except ValueError:
            continue
        trades.append([ymd(day), r[col["Insider Name"]], r[col["Title"]], kind,
                       num(r[col["Price"]]), num(r[col["Qty"]]), num(r[col["Value"]])])
    trades.sort(reverse=True)

    def agg(days):
        cut = as_of - dt.timedelta(days=days)
        b = [t for t in trades if t[3] == "P" and parse_date(t[0]) >= cut]
        s = [t for t in trades if t[3] == "S" and parse_date(t[0]) >= cut]
        return {"buys": len(b), "buyers": len({t[1] for t in b}), "bought": r2(sum(abs(t[6] or 0) for t in b), 0),
                "sells": len(s), "sellers": len({t[1] for t in s}), "sold": r2(sum(abs(t[6] or 0) for t in s), 0)}

    return {"m3": agg(91), "m12": agg(365), "recent": trades[:14]}


# ---------------------------------------------------------------- statistics
def stdev(xs):
    return st.pstdev(xs) if len(xs) > 1 else None


def regress(y, x):
    """Least-squares slope and correlation of y on x."""
    n = len(x)
    if n < 18:
        return None, None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    if sxx == 0 or syy == 0:
        return None, None
    return sxy / sxx, sxy / math.sqrt(sxx * syy)


def max_drawdown(vals):
    peak, mdd = None, 0.0
    for v in vals:
        if v is None:
            continue
        peak = v if peak is None or v > peak else peak
        mdd = min(mdd, v / peak - 1)
    return mdd * 100


# ---------------------------------------------------------------- main
def main(site_dir, raw, prev_path=None):
    pre = json.load(open(os.path.join(site_dir, "data", "presets.json")))
    PARTS, PRESETS, PX, PXH = pre["PARTS"], pre["PRESETS"], pre["PX"], pre["PXH"]
    notes = json.load(open(os.path.join(site_dir, "data", "notes.json")))
    # Your holdings live in a local file that is never uploaded (see .gitignore);
    # only the private claude.ai version uses them. The public site never has any.
    mine_path = os.path.join(site_dir, "data", "my_stocks.json")
    my_stocks = set(json.load(open(mine_path))) if os.path.exists(mine_path) else set()
    prev_data = {}  # last published values per ticker, reused when a source fails today
    if prev_path and os.path.exists(prev_path):
        try:
            prev_data = {s["t"]: s for s in json.load(open(prev_path)).get("stocks", [])}
        except Exception as e:
            print("could not read previous data:", e)
    ydir = os.path.join(raw, "raw_yahoo")
    fdir = os.path.join(raw, "raw_fred")
    ndir = os.path.join(raw, "raw_nasdaq")
    sdir = os.path.join(raw, "raw_sec")
    tsdir = os.path.join(raw, "raw_yts")

    # ---------- FRED ----------
    fred = {}
    for fn in os.listdir(fdir) if os.path.isdir(fdir) else []:
        if fn.endswith(".csv"):
            fred[fn[:-4]] = read_fred(os.path.join(fdir, fn))

    # ---------- Yahoo ----------
    def chart(sym, kind):
        p = os.path.join(ydir, f"{sym.replace('.', '-')}_{kind}.json")
        if not os.path.exists(p):
            return None
        try:
            return read_chart(p)
        except Exception as e:
            print("unreadable price file", sym, kind, e)
            return None

    spy_d = chart("SPY", "d")
    if not spy_d or not spy_d["rows"]:
        sys.exit("S&P 500 (SPY) prices are missing; not publishing.")
    spy_rows = spy_d["rows"]
    last_day = spy_rows[-1][0]  # the latest trading day in the data
    AS_OF = ymd(last_day)

    # month calendar used by every monthly series in the site
    months = []
    y, m = 2005, 1
    while (y, m) <= (last_day.year, last_day.month):
        months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    mlabels = [f"{a}-{b:02d}" for a, b in months]

    def mseries(dct, nd=2):
        return [r2(dct.get(k), nd) for k in months]
    day_cal = [r[0] for r in spy_rows if (last_day - r[0]).days <= 372]
    week_cal = [r[0] for r in to_weekly(spy_rows)]
    week_cal = [d for d in week_cal if (last_day - d).days <= 3660]
    # the week bucket of the last day is the current (partial) week
    wk_keys = [week_key(d) for d in week_cal]

    # exchange rates for companies that report in euros or Taiwan dollars
    fx = {}
    eur = chart("EURUSD=X", "m")
    twd = chart("TWD=X", "m")
    if eur:
        fx["EUR"] = {(r[0].year, r[0].month): r[1] for r in eur["rows"]}
    if twd:
        fx["TWD"] = {(r[0].year, r[0].month): 1.0 / r[1] for r in twd["rows"] if r[1]}

    tnx_m = monthly_last(fred.get("DGS10", []), dt.date(2004, 12, 1))
    oil_m = monthly_last(fred.get("DCOILWTICO", []), dt.date(2004, 12, 1))
    bill_m = monthly_avg(fred.get("DGS3MO", []), dt.date(2004, 12, 1))

    def series_pack(sym, trim=True):
        d = chart(sym, "d")
        mo = chart(sym, "m")
        if not d or not d["rows"]:
            return None
        rows = trim_gaps(d["rows"]) if trim else d["rows"]
        relisted = len(rows) < len(d["rows"])  # history before a long trading gap belongs to another company
        first_day = rows[0][0]
        bymap = {r[0]: r for r in rows}
        daily = [sig(bymap[dd][1]) if dd in bymap else None for dd in day_cal]
        wk = {week_key(r[0]): r for r in to_weekly(rows)}
        weekly = [sig(wk[k][1]) if k in wk else None for k in wk_keys]
        # monthly: older history from the monthly file, last 10 years from daily rows
        mm = {}
        if mo:
            for r in mo["rows"]:
                if not relisted or r[0] >= first_day.replace(day=1):
                    mm[(r[0].year, r[0].month)] = r
        mm.update(to_monthly(rows))
        mclose = [sig(mm[k][1]) if k in mm else None for k in months]
        madj = [sig(mm[k][2]) if k in mm else None for k in months]
        return {"rows": rows, "meta": d["meta"], "splits": d["splits"], "daily": daily, "weekly": weekly,
                "mclose": mclose, "madj": madj, "first": ymd(first_day), "mmap": mm}

    spy = series_pack("SPY", trim=False)
    qqq = series_pack("QQQ", trim=False)

    def mret(pack, i):
        a, b = pack["madj"][i - 1], pack["madj"][i]
        if a is None or b is None or a == 0:
            return None
        return b / a - 1

    stocks = []
    pe_debug = {}
    for c in PRESETS:
        t = c["ticker"]
        pk = series_pack(t)
        if not pk:
            print("NO PRICES", t)
            continue
        rows = pk["rows"]
        closes = [r[1] for r in rows]
        last = closes[-1]
        prev = closes[-2] if len(closes) > 1 else None

        def back(n):
            return closes[-1 - n] if len(closes) > n else None

        ytd_base = None
        for r in rows:
            if r[0].year < last_day.year:
                ytd_base = r[1]
        yr = [r for r in rows if (last_day - r[0]).days <= 365]
        hi52 = max(r[1] for r in yr) if yr else None
        lo52 = min(r[1] for r in yr) if yr else None
        ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
        ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
        lr = [math.log(closes[i] / closes[i - 1]) for i in range(max(1, len(closes) - 252), len(closes))]
        vol = stdev(lr) * math.sqrt(252) * 100 if len(lr) > 60 else None

        # annualized total returns from monthly adjusted closes
        def ann(years):
            n = years * 12
            i_end = len(months) - 1
            i0 = i_end - n
            if i0 < 0 or pk["madj"][i0] is None or pk["madj"][i_end] is None:
                return None
            tot = pk["madj"][i_end] / pk["madj"][i0]
            return (tot ** (1 / years) - 1) * 100

        # beta and macro sensitivities over the last 60 months
        ys, xs, rate_x, oil_x, ry, oy = [], [], [], [], [], []
        for i in range(len(months) - 60, len(months)):
            a = mret(pk, i)
            b = mret(spy, i)
            if a is None:
                continue
            if b is not None:
                ys.append(a)
                xs.append(b)
            k0, k1 = months[i - 1], months[i]
            if k0 in tnx_m and k1 in tnx_m:
                rate_x.append(tnx_m[k1] - tnx_m[k0])
                ry.append(a)
            if k0 in oil_m and k1 in oil_m and oil_m[k0] > 0:
                oil_x.append(oil_m[k1] / oil_m[k0] - 1)
                oy.append(a)
        beta, corr = regress(ys, xs)
        rate_b, rate_r = regress(ry, rate_x)
        oil_b, oil_r = regress(oy, oil_x)

        # ---------- P/E history ----------
        eps_q, ttm, src = [], [], None
        reps = [os.path.join(sdir, f"{t}_{name}.json") for name in SEC_PREF]
        reps = [p for p in reps if os.path.exists(p)]
        if reps and t != "BRK.B":  # Berkshire reports per Class A share and its earnings swing with stock gains
            # merge every EPS label the company has used; the preferred label wins for a period
            qd, ad, unit = {}, {}, None
            for p in reps:
                q1, a1, u1 = sec_quarterly_eps(p, pk["splits"], fx, ADR_RATIO.get(t, 1.0))
                unit = unit or (u1 if (q1 or a1) else None)
                for e, v, fd in q1:
                    qd.setdefault(e, (e, v, fd))
                for e, v, fd in a1:
                    ad.setdefault(e, (e, v, fd))
            eps_q = sorted(qd.values())
            eps_a = sorted(ad.values())
            ttm = ttm_series(eps_q, eps_a)
            if ttm:
                src = "SEC EDGAR filings (diluted EPS, adjusted for stock splits)"
                if unit and not unit.startswith("USD"):
                    src = "SEC EDGAR filings (EPS converted to US$ at each period's exchange rate" + (", per ADR)" if t in ADR_RATIO else ")")
                if not eps_q:
                    src += "; yearly figures only"
        if not ttm and t != "BRK.B":
            tp = os.path.join(tsdir, f"{t}.json")
            if os.path.exists(tp):
                q, a = yahoo_ts_eps(tp)
                qq = [(d0, v, d0 + dt.timedelta(days=40)) for d0, v in q]
                ttm = ttm_series(qq)
                aa = [(d0, v, d0 + dt.timedelta(days=60)) for d0, v in a]
                # annual points fill the years before the quarterly window
                known = {x[0] for x in ttm}
                ttm = sorted(ttm + [x for x in aa if x[0] not in known and (not ttm or x[0] < ttm[0][0])])
                src = "Yahoo Finance reported EPS (last 4 years)" if ttm else None
        # Earnings filings are only downloaded weekly; on other days (or if the SEC download
        # failed) reuse the saved earnings series and recompute P/E with today's prices.
        old = prev_data.get(t) or {}
        if not ttm and (old.get("pe") or {}).get("eps"):
            ttm = [(parse_date(e[0]), e[2], parse_date(e[1])) for e in old["pe"]["eps"]]
            src = old["pe"].get("src")
        # When the filings stop early (foreign filers file yearly), add the research's
        # latest 12-month EPS as the newest point so today's P/E is current.
        research_end = period_end(c["fin"].get("period"))
        r_eps = c["fin"].get("eps")
        if ttm and research_end and r_eps is not None and research_end > max(x[0] for x in ttm) + dt.timedelta(days=60):
            ttm = sorted(ttm + [(research_end, float(r_eps), research_end + dt.timedelta(days=45))])
            src = (src or "") + "; latest 12 months from company results"
        pe = [None] * len(months)
        ttm_now = None
        if ttm:
            known_dates = [x[2] for x in ttm]
            order = sorted(range(len(ttm)), key=lambda i: ttm[i][2])
            kd = [ttm[i][2] for i in order]
            for i, k in enumerate(months):
                mend = (dt.date(k[0] + (k[1] == 12), (k[1] % 12) + 1, 1) - dt.timedelta(days=1))
                j = bisect.bisect_right(kd, mend) - 1
                px = pk["mclose"][i]
                if j < 0 or px is None:
                    continue
                e = ttm[order[j]][1]
                if e > 0:
                    v = px / e
                    pe[i] = r2(v, 1) if v < 400 else None
            ttm_now = ttm[order[-1]][1]
            pe_debug[t] = {"ttm_now": r2(ttm_now), "research_eps": c["fin"].get("eps"), "latest_q": ymd(ttm[order[-1]][0])}

        def pe_stats(years):
            vals = [v for v in pe[-years * 12:] if v is not None]
            if len(vals) < 12:
                return None
            vs = sorted(vals)
            q = lambda p: vs[min(len(vs) - 1, max(0, int(round(p * (len(vs) - 1)))))]
            return {"avg": r2(sum(vals) / len(vals), 1), "med": r2(q(0.5), 1), "p25": r2(q(0.25), 1),
                    "p75": r2(q(0.75), 1), "lo": r2(vs[0], 1), "hi": r2(vs[-1], 1), "n": len(vals)}

        # ---------- Nasdaq ----------
        ins = parse_insider(nasdaq(ndir, t, "insider"))
        oi = parse_openinsider(os.path.join(raw, "raw_oi", t + ".html"), last_day)
        inst = parse_inst(nasdaq(ndir, t, "inst"))
        edate = parse_edate(nasdaq(ndir, t, "edate"))
        fc = parse_forecast(nasdaq(ndir, t, "forecast"))
        summ = parse_summary(nasdaq(ndir, t, "summary"))
        # a source that failed today keeps its last published values
        ins = ins or old.get("ins")
        oi = oi or old.get("oi")
        inst = inst or old.get("inst")
        edate = edate or old.get("ed")
        fc = fc or old.get("fc")
        summ = summ or old.get("nq")

        # ---------- DCF defaults ----------
        f = c["fin"]
        v = c["val"]
        shares = c.get("shares")
        if t in ADR_RATIO and shares:
            shares = shares / ADR_RATIO[t]  # count US-listed ADRs, which is what the price refers to
        # two views of yearly cash: last year's free cash flow, and next year's expected earnings
        fcf_m = f.get("fcf") if (f.get("fcf") or 0) > 0 else None
        fwd = fc["ntm"] if fc and fc.get("ntm") and fc["ntm"] > 0 else (
            v.get("value") if "EPS" in (v.get("metricLabel") or "") and (v.get("value") or 0) > 0 else None)
        earn_m = fwd * shares if fwd and shares else None
        if t == "JPM":
            fcf_m = None  # banks have no normal free cash flow; earnings stand in
            earn_m = earn_m or f.get("netIncome")
        if fcf_m and earn_m:
            cf_key, cf0 = "avg", (fcf_m + earn_m) / 2
        elif fcf_m or earn_m:
            cf_key, cf0 = ("fcf" if fcf_m else "earn"), (fcf_m or earn_m)
        else:
            cf_key, cf0 = None, None
        mcap_now = last * shares if shares else None
        if cf0 and mcap_now and cf0 / mcap_now < 0.005:
            cf_key, cf0 = None, None  # cash flow too small vs. the price for a DCF to say anything
        net_cash = 0.0 if t in ("JPM", "BRK.B") else ((f.get("cash") or 0) - (f.get("debt") or 0))
        rf = fred.get("DGS10", [(None, 4.2)])[-1][1]
        b_adj = 0.67 * (beta if beta is not None else 1.3) + 0.33  # Blume-adjusted beta pulls extremes toward 1
        disc = min(12.5, max(8.0, rf + b_adj * RISK_PREMIUM))
        g1 = min(30.0, max(-5.0, float(v.get("growth") or 0)))

        stocks.append({
            "t": t, "n": c["name"], "a": c.get("aliases") or [], "sec": c.get("sector"), "g": GROUP_OF.get(t, "Other"),
            "own": t in my_stocks, "sum": c.get("summary"), "upd": notes.get("updates", {}).get(t),
            "fin": f, "val": v, "parts": c["parts"], "swot": c.get("swot"), "scen": c.get("scenarios"),
            "cat": c.get("catalysts"), "sent": c.get("sentiment"), "src": c.get("sources"),
            "sh": shares, "researchPrice": c.get("price"), "researchDate": c.get("priceAsOf"),
            "tg": PX.get(t), "pxlog": PXH.get(t),
            "px": {"last": sig(last), "prev": sig(prev), "d1": r2(pct(last, prev)), "m1": r2(pct(last, back(21))),
                   "m3": r2(pct(last, back(63))), "m6": r2(pct(last, back(126))), "ytd": r2(pct(last, ytd_base)),
                   "y1": r2(pct(last, back(252))), "hi52": sig(hi52), "lo52": sig(lo52), "ma50": sig(ma50), "ma200": sig(ma200),
                   "vol": r2(vol, 1), "tr3": r2(ann(3), 1), "tr5": r2(ann(5), 1), "tr10": r2(ann(10), 1),
                   "mdd5": r2(max_drawdown(pk["weekly"][-261:]), 1), "first": pk["first"], "date": ymd(rows[-1][0])},
            "risk": {"beta": r2(beta), "corr": r2(corr), "rate": r2(rate_b * 100 if rate_b is not None else None, 1),
                     "rateR": r2(rate_r), "oil": r2(oil_b, 2), "oilR": r2(oil_r)},
            "pe": {"m": pe, "src": src, "ttm": r2(ttm_now), "s5": pe_stats(5), "s10": pe_stats(10),
                   "eps": [[ymd(e), ymd(k), float(f"{v:.8g}")] for e, v, k in sorted(ttm)]},
            "dcf": {"key": cf_key, "fcf": r2(fcf_m, 1), "earn": r2(earn_m, 1), "cf0": r2(cf0, 1), "g1": g1, "tg": 3.0,
                    "r": r2(disc, 1), "rf": r2(rf), "betaAdj": r2(b_adj), "netCash": r2(net_cash, 1)},
            "d": pk["daily"], "w": pk["weekly"], "mc": pk["mclose"], "ma": pk["madj"],
            "ins": ins, "oi": oi, "inst": inst, "ed": edate, "fc": fc, "nq": summ,
        })
        print("ok", t, "last", sig(last), "pe-months", sum(1 for x in pe if x), "beta", r2(beta))

    # ---------- market snapshot ----------
    def quick(sym, label):
        pk = series_pack(sym, trim=False)
        if not pk:
            return None
        cl = [r[1] for r in pk["rows"]]
        ytd_base = None
        for r in pk["rows"]:
            if r[0].year < last_day.year:
                ytd_base = r[1]
        return {"sym": sym, "label": label, "last": sig(cl[-1]), "d1": r2(pct(cl[-1], cl[-2])),
                "m1": r2(pct(cl[-1], cl[-22] if len(cl) > 22 else None)), "ytd": r2(pct(cl[-1], ytd_base)),
                "y1": r2(pct(cl[-1], cl[-253] if len(cl) > 253 else None)), "d": pk["daily"], "date": ymd(pk["rows"][-1][0])}

    market = [x for x in [
        quick("^GSPC", "S&P 500"), quick("SPY", "S&P 500 (SPY)"), quick("QQQ", "Nasdaq 100 (QQQ)"), quick("^VIX", "Fear gauge (VIX)"),
        quick("^TNX", "10-year Treasury yield"), quick("CL=F", "Oil (WTI, $/barrel)"), quick("GC=F", "Gold ($/oz)"),
        quick("DX-Y.NYB", "US dollar index"), quick("BTC-USD", "Bitcoin")] if x]

    # ---------- macro ----------
    # Before Dec 16, 2008 the Fed set a single target (DFEDTAR); since then a range (DFEDTARL/U).
    range_start = dt.date(2008, 12, 16)
    tu = [(d0, v) for d0, v in fred.get("DFEDTAR", []) if d0 < range_start] + fred.get("DFEDTARU", [])
    lo_map = dict((d0, v) for d0, v in fred.get("DFEDTAR", []) if d0 < range_start)
    lo_map.update(dict(fred.get("DFEDTARL", [])))
    changes = []
    prev = None
    for d0, v in tu:
        if d0 < dt.date(2004, 1, 1):
            continue
        if prev is None or v != prev:
            changes.append([ymd(d0), r2(lo_map.get(d0, v - 0.25)), r2(v)])
        prev = v
    # Fed turning points: first move of a cycle (direction change, or the first move after a pause of 8+ months)
    turns = []
    last_move, last_dir = None, None
    for i in range(1, len(changes)):
        d0 = parse_date(changes[i][0])
        dirn = 1 if changes[i][2] > changes[i - 1][2] else -1
        paused = last_move is not None and (d0 - last_move).days > 250
        if last_dir is None or dirn != last_dir or paused:
            turns.append({"date": changes[i][0], "dir": "hike" if dirn > 0 else "cut", "to": [changes[i][1], changes[i][2]]})
        last_move, last_dir = d0, dirn

    cpi = monthly_last(fred.get("CPIAUCSL", []), dt.date(1999, 1, 1))
    core = monthly_last(fred.get("CPILFESL", []), dt.date(1999, 1, 1))
    pce = monthly_last(fred.get("PCEPILFE", []), dt.date(1999, 1, 1))
    pay = monthly_last(fred.get("PAYEMS", []), dt.date(2004, 11, 1))
    paych = {}
    keys = sorted(pay)
    for i in range(1, len(keys)):
        paych[keys[i]] = pay[keys[i]] - pay[keys[i - 1]]
    rs = monthly_last(fred.get("RSAFS", []), dt.date(1999, 1, 1))
    ip = monthly_last(fred.get("INDPRO", []), dt.date(1999, 1, 1))
    gdp = [[ymd(d0), r2(v, 1)] for d0, v in fred.get("A191RL1Q225SBEA", []) if d0.year >= 2005]
    rec = monthly_last(fred.get("USREC", []), dt.date(2005, 1, 1))
    rec_spans = []
    cur = None
    for k in months:
        if rec.get(k) == 1 and cur is None:
            cur = k
        if rec.get(k) != 1 and cur is not None:
            rec_spans.append([f"{cur[0]}-{cur[1]:02d}", f"{k[0]}-{k[1]:02d}"])
            cur = None

    def latest(code, n=2):
        s = fred.get(code) or []
        return [ymd(s[-1][0]), r2(s[-1][1], n)] if s else None

    ffr_m = {}
    for k in months:
        mend = dt.date(k[0] + (k[1] == 12), (k[1] % 12) + 1, 1) - dt.timedelta(days=1)
        val = None
        for d0, lo, hi in [(parse_date(a), b, c2) for a, b, c2 in changes]:
            if d0 <= mend:
                val = hi
        ffr_m[k] = val

    macro = {
        "months": mlabels,
        "fedUpper": mseries(ffr_m),
        "fedChanges": changes, "fedTurns": turns,
        "cpiYoY": mseries(yoy(cpi), 1), "coreYoY": mseries(yoy(core), 1), "pceYoY": mseries(yoy(pce), 1),
        "unrate": mseries(monthly_last(fred.get("UNRATE", []), dt.date(2005, 1, 1)), 1),
        "payrolls": mseries(paych, 0),
        "gdp": gdp,
        "y10": mseries(monthly_avg(fred.get("DGS10", []), dt.date(2005, 1, 1))),
        "y2": mseries(monthly_avg(fred.get("DGS2", []), dt.date(2005, 1, 1))),
        "y3m": mseries(monthly_avg(fred.get("DGS3MO", []), dt.date(2005, 1, 1))),
        "curve": mseries(monthly_avg(fred.get("T10Y2Y", []), dt.date(2005, 1, 1))),
        "mort": mseries(monthly_avg(fred.get("MORTGAGE30US", []), dt.date(2005, 1, 1))),
        "hy": mseries(monthly_avg(fred.get("BAMLH0A0HYM2", []), dt.date(2005, 1, 1))),
        "sent": mseries(monthly_last(fred.get("UMCSENT", []), dt.date(2005, 1, 1)), 1),
        "retailYoY": mseries(yoy(rs), 1), "indproYoY": mseries(yoy(ip), 1),
        "oil": mseries(monthly_avg(fred.get("DCOILWTICO", []), dt.date(2005, 1, 1)), 1),
        "infl5y": mseries(monthly_avg(fred.get("T5YIE", []), dt.date(2005, 1, 1))),
        "claims": mseries(monthly_avg(fred.get("ICSA", []), dt.date(2005, 1, 1)), 0),
        "bill": mseries(bill_m),
        "recessions": rec_spans,
        "latest": {k: latest(k) for k in ["DFEDTARU", "DFEDTARL", "DGS10", "DGS2", "DGS3MO", "T10Y2Y", "MORTGAGE30US",
                                          "BAMLH0A0HYM2", "UNRATE", "UMCSENT", "DCOILWTICO", "T5YIE", "ICSA"]},
        "latestYoY": {
            "cpi": [f"{max(cpi)[0]}-{max(cpi)[1]:02d}", r2(yoy(cpi).get(max(cpi)), 1)],
            "core": [f"{max(core)[0]}-{max(core)[1]:02d}", r2(yoy(core).get(max(core)), 1)],
            "pce": [f"{max(pce)[0]}-{max(pce)[1]:02d}", r2(yoy(pce).get(max(pce)), 1)],
            "pay": [f"{max(paych)[0]}-{max(paych)[1]:02d}", r2(paych.get(max(paych)), 0)],
        },
    }

    # ---------- Fed turning points: how each stock did afterwards ----------
    def idx_of(datestr):
        d0 = parse_date(datestr)
        return months.index((d0.year, d0.month))

    events = []
    for tp in turns:
        if parse_date(tp["date"]) < dt.date(2005, 6, 1):
            continue
        events.append(tp)
    ev_rows = []
    for s in [{"t": "SPY", "ma": spy["madj"]}] + [{"t": x["t"], "ma": x["ma"]} for x in stocks]:
        row = {"t": s["t"], "r": []}
        for tp in events:
            i0 = idx_of(tp["date"]) - 1  # month before the move
            out = []
            for h in (3, 6, 12):
                i1 = i0 + h
                a = s["ma"][i0] if 0 <= i0 < len(months) else None
                b = s["ma"][i1] if i1 < len(months) - 0 else None
                if i1 >= len(months) or a is None or b is None:
                    out.append(None)
                else:
                    out.append(r2((b / a - 1) * 100, 1))
            row["r"].append(out)
        ev_rows.append(row)

    # ---------- market mood, computed from prices ----------
    def mk(sym):
        return next((m for m in market if m["sym"] == sym), None)

    vix, gspc = mk("^VIX"), mk("^GSPC")
    vix_d, g_d = chart("^VIX", "d"), chart("^GSPC", "d")
    vix_year = [r[1] for r in vix_d["rows"] if (last_day - r[0]).days <= 365] if vix_d else []
    g_year = [r[1] for r in g_d["rows"] if (last_day - r[0]).days <= 365] if g_d else []
    with200 = [s for s in stocks if s["px"]["ma200"] is not None]
    mood = {
        "asOf": AS_OF,
        "vix": vix["last"] if vix else None, "vixD1": vix["d1"] if vix else None,
        "vixAvg": r2(sum(vix_year) / len(vix_year)) if vix_year else None,
        "spx": gspc["last"] if gspc else None, "spxD1": gspc["d1"] if gspc else None, "spxYtd": gspc["ytd"] if gspc else None,
        "spxFromHigh": r2(pct(g_year[-1], max(g_year))) if g_year else None,
        "above200": sum(1 for s in with200 if s["px"]["last"] > s["px"]["ma200"]), "with200": len(with200),
    }

    out = {
        "asOf": AS_OF, "parts": PARTS, "groups": list(GROUPS.keys()),
        "cal": {"d": [ymd(d0) for d0 in day_cal], "w": [ymd(d0) for d0 in week_cal], "m": mlabels},
        "bench": {"SPY": {"d": spy["daily"], "w": spy["weekly"], "mc": spy["mclose"], "ma": spy["madj"]},
                  "QQQ": {"d": qqq["daily"], "w": qqq["weekly"], "mc": qqq["mclose"], "ma": qqq["madj"]}},
        "stocks": stocks, "market": market, "macro": macro, "mood": mood,
        "fedEvents": {"events": events, "rows": ev_rows},
        "notes": dict(notes.get("economy", {}), asOf=notes.get("asOf")),
    }

    # refuse to publish a half-built site
    problems = []
    if len(stocks) < 45:
        problems.append(f"only {len(stocks)} of {len(PRESETS)} stocks have prices")
    for key in ("DGS10", "DGS2", "UNRATE", "DFEDTARU", "DFEDTARL", "MORTGAGE30US", "DCOILWTICO"):
        if not macro["latest"].get(key):
            problems.append("missing economic series " + key)
    for sym in ("^GSPC", "^VIX", "^TNX", "CL=F", "QQQ"):
        if not mk(sym):
            problems.append("missing market series " + sym)
    if problems:
        sys.exit("Not publishing: " + "; ".join(problems))
    path = os.path.join(site_dir, "data", "site_data.json")
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    with open(os.path.join(site_dir, "data", "pe_check.json"), "w") as fh:
        json.dump(pe_debug, fh, indent=1)
    print("wrote", path, os.path.getsize(path) // 1024, "KB;", len(stocks), "stocks")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
