import { randomUUID } from "node:crypto";
import { BrowserTarget } from "./browser-target.mjs";
import { apiError } from "./errors.mjs";

const CLIPBOARD_URL = "https://clipboard.belfry.invalid/";
const MAX_TEXT_BYTES = 512 * 1024;
const DOCUMENT = Buffer.from('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Clipboard bridge</title>').toString("base64");

// Headless Chromium 的剪贴板与桌面隔离。仅在复制 / 剪切时读取其原生结果，保留网页处理器与撤销行为。
export class BrowserClipboard {
  constructor(process) { this.process = process; this.queue = Promise.resolve(); this.closed = false; }
  ready() {
    this.starting ??= this.start().catch(async (error) => {
      await this.dispose(); this.starting = null; throw error;
    });
    return this.starting;
  }
  async start() {
    if (this.closed) throw apiError("BROWSER_CLOSED", "浏览器剪贴板已关闭");
    this.view = await new BrowserTarget(this.process, { frame: () => {}, state: () => {} }).start();
    this.listener = (message) => {
      if (message.sessionId !== this.view.sessionId || message.method !== "Fetch.requestPaused") return;
      void this.fulfill(message.params).catch(() => {});
    };
    this.process.on("protocol", this.listener);
    await this.view.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await this.view.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await this.process.send("Browser.grantPermissions", { browserContextId: this.view.contextId,
      origin: new URL(CLIPBOARD_URL).origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await this.view.navigate({ url: CLIPBOARD_URL });
    return this.view;
  }
  fulfill({ requestId, request }) {
    const allowed = request.url === CLIPBOARD_URL;
    return this.view.send("Fetch.fulfillRequest", { requestId, responseCode: allowed ? 200 : 403,
      responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" },
        { name: "Content-Security-Policy", value: "default-src 'none'" }], body: allowed ? DOCUMENT : "" });
  }
  copy(target, dispatch) {
    return this.enqueue(target, (current) => this.transfer(target, { dispatch, current }));
  }
  paste(target, text) {
    return this.enqueue(target, (current) => this.pasteText(target, { current, text }));
  }
  enqueue(target, operation) {
    const generation = target.generation;
    const current = () => !this.closed && !target.closed && target.visible
      && target.generation === generation && (target.options.active?.() ?? true);
    const pending = this.queue.then(() => operation(current)).catch((error) => {
      if (current()) target.options.reportError?.(error);
      throw error;
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
  async transfer(target, { dispatch, current }) {
    if (!current()) return;
    const view = await this.ready(), marker = randomUUID();
    if (!current()) return;
    await evaluate(view, prepareClipboard, marker);
    try {
      if (!current()) return;
      await dispatch();
      const result = await evaluate(view, readClipboard, { marker, limit: MAX_TEXT_BYTES });
      if (!current()) return;
      if (result.tooLarge) throw apiError("LIMIT_EXCEEDED", "复制的文本超过 512 KiB");
      if (typeof result.text === "string") await target.options.writeClipboard(result.text);
    } finally { await evaluate(view, restoreClipboard, marker).catch(() => {}); }
  }
  async pasteText(target, { current, text }) {
    if (!current()) return;
    const view = await this.ready();
    if (!current()) return;
    await evaluate(view, prepareClipboard, text);
    try {
      if (current()) await target.send("Input.dispatchKeyEvent", { type: "keyDown", commands: ["paste"] });
    } finally { await evaluate(view, restoreClipboard, text).catch(() => {}); }
  }
  async dispose() {
    if (this.listener) this.process.off("protocol", this.listener);
    await this.view?.close().catch(() => {});
    this.view = null;
  }
  async close() {
    this.closed = true;
    await this.starting?.catch(() => {});
    await this.dispose();
  }
}

async function evaluate(view, operation, input) {
  const result = await view.send("Runtime.evaluate", { expression: `(${operation})(${JSON.stringify(input)})`,
    returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw apiError("BROWSER_ERROR", "浏览器剪贴板传输失败");
  return result.result?.value;
}
async function prepareClipboard(marker) {
  window.previousClipboard = await navigator.clipboard.read();
  await navigator.clipboard.writeText(marker);
}
async function readClipboard({ marker, limit }) {
  const text = await navigator.clipboard.readText();
  if (text === marker) return {};
  return new TextEncoder().encode(text).length > limit ? { tooLarge: true } : { text };
}
async function restoreClipboard(marker) {
  try {
    if (await navigator.clipboard.readText() !== marker) return;
    if (window.previousClipboard.length) await navigator.clipboard.write(window.previousClipboard);
    else await navigator.clipboard.writeText("");
  } finally { delete window.previousClipboard; }
}
