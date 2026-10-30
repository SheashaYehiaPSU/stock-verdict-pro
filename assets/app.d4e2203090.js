(function () {
"use strict";
function startApp(D) {
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

/* ============================================================
   Claude features: "Ask Claude" on each stock page, analysis of
   companies outside the 50, and live quotes through Flashalpha
   ============================================================ */
const sampleReady = (async () => {
  try { sampleFn = window.claude && window.claude.use ? await window.claude.use("sample") : null; } catch (e) { sampleFn = null; }
  return sampleFn;
})();
let mcpNs = null;
const mcpReady = (async () => {
  try { mcpNs = window.claude && window.claude.use ? await window.claude.use("mcp") : null; } catch (e) { mcpNs = null; }
  return mcpNs;
})();

const SAMPLE_ERR = {
  not_granted: "Claude isn't allowed on this page for you. You can allow it from the page's permissions menu on claude.ai.",
  sampling_disabled: "Claude isn't available on this account.",
  not_declared: "This page can't ask Claude.",
  capability_disabled: "Asking Claude isn't available in this view.",
  capability_removed: "Asking Claude isn't available in this view.",
  rate_limited: "Too many questions at once, or your Claude usage limit was reached. Wait a bit and try again.",
  session_expired: "Your Claude session expired. Sign in again on claude.ai, then retry.",
  refused: "Claude declined that question. Try asking it a different way.",
  empty_completion: "Claude didn't write an answer. Try a shorter, more specific question.",
  invalid_json: "The analysis came back in an unreadable format. Try again.",
  prompt_too_large: "That question is too long. Shorten it and try again.",
  upstream_error: "The connection dropped while Claude was answering. Try again."
};
function sampleErr(e) { return (e && SAMPLE_ERR[e.code]) || SAMPLE_ERR.upstream_error; }

/* ---------- Ask Claude about this stock ---------- */
function stockBrief(s) {
  const p = curPrice(s), k = fairModel(s, p), z = zone(k), sg = signals(s, p);
  const dp = dcfParams(s), dv = dcfValue(dp), ig = dv ? impliedGrowth(dp, p) : null;
  const pe = peNow(s, p), fe = fwdEps(s), L = D.macro.latest, Y = D.macro.latestYoY;
  return {
    company: s.n, ticker: s.t, sector: s.sec, owned_by_user: isMine(s.t), summary: s.sum, latest_news: s.upd ? s.upd[0] + ": " + s.upd[1] : null,
    price_evaluated: p, price_date: priceNote(s),
    score_out_of_100: score(s), scorecard: PARTS.map(([nm, mx], i) => ({ part: nm, score: (s.parts[i] || [])[0], max: mx, why: (s.parts[i] || [])[1] })),
    fair_value_model: { zone: z.call, fair: k.fair, strong_buy_line: k.buy, one_year_target: k.target, inputs: k.v.metricLabel + " " + k.v.value + " × " + k.v.multiple, note: k.v.note },
    pe: { trailing: pe, five_year_median: s.pe && s.pe.s5 ? s.pe.s5.med : null, five_year_range: s.pe && s.pe.s5 ? [s.pe.s5.p25, s.pe.s5.p75] : null, forward: fe ? p / fe.v : null },
    dcf: dv ? { value_per_share: Math.round(dv.perShare * 100) / 100, starting_cash_flow_musd: dp.cf0, growth_years_1_5: dp.g1, long_run_growth: dp.tg, discount_rate: dp.r, implied_growth: ig && isNum(ig.g) ? Math.round(ig.g * 10) / 10 : null } : "not meaningful",
    signals: sg.map(x => ({ check: x.name, status: { good: "good", warn: "mixed", bad: "warning", na: "n/a" }[x.st], detail: x.text })),
    analysts: { average_target: consensusTarget(s), range: s.tg && s.tg.c ? [s.tg.c.lo, s.tg.c.hi] : null, estimate_revisions_4wk: s.fc ? { up: s.fc.revUp, down: s.fc.revDown } : null },
    scenarios: s.scen, upcoming: { next_earnings: s.ed, catalysts: s.cat },
    insiders_12m: s.oi ? s.oi.m12 : null, funds: s.inst ? { pct_owned: s.inst.pct } : null,
    returns_pct: s.px ? { m1: s.px.m1, m6: s.px.m6, ytd: s.px.ytd, y1: s.px.y1, per_year_5y: s.px.tr5, worst_drop_5y: s.px.mdd5 } : null,
    risk: s.risk, financials: s.fin, sentiment: s.sent,
    economy_now: { fed_funds: L.DFEDTARL[1] + "–" + L.DFEDTARU[1] + "% (raised Sept 16, 2026; another hike possible by December)", cpi_inflation: Y.cpi[1] + "% (Sept)", core_cpi: Y.core[1] + "%", unemployment: L.UNRATE[1] + "%", ten_year_yield: L.DGS10[1] + "%", oil: "about $100 a barrel (US–Iran war, Strait of Hormuz mostly closed)", sp500_ytd: (mkt("SPY") || {}).ytd }
  };
}
function askSection(s) {
  const sec = el("section", { class: "panel anchor", id: "sec-ask" }, el("header", null, el("h2", null, "Ask Claude"), el("span", { class: "note" }, "Answers use this page's data")));
  const ta = el("textarea", { id: "ask-q", placeholder: "Ask anything about " + s.n + ", e.g. what would have to go right for the bull case?", "aria-label": "Your question" });
  const ans = el("div", { class: "answer", "aria-live": "polite" });
  ans.hidden = true;
  const status = el("span", { class: "small muted" });
  const askBtn = el("button", { class: "btn", type: "button" }, "Ask");
  const stopBtn = el("button", { class: "btn ghost", type: "button", hidden: true }, "Stop");
  let ctl = null;
  const chips = ["What are the biggest risks right now?", "Why is the P/E so different from its history?", "How could another Fed rate hike affect it?", "Explain the DCF result in simple terms", "What should I watch in the next earnings report?"];
  async function ask(q) {
    q = (q || "").trim();
    if (!q) { ta.focus(); return; }
    const fn = sampleFn || await sampleReady;
    if (!fn) { status.textContent = "Asking Claude works when this page is open on claude.ai."; return; }
    ctl = new AbortController();
    askBtn.disabled = true; stopBtn.hidden = false; ans.hidden = false;
    ans.textContent = ""; status.replaceChildren(el("span", { class: "spinner", "aria-hidden": "true" }), " Thinking… usually 10 to 40 seconds.");
    const prompt = "You are a careful, plain-spoken stock research assistant inside a personal stock research website. Today is " + AS_OF + ".\n" +
      "Answer the question about " + s.n + " (" + s.t + ") using the DATA below plus general financial knowledge. Rules: this is education, not personalized financial advice, so do not tell the reader to buy, sell or hold, and never promise outcomes; explain the trade-offs and what to watch instead. Write for a beginner in plain English. Keep it under 220 words, in short paragraphs or a few bullets. If the data cannot answer the question, say what is missing.\n\n" +
      "DATA:\n" + JSON.stringify(stockBrief(s)) + "\n\nQUESTION: " + q.slice(0, 600);
    try {
      const r = await fn(prompt, { signal: ctl.signal, modelTier: "default", onText: ({ text }) => { ans.textContent = text; status.textContent = "Writing…"; } });
      ans.textContent = r.text;
      status.textContent = r.truncated ? "The answer was cut short. Ask a narrower question." : "Claude's answer is a starting point; check it against the numbers above.";
    } catch (e) {
      ans.textContent = e && e.text ? e.text : "";
      if (!ans.textContent) ans.hidden = true;
      status.textContent = e && e.code === "cancelled" ? "Stopped." : sampleErr(e);
    } finally { askBtn.disabled = false; stopBtn.hidden = true; ctl = null; }
  }
  askBtn.addEventListener("click", () => ask(ta.value));
  stopBtn.addEventListener("click", () => ctl && ctl.abort());
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(ta.value); });
  sec.append(el("div", { class: "ask" },
    el("div", { class: "chips" }, chips.map(c => el("button", { type: "button", onclick: () => { ta.value = c; ask(c); } }, c))),
    ta, el("div", { class: "row" }, askBtn, stopBtn, status), ans),
    el("p", { class: "note" }, "Claude sees the numbers on this page (price, score, signals, valuation, economy) and your question. It can't browse the web, and each question uses your own Claude usage."));
  return sec;
}

/* ---------- analyze a company outside the 50 ---------- */
function analysisPrompt(q) {
  return `You are a careful equity research analyst. Today is ${AS_OF}. You cannot browse; use only what you know, and use null rather than guessing.
Analyze this publicly traded company: "${q.slice(0, 120)}".
If it is not a real public company you know, reply with {"error": "one short sentence"}.

Reply with ONLY one JSON object in exactly this shape (numbers are plain numbers, no strings with $ or %):
{"ticker": "TICKER", "name": "Company name", "sector": "short industry label",
 "summary": "2 plain sentences on the business and the main story right now",
 "price": last share price you know in USD, "priceAsOf": "Month YYYY of that price", "high52": number or null, "low52": number or null,
 "sharesMillions": shares outstanding in millions,
 "fin": {"period": "e.g. FY2025 or TTM to Mar 2026", "revenue": USD millions, "revGrowth": percent, "opIncome": USD millions, "opMargin": percent, "netIncome": USD millions, "eps": diluted EPS USD, "fcf": free cash flow USD millions, "cash": USD millions, "debt": USD millions, "equity": USD millions, "dividend": yearly dividend per share USD (0 if none)},
 "val": {"metricLabel": "EPS, next 12 months (est.)" or "Free cash flow per share" when EPS is not meaningful, "value": that metric in USD per share, "multiple": a fair P/E (or P/FCF) for its quality and growth, "margin": safety margin percent (15 stable, 20 average, 25 risky), "growth": expected percent growth of the metric over 12 months, "consensus": analyst average 12-month target USD or null, "note": "one sentence explaining these inputs"},
 "parts": [10 items in this order, each {"score": integer, "why": "one sentence with specific facts"}],
 "swot": {"s": [2-3 short phrases], "w": [...], "o": [...], "t": [...]},
 "scenarios": {"bull": {"price": USD, "text": "one sentence"}, "base": {...}, "bear": {...}},
 "catalysts": [up to 3 {"when": "date or period", "what": "event"}],
 "sentiment": "1-2 sentences on what analysts and investors were saying, as of your knowledge"}

The 10 parts and maximum points: 1 Financial health (10); 2 Valuation P/E (5); 3 SWOT (15); 4 Supply chain (10); 5 Supply and demand (10); 6 Then vs. now (10); 7 Customer shift (10); 8 Geopolitics and regulation (10); 9 Slow-economy resilience (10); 10 Online sentiment and outlook (10).
Be strict and realistic; an average company totals about 60-65.`;
}
function cleanAnalysis(raw, q) {
  if (!raw || typeof raw !== "object") throw { code: "invalid_json" };
  if (raw.error) throw { code: "user", message: String(raw.error).slice(0, 200) };
  const n = v => isNum(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
  const str = v => (v == null ? "" : String(v)).slice(0, 400);
  const arr = v => Array.isArray(v) ? v.slice(0, 4).map(str) : [];
  const t = (str(raw.ticker).toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 10)) || q.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  const f = raw.fin || {}, v = raw.val || {}, sc = raw.scenarios || {};
  const parts = PARTS.map(([, mx], i) => { const p = (raw.parts || [])[i] || {}; const x = n(p.score); return [x == null ? 0 : Math.max(0, Math.min(mx, Math.round(x))), str(p.why)]; });
  const fin = { period: str(f.period), revenue: n(f.revenue), revGrowth: n(f.revGrowth), opIncome: n(f.opIncome), opMargin: n(f.opMargin), netIncome: n(f.netIncome), eps: n(f.eps), fcf: n(f.fcf), cash: n(f.cash), debt: n(f.debt), equity: n(f.equity), dividend: n(f.dividend) };
  const val = { metricLabel: str(v.metricLabel) || "EPS, next 12 months (est.)", value: n(v.value), multiple: n(v.multiple), margin: n(v.margin) ?? 20, growth: n(v.growth) ?? 0, consensus: n(v.consensus), note: str(v.note) };
  const sh = n(raw.sharesMillions);
  const price = n(raw.price) ?? val.consensus ?? (isNum(val.value) && isNum(val.multiple) ? val.value * val.multiple : 1);
  const cf0 = fin.fcf > 0 ? fin.fcf : (/EPS/.test(val.metricLabel) && val.value > 0 && sh ? val.value * sh : null);
  return {
    t, n: str(raw.name) || t, a: [q.trim().toLowerCase()], sec: str(raw.sector), g: "Analyzed by Claude", own: false, ai: true,
    sum: str(raw.summary), upd: null, fin, val, parts,
    swot: { s: arr(raw.swot && raw.swot.s), w: arr(raw.swot && raw.swot.w), o: arr(raw.swot && raw.swot.o), t: arr(raw.swot && raw.swot.t) },
    scen: { bull: [n(sc.bull && sc.bull.price), str(sc.bull && sc.bull.text)], base: [n(sc.base && sc.base.price), str(sc.base && sc.base.text)], bear: [n(sc.bear && sc.bear.price), str(sc.bear && sc.bear.text)] },
    cat: Array.isArray(raw.catalysts) ? raw.catalysts.slice(0, 3).map(x => [str(x && x.when), str(x && x.what)]) : [],
    sent: str(raw.sentiment), src: [], sh, tg: null, aiPriceAsOf: str(raw.priceAsOf),
    px: { last: price, lo52: n(raw.low52), hi52: n(raw.high52), date: null },
    risk: {}, pe: null, ins: null, oi: null, inst: null, ed: null, fc: null, d: null, w: null, mc: null, ma: null,
    dcf: { basis: fin.fcf > 0 ? "free cash flow (Claude's estimate)" : "next-12-month earnings (Claude's estimate)", cf0, g1: Math.max(-5, Math.min(40, val.growth || 0)), tg: 3, r: 10, netCash: (fin.cash || 0) - (fin.debt || 0) }
  };
}
let analyzing = null;
async function analyzeCompany(q) {
  const view = $("view");
  const fn = sampleFn || await sampleReady;
  view.replaceChildren(el("section", { class: "panel" }, el("h2", null, "Researching " + q), el("p", { id: "an-status", class: "lede" }), el("div", { class: "row" }, el("button", { class: "btn ghost", type: "button", id: "an-stop", onclick: () => analyzing && analyzing.abort() }, "Stop"))));
  const status = $("an-status");
  if (!fn) { status.textContent = "Analyzing other companies uses Claude, which works when this page is open on claude.ai. The 50 researched stocks all work here."; $("an-stop").hidden = true; return; }
  analyzing = new AbortController();
  status.replaceChildren(el("span", { class: "spinner", "aria-hidden": "true" }), " Claude is analyzing " + q + " from what it knows. This usually takes 30 to 90 seconds.");
  try {
    const raw = await fn.json(analysisPrompt(q), { signal: analyzing.signal, modelTier: "default", onText: ({ text }) => { status.textContent = "Writing the analysis (" + text.length.toLocaleString() + " characters so far)…"; } });
    const c = cleanAnalysis(raw, q);
    if (BY.has(c.t)) { goStock(c.t); return; }
    AI_STOCKS.set(c.t, c);
    store.set("ai", [...AI_STOCKS.values()]);
    goStock(c.t);
  } catch (e) {
    status.textContent = e && e.code === "user" ? e.message : e && e.code === "cancelled" ? "Stopped." : sampleErr(e);
    $("an-stop").hidden = true;
  } finally { analyzing = null; }
}
function removeAi(t) { AI_STOCKS.delete(t); store.set("ai", [...AI_STOCKS.values()]); delete OVR[t]; saveOvr(); go("home"); }

/* ---------- live quote through the viewer's Flashalpha connector ---------- */
function liveErr(e) {
  switch (e && e.code) {
    case "server_not_connected": return "Add the Flashalpha connector in claude.ai Settings → Connectors to get live prices.";
    case "needs_reauth": return "Reconnect Flashalpha in claude.ai Settings → Connectors, then try again.";
    case "selection_required": return "Pick which Flashalpha connection to use in the prompt claude.ai shows, then try again.";
    case "not_in_manifest": case "approval_required": return "Live prices need your OK for Flashalpha on this page. Click again and choose Allow.";
    case "blocked_by_policy": return "Your organization blocks this connector.";
    case "server_unavailable": return "Flashalpha didn't answer. Try again in a minute.";
    case "tool_error": return "Flashalpha reported a problem: " + String((e && e.message) || "no details").slice(0, 160);
    case "no_price": return "Flashalpha returned no price for this ticker.";
    default: return "Live prices aren't available in this view, so the last close is used.";
  }
}
function wireLive(s, btn, msg, onPrice) {
  if (s.ai || WEB) return;
  mcpReady.then(ns => { if (ns) { btn.hidden = false; msg.textContent = "Live price uses 1 of your 5 free Flashalpha calls a day."; } });
  btn.addEventListener("click", async () => {
    const ns = mcpNs || await mcpReady;
    if (!ns) { msg.textContent = liveErr(null); return; }
    btn.disabled = true;
    msg.replaceChildren(el("span", { class: "spinner", "aria-hidden": "true" }), " Asking Flashalpha…");
    try {
      const r = await ns.callTool("Flashalpha", "get_stock_quote", { symbol: s.t }, { cache: { staleTime: 60000, gcTime: 600000 } });
      const q = (r && r.payload) || {};
      const px = isNum(q.lastPrice) ? q.lastPrice : isNum(q.mid) ? q.mid : null;
      if (!isNum(px)) throw { code: "no_price" };
      const stamp = r.cache && r.cache.storedAt ? new Date(r.cache.storedAt) : q.lastUpdate ? new Date(q.lastUpdate) : null;
      const when = stamp ? stamp.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "just now";
      msg.textContent = "Live: " + money(px) + " as of " + when + ".";
      onPrice(px, when);
    } catch (e) { msg.textContent = liveErr(e); }
    finally { btn.disabled = false; }
  });
}

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

/* ============================================================
   Learn: how to use the site, how the numbers work, glossary
   ============================================================ */
const STEPS = [
  ["Start with the business", "Open the stock and look at the score and the 10-part scorecard. Is this a company you'd want to own for years? A great price on a weak business is a trap; aim for scores of 70 or more."],
  ["Check the price, several ways", "Look at the Valuation section: the price zone, P/E against its own history, the DCF, and analyst targets. When most methods put value above the price, you have a margin for error. When they disagree, figure out which assumption you believe."],
  ["Look at the trend and the calendar", "Is the price above its 200-day average? Is earnings day next week? Buying right before earnings is a coin flip; some people wait for the report."],
  ["Read the risks", "Read the bear case and ask: could I live with that price? Check rate and oil sensitivity, the recession score and debt. Then check the Economy page: higher rates and the oil shock are the big forces right now."],
  ["See what insiders and funds are doing", "Insider buying with their own money is a good sign; selling alone usually isn't a bad one. Many funds adding to a stock shows growing professional interest."],
  ["Size it so a mistake can't hurt you badly", "No single stock should be big enough to wreck your savings if the bear case happens. Buying in pieces over several months (see the Backtest page) lowers the risk of buying at a peak."],
  ["Write down why", "Note the reason you bought and what would make you sell (for example, \"if revenue growth drops under 10%\"). Review it after each earnings report instead of reacting to daily price moves."],
  WEB ? null : ["Ask Claude when something doesn't make sense", "Each stock page has an Ask Claude box that answers using that page's numbers. It's a research helper, not a financial advisor."]
].filter(Boolean);
const GLOSSARY = [
  ["200-day average", "The average closing price over the last 200 trading days (about 10 months). Price above it is read as an uptrend; below it, a downtrend."],
  ["13F filing", "A quarterly report big investment funds file with the SEC listing the stocks they own. It's up to 45 days old when published."],
  ["Analyst target", "The price a Wall Street analyst expects the stock to reach in about 12 months. Useful as a gauge of opinion, often wrong in detail."],
  ["Backtest", "Testing a buying rule on past prices to see how it would have done. Helpful, but the past never repeats exactly."],
  ["Beta", "How much a stock tends to swing compared with the whole market. 1.0 moves with the market; 2.0 moves about twice as much."],
  ["Book value", "What the company would be worth on paper if it sold everything and paid every debt: assets minus liabilities."],
  ["CPI (inflation)", "The Consumer Price Index: the price of a typical basket of goods and services. Its yearly change is the inflation rate."],
  ["Core inflation", "Inflation without food and energy, which jump around. The Fed watches it to see the underlying trend."],
  ["DCF (discounted cash flow)", "A way to value a company by estimating all the cash it will make in the future and converting it to today's dollars."],
  ["Discount rate", "The yearly return you require for owning a stock. Future cash is divided down by this rate; higher rate, lower value today."],
  ["Dividend yield", "The yearly dividend divided by the share price. A 3% yield pays $3 a year per $100 of stock."],
  ["Drawdown", "A drop from a peak. A worst drawdown of −50% means the investment at one point lost half its value before recovering."],
  ["EPS (earnings per share)", "The company's profit divided by the number of shares. The \"E\" in P/E."],
  ["Enterprise value", "Market value plus debt minus cash: what it would cost to buy the whole company, debts included."],
  ["Fear & Greed index", "A 0–100 gauge of investor mood built from market signals. Low numbers mean fear, high numbers greed."],
  ["Fed funds rate", "The interest rate the Federal Reserve sets for overnight bank lending. It ripples out to loans, mortgages and savings rates."],
  ["Form 4", "The SEC form company insiders (executives, directors, big owners) must file within two business days when they buy or sell shares."],
  ["Forward P/E", "The price divided by the earnings analysts expect over the next 12 months."],
  ["Free cash flow", "Cash left over after paying for running the business and for new equipment and buildings. It's what can go to dividends, buybacks or savings."],
  ["Free-cash-flow yield", "Free cash flow divided by market value. Compare it with the 10-year Treasury yield to see if you're paid for the extra risk."],
  ["Long-run growth", "In a DCF, the growth rate assumed for every year after year 10. Usually 2–3%, close to the economy's growth plus inflation."],
  ["Margin of safety", "Buying below your estimate of value, so you still do fine if the estimate is somewhat too high."],
  ["Market value (market cap)", "Share price times the number of shares: what the stock market says the whole company is worth."],
  ["Net cash / net debt", "Cash and investments minus debt. Positive is net cash (a cushion); negative is net debt."],
  ["Operating margin", "Operating profit as a share of revenue. A 30% margin keeps $30 of every $100 of sales before interest and taxes."],
  ["P/E ratio", "Price divided by earnings per share. A P/E of 20 means you pay $20 for each $1 of yearly profit. Compare it with the company's own history and its growth."],
  ["PEG ratio", "Forward P/E divided by the expected growth rate. Around 1 is often called fair for the growth; under 1 cheap."],
  ["Price / sales", "Market value divided by yearly revenue. Used for companies with little or no profit yet."],
  ["Recession", "A broad, lasting drop in economic activity, usually with rising unemployment. Shaded on the Economy page's charts."],
  ["Revenue", "Everything the company sold in a period, before any costs. Also called sales."],
  ["Treasury yield", "The interest rate on US government bonds. The 10-year yield sets the tone for mortgage rates and for how much investors pay for stocks."],
  ["VIX", "The \"fear gauge\": how big a move traders expect in the S&P 500 over the next 30 days. Under 15 is calm; over 30 is panic."],
  ["Volatility", "How much a price typically swings, as a yearly percentage. The S&P 500 is about 15%; many single stocks are 30–60%."],
  ["Yield curve", "The gap between long-term and short-term Treasury yields. When short rates are above long rates (inverted), a recession has often followed."]
];
const SIGNAL_RULES = [
  ["Business quality", "Good at 75+ out of 100, mixed at 60–74, warning below 60."],
  ["Price vs. fair value", "Good in the strong-buy zone or below fair value, mixed in the hold zone, warning in the take-profit zone."],
  ["Cash-flow value (DCF)", "Good when the DCF value is 15%+ above the price, warning when it's 15%+ below, mixed in between."],
  ["P/E vs. its own history", "Today's P/E (on normal earnings when reported earnings include one-time gains) vs. the 5-year median: good when 15%+ below, warning when 15%+ above."],
  ["Analyst targets", "Good when the average target is 15%+ above the price, mixed from 0 to 15%, warning when below the price."],
  ["Price trend", "Good when the price is above its 200-day average and up over 6 months, warning when both are false, mixed otherwise."],
  ["Insider buying", "Good when insiders bought $100K+ on the open market in 12 months; otherwise mixed (selling alone isn't treated as a warning)."],
  ["Fit for today's economy", "Good with a recession score of 7+ and little rate sensitivity; warning with a recession score of 4 or less or a big drop when rates rise; mixed otherwise."]
];

RENDER.learn = function (root) {
  root.append(el("div", { class: "page-head" }, el("div", null,
    el("div", { class: "eyebrow" }, "Guide"),
    el("h1", null, "Learn"),
    el("p", null, "How to use this site to make a decision, how every number is calculated, and a plain-English glossary."))));

  root.append(panel("How to decide on a stock", "A checklist in the order that matters",
    el("ol", { style: "margin:0;padding-left:22px;display:grid;gap:10px" }, STEPS.map(([h, t]) => el("li", null, el("b", null, h + ". "), t))),
    el("div", { class: "callout" }, el("b", null, "Not financial advice. "), "This site organizes information and runs simple models. It can't know your goals, your timeline or your other money. For decisions that matter a lot, a licensed financial advisor can help.")));

  const parts = el("div", { class: "tablewrap" }, el("table", null,
    el("thead", null, el("tr", null, el("th", null, "Part"), el("th", { class: "n" }, "Points"), el("th", null, "What it asks"))),
    el("tbody", null, PARTS.map(([nm, mx], i) => el("tr", null, el("td", null, el("b", null, nm)), el("td", { class: "n" }, String(mx)),
      el("td", { class: "small" }, ["Growth, margins, cash flow and debt.", "Is the price fair or cheap for the growth?", "Do strengths and opportunities outweigh weaknesses and threats?", "Are its inputs secure and not dependent on one country or supplier?", "Is demand rising faster than it can serve?", "Is it stronger today than 3–5 years ago?", "Are customer habits moving toward it?", "Is it safe from tariffs, trade fights, lawsuits and regulators?", "Would it hold up if the economy stays weak for years?", "Are analysts and the public positive, with a clear path forward?"][i]))))));
  root.append(panel("How the 100-point score works", "Scored by research on Oct 1, 2026", parts,
    what("An average company scores about 60–65. Grades: A is 85+, B 75–84, C 65–74, D 55–64, F below 55. The score is about the business, not the price: a great company can still be too expensive.")));

  root.append(panel("How the 8 signals work", "Each check is green (good), yellow (mixed) or red (warning)",
    el("div", { class: "tablewrap" }, el("table", null, el("tbody", null, SIGNAL_RULES.map(([n, r]) => el("tr", null, el("td", null, el("b", null, n)), el("td", { class: "small" }, r))))))));

  root.append(panel("How the valuations are calculated", null,
    el("div", { class: "grid2" },
      el("div", { class: "stack" }, el("h3", null, "Fair-value model and price zones"),
        el("p", { class: "small" }, "Fair value = a per-share earnings (or cash-flow) figure × a fair multiple for that company. The strong-buy line is fair value minus a safety margin (15–25% depending on risk). The 1-year target averages fair value grown one year with the analyst average target. Price zones: at or under the strong-buy line, below fair value, hold (between fair value and target), take-profit (at or over the target). You can edit every input on the stock page.")),
      el("div", { class: "stack" }, el("h3", null, "DCF"),
        el("p", { class: "small" }, "Starts from yearly cash: by default the average of last year's free cash flow and next year's expected earnings. It grows at your rate for 5 years, fades to the long-run rate by year 10, and continues at that rate forever after. Every year is discounted back at your discount rate (10-year Treasury yield plus the stock's adjusted beta × 4%, kept between 8% and 12.5%), then net cash is added and the total is divided by shares.")),
      el("div", { class: "stack" }, el("h3", null, "P/E history"),
        el("p", { class: "small" }, "Each month-end price is divided by the earnings per share the company had reported for the previous 12 months at that time, from SEC filings (adjusted for stock splits; foreign companies converted to US dollars). The normal range is the middle half of the last 5 years.")),
      el("div", { class: "stack" }, el("h3", null, "Sensitivity to rates and oil"),
        el("p", { class: "small" }, "From the last 60 months: each month's stock return is compared with that month's change in the 10-year Treasury yield, and with the change in oil prices. The slope says how much the stock has tended to move per 1-point yield rise or 10% oil rise.")))));

  // glossary with search
  const q = el("input", { id: "gl-q", type: "search", placeholder: "Find a term", "aria-label": "Search the glossary", style: "max-width:320px" });
  const list = el("dl", { style: "margin:0;display:grid;gap:12px" });
  function draw() {
    const n = q.value.trim().toLowerCase();
    list.replaceChildren(...GLOSSARY.filter(([t, d]) => !n || t.toLowerCase().includes(n) || d.toLowerCase().includes(n)).flatMap(([t, d]) => [el("dt", { style: "font-weight:700" }, t), el("dd", { style: "margin:2px 0 0;color:var(--ink-2);max-width:75ch" }, d)]));
    if (!list.children.length) list.append(el("p", { class: "note" }, "No term matches “" + q.value + "”. Try Ask Claude on any stock page."));
  }
  q.addEventListener("input", draw);
  draw();
  root.append(panel("Glossary", GLOSSARY.length + " terms", q, list));

  const L = D.macro.latest;
  const rows = [
    ["Stock prices and price history", "Yahoo Finance", "Close on " + AS_OF_LABEL + "; history back to 2005"],
    WEB ? null : ["Live price (button on stock pages)", "Your Flashalpha connector", "On demand; the free plan allows 5 calls a day"],
    ["Company research, scores, scenarios", "Filings, market data and news (Claude research)", "Oct 1, 2026, with October earnings updates"],
    ["Earnings-per-share history (P/E history)", "SEC EDGAR filings", "Latest reported quarter, through mid-2026"],
    ["Analyst targets by firm", "StockAnalysis, Investing.com, broker notes", "Oct 15–16, 2026"],
    ["Earnings dates and estimates", "Nasdaq (Zacks)", AS_OF_LABEL],
    ["Insider buys and sales", "SEC Form 4 via OpenInsider", "12 months to " + AS_OF_LABEL],
    ["Fund ownership", "Nasdaq, from 13F filings", "Latest quarter reported"],
    ["Economy", "FRED (Federal Reserve Bank of St. Louis)", "Latest releases, e.g. 10-year yield on " + dLabel(L.DGS10[0])],
    ["Market mood", "Computed from closing prices (VIX, S&P 500, share of the 50 stocks above their 200-day average)", AS_OF_LABEL]
  ];
  root.append(panel("Where the data comes from", null,
    el("div", { class: "tablewrap" }, el("table", null, el("thead", null, el("tr", null, el("th", null, "What"), el("th", null, "Source"), el("th", null, "As of"))),
      el("tbody", null, rows.filter(Boolean).map(r => el("tr", null, r.map((c, i) => el("td", { class: i ? "small" : null }, i ? c : el("b", null, c)))))))),
    what(WEB ? "Prices, earnings history, insider trades, estimates and the economy refresh automatically every weekday evening after the US market closes. The research itself (scores, summaries, scenarios) changes only when it is redone." : "Prices and data are a snapshot, not a live feed. To refresh everything (prices, P/E history, insider trades, the economy), ask Claude in the chat where this site was built; it updates at the same link.")));
};

/* ============================================================
   Boot
   ============================================================ */
buildShell();
if (WEB) {
  const b = document.body.dataset;
  route(b.page === "stock" ? "stock-" + b.ticker : b.page || "home");
} else {
  route(location.hash.slice(1) || store.get("last", "home"));
}

}
var boot = document.getElementById("boot");
fetch(document.body.dataset.data).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(function (D) { if (boot) boot.remove(); startApp(D); })
  .catch(function (e) { console.error(e); if (boot) boot.innerHTML = "<b>Couldn't load the data</b><span>Check your connection and refresh the page.</span>"; });
})();
