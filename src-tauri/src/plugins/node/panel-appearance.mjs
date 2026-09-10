// PI 的整份自定义主题同时作用于面板和嵌入视图。
export function installPanelAppearance(bridge) {
  let style, current;
  function apply(value) {
    if (!value) return;
    current = value;
    const base = ["light", "dark"].includes(value.base) ? value.base : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = base; document.documentElement.dataset.base = base;
    document.documentElement.style.colorScheme = base;
    document.documentElement.lang = value.locale || "zh-CN";
    style?.remove(); style = null;
    if (typeof value.pluginTheme?.css === "string") {
      style = document.createElement("style"); style.dataset.piPluginAppTheme = value.pluginTheme.id;
      style.textContent = value.pluginTheme.css; (document.head ?? document.documentElement).append(style);
    }
    window.dispatchEvent(new Event("pi-plugin-appearance"));
  }
  bridge.on("appearance:changed", apply);
  void bridge.invoke("app.getAppearance").then(apply).catch(() => {});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply(current), { once: true });
}
