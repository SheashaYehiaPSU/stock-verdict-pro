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
