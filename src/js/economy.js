/* ============================================================
   Economy: the Fed, inflation, jobs, growth, bonds, oil, mood,
   and what each means for the 50 stocks. Numbers and most of the
   wording come from the latest data; hand-written context is dated.
   ============================================================ */
const NEWS = (D.notes && D.notes.sources) || [];
const FRED_LINKS = [["Fed funds target range", "DFEDTARU"], ["Consumer prices (CPI)", "CPIAUCSL"], ["Core CPI", "CPILFESL"], ["Core PCE prices", "PCEPILFE"], ["Unemployment rate", "UNRATE"], ["Payroll jobs", "PAYEMS"], ["Real GDP growth", "A191RL1Q225SBEA"], ["10-year Treasury", "DGS10"], ["2-year Treasury", "DGS2"], ["10-year minus 2-year", "T10Y2Y"], ["30-year mortgage", "MORTGAGE30US"], ["Junk-bond spread", "BAMLH0A0HYM2"], ["Consumer sentiment", "UMCSENT"], ["Oil (WTI)", "DCOILWTICO"], ["5-year inflation expectations", "T5YIE"], ["Jobless claims", "ICSA"], ["Recession dates", "USREC"]];

function macroSlice(years) {
  const M = D.macro, n = M.months.length, k = Math.max(0, n - years * 12);
  return { k, labels: M.months.slice(k), get: key => M[key].slice(k) };
}
function lastVal(arr, labels) { const i = lastIdx(arr); return i < 0 ? [null, null] : [arr[i], labels[i]]; }
/** "its highest since 2007": the last year a monthly series was at least this high (or low), else since 2005. */
function sinceYear(key, value, high) {
  const M = D.macro, arr = M[key];
  for (let i = lastIdx(arr) - 2; i >= 0; i--) {
    const v = arr[i];
    if (isNum(v) && (high ? v >= value : v <= value)) return { year: M.months[i].slice(0, 4), first: false };
  }
  return { year: M.months[0].slice(0, 4), first: true };
}
function extremeText(key, value, high) {
  const s = sinceYear(key, value, high);
  const last = +s.year, now = +AS_OF.slice(0, 4);
  if (s.first) return high ? "the highest since at least " + s.year : "the lowest since at least " + s.year;
  if (now - last <= 1) return null; // nothing unusual
  return (high ? "the highest since " : "the lowest since ") + s.year;
}

RENDER.economy = function (root) {
  const M = D.macro, L = M.latest, Y = M.latestYoY, F = econFacts();
  root.append(el("div", { class: "page-head" }, el("div", null,
    el("div", { class: "eyebrow" }, "US economy · data through " + AS_OF_LABEL),
    el("h1", null, "The economy"),
    el("p", null, "Where interest rates, inflation, jobs and growth stand, how they got here, and what each one means for your stocks."))));

  // ---------- right now ----------
  const oil = mkt("CL=F");
  const t = (lbl, val, sub, c) => el("div", { class: "tile" }, el("span", { class: "lbl" }, lbl), el("span", { class: "val" }, val), el("span", { class: "delta " + (c || "flat") }, sub));
  const lastFed = M.fedChanges[M.fedChanges.length - 1];
  const gdp = M.gdp[M.gdp.length - 1], gdpPrev = M.gdp[M.gdp.length - 2];
  const [sent, sentM] = lastVal(M.sent, M.months);
  const quarter = d => "Q" + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1) + " " + d.slice(0, 4);
  root.append(el("div", { class: "tiles" },
    t("Fed funds rate", F.lo.toFixed(2) + "–" + F.hi.toFixed(2) + "%", (F.fedMode === "hold" ? "Last move: " : "") + (F.step > 0 ? "raised " : "cut ").replace(/^./, c => F.fedMode === "hold" ? c : c.toUpperCase()) + Math.abs(F.step).toFixed(2) + " on " + dLabel(lastFed[0], "md"), F.step > 0 ? "down" : "up"),
    t("Inflation (CPI)", Y.cpi[1] + "%", "Year to " + dLabel(Y.cpi[0], "my") + " · core " + Y.core[1] + "%", Y.cpi[1] > 3 ? "down" : "flat"),
    t("Unemployment", L.UNRATE[1] + "%", "Jobs added in " + dLabel(Y.pay[0], "my") + ": " + (Y.pay[1] >= 0 ? "+" : "") + Y.pay[1] + "K", Y.pay[1] < 75 ? "down" : "up"),
    t("GDP growth", gdp[1] + "%", quarter(gdp[0]) + ", yearly pace", gdp[1] >= 1.5 ? "up" : "down"),
    t("10-year Treasury", L.DGS10[1].toFixed(2) + "%", "30-yr mortgage " + L.MORTGAGE30US[1].toFixed(2) + "%", "flat"),
    t("Oil (WTI)", money0(oil.last), spct(oil.ytd, 0) + " this year · sentiment " + sent, oil.ytd > 15 ? "down" : "flat")));
  const autoSummary = "Inflation is " + Y.cpi[1] + "% (core " + Y.core[1] + "%), the Fed's rate is " + F.lo.toFixed(2) + "–" + F.hi.toFixed(2) + "% after a " + (F.step > 0 ? "hike" : "cut") + " on " + dLabel(lastFed[0]) + ", the 10-year Treasury yield is " + L.DGS10[1].toFixed(2) + "%, and employers added " + Y.pay[1] + "K jobs in " + dLabel(Y.pay[0], "my") + ".";
  root.append(el("div", { class: "callout warn" }, el("b", null, "The short version: "), noteFresh() && NOTES.summary ? [autoSummary + " ", dated(NOTES.summary)] : autoSummary));

  // ---------- the Fed ----------
  {
    const s = macroSlice(21);
    const chart = lineChart({ labels: s.labels, series: [
      { name: "Fed funds rate (top of range)", values: s.get("fedUpper"), color: "var(--s1)" },
      { name: "Inflation (CPI, yearly)", values: s.get("cpiYoY"), color: "var(--s2)" },
      { name: "Core PCE inflation (the Fed's favorite)", values: s.get("pceYoY"), color: "var(--s3)" }],
      shade: M.recessions, zero: true, yFmt: v => v.toFixed(0) + "%", tipFmt: v => v.toFixed(2) + "%", xStyle: "y", tipStyle: "my", ariaLabel: "Fed funds rate and inflation since 2005" });
    const recent = M.fedChanges.slice(-9).reverse();
    const prevOf = i => { const all = M.fedChanges, j = all.indexOf(recent[i]); return j > 0 ? all[j - 1] : null; };
    const tl = el("ul", { style: "margin:0;padding-left:18px;display:grid;gap:4px;font-size:14px" }, recent.map((c, i) => {
      const p = prevOf(i), up = p && c[2] > p[2];
      return el("li", null, el("b", null, dLabel(c[0]) + ": "), (p ? (up ? "raised to " : "cut to ") : "set at ") + c[1].toFixed(2) + "–" + c[2].toFixed(2) + "%");
    }));
    const now = F.fedMode === "hike" ? "Right now the Fed's latest move was a hike." : F.fedMode === "cut" ? "Right now the Fed is cutting." : "Right now the Fed is on hold.";
    root.append(panel("The Fed", "Interest rates and inflation since 2005 · shaded = recessions",
      chart,
      el("div", { class: "legend" }, el("span", null, el("i", { class: "line", style: "--c:var(--s1)" }), "Fed funds rate"), el("span", null, el("i", { class: "line", style: "--c:var(--s2)" }), "CPI inflation"), el("span", null, el("i", { class: "line", style: "--c:var(--s3)" }), "Core PCE inflation"), el("span", null, el("i", { style: "--c:var(--grid)" }), "Recession")),
      el("div", { class: "grid2" },
        el("div", { class: "stack" }, el("h3", null, "What happens next"),
          el("p", null, NOTES.fedNext ? dated(NOTES.fedNext) : "The Fed meets about every six weeks."),
          el("p", { class: "note" }, "Market odds move daily; check the live CME FedWatch link in the sources below.")),
        el("div", { class: "stack" }, el("h3", null, "Recent decisions"), tl)),
      what("The Fed raises rates to cool inflation. Higher rates make borrowing pricier for companies and shoppers, and they make safe bonds pay more, so investors pay less for stocks whose profits are far in the future (fast-growing tech, unprofitable companies). Banks can earn more on loans. Rate cuts work the other way. " + now)));
  }

  // ---------- inflation ----------
  {
    const s = macroSlice(10);
    const gap = Y.cpi[1] - Y.core[1];
    const first = gap > 0.7 ? "Headline inflation (" + Y.cpi[1] + "%) is well above core inflation (" + Y.core[1] + "%), which means energy is doing most of the damage." :
      gap < -0.5 ? "Core inflation (" + Y.core[1] + "%) is above headline inflation (" + Y.cpi[1] + "%): falling energy prices are holding the headline number down." :
      "Headline (" + Y.cpi[1] + "%) and core (" + Y.core[1] + "%) inflation are close, so price pressure is broad, not just energy.";
    root.append(panel("Inflation", "Yearly change in prices, last 10 years",
      lineChart({ labels: s.labels, series: [
        { name: "CPI (everything)", values: s.get("cpiYoY"), color: "var(--s2)" },
        { name: "Core CPI (no food or energy)", values: s.get("coreYoY"), color: "var(--s1)" },
        { name: "Core PCE", values: s.get("pceYoY"), color: "var(--s3)" }],
        refs: [{ y: 2, label: "Fed goal 2%", color: "var(--ink-3)" }], zero: true, yFmt: v => v.toFixed(0) + "%", tipFmt: v => v.toFixed(1) + "%", xStyle: "y", tipStyle: "my", ariaLabel: "Inflation measures, last 10 years", padR: 84 }),
      el("div", { class: "legend" }, el("span", null, el("i", { class: "line", style: "--c:var(--s2)" }), "CPI"), el("span", null, el("i", { class: "line", style: "--c:var(--s1)" }), "Core CPI"), el("span", null, el("i", { class: "line", style: "--c:var(--s3)" }), "Core PCE")),
      what(first + " Investors expect inflation to average about " + L.T5YIE[1].toFixed(1) + "% over the next 5 years (from Treasury bond prices)" + (L.T5YIE[1] < Y.cpi[1] - 0.5 ? ", so they think today's level will fade." : ".") + " When core inflation rises, the Fed tends to raise rates.")));
  }

  // ---------- jobs ----------
  {
    const s = macroSlice(21), s3 = macroSlice(3);
    const pays = M.payrolls.filter(isNum), last3 = pays.slice(-3), avg3 = last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length);
    root.append(panel("Jobs", "Unemployment since 2005 · jobs added each month, last 3 years",
      el("div", { class: "grid2" },
        el("div", { class: "stack" }, el("h3", null, "Unemployment rate"), lineChart({ labels: s.labels, series: [{ name: "Unemployment rate", values: s.get("unrate"), color: "var(--s1)", area: true }], shade: M.recessions, yFmt: v => v.toFixed(0) + "%", tipFmt: v => v.toFixed(1) + "%", xStyle: "y", tipStyle: "my", height: 220, ariaLabel: "Unemployment rate since 2005" })),
        el("div", { class: "stack" }, el("h3", null, "Jobs added each month (thousands)"), barChart({ labels: s3.labels, values: s3.get("payrolls"), name: "jobs added", yFmt: v => v.toFixed(0) + "K", tipFmt: v => (v >= 0 ? "+" : "") + v.toFixed(0) + "K", xStyle: "my", tipStyle: "my", height: 220, ariaLabel: "Monthly payroll change", colorFn: v => v < 0 ? "var(--s2)" : "var(--s1)" }))),
      what("Employers added " + Y.pay[1] + "K jobs in " + dLabel(Y.pay[0], "my") + " and about " + Math.round(avg3) + "K a month over the last three months; unemployment is " + L.UNRATE[1] + "%. Weekly jobless claims are about " + Math.round(L.ICSA[1] / 1000) + "K" + (L.ICSA[1] < 260000 ? ", still low, so layoffs aren't spiking." : ", a level that points to rising layoffs.") +
        (avg3 < 75 ? " Hiring this slow usually means slower consumer spending ahead" + (F.fedMode === "hike" ? ", and it's what could eventually stop the Fed's hikes." : ".") : " Steady hiring supports consumer spending."))));
  }

  // ---------- growth ----------
  {
    const g = M.gdp.slice(-40);
    const s = macroSlice(10);
    root.append(panel("Growth", "Real GDP growth by quarter (yearly pace) · retail sales and factory output",
      el("div", { class: "grid2" },
        el("div", { class: "stack" }, el("h3", null, "GDP growth, last 10 years"), barChart({ labels: g.map(x => x[0]), values: g.map(x => x[1]), name: "GDP growth", yFmt: v => v.toFixed(0) + "%", tipFmt: v => v.toFixed(1) + "%", xStyle: "y", tipStyle: "my", height: 220, ariaLabel: "Quarterly GDP growth", colorFn: v => v < 0 ? "var(--s2)" : "var(--s1)" })),
        el("div", { class: "stack" }, el("h3", null, "Retail sales and factory output, yearly change"), lineChart({ labels: s.labels, series: [{ name: "Retail sales", values: s.get("retailYoY"), color: "var(--s1)" }, { name: "Industrial production", values: s.get("indproYoY"), color: "var(--s2)" }], zero: true, yFmt: v => v.toFixed(0) + "%", tipFmt: v => v.toFixed(1) + "%", xStyle: "y", tipStyle: "my", height: 220, ariaLabel: "Retail sales and industrial production" }),
          el("div", { class: "legend" }, el("span", null, el("i", { class: "line", style: "--c:var(--s1)" }), "Retail sales"), el("span", null, el("i", { class: "line", style: "--c:var(--s2)" }), "Industrial production")))),
      what((gdp[1] < 0 ? "The economy shrank" : "The economy grew") + " at a " + Math.abs(gdp[1]) + "% yearly pace in " + quarter(gdp[0]) + (gdpPrev ? ", after " + gdpPrev[1] + "% in " + quarter(gdpPrev[0]) : "") + ". Retail sales are up " + (lastVal(M.retailYoY, M.months)[0] || 0).toFixed(1) + "% from a year ago, but part of that is higher prices rather than people buying more. GDP is reported about a month after each quarter ends.")));
  }

  // ---------- bonds ----------
  {
    const s = macroSlice(21);
    // compare this month's average with earlier months, so like is compared with like
    const y10x = extremeText("y10", lastVal(M.y10, M.months)[0], true), mortX = extremeText("mort", lastVal(M.mort, M.months)[0], true);
    root.append(panel("The bond market", "Treasury yields, the yield curve, mortgages and credit stress",
      lineChart({ labels: s.labels, series: [{ name: "10-year", values: s.get("y10"), color: "var(--s1)" }, { name: "2-year", values: s.get("y2"), color: "var(--s2)" }, { name: "3-month bill", values: s.get("y3m"), color: "var(--s3)" }, { name: "30-yr mortgage", values: s.get("mort"), color: "var(--s7)" }], shade: M.recessions, zero: true, yFmt: v => v.toFixed(0) + "%", tipFmt: v => v.toFixed(2) + "%", xStyle: "y", tipStyle: "my", ariaLabel: "Treasury yields and mortgage rates since 2005" }),
      el("div", { class: "legend" }, el("span", null, el("i", { class: "line", style: "--c:var(--s1)" }), "10-year Treasury"), el("span", null, el("i", { class: "line", style: "--c:var(--s2)" }), "2-year Treasury"), el("span", null, el("i", { class: "line", style: "--c:var(--s3)" }), "3-month bill"), el("span", null, el("i", { class: "line", style: "--c:var(--s7)" }), "30-year mortgage")),
      el("div", { class: "grid2" },
        el("div", { class: "stack" }, el("h3", null, "Yield curve: 10-year minus 2-year"), lineChart({ labels: s.labels, series: [{ name: "10y minus 2y", values: s.get("curve"), color: "var(--s1)", area: true }], shade: M.recessions, zero: true, yFmt: v => v.toFixed(1) + "", tipFmt: v => v.toFixed(2) + " pts", xStyle: "y", tipStyle: "my", height: 200, ariaLabel: "Yield curve spread" })),
        el("div", { class: "stack" }, el("h3", null, "Junk-bond spread (credit stress)"), lineChart({ labels: s.labels, series: [{ name: "Junk-bond spread", values: s.get("hy"), color: "var(--s2)", area: true }], shade: M.recessions, yFmt: v => v.toFixed(0) + "", tipFmt: v => v.toFixed(2) + " pts", xStyle: "y", tipStyle: "my", height: 200, ariaLabel: "High-yield bond spread" }))),
      what("The 10-year Treasury yield is " + L.DGS10[1].toFixed(2) + "%" + (y10x ? " (this month's average is " + y10x + ")" : "") + ", and 30-year mortgages are " + L.MORTGAGE30US[1].toFixed(2) + "%" + (mortX ? " (" + mortX + ")" : "") + (L.MORTGAGE30US[1] >= 6.5 ? ", which keeps home buying slow (bad news for Home Depot)." : ".") +
        " When the yield curve goes below zero (2-year above 10-year) a recession has often followed; it's " + (L.T10Y2Y[1] < 0 ? "below zero now at " : "positive now at ") + L.T10Y2Y[1].toFixed(2) + ". The junk-bond spread is the extra interest risky companies pay; at " + L.BAMLH0A0HYM2[1].toFixed(2) + " points it is " + (L.BAMLH0A0HYM2[1] < 5 ? "far from the 8+ points seen in real crises." : "at a level that signals real credit stress."))));
  }

  // ---------- oil and the consumer ----------
  {
    const s = macroSlice(21);
    const sentX = extremeText("sent", sent, false);
    root.append(panel("Oil and the consumer", "Oil prices and how people feel about the economy",
      el("div", { class: "grid2" },
        el("div", { class: "stack" }, el("h3", null, "Oil (WTI, $ a barrel)"), lineChart({ labels: s.labels, series: [{ name: "Oil", values: s.get("oil"), color: "var(--s2)", area: true }], shade: M.recessions, yFmt: v => "$" + v.toFixed(0), tipFmt: v => "$" + v.toFixed(1), xStyle: "y", tipStyle: "my", height: 220, ariaLabel: "Oil price since 2005" })),
        el("div", { class: "stack" }, el("h3", null, "Consumer sentiment (University of Michigan)"), lineChart({ labels: s.labels, series: [{ name: "Sentiment", values: s.get("sent"), color: "var(--s1)", area: true }], shade: M.recessions, yFmt: v => v.toFixed(0), tipFmt: v => v.toFixed(1), xStyle: "y", tipStyle: "my", height: 220, ariaLabel: "Consumer sentiment since 2005" }))),
      what(el("span", null, "Oil is " + money0(oil.last) + " a barrel, " + spct(oil.ytd, 0) + " this year. ", NOTES.oil ? dated(NOTES.oil) : null,
        " Consumer sentiment is " + sent + " (" + dLabel(sentM, "my") + ")" + (sentX ? ", " + sentX : "") + "." + (sent < 60 ? " People feel squeezed, which tends to hurt restaurants, apparel and travel, and help discount stores." : "")))));
  }

  // ---------- market mood ----------
  root.append(moodPanel());

  // ---------- stocks vs. the economy ----------
  root.append(exposurePanel());
  root.append(fedEventsPanel());

  root.append(panel("Sources", "Economic data: FRED, Federal Reserve Bank of St. Louis",
    el("ul", { style: "margin:0;padding-left:18px;display:grid;gap:6px" },
      NEWS.map(([tx, u]) => el("li", null, el("a", { href: u, target: "_blank", rel: "noopener" }, tx))),
      el("li", null, "FRED series: ", FRED_LINKS.map(([tx, id], i) => [i ? ", " : "", el("a", { href: "https://fred.stlouisfed.org/series/" + id, target: "_blank", rel: "noopener" }, tx)])))));
};

function moodPanel() {
  const m = D.mood;
  const box = el("div", { class: "stack" });
  const status = el("span", { class: "small muted" });
  const vixWord = v => v < 15 ? "calm" : v < 22 ? "normal worry" : v < 30 ? "nervous" : "panic";
  function render(x, note) {
    box.replaceChildren(el("div", { class: "kv" },
      el("div", null, el("span", null, "Fear gauge (VIX)"), el("b", null, isNum(x.vix) ? x.vix.toFixed(2) : "—"), el("span", null, isNum(x.vix) ? vixWord(x.vix) + (isNum(m.vixAvg) ? " · year avg " + m.vixAvg.toFixed(1) : "") : "")),
      isNum(x.fearGreed) ? el("div", null, el("span", null, "Fear & Greed index"), el("b", null, x.fearGreed + " / 100"), el("span", null, x.fgRating)) : null,
      el("div", null, el("span", null, "S&P 500"), el("b", null, isNum(x.spx) ? x.spx.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"), el("span", { class: cls(x.spxD1) }, spct(x.spxD1, 2) + " on the day")),
      el("div", null, el("span", null, "S&P 500 vs. its 1-year high"), el("b", null, spct(m.spxFromHigh, 1)), el("span", null, m.spxFromHigh > -3 ? "near the top" : m.spxFromHigh > -10 ? "a small pullback" : m.spxFromHigh > -20 ? "a correction" : "a bear market")),
      el("div", null, el("span", null, "Stocks above 200-day average"), el("b", null, m.above200 + " of " + m.with200), el("span", null, "of the 50 on this site"))),
      el("p", { class: "note" }, note));
  }
  render({ vix: m.vix, spx: m.spx, spxD1: m.spxD1 }, "Computed from closing prices on " + AS_OF_LABEL + ".");
  const btn = el("button", { class: "btn ghost", type: "button", hidden: true }, "Add Fear & Greed (uses 1 Flashalpha call)");
  if (!WEB) mcpReady.then(ns => { if (ns) btn.hidden = false; });
  btn.addEventListener("click", async () => {
    const ns = mcpNs || await mcpReady;
    if (!ns) return;
    btn.disabled = true; status.replaceChildren(el("span", { class: "spinner", "aria-hidden": "true" }), " Asking Flashalpha…");
    try {
      const r = await ns.callTool("Flashalpha", "get_stock_summary", { symbol: "SPY" }, { cache: { staleTime: 120000, gcTime: 900000 } });
      const q = (r && r.payload) || {}, mc = q.macro || {};
      if (!mc.vix) throw { code: "no_price" };
      const stamp = r.cache && r.cache.storedAt ? new Date(r.cache.storedAt) : new Date();
      render({ vix: mc.vix.value, fearGreed: mc.fear_and_greed ? mc.fear_and_greed.score : null, fgRating: mc.fear_and_greed ? cap(mc.fear_and_greed.rating) : "",
        spx: mc.spx ? mc.spx.value : m.spx, spxD1: mc.spx ? mc.spx.change_pct : m.spxD1 }, "Live from Flashalpha, " + stamp.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + ".");
      status.textContent = "";
    } catch (e) { status.textContent = liveErr(e); }
    finally { btn.disabled = false; }
  });
  const share = m.above200 / Math.max(1, m.with200);
  return panel("Market mood", "How nervous investors are", box, WEB ? null : el("div", { class: "row" }, btn, status),
    what("The VIX at " + (isNum(m.vix) ? m.vix.toFixed(1) : "—") + " says traders expect " + (m.vix < 15 ? "small" : m.vix < 22 ? "normal-size" : m.vix < 30 ? "bigger than usual" : "very large") + " swings. " +
      Math.round(share * 100) + "% of the 50 stocks here are above their 200-day average" + (share >= 0.6 ? ", so most are in uptrends." : share >= 0.4 ? ", a split market." : ", so most are in downtrends.") +
      " Historically, buying when others are fearful has worked better than buying when they're greedy, though fear can last a while."));
}

function exposurePanel() {
  let only = store.get("expOwned", false);
  const box = el("div");
  if (!MINE.size) only = false;
  const tog = el("label", { class: "row small", style: "gap:6px" }, el("input", { id: "exp-owned", type: "checkbox", checked: only ? "" : null, disabled: MINE.size ? null : "" }), MINE.size ? "Only my stocks" : "Only my stocks (mark some first)");
  function draw() {
    const rows = STOCKS.filter(s => !only || isMine(s.t)).map(s => ({ s, rate: s.risk.rate, oil: isNum(s.risk.oil) ? s.risk.oil * 10 : null, res: s.parts[8] ? s.parts[8][0] : null, beta: s.risk.beta }))
      .sort((a, b) => (isNum(a.rate) ? a.rate : 99) - (isNum(b.rate) ? b.rate : 99));
    const tag = r => {
      const out = [];
      if (isNum(r.rate) && r.rate <= -10) out.push(["Hurt by higher rates", "bad"]);
      if (isNum(r.rate) && r.rate >= 3) out.push(["OK with higher rates", "good"]);
      if (isNum(r.oil) && r.oil >= 2.5) out.push(["Gains with oil", "good"]);
      if (isNum(r.oil) && r.oil <= -2.5) out.push(["Hurt by oil", "bad"]);
      if (isNum(r.res) && r.res >= 8) out.push(["Recession-resistant", "good"]);
      if (isNum(r.res) && r.res <= 4) out.push(["Recession-sensitive", "warn"]);
      return out.length ? out.map(([t, c]) => el("span", { class: "pill " + c, style: "margin:1px 4px 1px 0" }, t)) : el("span", { class: "muted small" }, "No strong tilt");
    };
    box.replaceChildren(el("div", { class: "tablewrap" }, el("table", { class: "list" },
      el("thead", null, el("tr", null, el("th", { class: "sticky-col" }, "Company"), el("th", { class: "n" }, "Per +1 pt rates"), el("th", { class: "n" }, "Per +10% oil"), el("th", { class: "n" }, "Recession score"), el("th", { class: "n" }, "Beta"), el("th", null, "Today's economy"))),
      el("tbody", null, rows.map(r => el("tr", { class: isMine(r.s.t) ? "mine" : null, tabindex: 0, onclick: () => goStock(r.s.t), onkeydown: e => { if (e.key === "Enter") goStock(r.s.t); } },
        el("td", { class: "tick-name sticky-col" }, el("b", null, r.s.t), el("span", null, r.s.n)),
        el("td", { class: "n " + cls(r.rate) }, spct(r.rate, 0)), el("td", { class: "n " + cls(r.oil) }, spct(r.oil, 1)),
        el("td", { class: "n" }, isNum(r.res) ? r.res + "/10" : "—"), el("td", { class: "n" }, isNum(r.beta) ? r.beta.toFixed(2) : "—"),
        el("td", null, tag(r))))))));
  }
  tog.querySelector("input").addEventListener("change", e => { only = e.target.checked; store.set("expOwned", only); draw(); });
  draw();
  const own = mine().map(s => ({ s, rate: s.risk.rate })).filter(r => isNum(r.rate)).sort((a, b) => a.rate - b.rate);
  const worst = own.slice(0, 3).map(r => r.s.t + " (" + spct(r.rate, 0) + ")").join(", ");
  return panel("Your stocks vs. today's economy", "From monthly returns over the last 5 years", el("div", { class: "row" }, tog), box,
    what("“Per +1 pt rates” is how much the stock tended to move in months when the 10-year Treasury yield rose a full point; “per +10% oil” the same for oil." + (own.length ? " Of " + myLabel() + ", the most rate-sensitive have been " + worst + "." : "") + " These are tendencies measured over 5 years, not promises, and companies change."));
}

function fedEventsPanel() {
  const ev = D.fedEvents;
  let pick = store.get("fedPick", (mine()[0] || STOCKS[0]).t);
  if (!ev.rows.some(r => r.t === pick)) pick = (mine()[0] || STOCKS[0]).t;
  const sel = el("select", { id: "fed-pick", "aria-label": "Stock to compare" }, STOCKS.map(s => el("option", { value: s.t, selected: s.t === pick ? "" : null }, s.t + " · " + s.n)));
  const box = el("div");
  function draw() {
    const spy = ev.rows.find(r => r.t === "SPY"), st = ev.rows.find(r => r.t === pick);
    const cell = v => el("td", { class: "n " + cls(v) }, isNum(v) ? spct(v, 1) : "—");
    box.replaceChildren(el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, el("th", null, "Fed move"), el("th", null, "Date"), ["3 mo", "6 mo", "12 mo"].map(h => el("th", { class: "n" }, "S&P " + h)), ["3 mo", "6 mo", "12 mo"].map(h => el("th", { class: "n" }, pick + " " + h)))),
      el("tbody", null, ev.events.map((e, i) => el("tr", null,
        el("td", null, el("span", { class: "pill " + (e.dir === "cut" ? "good" : "bad") }, e.dir === "cut" ? "First cut" : "First hike")),
        el("td", null, dLabel(e.date)), (spy.r[i] || []).map(cell), (st && st.r[i] ? st.r[i] : [null, null, null]).map(cell)))))));
  }
  sel.addEventListener("input", () => { pick = sel.value; store.set("fedPick", pick); draw(); });
  draw();
  return panel("What happened after the Fed changed direction", "Price returns from the month before each move",
    el("div", { class: "row" }, el("label", { class: "small", for: "fed-pick" }, "Compare with"), sel), box,
    what("Each row is the first move of a new cycle, or the first move after a long pause. Cuts don't always help: after the first cut in Sept 2007 the S&P 500 fell as the financial crisis hit, while after the 2019, 2024 and 2025 cuts it rose. After the 2022 first hike, stocks fell for a year as the Fed kept going. The newest row, Sept 2026, is a fresh hike with no results yet. A handful of events is a small sample, so treat this as history, not a forecast."));
}
