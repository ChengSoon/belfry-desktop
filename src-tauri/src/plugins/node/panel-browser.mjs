export function installPanelBrowser(bridge) {
  let root, image, keyboard, bounds, visible = false, width = 1, height = 1;
  let inputQueue = Promise.resolve();
  const send = (input) => inputQueue = inputQueue.then(() => bridge.invoke("browser.input", input)).catch((error) => console.error(error));
  const modifiers = (event) => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
  function point(event, type) {
    const rect = root.getBoundingClientRect();
    return { kind: "pointer", type, x: (event.clientX - rect.left) * width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * height / Math.max(1, rect.height), modifiers: modifiers(event),
      button: ["left", "middle", "right"][event.button], clickCount: event.detail || 1 };
  }
  function create() {
    if (root) return;
    root = document.createElement("div"); root.setAttribute("role", "application"); root.setAttribute("aria-label", "插件浏览器页面");
    root.style.cssText = "position:fixed;z-index:10;overflow:hidden;background:white;touch-action:none";
    image = document.createElement("img"); image.draggable = false; image.alt = ""; image.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
    keyboard = document.createElement("textarea"); keyboard.setAttribute("aria-label", "浏览器键盘输入");
    keyboard.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;resize:none";
    root.append(image, keyboard); (document.body ?? document.documentElement).append(root);
    bindBrowserInput({ root, keyboard, send, point, modifiers });
  }
  function layout() {
    if (!bounds) return;
    create();
    const x = Math.max(0, bounds.x), y = Math.max(0, bounds.y);
    const w = Math.max(0, Math.min(innerWidth, bounds.x + bounds.width) - x), h = Math.max(0, Math.min(innerHeight, bounds.y + bounds.height) - y);
    Object.assign(root.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    root.hidden = !visible || w < 1 || h < 1;
  }
  bridge.on("__host:browserFrame", (frame) => {
    if (!frame) { image?.removeAttribute("src"); return; }
    if (!root || root.hidden || typeof frame.data !== "string") return;
    width = frame.width; height = frame.height; image.src = `data:${frame.mimeType};base64,${frame.data}`;
  });
  // 原版 chrome 的 paint 先更新 started，下一帧再让其报告当前可见区域。
  bridge.on("browser:state", () => requestAnimationFrame(() => dispatchEvent(new Event("resize"))));
  addEventListener("resize", layout);
  return (api, input) => {
    if (api === "browser.setBounds" && [input?.x, input?.y, input?.width, input?.height].every(Number.isFinite)) bounds = input;
    if (api === "browser.setVisible") visible = typeof input === "boolean" ? input : input?.visible === true;
    if (["browser.setBounds", "browser.setVisible"].includes(api)) layout();
  };
}

export function bindBrowserInput({ root, keyboard, send, point, modifiers }) {
  let composing = false, moving = false, pending;
  function keys(event, type) {
    if (composing || event.isComposing) return;
    if (browserPasteShortcut(event)) { event.stopPropagation(); return; }
    event.preventDefault(); event.stopPropagation();
    void send({ kind: "key", type, key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifiers(event),
      repeat: event.repeat, location: event.location,
      text: !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 ? event.key : undefined });
  }
  root.addEventListener("pointerdown", (event) => { event.preventDefault(); root.setPointerCapture(event.pointerId); keyboard.focus({ preventScroll: true }); void send(point(event, "mousePressed")); });
  root.addEventListener("pointerup", (event) => { event.preventDefault(); void send(point(event, "mouseReleased")); });
  root.addEventListener("pointermove", (event) => {
    pending = point(event, "mouseMoved");
    if (!moving) { moving = true; requestAnimationFrame(() => { moving = false; void send(pending); }); }
  });
  root.addEventListener("wheel", (event) => { event.preventDefault(); void send({ ...point(event, "mouseWheel"), deltaX: event.deltaX, deltaY: event.deltaY }); }, { passive: false });
  root.addEventListener("contextmenu", (event) => event.preventDefault());
  root.addEventListener("keydown", (event) => keys(event, "keyDown"));
  root.addEventListener("keyup", (event) => keys(event, "keyUp"));
  keyboard.addEventListener("compositionstart", () => { composing = true; });
  keyboard.addEventListener("compositionend", (event) => { composing = false; keyboard.value = ""; if (event.data) void send({ kind: "text", text: event.data }); });
  keyboard.addEventListener("paste", (event) => { event.preventDefault(); const text = event.clipboardData?.getData("text/plain"); if (text) void send({ kind: "paste", text }); });
}

export function browserPasteShortcut(event) {
  if (event.altKey) return false;
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" || event.shiftKey && event.key === "Insert";
}
