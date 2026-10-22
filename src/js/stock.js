/* ============================================================
   Stock page: verdict, signals, chart, valuation, business,
   money flows, risks, analysts, Ask Claude, sources
   ============================================================ */
RENDER.stock = function (root, t) {
  const s = findStock(t);
  const ai = !BY.has(t);
  const refreshers = [];
  const refresh = () => { const p = curPrice(s); refreshers.forEach(f => f(p)); };
  const setPrice = (v, live) => {
    const o = ovr(s.t);
    if (isNum(v) && v > 0) { o.price = v; o.live = live || null; o.asOf = AS_OF; } else { delete o.price; delete o.live; delete o.asOf; }
    saveOvr();
    refresh();
  };

  /* ---------- header ---------- */
  const quoteBox = el("div", { class: "quote" });
  refreshers.push(p => {
    const custom = !!customPrice(s);
    quoteBox.replaceChildren(
      el("span", { class: "p" }, moneyAuto(p)),
      custom ? el("span", { class: "small muted" }, priceNote(s)) : el("span", { class: "d " + cls(s.px.d1) }, spct(s.px.d1, 2) + " today"),
      el("span", { class: "small muted" }, custom ? "Close was " + moneyAuto(s.px.last) : priceNote(s)));
  });
  root.append(el("div", { class: "stock-head" },
    el("div", { style: "min-width:0" },
      el("div", { class: "eyebrow" }, (s.g || "") + (s.sec ? " · " + s.sec : "")),
      el("h1", null, s.n, " ", el("span", { class: "tk" }, s.t)),
      el("div", { class: "row", style: "margin-top:8px" }, !ai ? ownToggle(s) : null, ai ? el("span", { class: "pill info" }, "Analyzed by Claude from its own knowledge") : null,
        ai ? el("button", { class: "btn ghost", type: "button", onclick: () => removeAi(s.t) }, "Remove from this browser") : null,
        !ai ? el("button", { class: "btn ghost", type: "button", onclick: () => { let p = (store.get("cmp", []) || []).filter(x => x !== s.t); p = [...p, s.t].slice(-4); store.set("cmp", p); go("compare"); } }, "Compare") : null,
        !ai ? el("button", { class: "btn ghost", type: "button", onclick: () => { store.set("btPick", s.t); go("backtest"); } }, "Backtest") : null),
      ai ? el("p", { class: "callout warn", style: "margin-top:10px" }, "Claude wrote this analysis from what it knew through mid-2026, not from live data. Type today's price below before you rely on the verdict.") : null,
      el("p", { class: "sum" }, s.sum || "")),
    quoteBox));

  const sections = [["verdict", "Verdict"], ["chart", "Price"], ["value", "Valuation"], ["biz", "Business"], ["fin", "Financials"], ["money", "Insiders & funds"], ["risk", "Risks & outlook"], ["analysts", "Analysts"], WEB ? null : ["ask", "Ask Claude"], ["src", "Sources"]].filter(Boolean);
  root.append(el("nav", { class: "subnav", "aria-label": "Sections of this page" }, sections.map(([id, lbl]) =>
    el("button", { type: "button", onclick: () => { const n = $("sec-" + id); if (n) n.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); } }, lbl))));

  root.append(verdictSection(s, refreshers, setPrice));
  root.append(chartSection(s, ai));
  root.append(valuationSection(s, refreshers));
  root.append(businessSection(s));
  root.append(financialsSection(s, refreshers));
  root.append(moneySection(s, ai));
  root.append(riskSection(s, refreshers));
  root.append(analystSection(s, refreshers));
  if (!WEB) root.append(askSection(s));
  root.append(sourcesSection(s, ai));
  refresh();
};

/** "Add to my stocks" toggle; the choice lives only in this browser. */
function ownToggle(s) {
  const b = el("button", { class: "btn ghost own-toggle", type: "button" });
  const draw = () => { b.textContent = isMine(s.t) ? "★ In my stocks" : "☆ Add to my stocks"; b.setAttribute("aria-pressed", String(isMine(s.t))); };
  b.addEventListener("click", () => { setMine(s.t, !isMine(s.t)); draw(); refreshTape(); });
  draw();
  return b;
}

/* ---------- 1. verdict and signals ---------- */
function verdictSection(s, refreshers, setPrice) {
  const sec = el("section", { class: "panel anchor", id: "sec-verdict" });
  const sc = score(s);
  const dialC = 2 * Math.PI * 50;
  const dial = el("div", { class: "dial", role: "img", "aria-label": "Score " + sc + " out of 100" },
    sv("svg", { viewBox: "0 0 116 116" },
      sv("circle", { cx: 58, cy: 58, r: 50, fill: "none", stroke: "var(--line)", "stroke-width": 10 }),
      sv("circle", { cx: 58, cy: 58, r: 50, fill: "none", stroke: "var(--" + gradeCls(sc) + ")", "stroke-width": 10, "stroke-linecap": "round", "stroke-dasharray": (dialC * sc / 100).toFixed(1) + " " + dialC.toFixed(1) })),
    el("div", { class: "lab" }, el("b", null, String(sc)), el("small", null, "of 100 · " + grade(sc))));
  const callBox = el("div", { style: "min-width:0;display:grid;gap:6px" });
  const input = el("input", { id: "price-in", type: "number", step: "0.01", min: "0", inputmode: "decimal", "aria-label": "Price to evaluate" });
  const liveBtn = el("button", { class: "btn ghost", type: "button", id: "live-btn", hidden: true }, "Get live price");
  const liveMsg = el("span", { class: "small muted", id: "live-msg" });
  const yp = el("div", { class: "yourprice" },
    el("label", { class: "eyebrow", for: "price-in" }, "Price to evaluate"),
    input,
    el("div", { class: "row" }, el("button", { class: "btn ghost", type: "button", onclick: () => { setPrice(null); input.value = isNum(s.px.last) ? s.px.last.toFixed(2) : ""; } }, s.ai ? "Use Claude's price" : "Use last close"), liveBtn),
    liveMsg,
    el("span", { class: "small muted" }, "Type any price to see how the verdict changes."));
  input.value = isNum(curPrice(s)) ? curPrice(s).toFixed(2) : "";
  input.addEventListener("input", () => { const v = parseFloat(input.value); setPrice(isNum(v) && v > 0 ? v : null); });
  wireLive(s, liveBtn, liveMsg, (p, when) => { input.value = p.toFixed(2); setPrice(p, when); });
  const upd = s.upd ? el("div", { class: "callout" }, el("b", null, "Latest (" + s.upd[0] + "): "), s.upd[1]) : null;
  const sigBox = el("div", { class: "stack" });
  sec.append(el("header", null, el("h2", null, "Verdict"), el("span", { class: "note" }, "Score, price zone and 8 decision signals")),
    el("div", { class: "verdict-grid" }, dial, callBox, yp), upd, sigBox);
  refreshers.push(p => {
    const k = fairModel(s, p), z = zone(k);
    const pctTo = v => isNum(v) ? (v / p - 1) * 100 : null;
    let why = "";
    if (isNum(k.fair)) {
      if (z.key === "buy") why = "The price is at or under the strong-buy line of " + moneyAuto(k.buy) + ". Fair value is " + moneyAuto(k.fair) + ", " + spct(pctTo(k.fair), 0) + " above.";
      else if (z.key === "fair") why = "The price is " + Math.abs(pctTo(k.fair)).toFixed(0) + "% under fair value (" + moneyAuto(k.fair) + "). The strong-buy line is " + moneyAuto(k.buy) + ".";
      else if (z.key === "hold") why = "Above fair value (" + moneyAuto(k.fair) + ") but under the 1-year target of " + moneyAuto(k.target) + ". The model would wait for " + moneyAuto(k.buy) + " or lower to add.";
      else why = "At or above the 1-year target of " + moneyAuto(k.target) + ", " + spct(-pctTo(k.fair), 0) + " over fair value. The model would consider taking some profit.";
    } else why = "This company has no steady earnings or cash flow for the model to value.";
    callBox.replaceChildren(el("span", { class: "eyebrow" }, "Price zone at " + moneyAuto(p)), el("span", { class: "call " + z.cls }, z.call), el("p", null, why),
      (z.key === "buy" || z.key === "fair") && score(s) < 60 ? el("div", { class: "callout warn" }, el("b", null, "Value-trap warning: "), "it looks cheap, but the business scores only " + score(s) + "/100. A low price alone is not a reason to buy.") : null);
    const list = signals(s, p), c = sigCount(list);
    sigBox.replaceChildren(
      el("div", { class: "sig-summary" }, el("h3", null, "Signals"), el("span", { class: "pill good" }, c.good + " good"), el("span", { class: "pill warn" }, c.warn + " mixed"), el("span", { class: "pill bad" }, c.bad + " warning"), c.na ? el("span", { class: "pill na" }, c.na + " not available") : null),
      el("div", { class: "signals" }, list.map(x => el("div", { class: "sig " + x.st }, iconEl(x.st), el("b", null, x.name), el("span", null, x.text)))),
      what(c.good >= 5 ? "Most checks look favorable at this price. Read the risks section before acting; signals can't see everything." :
        c.bad >= 4 ? "Several checks flash warnings at this price. That doesn't mean the stock will fall, but the odds are less in your favor than usual." :
        "The picture is mixed: some checks like the stock at this price and some don't. This is where your own view on the company matters most."));
  });
  return sec;
}

/* ---------- 2. price chart ---------- */
function rollMean(vals, n) {
  const out = new Array(vals.length).fill(null);
  let sum = 0, cnt = 0, q = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    q.push(v); if (isNum(v)) { sum += v; cnt++; }
    if (q.length > n) { const r = q.shift(); if (isNum(r)) { sum -= r; cnt--; } }
    if (q.length === n && cnt === n) out[i] = sum / n;
  }
  return out;
}
function chartSection(s, ai) {
  const sec = el("section", { class: "panel anchor", id: "sec-chart" }, el("header", null, el("h2", null, "Price"), el("span", { class: "note" }, "Closes through " + AS_OF_LABEL)));
  if (ai || !s.d) { sec.append(el("p", { class: "note" }, "No price history for companies analyzed by Claude. Type today's price in the verdict box.")); return sec; }
  let range = store.get("range", "1y"), mode = "price";
  const holder = el("div");
  const tools = el("div", { class: "chart-tools" },
    seg([["1m", "1M"], ["3m", "3M"], ["6m", "6M"], ["1y", "1Y"], ["5y", "5Y"], ["10y", "10Y"], ["max", "Max"]], range, v => { range = v; store.set("range", v); draw(); }, "Time range"),
    seg([["price", "Price"], ["vs", "vs. S&P 500"]], mode, v => { mode = v; draw(); }, "Chart mode"));
  const legend = el("div", { class: "legend" });
  const explain = el("p", { class: "note" });
  function pick() {
    const n = { "1m": 22, "3m": 64, "6m": 127, "1y": 253 }[range];
    if (n) return { labels: CAL.d.slice(-n), v: s.d.slice(-n), b: D.bench.SPY.d.slice(-n), style: "md", tip: null, ma: rollMean(s.d, 50).slice(-n), maName: "50-day average" };
    if (range === "5y") { const m = 261; return { labels: CAL.w.slice(-m), v: s.w.slice(-m), b: D.bench.SPY.w.slice(-m), style: "my", ma: rollMean(s.w, 40).slice(-m), maName: "200-day average (40 weeks)" }; }
    if (range === "10y") return { labels: CAL.w, v: s.w, b: D.bench.SPY.w, style: "y", ma: rollMean(s.w, 40), maName: "200-day average (40 weeks)" };
    const f = Math.max(0, firstIdx(s.mc));
    return { labels: CAL.m.slice(f), v: s.mc.slice(f), b: D.bench.SPY.mc.slice(f), style: "y", ma: null };
  }
  function draw() {
    const d = pick();
    const f = firstIdx(d.v);
    if (f > 0) { d.labels = d.labels.slice(f); d.v = d.v.slice(f); d.b = d.b.slice(f); if (d.ma) d.ma = d.ma.slice(f); }
    let chart;
    if (mode === "price") {
      const vals = d.v.filter(isNum), lo = Math.min(...vals), hi = Math.max(...vals);
      const k = fairModel(s, curPrice(s));
      const refs = [[k.fair, "Fair " + moneyAuto(k.fair), "var(--accent)"], [k.buy, "Buy " + moneyAuto(k.buy), "var(--good)"], [k.target, "Target " + moneyAuto(k.target), "var(--bad)"]]
        .filter(r => isNum(r[0]) && r[0] > lo * 0.8 && r[0] < hi * 1.2).map(([y, label, color]) => ({ y, label, color }));
      const series = [{ name: s.t, values: d.v, color: "var(--s1)", area: true }];
      if (d.ma) series.push({ name: d.maName, values: d.ma, color: "var(--s2)", width: 1.5, dot: false });
      chart = lineChart({ labels: d.labels, series, refs, yFmt: v => moneyAuto(v).replace(".00", ""), tipFmt: moneyAuto, xStyle: d.style, tipStyle: d.style === "md" ? null : "my", ariaLabel: s.n + " price chart" });
      legend.replaceChildren(el("span", null, el("i", { class: "line", style: "--c:var(--s1)" }), s.t + " price"), d.ma ? el("span", null, el("i", { class: "line", style: "--c:var(--s2)" }), d.maName) : null,
        refs.length ? el("span", null, el("i", { class: "line", style: "--c:var(--accent)" }), "Fair-value model lines") : null);
      const off = [[k.fair, "fair value"], [k.buy, "strong-buy line"], [k.target, "1-year target"]].filter(r => isNum(r[0]) && !(r[0] > lo * 0.8 && r[0] < hi * 1.2));
      explain.textContent = off.length ? "Off the chart: " + off.map(r => r[1] + " " + moneyAuto(r[0])).join(", ") + "." : "";
    } else {
      const b0 = d.b[firstIdx(d.b)], v0 = d.v[firstIdx(d.v)];
      const nv = d.v.map(v => isNum(v) ? (v / v0 - 1) * 100 : null), nb = d.b.map(v => isNum(v) ? (v / b0 - 1) * 100 : null);
      chart = lineChart({ labels: d.labels, series: [{ name: s.t, values: nv, color: "var(--s1)" }, { name: "S&P 500 (SPY)", values: nb, color: "var(--s2)" }], zero: true, yFmt: v => spct(v, 0), tipFmt: v => spct(v, 1), xStyle: d.style, tipStyle: d.style === "md" ? null : "my", ariaLabel: s.n + " vs S&P 500" });
      legend.replaceChildren(el("span", null, el("i", { class: "line", style: "--c:var(--s1)" }), s.t), el("span", null, el("i", { class: "line", style: "--c:var(--s2)" }), "S&P 500 (SPY)"));
      const lv = nv[lastIdx(nv)], lb = nb[lastIdx(nb)];
      explain.textContent = s.t + " " + spct(lv, 1) + " vs. the S&P 500 " + spct(lb, 1) + " over this period (price only, dividends not included).";
    }
    holder.replaceChildren(chart);
  }
  draw();
  const p = s.px;
  const st = (lbl, v, c) => el("div", { class: "stat" }, el("span", null, lbl), el("b", { class: c || "" }, v));
  const fromHigh = isNum(p.hi52) ? (p.last / p.hi52 - 1) * 100 : null;
  const monthly = [];
  for (let i = CAL.m.length - 1, n = 0; i >= 0 && n < 36; i--, n++) if (isNum(s.mc[i])) monthly.push([dLabel(CAL.m[i], "my"), moneyAuto(s.mc[i])]);
  const sum = [];
  if (isNum(fromHigh)) sum.push(s.t + " is " + Math.abs(fromHigh).toFixed(0) + "% below its 52-week high" + (fromHigh > -3 ? " (near the top of its range)" : "") + ".");
  if (isNum(p.ma200)) sum.push(p.last > p.ma200 ? "It trades above its 200-day average, which traders read as an uptrend." : "It trades below its 200-day average, which traders read as a downtrend.");
  if (isNum(p.vol)) sum.push("It typically moves about " + (p.vol / Math.sqrt(12)).toFixed(0) + "% in a month (yearly volatility " + p.vol.toFixed(0) + "%, vs. about 15% for the S&P 500).");
  sec.append(tools, holder, legend, explain,
    el("div", { class: "stats-row" },
      st("1 month", spct(p.m1), cls(p.m1)), st("3 months", spct(p.m3), cls(p.m3)), st("6 months", spct(p.m6), cls(p.m6)), st("This year", spct(p.ytd), cls(p.ytd)), st("1 year", spct(p.y1), cls(p.y1)),
      st("3 yrs, per year", spct(p.tr3), cls(p.tr3)), st("5 yrs, per year", spct(p.tr5), cls(p.tr5)), st("10 yrs, per year", spct(p.tr10), cls(p.tr10)),
      st("52-week range", moneyAuto(p.lo52) + "–" + moneyAuto(p.hi52)), st("Worst drop, 5 yrs", spct(p.mdd5, 0), "down"), st("Beta vs. market", isNum(s.risk.beta) ? s.risk.beta.toFixed(2) : "—")),
    what(sum.join(" ")),
    el("p", { class: "note" }, "Multi-year returns include dividends. Beta above 1 means the stock tends to swing more than the market; " + (isNum(s.risk.beta) ? s.t + "'s " + s.risk.beta.toFixed(2) + " means a 10% market move has come with about a " + (s.risk.beta * 10).toFixed(0) + "% move here." : "")),
    dataTable(["Month end", "Close"], monthly));
  return sec;
}

/* ---------- 3. valuation ---------- */
function valuationSection(s, refreshers) {
  const sec = el("section", { class: "panel anchor", id: "sec-value" }, el("header", null, el("h2", null, "Valuation"), el("span", { class: "note" }, "Is the price cheap or expensive? Six ways to look at it")));
  const ff = el("div");
  sec.append(el("h3", null, "Every method on one chart"), ff);
  refreshers.push(p => ff.replaceChildren(footballField(s, p)));
  sec.append(peHistory(s, refreshers));
  sec.append(dcfBlock(s, refreshers));
  sec.append(modelBlock(s, refreshers));
  sec.append(multiplesBlock(s, refreshers));
  return sec;
}

function footballField(s, price) {
  const rows = [];
  if (isNum(s.px.lo52) && isNum(s.px.hi52)) rows.push(["52-week trading range", s.px.lo52, s.px.hi52, null, "Lowest to highest close in the past year"]);
  if (s.tg && s.tg.c && isNum(s.tg.c.lo)) rows.push(["Analyst targets", s.tg.c.lo, s.tg.c.hi, s.tg.c.avg, (s.tg.c.n || "") + " analysts; the dot is the average"]);
  const k = fairModel(s, price);
  if (isNum(k.fair)) rows.push(["Fair-value model", Math.min(k.buy, k.target), Math.max(k.buy, k.target), k.fair, "Strong-buy line to 1-year target; the dot is fair value"]);
  const dp = dcfParams(s), base = dcfValue(dp);
  if (base && dp.cf0 > 0) {
    const a = dcfValue(Object.assign({}, dp, { g1: dp.g1 - 5, r: dp.r + 1 })), b = dcfValue(Object.assign({}, dp, { g1: dp.g1 + 5, r: Math.max(dp.tg + 1, dp.r - 1) }));
    rows.push(["Cash-flow value (DCF)", a.perShare, b.perShare, base.perShare, "Growth ±5 points and discount rate ±1 point; the dot is your inputs"]);
  }
  if (s.pe && s.pe.s5 && isNum(s.pe.ttm) && s.pe.ttm > 0 && peNow(s, price)) rows.push(["Its usual P/E", s.pe.ttm * s.pe.s5.p25, s.pe.ttm * s.pe.s5.p75, s.pe.ttm * s.pe.s5.med, "Today's earnings × its normal P/E range (middle half of 5 years)"]);
  if (s.scen && s.scen.bear && isNum(s.scen.bear[0])) rows.push(["Bear to bull case", s.scen.bear[0], s.scen.bull[0], s.scen.base[0], "12–24 month scenarios; the dot is the base case"]);
  if (!rows.length) return el("p", { class: "note" }, "Not enough data to compare valuation methods.");
  let lo = Math.min(price, ...rows.map(r => r[1])), hi = Math.max(price, ...rows.map(r => r[2]));
  lo = Math.max(lo, price * 0.2); hi = Math.min(hi, price * 3.5);
  const pad = (hi - lo) * 0.06; lo = Math.max(0, lo - pad); hi += pad;
  const X = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const box = el("div", { class: "ff", role: "img", "aria-label": "Valuation range chart. Price " + moneyAuto(price) + ". " + rows.map(r => r[0] + " " + moneyAuto(r[1]) + " to " + moneyAuto(r[2])).join("; ") });
  rows.forEach(([name, a, b, mid, note]) => {
    const above = isNum(mid) ? mid > price : (a + b) / 2 > price;
    box.append(el("div", { class: "ff-row" },
      el("div", { class: "ff-name" }, el("b", null, name), el("small", null, note)),
      el("div", { class: "ff-track" },
        el("i", { class: "ff-bar", style: `left:${X(a)}%;width:${Math.max(0.8, X(b) - X(a))}%;--c:${above ? "var(--good)" : "var(--bad)"}` }),
        isNum(mid) ? el("b", { class: "ff-dot", style: `left:${X(mid)}%` }) : null,
        el("span", { class: "ff-price", style: `left:${X(price)}%` }),
        el("span", { class: "ff-lab" }, moneyAuto(a) + " to " + moneyAuto(b) + (isNum(mid) ? " · middle " + moneyAuto(mid) : "")))));
  });
  const ticks = niceTicks(lo, hi, 5).filter(v => v >= lo && v <= hi);
  box.append(el("div", { class: "ff-row ff-axisrow" }, el("div"), el("div", { class: "ff-axis" }, ticks.map(v => el("span", { style: `left:${X(v)}%` }, moneyAuto(v).replace(".00", ""))),
    el("span", { class: "ff-now", style: `left:${X(price)}%;transform:translateX(${edgeShift(X(price))})` }, "Price " + moneyAuto(price)))));
  const n = rows.length, over = rows.filter(r => (isNum(r[3]) ? r[3] : (r[1] + r[2]) / 2) > price).length;
  return el("div", { class: "stack" }, box,
    el("div", { class: "legend" }, el("span", null, el("i", { style: "--c:var(--good)" }), "Range mostly above today's price"), el("span", null, el("i", { style: "--c:var(--bad)" }), "Range mostly below"), el("span", null, el("i", { class: "line", style: "--c:var(--ink)" }), "Today's price")),
    what(over + " of " + n + " methods put the middle of their range above " + moneyAuto(price) + ". " + (over >= Math.ceil(n * 0.66) ? "Most ways of valuing the stock say it's priced below what it's worth." : over <= Math.floor(n * 0.34) ? "Most methods say the price is already above what the stock is worth today." : "The methods disagree, which is normal: it depends on how much growth you believe in.")));
}

function peHistory(s, refreshers) {
  const box = el("div", { class: "stack" }, el("h3", null, "P/E over time"));
  const pe = s.pe;
  if (!pe || !pe.m || !pe.m.some(isNum)) {
    box.append(el("p", { class: "note" }, s.ai ? "No P/E history for companies analyzed by Claude." : s.t === "BRK.B" ? "Berkshire's reported earnings swing with gains on the stocks it owns, so P/E history isn't meaningful. It is valued on book value instead." : "No P/E history: this company has had losses or tiny earnings for most of the period, so the P/E isn't meaningful."));
    return box;
  }
  const start = Math.max(firstIdx(pe.m), CAL.m.length - 120);
  const labels = CAL.m.slice(start), vals = pe.m.slice(start);
  const s5 = pe.s5;
  const n5 = 60, bandLo = labels.map((_, i) => s5 && i >= labels.length - n5 ? s5.p25 : null), bandHi = labels.map((_, i) => s5 && i >= labels.length - n5 ? s5.p75 : null);
  const chart = lineChart({ labels, series: [{ name: "P/E", values: vals, color: "var(--s7)" }], band: s5 ? { lo: bandLo, hi: bandHi, color: "var(--wash)" } : null,
    refs: s5 ? [{ y: s5.med, label: "5-yr median " + mult(s5.med), color: "var(--s2)" }] : [], yFmt: v => v.toFixed(0) + "×", tipFmt: v => v.toFixed(1) + "×", xStyle: "y", tipStyle: "my", ariaLabel: s.n + " price to earnings ratio over time", padR: 110 });
  const txt = el("div");
  box.append(chart, el("div", { class: "legend" }, el("span", null, el("i", { class: "line", style: "--c:var(--s7)" }), "P/E at each month end"), s5 ? el("span", null, el("i", { style: "--c:var(--wash);border:1px solid var(--s1)" }), "Normal range (middle half of the last 5 years)") : null), txt);
  refreshers.push(p => {
    const now = peNow(s, p);
    const parts = [];
    if (now && s5) {
      const vals5 = pe.m.slice(-60).filter(isNum);
      const cheaper = vals5.filter(v => v > now).length / vals5.length * 100;
      const rank = cheaper >= 99 ? "That's the lowest P/E of the last 5 years. " : cheaper <= 1 ? "That's the highest P/E of the last 5 years. " : "It's lower than in " + cheaper.toFixed(0) + "% of the months in the last 5 years. ";
      parts.push("At " + moneyAuto(p), " the stock trades at ", el("b", null, mult(now)), " the last 12 months of earnings (" + money(pe.ttm) + " a share). Its 5-year median is " + mult(s5.med) + " and its normal range is " + mult(s5.p25) + " to " + mult(s5.p75) + ". " + rank);
      parts.push(now < s5.p25 ? "That's cheap by its own history. Check whether earnings are about to fall, which is the usual reason." : now > s5.p75 ? "That's expensive by its own history: investors expect faster growth than before." : "That's within its normal range.");
    } else if (now) parts.push("Today's P/E is " + mult(now) + "; there isn't 5 years of history to compare yet.");
    else parts.push("Earnings over the last 12 months are negative or tiny, so today's P/E isn't meaningful.");
    const oneOff = /one-time|inflated|gains on|tariff refund|includes/i.test(s.val.note || "");
    txt.replaceChildren(what(el("span", null, ...parts)),
      oneOff ? el("p", { class: "note" }, "Heads-up: " + s.val.note) : null,
      el("p", { class: "note" }, "Source: " + (pe.src || "reported earnings") + ". P/E = month-end price ÷ the earnings per share reported over the previous 12 months."));
  });
  return box;
}

function rangeField(id, label, value, min, max, step, fmt, help, onInput) {
  const out = el("b", null, fmt(value));
  const r = el("input", { id, type: "range", min, max, step, value });
  r.addEventListener("input", () => { out.textContent = fmt(+r.value); onInput(+r.value); });
  return { node: el("label", { class: "field", for: id }, el("span", { class: "lbl" }, el("span", null, label), out), r, help ? el("small", null, help) : null), set: v => { r.value = v; out.textContent = fmt(v); } };
}

function dcfBlock(s, refreshers) {
  const box = el("div", { class: "stack" }, el("h3", null, "DCF calculator: what are the future cash flows worth today?"));
  const base = s.dcf || {};
  const opts = cfOptions(s);
  if (!opts.length || !isNum(base.cf0) || !isNum(s.sh)) {
    box.append(el("p", { class: "note" }, "A DCF needs steady positive cash flow to start from. " + s.n + "'s cash flow and earnings are negative or tiny next to its price, so this method would be guesswork; use the scenarios and analyst targets instead."));
    return box;
  }
  const o = () => (ovr(s.t).dcf = ovr(s.t).dcf || {});
  const p = dcfParams(s);
  const out = el("div", { class: "dcf-out" });
  const upd = () => { saveOvr(); refreshers.forEach(f => f(curPrice(s))); };
  const basisText = key => ({
    avg: "Average of last year's free cash flow (" + big(base.fcf) + ") and next year's expected earnings (" + big(base.earn) + "). This smooths out heavy-investment years and one-time items.",
    fcf: "Free cash flow over the last 12 months: the cash left after running the business and paying for new equipment and buildings.",
    earn: s.t === "JPM" ? "Earnings over the last 12 months; banks have no normal free cash flow." : "Wall Street's expected earnings for the next 12 months (EPS estimate × shares).",
    est: "Claude's estimate from what it knew.",
    custom: "Your own number."
  })[key] || "";
  const basisNote = el("small", null, basisText(p.key));
  const cfIn = el("input", { id: "dcf-cf", type: "number", step: "0.1", value: (p.cf0 / 1000).toFixed(2) });
  const basisSeg = seg(opts.map(x => [x[0], x[1]]).concat([["custom", "Custom"]]), p.key, v => {
    if (v === "custom") { o().key = "custom"; o().cf0 = (parseFloat(cfIn.value) || 0) * 1000; }
    else { o().key = v; delete o().cf0; const hit = opts.find(x => x[0] === v); if (hit) cfIn.value = (hit[2] / 1000).toFixed(2); }
    basisNote.textContent = basisText(v); upd();
  }, "Starting cash flow");
  const pressBasis = key => basisSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === key)));
  cfIn.addEventListener("input", () => { const v = parseFloat(cfIn.value); if (isNum(v)) { o().key = "custom"; o().cf0 = v * 1000; pressBasis("custom"); basisNote.textContent = basisText("custom"); upd(); } });
  const ncIn = el("input", { id: "dcf-nc", type: "number", step: "0.1", value: ((p.netCash || 0) / 1000).toFixed(2) });
  ncIn.addEventListener("input", () => { const v = parseFloat(ncIn.value); if (isNum(v)) { o().netCash = v * 1000; upd(); } });
  const g = rangeField("dcf-g", "Growth per year, years 1–5", p.g1, -10, 50, 0.5, v => v.toFixed(1) + "%", "Default is the research estimate for the next year, capped at 30%. Few companies grow faster than that for 5 years.", v => { o().g1 = v; upd(); });
  const tg = rangeField("dcf-tg", "Long-run growth after year 10", p.tg, 0, 4, 0.25, v => v.toFixed(2) + "%", "Roughly the economy's growth plus inflation. Keep it at 4% or less.", v => { o().tg = v; upd(); });
  const rHelp = isNum(base.rf) ? "Default " + base.r + "% = 10-year Treasury yield (" + base.rf.toFixed(2) + "%) + " + base.betaAdj.toFixed(2) + " (risk vs. the market) × 4%. Kept between 8% and 12.5%. Higher rate, lower value." : "Higher rate means a riskier stock and a lower value.";
  const r = rangeField("dcf-r", "Discount rate (your required return)", p.r, 6, 16, 0.25, v => v.toFixed(2) + "%", rHelp, v => { o().r = v; upd(); });
  const reset = el("button", { class: "btn ghost", type: "button", onclick: () => { delete ovr(s.t).dcf; saveOvr(); const q = dcfParams(s); cfIn.value = (q.cf0 / 1000).toFixed(2); ncIn.value = ((q.netCash || 0) / 1000).toFixed(2); pressBasis(q.key); basisNote.textContent = basisText(q.key); g.set(q.g1); tg.set(q.tg); r.set(q.r); refreshers.forEach(f => f(curPrice(s))); } }, "Reset to defaults");
  box.append(el("div", { class: "dcf" },
    el("div", { class: "dcf-inputs" },
      el("div", { class: "field" }, el("span", { class: "lbl" }, el("span", null, "Start from")), basisSeg),
      el("label", { class: "field", for: "dcf-cf" }, el("span", { class: "lbl" }, el("span", null, "Starting cash flow ($ billions a year)")), cfIn, basisNote),
      g.node, tg.node, r.node,
      el("label", { class: "field", for: "dcf-nc" }, el("span", { class: "lbl" }, el("span", null, "Net cash ($ billions; negative = net debt)")), ncIn, el("small", null, s.t === "JPM" || s.t === "BRK.B" ? "Set to 0: for a bank or insurer, cash and debt are part of the business." : "Cash and investments minus debt, added to the value.")),
      el("span", { class: "small muted" }, "Shares outstanding: " + (s.sh >= 1000 ? (s.sh / 1000).toFixed(2) + " billion" : s.sh.toFixed(0) + " million")), reset),
    out));
  refreshers.push(price => {
    const q = dcfParams(s), v = dcfValue(q);
    if (!v) { out.replaceChildren(el("p", { class: "callout warn" }, "The discount rate must be higher than long-run growth.")); return; }
    const up = (v.perShare / price - 1) * 100;
    const ig = impliedGrowth(q, price);
    const igText = ig.below ? "The price is below what even 30% yearly shrinkage would justify." : ig.above ? "The price needs more than 120% growth a year, which almost no company delivers." :
      "To justify " + moneyAuto(price) + ", cash flow would need to grow about " + ig.g.toFixed(1) + "% a year for 5 years (with these other inputs).";
    const gs = [-10, -5, 0, 5, 10], rs = [-2, -1, 0, 1, 2];
    const sens = el("table", { class: "sens" },
      el("thead", null, el("tr", null, el("th", null, "Growth ↓ / Rate →"), rs.map(d => el("th", null, (q.r + d).toFixed(1) + "%")))),
      el("tbody", null, gs.map(dg => el("tr", null, el("th", null, (q.g1 + dg).toFixed(1) + "%"), rs.map(dr => {
        const x = dcfValue(Object.assign({}, q, { g1: q.g1 + dg, r: q.r + dr }));
        if (!x) return el("td", null, "—");
        const u = (x.perShare / price - 1) * 100, a = Math.min(1, Math.abs(u) / 60);
        return el("td", { class: dg === 0 && dr === 0 ? "me" : null, style: `background:color-mix(in srgb, var(--${u >= 0 ? "good" : "bad"}) ${(a * 38).toFixed(0)}%, var(--card))` }, moneyAuto(x.perShare));
      })))));
    out.replaceChildren(
      el("div", { class: "dcf-big" }, el("div", null, el("div", { class: "eyebrow" }, "Value per share"), el("div", { class: "v" }, moneyAuto(v.perShare))),
        el("div", null, el("div", { class: "eyebrow" }, "vs. price " + moneyAuto(price)), el("div", { class: "v " + cls(up), style: "font-size:30px" }, spct(up, 0)))),
      what(igText + " " + (up >= 15 ? "Your inputs say the stock is worth more than the price, with room for error." : up >= -15 ? "Your inputs land close to the price: it looks fairly valued on cash flows." : "Your inputs say the price is ahead of the cash flows; it needs faster growth than you entered.")),
      el("p", { class: "note" }, (v.tvShare * 100).toFixed(0) + "% of this value comes from the years after year 10, so small changes to long-run growth and the discount rate move it a lot."),
      el("div", { class: "eyebrow" }, "Value per share if you change two inputs"), el("div", { class: "tablewrap" }, sens),
      el("p", { class: "note" }, "Green cells are above today's price, red below. The outlined cell matches your inputs."));
  });
  return box;
}

function modelBlock(s, refreshers) {
  const box = el("div", { class: "stack" }, el("h3", null, "The fair-value model behind the verdict"));
  const ladderBox = el("div"), formula = el("div", { class: "note mono", style: "white-space:pre-wrap" });
  const v0 = s.val;
  const fields = [["value", v0.metricLabel + " ($)", "0.01"], ["multiple", "Fair multiple (×)", "0.5"], ["margin", "Safety margin (%)", "1"], ["growth", "Expected 1-year growth (%)", "1"], ["consensus", "Analyst average target ($)", "1"]];
  const grid = el("div", { class: "grid3", style: "gap:10px" });
  const inputs = {};
  fields.forEach(([key, lbl, step]) => {
    const cur = valInputs(s)[key];
    const inp = el("input", { id: "fv-" + key, type: "number", step, value: isNum(cur) ? String(cur) : (key === "consensus" && isNum(consensusTarget(s)) ? String(consensusTarget(s)) : "") });
    inputs[key] = inp;
    inp.addEventListener("input", () => { const v = parseFloat(inp.value); const o = ovr(s.t); o.val = o.val || {}; o.val[key] = isNum(v) ? v : (key === "consensus" ? null : v0[key]); saveOvr(); refreshers.forEach(f => f(curPrice(s))); });
    grid.append(el("label", { class: "field", for: "fv-" + key }, lbl, inp));
  });
  const reset = el("button", { class: "btn ghost", type: "button", onclick: () => { const o = ovr(s.t); delete o.val; saveOvr(); fields.forEach(([k]) => { const c = valInputs(s)[k]; inputs[k].value = isNum(c) ? String(c) : (k === "consensus" && isNum(consensusTarget(s)) ? String(consensusTarget(s)) : ""); }); refreshers.forEach(f => f(curPrice(s))); } }, "Reset to research inputs");
  box.append(ladderBox, el("details", { class: "data" }, el("summary", null, "See and edit the model's inputs"), el("div", { class: "stack", style: "margin-top:10px" }, grid, formula, el("p", { class: "note" }, v0.note || ""), el("div", null, reset))));
  refreshers.push(price => {
    const k = fairModel(s, price);
    ladderBox.replaceChildren(ladder(s, k, price));
    formula.textContent = isNum(k.fair) ? "Fair value    = " + money(k.v.value) + " × " + k.v.multiple + " = " + money(k.fair) + "\nStrong buy    = fair × (1 − " + k.v.margin + "%) = " + money(k.buy) + "\n1-year target = ½ × fair grown " + k.v.growth + "% (" + money(k.fair * (1 + k.v.growth / 100)) + ")" + (isNum(k.cons) ? " + ½ × analyst average (" + money(k.cons) + ") = " + money(k.target) : " = " + money(k.target)) : "Not enough data for the model.";
  });
  return box;
}

function ladder(s, k, price) {
  if (!isNum(k.fair)) return el("p", { class: "note" }, "The model needs a positive earnings or cash-flow figure.");
  const pts = [price, k.buy, k.fair, k.target, s.px.lo52, s.px.hi52].filter(isNum);
  const lo = Math.min(...pts) * 0.9, hi = Math.max(...pts) * 1.06;
  const X = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const zoneDiv = (a, b, c) => el("div", { class: "zone " + c, style: `left:${X(a)}%;width:${Math.max(0, X(b) - X(a))}%` });
  const lad = el("div", { class: "ladder", role: "img", "aria-label": `Price ladder: price ${moneyAuto(price)}, strong buy ${moneyAuto(k.buy)}, fair ${moneyAuto(k.fair)}, target ${moneyAuto(k.target)}` },
    el("div", { class: "track" }, zoneDiv(lo, k.buy, "z-buy"), zoneDiv(k.buy, k.fair, "z-fair"), zoneDiv(k.fair, k.target, "z-hold"), zoneDiv(k.target, hi, "z-sell")));
  [[k.buy, "Strong buy"], [k.fair, "Fair"], [k.target, "Target"]].forEach(([v, t]) => { lad.append(el("div", { class: "tick", style: `left:${X(v)}%` }), el("div", { class: "tl", style: `left:${X(v)}%` }, t, el("b", null, moneyAuto(v)))); });
  lad.append(el("div", { class: "now", style: `left:${X(price)}%` }, el("span", null, "Now " + moneyAuto(price)), el("i")));
  return el("div", { class: "stack" }, lad, el("div", { class: "legend" },
    el("span", null, el("i", { style: "--c:var(--good-strong)" }), "Strong-buy zone"), el("span", null, el("i", { style: "--c:var(--good-soft)" }), "Below fair value"),
    el("span", null, el("i", { style: "--c:var(--warn-soft)" }), "Hold zone"), el("span", null, el("i", { style: "--c:var(--bad-soft)" }), "Take-profit zone")));
}

function multiplesBlock(s, refreshers) {
  const box = el("div", { class: "stack" }, el("h3", null, "Valuation numbers"));
  const tb = el("div", { class: "tablewrap" });
  box.append(tb);
  refreshers.push(p => {
    const f = s.fin || {}, sh = s.sh;
    const mcap = isNum(sh) ? p * sh : null;
    const ev = isNum(mcap) && isNum(f.debt) && isNum(f.cash) && s.t !== "JPM" ? mcap + f.debt - f.cash : null;
    const pe = peNow(s, p), fe = fwdEps(s), fpe = fe ? p / fe.v : null;
    const epsG = fe && isNum(s.pe && s.pe.ttm) && s.pe.ttm > 0 ? (fe.v / s.pe.ttm - 1) * 100 : null;
    const peg = isNum(fpe) && isNum(epsG) && epsG > 0 ? fpe / epsG : null;
    const rows = [
      ["Market value", big(mcap), "Price × shares outstanding."],
      ["Enterprise value", big(ev), "Market value plus debt minus cash: the price of the whole business."],
      ["P/E (last 12 months)", mult(pe), "Price ÷ earnings per share over the past year."],
      ["Forward P/E", mult(fpe), fe ? "Price ÷ " + fe.src.toLowerCase() + " (" + money(fe.v) + ")." : "No forward estimate."],
      ["Expected EPS growth", spct(epsG, 0), "Next 4 quarters' estimate vs. the last 12 months."],
      ["PEG ratio", isNum(peg) ? peg.toFixed(2) : "—", "Forward P/E ÷ growth. Around 1 is often called fair; under 1 cheap for the growth."],
      ["Price / sales", isNum(mcap) && f.revenue > 0 ? (mcap / f.revenue).toFixed(1) + "×" : "—", "Useful when earnings are small or negative."],
      ["Price / free cash flow", isNum(mcap) && f.fcf > 0 ? (mcap / f.fcf).toFixed(1) + "×" : "—", "Like P/E but with the cash the business actually produced."],
      ["Free-cash-flow yield", isNum(mcap) && isNum(f.fcf) ? pct(f.fcf / mcap * 100) : "—", "Cash produced per $100 of stock. Compare it with the 10-year Treasury at " + D.macro.latest.DGS10[1].toFixed(2) + "%."],
      ["Price / book", isNum(mcap) && f.equity > 0 ? (mcap / f.equity).toFixed(1) + "×" : "—", "Price vs. accounting net worth; most useful for banks and insurers."],
      ["Dividend yield", isNum(f.dividend) && f.dividend > 0 ? pct(f.dividend / p * 100, 2) : "None", "Yearly dividend ÷ price."]
    ];
    tb.replaceChildren(el("table", null, el("tbody", null, rows.map(r => el("tr", null, el("td", null, el("b", null, r[0])), el("td", { class: "n" }, r[1]), el("td", { class: "small muted" }, r[2]))))));
  });
  return box;
}

/* ---------- 4. business scorecard ---------- */
function businessSection(s) {
  const sec = el("section", { class: "panel anchor", id: "sec-biz" }, el("header", null, el("h2", null, "Business scorecard"), el("span", { class: "note" }, "10 parts, 100 points")));
  const rows = el("div");
  PARTS.forEach(([nm, mx], i) => {
    const p = s.parts[i] || [0, ""], v = isNum(p[0]) ? p[0] : 0, r = v / mx;
    const c = r >= 0.75 ? "var(--good)" : r >= 0.55 ? "var(--warn)" : "var(--bad)";
    rows.append(el("div", { class: "score-row" }, el("div", { class: "nm" }, nm), el("div", { class: "bar", role: "img", "aria-label": nm + " " + v + " of " + mx }, el("i", { style: `width:${r * 100}%;--c:${c}` })), el("div", { class: "pts" }, v + "/" + mx), el("div", { class: "ex" }, p[1] || "")));
  });
  const sw = s.swot || {};
  const q = (t, a) => el("div", null, el("div", { class: "eyebrow" }, t), el("ul", null, (a || []).map(x => el("li", null, x))));
  sec.append(el("div", { class: "grid2" }, rows, el("div", { class: "stack" }, el("h3", null, "Strengths, weaknesses, opportunities, threats"), el("div", { class: "swot" }, q("Strengths", sw.s), q("Weaknesses", sw.w), q("Opportunities", sw.o), q("Threats", sw.t)))),
    el("p", { class: "note" }, "Scored on Oct 1, 2026 from filings, market data and news. SWOT is worth 15 points, P/E 5, every other part 10. An average company scores about 60–65."));
  return sec;
}

/* ---------- 5. financials ---------- */
function financialsSection(s, refreshers) {
  const sec = el("section", { class: "panel anchor", id: "sec-fin" }, el("header", null, el("h2", null, "Financials"), el("span", { class: "note" }, (s.fin && s.fin.period) || "")));
  const tb = el("div", { class: "tablewrap" });
  sec.append(tb, el("p", { class: "note" }, "US$; B = billion, T = trillion. From the company's latest reports as of Oct 1, 2026."));
  refreshers.push(p => {
    const f = s.fin || {};
    const nd = isNum(f.debt) && isNum(f.cash) ? f.debt - f.cash : null;
    const rows = [["Income"], ["Revenue", big(f.revenue)], isNum(f.qGrowth) ? ["Revenue growth (latest quarter vs. a year ago)", pct(f.qGrowth)] : ["Revenue growth", pct(f.revGrowth)],
      ["Operating income", big(f.opIncome)], ["Operating margin", pct(f.opMargin)], ["Net income", big(f.netIncome)], ["Earnings per share (EPS)", money(f.eps)],
      ["Cash"], ["Free cash flow", big(f.fcf)], ["Dividend per share (yearly)", isNum(f.dividend) ? (f.dividend > 0 ? money(f.dividend) : "None") : "—"],
      ["Balance sheet"], ["Cash and investments", big(f.cash)], ["Total debt", big(f.debt)], ["Net debt", isNum(nd) ? (nd < 0 ? "Net cash " + big(-nd) : big(nd)) : "—"],
      ["Shareholders' equity", big(f.equity)], ["Debt to equity", isNum(f.debt) && f.equity > 0 ? (f.debt / f.equity).toFixed(2) + "×" : (f.equity <= 0 ? "n/m (negative equity)" : "—")]];
    tb.replaceChildren(el("table", null, el("tbody", null, rows.map(r => r.length === 1 ? el("tr", { class: "group" }, el("td", { colspan: 2 }, r[0])) : el("tr", null, el("td", null, r[0]), el("td", { class: "n" }, r[1]))))));
  });
  return sec;
}

/* ---------- 6. insiders and funds ---------- */
function moneySection(s, ai) {
  const sec = el("section", { class: "panel anchor", id: "sec-money" }, el("header", null, el("h2", null, "Insiders & big funds"), el("span", { class: "note" }, "SEC Form 4 and 13F filings")));
  if (ai) { sec.append(el("p", { class: "note" }, "Not available for companies analyzed by Claude.")); return sec; }
  const oi = s.oi;
  const ins = el("div", { class: "stack" }, el("h3", null, "What company insiders did with their own money"));
  if (FOREIGN.has(s.t) || !oi) ins.append(el("p", { class: "note" }, s.n + " is a foreign company, so its executives don't file the US insider-trading forms (Form 4). No insider data to show."));
  else {
    const a = oi.m12, b = oi.m3;
    ins.append(el("div", { class: "kv" },
      el("div", null, el("span", null, "Open-market buys, 12 months"), el("b", { class: a.buys ? "up" : "" }, a.buys + (a.buys ? " · " + bigUsd(a.bought) : "")), el("span", null, a.buyers + " insider" + (a.buyers === 1 ? "" : "s"))),
      el("div", null, el("span", null, "Sales, 12 months"), el("b", null, a.sells + (a.sells ? " · " + bigUsd(a.sold) : "")), el("span", null, a.sellers + " insider" + (a.sellers === 1 ? "" : "s"))),
      el("div", null, el("span", null, "Buys, last 3 months"), el("b", null, b.buys + (b.buys ? " · " + bigUsd(b.bought) : "")), el("span", null, "since mid-July")),
      el("div", null, el("span", null, "Sales, last 3 months"), el("b", null, b.sells + (b.sells ? " · " + bigUsd(b.sold) : "")), el("span", null, "since mid-July"))));
    if (oi.recent.length) ins.append(el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Date", "Insider", "Role", "Type", "Shares", "Price", "Value"].map((h, i) => el("th", { class: i >= 4 ? "n" : null }, h)))),
      el("tbody", null, oi.recent.map(r => el("tr", null, el("td", { class: "small" }, dLabel(r[0], "md") + ", " + r[0].slice(0, 4)), el("td", null, r[1]), el("td", { class: "small muted" }, r[2]),
        el("td", null, el("span", { class: "pill " + (r[3] === "P" ? "good" : "na") }, r[3] === "P" ? "Bought" : "Sold")), el("td", { class: "n" }, compact(Math.abs(r[5] || 0))), el("td", { class: "n" }, money(r[4])), el("td", { class: "n" }, bigUsd(Math.abs(r[6] || 0)))))))));
    ins.append(what("Insiders sell for many ordinary reasons, such as taxes, buying a house or planned sales set up months ahead. Buying with their own cash on the open market is rarer and more telling: they usually do it when they think the stock is cheap."));
  }
  const inst = s.inst;
  const fund = el("div", { class: "stack" }, el("h3", null, "Big funds (13F filings)"));
  if (inst && isNum(inst.pct)) {
    const incH = inst.inc ? inst.inc[0] : null, decH = inst.dec ? inst.dec[0] : null;
    fund.append(el("div", { class: "kv" },
      el("div", null, el("span", null, "Owned by funds"), el("b", null, pct(inst.pct)), el("span", null, (inst.total ? inst.total[0].toLocaleString() : "—") + " funds")),
      el("div", null, el("span", null, "Funds that added"), el("b", { class: "up" }, isNum(incH) ? incH.toLocaleString() : "—"), el("span", null, compact(inst.inc && inst.inc[1]) + " shares")),
      el("div", null, el("span", null, "Funds that trimmed"), el("b", { class: "down" }, isNum(decH) ? decH.toLocaleString() : "—"), el("span", null, compact(inst.dec && inst.dec[1]) + " shares")),
      el("div", null, el("span", null, "New vs. sold out"), el("b", null, (inst.new ? inst.new[0] : "—") + " / " + (inst.soldOut ? inst.soldOut[0] : "—")), el("span", null, "funds"))));
    if (inst.top && inst.top.length) fund.append(el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Fund", "Shares", "Change", "Value", "As of"].map((h, i) => el("th", { class: i && i < 4 ? "n" : null }, h)))),
      el("tbody", null, inst.top.map(r => el("tr", null, el("td", null, r[0]), el("td", { class: "n" }, compact(r[2])), el("td", { class: "n " + cls(r[3]) }, spct(r[3], 1)), el("td", { class: "n" }, bigUsd((r[4] || 0) * 1000)), el("td", { class: "small muted" }, r[1])))))));
    fund.append(what(isNum(incH) && isNum(decH) ? (incH > decH ? "More funds added to their position than trimmed it in the latest quarter, a sign of growing professional interest." : "More funds trimmed than added in the latest quarter. Index funds (Vanguard, BlackRock) mostly track the market, so the active funds matter more.") : "Funds report holdings each quarter with a delay of up to 45 days."));
  } else fund.append(el("p", { class: "note" }, "No fund-ownership data available."));
  sec.append(el("div", { class: "grid2" }, ins, fund), el("p", { class: "note" }, "Insider trades: SEC Form 4 open-market purchases (P) and sales (S) via OpenInsider, last 12 months to " + AS_OF_LABEL + ". Fund holdings: Nasdaq, from the latest 13F reports."));
  return sec;
}

/* ---------- 7. risks and outlook ---------- */
function riskSection(s, refreshers) {
  const sec = el("section", { class: "panel anchor", id: "sec-risk" }, el("header", null, el("h2", null, "Risks & outlook"), el("span", { class: "note" }, "Scenarios, dates to watch, and how it reacts to the economy")));
  const scen = el("div", { class: "scen" });
  refreshers.push(p => {
    const sc = s.scen || {};
    const c = (lbl, key, col) => { const x = sc[key] || [null, ""]; return el("div", { style: "--c:" + col }, el("span", { class: "eyebrow" }, lbl), el("span", { class: "p" }, moneyAuto(x[0]), " ", el("span", { class: "small " + cls(isNum(x[0]) ? x[0] - p : null) }, spct(isNum(x[0]) ? (x[0] / p - 1) * 100 : null, 0))), el("p", null, x[1])); };
    scen.replaceChildren(c("Bull case", "bull", "var(--good)"), c("Base case", "base", "var(--warn)"), c("Bear case", "bear", "var(--bad)"));
  });
  const dates = el("ul", { style: "margin:0;padding-left:18px;display:grid;gap:6px" });
  if (s.ed) { const d = daysUntil(s.ed.date); dates.append(el("li", null, el("b", null, dLabel(s.ed.date) + ": "), "next earnings report" + (s.ed.when ? ", " + s.ed.when : "") + (s.ed.estimated ? " (estimated date)" : "") + (isNum(s.ed.epsEst) ? "; Wall Street expects " + money(s.ed.epsEst) + " a share vs. " + money(s.ed.epsYearAgo) + " a year ago" : "") + (d >= 0 ? " · in " + d + " days" : ""))); }
  (s.cat || []).forEach(([w, t]) => dates.append(el("li", null, el("b", null, w + ": "), t)));
  const r = s.risk || {};
  const res = s.parts[8] ? s.parts[8][0] : null;
  const macro = el("div", { class: "kv" },
    el("div", null, el("span", null, "Rate sensitivity"), el("b", null, isNum(r.rate) ? spct(r.rate, 0) : "—"), el("span", null, "per +1 point in the 10-yr yield")),
    el("div", null, el("span", null, "Oil sensitivity"), el("b", null, isNum(r.oil) ? spct(r.oil * 10, 1) : "—"), el("span", null, "per +10% in oil")),
    el("div", null, el("span", null, "Recession resilience"), el("b", null, isNum(res) ? res + "/10" : "—"), el("span", null, "from the scorecard")),
    el("div", null, el("span", null, "Swings vs. market (beta)"), el("b", null, isNum(r.beta) ? r.beta.toFixed(2) : "—"), el("span", null, "1.00 = moves with the market")));
  const rateTxt = isNum(r.rate) ? (r.rate <= -10 ? s.t + " has dropped hard when long-term rates rose, so another Fed hike or a higher 10-year yield is a real risk." : r.rate < -3 ? s.t + " has tended to slip when rates rose; rising rates are a mild headwind." : r.rate > 3 ? s.t + " has tended to do better when rates rose (banks and some energy stocks behave this way)." : s.t + " hasn't reacted much to rate moves.") : "";
  const oilTxt = isNum(r.oil) ? (r.oil >= 0.25 ? " It tends to rise with oil, which helps while oil is near $100." : r.oil <= -0.25 ? " It tends to fall when oil rises, a headwind with oil near $100." : "") : "";
  sec.append(scen, el("div", { class: "grid2" },
    el("div", { class: "stack" }, el("h3", null, "Dates to watch"), dates),
    el("div", { class: "stack" }, el("h3", null, "How it reacts to the economy"), macro,
      el("p", { class: "note" }, "Measured from monthly returns over the last 5 years. Rate sensitivity: how the stock moved in months the 10-year Treasury yield rose 1 point. These are tendencies, not rules."))),
    rateTxt || oilTxt ? what(rateTxt + oilTxt) : null,
    el("div", { class: "stack" }, el("h3", null, "What people are saying"), el("p", null, s.sent || "—")));
  return sec;
}

/* ---------- 8. analysts ---------- */
function analystSection(s, refreshers) {
  const sec = el("section", { class: "panel anchor", id: "sec-analysts" }, el("header", null, el("h2", null, "Analysts"), el("span", { class: "note" }, "Price targets and earnings estimates")));
  const tg = s.tg;
  const rangeBox = el("div");
  if (tg && (tg.c || (tg.f && tg.f.length))) {
    const rows = [...(tg.f || [])].sort((a, b) => b[1] - a[1]);
    const tbl = rows.length ? el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Firm", "Target", "vs. price", "Rating", "Date"].map((h, i) => el("th", { class: i === 1 || i === 2 ? "n" : null }, h)))),
      el("tbody", { id: "tg-body" }))) : el("p", { class: "note" }, "Only a few firms cover this stock; no per-firm list was available.");
    sec.append(rangeBox, tbl);
    refreshers.push(p => {
      const vals = rows.map(r => r[1]);
      const lo = tg.c && isNum(tg.c.lo) ? Math.min(tg.c.lo, ...vals) : Math.min(...vals), hi = tg.c && isNum(tg.c.hi) ? Math.max(tg.c.hi, ...vals) : Math.max(...vals);
      const L = Math.min(lo, p) * 0.97, Hh = Math.max(hi, p) * 1.03;
      const X = v => Math.max(0, Math.min(100, (v - L) / (Hh - L) * 100));
      rangeBox.replaceChildren(el("div", { class: "trange", role: "img", "aria-label": "Targets " + moneyAuto(lo) + " to " + moneyAuto(hi) + ", price " + moneyAuto(p) },
        el("i", { class: "seg-bar", style: `left:${X(lo)}%;width:${X(hi) - X(lo)}%` }),
        tg.c && isNum(tg.c.avg) ? el("i", { class: "avg", style: `left:${X(tg.c.avg)}%` }) : null,
        tg.c && isNum(tg.c.avg) ? el("span", { class: "o", style: `left:${X(tg.c.avg)}%;transform:translateX(${edgeShift(X(tg.c.avg))})` }, "Average " + moneyAuto(tg.c.avg)) : null,
        el("span", { class: "u", style: `left:${X(lo)}%;transform:translateX(${edgeShift(X(lo))})` }, "Low " + moneyAuto(lo)), el("span", { class: "u", style: `left:${X(hi)}%;transform:translateX(${edgeShift(X(hi))})` }, "High " + moneyAuto(hi)),
        el("b", { style: `left:${X(p)}%`, title: "Price " + moneyAuto(p) })),
        el("p", { class: "note" }, (tg.c ? tg.c.n + " analysts. " : "") + "The dot is the price you're evaluating (" + moneyAuto(p) + "); the line marks the average target." +
          (s.nq && isNum(s.nq.target1y) ? " Nasdaq's daily consensus target is " + moneyAuto(s.nq.target1y) + "; the signals use that figure." : "")));
      const body = $("tg-body");
      if (body) body.replaceChildren(...rows.map(([firm, t, rt, dt]) => { const up = (t / p - 1) * 100; return el("tr", null, el("td", null, firm), el("td", { class: "n" }, moneyAuto(t)), el("td", { class: "n " + cls(up) }, spct(up, 0)), el("td", null, el("span", { class: "pill " + (/buy|outperform|overweight/i.test(rt) ? "good" : /sell|under/i.test(rt) ? "bad" : "warn") }, rt || "—")), el("td", { class: "small muted" }, dt || "—")); }));
    });
  } else sec.append(el("p", { class: "note" }, "No analyst targets available."));
  const fc = s.fc;
  if (fc && (fc.q.length || fc.y.length)) {
    const tbl = (title, arr) => el("div", { class: "stack" }, el("h3", null, title), el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Period", "EPS estimate", "Analysts", "Raised / cut (4 wks)"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", null, arr.map(r => el("tr", null, el("td", null, r[0]), el("td", { class: "n" }, money(r[1])), el("td", { class: "n" }, r[2] ?? "—"), el("td", { class: "n" }, (r[3] || 0) + " / " + (r[4] || 0))))))));
    sec.append(el("div", { class: "grid2" }, tbl("Next quarters", fc.q.slice(0, 4)), tbl("Fiscal years", fc.y.slice(0, 3))),
      what(fc.revUp > fc.revDown ? "Analysts have been raising their earnings estimates over the last 4 weeks. Rising estimates often come before rising prices." : fc.revDown > fc.revUp ? "Analysts have been cutting their earnings estimates over the last 4 weeks, a warning sign to watch." : "Analysts haven't changed their earnings estimates much in the last 4 weeks."));
  }
  sec.append(el("p", { class: "note" }, "Targets by firm: StockAnalysis, Investing.com and broker notes, Oct 15–16, 2026; each firm updates at different times. Estimates: Nasdaq (Zacks), " + AS_OF_LABEL + "."));
  return sec;
}

/* ---------- 10. sources ---------- */
function sourcesSection(s, ai) {
  const sec = el("section", { class: "panel anchor", id: "sec-src" }, el("header", null, el("h2", null, "Sources")));
  const list = [...(s.src || []), ...((s.upd && s.upd[2]) || [])];
  if (!ai) list.push(["SEC EDGAR filings for " + s.n, "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + encodeURIComponent(s.t) + "&type=10-Q&dateb=&owner=include&count=40"],
    ["Insider trades (OpenInsider)", "http://openinsider.com/" + encodeURIComponent(s.t)],
    ["Nasdaq quote, estimates and ownership", "https://www.nasdaq.com/market-activity/stocks/" + s.t.toLowerCase().replace(".", "-")]);
  sec.append(el("ul", { style: "margin:0;padding-left:18px;display:grid;gap:6px" }, list.map(([t, u]) => el("li", null, el("a", { href: u, target: "_blank", rel: "noopener" }, t)))));
  return sec;
}
