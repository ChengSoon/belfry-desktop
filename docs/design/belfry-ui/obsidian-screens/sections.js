// settings-sections.html 的分区切换：?section=provider|project|hooks|shortcuts|backup|environment|about（默认 provider）。
// 只读 URL / 点击切换显示，不写存储，不发请求。
(() => {
  const ids = ["provider", "project", "hooks", "shortcuts", "backup", "environment", "about"];
  const pick = (id) => {
    if (!ids.includes(id)) id = "provider";
    for (const s of document.querySelectorAll("[data-section]")) s.hidden = s.dataset.section !== id;
    for (const b of document.querySelectorAll("[data-nav]")) {
      b.classList.toggle("is-active", b.dataset.nav === id);
      b.setAttribute("aria-current", b.dataset.nav === id ? "page" : "false");
    }
  };
  addEventListener("DOMContentLoaded", () => {
    pick(new URLSearchParams(location.search).get("section"));
    for (const b of document.querySelectorAll("[data-nav]")) b.addEventListener("click", () => {
      const u = new URL(location.href); u.searchParams.set("section", b.dataset.nav); history.replaceState(null, "", u); pick(b.dataset.nav);
    });
  });
})();
