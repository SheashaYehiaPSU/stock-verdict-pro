/* ============================================================
   Shell: header, navigation, search, ticker tape, router, footer
   On the website every page is its own address (/stocks/nvda/);
   in the claude.ai version pages switch in place (#stock-NVDA).
   ============================================================ */
const PAGES = [
  ["home", "Home"], ["stocks", "All stocks"], ["economy", "Economy"],
  ["compare", "Compare"], ["backtest", "Backtest"], ["learn", "Learn"]
];
const RENDER = {}; // page id -> function(root, arg)
let AI_STOCKS = WEB ? new Map() : new Map((store.get("ai", []) || []).filter(x => x && x.t).map(x => [x.t, x]));
let sampleFn = null; // Claude "sample" capability, when this view has it
let current = "home";

function findStock(t) { return BY.get(t) || AI_STOCKS.get(t) || null; }
const slug = t => t.toLowerCase().replace(/\./g, "-");

/** Where a page lives: a real path on the website, a #token in the claude.ai version. */
function hrefFor(token) {
  if (!WEB) return "#" + token;
  if (token === "home") return ROOT || "./";
  if (token.startsWith("stock-")) return ROOT + "stocks/" + slug(token.slice(6)) + "/";
  return ROOT + token + "/";
}
/** A real link to a page. In the claude.ai version a plain click switches pages in place. */
function link(token, attrs, ...kids) {
  const a = el("a", Object.assign({ href: hrefFor(token) }, attrs || {}), ...kids);
  if (!WEB) a.addEventListener("click", e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go(token); });
  return a;
}

function buildShell() {
  const nav = el("nav", { class: "nav", "aria-label": "Sections" });
  PAGES.forEach(([id, label]) => nav.append(link(id, { "data-page": id }, label)));
  const input = el("input", { id: "q", type: "search", placeholder: WEB ? "Search the 50 stocks" : "Search a stock, or any company", autocomplete: "off", "aria-label": "Search stocks" });
  const sug = el("div", { class: "suggest", id: "suggest", hidden: true, role: "listbox" });
  const icon = sv("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, sv("circle", { cx: 7, cy: 7, r: 5, "stroke-width": 1.8 }), sv("path", { d: "M11 11l3.5 3.5", "stroke-width": 1.8, "stroke-linecap": "round" }));
  const search = el("div", { class: "search" }, icon, input, sug);
  const header = el("header", { class: "top", id: "top" },
    el("div", { class: "wrap gutter" },
      link("home", { class: "brand", "aria-label": "Stock Verdict Pro home" }, el("b", null, "Stock Verdict"), el("span", null, "PRO")),
      nav, search));
  const tape = el("div", { class: "tape", "aria-label": "Prices at the last close" }, el("div", { class: "tape-track" }, tapeItems(), tapeItems(true)));
  const main = el("main", { id: "main" }, el("div", { class: "wrap gutter", id: "view" }));
  const foot = el("footer", { class: "site" }, el("div", { class: "wrap gutter" },
    el("p", null, el("b", null, "Not financial advice. "), "This site organizes public data and a scoring model so you can make your own decisions. Scores, fair values and signals are estimates that can be wrong; no price is a guaranteed buy."),
    el("p", null, (WEB ? "Data updates every weekday after the US market closes; this version uses the close on " : "Prices: close on ") + AS_OF_LABEL + ". Sources: Yahoo Finance (prices), SEC EDGAR (earnings history), SEC Form 4 via OpenInsider (insider trades), Nasdaq (earnings dates, estimates, fund ownership, analyst targets), FRED (economy). Company research and scores: Oct 1, 2026. ", link("learn", null, "How it works")),
    WEB ? el("p", null, "Stocks you mark as yours are saved only in this browser. This site doesn't collect or store anything about you.") : null));
  document.body.append(header, tape, main, foot);
  wireSearch(input, sug);
  const setH = () => document.documentElement.style.setProperty("--hdr", header.offsetHeight + "px");
  setH();
  if (window.ResizeObserver) new ResizeObserver(setH).observe(header);
}

function tapeItems(dup) {
  const frag = document.createDocumentFragment();
  STOCKS.forEach(s => frag.append(link("stock-" + s.t, { tabindex: dup ? -1 : null, "aria-hidden": dup ? "true" : null, title: s.n },
    el("span", { class: "t" + (isMine(s.t) ? " own" : "") }, s.t), el("span", null, moneyAuto(s.px.last)), el("span", { class: cls(s.px.d1) }, spct(s.px.d1)))));
  return frag;
}

function wireSearch(input, box) {
  let items = [], on = 0;
  function close() { box.hidden = true; }
  function pick(i) {
    const it = items[i]; if (!it || it.none) return;
    input.value = ""; close();
    if (it.t) goStock(it.t); else analyzeCompany(it.q);
  }
  function update() {
    const q = input.value.trim();
    box.replaceChildren(); items = [];
    if (!q) { close(); return; }
    const n = q.toLowerCase();
    const pool = [...STOCKS, ...AI_STOCKS.values()];
    const hits = pool.filter(s => s.t.toLowerCase().startsWith(n) || s.n.toLowerCase().includes(n) || (s.a || []).some(a => a.includes(n)))
      .sort((a, b) => (a.t.toLowerCase() === n ? -1 : 0) - (b.t.toLowerCase() === n ? -1 : 0)).slice(0, 8);
    hits.forEach(s => items.push({ t: s.t, label: [el("b", null, s.t), el("span", null, s.n), isMine(s.t) ? el("small", null, "yours") : null] }));
    if (!WEB && q.length >= 2 && !hits.some(s => s.t.toLowerCase() === n)) items.push({ q, label: [el("b", null, "Ask"), el("span", null, "Analyze “" + q + "” with Claude"), el("small", null, sampleFn ? "30–90 s" : "needs claude.ai")] });
    if (WEB && !hits.length) items.push({ none: true, label: [el("span", null, "No match among the 50 researched stocks.")] });
    on = 0;
    items.forEach((it, i) => box.append(el("button", { type: "button", role: "option", class: i === on && !it.none ? "on" : null, onmousedown: e => { e.preventDefault(); pick(i); } }, it.label)));
    box.hidden = !items.length;
  }
  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", e => {
    if (box.hidden) return;
    const btns = box.querySelectorAll("button");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      on = (on + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      btns.forEach((b, i) => b.classList.toggle("on", i === on));
    } else if (e.key === "Enter") { e.preventDefault(); pick(on); }
    else if (e.key === "Escape") close();
  });
}

/* ---------- router ---------- */
function go(token) {
  if (WEB) { location.href = hrefFor(token); return; }
  try { if (location.hash.slice(1) !== token) history.replaceState(null, "", "#" + token); } catch (e) { /* the viewer may block history */ }
  route(token);
}
function route(token) {
  token = token || "home";
  let page = token, arg = null;
  if (token.startsWith("stock-")) { page = "stock"; arg = token.slice(6); }
  if (page === "stock" && !findStock(arg)) { page = "home"; arg = null; }
  if (page !== "stock" && !RENDER[page]) page = "home";
  current = page;
  document.querySelectorAll(".nav a").forEach(b => b.setAttribute("aria-current", b.dataset.page === (page === "stock" ? "stocks" : page) ? "page" : "false"));
  const view = $("view");
  view.replaceChildren();
  if (page === "stock") RENDER.stock(view, arg);
  else RENDER[page](view);
  if (!WEB) { store.set("last", token); window.scrollTo({ top: 0 }); }
  const s = page === "stock" ? findStock(arg) : null;
  const label = (PAGES.find(p => p[0] === page) || [])[1];
  const named = s ? (s.n.includes("(") ? s.n + " · " + s.t : s.n + " (" + s.t + ")") : null;
  document.title = named ? named + " · Stock Verdict Pro" : page === "home" || !label ? "Stock Verdict Pro" : label + " · Stock Verdict Pro";
}
/** Re-mark the ticker tape after "my stocks" changes. */
function refreshTape() { document.querySelectorAll(".tape .t").forEach(n => n.classList.toggle("own", isMine(n.textContent))); }
if (!WEB) window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (t) route(t); });
