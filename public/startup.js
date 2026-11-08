// Synchronous first-paint appearance setup. Keep the theme key aligned with src/theme/storage.ts.
// A separate same-origin script lets the production CSP reject arbitrary inline scripts.
(function () {
  var mode = "dark";
  try {
    var saved = localStorage.getItem("belfry.theme.v1");
    mode = saved === "light" || saved === "dark"
      ? saved : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch (_) { /* Use dark mode if storage is unavailable. */ }
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]').content = mode === "light" ? "#fafafa" : "#0a0a0b";
  if (navigator.userAgent.indexOf("Mac") !== -1) document.documentElement.dataset.platform = "macos";
  else if (navigator.userAgent.indexOf("Windows") !== -1) document.documentElement.dataset.platform = "windows";
})();
