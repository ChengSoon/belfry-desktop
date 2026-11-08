import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { productionFixture, click, waitFor } from "./productionFixture.mjs";
import { englishPanel, switchLanguage } from "./i18n-browser-support.mjs";
import { resize } from "./production-uiFixture.mjs";

const config = JSON.parse(await readFile(new URL("../../../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const policy = config.app.security.csp;
const source = `(() => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.qaLogs = []; window.qaCopied = ''; window.qaRestarted = 0; window.qaLogFails = false;
  window.qaCspViolations = [];
  window.addEventListener('securitypolicyviolation', event => window.qaCspViolations.push({ directive: event.effectiveDirective, uri: event.blockedURI }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.qaCopied = text; } } });
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'app_log_write') { window.qaLogs.push(args.entry); if (window.qaLogFails) throw Error('logging unavailable'); return; }
    if (command === 'diagnostics_export') return { path: '/qa/diagnostics.json', sizeBytes: 20, createdAt: 1, summary: 'SANITIZED DIAGNOSTICS' };
    if (command === 'plugin:process|restart') { window.qaRestarted++; return; }
    if (command === 'collab_tasks' && window.qaCrash) return { tasks: null };
    return invoke(command, args);
  };
})();`;
async function fixture(t, extra = {}) {
  return productionFixture(t, { ...extra, nativeSource: source + (extra.nativeSource ?? ""),
    handle(request, response) { if (policy) response.setHeader("Content-Security-Policy", policy); return false; },
  });
}

test("production root captures runtime errors and unhandled rejections without recursive logging", async (t) => {
  const { view } = await fixture(t);
  await view.cdp.evaluate("setTimeout(() => { throw new Error('runtime QA failure'); }, 0); void Promise.reject(new Error('rejection QA failure'))");
  await view.cdp.evaluate("new Promise(resolve => setTimeout(resolve, 150))");
  const logs = await view.cdp.evaluate("window.qaLogs");
  assert.ok(logs.some(entry => entry.message.includes("runtime QA failure")));
  assert.ok(logs.some(entry => entry.message.includes("rejection QA failure")));
  await view.cdp.evaluate("window.qaLogFails = true; setTimeout(() => { throw new Error('failed logger QA'); }, 0)");
  await view.cdp.evaluate("new Promise(resolve => setTimeout(resolve, 150))");
  assert.equal(await view.cdp.evaluate("window.qaLogs.length"), logs.length + 1);
});

test("a production App render failure shows diagnostics and restart controls", async (t) => {
  const { view } = await fixture(t, { nativeSource: "localStorage.setItem('belfry.locale.v1', 'en');" });
  await resize(view,720,480);
  await view.cdp.evaluate("window.qaCrash = true");
  await waitFor(view, "!!document.querySelector('.app-crash')");
  await englishPanel(view, ".app-crash");
  assert.ok(await view.cdp.evaluate("window.qaLogs.some(entry => entry.source === 'react.boundary' && entry.stack)"));
  await click(view, ".app-crash__copy");
  await waitFor(view, "window.qaCopied === 'SANITIZED DIAGNOSTICS'");
  await switchLanguage(view, "zh-CN");
  assert.match(await view.cdp.evaluate("document.querySelector('.app-crash [role=status]').textContent"), /诊断已复制/);
  await switchLanguage(view, "en");
  await englishPanel(view, ".app-crash");
  await click(view, ".app-crash__restart");
  await waitFor(view, "window.qaRestarted === 1");
});

test("the production CSP blocks injected scripts while terminal, WebGL and local plugin views work", async (t) => {
  const panel = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><title>Local surface</title><p>${request.url}</p><script>parent.postMessage('local-surface-ready','*')</script>`);
  });
  await new Promise(resolve => panel.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { panel.close(resolve); panel.closeAllConnections(); }));
  const local = `http://127.0.0.1:${panel.address().port}`;
  const pluginSource = `(() => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.qaFrames = 0; window.addEventListener('message', event => { if (event.origin === ${JSON.stringify(local)} && event.data === 'local-surface-ready') window.qaFrames++; });
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'plugins_runtime' && args.method === 'catalog') return { available: true, errors: {}, commands: [], tools: [], skills: [], themes: [], services: [], shortcuts: [],
        views: [{ pluginId: 'qa.local', id: 'panel', title: 'Local plugin panel' }, { pluginId: 'qa.local', id: 'preview', title: 'Local web preview' }], plugins: [{ id: 'qa.local', pid: 1 }] };
      if (command === 'plugins_runtime' && args.method === 'surface') return { url: ${JSON.stringify(local)} + '/' + args.params.viewId, title: args.params.viewId };
      return invoke(command, args);
    };
  })()`;
  const { view } = await fixture(t, { nativeSource: pluginSource });
  await click(view, ".xterm-screen");
  await waitFor(view, "document.activeElement === document.querySelector('.xterm-helper-textarea')");
  await view.send("Input.insertText", { text: "terminal-still-accepts-input" });
  await waitFor(view, "__productionQA.writes.some(call => new TextDecoder().decode(new Uint8Array(call.bytes)).includes('terminal-still-accepts-input'))");
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.xterm-screen canvas')].some(canvas => canvas.width > 0 && !!canvas.getContext('webgl2'))"), "xterm keeps its WebGL renderer");
  await view.cdp.evaluate("const injected = document.createElement('script'); injected.textContent = 'window.qaInjected = true'; document.body.append(injected)");
  assert.equal(await view.cdp.evaluate("window.qaInjected === true"), false, "inline script injection must be refused by the shipped CSP");
  for (const [index, viewId] of ["panel", "preview"].entries()) {
    await view.cdp.evaluate(`window.dispatchEvent(new CustomEvent('plugin-view-open-local', { detail: { pluginId: 'qa.local', viewId: ${JSON.stringify(viewId)} } }))`);
    await waitFor(view, `window.qaFrames >= ${index + 1}`);
    assert.ok(await view.cdp.evaluate(`!!document.querySelector('iframe[src="${local}/${viewId}"]:not([hidden])')`));
  }
});

test("the production CSP allows a custom blob video background to decode and play", async (t) => {
  const { view } = await fixture(t, { beforeNavigate: async (view) => {
    // Generate a tiny real video locally; exercise the production background IPC/Blob path.
    const bytes = await view.cdp.evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      const context = canvas.getContext('2d'), stream = canvas.captureStream(20);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const finished = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      let frame = 0;
      const draw = setInterval(() => { context.fillStyle = frame++ % 2 ? '#123456' : '#abcdef'; context.fillRect(0, 0, 16, 16); }, 40);
      await new Promise(resolve => setTimeout(resolve, 400));
      clearInterval(draw); recorder.stop(); await finished; stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    })()`);
    assert.ok(bytes.length > 100, "the video fixture contains encoded frames");
    await view.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      localStorage.setItem('belfry.background.v1', JSON.stringify({ fileName: 'qa.webm', mime: 'video/webm', fit: 'cover', opacity: 1, blur: 0, veil: { dark: .55, light: .8 }, videoPaused: false }));
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args) => command === 'background_read' ? Promise.resolve(new Uint8Array(${JSON.stringify(bytes)}).buffer) : invoke(command, args);
    })();` });
  } });
  await waitFor(view, "document.querySelector('.app-background__video')?.error || document.querySelector('.app-background__video')?.readyState >= 2");
  const video = await view.cdp.evaluate(`(() => { const video = document.querySelector('.app-background__video');
    return { url: video.src, error: video.error?.message ?? null, width: video.videoWidth, violations: window.qaCspViolations }; })()`);
  assert.match(video.url, /^blob:/);
  assert.equal(video.error, null, JSON.stringify(video));
  assert.equal(video.width, 16);
  await waitFor(view, "!document.querySelector('.app-background__video').paused && document.querySelector('.app-background__video').currentTime > .03");
});

test("the production CSP allows HTTPS images in the plugin marketplace README", async (t) => {
  const imageUrl = "https://csp-readme.example.test/qa.png", imageRequests = [], interceptionErrors = [];
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGNk+M/wn4GBgYGJgYGBAQAZlwMDqTHl3QAAAABJRU5ErkJggg==";
  const plugin = { id: "qa.readme", name: "README image QA", description: "CSP image regression", author: "QA", latestVersion: "1.0.0", updatedAt: "2026-11-08", permissionSummary: [] };
  const nativeSource = `(() => {
    const invoke = window.__TAURI_INTERNALS__.invoke, plugin = ${JSON.stringify(plugin)};
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'plugins_runtime') {
        if (args.method === 'management.get') return { settings: { pluginMarketSource: 'personal', pluginMarketCustomUrl: '' }, plugins: {} };
        if (args.method === 'market.personal.info') return { directory: '/qa/market', name: 'QA', pluginCount: 1, versionCount: 1 };
        if (args.method === 'market.search') return { plugins: [plugin], sourceUrl: 'belfry-market:personal' };
        if (args.method === 'market.detail') return { ...plugin, versions: [], permissions: [], readmeMarkdown: ${JSON.stringify(`![QA screenshot](${imageUrl})`)} };
      }
      return invoke(command, args);
    };
  })();`;
  const { view } = await fixture(t, { nativeSource, beforeNavigate: async (view) => {
    const listener = message => {
      if (message.sessionId !== view.sessionId || message.method !== "Fetch.requestPaused") return;
      imageRequests.push(message.params.request);
      void view.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "image/png" }], body: png }).catch(error => interceptionErrors.push(String(error)));
    };
    view.process.on("protocol", listener);
    t.after(() => view.process.off("protocol", listener));
    await view.send("Fetch.enable", { patterns: [{ urlPattern: imageUrl, requestStage: "Request" }] });
  } });
  await click(view, 'button[title^="设置"]');
  await waitFor(view, "!!document.querySelector('.settings-nav')");
  const index = await view.cdp.evaluate("[...document.querySelectorAll('.settings-nav__group button')].findIndex(button => button.textContent === '插件')");
  assert.ok(index >= 0, "the plugin settings entry is available");
  await view.cdp.evaluate(`[...document.querySelectorAll('.settings-nav__group button')][${index}].setAttribute('data-qa-plugins', '')`);
  await click(view, "[data-qa-plugins]");
  await waitFor(view, "!!document.querySelector('#plugins-tab-market')");
  await click(view, "#plugins-tab-market");
  await waitFor(view, "!!document.querySelector('.plugins-card-hit')");
  await click(view, ".plugins-card-hit");
  await waitFor(view, "!!document.querySelector('.plugins-readme img')");
  await view.cdp.evaluate("document.querySelector('.plugins-readme img').scrollIntoView({ block: 'center' })");
  await waitFor(view, "document.querySelector('.plugins-readme img').complete");
  const image = await view.cdp.evaluate(`(() => { const image = document.querySelector('.plugins-readme img');
    return { width: image.naturalWidth, referrerPolicy: image.referrerPolicy, violations: window.qaCspViolations }; })()`);
  assert.equal(image.width, 2, JSON.stringify(image));
  assert.equal(image.referrerPolicy, "no-referrer");
  assert.equal(imageRequests.length, 1);
  assert.ok(!Object.keys(imageRequests[0].headers).some(name => name.toLowerCase() === "referer"));
  assert.deepEqual(interceptionErrors, []);
});
