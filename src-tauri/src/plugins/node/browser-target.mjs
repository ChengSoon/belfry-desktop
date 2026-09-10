import { EventEmitter } from "node:events";
import { BrowserCdp } from "./browser-cdp.mjs";
import { BrowserPreview } from "./browser-preview.mjs";
import { apiError } from "./errors.mjs";
import { BrowserFileChooser } from "./browser-files.mjs";

export class BrowserTarget extends EventEmitter {
  constructor(process, options) {
    super(); this.process = process; this.options = options; this.cdp = new BrowserCdp(this);
    this.files = new BrowserFileChooser(this, options);
    this.preview = new BrowserPreview(options.workspace, () => this.send("Page.reload"));
    this.viewport = { width: 1280, height: 720 }; this.visible = false; this.isLoading = false; this.closed = false; this.generation = 0;
  }
  async start() {
    this.contextId = (await this.process.send("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
    try {
      this.targetId = (await this.process.send("Target.createTarget", { url: "about:blank", browserContextId: this.contextId })).targetId;
      this.sessionId = (await this.process.send("Target.attachToTarget", { targetId: this.targetId, flatten: true })).sessionId;
      this.listener = (message) => { if (message.sessionId === this.sessionId) this.event(message.method, message.params ?? {}); };
      this.process.on("protocol", this.listener);
      await this.cdp.initialize();
      await this.files.initialize();
      await this.send("Emulation.setDeviceMetricsOverride", { ...this.viewport, deviceScaleFactor: 1, mobile: false });
      await this.send("Runtime.addBinding", { name: "__belfryBrowserState" });
      await this.send("Page.addScriptToEvaluateOnNewDocument", { source: `addEventListener('DOMContentLoaded',()=>{
        const title=document.querySelector('title'); if(title)new MutationObserver(()=>window.__belfryBrowserState('')).observe(title,{childList:true,subtree:true,characterData:true});
      });` });
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  send(method, params = {}) { return this.process.send(method, params, this.sessionId); }
  event(method, params) {
    if (["Page.frameNavigated", "Runtime.executionContextsCleared"].includes(method)) this.generation++;
    this.cdp.event(method, params);
    this.files.event(method, params);
    if (method === "Page.screencastFrame") {
      void this.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
      if (this.visible) this.options.frame({ data: params.data, mimeType: "image/jpeg", ...this.viewport });
      return;
    }
    if (method === "Page.frameStartedLoading") this.isLoading = true;
    if (method === "Page.loadEventFired" || method === "Page.frameStoppedLoading") { this.isLoading = false; this.emit("loaded"); }
    if (["Page.frameNavigated", "Page.navigatedWithinDocument", "Page.loadEventFired", "Runtime.bindingCalled"].includes(method)) {
      clearTimeout(this.stateTimer);
      this.stateTimer = setTimeout(() => void this.state().then(this.options.state).catch(() => {}), 40);
    }
  }
  async state() {
    const [history, info] = await Promise.all([this.send("Page.getNavigationHistory"), this.cdp.evaluate("({url:location.href,title:document.title})")]);
    return { ...info, url: info.url === "about:blank" ? "" : info.url, isLoading: this.isLoading,
      canGoBack: history.currentIndex > 0, canGoForward: history.currentIndex < history.entries.length - 1 };
  }
  loadEvent() {
    let finish;
    const promise = new Promise((resolve) => { finish = resolve; });
    const timer = setTimeout(finish, 15_000), onLoad = () => finish(); this.once("loaded", onLoad);
    return { promise, cancel: () => { clearTimeout(timer); this.off("loaded", onLoad); finish(); } };
  }
  async navigate(input) {
    const url = await this.preview.target(input), loaded = this.loadEvent();
    try {
      const result = await this.send("Page.navigate", { url });
      if (result.errorText) throw apiError("BROWSER_ERROR", result.errorText);
      await loaded.promise;
      const state = await this.state(); this.options.state(state); return state;
    } finally { loaded.cancel(); }
  }
  async action(input) {
    const action = input?.action;
    if (action === "reload") await this.send("Page.reload");
    else if (action === "stop") await this.send("Page.stopLoading");
    else if (["back", "forward"].includes(action)) {
      const history = await this.send("Page.getNavigationHistory"), entry = history.entries[history.currentIndex + (action === "back" ? -1 : 1)];
      if (entry) await this.send("Page.navigateToHistoryEntry", { entryId: entry.id });
    } else throw apiError("INVALID_ARGUMENT", "浏览器导航动作无效");
    return null;
  }
  async bounds(input) {
    if (![input?.x, input?.y, input?.width, input?.height].every(Number.isFinite)) throw apiError("INVALID_ARGUMENT", "浏览器区域无效");
    this.viewport = { width: Math.max(1, Math.min(1600, Math.floor(input.width))), height: Math.max(1, Math.min(1200, Math.floor(input.height))) };
    await this.send("Emulation.setDeviceMetricsOverride", { ...this.viewport, deviceScaleFactor: 1, mobile: false });
    return { ...input, width: this.viewport.width, height: this.viewport.height };
  }
  async visibility(visible) {
    if (this.visible === visible || this.closed) return null;
    this.visible = visible;
    await this.send(visible ? "Page.startScreencast" : "Page.stopScreencast", visible ? { format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 960, everyNthFrame: 1 } : {});
    return null;
  }
  async close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.stateTimer);
    if (this.listener) this.process.off("protocol", this.listener);
    await this.preview.close();
    if (this.contextId) await this.process.send("Target.disposeBrowserContext", { browserContextId: this.contextId }).catch(() => {});
    this.removeAllListeners();
  }
}
