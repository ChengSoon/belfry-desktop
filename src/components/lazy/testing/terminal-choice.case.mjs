import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { browserFixture, waitFor } from "./browserFixture.mjs";

async function fixture(t, withProcess = false) {
  const writes = [];
  const consumer = withProcess ? await processConsumer(t) : null;
  const view = (await browserFixture(t, "src/components/lazy/testing/terminal-choice.html", {
    handle(request, response) {
      if (request.url === "/qa-choice-state" && consumer) {
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(consumer.read())); return true;
      }
      if (request.url !== "/qa-choice-write") return false;
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", async () => {
        try {
          const write = JSON.parse(body); writes.push(write);
          if (consumer) {
            const frame = await consumer.write(write.data);
            response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(frame));
          } else { response.writeHead(204); response.end(); }
        } catch (error) { response.writeHead(500); response.end(String(error)); }
      });
      return true;
    },
  })).view;
  await waitFor(view, "!!window.qaChoice");
  return { view, writes };
}

async function processConsumer(t) {
  const child = fork(new URL("./terminal-choice-process.mjs", import.meta.url), [], { silent: true });
  t.after(() => child.kill());
  let latest, stderr = "";
  const waiting = new Set();
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.resume();
  child.on("message", frame => {
    latest = frame;
    for (const waiter of waiting) waiter.resolve(frame);
  });
  child.on("exit", code => { for (const waiter of waiting) waiter.reject(new Error(`Fixture exited ${code}: ${stderr}`)); });
  const next = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(waiter); reject(new Error(`Fixture output timeout: ${stderr}`)); }, 5000);
    const waiter = { resolve: frame => { clearTimeout(timer); waiting.delete(waiter); resolve(frame); },
      reject: error => { clearTimeout(timer); waiting.delete(waiter); reject(error); } };
    waiting.add(waiter);
  });
  await next();
  return { read: () => latest, async write(data) {
    const rendered = next();
    child.stdin.write(data);
    return rendered;
  } };
}

test("terminal requests: native xterm paste encodes text, waits, and submits the same request", async t => {
  const { view, writes } = await fixture(t);
  await view.cdp.evaluate("qaChoice.show('codex-input-freeform')");
  await waitFor(view, "qaChoice.snapshot().activity === 'awaiting-choice'");
  const before = await view.cdp.evaluate("qaChoice.read()");
  const result = await view.cdp.evaluate(`qaChoice.answer(${JSON.stringify(before.requestId)}, {kind:'input',text:'first line\\n第二行'})`);
  assert.deepEqual(result, { status: "sent" });
  assert.deepEqual(writes, [
    { sessionId: "fixture-pty", data: "\x1b[200~first line\r第二行\x1b[201~" },
    { sessionId: "fixture-pty", data: "\r" },
  ]);
  const after = await view.cdp.evaluate("qaChoice.snapshot()");
  assert.equal(after.request.requestId, before.requestId);
  assert.equal(after.request.state, "submitted");
  assert.deepEqual(after.errors, []);
});

for (const outcome of ["changed", "user", "disconnected"]) {
  test(`terminal requests: native paste does not submit after ${outcome}`, async t => {
    const { view, writes } = await fixture(t);
    await view.cdp.evaluate(`qaChoice.show('codex-input-freeform', ${JSON.stringify(outcome)})`);
    const result = await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'input',text:'pending answer'})");
    assert.deepEqual(result, { status: "uncertain" });
    assert.deepEqual(writes.map(write => write.data), ["\x1b[200~pending answer\x1b[201~"]);
  });
}

test("terminal requests: actual activity sees async questions and single answers are not replayed", async t => {
  const { view, writes } = await fixture(t);
  await view.cdp.evaluate("qaChoice.show('codex-async-wrapped')");
  await waitFor(view, "qaChoice.snapshot().activity === 'awaiting-choice'");
  const result = await view.cdp.evaluate("(async () => { const id = qaChoice.read().requestId; const first = qaChoice.answer(id, {kind:'single',index:1}); const duplicate = await qaChoice.answer(id, {kind:'single',index:1}); return [await first, duplicate]; })()");
  assert.deepEqual(result, [{ status: "sent" }, { status: "busy" }]);
  assert.deepEqual(writes, [{ sessionId: "fixture-pty", data: "\r" }]);
});

test("terminal requests: an isolated input consumer receives the chosen answer and advances each request", async t => {
  const { view, writes } = await fixture(t, true);
  const first = await view.cdp.evaluate("qaChoice.connectProcess()");
  assert.equal(first.kind, "confirmation");
  assert.deepEqual(await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'single',index:2})"), { status: "sent" });
  assert.equal((await view.cdp.evaluate("qaChoice.read()")).kind, "multiple");
  assert.deepEqual(await view.cdp.evaluate(`qaChoice.answer(${JSON.stringify(first.requestId)}, {kind:'single',index:1})`), { status: "changed" });
  assert.deepEqual(await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'multiple',indices:[1,2]})"), { status: "sent" });
  assert.equal((await view.cdp.evaluate("qaChoice.read()")).kind, "input");
  assert.deepEqual(await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'input',text:'first step\\n下一步'})"), { status: "sent" });
  const state = await view.cdp.evaluate("qaChoice.remoteState()");
  assert.deepEqual(state.answers, [
    { kind: "confirmation", index: 2 }, { kind: "multiple", indices: [1, 2] }, { kind: "input", text: "first step\n下一步" },
  ]);
  assert.equal(await view.cdp.evaluate("qaChoice.read()"), null);
  assert.equal(writes.length, 6);
  assert.ok(writes.every(write => write.sessionId === "fixture-pty"));
});
