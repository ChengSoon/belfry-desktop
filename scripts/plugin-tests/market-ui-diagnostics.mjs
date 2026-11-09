import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "vite";

const PAGES = ["/scripts/plugin-tests/fixtures/dropdown-page.html", "/scripts/plugin-tests/fixtures/market-page.html"];
const BINDING = "__belfryMarketDiagnostic";
const CAPTURE_MS = 1_000, LIMIT = 128, TEXT = 2_048;
const diagnosticsByView = new WeakMap();
export const diagnosticsFor = (view) => diagnosticsByView.get(view);
const text = (value, limit = TEXT) => String(value ?? "").slice(0, limit);
const errorInfo = (error) => ({ name: text(error?.name, 80), code: text(error?.code, 80), message: text(error?.message) });

// Opt-in, test-only diagnostics. Page content is read atomically only at the
// known local fixture URL; the production BrowserDiagnostics stays content-free.
export class MarketUiDiagnostics {
  constructor(t, { directory = process.env.BELFRY_MARKET_UI_ARTIFACTS ?? process.env.BELFRY_PANEL_ARTIFACTS,
    write = writeFile } = {}) {
    this.test = t; this.directory = directory; this.write = write; this.id = randomUUID();
    this.artifact = join("market-ui-readiness", `${process.pid}-${this.id}.json`);
    this.browserArtifact = join("market-ui-readiness", `${process.pid}-${this.id}.browser.json`);
    this.started = performance.now(); this.startedAt = new Date().toISOString();
    this.records = {}; this.dropped = {}; this.captureErrors = []; this.writeErrors = [];
    this.requests = new Map(); this.captures = [];
    t.after(() => this.finish()); // Register after cleanupScope: final state includes cleanup.
  }
  now() { return Math.round((performance.now() - this.started) * 1000) / 1000; }
  record(channel, event, data = {}) {
    const entries = this.records[channel] ??= [];
    entries.push({ ms: this.now(), event, ...data });
    if (entries.length > LIMIT) { entries.splice(32, 1); this.dropped[channel] = (this.dropped[channel] ?? 0) + 1; }
  }
  async step(name, run) {
    this.record("phases", `${name}.start`);
    try { const value = await run(); this.record("phases", `${name}.end`); return value; }
    catch (error) {
      this.record("phases", `${name}.error`, errorInfo(error));
      if (!name.startsWith("cleanup.")) this.failure(error, name);
      throw error;
    }
  }
  failure(error, phase) {
    this.firstFailure ??= { ms: this.now(), phase, ...errorInfo(error), request: error?.browserRequest };
    this.engine?.reportFailure(error, `fixture.${phase}`);
  }
  logger() {
    const logger = createLogger("silent");
    for (const method of ["warn", "warnOnce", "error"]) {
      const original = logger[method].bind(logger);
      logger[method] = (message, options) => { this.record("vite", method, { message: text(message) }); original(message, options); };
    }
    return logger;
  }
  middleware(request, response, next) {
    const started = this.now(), path = text(request.url?.split("?")[0], 256);
    this.record("server", "request", { path });
    response.once("close", () => {
      const result = { path, status: response.statusCode, finished: response.writableFinished, elapsedMs: this.now() - started };
      this.record("server", "response", result);
      if (result.status >= 400 || !result.finished) this.record("resourceErrors", "server.response", result);
    });
    next();
  }
  attachEngine(engine) {
    this.engine = engine;
    const send = engine.send.bind(engine);
    engine.send = (method, params, sessionId) => {
      const id = engine.next + 1, started = this.now();
      // Names and hashed identities only, never CDP expressions/results here.
      this.record("requests", "send", { id, method, sessionId: engine.diagnostics.identity(sessionId) });
      const request = send(method, params, sessionId);
      void request.then((result) => this.record("requests", "response", { id, elapsedMs: this.now() - started, exception: !!result?.exceptionDetails }),
        (error) => this.record("requests", "error", { id, elapsedMs: this.now() - started, code: text(error.code, 80) }));
      return request;
    };
    this.listener = (message) => this.protocol(message);
    engine.on("protocol", this.listener);
  }
  localPath(url) {
    try { const parsed = new URL(url); return parsed.origin === this.origin ? text(parsed.pathname, 256) : null; }
    catch { return null; }
  }
  protocol({ method, params = {}, sessionId }) {
    if (this.view && sessionId !== this.view.sessionId) return;
    const identity = (value) => this.engine.diagnostics.identity(value);
    if (/^(Page\.(frame|loadEventFired|domContentEventFired)|Runtime\.executionContext|Inspector\.)/.test(method)) {
      const context = params.context;
      this.record("lifecycle", method, { frame: identity(params.frame?.id ?? params.frameId ?? context?.auxData?.frameId),
        loader: identity(params.frame?.loaderId ?? params.loaderId), context: context?.id ?? params.executionContextId,
        defaultContext: context?.auxData?.isDefault, session: identity(sessionId) });
      if (method === "Page.frameNavigated" && !params.frame.parentId) this.knownPage = PAGES.includes(this.localPath(params.frame.url));
    }
    if (method === "Runtime.bindingCalled" && params.name === BINDING && this.knownPage) {
      if (typeof params.payload !== "string" || params.payload.length > 8_192) return;
      try { this.record("pageEvents", "state", { context: params.executionContextId, value: JSON.parse(params.payload) }); }
      catch { this.record("pageEvents", "invalid-binding"); }
    }
    if (this.knownPage && method === "Runtime.exceptionThrown") this.record("exceptions", method, {
      context: params.exceptionDetails?.executionContextId,
      message: text(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text),
    });
    if (this.knownPage && method === "Runtime.consoleAPICalled") this.record("console", params.type, {
      message: text((params.args ?? []).slice(0, 8).map((arg) => text(arg.value ?? arg.description, 256)).join(" ")),
    });
    if (method === "Network.requestWillBeSent" && PAGES.includes(this.localPath(params.documentURL))) {
      const path = this.localPath(params.request?.url);
      if (path) {
        this.requests.set(params.requestId, path);
        if (this.requests.size > LIMIT) this.requests.delete(this.requests.keys().next().value);
        this.record("network", "request", { id: identity(params.requestId), path, type: params.type });
      }
    }
    const path = this.requests.get(params.requestId);
    if (!path) return;
    if (method === "Network.responseReceived") {
      const result = { id: identity(params.requestId), path, status: params.response?.status, mimeType: text(params.response?.mimeType, 80) };
      this.record("network", "response", result);
      if (result.status >= 400) this.record("resourceErrors", method, result);
    }
    if (["Network.loadingFailed", "Network.loadingFinished"].includes(method)) {
      this.record("network", method, { id: identity(params.requestId), path, error: text(params.errorText, 256), cancelled: params.canceled });
      if (method === "Network.loadingFailed") this.record("resourceErrors", method, { path, error: text(params.errorText, 256) });
      this.requests.delete(params.requestId);
    }
  }
  async attachView(view, origin) {
    this.view = view; this.origin = origin; diagnosticsByView.set(view, this);
    const navigate = view.navigate.bind(view);
    view.navigate = (input) => this.step("navigate", () => navigate(input));
    const source = `(() => {
      if(location.origin!==${JSON.stringify(origin)}||!${JSON.stringify(PAGES)}.includes(location.pathname))return;
      let count=0,last='';
      const state=()=>{const root=document.getElementById('root');return {readyState:document.readyState,
        visibility:document.visibilityState,root:!!root,children:root?.childElementCount??0,
        control:!!document.querySelector('button[aria-label="设置类型"]'),market:!!document.querySelector('#plugins-tab-market')};};
      const report=()=>{const value=JSON.stringify(state());if(value===last||count>=16)return;last=value;count++;
        try{window[${JSON.stringify(BINDING)}](value);}catch{}};
      report();document.addEventListener('readystatechange',report);addEventListener('DOMContentLoaded',report);addEventListener('load',report);
      const observer=new MutationObserver(report);observer.observe(document,{childList:true,subtree:true});
      addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    })()`;
    this.installation = {};
    await Promise.allSettled([
      this.captureOne(this.installation, "network", () => view.send("Network.enable")),
      this.captureOne(this.installation, "binding", () => view.send("Runtime.addBinding", { name: BINDING })),
      this.captureOne(this.installation, "documentHook", () => view.send("Page.addScriptToEvaluateOnNewDocument", { source })),
    ]);
  }
  async capture(label) {
    if (!this.view) return;
    const capture = { label, ms: this.now() }; this.captures.push(capture);
    if (this.captures.length > 8) this.captures.shift();
    const page = `(() => {
      if(location.origin!==${JSON.stringify(this.origin)}||!${JSON.stringify(PAGES)}.includes(location.pathname))return {scope:'outside-known-fixture'};
      const root=document.getElementById('root');const nav=performance.getEntriesByType('navigation')[0];
      return {scope:'known-market-fixture',path:location.pathname,readyState:document.readyState,visibility:document.visibilityState,
        root:!!root,children:root?.childElementCount??0,html:(root?.outerHTML??'').slice(0,4096),
        controls:[...document.querySelectorAll('button')].slice(0,12).map(el=>({label:(el.getAttribute('aria-label')??'').slice(0,128),disabled:el.disabled})),
        navigation:nav?{domInteractive:nav.domInteractive,domContentLoadedEventEnd:nav.domContentLoadedEventEnd,loadEventEnd:nav.loadEventEnd}:null};
    })()`;
    // Each channel is independent. The one-second observation window neither
    // changes the original 10s wait / 20s request deadline nor retries a command.
    await Promise.allSettled([
      this.captureOne(capture, "page", () => this.view.cdp.evaluate(page)),
      this.captureOne(capture, "frame", async () => {
        const { frameTree } = await this.view.send("Page.getFrameTree");
        return { frame: this.engine.diagnostics.identity(frameTree?.frame?.id),
          loader: this.engine.diagnostics.identity(frameTree?.frame?.loaderId),
          knownPage: PAGES.includes(this.localPath(frameTree?.frame?.url)) };
      }),
    ]);
    this.record("phases", "capture.end", { label, elapsedMs: this.now() - capture.ms });
  }
  async captureOne(capture, channel, read) {
    let timer;
    try {
      capture[channel] = await Promise.race([Promise.resolve().then(read), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("diagnostic observation window elapsed")), CAPTURE_MS);
      })]);
    } catch (error) {
      const detail = { ms: this.now(), channel, ...errorInfo(error) };
      this.captureErrors.push(detail); if (this.captureErrors.length > 16) this.captureErrors.shift();
      capture[channel] = { unavailable: true, error: detail };
    } finally { clearTimeout(timer); }
  }
  snapshot() {
    return { schemaVersion: 1, id: this.id, test: text(this.test.name), startedAt: this.startedAt, elapsedMs: this.now(),
      browserId: this.engine?.diagnostics.id, browserSnapshot: this.browserArtifact,
      browserClockOffsetMs: this.engine ? this.engine.diagnostics.started - this.started : undefined,
      pageWaitMs: 10_000, protocolRequestMs: this.engine?.diagnostics.requestTimeoutMs,
      firstFailure: this.firstFailure, installation: this.installation, records: this.records, dropped: this.dropped, captures: this.captures,
      captureErrors: this.captureErrors, writeErrors: this.writeErrors, process: this.engine?.diagnosticState() };
  }
  async persist() {
    if (!this.directory) return;
    const directory = join(this.directory, "market-ui-readiness"), base = `${process.pid}-${this.id}`;
    // Do not let one failed write suppress the other artifact or the test error.
    for (const [suffix, value] of [["browser.json", this.engine?.diagnostics.snapshot(this.engine.diagnosticState())], ["json", this.snapshot()]]) {
      if (!value) continue;
      try {
        await mkdir(directory, { recursive: true });
        await this.write(join(directory, `${base}.${suffix}`), JSON.stringify(value, null, 2) + "\n");
      } catch (error) { this.writeErrors.push({ suffix, ...errorInfo(error) }); if (this.writeErrors.length > 16) this.writeErrors.shift(); }
    }
  }
  async finish() {
    this.record("phases", "fixture.complete");
    await this.persist();
    if (this.listener) this.engine.off("protocol", this.listener);
    if (this.view) diagnosticsByView.delete(this.view);
    if (this.firstFailure || this.writeErrors.length) this.test.diagnostic(JSON.stringify({
      fixtureId: this.id, browserId: this.engine?.diagnostics.id, artifact: this.artifact,
      firstFailure: this.firstFailure, captureErrors: this.captureErrors, writeErrors: this.writeErrors,
    }));
  }
}
