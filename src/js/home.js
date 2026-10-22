/* ============================================================
   Home: your stocks, the market, the big picture, what's next
   ============================================================ */
function avg(xs) { const v = xs.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function mkt(sym) { return D.market.find(m => m.sym === sym); }

/* ---------- written context, dated; flagged once it is over six weeks old ---------- */
const NOTES = D.notes || {};
const noteAge = () => NOTES.asOf ? Math.round((Date.parse(AS_OF) - Date.parse(NOTES.asOf)) / 864e5) : 999;
const noteFresh = () => noteAge() <= 45;
function dated(text) {
  if (!text) return null;
  return el("span", null, text, " ", el("span", { class: "muted small" }, "(context as of " + dLabel(NOTES.asOf) + (noteFresh() ? "" : "; may be out of date") + ")"));
}

/* ---------- economy facts computed from the data ---------- */
function econFacts() {
  const M = D.macro, L = M.latest, Y = M.latestYoY;
  const ch = M.fedChanges, last = ch[ch.length - 1], prev = ch[ch.length - 2];
  const step = last && prev ? last[2] - prev[2] : 0;
  const sinceMove = last ? Math.round((Date.parse(AS_OF) - Date.parse(last[0])) / 864e5) : 9999;
  const ci = lastIdx(M.cpiYoY);
  const ui = lastIdx(M.unrate);
  const oil = mkt("CL=F");
  // compare inflation with the low (or high) of the three months before it, so a fresh turn shows up
  const prior = [ci - 3, ci - 2, ci - 1].filter(i => isNum(M.cpiYoY[i]));
  const lowI = prior.reduce((a, i) => M.cpiYoY[i] < M.cpiYoY[a] ? i : a, prior[0]);
  const highI = prior.reduce((a, i) => M.cpiYoY[i] > M.cpiYoY[a] ? i : a, prior[0]);
  const cpiNow = M.cpiYoY[ci], cpiLast = M.cpiYoY[ci - 1];
  const cpiTrend = cpiNow - M.cpiYoY[lowI] >= 0.3 && cpiNow > cpiLast ? "up" : cpiNow - M.cpiYoY[highI] <= -0.3 && cpiNow < cpiLast ? "down" : "flat";
  const cpiRef = cpiTrend === "down" ? highI : cpiTrend === "up" ? lowI : ci - 1;
  return {
    lo: L.DFEDTARL[1], hi: L.DFEDTARU[1], lastMove: last ? last[0] : null, step, sinceMove,
    fedMode: sinceMove > 240 ? "hold" : step > 0 ? "hike" : "cut",
    cpi: cpiNow, cpiTrend, cpiRef: M.cpiYoY[cpiRef], cpiRefMonth: M.months[cpiRef], cpiMonth: M.months[ci], core: Y.core[1],
    pay: Y.pay[1], payMonth: Y.pay[0], unrate: M.unrate[ui], unratePrev: M.unrate[ui - 12],
    oil: oil ? oil.last : L.DCOILWTICO[1], oilYtd: oil ? oil.ytd : null,
    y10: L.DGS10[1], mort: L.MORTGAGE30US[1]
  };
}

function holdingsPicker(onDone) {
  const box = el("div", { class: "stack" });
  const chips = el("div", { class: "row", style: "gap:6px" });
  const draw = () => chips.replaceChildren(...STOCKS.map(s => el("button", {
    type: "button", class: "pill " + (isMine(s.t) ? "info" : "na"), "aria-pressed": String(isMine(s.t)), title: s.n,
    style: "cursor:pointer;font-family:var(--mono);font-size:12.5px",
    onclick: () => { setMine(s.t, !isMine(s.t)); draw(); refreshTape(); }
  }, isMine(s.t) ? "✓ " : "", s.t)));
  draw();
  box.append(chips, el("div", { class: "row" },
    el("button", { class: "btn", type: "button", onclick: onDone }, "Done"),
    el("span", { class: "note" }, "Tap the tickers you own. Saved only in this browser; nobody else can see them.")));
  return box;
}

RENDER.home = function (root) {
  const rerender = () => { root.replaceChildren(); RENDER.home(root); };
  const spx = mkt("^GSPC") || mkt("SPY");
  const my = mine();
  const pd1 = avg(my.map(s => s.px.d1)), pytd = avg(my.map(s => s.px.ytd));
  const beat = isNum(pytd) && spx && isNum(spx.ytd) ? pytd - spx.ytd : null;
  const lede = my.length
    ? cap(myLabel()) + (pd1 >= 0 ? " rose " : " fell ") + Math.abs(pd1).toFixed(1) + "% today on average. Held in equal amounts, " + (my.length === 1 ? "it is " : "they are ") + spct(pytd) + " this year vs. " + spct(spx && spx.ytd) + " for the S&P 500" + (isNum(beat) ? (beat >= 0 ? ", ahead by " : ", behind by ") + Math.abs(beat).toFixed(1) + " points." : ".")
    : "Prices, verdicts and signals for 50 researched stocks, " + (WEB ? "updated every weekday after the US market closes." : "as of the latest close.");
  root.append(el("div", { class: "page-head" },
    el("div", null,
      el("div", { class: "eyebrow" }, "Market close · " + dLabel(AS_OF)),
      el("h1", null, my.length ? "Your stocks today" : "The market today"),
      el("p", null, lede)),
    link("stocks", { class: "btn ghost" }, "See all 50 stocks")));

  // market tiles
  const m = D.mood;
  const tile = (lbl, val, delta, deltaTxt, spark, color, title) => el("div", { class: "tile", title: title || null },
    el("span", { class: "lbl" }, lbl), el("span", { class: "val" }, val),
    el("span", { class: "delta " + cls(delta) }, deltaTxt), spark ? sparkline(spark, color || "var(--s1)", 34) : null);
  const tnx = mkt("^TNX"), oil = mkt("CL=F"), vix = mkt("^VIX"), qqq = mkt("QQQ");
  const tnxMove = tnx.last - tnx.last / (1 + tnx.d1 / 100); // change in percentage points
  const breadth = tile("Stocks in uptrends", m.above200 + " of " + m.with200, m.above200 / m.with200 * 100 - 50, "of these 50 are above their 200-day average");
  breadth.append(el("div", { class: "meter", role: "img", "aria-label": m.above200 + " of " + m.with200 + " above their 200-day average" }, el("b", { style: "left:" + (m.above200 / m.with200 * 100).toFixed(0) + "%" })));
  root.append(el("div", { class: "tiles" },
    tile("S&P 500", spx.last.toLocaleString("en-US", { maximumFractionDigits: 2 }), spx.d1, spct(spx.d1, 2) + " today · " + spct(spx.ytd) + " this year", spx.d, "var(--s1)"),
    tile("Nasdaq 100 (QQQ)", money(qqq.last), qqq.d1, spct(qqq.d1, 2) + " today · " + spct(qqq.ytd) + " this year", qqq.d, "var(--s1)"),
    tile("10-year Treasury yield", tnx.last.toFixed(2) + "%", -tnxMove, (tnxMove <= 0 ? "Down " : "Up ") + Math.abs(tnxMove).toFixed(2) + " pts today · " + (tnx.last / (1 + tnx.ytd / 100)).toFixed(2) + "% in January", tnx.d, "var(--s2)"),
    tile("Oil (WTI)", money(oil.last), oil.d1, spct(oil.d1) + " today · " + spct(oil.ytd, 0) + " this year", oil.d, "var(--s2)"),
    tile("Fear gauge (VIX)", vix.last.toFixed(2), -vix.d1, (vix.last < 15 ? "Calm" : vix.last < 22 ? "Normal worry" : vix.last < 30 ? "Nervous" : "Panic") + " · year average " + (isNum(m.vixAvg) ? m.vixAvg.toFixed(1) : "—"), vix.d, "var(--s7)"),
    breadth));

  // your stocks
  if (!my.length) {
    root.append(panel("Your stocks", "Optional", el("p", { class: "lede" }, "Pick the stocks you own and they'll appear here with their price, verdict and signals, and you can filter and backtest them across the site."),
      holdingsPicker(rerender)));
  } else {
    const hold = el("div", { class: "hold-grid" });
    my.forEach(s => {
      const p = curPrice(s), k = fairModel(s, p), z = zone(k), sg = sigCount(signals(s, p)), sc = score(s);
      hold.append(link("stock-" + s.t, { class: "hold", "aria-label": s.n + ", open its page" },
        el("div", { class: "top-line" }, el("span", { class: "tk" }, s.t), el("span", { class: "delta " + cls(s.px.d1) }, spct(s.px.d1, 2))),
        el("div", { class: "nm" }, s.n),
        el("div", { class: "top-line" }, el("span", { class: "px" }, moneyAuto(p)), el("span", { class: "small " + cls(s.px.y1) }, spct(s.px.y1, 0) + " 1 yr")),
        sparkline(s.d.slice(-252), s.px.y1 >= 0 ? "var(--good)" : "var(--bad)", 40),
        el("div", { class: "row" }, el("span", { class: "pill " + z.cls }, z.call), el("span", { class: "pill " + gradeCls(sc) }, sc + "/100")),
        el("div", { class: "small muted" }, sg.good + " good · " + sg.warn + " mixed · " + sg.bad + " warning signals")));
    });
    const editBox = el("div", { hidden: true });
    const editBtn = el("button", { class: "btn ghost", type: "button", onclick: () => { editBox.hidden = false; editBtn.hidden = true; editBox.replaceChildren(holdingsPicker(rerender)); } }, "Edit my stocks");
    root.append(panel("Your stocks", "Saved only in this browser", hold, el("div", null, editBtn), editBox));
  }

  // big picture (economy), computed from the latest data
  const F = econFacts(), E = NOTES || {};
  const bp = (k, h, ...p) => el("div", { class: "bp" }, el("span", { class: "k" }, k), el("h3", null, h), el("p", null, ...p));
  const fedTitle = F.fedMode === "hold" ? "The Fed is on hold" : F.fedMode === "hike" ? "The Fed is raising rates, not cutting" : "The Fed is cutting rates";
  const fedText = noteFresh() && E.fed ? dated(E.fed) : "Its last move was a " + Math.abs(F.step).toFixed(2) + "-point " + (F.step > 0 ? "hike" : "cut") + " on " + dLabel(F.lastMove) + ".";
  const fedWhy = F.fedMode === "cut" ? " Lower rates usually help growth stocks and housing." : " Higher rates usually weigh on expensive growth stocks and on housing.";
  const cpiDir = F.cpiTrend === "up" ? "Inflation is climbing again" : F.cpiTrend === "down" ? "Inflation is cooling" : "Inflation is steady";
  const oilTitle = F.oil >= 90 ? "Oil is expensive" : F.oil >= 60 ? "Oil prices are moderate" : "Oil is cheap";
  const jobsTitle = F.pay < 50 ? "Hiring nearly stalled" : F.pay < 150 ? "Hiring is slowing" : "Hiring is solid";
  root.append(panel("The big picture", null,
    el("div", { class: "big-picture" },
      bp(F.lo.toFixed(2) + "–" + F.hi.toFixed(2) + "%", fedTitle, fedText, fedWhy),
      bp(F.cpi.toFixed(1) + "%", cpiDir, "Prices rose " + F.cpi.toFixed(1) + "% in the year to " + dLabel(F.cpiMonth, "my") + ", " + (F.cpi > F.cpiRef ? "up from " : F.cpi < F.cpiRef ? "down from " : "the same as ") + F.cpiRef.toFixed(1) + "% in " + dLabel(F.cpiRefMonth, "my") + ". Core inflation, which leaves out food and energy, is " + F.core + "%." + (F.cpi - F.core > 0.7 ? " Energy is doing most of the damage." : "")),
      bp(money0(F.oil), oilTitle, noteFresh() && E.oil ? dated(E.oil) : "", " Oil is " + spct(F.oilYtd, 0) + " this year. Producers like Exxon gain when it's high; companies whose customers drive and fly feel the squeeze."),
      bp((F.pay >= 0 ? "+" : "") + F.pay + "K", jobsTitle, "Employers added " + F.pay + "K jobs in " + dLabel(F.payMonth, "my") + ", and unemployment is " + F.unrate + "% (" + F.unratePrev + "% a year earlier)." + (F.pay < 75 && F.fedMode === "hike" ? " A weak job market is what could eventually make the Fed stop raising rates." : ""))),
    el("div", null, link("economy", { class: "btn ghost" }, "Open the Economy page"))));

  // coming up: earnings in the next 45 days
  const up = STOCKS.filter(s => s.ed && daysUntil(s.ed.date) >= 0 && daysUntil(s.ed.date) <= 45).sort((a, b) => a.ed.date.localeCompare(b.ed.date));
  const tbl = el("table", { class: "list" },
    el("thead", null, el("tr", null, el("th", null, "Date"), el("th", null, "Company"), el("th", null, "When"), el("th", { class: "n" }, "EPS forecast"), el("th", { class: "n" }, "Year ago"))),
    el("tbody", null, up.map(s => el("tr", { class: isMine(s.t) ? "mine" : null, onclick: () => goStock(s.t), tabindex: 0, onkeydown: e => { if (e.key === "Enter") goStock(s.t); } },
      el("td", null, dLabel(s.ed.date, "md"), el("span", { class: "muted small" }, daysUntil(s.ed.date) === 0 ? " · today" : " · in " + daysUntil(s.ed.date) + (daysUntil(s.ed.date) === 1 ? " day" : " days"))),
      el("td", { class: "tick-name" }, el("b", null, s.t), el("span", null, s.n), isMine(s.t) ? " " : null, isMine(s.t) ? el("span", { class: "tag-own" }, "Mine") : null),
      el("td", { class: "small" }, (s.ed.when || "time not set") + (s.ed.estimated ? " (estimated date)" : "")),
      el("td", { class: "n" }, money(s.ed.epsEst)), el("td", { class: "n" }, money(s.ed.epsYearAgo))))));
  root.append(panel("Earnings coming up", "Next 45 days · " + up.length + " companies", up.length ? el("div", { class: "tablewrap" }, tbl) : el("p", { class: "note" }, "No earnings reports from these 50 in the next 45 days."),
    what("Prices often jump or drop on earnings day. The forecast is Wall Street's average guess for the quarter's earnings per share; beating it usually helps the stock.")));

  // idea lists
  const rows = STOCKS.map(s => {
    const p = curPrice(s), k = fairModel(s, p), pp = pePlain(s, p);
    return { s, p, sc: score(s), gap: isNum(k.fair) ? (k.fair / p - 1) * 100 : null, peRel: pp && s.pe.s5 ? pp.pe / s.pe.s5.med : null, pe: pp ? pp.pe : null };
  });
  const list = (items, val, sub) => el("div", { class: "mini-list" }, items.map(r => link("stock-" + r.s.t, null,
    el("b", null, r.s.t), el("span", null, sub ? sub(r) : r.s.n), el("em", null, val(r)))));
  const topScore = [...rows].sort((a, b) => b.sc - a.sc).slice(0, 6);
  const below = rows.filter(r => isNum(r.gap) && r.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 6);
  const cheapPe = rows.filter(r => isNum(r.peRel)).sort((a, b) => a.peRel - b.peRel).slice(0, 6);
  const insiders = rows.filter(r => r.s.oi && !FOREIGN.has(r.s.t) && r.s.oi.m12.bought > 0).sort((a, b) => b.s.oi.m12.bought - a.s.oi.m12.bought).slice(0, 6);
  root.append(el("div", { class: "grid2" },
    panel("Highest scores", "Out of 100", list(topScore, r => r.sc + "/100")),
    panel("Furthest below fair value", "By the fair-value model", list(below, r => spct(r.gap, 0) + " to fair")),
    panel("Cheapest vs. their own P/E", "Today vs. 5-year median", list(cheapPe, r => mult(r.pe) + " vs " + mult(r.s.pe.s5.med))),
    panel("Most insider buying", "Open-market purchases, 12 months", list(insiders, r => bigUsd(r.s.oi.m12.bought), r => r.s.oi.m12.buyers + " insider" + (r.s.oi.m12.buyers > 1 ? "s" : "")))));
  root.append(el("p", { class: "note" }, "These lists are starting points for research, not buy lists. A stock can look cheap because the business is in trouble; check its score and signals."));
  root.append(el("div", { class: "callout" }, el("b", null, "New to this? "), "The Learn page has a step-by-step checklist for deciding on a stock and explains every number on the site. ",
    link("learn", { class: "btn ghost", style: "margin-left:4px" }, "Open the checklist")));
};
