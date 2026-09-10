// Adapted from PI-Desktop plugin-panel.ts, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
export function installPanelChrome(bridge, css) {
  const HEIGHT = 46, embedded = new URLSearchParams(location.search).get("piSurface") === "view";
  document.documentElement.style.setProperty("--pi-plugin-titlebar-height", embedded ? "0px" : `${HEIGHT}px`);
  const mount = () => {
    if (embedded || document.querySelector("pi-plugin-panel-chrome")) return;
    const mode = document.querySelector('meta[name="pi-plugin-chrome"]')?.content
      ?? (document.querySelector('meta[name="pi-plugin-panel-chrome"]')?.content === "safe-area-v1" ? "v2" : undefined);
    const host = document.createElement("pi-plugin-panel-chrome");
    host.dataset.chromeMode = mode === "v3" ? "paint-through" : mode === "v2" ? "safe-area" : "legacy";
    host.setAttribute("role", "toolbar"); host.setAttribute("aria-label", "窗口控制");
    if (host.dataset.chromeMode === "legacy") {
      const padding = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
      document.body.style.setProperty("padding-top", `${padding + HEIGHT}px`, "important");
      document.body.style.setProperty("box-sizing", "border-box", "important");
    }
    const shadow = host.attachShadow({ mode: "closed" }), style = document.createElement("style");
    style.textContent = css; shadow.append(style);
    const chrome = document.createElement("div"); chrome.className = "chrome";
    const drag = document.createElement("div"); drag.className = "drag-region";
    const controls = document.createElement("div"); controls.className = "capsule";
    const invoke = (action) => bridge.invoke("ui.windowControl", { action }).catch(() => {});
    for (const [action, label, glyph] of [["minimize", "最小化", "minimize"], ["toggleMaximize", "最大化 / 还原", "maximize"], ["close", "关闭", "close"]]) {
      const button = document.createElement("button"), icon = document.createElement("span");
      button.type = "button"; button.className = `control control-${glyph}`; button.title = label; button.setAttribute("aria-label", label);
      icon.className = `glyph glyph-${glyph}`; icon.setAttribute("aria-hidden", "true"); button.append(icon);
      button.onclick = async () => { const result = await invoke(action); if (action === "toggleMaximize") icon.className = `glyph glyph-${result?.maximized ? "restore" : "maximize"}`; };
      controls.append(button);
    }
    chrome.append(drag, controls); shadow.append(chrome); document.body.append(host);
    const interactive = 'a,button,input,label,select,summary,textarea,[contenteditable],[draggable="true"],[role="button"],[tabindex],[data-pi-plugin-no-drag]';
    document.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.clientY > HEIGHT || event.composedPath().some((node) => node instanceof Element && node.matches(interactive))) return;
      event.preventDefault(); void invoke("drag");
    }, true);
    drag.ondblclick = () => void invoke("toggleMaximize");
    const tint = () => {
      const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
      host.dataset.theme = document.documentElement.dataset.theme ?? "dark";
      host.style.setProperty("--pi-plugin-panel-page-background", body.backgroundColor === "rgba(0, 0, 0, 0)" ? root.backgroundColor : body.backgroundColor);
      host.style.setProperty("--pi-plugin-panel-page-foreground", body.color);
    };
    tint(); bridge.on("appearance:changed", () => setTimeout(tint));
    window.addEventListener("pi-plugin-appearance", tint);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
}
