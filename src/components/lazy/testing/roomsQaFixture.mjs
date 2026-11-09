import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { browserFixture as fixture, waitFor as waitForPage, click, press, capturePanel } from "./browserFixture.mjs";
export { click, press, capturePanel };

const observations = new WeakMap();
const remember = (list, value) => { list.push(value); if (list.length > 600) list.shift(); };

function readFlowState() {
  const inspect = element => {
    if (!element) return null;
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight,
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      transform: style.transform, inlineStyle: element.getAttribute("style") };
  };
  const flow = document.querySelector(".react-flow");
  return { at: performance.now(), main: inspect(document.querySelector(".room-main")),
    attention: inspect(document.querySelector('.room-main > section[aria-label="需要你处理"], .room-main > section[aria-label="Needs your attention"]')), canvas: inspect(flow),
    viewport: inspect(document.querySelector(".react-flow__viewport")),
    members: document.querySelector(".room-sidebar section")?.textContent.slice(0, 4096) ?? null,
    nodes: [...document.querySelectorAll(".react-flow__node")].map(node => ({ id: node.dataset.id,
      text: node.textContent, geometry: inspect(node), handles: [...node.querySelectorAll(".react-flow__handle")].map(handle => ({
        id: handle.dataset.handleid, geometry: inspect(handle) })) })),
    edges: [...document.querySelectorAll(".react-flow__edge")].map(edge => ({ id: edge.dataset.id,
      animated: !!edge.querySelector(".room-flow-edge--animated"), paths: [...edge.querySelectorAll("path")].map(path => ({
        d: path.getAttribute("d"), visibility: getComputedStyle(path).visibility, display: getComputedStyle(path).display })) })) };
}

// Collect before the first navigation so a failed module import is observable even
// when the React fixture never executes. Waiting and assertions remain unchanged.
export async function browserFixture(t, page, options = {}) {
  let observation;
  // The shared fixture registers cleanup afterwards; capture while the page lives.
  t.after(async () => { if (observation && !observation.failed) await observation.capture("final"); });
  return fixture(t, page, { ...options, async beforeNavigate(view, context) {
    observation = await observe(t, page, view, context);
    observations.set(view, observation);
    await options.beforeNavigate?.(view, context);
  } });
}

export async function waitFor(view, expression) {
  try { return await waitForPage(view, expression); }
  catch (error) {
    const observation = observations.get(view);
    if (observation) {
      observation.failed = true;
      await observation.capture("failure", { expression, message: error.message });
    }
    throw error;
  }
}

function optimizerState(server) {
  const metadata = server.environments?.client?.depsOptimizer?.metadata;
  return metadata ? { browserHash: metadata.browserHash,
    optimized: Object.keys(metadata.optimized), discovered: Object.keys(metadata.discovered) } : null;
}

async function observe(t, page, view, { server, requests: serverRequests }) {
  const start = Date.now(), at = () => Date.now() - start;
  const network = new Map(), exceptions = [], lifecycle = [], vite = [], responses = [];
  const initialOptimizer = optimizerState(server);
  const listener = ({ sessionId, method, params = {} }) => {
    if (sessionId !== view.sessionId && params.targetId !== view.targetId) return;
    if (method === "Network.requestWillBeSent") {
      network.set(params.requestId, { url: params.request.url, type: params.type, atMs: at(), state: "pending" });
    }
    const request = network.get(params.requestId);
    if (request && method === "Network.responseReceived") Object.assign(request, {
      status: params.response.status, statusText: params.response.statusText, mimeType: params.response.mimeType,
      responseAtMs: at(), fromDiskCache: params.response.fromDiskCache,
    });
    if (request && method === "Network.loadingFinished") Object.assign(request, { state: "finished", endAtMs: at() });
    if (request && method === "Network.loadingFailed") Object.assign(request, {
      state: "failed", endAtMs: at(), errorText: params.errorText, canceled: params.canceled,
      blockedReason: params.blockedReason, corsErrorStatus: params.corsErrorStatus,
    });
    if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      remember(exceptions, { atMs: at(), text: details.text, description: details.exception?.description,
        url: details.url, lineNumber: details.lineNumber, stackTrace: details.stackTrace });
    }
    if (["Page.frameNavigated", "Page.domContentEventFired", "Page.loadEventFired", "Runtime.executionContextsCleared",
      "Inspector.targetCrashed", "Target.targetCrashed"].includes(method)) {
      remember(lifecycle, { atMs: at(), method, url: params.frame?.url });
    }
  };
  view.process.on("protocol", listener);
  const onRequest = (request, response) => {
    const entry = { url: request.url, atMs: at() };
    response.once("finish", () => remember(responses, { ...entry, endAtMs: at(), status: response.statusCode }));
  };
  server.httpServer.on("request", onRequest);
  const logger = server.config.logger, originals = {};
  for (const level of ["info", "warn", "error"]) {
    originals[level] = logger[level];
    logger[level] = function(message, ...args) {
      remember(vite, { atMs: at(), level, message: String(message).slice(0, 4096) });
      return originals[level].call(this, message, ...args);
    };
  }
  t.after(() => {
    view.process.off("protocol", listener);
    server.httpServer.off("request", onRequest);
    for (const level of Object.keys(originals)) logger[level] = originals[level];
  });
  const [browser] = await Promise.all([
    view.process.send("Browser.getVersion"), view.send("Network.enable"),
    view.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__roomsQaPageErrors = [];
      addEventListener('error', event => window.__roomsQaPageErrors.push({ type: 'error', message: event.message,
        filename: event.filename, resource: event.target?.src || event.target?.href, stack: event.error?.stack }), true);
      addEventListener('unhandledrejection', event => window.__roomsQaPageErrors.push({ type: 'unhandledrejection',
        message: String(event.reason), stack: event.reason?.stack }));
    ` }),
  ]);

  return { failed: false, async capture(reason, failure = null) {
    try {
      const capturedAtMs = at();
      const [stateResult, treeResult, screenshotResult] = await Promise.allSettled([
        view.cdp.evaluate(`({ url: location.href, title: document.title, readyState: document.readyState,
          locale: localStorage.getItem('belfry.locale.v1'), language: document.documentElement.lang,
          navigatorLanguage: navigator.language, theme: document.documentElement.dataset.theme,
          viewport: { width: innerWidth, height: innerHeight }, rootChildren: document.getElementById('root')?.childElementCount,
          html: document.getElementById('root')?.outerHTML.slice(0, 24576), htmlTruncated: (document.getElementById('root')?.outerHTML.length ?? 0) > 24576,
          flow: (${readFlowState.toString()})(),
          marks: performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('rooms-qa:')).map(({name,startTime}) => ({name,startTime})),
          pageErrors: window.__roomsQaPageErrors, calls: window.qaCalls?.slice(-20) })`),
        view.cdp.snapshot(),
        view.send("Page.captureScreenshot", { format: "png" }),
      ]);
      const value = result => result.status === "fulfilled" ? result.value : { captureError: String(result.reason) };
      const state = value(stateResult), requests = [...network.values()];
      const directory = process.env.BELFRY_PANEL_ARTIFACTS;
      const name = `rooms-qa-${t.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 110)}-${reason}`;
      const artifacts = directory ? { json: join(directory, `${name}.json`), screenshot: join(directory, `${name}.png`) } : null;
      const report = { test: t.name, page, reason, failure, capturedAtMs, head: process.env.GITHUB_SHA ?? null,
        node: process.version, platform: process.platform, browser, browserArguments: view.process.child.spawnargs,
        state, accessibility: value(treeResult), exceptions, console: view.cdp.console({ limit: 100 }).messages,
        lifecycle, network: requests, serverRequests, responses, vite, initialOptimizer, optimizer: optimizerState(server),
        screenshotError: screenshotResult.status === "rejected" ? String(screenshotResult.reason) : null, artifacts };
      if (directory) {
        await mkdir(directory, { recursive: true });
        await writeFile(artifacts.json, `${JSON.stringify(report, null, 2)}\n`);
        if (screenshotResult.status === "fulfilled") await writeFile(artifacts.screenshot, Buffer.from(screenshotResult.value.data, "base64"));
      }
      t.diagnostic(JSON.stringify({ roomQa: { reason, failure, artifacts, url: state.url, locale: state.locale,
        readyState: state.readyState, rootChildren: state.rootChildren, marks: state.marks, pageErrors: state.pageErrors,
        exceptions, failedRequests: requests.filter(request => request.state === "failed" || request.status >= 400),
        pendingRequests: requests.filter(request => request.state === "pending"), vite } }));
    } catch (error) {
      // Diagnostics must not replace the original assertion or startup failure.
      t.diagnostic(`Room QA diagnostic capture failed: ${error.stack ?? error}`);
    }
  } };
}
