/* ============================================================
   Core: data access, formatting, storage, valuation math, charts
   (runs inside startApp(D), which receives the site data)
   ============================================================ */
const STOCKS = D.stocks;
const BY = new Map(STOCKS.map(s => [s.t, s]));
const PARTS = D.parts;
const CAL = D.cal;
const AS_OF = D.asOf;
const FOREIGN = new Set(["TSM", "ASML", "ARM", "NBIS", "SHOP"]);
// WEB: the public multi-page website. Otherwise: the single-page claude.ai artifact.
const WEB = document.body.dataset.mode === "web";
const ROOT = document.body.dataset.root || "";

/* ---------- small DOM helper ---------- */
// Optional pieces are written as `cond ? node : null`; skip them instead of printing "null".
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ["append", "prepend", "replaceChildren"]) {
    const native = proto[name];
    proto[name] = function (...kids) { return native.apply(this, kids.filter(k => k != null && k !== false)); };
  }
}
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
const $ = id => document.getElementById(id);

/* ---------- formatting ---------- */
const isNum = v => typeof v === "number" && isFinite(v);
const money = v => isNum(v) ? (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const money0 = v => isNum(v) ? (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US") : "—";
const moneyAuto = v => !isNum(v) ? "—" : Math.abs(v) >= 1000 ? money0(v) : money(v);
function big(m) { // input in US$ millions
  if (!isNum(m)) return "—";
  const s = m < 0 ? "-" : "", a = Math.abs(m);
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "T";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "B";
  return s + "$" + a.toFixed(0) + "M";
}
function bigUsd(v) { return isNum(v) ? big(v / 1e6) : "—"; }
const pct = (v, d = 1) => isNum(v) ? v.toFixed(d) + "%" : "—";
const spct = (v, d = 1) => isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%" : "—";
const mult = v => isNum(v) ? v.toFixed(1) + "×" : "—";
const cls = v => !isNum(v) ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat";
const compact = v => !isNum(v) ? "—" : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + "B" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(Math.round(v));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dLabel(s, style) { // s: YYYY-MM-DD or YYYY-MM
  const y = s.slice(0, 4), m = +s.slice(5, 7), d = s.length > 7 ? +s.slice(8, 10) : null;
  if (style === "y") return y;
  if (style === "my") return MON[m - 1] + " " + y;
  if (style === "md") return MON[m - 1] + " " + d;
  return d ? MON[m - 1] + " " + d + ", " + y : MON[m - 1] + " " + y;
}
function daysUntil(iso) { return Math.round((Date.parse(iso + "T12:00:00") - Date.parse(AS_OF + "T12:00:00")) / 864e5); }
const AS_OF_LABEL = dLabel(AS_OF);

/* ---------- per-viewer storage (conveniences only) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("svp:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("svp:" + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
};
let OVR = store.get("ovr", {});
function ovr(t) { return OVR[t] || (OVR[t] = {}); }
function saveOvr() { store.set("ovr", OVR); }

/* ---------- "my stocks": kept only in this browser ---------- */
// The public site never contains anyone's holdings; each visitor marks their own.
// The private claude.ai version starts from the holdings in its research data.
const MINE = new Set((() => {
  const saved = store.get("mine", null);
  if (Array.isArray(saved)) return saved.filter(t => BY.has(t));
  return WEB ? [] : STOCKS.filter(s => s.own).map(s => s.t);
})());
const isMine = t => MINE.has(t);
const mine = () => STOCKS.filter(s => MINE.has(s.t));
function setMine(t, on) { if (on) MINE.add(t); else MINE.delete(t); store.set("mine", [...MINE]); }
const myLabel = () => { const n = MINE.size; return n === 1 ? "your stock" : "your " + n + " stocks"; };

/* ---------- valuation math ---------- */
// A typed or live price only applies to the day's data it was entered against.
function customPrice(s) { const o = OVR[s.t]; return o && isNum(o.price) && (!o.asOf || o.asOf === AS_OF) ? o : null; }
function curPrice(s) { const o = customPrice(s); return o ? o.price : s.px.last; }
function priceNote(s) {
  const o = customPrice(s);
  if (o) return o.live ? "Live price from Flashalpha, " + o.live : "Your price";
  if (s.ai) return "Last price Claude knew" + (s.aiPriceAsOf ? " (" + s.aiPriceAsOf + ")" : "");
  return "Close on " + dLabel(s.px.date);
}
function valInputs(s) { return Object.assign({}, s.val, (OVR[s.t] || {}).val || {}); }
/** Average 12-month analyst target: Nasdaq's daily figure when there is one, else the dated research snapshot. */
function consensusTarget(s) {
  if (s.nq && isNum(s.nq.target1y) && s.nq.target1y > 0) return s.nq.target1y;
  return s.tg && s.tg.c && isNum(s.tg.c.avg) ? s.tg.c.avg : s.val.consensus;
}

/** The original fair-value model: fair = metric × multiple; buy line = fair − margin;
    1-year target = half fair value grown a year, half the analyst average. */
function fairModel(s, price) {
  const v = valInputs(s);
  const cons = isNum(v.consensus) ? v.consensus : consensusTarget(s);
  const fair = isNum(v.value) && isNum(v.multiple) ? v.value * v.multiple : null;
  const buy = isNum(fair) ? fair * (1 - (v.margin || 0) / 100) : null;
  let target = null;
  if (isNum(fair)) {
    const grown = fair * (1 + (v.growth || 0) / 100);
    target = isNum(cons) ? 0.5 * grown + 0.5 * cons : grown;
  }
  return { price, v, cons, fair, buy, target };
}
function zone(k) {
  if (!isNum(k.price) || !isNum(k.fair)) return { key: "na", call: "Not enough data", cls: "info" };
  if (k.price <= k.buy) return { key: "buy", call: "Strong-buy zone", cls: "good" };
  if (k.price <= k.fair) return { key: "fair", call: "Below fair value", cls: "good" };
  if (k.price < k.target) return { key: "hold", call: "Hold zone", cls: "warn" };
  return { key: "sell", call: "Take-profit zone", cls: "bad" };
}
const score = s => s.parts.reduce((a, p) => a + (isNum(p[0]) ? p[0] : 0), 0);
const grade = n => n >= 85 ? "A" : n >= 75 ? "B" : n >= 65 ? "C" : n >= 55 ? "D" : "F";
const gradeCls = n => n >= 75 ? "good" : n >= 60 ? "warn" : "bad";

/** Two-stage DCF. Cash flow in US$ millions. Growth g1 for years 1–5, fading in a
    straight line to the long-run rate tg by year 10, discounted at r. */
function dcfValue(p) {
  const { cf0, g1, tg, r, netCash, shares } = p;
  if (!isNum(cf0) || !isNum(shares) || shares <= 0 || !(r > tg + 0.25)) return null;
  let cf = cf0, pv = 0;
  const flows = [];
  for (let y = 1; y <= 10; y++) {
    const g = y <= 5 ? g1 : g1 + (tg - g1) * (y - 5) / 5;
    cf *= 1 + g / 100;
    const d = cf / Math.pow(1 + r / 100, y);
    pv += d;
    flows.push({ y, cf, pv: d });
  }
  const tv = cf * (1 + tg / 100) / ((r - tg) / 100);
  const pvTv = tv / Math.pow(1 + r / 100, 10);
  const equity = pv + pvTv + (netCash || 0);
  return { perShare: equity / shares, pv, pvTv, equity, flows, tvShare: pvTv / (pv + pvTv) };
}
/** Starting cash flow options for the DCF (US$ millions). */
function cfOptions(s) {
  const b = s.dcf || {}, out = [];
  if (isNum(b.fcf) && isNum(b.earn)) out.push(["avg", "Average of both", (b.fcf + b.earn) / 2]);
  if (isNum(b.fcf)) out.push(["fcf", "Free cash flow", b.fcf]);
  if (isNum(b.earn)) out.push(["earn", s.t === "JPM" ? "Earnings" : "Expected earnings", b.earn]);
  if (!out.length && isNum(b.cf0)) out.push(["est", "Claude's estimate", b.cf0]);
  return out;
}
function dcfParams(s) {
  const base = s.dcf || {};
  const o = (OVR[s.t] || {}).dcf || {};
  let cf0 = base.cf0, key = base.key || (cfOptions(s)[0] || [])[0];
  if (o.key === "custom" && isNum(o.cf0)) { cf0 = o.cf0; key = "custom"; }
  else if (o.key) { const hit = cfOptions(s).find(x => x[0] === o.key); if (hit) { cf0 = hit[2]; key = hit[0]; } }
  return {
    key, cf0, g1: isNum(o.g1) ? o.g1 : base.g1, tg: isNum(o.tg) ? o.tg : base.tg,
    r: isNum(o.r) ? o.r : base.r, netCash: isNum(o.netCash) ? o.netCash : base.netCash, shares: s.sh
  };
}
/** Growth (years 1–5) that makes the DCF equal the price: what the market is "assuming". */
function impliedGrowth(p, price) {
  const f = g => { const r = dcfValue(Object.assign({}, p, { g1: g })); return r ? r.perShare : NaN; };
  let lo = -30, hi = 120;
  if (!(f(lo) < price)) return { below: true, g: lo };
  if (!(f(hi) > price)) return { above: true, g: hi };
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < price) lo = m; else hi = m; }
  return { g: (lo + hi) / 2 };
}
function peNow(s, price) {
  const e = s.pe && s.pe.ttm;
  if (!isNum(e) || e <= 0) return null;
  const v = price / e;
  return v > 0 && v < 150 ? v : null;
}
const ONE_OFF = /one-time|inflated|gains on|tariff refund/i;
/** P/E for comparing with history. When reported earnings include one-time gains
    (the research note says so), use the research's normal earnings instead. */
function pePlain(s, price) {
  const raw = peNow(s, price);
  if (raw && ONE_OFF.test(s.val.note || "") && /EPS/.test(s.val.metricLabel || "") && isNum(s.val.value) && s.val.value > 0) {
    const adj = price / s.val.value;
    if (adj < 150) return { pe: adj, adjusted: true, raw };
  }
  return raw ? { pe: raw, adjusted: false, raw } : null;
}
function fwdEps(s) {
  if (s.fc && isNum(s.fc.ntm) && s.fc.ntm > 0) return { v: s.fc.ntm, src: "Wall Street consensus, next 4 quarters" };
  if (/EPS/.test(s.val.metricLabel || "") && isNum(s.val.value) && s.val.value > 0) return { v: s.val.value, src: s.val.metricLabel };
  return null;
}

/* ---------- decision signals ---------- */
const ICON = {
  good: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
  warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 8h8"/></svg>',
  bad: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  na: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/></svg>'
};
function iconEl(kind) { const s = el("span", { class: "ic", "aria-hidden": "true" }); s.innerHTML = ICON[kind] || ICON.na; return s; }

function signals(s, price) {
  const out = [];
  const sc = score(s);
  out.push({ key: "quality", name: "Business quality", st: sc >= 75 ? "good" : sc >= 60 ? "warn" : "bad",
    text: sc + "/100 on the 10-part scorecard (grade " + grade(sc) + ")." });
  const k = fairModel(s, price), z = zone(k);
  out.push({ key: "model", name: "Price vs. fair value", st: z.key === "buy" || z.key === "fair" ? "good" : z.key === "hold" ? "warn" : z.key === "sell" ? "bad" : "na",
    text: isNum(k.fair) ? z.call + ": fair value " + moneyAuto(k.fair) + ", " + spct((k.fair / price - 1) * 100, 0) + " from here." : "The fair-value model needs earnings or cash flow." });
  const dp = dcfParams(s), dv = dcfValue(dp);
  if (dv && dp.cf0 > 0 && dv.perShare > 0) {
    const up = (dv.perShare / price - 1) * 100;
    out.push({ key: "dcf", name: "Cash-flow value (DCF)", st: up >= 15 ? "good" : up >= -15 ? "warn" : "bad",
      text: "DCF value " + moneyAuto(dv.perShare) + " a share, " + spct(up, 0) + " vs. the price." });
  } else out.push({ key: "dcf", name: "Cash-flow value (DCF)", st: "na", text: "Not meaningful: the company does not make steady cash yet." });
  const pp = pePlain(s, price), s5 = s.pe && s.pe.s5;
  if (pp && s5) {
    const r = pp.pe / s5.med;
    out.push({ key: "pe", name: "P/E vs. its own history", st: r <= 0.85 ? "good" : r <= 1.15 ? "warn" : "bad",
      text: mult(pp.pe) + (pp.adjusted ? " normal earnings" : " earnings") + " vs. a 5-year median of " + mult(s5.med) + (r <= 0.85 ? ": cheaper than usual." : r <= 1.15 ? ": about normal." : ": pricier than usual.") + (pp.adjusted ? " (Reported EPS includes one-time gains.)" : "") });
  } else out.push({ key: "pe", name: "P/E vs. its own history", st: "na", text: pp ? "Not enough earnings history yet." : "No meaningful P/E (earnings are negative or tiny)." });
  const cons = consensusTarget(s);
  if (isNum(cons)) {
    const up = (cons / price - 1) * 100;
    const rev = s.fc ? (s.fc.revUp > s.fc.revDown ? " Estimates are being raised." : s.fc.revDown > s.fc.revUp ? " Estimates are being cut." : "") : "";
    out.push({ key: "analysts", name: "Analyst targets", st: up >= 15 ? "good" : up >= 0 ? "warn" : "bad",
      text: "Average target " + moneyAuto(cons) + ", " + spct(up, 0) + " upside." + rev });
  } else out.push({ key: "analysts", name: "Analyst targets", st: "na", text: "No analyst target available." });
  const ma = s.px.ma200, m6 = s.px.m6;
  if (isNum(ma)) {
    const above = price > ma, pos = isNum(m6) && m6 > 0;
    out.push({ key: "trend", name: "Price trend", st: above && pos ? "good" : above || pos ? "warn" : "bad",
      text: (above ? "Above" : "Below") + " its 200-day average (" + moneyAuto(ma) + "); " + spct(m6, 0) + " over 6 months." });
  } else out.push({ key: "trend", name: "Price trend", st: "na", text: "Too new to have a 200-day average." });
  const oi = s.oi;
  if (FOREIGN.has(s.t)) out.push({ key: "insiders", name: "Insider buying", st: "na", text: "Foreign company: its insiders do not file US Form 4 reports." });
  else if (!oi) out.push({ key: "insiders", name: "Insider buying", st: "na", text: "No insider-trading data for this company." });
  else if (oi.m12.buys > 0 && oi.m12.bought >= 100000) out.push({ key: "insiders", name: "Insider buying", st: "good",
    text: oi.m12.buyers + " insider" + (oi.m12.buyers > 1 ? "s" : "") + " bought " + bigUsd(oi.m12.bought) + " of stock on the open market in 12 months." });
  else out.push({ key: "insiders", name: "Insider buying", st: "warn",
    text: oi.m12.sells ? "No meaningful buying; insiders sold " + bigUsd(oi.m12.sold) + " in 12 months (selling is common)." : "No open-market buying or selling in 12 months." });
  const res = s.parts[8] ? s.parts[8][0] : null, rate = s.risk.rate;
  let st = "warn", why = [];
  if (isNum(res)) why.push("recession score " + res + "/10");
  if (isNum(rate)) why.push((rate < 0 ? "falls " : "rises ") + Math.abs(rate).toFixed(0) + "% per +1 pt in the 10-yr yield");
  if (isNum(res) && res >= 7 && (!isNum(rate) || rate > -6)) st = "good";
  else if ((isNum(res) && res <= 4) || (isNum(rate) && rate < -14)) st = "bad";
  out.push({ key: "macro", name: "Fit for today's economy", st, text: why.length ? cap(why.join("; ")) + "." : "Not enough history." });
  return out;
}
function cap(t) { return t ? t[0].toUpperCase() + t.slice(1) : t; }
function sigCount(list) {
  const c = { good: 0, warn: 0, bad: 0, na: 0 };
  list.forEach(x => c[x.st]++);
  return c;
}

/* ---------- series helpers ---------- */
function lastIdx(arr) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; }
function firstIdx(arr) { for (let i = 0; i < arr.length; i++) if (arr[i] != null) return i; return -1; }

/* ---------- charts ---------- */
function niceTicks(lo, hi, n) {
  if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
  const span = hi - lo, step0 = span / Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const f = step0 / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const t0 = Math.floor(lo / step) * step, t1 = Math.ceil(hi / step) * step;
  const out = [];
  for (let v = t0; v <= t1 + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
function observeWidth(node, draw) {
  let w = 0;
  const run = () => { const nw = Math.round(node.clientWidth); if (nw && nw !== w) { w = nw; draw(nw); } };
  if (window.ResizeObserver) new ResizeObserver(run).observe(node);
  requestAnimationFrame(run);
  return run;
}

/**
 * Line chart with crosshair tooltip.
 * opts: { labels: [date strings], series: [{name, values, color, area, width}], yFmt, xStyle,
 *         height, refs: [{y, label, color}], band: {lo:[], hi:[], color}, shade: [[startLabel, endLabel]],
 *         zero: bool, ariaLabel }
 */
function lineChart(opts) {
  const host = el("div", { class: "chart" });
  const tip = el("div", { class: "tip", hidden: true });
  host.append(tip);
  const H = opts.height || 260;
  observeWidth(host, W => draw(W));
  function draw(W) {
    host.querySelectorAll("svg").forEach(n => n.remove());
    const L = opts.labels, n = L.length;
    const padL = opts.padL || 52, padR = opts.padR || (opts.refs && opts.refs.length ? 64 : 14), padT = 12, padB = 26;
    const iw = Math.max(40, W - padL - padR), ih = H - padT - padB;
    const LOG = !!opts.log;
    const tf = v => LOG ? Math.log10(v) : v;
    let lo = Infinity, hi = -Infinity;
    const all = opts.series.flatMap(s => s.values).concat(opts.band ? opts.band.lo.concat(opts.band.hi) : []).concat((opts.refs || []).filter(r => r.inRange !== false).map(r => r.y));
    all.forEach(v => { if (isNum(v) && (!LOG || v > 0)) { lo = Math.min(lo, tf(v)); hi = Math.max(hi, tf(v)); } });
    if (opts.zero && !LOG) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    let ticks, y0, y1;
    if (LOG) {
      // ticks at 1, 2 and 5 times each power of ten
      y0 = lo - (hi - lo) * 0.04; y1 = hi + (hi - lo) * 0.06;
      ticks = [];
      for (let d = Math.floor(y0); d <= Math.ceil(y1); d++) [1, 2, 5].forEach(m => { const v = Math.log10(m) + d; if (v >= y0 && v <= y1) ticks.push(v); });
      if (ticks.length > 7) ticks = ticks.filter(v => Math.abs(v - Math.round(v)) < 1e-9);
    } else {
      const padV = (hi - lo) * 0.06 || 1;
      if (!opts.zero || lo < 0) lo -= padV;
      hi += padV;
      ticks = niceTicks(lo, hi, 4);
      y0 = ticks[0]; y1 = ticks[ticks.length - 1];
    }
    const X = i => padL + (n <= 1 ? iw / 2 : i / (n - 1) * iw);
    const Yraw = u => padT + ih - (u - y0) / (y1 - y0) * ih;
    const Y = v => Yraw(tf(v));
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.ariaLabel || "Chart" });
    // shaded periods (e.g., recessions)
    (opts.shade || []).forEach(([a, b]) => {
      const i0 = L.indexOf(a), i1 = L.indexOf(b);
      if (i0 < 0 && i1 < 0) return;
      const xa = X(Math.max(0, i0)), xb = X(i1 < 0 ? n - 1 : i1);
      svg.append(sv("rect", { x: xa, y: padT, width: Math.max(1, xb - xa), height: ih, fill: "var(--grid)", opacity: .8 }));
    });
    ticks.forEach(t => {
      svg.append(sv("line", { x1: padL, x2: padL + iw, y1: Yraw(t), y2: Yraw(t), class: "gridline" }));
      svg.append(sv("text", { x: padL - 8, y: Yraw(t) + 4, "text-anchor": "end" }, (opts.yFmt || String)(LOG ? Math.pow(10, t) : t)));
    });
    if (opts.zero && !LOG && y0 < 0 && y1 > 0) svg.append(sv("line", { x1: padL, x2: padL + iw, y1: Y(0), y2: Y(0), class: "axisline" }));
    // x labels: ~5 evenly spaced
    const nl = Math.max(2, Math.min(6, Math.floor(iw / 95)));
    for (let k = 0; k < nl; k++) {
      const i = Math.round(k / (nl - 1) * (n - 1));
      svg.append(sv("text", { x: X(i), y: H - 6, "text-anchor": k === 0 ? "start" : k === nl - 1 ? "end" : "middle" }, dLabel(L[i], opts.xStyle || "my")));
    }
    if (opts.band) {
      let d = "", started = false;
      for (let i = 0; i < n; i++) { const v = opts.band.hi[i]; if (!isNum(v)) continue; d += (started ? "L" : "M") + X(i) + "," + Y(v); started = true; }
      for (let i = n - 1; i >= 0; i--) { const v = opts.band.lo[i]; if (!isNum(v)) continue; d += "L" + X(i) + "," + Y(v); }
      if (d) svg.append(sv("path", { d: d + "Z", fill: opts.band.color || "var(--wash)", stroke: "none" }));
    }
    opts.series.forEach(s => {
      let d = "", pen = false, firstX = null, lastX = null;
      s.values.forEach((v, i) => {
        if (!isNum(v) || (LOG && v <= 0)) { pen = false; return; }
        d += (pen ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1);
        if (firstX == null) firstX = X(i);
        lastX = X(i);
        pen = true;
      });
      if (!d) return;
      if (s.area) {
        const bottom = LOG ? Yraw(y0) : Yraw(y0 <= 0 && y1 >= 0 ? 0 : y0);
        svg.append(sv("path", { d: d + `L${lastX},${bottom}L${firstX},${bottom}Z`, fill: s.color, opacity: .1, stroke: "none" }));
      }
      svg.append(sv("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: s.faint ? .55 : 1 }));
      const li = lastIdx(s.values);
      if (li >= 0 && s.dot !== false) svg.append(sv("circle", { cx: X(li), cy: Y(s.values[li]), r: 4, fill: s.color, stroke: "var(--card)", "stroke-width": 2 }));
    });
    (opts.refs || []).forEach(r => {
      if (!isNum(r.y) || (LOG && r.y <= 0) || tf(r.y) < y0 || tf(r.y) > y1) return;
      svg.append(sv("line", { x1: padL, x2: padL + iw, y1: Y(r.y), y2: Y(r.y), stroke: r.color, "stroke-width": 1.5, opacity: .9 }));
      svg.append(sv("text", { x: padL + iw + 6, y: Y(r.y) + 4, style: "fill:var(--ink-2);font-weight:600" }, r.label));
    });
    const cross = sv("line", { y1: padT, y2: padT + ih, class: "cross", visibility: "hidden" });
    svg.append(cross);
    const hit = sv("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent", tabindex: 0, style: "outline:none" });
    svg.append(hit);
    let cur = -1;
    function show(i) {
      if (i < 0 || i >= n) return;
      cur = i;
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      tip.replaceChildren(el("div", { class: "d" }, dLabel(L[i], opts.tipStyle)));
      opts.series.forEach(s => {
        const v = s.values[i];
        if (!isNum(v) || s.noTip) return;
        tip.append(el("div", { class: "r" }, el("i", { style: "--c:" + s.color }), el("b", null, (opts.tipFmt || opts.yFmt || String)(v)), el("span", null, s.name)));
      });
      if (opts.extraTip) opts.extraTip(i, tip);
      tip.hidden = false;
      const tw = tip.offsetWidth, x = X(i);
      tip.style.left = Math.max(0, Math.min(W - tw, x + 12 + tw > W ? x - tw - 12 : x + 12)) + "px";
      tip.style.top = (padT + 4) + "px";
    }
    function hide() { cross.setAttribute("visibility", "hidden"); tip.hidden = true; }
    hit.addEventListener("pointermove", e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      show(Math.round((px - padL) / iw * (n - 1)));
    });
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(cur < 0 ? lastIdx(opts.series[0].values) : cur));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", e => {
      if (e.key === "ArrowLeft") { show(Math.max(0, cur - 1)); e.preventDefault(); }
      if (e.key === "ArrowRight") { show(Math.min(n - 1, cur + 1)); e.preventDefault(); }
    });
    host.prepend(svg);
  }
  return host;
}

/** Vertical bar chart for one series (e.g., monthly payrolls). */
function barChart(opts) {
  const host = el("div", { class: "chart" });
  const tip = el("div", { class: "tip", hidden: true });
  host.append(tip);
  const H = opts.height || 220;
  observeWidth(host, W => {
    host.querySelectorAll("svg").forEach(n => n.remove());
    const L = opts.labels, V = opts.values, n = L.length;
    const padL = 50, padR = 10, padT = 10, padB = 26, iw = W - padL - padR, ih = H - padT - padB;
    let lo = Math.min(0, ...V.filter(isNum)), hi = Math.max(0, ...V.filter(isNum));
    const ticks = niceTicks(lo, hi, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const Y = v => padT + ih - (v - y0) / (y1 - y0) * ih;
    const bw = iw / n, w = Math.max(1.5, Math.min(24, bw - 2));
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.ariaLabel || "Bar chart" });
    ticks.forEach(t => {
      svg.append(sv("line", { x1: padL, x2: padL + iw, y1: Y(t), y2: Y(t), class: "gridline" }));
      svg.append(sv("text", { x: padL - 8, y: Y(t) + 4, "text-anchor": "end" }, (opts.yFmt || String)(t)));
    });
    V.forEach((v, i) => {
      if (!isNum(v)) return;
      const x = padL + i * bw + (bw - w) / 2, yv = Y(v), yz = Y(0);
      const r = sv("rect", { x, y: Math.min(yv, yz), width: w, height: Math.max(1, Math.abs(yz - yv)), rx: Math.min(3, w / 3), fill: (opts.colorFn ? opts.colorFn(v, i) : opts.color) || "var(--s1)" });
      r.addEventListener("pointerenter", () => {
        tip.replaceChildren(el("div", { class: "d" }, dLabel(L[i], opts.tipStyle)), el("div", { class: "r" }, el("b", null, (opts.tipFmt || opts.yFmt || String)(v)), el("span", null, opts.name || "")));
        tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, x - tip.offsetWidth / 2)) + "px";
        tip.style.top = "6px";
        r.setAttribute("opacity", .75);
      });
      r.addEventListener("pointerleave", () => { tip.hidden = true; r.removeAttribute("opacity"); });
      svg.append(r);
    });
    svg.append(sv("line", { x1: padL, x2: padL + iw, y1: Y(0), y2: Y(0), class: "axisline" }));
    const nl = Math.max(2, Math.min(6, Math.floor(iw / 95)));
    for (let k = 0; k < nl; k++) {
      const i = Math.round(k / (nl - 1) * (n - 1));
      svg.append(sv("text", { x: padL + i * bw + bw / 2, y: H - 6, "text-anchor": k === 0 ? "start" : k === nl - 1 ? "end" : "middle" }, dLabel(L[i], opts.xStyle || "my")));
    }
    host.prepend(svg);
  });
  return host;
}

function sparkline(values, color, h) {
  const vals = values.filter(isNum);
  const W = 200, H = h || 40;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "spark", "aria-hidden": "true" });
  if (vals.length < 2) return svg;
  const lo = Math.min(...vals), hi = Math.max(...vals), n = vals.length;
  const X = i => i / (n - 1) * (W - 6) + 1, Y = v => H - 3 - (v - lo) / ((hi - lo) || 1) * (H - 8);
  const d = vals.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1)).join("");
  svg.append(sv("path", { d: d + `L${X(n - 1)},${H}L${X(0)},${H}Z`, fill: color, opacity: .1 }));
  svg.append(sv("path", { d, fill: "none", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
  return svg;
}

function dataTable(head, rows) {
  return el("details", { class: "data" }, el("summary", null, "Show the numbers"),
    el("div", { class: "tablewrap" }, el("table", null,
      el("thead", null, el("tr", null, head.map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", null, rows.map(r => el("tr", null, r.map((c, i) => el("td", { class: i ? "n" : null }, c))))))));
}

function seg(options, value, onChange, label) {
  const box = el("div", { class: "seg", role: "group", "aria-label": label || "Options" });
  options.forEach(([v, t]) => box.append(el("button", { type: "button", "aria-pressed": String(v === value),
    onclick: () => { box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "false")); box.querySelector(`[data-v="${v}"]`).setAttribute("aria-pressed", "true"); onChange(v); }, "data-v": v }, t)));
  return box;
}

/** Keep a label centered on its mark, but pull it inside near either edge. */
function edgeShift(x) { return x < 10 ? "0" : x > 90 ? "-100%" : "-50%"; }

function panel(title, sub, ...kids) {
  return el("section", { class: "panel" }, el("header", null, el("h2", null, title), sub ? el("span", { class: "note" }, sub) : null), ...kids);
}
function what(text) { return el("p", { class: "what" }, el("b", null, "What this means: "), text); }
function goStock(t) { go("stock-" + t); }
