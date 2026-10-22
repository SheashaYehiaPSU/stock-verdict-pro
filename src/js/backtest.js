/* ============================================================
   Backtest: simple, honest rules tested on real monthly prices
   ============================================================ */
const STRATS = [
  ["bh", "Buy and hold", "Buy once at the start and never sell."],
  ["dca", "Invest every month", "Put the same amount in at the end of every month, no matter the price."],
  ["trend", "Follow the trend", "Own the stock only while its price is above its 10-month average (about the 200-day average); otherwise sit in cash earning Treasury-bill interest."],
  ["pe", "Buy when the P/E is low", "Own the stock only while its P/E is below its own median of the previous 5 years; otherwise hold cash. Uses only earnings that had been reported at the time."],
  ["dip", "Buy the dip", "Stay in cash until the price is 20% or more below its 12-month high, then buy and hold for 12 months; repeat."]
];
const BILL = D.macro.bill;

function btSeries(t) {
  if (t === "SPY" || t === "QQQ") return { t, name: t === "SPY" ? "S&P 500 (SPY)" : "Nasdaq 100 (QQQ)", ma: D.bench[t].ma, mc: D.bench[t].mc, pe: null };
  const s = BY.get(t);
  return { t, name: s.n, ma: s.ma, mc: s.mc, pe: s.pe && s.pe.m ? s.pe.m : null };
}
function median(xs) { const v = xs.filter(isNum).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }

/** Run one rule on one series, months i0..i1 of CAL.m. Returns values per month and details. */
function runRule(ser, rule, i0, i1, amount, monthly) {
  const ma = ser.ma, mc = ser.mc, pe = ser.pe;
  const has = t => isNum(ma[t]);
  let held = 0; // months held in the current dip trade
  const events = [];
  function want(t) {
    if (!has(t)) return false;
    if (rule === "bh" || rule === "dca") return true;
    if (rule === "trend") {
      if (t < 9) return false;
      const w = mc.slice(t - 9, t + 1);
      if (w.some(v => !isNum(v))) return false;
      return mc[t] > w.reduce((a, b) => a + b, 0) / 10;
    }
    if (rule === "pe") {
      if (!pe || !isNum(pe[t])) return false;
      const past = pe.slice(Math.max(0, t - 60), t).filter(isNum);
      if (past.length < 24) return false;
      return pe[t] < median(past);
    }
    if (rule === "dip") {
      if (held > 0 && held <= 12) return true; // bought at a month end, sold 12 month ends later
      const w = mc.slice(Math.max(0, t - 11), t + 1).filter(isNum);
      if (w.length < 6) return false;
      const hi = Math.max(...w);
      if (mc[t] <= hi * 0.8) {
        events.push({ t, drop: (mc[t] / hi - 1) * 100 });
        held = 0;
        return true;
      }
      return false;
    }
    return false;
  }
  const lump = rule !== "dca";
  let stock = 0, cash = 0, inStock = false, trades = 0, monthsIn = 0, contributed = 0;
  const vals = [], twr = [], flows = [];
  // start
  if (lump) { cash = amount; contributed = amount; }
  else { cash = monthly; contributed = monthly; }
  flows.push(-(lump ? amount : monthly));
  if (want(i0)) { stock = cash; cash = 0; inStock = true; trades++; if (rule === "dip") held = 1; }
  vals.push(stock + cash); twr.push(1);
  for (let t = i0 + 1; t <= i1; t++) {
    const before = stock + cash;
    if (inStock && has(t) && has(t - 1)) stock *= ma[t] / ma[t - 1];
    cash *= 1 + (isNum(BILL[t - 1]) ? BILL[t - 1] : 0) / 1200;
    if (inStock) monthsIn++;
    const after = stock + cash;
    twr.push(twr[twr.length - 1] * (before > 0 ? after / before : 1));
    if (!lump) { (has(t) ? (inStock = true) : 0); if (has(t)) stock += monthly; else cash += monthly; contributed += monthly; flows.push(-monthly); }
    else flows.push(0);
    if (rule === "dip" && inStock) held++;
    const w = want(t);
    if (lump || rule === "dca") {
      if (w && !inStock && has(t)) { stock += cash; cash = 0; inStock = true; trades++; if (rule === "dip") held = 1; }
      else if (!w && inStock && rule !== "dca") { cash += stock; stock = 0; inStock = false; trades++; held = 0; }
    }
    vals.push(stock + cash);
  }
  flows[flows.length - 1] += vals[vals.length - 1];
  return { vals, twr, trades, timeIn: monthsIn / Math.max(1, i1 - i0), contributed, flows, events, lump };
}
function irr(flows) {
  const npv = r => flows.reduce((a, cf, k) => a + cf / Math.pow(1 + r, k), 0);
  let lo = -0.5, hi = 0.5;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (npv(lo) * npv(m) <= 0) hi = m; else lo = m; }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}
function btStats(res) {
  const v = res.vals, w = res.twr, n = v.length - 1;
  const years = n / 12;
  // under a year, a yearly rate would exaggerate; leave it blank and show the total instead
  const cagr = n < 12 ? null : res.lump ? Math.pow(v[n] / v[0], 1 / years) - 1 : irr(res.flows);
  let peak = w[0], mdd = 0;
  w.forEach(x => { peak = Math.max(peak, x); mdd = Math.min(mdd, x / peak - 1); });
  const rets = []; for (let i = 1; i < w.length; i++) rets.push(w[i] / w[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length)) * Math.sqrt(12);
  let best = null, worst = null;
  for (let i = 12; i < w.length; i++) { const r = w[i] / w[i - 12] - 1; best = best == null ? r : Math.max(best, r); worst = worst == null ? r : Math.min(worst, r); }
  return { final: v[n], contributed: res.contributed, total: (v[n] / res.contributed - 1) * 100, cagr: isNum(cagr) ? cagr * 100 : null, mdd: mdd * 100, vol: vol * 100,
    best: isNum(best) ? best * 100 : null, worst: isNum(worst) ? worst * 100 : null, timeIn: res.timeIn * 100, trades: res.trades };
}
/** Equal amounts in several series, each running the rule on its own (no rebalancing). */
function runBasket(tickers, rule, i0, i1, amount, monthly) {
  const parts = tickers.map(t => runRule(btSeries(t), rule, i0, i1, amount / tickers.length, monthly / tickers.length));
  const n = parts[0].vals.length;
  const vals = [], twr = [1];
  for (let k = 0; k < n; k++) vals.push(parts.reduce((a, p) => a + p.vals[k], 0));
  for (let k = 1; k < n; k++) {
    const add = rule === "dca" ? monthly : 0;
    twr.push(twr[k - 1] * (vals[k - 1] > 0 ? (vals[k] - add) / vals[k - 1] : 1));
  }
  const flows = parts[0].flows.map((_, k) => parts.reduce((a, p) => a + p.flows[k], 0));
  return { vals, twr, trades: parts.reduce((a, p) => a + p.trades, 0), timeIn: parts.reduce((a, p) => a + p.timeIn, 0) / parts.length,
    contributed: parts.reduce((a, p) => a + p.contributed, 0), flows, events: [], lump: rule !== "dca" };
}

RENDER.backtest = function (root) {
  const st = Object.assign({ pick: MINE.size ? "PORT" : "SPY", rule: "trend", start: 2016, amount: 10000, monthly: 500 }, store.get("bt", {}));
  if (st.pick === "PORT" && !MINE.size) st.pick = "SPY";
  const btPick = store.get("btPick", null);
  if (btPick && BY.has(btPick)) { st.pick = btPick; store.set("btPick", null); }
  root.append(el("div", { class: "page-head" }, el("div", null,
    el("div", { class: "eyebrow" }, "Test before you trust"),
    el("h1", null, "Backtest"),
    el("p", null, "Try simple buying rules on real monthly prices back to 2005 and see how they would have done against just holding, and against the S&P 500."))));

  const pickSel = el("select", { id: "bt-pick", "aria-label": "What to test" },
    el("option", { value: "PORT", disabled: MINE.size ? null : "" }, MINE.size ? "My " + MINE.size + " stocks (equal amounts)" : "My stocks (mark them on the Home page first)"), el("option", { value: "SPY" }, "S&P 500 (SPY)"), el("option", { value: "QQQ" }, "Nasdaq 100 (QQQ)"),
    el("optgroup", { label: "Single stocks" }, STOCKS.map(s => el("option", { value: s.t }, s.t + " · " + s.n))));
  pickSel.value = st.pick;
  const ruleSel = el("select", { id: "bt-rule", "aria-label": "Rule" }, STRATS.map(([k, n]) => el("option", { value: k }, n)));
  ruleSel.value = st.rule;
  const startSel = el("select", { id: "bt-start", "aria-label": "Start year" });
  const amtIn = el("input", { id: "bt-amt", type: "number", min: "100", step: "100", value: st.amount, style: "width:8em" });
  const monIn = el("input", { id: "bt-mon", type: "number", min: "10", step: "10", value: st.monthly, style: "width:7em" });
  const amtField = el("label", { class: "field", for: "bt-amt" }, "Starting amount ($)", amtIn);
  const monField = el("label", { class: "field", for: "bt-mon" }, "Each month ($)", monIn);
  const ruleNote = el("p", { class: "note" });
  const out = el("div", { class: "stack" });
  root.append(panel("Set up the test", null,
    el("div", { class: "row", style: "align-items:end;gap:12px" },
      el("label", { class: "field", for: "bt-pick" }, "What to test", pickSel), el("label", { class: "field", for: "bt-rule" }, "Rule", ruleSel),
      el("label", { class: "field", for: "bt-start" }, "Start", startSel), amtField, monField),
    ruleNote), out);

  function firstMonth(t) {
    if (t === "PORT") return mine().length ? Math.max(0, Math.min(...mine().map(s => firstIdx(s.ma)))) : 0;
    return Math.max(0, firstIdx(btSeries(t).ma));
  }
  let listedAt = 0;
  function fillStarts() {
    const f = firstMonth(pickSel.value);
    listedAt = f;
    const y0 = Math.max(2006, +CAL.m[f].slice(0, 4) + (CAL.m[f].slice(5) === "01" ? 0 : 1));
    const keep = startSel.value || String(st.start);
    const opts = [];
    if (f > 0 && pickSel.value !== "PORT") opts.push(el("option", { value: "L" }, "Since it listed (" + dLabel(CAL.m[f], "my") + ")"));
    for (let y = y0; y <= 2025; y++) opts.push(el("option", { value: String(y) }, String(y)));
    startSel.replaceChildren(...opts);
    const vals = opts.map(o => o.value);
    startSel.value = vals.includes(keep) ? keep : vals.includes(String(st.start)) ? String(st.start) : (vals.includes("2016") ? "2016" : vals[0]);
  }
  function run() {
    st.pick = pickSel.value; st.rule = ruleSel.value; st.amount = Math.max(100, +amtIn.value || 10000); st.monthly = Math.max(10, +monIn.value || 500);
    if (startSel.value !== "L") st.start = +startSel.value;
    store.set("bt", st);
    const rule = st.rule, dca = rule === "dca";
    amtField.hidden = dca; monField.hidden = !dca;
    ruleNote.textContent = STRATS.find(x => x[0] === rule)[2];
    const iy = CAL.m.indexOf(startSel.value + "-01");
    const i0 = startSel.value === "L" ? listedAt : iy > 0 ? iy - 1 : 0; // a January start begins at the end of the prior December
    const i1 = CAL.m.length - 1;
    const isPort = st.pick === "PORT";
    const tick = isPort ? mine().map(s => s.t) : [st.pick];
    const name = isPort ? cap(myLabel()) : btSeries(st.pick).name;
    const main = isPort ? runBasket(tick, rule, i0, i1, st.amount, st.monthly) : runRule(btSeries(st.pick), rule, i0, i1, st.amount, st.monthly);
    const hold = rule === "bh" || dca ? null : (isPort ? runBasket(tick, "bh", i0, i1, st.amount, 0) : runRule(btSeries(st.pick), "bh", i0, i1, st.amount, 0));
    const selfSpy = st.pick === "SPY";
    const spy = runRule(btSeries("SPY"), dca ? "dca" : "bh", i0, i1, st.amount, st.monthly);
    const labels = CAL.m.slice(i0, i1 + 1);
    const series = [{ name: STRATS.find(x => x[0] === rule)[1] + " · " + (isPort ? "my stocks" : st.pick), values: main.vals, color: "var(--s1)" }];
    if (hold) series.push({ name: "Buy and hold " + (isPort ? "my stocks" : st.pick), values: hold.vals, color: "var(--s3)" });
    if (!selfSpy || hold) series.push({ name: dca ? "Monthly into S&P 500" : "S&P 500, buy and hold", values: spy.vals, color: "var(--ink-3)", width: 1.5, faint: true });
    if (dca) series.push({ name: "Money you put in", values: labels.map((_, k) => st.monthly * (k + 1)), color: "var(--s2)", width: 1.5, dot: false });
    const A = btStats(main), B = hold ? btStats(hold) : null, C = btStats(spy);
    const fmt$ = v => "$" + (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(0) + "K" : Math.round(v).toLocaleString());
    const cols = [["This rule", A], B ? ["Buy and hold", B] : null, selfSpy ? null : ["S&P 500", C]].filter(Boolean);
    const row = (lbl, f, better) => {
      const vals = cols.map(c => f(c[1]));
      return el("tr", null, el("td", null, el("b", null, lbl)), cols.map((c, i) => el("td", { class: "n", style: i === 0 && better && better(c[1], cols) ? "background:var(--good-soft);font-weight:700" : null }, vals[i])));
    };
    const beatsAll = (a, cs, key, hi) => cs.slice(1).every(c => hi ? a[key] >= c[1][key] : a[key] <= c[1][key]);
    const tbl = el("table", null,
      el("thead", null, el("tr", null, el("th", null, ""), cols.map(c => el("th", { class: "n" }, c[0])))),
      el("tbody", null,
        row(dca ? "You put in" : "Started with", s => fmt$(s.contributed)),
        row("Ended with", s => fmt$(s.final), (a, cs) => beatsAll(a, cs, "final", true)),
        row(dca ? "Yearly return on your money" : "Yearly return", s => spct(s.cagr, 1), (a, cs) => beatsAll(a, cs, "cagr", true)),
        row("Worst drop along the way", s => spct(s.mdd, 0), (a, cs) => beatsAll(a, cs, "mdd", true)),
        row("Typical yearly swing (volatility)", s => pct(s.vol, 0), (a, cs) => beatsAll(a, cs, "vol", false)),
        row("Best 12 months", s => spct(s.best, 0)), row("Worst 12 months", s => spct(s.worst, 0)),
        row("Time invested", s => pct(s.timeIn, 0)), row("Trades", s => String(s.trades))));
    const yrs = ((i1 - i0) / 12).toFixed(1);
    const vsHold = B ? A.cagr - B.cagr : null, vsSpy = A.cagr - C.cagr;
    const msg = [];
    const short = !isNum(A.cagr);
    msg.push("From " + dLabel(CAL.m[Math.min(i1, i0 + 1)], "my") + " to " + dLabel(CAL.m[i1], "my") + " (" + yrs + " years), " + (dca ? "investing " + money0(st.monthly) + " a month in " + name + " turned " + fmt$(A.contributed) + " into " + fmt$(A.final) : "the rule turned " + fmt$(st.amount) + " into " + fmt$(A.final)) + (short ? " (" + spct(A.total, 1) + " in total)." : ", " + spct(A.cagr, 1) + " a year."));
    if (B && !short) msg.push((vsHold >= 0 ? "That beat" : "That trailed") + " simply holding by " + Math.abs(vsHold).toFixed(1) + " points a year, " + (A.mdd > B.mdd ? "with a smaller worst drop (" + spct(A.mdd, 0) + " vs. " + spct(B.mdd, 0) + ")." : "and its worst drop was no smaller (" + spct(A.mdd, 0) + " vs. " + spct(B.mdd, 0) + ")."));
    if (!selfSpy && !short) msg.push((vsSpy >= 0 ? "It beat" : "It trailed") + " the S&P 500 by " + Math.abs(vsSpy).toFixed(1) + " points a year.");
    if (i1 - i0 < 24) msg.push("That's less than two years of history, far too short to judge a rule.");
    if (rule === "trend") msg.push("Trend rules usually give up some return in steady bull markets in exchange for sidestepping part of big crashes like 2008 and 2022.");
    if (rule === "pe") msg.push(!isPort && !(btSeries(st.pick).pe || []).some(isNum) ? "This stock has no usable P/E history (losses or tiny earnings), so the rule never buys it." : "P/E rules work best on steady companies; for fast growers the P/E can look \"high\" for years while the stock keeps climbing.");
    if (rule === "dca") msg.push("Monthly investing doesn't always beat a lump sum (markets rise more often than they fall), but it removes the risk of putting everything in at a peak.");
    const allV = series.flatMap(s => s.values).filter(v => isNum(v) && v > 0);
    const autoLog = Math.max(...allV) / Math.min(...allV) > 6;
    const scale = st.scale || (autoLog ? "log" : "lin");
    const scaleSeg = seg([["lin", "Dollar scale"], ["log", "Log scale"]], scale, v => { st.scale = v; store.set("bt", st); run(); }, "Chart scale");
    out.replaceChildren(
      panel("Results", name + " · " + STRATS.find(x => x[0] === rule)[1],
        el("div", { class: "chart-tools" }, scaleSeg, el("span", { class: "note" }, scale === "log" ? "Log scale: equal heights mean equal percentage moves." : "")),
        lineChart({ labels, series, log: scale === "log", yFmt: v => fmt$(v), tipFmt: v => money0(v), xStyle: "y", tipStyle: "my", ariaLabel: "Backtest results" }),
        el("div", { class: "legend" }, series.map(s => el("span", null, el("i", { class: "line", style: "--c:" + s.color }), s.name))),
        el("div", { class: "tablewrap" }, tbl), what(msg.join(" ")),
        rule === "dip" && !isPort ? dipTable(st.pick, main.events, i1) : null),
      cautions());
  }
  [pickSel, ruleSel, startSel, amtIn, monIn].forEach(x => x.addEventListener("input", () => { if (x === pickSel) fillStarts(); run(); }));
  fillStarts();
  run();
  root.append(ruleCheck());
  root.append(holdingsPanel());
};

function dipTable(t, events, i1) {
  const ser = btSeries(t), spy = btSeries("SPY");
  if (!events.length) return el("p", { class: "note" }, "No 20% dips in this period, so the rule stayed in cash the whole time.");
  const rows = events.map(e => {
    const j = e.t + 12;
    const r = j <= i1 && isNum(ser.ma[j]) ? (ser.ma[j] / ser.ma[e.t] - 1) * 100 : null;
    const rs = j <= i1 && isNum(spy.ma[j]) ? (spy.ma[j] / spy.ma[e.t] - 1) * 100 : null;
    return [dLabel(CAL.m[e.t], "my"), spct(e.drop, 0), spct(r, 0), spct(rs, 0), r != null && rs != null ? (r > rs ? "Beat" : "Lagged") : "Still open"];
  });
  const done = events.filter(e => e.t + 12 <= i1);
  const wins = done.filter(e => isNum(ser.ma[e.t + 12]) && ser.ma[e.t + 12] > ser.ma[e.t]).length;
  return el("div", { class: "stack" }, el("h3", null, "Every dip it bought"),
    el("div", { class: "tablewrap" }, el("table", null, el("thead", null, el("tr", null, ["Bought", "Below 12-mo high", t + " next 12 mo", "S&P next 12 mo", "vs. S&P"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", null, rows.map(r => el("tr", null, r.map((c, i) => el("td", { class: i ? "n" : null }, c))))))),
    el("p", { class: "note" }, done.length ? wins + " of " + done.length + " finished dips were higher 12 months later." : "No dip has finished its 12 months yet."));
}

function cautions() {
  return panel("Read before you trust a backtest", null, el("ul", { style: "margin:0;padding-left:18px;display:grid;gap:8px" },
    el("li", null, el("b", null, "Hindsight in the list. "), "These 50 stocks were picked in 2026, partly because they're big and successful today. Testing them on the past flatters every rule, because the companies that failed aren't in the list."),
    el("li", null, el("b", null, "Why the scores aren't backtested. "), "The 100-point scores and price zones use what was known on Oct 1, 2026. Applying them to 2015 prices would use information nobody had then. The fair way to test them is forward: come back in 6 or 12 months and compare."),
    el("li", null, el("b", null, "Real-life costs. "), "Taxes on gains, trading fees and the price moves you'd miss by trading at month end are not included. Rules that trade more lose more to these."),
    el("li", null, el("b", null, "Monthly data. "), "Rules are checked at the end of each month, so moves inside a month are smoothed over."),
    el("li", null, el("b", null, "The past doesn't repeat exactly. "), "A rule that worked from 2010 to 2026 can stop working, especially once many people use it.")));
}

/** Each rule vs. buy-and-hold for every stock, over the last 10 years (or since it listed). */
function ruleCheck() {
  const i1 = CAL.m.length - 1, rules = ["dca", "trend", "pe", "dip"];
  const res = {};
  rules.forEach(r => res[r] = { n: 0, beat: 0, safer: 0, diff: [] });
  STOCKS.forEach(s => {
    const f = firstIdx(s.ma);
    const i0 = Math.max(f, i1 - 120);
    if (i1 - i0 < 48) return;
    const ser = btSeries(s.t);
    const b = btStats(runRule(ser, "bh", i0, i1, 10000, 0));
    rules.forEach(r => {
      if (r === "pe" && (!ser.pe || ser.pe.slice(i0).filter(isNum).length < 36)) return;
      // monthly investing is judged on the yearly return on the money put in (IRR) vs. the lump sum's yearly return
      const a = btStats(runRule(ser, r, i0, i1, 10000, 100));
      const x = res[r];
      x.n++;
      if (a.cagr > b.cagr) x.beat++;
      if (r !== "dca" && a.mdd > b.mdd + 0.5) x.safer++;
      x.diff.push(a.cagr - b.cagr);
    });
  });
  const name = k => STRATS.find(x => x[0] === k)[1];
  return panel("Does any rule beat just holding?", "Each rule on every stock with 4+ years of data, over the last 10 years",
    el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Rule", "Stocks tested", "Beat buy-and-hold", "Median difference per year", "Had a smaller worst drop"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", null, rules.map(r => { const x = res[r]; return el("tr", null, el("td", null, el("b", null, name(r))), el("td", { class: "n" }, String(x.n)), el("td", { class: "n" }, x.beat + " of " + x.n),
        el("td", { class: "n " + cls(median(x.diff)) }, spct(median(x.diff), 1) + " pts"), el("td", { class: "n" }, r === "dca" ? "—" : x.safer + " of " + x.n)); })))),
    what("For most of these stocks, the simple rules made less money than just buying and holding over the last 10 years, a strong decade for big US stocks. Their main benefit is often a smaller worst drop, which can make it easier to stay invested. Monthly investing is compared on the yearly return on the money you put in."),
    el("p", { class: "note" }, "Survivorship bias applies here too: every stock in this list survived and grew, which favors holding."));
}

/** Your stocks vs. the S&P 500 over standard periods (equal amounts, no rebalancing). */
function holdingsPanel() {
  if (!MINE.size) return panel("Your stocks vs. the S&P 500", null, el("p", { class: "lede" }, "Mark the stocks you own (on the Home page or any stock page) to see how an equal-weight version of your portfolio did against the S&P 500 over 1, 3, 5 and 10 years."), el("div", null, link("home", { class: "btn ghost" }, "Pick my stocks")));
  const OWNED = mine();
  const i1 = CAL.m.length - 1, spans = [1, 3, 5, 10];
  const rows = spans.map(y => {
    const i0 = i1 - y * 12;
    const avail = OWNED.filter(s => isNum(s.ma[i0]));
    if (!avail.length) return null;
    const p = btStats(runBasket(avail.map(s => s.t), "bh", i0, i1, 10000, 0));
    const m = btStats(runRule(btSeries("SPY"), "bh", i0, i1, 10000, 0));
    return { y, n: avail.length, miss: OWNED.filter(s => !isNum(s.ma[i0])).map(s => s.t), p, m };
  }).filter(Boolean);
  const each = OWNED.map(s => ({ s, y1: s.px.y1, tr3: s.px.tr3, tr5: s.px.tr5 }));
  return panel(cap(myLabel()) + " vs. the S&P 500", "Equal amounts in each, bought at the start, dividends reinvested",
    el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Period", "$10K in your stocks became", "Per year", "$10K in the S&P 500 became", "Per year", "Worst drop (yours vs. S&P)"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", null, rows.map(r => el("tr", null, el("td", null, el("b", null, r.y + (r.y === 1 ? " year" : " years")), r.miss.length ? el("div", { class: "small muted" }, "without " + r.miss.join(", ") + " (not listed yet)") : null),
        el("td", { class: "n" }, money0(r.p.final)), el("td", { class: "n " + cls(r.p.cagr - r.m.cagr) }, spct(r.p.cagr, 1)), el("td", { class: "n" }, money0(r.m.final)), el("td", { class: "n" }, spct(r.m.cagr, 1)),
        el("td", { class: "n" }, spct(r.p.mdd, 0) + " vs. " + spct(r.m.mdd, 0))))))),
    el("div", { class: "tablewrap" }, el("table", { class: "list" },
      el("thead", null, el("tr", null, ["Holding", "1 year", "3 yrs, per year", "5 yrs, per year"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", null, each.map(r => el("tr", { tabindex: 0, onclick: () => goStock(r.s.t), onkeydown: e => { if (e.key === "Enter") goStock(r.s.t); } },
        el("td", { class: "tick-name" }, el("b", null, r.s.t), el("span", null, r.s.n)), el("td", { class: "n " + cls(r.y1) }, spct(r.y1, 0)), el("td", { class: "n " + cls(r.tr3) }, spct(r.tr3, 1)), el("td", { class: "n " + cls(r.tr5) }, spct(r.tr5, 1))))))),
    what("This shows how a simple equal-weight version of your current portfolio would have done if you had bought it at the start of each period. Your real results depend on when you actually bought and how much of each you own."));
}
