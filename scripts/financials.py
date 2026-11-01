"""Trailing-twelve-month financials from SEC XBRL "company facts".

ttm_financials(facts) returns the same fields the research uses for each
company (revenue, operating income, net income, EPS, free cash flow, cash,
debt, equity, all in US$ millions except EPS) for the latest period a 10-Q
or 10-K covers, plus that period's end date. Flows are trailing twelve
months: the last fiscal year, plus this year to date, minus the same part of
last year. Only US-dollar facts are used, so foreign filers reporting in
other currencies simply return nothing.
"""
import datetime as dt

TAGS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
                "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
                "RevenuesNetOfInterestExpense"],
    "opIncome": ["OperatingIncomeLoss"],
    "netIncome": ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
    "cfo": ["NetCashProvidedByUsedInOperatingActivities",
            "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
              "PaymentsForCapitalImprovements"],
}
CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]
INVEST = ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"]
DEBT_TOTAL = ["LongTermDebt", "DebtLongtermAndShorttermCombinedAmount", "DebtInstrumentCarryingAmount"]
DEBT_PARTS = ["LongTermDebtNoncurrent", "LongTermDebtCurrent", "CommercialPaper", "ShortTermBorrowings"]
EQUITY = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]
FORMS = ("10-Q", "10-K", "10-Q/A", "10-K/A", "10-KT")


def _d(s):
    return dt.date.fromisoformat(s)


def _facts(gaap, tag, unit_prefix="USD"):
    """De-duplicated facts for one tag from periodic reports: {(start, end): value}."""
    node = gaap.get(tag)
    if not node:
        return {}
    out = {}
    for unit, rows in node.get("units", {}).items():
        if not unit.startswith(unit_prefix):
            continue
        for r in rows:
            if r.get("form") in FORMS and "end" in r:
                out[(r.get("start"), r["end"])] = r["val"]
    return out


def _ttm(f, end):
    """Twelve months to `end` from duration facts f, or None."""
    e = _d(end)
    spans = {(k[0], k[1]): v for k, v in f.items() if k[0]}
    for (s, en), v in spans.items():
        if en == end and 350 <= (e - _d(s)).days <= 380:
            return v
    ytd = [(s, v) for (s, en), v in spans.items() if en == end and 80 <= (e - _d(s)).days < 350]
    if not ytd:
        return None
    s, v = min(ytd, key=lambda x: x[0])                      # longest year-to-date span
    length = (e - _d(s)).days
    prior = [pv for (ps, pe), pv in spans.items()
             if abs((e - _d(pe)).days - 365) <= 10 and abs(((_d(pe) - _d(ps)).days) - length) <= 10]
    fy = [fv for (fs, fe), fv in spans.items()
          if 350 <= (_d(fe) - _d(fs)).days <= 380 and 0 < (e - _d(fe)).days < 350 and _d(fe) <= _d(s) + dt.timedelta(days=5)]
    if not prior or not fy:
        return None
    return fy[0] + v - prior[0]


def _quarter(f, end):
    e = _d(end)
    q = [v for (s, en), v in f.items() if s and en == end and 80 <= (e - _d(s)).days <= 100]
    if q:
        return q[0]
    year = [v for (s, en), v in f.items() if s and en == end and 350 <= (e - _d(s)).days <= 380]
    nine = [v for (s, en), v in f.items() if s and 260 <= (_d(en) - _d(s)).days <= 285 and 80 <= (e - _d(en)).days <= 100]
    return year[0] - nine[0] if year and nine else None


def _latest_end(gaap):
    ends = [k[1] for k in _facts(gaap, "NetCashProvidedByUsedInOperatingActivities")] or \
           [k[1] for tag in TAGS["revenue"] for k in _facts(gaap, tag)]
    return max(ends) if ends else None


def _pick(gaap, tags, end, kind):
    for tag in tags:
        f = _facts(gaap, tag, "USD/shares" if kind == "eps" else "USD")
        v = _ttm(f, end) if kind != "instant" else f.get((None, end))
        if v is not None:
            return v, f
    return None, {}


def ttm_financials(facts, end=None):
    gaap = (facts or {}).get("facts", {}).get("us-gaap", {})
    end = end or _latest_end(gaap)
    if not end:
        return None
    m = lambda v: round(v / 1e6) if v is not None else None
    out = {"end": end}
    rev, rev_f = _pick(gaap, TAGS["revenue"], end, "flow")
    out["revenue"] = m(rev)
    q_now = _quarter(rev_f, end)
    q_then = _quarter(rev_f, (_d(end) - dt.timedelta(days=364)).isoformat()) or \
        next((_quarter(rev_f, k[1]) for k in rev_f if abs((_d(end) - _d(k[1])).days - 365) <= 7), None)
    out["qGrowth"] = round((q_now / q_then - 1) * 100, 1) if q_now and q_then and q_then > 0 else None
    for key in ("opIncome", "netIncome", "cfo", "capex"):
        out[key] = m(_pick(gaap, TAGS[key], end, "flow")[0])
    eps = _pick(gaap, TAGS["eps"], end, "eps")[0]
    out["eps"] = round(eps, 2) if eps is not None else None
    out["fcf"] = out["cfo"] - out["capex"] if out["cfo"] is not None and out["capex"] is not None else None
    out["opMargin"] = round(out["opIncome"] / out["revenue"] * 100, 1) if out["opIncome"] is not None and out["revenue"] else None
    cash = _pick(gaap, CASH, end, "instant")[0]
    inv = sum(v for v in (_pick(gaap, [t], end, "instant")[0] for t in INVEST) if v)
    out["cash"] = m((cash or 0) + inv) if cash is not None else None
    debt = _pick(gaap, DEBT_TOTAL, end, "instant")[0]
    if debt is None:
        parts = [_pick(gaap, [t], end, "instant")[0] for t in DEBT_PARTS]
        debt = sum(p for p in parts if p) if any(p is not None for p in parts) else None
    else:
        debt += sum(v for v in (_pick(gaap, [t], end, "instant")[0] for t in ("CommercialPaper", "ShortTermBorrowings")) if v)
    out["debt"] = m(debt)
    out["equity"] = m(_pick(gaap, EQUITY, end, "instant")[0])
    return out


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FIELDS = ("revenue", "opIncome", "netIncome", "eps", "fcf", "cash", "debt", "equity")


def _period_ends(gaap):
    return sorted({k[1] for tag in TAGS["revenue"] + TAGS["cfo"] for k in _facts(gaap, tag)})


def update_fin(fin, facts):
    """Roll the research's financials forward to the latest SEC filing.

    The research sometimes defines a line more broadly than the raw filing tags
    (debt including leases, cash including long-term securities, adjusted
    operating income). So each field
    is first checked against the filing for the research's own period: if they
    agree, the newest filed value is used as is; if they differ only by such a
    definition, the research value is moved by the filing's own change; anything
    else keeps the research value. Returns (fin, end date) or (fin, None).
    """
    gaap = (facts or {}).get("facts", {}).get("us-gaap", {})
    ends = _period_ends(gaap)
    period = (fin or {}).get("period") or ""
    year = next((w for w in period.replace(",", " ").split() if w.isdigit() and len(w) == 4), None)
    month = next((i for i, m in enumerate(MONTHS, 1) if f" {m}" in " " + period), None)
    old_end = None
    if year and month:                # the filing period closest to the research's month end (52/53-week years drift)
        target = dt.date(int(year), month, 28)
        near = [e for e in ends if abs((dt.date.fromisoformat(e) - target).days) <= 12]
        old_end = min(near, key=lambda e: abs((dt.date.fromisoformat(e) - target).days)) if near else None
    if not ends or not old_end or ends[-1] <= old_end:
        return fin, None
    then, now = ttm_financials(facts, old_end), ttm_financials(facts)
    if not now or not then:
        return fin, None
    new = dict(fin)
    moved, stale = 0, []
    for k in FIELDS:
        ref, a, b = fin.get(k), then.get(k), now.get(k)
        if ref is None:
            continue
        tol = 0.02 if k == "eps" else 2
        if a is not None and b is not None and abs(a - ref) <= max(abs(ref) * 0.03, tol):
            new[k] = b
            moved += 1
        elif a and b and a > 0 and b > 0 and ref > 0 and 0.5 <= b / a <= 2:
            new[k] = round(ref * b / a)
            moved += 1
        else:
            stale.append(k)
    if moved < 3 or "revenue" in stale:   # too little lines up with the filings to trust the update
        return fin, None
    if new.get("opIncome") is not None and new.get("revenue"):
        new["opMargin"] = round(new["opIncome"] / new["revenue"] * 100, 1)
    if now.get("qGrowth") is not None:
        new["qGrowth"] = now["qGrowth"]
    e = dt.date.fromisoformat(now["end"])
    new["period"] = f"TTM to {MONTHS[e.month - 1]} {e.day}, {e.year} (SEC filings)"
    new["asOf"] = now["end"]
    new["older"] = sorted(set(stale), key=FIELDS.index)   # lines still from the research's period
    return new, now["end"]
