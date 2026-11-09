import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserProcess } from "../../src-tauri/src/plugins/node/browser-process.mjs";
import { browserAvailable } from "./panel-support.mjs";
import { MarketUiDiagnostics } from "./market-ui-diagnostics.mjs";
import { marketUiFixture, waitFor } from "./market-ui-support.mjs";

const PAGE = "/scripts/plugin-tests/fixtures/dropdown-page.html";
const CONTROL = '!!document.querySelector("button[aria-label=\\"设置类型\\"]")';

test("page wait retains its first error when the later accessibility snapshot also fails", async () => {
  const primary = Object.assign(new Error("original evaluate failure"), { code: "TIMEOUT", browserRequest: { id: 19 } });
  const secondary = new Error("later snapshot failure");
  let attempts = 0;
  const view = { cdp: { evaluate: async () => { attempts++; throw primary; }, snapshot: () => { throw secondary; } } };
  await assert.rejects(waitFor(view, "false"), (error) => {
    assert.equal(error.cause, primary); assert.equal(error.code, "TIMEOUT");
    assert.equal(error.browserRequest, primary.browserRequest); assert.equal(error.snapshotError, secondary);
    assert.match(error.message, /^original evaluate failure/); return true;
  });
  assert.equal(attempts, 1, "diagnostics must not retry the condition");
});

test("fixture capture and artifact channels fail independently without replacing the first error", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "belfry-readiness-")), writes = [];
  const diagnostic = new MarketUiDiagnostics(t, { directory, write: async (path, value) => {
    writes.push(path);
    if (path.endsWith(".browser.json")) throw Object.assign(new Error("controlled browser artifact failure"), { code: "EACCES" });
    await writeFile(path, value);
  } });
  t.after(() => rm(directory, { recursive: true, force: true }));
  diagnostic.engine = new BrowserProcess(join(directory, "unused-browser")); // No child is spawned for I/O fault injection.
  diagnostic.engine.diagnostics.directory = undefined;
  diagnostic.origin = "http://127.0.0.1:1234";
  diagnostic.view = { cdp: { evaluate: () => new Promise(() => {}) },
    send: async () => ({ frameTree: { frame: { id: "controlled-frame", loaderId: "controlled-loader", url: diagnostic.origin + PAGE } } }) };
  const primary = Object.assign(new Error("original timeout"), { code: "TIMEOUT" });
  diagnostic.failure(primary, "wait");
  await diagnostic.capture("page-unresponsive");
  assert.equal(diagnostic.captures[0].page.unavailable, true);
  assert.equal(diagnostic.captures[0].frame.knownPage, true);
  diagnostic.view.cdp.evaluate = async () => ({ scope: "known-market-fixture", root: false });
  diagnostic.view.send = async () => { throw new Error("frame unavailable"); };
  await diagnostic.capture("frame-unresponsive");
  assert.equal(diagnostic.captures[1].page.root, false);
  assert.equal(diagnostic.captures[1].frame.unavailable, true);
  diagnostic.failure(new Error("secondary capture failure"), "capture");
  for (let index = 0; index < 300; index++) diagnostic.record("lifecycle", "controlled-event", { index });
  await diagnostic.persist();
  assert.equal(writes.length, 2); // A failed browser write must not suppress the fixture JSON.
  const saved = JSON.parse(await readFile(join(directory, diagnostic.artifact), "utf8"));
  assert.equal(saved.firstFailure.message, primary.message);
  assert.equal(saved.writeErrors[0].code, "EACCES");
  assert.equal(saved.captureErrors.length, 2);
  assert.equal(saved.records.lifecycle.length, 128);
  assert.ok(saved.dropped.lifecycle > 0);
  assert.equal(diagnostic.engine.failureError, primary);
  // Optional instrumentation must not make a healthy test fail when setup of
  // the extra diagnostic domains fails. Each failed channel remains visible.
  diagnostic.view.navigate = async () => "original-navigation";
  await diagnostic.attachView(diagnostic.view, diagnostic.origin);
  assert.ok(Object.values(diagnostic.installation).every((channel) => channel.unavailable));
  assert.equal(await diagnostic.view.navigate({}), "original-navigation");
  assert.equal(diagnostic.firstFailure.message, primary.message);
});

async function fixture(t) {
  const configured = process.env.BELFRY_MARKET_UI_ARTIFACTS ?? process.env.BELFRY_PANEL_ARTIFACTS;
  const directory = configured ?? await mkdtemp(join(tmpdir(), "belfry-readiness-"));
  const f = await marketUiFixture(t, undefined, { diagnosticOptions: { directory } });
  t.after(async () => {
    try {
      const saved = JSON.parse(await readFile(join(directory, f.diagnostics.artifact), "utf8"));
      assert.equal(saved.browserId, f.diagnostics.engine.diagnostics.id);
      assert.equal(saved.process.profile, "removed"); assert.deepEqual(saved.process.pending, []);
      assert.equal(saved.process.childClosed, true);
      for (const name of ["target", "browser", "server", "temporary"]) {
        assert.ok(saved.records.phases.some((entry) => entry.event === `cleanup.${name}.end`), name);
      }
      assert.equal(saved.pageWaitMs, 10_000); assert.equal(saved.protocolRequestMs, 20_000);
    } finally { if (!configured) await rm(directory, { recursive: true, force: true }); }
  });
  return f;
}

test("a failed fixture module stays a real missing-control failure and saves resource and DOM evidence", async (t) => {
  if (!await browserAvailable(t)) return;
  const f = await fixture(t);
  const module = "/scripts/plugin-tests/fixtures/dropdown-page.tsx";
  f.routes.set(module, { status: 503, body: { error: "controlled module unavailable" } });
  await f.view.navigate({ url: f.origin + PAGE });
  await assert.rejects(waitFor(f.view, CONTROL), { code: "TOOL_FAILED" });
  const snapshot = f.diagnostics.snapshot(), page = snapshot.captures[0].page;
  assert.equal(page.scope, "known-market-fixture"); assert.equal(page.root, true); assert.equal(page.children, 0);
  assert.equal(page.controls.length, 0); assert.equal(page.readyState, "complete");
  assert.ok(snapshot.records.network.some((entry) => entry.path === module && entry.status === 503));
  assert.ok(snapshot.records.server.some((entry) => entry.path === module && entry.status === 503 && entry.finished));
  // Successful follow-up resources must not evict the cause from the bounded
  // general network history before the missing-control timeout is collected.
  for (let index = 0; index < 300; index++) f.diagnostics.record("network", "controlled-success", { index });
  assert.ok(f.diagnostics.snapshot().records.resourceErrors.some((entry) => entry.path === module && entry.status === 503));
  assert.ok(snapshot.records.pageEvents.some((entry) => entry.value?.root && !entry.value.control));
  const wait = snapshot.records.phases.find((entry) => entry.event === "wait.start");
  assert.ok(snapshot.records.requests.some((entry) => entry.id === wait.nextRequestId && entry.event === "response" && entry.exception));
});

test("navigation during a pending wait records context changes and omits content outside the known fixture", async (t) => {
  if (!await browserAvailable(t)) return;
  const f = await fixture(t); await f.view.navigate({ url: f.origin + PAGE }); await waitFor(f.view, CONTROL);
  const secret = "OUTSIDE_KNOWN_FIXTURE_CONTENT", path = "/outside-known-fixture.html";
  f.routes.set(path, { body: { secret } });
  const navigation = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { f.view.navigate({ url: f.origin + path }).then(resolve, reject); }, 100);
    t.after(() => clearTimeout(timer));
  });
  await assert.rejects(waitFor(f.view, "false"), { code: "BROWSER_ERROR" }); await navigation;
  await f.view.cdp.evaluate(`console.error(${JSON.stringify(secret)})`);
  await f.diagnostics.capture("outside-fixture");
  assert.equal(f.diagnostics.captures.at(-1).page.scope, "outside-known-fixture");
  assert.equal(f.diagnostics.captures.at(-1).frame.knownPage, false);
  const snapshot = f.diagnostics.snapshot();
  assert.ok(snapshot.records.lifecycle.some((entry) => entry.event === "Runtime.executionContextsCleared"));
  assert.ok(snapshot.records.lifecycle.some((entry) => entry.event === "Runtime.executionContextCreated" && entry.context));
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(JSON.stringify(f.diagnostics.engine.diagnostics.snapshot(f.diagnostics.engine.diagnosticState())).includes(secret), false);
});

test("an asynchronous polling exception remains a 20s failure with its exception and request timeline", { timeout: 45_000 }, async (t) => {
  if (!await browserAvailable(t)) return;
  const f = await fixture(t); await f.view.navigate({ url: f.origin + PAGE }); await waitFor(f.view, CONTROL);
  // Synthetic expression: this reproduces a pending Promise, not the cause of
  // the CI's static querySelector. Keep that causal boundary explicit.
  const expression = '(()=>{window.qaChecks=(window.qaChecks??0)+1;if(window.qaChecks===2)throw new Error("controlled later callback");return false;})()';
  let failure;
  try { await waitFor(f.view, expression); } catch (error) { failure = error; }
  assert.equal(failure?.code, "TIMEOUT"); assert.equal(failure.cause.code, "TIMEOUT");
  const snapshot = f.diagnostics.snapshot();
  assert.ok(snapshot.records.exceptions.some((entry) => entry.message.includes("controlled later callback")));
  const requests = snapshot.records.requests.filter((entry) => entry.id === failure.browserRequest.id);
  assert.equal(requests.filter((entry) => entry.event === "send").length, 1);
  assert.equal(requests.find((entry) => entry.event === "send").method, "Runtime.evaluate");
  assert.ok(requests.find((entry) => entry.event === "error").elapsedMs >= 19_900);
  assert.equal(snapshot.firstFailure.request.id, failure.browserRequest.id);
  assert.equal(snapshot.captures[0].page.controls.some((control) => control.label === "设置类型"), true);
});
