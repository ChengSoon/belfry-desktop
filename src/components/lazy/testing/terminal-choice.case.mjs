import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { browserFixture, capturePanel, waitFor } from "./browserFixture.mjs";

async function fixture(t, withProcess = false) {
  const writes = [];
  const consumer = withProcess ? await processConsumer(t, withProcess === "queued" ? "./terminal-queued-process.mjs" : "./terminal-choice-process.mjs") : null;
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

async function processConsumer(t, module) {
  const child = fork(new URL(module, import.meta.url), [], { silent: true });
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

test("terminal requests: Working queue opens without answering and consumes the exact new selection and text", async t => {
  const { view, writes } = await fixture(t, "queued");
  const queued = await view.cdp.evaluate("qaChoice.connectProcess()");
  assert.ok(queued, "The real xterm Working screen must expose its queued question entry");
  await waitFor(view, "qaChoice.snapshot().activity === 'talking'");
  await capturePanel(view, "terminal-queued-collapsed");
  assert.equal(queued.kind, "queued");
  assert.deepEqual(queued.queue, { count: 1 });
  assert.deepEqual(queued.options, []);
  assert.deepEqual(await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'single',index:1})"), { status: "invalid" });
  assert.equal(writes.length, 0);
  const opened = await view.cdp.evaluate("qaChoice.open(qaChoice.read().requestId)");
  const editor = await view.cdp.evaluate("qaChoice.read()");
  assert.deepEqual(opened, { status: "opened", requestId: editor.requestId });
  assert.notEqual(editor.requestId, queued.requestId);
  assert.equal(editor.state, "pending");
  const afterOpen = await view.cdp.evaluate("qaChoice.remoteState()");
  await capturePanel(view, "terminal-queued-expanded");
  assert.deepEqual(afterOpen.opens, ["sample-color-1"]);
  assert.deepEqual(afterOpen.answers, []);
  assert.deepEqual(writes.map(write => write.data), ["\x1b[1;2D"]);
  assert.deepEqual(await view.cdp.evaluate(`qaChoice.open(${JSON.stringify(queued.requestId)})`), { status: "changed" });
  assert.deepEqual(await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'single',index:2})"), { status: "sent" });
  const next = await view.cdp.evaluate("qaChoice.read()");
  assert.equal(next.kind, "queued");
  assert.equal(next.queue.count, 1);
  assert.notEqual(next.requestId, queued.requestId);
  const afterChoice = await view.cdp.evaluate("qaChoice.remoteState()");
  assert.deepEqual(afterChoice.answers, [{ questionId: "sample-color-1", question: "Which sample color should the isolated preview use?", text: "Green sample" }]);
  assert.equal((await view.cdp.evaluate("qaChoice.open(qaChoice.read().requestId)")).status, "opened");
  assert.equal((await view.cdp.evaluate("qaChoice.read()")).kind, "input");
  assert.deepEqual(await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'input',text:'Sample note\\n第二行'})"), { status: "sent" });
  const afterText = await view.cdp.evaluate("qaChoice.remoteState()");
  assert.deepEqual(afterText.answers, [...afterChoice.answers,
    { questionId: "sample-note-2", question: "Which sample note should the isolated preview show?", text: "Sample note\n第二行" }]);
  assert.deepEqual(afterText.opens, ["sample-color-1", "sample-note-2"]);
  assert.deepEqual(writes.map(write => write.data), ["\x1b[1;2D", "\x1b[B", "\r", "\x1b[1;2D", "\x1b[200~Sample note\r第二行\x1b[201~", "\r"]);
  assert.equal((await view.cdp.evaluate("qaChoice.open(qaChoice.read().requestId)")).status, "opened");
  const otherOption = (await view.cdp.evaluate("qaChoice.read()")).options.at(-1);
  assert.deepEqual(otherOption, { index: 3, label: "Other", action: "input" });
  assert.equal((await view.cdp.evaluate("qaChoice.open(qaChoice.read().requestId, 3)")).status, "opened");
  assert.equal((await view.cdp.evaluate("qaChoice.read()")).kind, "input");
  assert.equal((await view.cdp.evaluate("qaChoice.remoteState()")).answers.length, 2);
  assert.deepEqual(await view.cdp.evaluate("qaChoice.answer(qaChoice.read().requestId, {kind:'input',text:'Purple sample'})"), { status: "sent" });
  const afterOther = await view.cdp.evaluate("qaChoice.remoteState()");
  assert.deepEqual(afterOther.answers, [...afterText.answers,
    { questionId: "sample-color-3", question: "Which sample color should the isolated preview use?", text: "Purple sample" }]);
  assert.equal(await view.cdp.evaluate("qaChoice.read()"), null);
  assert.deepEqual(writes.slice(6).map(write => write.data), ["\x1b[1;2D", "\x1b[B\x1b[B", "\x1b[200~Purple sample\x1b[201~", "\r"]);
  assert.ok(writes.every(write => write.sessionId === "fixture-pty"));
  await capturePanel(view, "terminal-queued-consumed");
  const evidence = { evidence: "real xterm + independent stdin consumer", queued, afterOpen, afterChoice, afterText, afterOther, writes };
  if (process.env.BELFRY_PANEL_ARTIFACTS) {
    await mkdir(process.env.BELFRY_PANEL_ARTIFACTS, { recursive: true });
    await writeFile(join(process.env.BELFRY_PANEL_ARTIFACTS, "terminal-queued-consumption.json"), JSON.stringify(evidence, null, 2));
  }
  t.diagnostic(JSON.stringify({ consumedQuestionIds: afterOther.answers.map(answer => answer.questionId), opens: afterOther.opens, writes: writes.length }));
});
