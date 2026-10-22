/* ============================================================
   All stocks: one sortable, filterable table of the 50
   ============================================================ */
const LIST_STATE = { q: "", group: "", owned: false, zone: "", sort: "score", dir: -1 };

function rowData(s) {
  const p = curPrice(s), k = fairModel(s, p), z = zone(k), sg = signals(s, p), c = sigCount(sg);
  const pe = peNow(s, p), fe = fwdEps(s);
  const dv = dcfValue(dcfParams(s));
  const cons = consensusTarget(s);
  return {
    s, p, z, sc: score(s), d1: s.px.d1, y1: s.px.y1, pe,
    peRel: pe && s.pe.s5 ? (pe / s.pe.s5.med - 1) * 100 : null,
    fpe: fe ? p / fe.v : null,
    dcf: dv && s.dcf.cf0 > 0 ? (dv.perShare / p - 1) * 100 : null,
    an: isNum(cons) ? (cons / p - 1) * 100 : null,
    good: c.good, bad: c.bad
  };
}

RENDER.stocks = function (root) {
  root.append(el("div", { class: "page-head" }, el("div", null,
    el("div", { class: "eyebrow" }, "50 researched stocks"),
    el("h1", null, "All stocks"),
    el("p", null, "Every stock with its score, valuation and signals at the " + AS_OF_LABEL + " close. Click a column to sort and a row to open the stock."))));
  const q = el("input", { id: "list-q", type: "search", placeholder: "Filter by name or ticker", value: LIST_STATE.q, "aria-label": "Filter stocks" });
  const grp = el("select", { id: "list-group", "aria-label": "Group" }, el("option", { value: "" }, "All groups"), D.groups.map(g => el("option", { value: g, selected: LIST_STATE.group === g ? "" : null }, g)));
  const own = el("label", { class: "row small", style: "gap:6px" }, el("input", { id: "list-owned", type: "checkbox", checked: LIST_STATE.owned ? "" : null }), "Only stocks I own");
  const zsel = el("select", { id: "list-zone", "aria-label": "Price zone" },
    [["", "Any price zone"], ["buy", "Strong-buy zone"], ["fair", "Below fair value"], ["hold", "Hold zone"], ["sell", "Take-profit zone"]].map(([v, t]) => el("option", { value: v, selected: LIST_STATE.zone === v ? "" : null }, t)));
  const box = el("div", { class: "tablewrap" });
  const count = el("span", { class: "note" });
  const pnl = el("section", { class: "panel" }, el("div", { class: "row" }, q, grp, zsel, own, count), box,
    el("p", { class: "note" }, "P/E uses the last 12 months of reported earnings; “vs. 5-yr” compares it with the stock's own 5-year median (negative = cheaper than usual). Fwd P/E uses Wall Street's estimate for the next 4 quarters. DCF and analyst columns show upside from today's price. Signals count how many of the 8 checks on each stock page look good."));
  root.append(pnl);
  const cols = [
    ["t", "Company", r => r.s.t, "text"], ["g", "Group", r => r.s.g, "text"], ["score", "Score", r => r.sc], ["p", "Price", r => r.p],
    ["d1", "Today", r => r.d1], ["y1", "1 year", r => r.y1], ["pe", "P/E", r => r.pe], ["peRel", "vs. 5-yr", r => r.peRel],
    ["fpe", "Fwd P/E", r => r.fpe], ["dcf", "DCF", r => r.dcf], ["an", "Analysts", r => r.an], ["zone", "Price zone", r => ({ buy: 0, fair: 1, hold: 2, sell: 3, na: 4 })[r.z.key]], ["good", "Signals", r => r.good]
  ];
  function draw() {
    LIST_STATE.q = q.value.trim().toLowerCase(); LIST_STATE.group = grp.value; LIST_STATE.owned = own.querySelector("input").checked; LIST_STATE.zone = zsel.value;
    let rows = STOCKS.map(rowData).filter(r =>
      (!LIST_STATE.q || r.s.t.toLowerCase().includes(LIST_STATE.q) || r.s.n.toLowerCase().includes(LIST_STATE.q)) &&
      (!LIST_STATE.group || r.s.g === LIST_STATE.group) && (!LIST_STATE.owned || isMine(r.s.t)) && (!LIST_STATE.zone || r.z.key === LIST_STATE.zone));
    const col = cols.find(c => c[0] === LIST_STATE.sort) || cols[2];
    rows.sort((a, b) => {
      const va = col[2](a), vb = col[2](b);
      if (col[3] === "text") return String(va).localeCompare(String(vb)) * LIST_STATE.dir;
      if (!isNum(va) && !isNum(vb)) return 0;
      if (!isNum(va)) return 1;
      if (!isNum(vb)) return -1;
      return (va - vb) * LIST_STATE.dir;
    });
    count.textContent = LIST_STATE.owned && !MINE.size ? "You haven't marked any stocks as yours yet. Use “Add to my stocks” on a stock's page, or pick them on the Home page." : rows.length + " of " + STOCKS.length + " stocks";
    const head = el("tr", null, cols.map(([key, label], i) => el("th", {
      class: "sortable" + (i > 1 ? " n" : "") + (i === 0 ? " sticky-col" : ""), tabindex: 0, scope: "col",
      "aria-sort": LIST_STATE.sort === key ? (LIST_STATE.dir > 0 ? "ascending" : "descending") : null,
      onclick: () => { if (LIST_STATE.sort === key) LIST_STATE.dir *= -1; else { LIST_STATE.sort = key; LIST_STATE.dir = i < 2 ? 1 : -1; } draw(); },
      onkeydown: e => { if (e.key === "Enter") e.target.click(); }
    }, label)));
    const body = el("tbody", null, rows.map(r => el("tr", { class: isMine(r.s.t) ? "mine" : null, tabindex: 0, onclick: () => goStock(r.s.t), onkeydown: e => { if (e.key === "Enter") goStock(r.s.t); } },
      el("td", { class: "tick-name sticky-col" }, el("b", null, r.s.t), el("span", null, r.s.n), isMine(r.s.t) ? " " : null, isMine(r.s.t) ? el("span", { class: "tag-own" }, "Mine") : null),
      el("td", { class: "small muted" }, r.s.g),
      el("td", { class: "n" }, r.sc + " ", el("span", { class: "pill " + gradeCls(r.sc), style: "font-size:11px;padding:1px 7px" }, grade(r.sc))),
      el("td", { class: "n" }, moneyAuto(r.p)),
      el("td", { class: "n " + cls(r.d1) }, spct(r.d1)),
      el("td", { class: "n " + cls(r.y1) }, spct(r.y1, 0)),
      el("td", { class: "n" }, mult(r.pe)),
      el("td", { class: "n " + cls(isNum(r.peRel) ? -r.peRel : null) }, spct(r.peRel, 0)),
      el("td", { class: "n" }, mult(r.fpe)),
      el("td", { class: "n " + cls(r.dcf) }, spct(r.dcf, 0)),
      el("td", { class: "n " + cls(r.an) }, spct(r.an, 0)),
      el("td", null, el("span", { class: "pill " + r.z.cls }, r.z.call)),
      el("td", { class: "n" }, r.good + "/8"))));
    box.replaceChildren(el("table", { class: "list" }, el("thead", null, head), body));
  }
  [q, grp, zsel].forEach(x => x.addEventListener("input", draw));
  own.querySelector("input").addEventListener("change", draw);
  draw();
};
