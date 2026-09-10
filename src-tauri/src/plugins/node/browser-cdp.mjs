// Adapted from PI-Desktop browser-cdp.ts, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { apiError } from "./errors.mjs";

export const CDP_ALLOWLIST = new Set(["Page.enable", "Page.reload", "Page.captureScreenshot", "Page.getLayoutMetrics", "Page.bringToFront",
  "DOM.enable", "DOM.getDocument", "DOM.querySelector", "DOM.querySelectorAll", "DOM.getBoxModel", "DOM.describeNode", "DOM.scrollIntoViewIfNeeded", "DOM.getOuterHTML", "DOM.getAttributes",
  "Runtime.enable", "Runtime.evaluate", "Runtime.callFunctionOn", "Runtime.getProperties", "Runtime.awaitPromise", "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText",
  "Accessibility.enable", "Accessibility.getFullAXTree", "Accessibility.getPartialAXTree", "Console.enable"]);
const TEXT_CHARS = 64 * 1024, MAX_CONSOLE = 100, MAX_TREE = 2000, SHOT_WIDTH = 1280, SHOT_PIXELS = 16_000_000;
export function flattenAxTree(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node])), childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const queue = nodes.filter((node) => !childIds.has(node.nodeId)).map((node) => ({ node, depth: 0 }));
  const seen = new Set(), lines = [], uids = new Map(); let next = 1, size = 0;
  while (queue.length && lines.length < MAX_TREE && size < TEXT_CHARS) {
    const { node, depth } = queue.shift(); if (seen.has(node.nodeId)) continue; seen.add(node.nodeId);
    if (!node.ignored) {
      const uid = `e${next++}`;
      if (typeof node.backendDOMNodeId === "number") uids.set(uid, node.backendDOMNodeId);
      const line = treeLine(node, uid, depth);
      lines.push(line); size += line.length;
    }
    queue.unshift(...(node.childIds ?? []).map((id) => byId.get(id)).filter(Boolean).map((child) => ({ node: child, depth: node.ignored ? depth : depth + 1 })));
  }
  if (queue.length) lines.push("… (truncated)");
  return { tree: lines.join("\n") || "(empty)", uids };
}
function treeLine(node, uid, depth) {
  const role = node.role?.value?.trim() || "Generic", name = (node.name?.value?.trim() ?? "").slice(0, 2048);
  return `${"  ".repeat(Math.min(depth, 20))}- ${uid} ${role}${name ? ` ${JSON.stringify(name)}` : ""}`;
}
function screenshotClip(metrics, fullPage) {
  const size = fullPage ? metrics.cssContentSize ?? metrics.contentSize : metrics.cssVisualViewport ?? metrics.visualViewport;
  const width = Math.max(1, size?.width ?? size?.clientWidth ?? 1), height = Math.max(1, size?.height ?? size?.clientHeight ?? 1);
  return { ...screenshotOrigin(size, fullPage), width, height,
    scale: Math.min(1, SHOT_WIDTH / width, Math.sqrt(SHOT_PIXELS / (width * height))) };
}
function screenshotOrigin(size, fullPage) { return { x: fullPage ? 0 : size?.pageX ?? 0, y: fullPage ? 0 : size?.pageY ?? 0 }; }
export class BrowserCdp {
  constructor(target) { this.target = target; this.uids = new Map(); this.messages = []; }
  async initialize() {
    for (const domain of ["Runtime", "Page", "DOM", "Accessibility", "Console"]) await this.target.send(`${domain}.enable`);
  }
  event(method, params) {
    if (method === "Runtime.executionContextsCleared") this.uids.clear();
    if (!["Runtime.consoleAPICalled", "Console.messageAdded"].includes(method)) return;
    const text = method === "Console.messageAdded" ? String(params.message?.text ?? "")
      : (params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? arg.type ?? "")).join(" ");
    this.messages.push({ type: params.type ?? params.message?.level ?? "log", text: text.slice(0, 4096), timestamp: Date.now() });
    if (this.messages.length > MAX_CONSOLE) this.messages.shift();
  }
  async command(input) {
    if (!CDP_ALLOWLIST.has(input?.method)) throw apiError("PERMISSION_DENIED", `CDP 方法不允许：${input?.method}`);
    if (Buffer.byteLength(JSON.stringify(input.params ?? {})) > TEXT_CHARS) throw apiError("LIMIT_EXCEEDED", "CDP 参数过大");
    const result = await this.target.send(input.method, input.params ?? {});
    if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) throw apiError("LIMIT_EXCEEDED", "CDP 返回值过大，请缩小查询范围");
    return result;
  }
  async snapshot() {
    const raw = await this.target.send("Accessibility.getFullAXTree"), flat = flattenAxTree(raw.nodes ?? []);
    this.uids = flat.uids;
    const info = await this.evaluate("({url:location.href,title:document.title})");
    return { tree: flat.tree, ...info };
  }
  async screenshot(input = {}) {
    const metrics = await this.target.send("Page.getLayoutMetrics");
    const clip = screenshotClip(metrics, input.fullPage);
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await this.target.send("Page.captureScreenshot", { format: "jpeg", quality: 70, clip, captureBeyondViewport: true });
      if (typeof result?.data === "string" && result.data.length <= 600 * 1024) return { mimeType: "image/jpeg", data: result.data };
      clip.scale *= 0.65;
    }
    throw apiError("LIMIT_EXCEEDED", "浏览器截图超过限制");
  }
  uid(value) {
    const id = this.uids.get(value);
    if (id === undefined) throw apiError("INVALID_ARGUMENT", "页面元素已失效，请重新获取 snapshot");
    return id;
  }
  async click(input) {
    const backendNodeId = this.uid(input?.uid);
    await this.target.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { model } = await this.target.send("DOM.getBoxModel", { backendNodeId }), quad = model?.content;
    if (!Array.isArray(quad) || quad.length < 8) throw apiError("NOT_FOUND", "页面元素没有可点击区域");
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    for (const type of ["mousePressed", "mouseReleased"]) await this.target.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    return null;
  }
  async fill(input) {
    if (typeof input?.text !== "string" || input.text.length > TEXT_CHARS) throw apiError("INVALID_ARGUMENT", "填入内容无效或过长");
    const resolved = await this.target.send("DOM.resolveNode", { backendNodeId: this.uid(input.uid) }), objectId = resolved.object?.objectId;
    if (!objectId) throw apiError("NOT_FOUND", "页面元素已失效");
    try {
      await this.target.send("Runtime.callFunctionOn", { objectId, functionDeclaration: `function(value) {
        this.focus();
        if ('value' in this) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value')?.set;
          if (setter) setter.call(this,value); else this.value=value;
        } else this.textContent=value;
        this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true}));
      }`, arguments: [{ value: input.text }] });
    } finally { await this.target.send("Runtime.releaseObject", { objectId }).catch(() => {}); }
    return null;
  }
  async evaluate(expression) {
    if (typeof expression !== "string" || expression.length > TEXT_CHARS) throw apiError("INVALID_ARGUMENT", "浏览器表达式无效或过长");
    const result = await this.target.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw apiError("TOOL_FAILED", String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).slice(0, 2048));
    const value = result.result?.value ?? result.result?.description ?? null, serialized = JSON.stringify(value);
    return serialized.length > TEXT_CHARS ? { truncated: true, value: serialized.slice(0, TEXT_CHARS) } : value;
  }
  console(input) { return { messages: this.messages.slice(-Math.max(1, Math.min(MAX_CONSOLE, Math.floor(input?.limit) || 50))) }; }
}
