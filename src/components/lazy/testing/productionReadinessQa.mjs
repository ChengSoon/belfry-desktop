import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Opt-in evidence for isolated production fixtures. Like sessionRecoveryQa,
// capture/write failures remain independent and never replace the test error.
export function productionReadinessQa(t, requests) {
  const windows = [];
  let browser;
  const errorInfo = (error, depth = 0) => error ? { name: error.name, message: String(error.message ?? error).slice(0, 6000),
    stack: error.stack?.slice(0, 6000), code: error.code, browserRequest: error.browserRequest,
    ...(depth < 2 && error.cause ? { cause: errorInfo(error.cause, depth + 1) } : {}),
    ...(depth < 2 && error.snapshotError ? { snapshotError: errorInfo(error.snapshotError, depth + 1) } : {}) } : null;
  const processState = () => browser?.diagnostics.snapshot(browser.diagnosticState()) ?? null;
  const save = async (entry) => {
    if (!entry.report.artifacts) return;
    try {
      await mkdir(process.env.BELFRY_PANEL_ARTIFACTS, { recursive: true });
      await writeFile(entry.report.artifacts.json, JSON.stringify(entry.report, null, 2) + "\n");
    } catch (error) { t.diagnostic(`Readiness JSON write failed: ${error.message}`); }
  };
  t.after(async () => {
    for (const entry of windows.length ? windows : [{ phase: "browser.start", events: [] }]) {
      try {
        const { view } = entry;
        const directory = process.env.BELFRY_PANEL_ARTIFACTS;
        const name = `production-readiness-${t.name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 100)}-${windows.indexOf(entry) + 1}`;
        entry.report = { test: t.name, head: process.env.GITHUB_SHA ?? null, node: process.version, platform: process.platform,
          phase: entry.phase, expected: entry.expected, failure: errorInfo(entry.failure ?? browser?.failureError),
          window: { sessionId: view?.sessionId, targetId: view?.targetId, generation: view?.generation, closed: view?.closed },
          browser: processState(), events: entry.events, droppedEvents: entry.dropped ?? 0,
          pageFacts: entry.pageFacts ?? [], droppedPageFacts: entry.droppedFacts ?? 0,
          requests: requests.slice(0, 100), omittedRequests: Math.max(0, requests.length - 100),
          installationErrors: entry.installationErrors ?? [],
          state: null, captureErrors: [], artifacts: directory ? { json: join(directory, `${name}.json`), screenshot: null } : null };
        // Keep host/IPC transport facts even if the page is no longer responsive.
        await save(entry);
        if (view?.sessionId && !view.closed) {
          const captures = await Promise.allSettled([
            view.cdp.evaluate("window.__productionReadiness?.snapshot() ?? null"),
            view.send("Page.captureScreenshot", { format: "png" }),
          ]);
          if (captures[0].status === "fulfilled") {
            entry.report.state = captures[0].value;
            if (entry.report.state?.truncated) entry.report.captureErrors.push({ stage: "snapshot.bound", message: "CDP snapshot exceeded its return limit; host page facts are retained" });
          }
          captures.forEach((result, index) => {
            if (result.status === "rejected") entry.report.captureErrors.push({ stage: ["snapshot", "screenshot"][index], error: errorInfo(result.reason) });
          });
          if (captures[1].status === "fulfilled" && directory) {
            const path = join(directory, `${name}.png`);
            try { await writeFile(path, Buffer.from(captures[1].value.data, "base64")); entry.report.artifacts.screenshot = path; }
            catch (error) { entry.report.captureErrors.push({ stage: "screenshot.write", error: errorInfo(error) }); }
          }
        } else entry.report.captureErrors.push({ stage: "page", message: "Target unavailable before evidence capture" });
        await save(entry);
        t.diagnostic(JSON.stringify({ productionReadiness: { artifacts: entry.report.artifacts, phase: entry.phase,
          failure: entry.report.failure, counts: entry.report.state?.counts,
          installationErrors: entry.report.installationErrors, captureErrors: entry.report.captureErrors } }));
      } catch (error) { t.diagnostic(`Readiness evidence capture failed: ${error.message}`); }
      finally { if (entry.listen) browser?.off("protocol", entry.listen); }
    }
  });
  return {
    browser(value) { browser = value; },
    afterCleanup() {
      t.after(async () => {
        for (const entry of windows) if (entry.report) { entry.report.afterCleanup = processState(); await save(entry); }
      });
    },
    window(view, expected) {
      const entry = { view, expected, phase: "target.start", events: [], dropped: 0, pageFacts: [], droppedFacts: 0, installationErrors: [] };
      const record = (event, detail = {}) => {
        entry.events.push({ at: Date.now(), event, ...detail });
        if (entry.events.length > 200) { entry.events.splice(30, 1); entry.dropped++; }
      };
      entry.listen = ({ sessionId, method, params = {} }) => {
        if (sessionId !== view.sessionId) return;
        if (method === "Runtime.consoleAPICalled" && params.args?.[0]?.value === "__belfryProductionReadiness") {
          try {
            const source = params.args[1]?.value;
            if (typeof source !== "string" || source.length > 6000) throw new Error("Invalid readiness fact");
            entry.pageFacts.push({ receivedAt: Date.now(), contextId: params.executionContextId, ...JSON.parse(source) });
            if (entry.pageFacts.length > 160) { entry.pageFacts.splice(40, 1); entry.droppedFacts++; }
          } catch (error) { record("fact.error", { message: error.message }); }
          return;
        }
        if (/^(Page\.(frameNavigated|navigatedWithinDocument|frameStartedLoading|frameStoppedLoading|domContentEventFired|loadEventFired)|Runtime\.(executionContextCreated|executionContextDestroyed|executionContextsCleared|exceptionThrown|consoleAPICalled))$/.test(method)) {
          record(method, { detail: JSON.stringify(params).slice(0, 3000) });
        } else if (method === "Network.requestWillBeSent") record(method, { requestId: params.requestId, loaderId: params.loaderId, type: params.type, url: params.request?.url?.slice(0, 1000) });
        else if (method === "Network.responseReceived") record(method, { requestId: params.requestId, type: params.type, status: params.response?.status, url: params.response?.url?.slice(0, 1000) });
        else if (method === "Network.loadingFailed") record(method, { requestId: params.requestId, type: params.type, error: params.errorText });
      };
      browser.on("protocol", entry.listen); windows.push(entry); record("target.start");
      return {
        source: `(${observeProductionReadiness.toString()})(${JSON.stringify(expected)}, ${observeTerminalMount.toString()})`,
        async install(stage, operation) {
          record("diagnostics.install.start", { stage });
          try {
            await operation();
            record("diagnostics.install.passed", { stage });
          } catch (error) {
            const failure = { stage, error: errorInfo(error) };
            entry.installationErrors.push(failure);
            record("diagnostics.install.failed", failure);
          }
        },
        stage(phase) { entry.phase = phase; record(phase); },
        failed(error) { entry.failure ??= error; record("failed", { phase: entry.phase, error: errorInfo(error) }); },
      };
    },
  };
}

function observeProductionReadiness(expected, observeMount) {
  const documentId = crypto.randomUUID(), timeline = [], ids = new WeakMap();
  const emit = console.debug.bind(console);
  let nextId = 0, dropped = 0, previous = "", mounting;
  const safe = (value, depth = 0) => {
    if (typeof value === "string") return value.slice(0, 1000);
    if (value == null || typeof value !== "object") return value;
    if (depth >= 4) return "[bounded]";
    if (Array.isArray(value)) return value.slice(0, 20).map(item => safe(item, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 25).map(([key, item]) => [key, safe(item, depth + 1)]));
  };
  const identity = element => {
    if (!ids.has(element)) ids.set(element, ++nextId);
    return { id: ids.get(element), connected: element.isConnected, tag: element.tagName, className: element.className };
  };
  const counts = () => ({ terminals: document.querySelectorAll(".xterm").length, creates: window.__productionQA?.creates ?? null });
  const record = (kind, detail = {}) => {
    const entry = { at: performance.now(), kind, ...counts(), ...detail };
    timeline.push(entry);
    if (timeline.length > 300) { timeline.splice(30, 1); dropped++; }
    // Keep the two predicate values outside the page if a later evaluate stalls
    // or navigation destroys this document. No extra evaluate or polling loop.
    if (kind === "readiness.changed" || kind === "observer.installed" || detail.command === "terminal_create" || kind === "terminal.event") {
      emit("__belfryProductionReadiness", JSON.stringify({ documentId, timeOrigin: performance.timeOrigin,
        at: entry.at, kind, terminals: entry.terminals, creates: entry.creates,
        readyState: document.readyState, command: detail.command, tabId: detail.args?.request?.tabId,
        attachment: detail.args?.attachment, nativeId: detail.value?.id, error: detail.error?.slice(0, 1000),
        eventKind: detail.event?.kind, sessionId: detail.event?.sessionId }));
    }
  };
  const changed = () => {
    const state = { ...counts(), readyState: document.readyState, nodes: [...document.querySelectorAll(".xterm")].map(identity) };
    const key = JSON.stringify(state);
    if (key !== previous) { previous = key; record("readiness.changed", state); }
    if (state.terminals === expected && state.creates === expected) mounting?.ready();
  };
  const native = window.__TAURI_INTERNALS__;
  if (native?.invoke) {
    const invoke = native.invoke;
    native.invoke = (command, args) => {
      record("ipc.call", { command, args: safe(args) });
      try {
        const result = invoke(command, args);
        result.then(value => { record("ipc.return", { command, value: safe(value) }); changed(); },
          error => { record("ipc.error", { command, error: String(error) }); changed(); });
        return result;
      } catch (error) { record("ipc.throw", { command, error: String(error) }); throw error; }
    };
    const transform = native.transformCallback;
    native.transformCallback = (callback, once) => transform((value) => {
      if (value?.message?.kind) record("terminal.event", { event: safe(value.message) });
      return callback(value);
    }, once);
  }
  mounting = observeMount(fact => emit("__belfryProductionReadiness", JSON.stringify({
    documentId, timeOrigin: performance.timeOrigin, ...fact,
  })));
  new MutationObserver(changed).observe(document, { childList: true, subtree: true });
  for (const kind of ["readystatechange", "DOMContentLoaded", "load", "pageshow", "pagehide"]) {
    addEventListener(kind, () => { record(kind, { readyState: document.readyState }); changed(); }, true);
  }
  for (const kind of ["error", "unhandledrejection", "vite:preloadError"]) addEventListener(kind, event => {
    record(kind, { message: String(event.error ?? event.reason ?? event.payload ?? event.message ?? "").slice(0, 2000),
      resource: event.target?.src ?? event.target?.href ?? null });
  }, true);
  window.__productionReadiness = { snapshot: () => {
    const qa = window.__productionQA, actual = counts(), root = document.getElementById("root");
    return { documentId, timeOrigin: performance.timeOrigin, at: performance.now(), href: location.href, readyState: document.readyState,
      expected, counts: actual, ready: actual.terminals === expected && actual.creates === expected,
      token: qa?.token, terminals: [...document.querySelectorAll(".xterm")].map(identity),
      inputs: [...document.querySelectorAll(".xterm-helper-textarea")].map(identity),
      calls: qa?.calls.slice(0, 100).map(call => safe(call)), omittedCalls: Math.max(0, (qa?.calls.length ?? 0) - 100),
      errors: qa?.errors.slice(0, 30), preloadErrors: qa?.preloadErrors.slice(0, 30),
      resources: performance.getEntriesByType("resource").slice(0, 80).map(item => ({ name: item.name, startTime: item.startTime, duration: item.duration, type: item.initiatorType, responseStatus: item.responseStatus })),
      dom: root?.outerHTML.slice(0, 60000), domTruncated: (root?.outerHTML.length ?? 0) > 60000,
      timeline, dropped, mounting: mounting.snapshot() };
  } };
  record("observer.installed"); changed();
}

// This source runs only in opted-in, isolated production pages. It records
// synchronous boundaries without changing scheduling, rendering or IPC values.
function observeTerminalMount(publish) {
  const phases = [], contexts = [], longTasks = [], setupErrors = [], stack = [];
  const hosts = new WeakMap(), canvases = new WeakMap(), tabs = new Map();
  const dropped = { phases: 0, contexts: 0, longTasks: 0 };
  let nextHost = 0, nextCanvas = 0, readyAt = null, observer;
  const attempt = (stage, run) => {
    try { return run(); }
    catch (error) { if (setupErrors.length < 10) setupErrors.push({ stage, message: String(error).slice(0, 400) }); }
  };
  const append = (name, list, entry, limit) => {
    list.push(entry);
    if (list.length > limit) { list.splice(Math.min(20, limit - 1), 1); dropped[name]++; }
    attempt("publish", () => publish({ kind: `mount.${name}`, ...entry }));
  };
  const trace = ({ host, tabId, stage, phase }) => attempt("phase", () => {
    if (readyAt !== null) return;
    if (!hosts.has(host)) hosts.set(host, ++nextHost);
    const id = hosts.get(host), at = performance.now();
    if (tabId != null) tabs.set(id, tabId);
    const entry = { at, host: id, tabId: tabs.get(id), stage, phase };
    if (phase === "start") stack.push(entry);
    else {
      const index = stack.findLastIndex(item => item.host === id && item.stage === stage);
      if (index >= 0) { entry.duration = at - stack[index].at; stack.splice(index, 1); }
    }
    append("phases", phases, entry, 120);
  });
  const key = "__belfryTerminalMountTrace";
  const originalTrace = attempt("phase.descriptor", () => Object.getOwnPropertyDescriptor(window, key));
  attempt("phase.install", () => Object.defineProperty(window, key, { value: trace, configurable: true, writable: true }));

  const prototype = HTMLCanvasElement.prototype;
  const descriptor = attempt("context.descriptor", () => Object.getOwnPropertyDescriptor(prototype, "getContext")), original = descriptor?.value;
  function getContext(...args) {
    if (readyAt !== null) return Reflect.apply(original, this, args);
    const entry = attempt("context.start", () => {
      if (!canvases.has(this)) canvases.set(this, ++nextCanvas);
      const scope = stack.at(-1);
      const entry = { at: performance.now(), canvas: canvases.get(this), context: typeof args[0] === "string" ? args[0] : typeof args[0],
        host: scope?.host, tabId: scope?.tabId, stage: scope?.stage, phase: "start" };
      append("contexts", contexts, entry, 80);
      return entry;
    });
    let returned = false, value;
    try { value = Reflect.apply(original, this, args); returned = true; return value; }
    finally {
      if (entry) attempt("context.end", () => append("contexts", contexts, { ...entry,
        at: performance.now(), duration: performance.now() - entry.at, phase: returned ? "return" : "throw",
        ...(returned ? { available: value !== null } : {}) }, 80));
    }
  }
  attempt("context.install", () => {
    if (typeof original !== "function") throw new Error("Canvas getContext unavailable");
    Object.defineProperty(prototype, "getContext", { ...descriptor, value: getContext });
  });
  const collectLongTasks = entries => attempt("longtask.capture", () => {
    for (const entry of entries) {
      if (readyAt !== null && entry.startTime > readyAt) continue;
      append("longTasks", longTasks, { at: entry.startTime, duration: entry.duration, name: entry.name,
        attribution: Array.from(entry.attribution ?? []).slice(0, 3).map(item => ({ name: item.name,
          containerType: item.containerType, containerName: item.containerName?.slice(0, 100) })) }, 40);
    }
  });
  attempt("longtask.install", () => {
    if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) throw new Error("Long-task entries unavailable");
    observer = new PerformanceObserver(list => collectLongTasks(list.getEntries()));
    observer.observe({ type: "longtask", buffered: true });
  });
  const restore = () => {
    attempt("context.restore", () => { if (prototype.getContext === getContext) Object.defineProperty(prototype, "getContext", descriptor); });
    attempt("phase.restore", () => {
      if (window[key] !== trace) return;
      if (originalTrace) Object.defineProperty(window, key, originalTrace);
      else delete window[key];
    });
  };
  addEventListener("pagehide", () => { restore(); observer?.disconnect(); }, { once: true });
  return {
    ready() { if (readyAt === null) { readyAt = performance.now(); restore(); } },
    snapshot() {
      if (observer) attempt("longtask.drain", () => collectLongTasks(observer.takeRecords()));
      return { readyAt, phases, contexts, longTasks, dropped, setupErrors };
    },
  };
}
