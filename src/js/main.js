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
