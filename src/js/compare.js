/* ============================================================
   Compare: up to four stocks on one chart and one table
   ============================================================ */
const CMP_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s7)"];

RENDER.compare = function (root) {
  let picks = (store.get("cmp", null) || (mine().length ? mine() : [...STOCKS].sort((a, b) => score(b) - score(a))).slice(0, 3).map(s => s.t)).filter(t => BY.has(t)).slice(0, 4);
  let range = store.get("cmpRange", "1y");
  root.append(el("div", { class: "page-head" }, el("div", null,
    el("div", { class: "eyebrow" }, "Side by side"),
    el("h1", null, "Compare"),
    el("p", null, "Pick up to four stocks. The chart shows how each one's price changed over the same period; the table lines up every number and signal."))));
  const chipsBox = el("div", { class: "row", style: "gap:6px" });
  const chartBox = el("div", { class: "stack" });
  const tableBox = el("div", { class: "stack" });
  const pnlPick = panel("Choose stocks", null, chipsBox, el("p", { class: "note" }, "Tap a ticker to add or remove it. Stocks you own are outlined."));
  const pnlChart = panel("Price change", null, el("div", { class: "chart-tools" }, seg([["3m", "3M"], ["1y", "1Y"], ["3y", "3Y"], ["5y", "5Y"], ["10y", "10Y"]], range, v => { range = v; store.set("cmpRange", v); drawChart(); }, "Time range")), chartBox);
  const pnlTable = panel("Numbers and signals", "Best value in each row is marked", tableBox);
  root.append(pnlPick, pnlChart, pnlTable);

  function drawChips() {
    chipsBox.replaceChildren(...STOCKS.map(s => {
      const on = picks.includes(s.t), idx = picks.indexOf(s.t);
      return el("button", { type: "button", class: "pill " + (on ? "info" : "na"), "aria-pressed": String(on), style: (isMine(s.t) ? "box-shadow:inset 0 0 0 1.5px var(--accent);" : "") + "cursor:pointer;font-family:var(--mono);font-size:12.5px",
        onclick: () => { if (on) picks = picks.filter(x => x !== s.t); else if (picks.length < 4) picks = [...picks, s.t]; else picks = [...picks.slice(1), s.t]; store.set("cmp", picks); drawAll(); } },
        on ? el("i", { style: `display:inline-block;width:10px;height:10px;border-radius:3px;background:${CMP_COLORS[idx]}` }) : null, s.t);
    }));
  }
  function drawChart() {
    if (!picks.length) { chartBox.replaceChildren(el("p", { class: "note" }, "Pick at least one stock above.")); return; }
    let labels, getv, style;
    if (range === "3m" || range === "1y") { const n = range === "3m" ? 64 : 253; labels = CAL.d.slice(-n); getv = s => s.d.slice(-n); style = "md"; }
    else if (range === "3y" || range === "5y") { const n = range === "3y" ? 157 : 261; labels = CAL.w.slice(-n); getv = s => s.w.slice(-n); style = "my"; }
    else { labels = CAL.w; getv = s => s.w; style = "y"; }
    const bench = range === "3m" || range === "1y" ? D.bench.SPY.d.slice(-labels.length) : range === "10y" ? D.bench.SPY.w : D.bench.SPY.w.slice(-labels.length);
    const norm = arr => { const f = firstIdx(arr); if (f < 0) return arr.map(() => null); const b = arr[f]; return arr.map(v => isNum(v) ? (v / b - 1) * 100 : null); };
    const series = picks.map((t, i) => ({ name: t, values: norm(getv(BY.get(t))), color: CMP_COLORS[i] }));
    series.push({ name: "S&P 500", values: norm(bench), color: "var(--ink-3)", width: 1.5, faint: true });
    const late = picks.filter(t => firstIdx(getv(BY.get(t))) > 0);
    chartBox.replaceChildren(
      lineChart({ labels, series, zero: true, yFmt: v => spct(v, 0), tipFmt: v => spct(v, 1), xStyle: style, tipStyle: style === "md" ? null : "my", ariaLabel: "Price change comparison" }),
      el("div", { class: "legend" }, series.map(s => el("span", null, el("i", { class: "line", style: "--c:" + s.color }), s.name + " " + spct(s.values[lastIdx(s.values)], 0)))),
      late.length ? el("p", { class: "note" }, late.join(", ") + " started trading later, so " + (late.length > 1 ? "their lines start" : "its line starts") + " at its first price.") : null,
      el("p", { class: "note" }, "Price change only; dividends are not included here (the table's yearly returns include them)."));
  }
  function drawTable() {
    if (!picks.length) { tableBox.replaceChildren(); return; }
    const S = picks.map(t => BY.get(t));
    const R = S.map(s => {
      const p = curPrice(s), k = fairModel(s, p), z = zone(k), sg = signals(s, p), c = sigCount(sg), pp = pePlain(s, p), fe = fwdEps(s);
      const dv = dcfValue(dcfParams(s)), cons = consensusTarget(s), f = s.fin || {}, mcap = p * s.sh;
      return { s, p, z, c, sc: score(s), pe: pp ? pp.pe : null, peRel: pp && s.pe.s5 ? (pp.pe / s.pe.s5.med - 1) * 100 : null, fpe: fe ? p / fe.v : null,
        dcf: dv && s.dcf.cf0 > 0 ? (dv.perShare / p - 1) * 100 : null, an: isNum(cons) ? (cons / p - 1) * 100 : null,
        fcfy: f.fcf && mcap ? f.fcf / mcap * 100 : null, dy: f.dividend > 0 ? f.dividend / p * 100 : 0, opm: f.opMargin, nc: isNum(f.cash) && isNum(f.debt) ? f.cash - f.debt : null };
    });
    // [label, value fn, display fn, better: "hi" | "lo" | null]
    const rows = [
      ["Price", r => r.p, r => moneyAuto(r.p), null],
      ["Score", r => r.sc, r => r.sc + "/100", "hi"],
      ["Price zone", r => null, r => el("span", { class: "pill " + r.z.cls }, r.z.call), null],
      ["Good signals", r => r.c.good, r => r.c.good + " of 8", "hi"],
      ["P/E (12 months)", r => r.pe, r => mult(r.pe), "lo"],
      ["P/E vs. its 5-yr median", r => r.peRel, r => spct(r.peRel, 0), "lo"],
      ["Forward P/E", r => r.fpe, r => mult(r.fpe), "lo"],
      ["DCF vs. price", r => r.dcf, r => spct(r.dcf, 0), "hi"],
      ["Analyst upside", r => r.an, r => spct(r.an, 0), "hi"],
      ["Return, 1 year", r => r.s.px.y1, r => spct(r.s.px.y1, 0), "hi"],
      ["Return, 5 yrs (per year)", r => r.s.px.tr5, r => spct(r.s.px.tr5, 1), "hi"],
      ["Volatility (yearly)", r => r.s.px.vol, r => pct(r.s.px.vol, 0), "lo"],
      ["Worst drop, 5 yrs", r => r.s.px.mdd5, r => spct(r.s.px.mdd5, 0), "hi"],
      ["Beta", r => r.s.risk.beta, r => isNum(r.s.risk.beta) ? r.s.risk.beta.toFixed(2) : "—", null],
      ["Per +1 pt in rates", r => r.s.risk.rate, r => spct(r.s.risk.rate, 0), "hi"],
      ["Recession score", r => r.s.parts[8] ? r.s.parts[8][0] : null, r => (r.s.parts[8] ? r.s.parts[8][0] : "—") + "/10", "hi"],
      ["Operating margin", r => r.opm, r => pct(r.opm, 0), "hi"],
      ["Free-cash-flow yield", r => r.fcfy, r => pct(r.fcfy, 1), "hi"],
      ["Dividend yield", r => r.dy, r => r.dy ? pct(r.dy, 2) : "None", "hi"],
      ["Net cash (debt)", r => r.nc, r => isNum(r.nc) ? (r.nc >= 0 ? big(r.nc) : "(" + big(-r.nc) + ")") : "—", "hi"],
      ["Insider buys, 12 months", r => r.s.oi && !FOREIGN.has(r.s.t) ? r.s.oi.m12.bought : null, r => r.s.oi && !FOREIGN.has(r.s.t) ? (r.s.oi.m12.buys ? bigUsd(r.s.oi.m12.bought) : "None") : "n/a", "hi"],
      ["Owned by funds", r => r.s.inst ? r.s.inst.pct : null, r => pct(r.s.inst && r.s.inst.pct, 0), null],
      ["Next earnings", r => null, r => r.s.ed ? dLabel(r.s.ed.date, "md") : "—", null]
    ];
    const best = (fn, dir) => {
      if (!dir || R.length < 2) return -1;
      const vals = R.map(fn);
      let bi = -1;
      vals.forEach((v, i) => { if (isNum(v) && (bi < 0 || (dir === "hi" ? v > vals[bi] : v < vals[bi]))) bi = i; });
      return bi;
    };
    const tbl = el("table", null,
      el("thead", null, el("tr", null, el("th", { class: "sticky-col" }, ""), R.map((r, i) => el("th", { class: "n" }, el("span", { style: `display:inline-block;width:10px;height:10px;border-radius:3px;background:${CMP_COLORS[i]};margin-right:6px` }), r.s.t)))),
      el("tbody", null, rows.map(([label, fn, show, dir]) => {
        const bi = best(fn, dir);
        return el("tr", null, el("td", { class: "sticky-col" }, el("b", null, label)), R.map((r, i) => el("td", { class: "n", style: i === bi ? "background:var(--good-soft);font-weight:700" : null }, show(r))));
      })));
    const top = (fn, dir) => { const i = best(fn, dir); return i >= 0 ? R[i].s.t : null; };
    const lines = [];
    if (R.length > 1) {
      const a = top(r => r.sc, "hi"), b = top(r => r.peRel, "lo"), c = top(r => r.c.good, "hi"), d = top(r => r.s.px.vol, "lo");
      if (a) lines.push(a + " has the highest business score.");
      if (b) lines.push(b + " is cheapest compared with its own P/E history.");
      if (c) lines.push(c + " has the most good signals at today's price.");
      if (d) lines.push(d + " has been the calmest to own.");
    }
    tableBox.replaceChildren(el("div", { class: "tablewrap" }, tbl), lines.length ? what(lines.join(" ")) : null,
      el("div", { class: "row" }, S.map(s => el("button", { class: "btn ghost", type: "button", onclick: () => goStock(s.t) }, "Open " + s.t))));
  }
  function drawAll() { drawChips(); drawChart(); drawTable(); }
  drawAll();
};
