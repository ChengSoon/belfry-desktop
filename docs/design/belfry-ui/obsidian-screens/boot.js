// ?theme=dark|light（默认 dark），?spec=1 显示尺寸/状态标注。只读 URL，不写存储。
(() => {
  const p = new URLSearchParams(location.search), d = document.documentElement;
  d.dataset.theme = p.get("theme") === "light" ? "light" : "dark";
  if (p.get("spec") === "1") d.dataset.spec = "";
})();
