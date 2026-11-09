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
          failure: entry.report.failure, counts: entry.report.state?.counts, captureErrors: entry.report.captureErrors } }));
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
      const entry = { view, expected, phase: "target.start", events: [], dropped: 0, pageFacts: [], droppedFacts: 0 };
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
            if (entry.pageFacts.length > 80) { entry.pageFacts.splice(30, 1); entry.droppedFacts++; }
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
        source: `(${observeProductionReadiness.toString()})(${JSON.stringify(expected)})`,
        stage(phase) { entry.phase = phase; record(phase); },
        failed(error) { entry.failure ??= error; record("failed", { phase: entry.phase, error: errorInfo(error) }); },
      };
    },
  };
}

function observeProductionReadiness(expected) {
  const documentId = crypto.randomUUID(), timeline = [], ids = new WeakMap();
  const emit = console.debug.bind(console);
  let nextId = 0, dropped = 0, previous = "";
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
      timeline, dropped };
  } };
  record("observer.installed"); changed();
}
