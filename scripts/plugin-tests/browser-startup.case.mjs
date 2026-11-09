import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BrowserProcess } from "../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../src-tauri/src/plugins/node/browser-target.mjs";
import { cleanupScope, temporary, waitFor } from "./support.mjs";

const CONSUMER = fileURLToPath(new URL("./fixtures/browser-protocol-consumer.mjs", import.meta.url));
const SECRET = "T41_CONTENT_MUST_NOT_APPEAR";
async function fixture(t, mode) {
  const lifetime = cleanupScope(t), root = await temporary(lifetime), received = [];
  // Replace only executable selection/spawn. Framing, real OS pipes, listeners,
  // the production 20s deadline and cleanup all use BrowserProcess unchanged.
  const browser = new BrowserProcess(join(root, "engine"), mode ? {
    executable: async () => process.execPath,
    spawnChild: (_executable, _args, options) => {
      const child = spawn(process.execPath, [CONSUMER, mode], { ...options, stdio: [...options.stdio, "ipc"] });
      child.on("message", (message) => received.push(message.method)); return child;
    },
  } : {});
  browser.diagnostics.directory = join(root, "diagnostics");
  lifetime.after(() => browser.close());
  await browser.start();
  const target = new BrowserTarget(browser, { workspace: root, frame() {}, state() {} });
  lifetime.after(() => target.close());
  return { browser, target, root, received };
}
function events(browser, event) { return browser.diagnostics.snapshot(browser.diagnosticState()).events.filter((entry) => entry.event === event); }
async function reclaimed(browser) {
  await browser.close();
  assert.equal(browser.pending.size, 0);
  assert.equal(browser.buffer.length, 0);
  assert.equal(browser.childClosed, true);
  assert.equal(browser.child.stdio.filter(Boolean).every((pipe) => pipe.destroyed), true);
  assert.equal(browser.child.connected, false);
  assert.equal(browser.profileState, "removed");
  await assert.rejects(access(browser.profile), { code: "ENOENT" });
  assert.equal(browser.listenerCount("protocol"), 0);
}
async function evidence(name, browser, extra = {}) {
  const snapshot = browser.diagnostics.snapshot(browser.diagnosticState());
  tSummary(name, snapshot, extra);
  if (process.env.BELFRY_PANEL_ARTIFACTS) {
    const directory = join(process.env.BELFRY_PANEL_ARTIFACTS, "controlled-browser-startup");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}-${process.pid}.json`), JSON.stringify({ scenario: name, ...extra, ...snapshot }, null, 2) + "\n");
  }
}
function tSummary(name, snapshot, extra) {
  console.log(JSON.stringify({ browserStartup: name, elapsedMs: snapshot.elapsedMs, firstFailure: snapshot.firstFailure?.phase,
    childClosed: snapshot.state.childClosed, pending: snapshot.state.pending.length, profile: snapshot.state.profile, ...extra }));
}

test("real browser initializes domains, evaluates a page and reclaims its pipes/profile", async (t) => {
  const { browser, target, root } = await fixture(t);
  await target.start();
  const sent = events(browser, "request.send").map((entry) => entry.method);
  for (const domain of ["Runtime", "Page", "DOM", "Accessibility", "Console"]) assert.ok(sent.includes(`${domain}.enable`));
  assert.ok(events(browser, "response.ok").some((entry) => entry.method === "Runtime.enable"));
  await writeFile(join(root, "ready.html"), "<!doctype html><title>Isolated startup</title><p>ready</p>");
  await target.navigate({ path: "ready.html" });
  assert.equal(await target.cdp.evaluate("document.querySelector('p').textContent"), "ready");
  await target.close(); await reclaimed(browser);
  assert.equal(browser.diagnostics.firstFailure, undefined);
  await evidence("real", browser);
});

test("fragmented CDP responses still initialize exactly once", async (t) => {
  const { browser, target, received } = await fixture(t, "fragmented");
  await target.start(); await target.close(); await reclaimed(browser);
  assert.equal(received.filter((method) => method === "Runtime.enable").length, 1);
  assert.equal(browser.diagnostics.firstFailure, undefined);
  await evidence("fragmented", browser);
});

test("spawn failure preserves the original OS error and removes the unused profile", async (t) => {
  const lifetime = cleanupScope(t), root = await temporary(lifetime);
  const browser = new BrowserProcess(join(root, "engine"), { executable: async () => join(root, "missing-browser") });
  browser.diagnostics.directory = join(root, "diagnostics"); lifetime.after(() => browser.close());
  let failure;
  try { await browser.start(); } catch (error) { failure = error; }
  assert.equal(failure?.code, "ENOENT");
  assert.equal(failure.browserDiagnostics.firstFailure.code, "ENOENT");
  await reclaimed(browser);
  assert.ok(events(browser, "process.error").some((entry) => entry.code === "ENOENT"));
  await evidence("spawn-enoent", browser);
});

test("read EOF rejects initialization promptly and disposal cannot add another request deadline", { timeout: 10_000 }, async (t) => {
  const { browser, target, received } = await fixture(t, "disconnect");
  const started = performance.now();
  await assert.rejects(target.start(), { code: "BROWSER_CLOSED" });
  await reclaimed(browser);
  assert.ok(performance.now() - started < 5000);
  assert.equal(events(browser, "request.timeout").length, 0);
  assert.equal(received.includes("Target.disposeBrowserContext"), false);
  assert.equal(browser.diagnostics.firstFailure.phase, "read.end");
  assert.ok(browser.diagnostics.firstFailure.state.pending.some((entry) => entry.method === "Runtime.enable"));
  await evidence("read-eof", browser);
});

test("abnormal process exit records its actual code and reclaims pending initialization", { timeout: 10_000 }, async (t) => {
  const { browser, target } = await fixture(t, "exit");
  await assert.rejects(target.start(), { code: "BROWSER_CLOSED" });
  await reclaimed(browser);
  assert.equal(browser.child.exitCode, 23);
  assert.ok(events(browser, "process.exit").some((entry) => entry.code === 23));
  assert.equal(events(browser, "request.timeout").length, 0);
  await evidence("exit-23", browser);
});

test("explicit close cancels every in-flight request and reclaims an unresponsive child", { timeout: 10_000 }, async (t) => {
  const { browser, received } = await fixture(t, "hold");
  const first = browser.send("Runtime.enable", {}, "session-private"), second = browser.send("Page.enable", {}, "session-private");
  const outcomes = Promise.allSettled([first, second]);
  assert.equal(await waitFor(() => received.includes("Runtime.enable") && received.includes("Page.enable")), true);
  const closed = browser.close(); assert.equal(browser.close(), closed);
  await closed;
  for (const result of await outcomes) { assert.equal(result.status, "rejected"); assert.equal(result.reason.code, "BROWSER_CLOSED"); }
  await reclaimed(browser);
  assert.equal(events(browser, "request.timeout").length, 0);
  if (process.platform !== "win32") assert.ok(events(browser, "process.signal").some((entry) => entry.signal === "SIGKILL"));
  await evidence("close-cancel", browser);
});

test("a live consumer with no Runtime reply still fails at the unchanged 20s deadline", { timeout: 30_000 }, async (t) => {
  const { browser, target, received } = await fixture(t, "silent");
  let failure;
  try { await target.start(); } catch (error) { failure = error; }
  assert.equal(failure?.code, "TIMEOUT");
  assert.equal(failure?.browserRequest.method, "Runtime.enable");
  assert.equal(browser.ended, false); // A timeout alone is not misreported as EOF/exit.
  const timeouts = events(browser, "request.timeout");
  assert.equal(timeouts.length, 1);
  assert.ok(timeouts[0].elapsedMs >= 19_900);
  assert.equal(browser.diagnostics.requestTimeoutMs, 20_000);
  assert.equal(received.filter((method) => method === "Runtime.enable").length, 1);
  assert.ok(events(browser, "protocol.event").some((entry) => entry.method === "Inspector.detached"));
  await reclaimed(browser);
  assert.equal(failure.browserDiagnostics.firstFailure.code, "TIMEOUT");
  await evidence("deadline", browser, { requestElapsedMs: timeouts[0].elapsedMs });
});

test("cleanup failure cannot replace the first Runtime protocol error", async (t) => {
  const { browser, target } = await fixture(t, "protocol-error");
  const cleanup = Object.assign(new Error("controlled cleanup failure"), { code: "EACCES" });
  target.preview.close = async () => { throw cleanup; };
  let failure;
  try { await target.start(); } catch (error) { failure = error; }
  assert.equal(failure?.code, "BROWSER_ERROR");
  assert.match(failure.message, /controlled Runtime.enable failure/);
  assert.notEqual(failure, cleanup);
  await reclaimed(browser);
  assert.equal(failure.browserDiagnostics.firstFailure.code, "BROWSER_ERROR");
  assert.ok(events(browser, "target.cleanup.error").some((entry) => entry.code === "EACCES"));
  await evidence("cleanup-error", browser);
});

test("failure artifacts bound protocol/stderr records and omit every payload and raw identifier", async (t) => {
  const { browser, target } = await fixture(t, "privacy");
  await browser.send("Runtime.evaluate", { expression: SECRET }, "session-private");
  await assert.rejects(target.start(), { code: "BROWSER_ERROR" });
  await reclaimed(browser);
  const text = await readFile(join(browser.diagnostics.directory, browser.diagnostics.artifact), "utf8"), value = JSON.parse(text);
  for (const forbidden of [SECRET, "session-private", "target-private", "context-private", browser.profile]) assert.equal(text.includes(forbidden), false);
  assert.ok(value.events.length <= 160);
  assert.ok(value.droppedEvents > 0);
  assert.ok(value.stderr.records.length <= 24);
  assert.ok(value.stderr.inspectedBytes <= 16 * 1024);
  assert.ok(value.stderr.omittedBytes > 0);
  assert.ok(value.stderr.records.some((entry) => entry.severity === "ERROR"));
  assert.equal(value.firstFailure.request.method, "Runtime.enable");
  assert.equal(value.state.childClosed, true);
  assert.equal(value.state.profile, "removed");
  assert.equal(value.state.pending.length, 0);
  assert.ok(Buffer.byteLength(text) < 64 * 1024);
  await evidence("bounded-private-artifact", browser, { artifactBytes: Buffer.byteLength(text) });
});

test("artifact write failure retains the browser cause and an in-memory diagnostic", async (t) => {
  const { browser, target, root } = await fixture(t, "protocol-error");
  const file = join(root, "not-a-directory"); await writeFile(file, "controlled"); browser.diagnostics.directory = file;
  let failure;
  try { await target.start(); } catch (error) { failure = error; }
  await reclaimed(browser);
  assert.equal(failure?.code, "BROWSER_ERROR");
  assert.match(failure.message, /controlled Runtime.enable failure/);
  assert.ok(failure.browserDiagnostics.artifactError);
  assert.equal(failure.browserDiagnostics.state.profile, "removed");
  await evidence("artifact-write-error", browser);
});
