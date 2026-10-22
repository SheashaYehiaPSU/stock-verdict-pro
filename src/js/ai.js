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
