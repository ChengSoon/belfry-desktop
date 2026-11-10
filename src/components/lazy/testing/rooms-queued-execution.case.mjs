import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { browserFixture, capturePanel, click, press, waitFor } from "./roomsQaFixture.mjs";
import { enter } from "../../../../scripts/plugin-tests/market-ui-support.mjs";
import { roomChoiceProcess } from "./roomsChoiceProcess.mjs";

const CARD = '.room-choice-card[data-member-id="fe"]';
const OPEN = `${CARD} .room-choice-open`;
const consumerModule = new URL("./terminal-queued-process.mjs", import.meta.url);

async function ready(t, locale, width, height, font) {
  const consumer = await roomChoiceProcess(t, { consumerModule });
  const { view } = await browserFixture(t,
    `src/components/lazy/testing/rooms-qa.html?attention=0&choices=terminal&locale=${locale}`, { handle: consumer.handle });
  await view.bounds({ x: 0, y: 0, width, height });
  await view.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await view.cdp.evaluate(`document.documentElement.style.fontSize = '${font}px'`);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'queued' && Array.isArray(window.qaRoomTabStates)`);
  return { consumer, view };
}

async function tabTo(view, selector) {
  for (let step = 0; step < 45; step++) {
    await press(view, "Tab");
    if (!await view.cdp.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`)) continue;
    const geometry = await view.cdp.evaluate(`(() => {
      const element = document.activeElement, bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      const scroll = element.closest('.room-attention-scroll')?.getBoundingClientRect();
      return { bounds: bounds.toJSON(), scroll: scroll?.toJSON(),
        visible: bounds.width > 0 && bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight && element.contains(hit) };
    })()`);
    assert.ok(geometry.visible, `Tab reaches a visible control: ${selector}: ${JSON.stringify(geometry)}`);
    if (selector.endsWith("textarea")) assert.ok(geometry.bounds.top >= geometry.scroll.top && geometry.bounds.bottom <= geometry.scroll.bottom,
      `the entire answer field is visible: ${JSON.stringify(geometry)}`);
    return geometry;
  }
  assert.fail(`Tab did not reach ${selector}`);
}

async function readback(view) {
  return view.cdp.evaluate(`({ request: qaRoomTerminal.read(), screen: qaRoomTerminal.screen(), tabs: qaRoomTabStates,
    expanded: document.querySelector('.room-attention')?.dataset.expanded, errors: qaRoomTerminal.errors })`);
}

async function save(name, value) {
  const directory = process.env.BELFRY_PANEL_ARTIFACTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

for (const [locale, width, height, font] of [["en", 1440, 900, 14], ["zh-CN", 720, 480, 20], ["en", 720, 480, 20]]) {
  test(`queued RoomView answers reach the isolated consumer (${locale}, ${width}x${height})`, async t => {
    const { consumer, view } = await ready(t, locale, width, height, font);
    const snapshots = [await readback(view)], tag = `${locale}-${width}`;
    assert.deepEqual(snapshots[0].tabs.find(tab => tab.id === "t2"), { id: "t2", phase: "running", activity: "talking" });
    assert.equal(snapshots[0].request.queue.count, 1);
    assert.deepEqual(consumer.writes, []);
    assert.deepEqual(consumer.read().opens, []);
    assert.deepEqual(consumer.read().answers, []);
    await capturePanel(view, `room-queued-live-entry-${tag}`);
    if (height <= 600) { await tabTo(view, ".room-attention-open"); await enter(view); }
    await tabTo(view, OPEN);
    const gate = consumer.holdNextWrite();
    await enter(view);
    assert.deepEqual(await gate.arrived, { sessionId: "room-qa-pty", data: "\x1b[1;2D" });
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'opening'`);
    await enter(view);
    await view.cdp.evaluate(`document.querySelector('${OPEN}').click()`);
    assert.equal(consumer.writes.length, 1, "repeated open controls write only once");
    assert.deepEqual(consumer.read().answers, []);
    gate.release();
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
    snapshots.push(await readback(view));
    assert.notEqual(snapshots[1].request.requestId, snapshots[0].request.requestId);
    assert.equal(snapshots[1].request.state, "pending");
    assert.deepEqual(consumer.read().opens, ["sample-color-1"]);
    assert.deepEqual(consumer.read().answers, [], "opening the real editor is not an answer");
    await tabTo(view, `${CARD} [data-option-index="2"]`);
    await enter(view);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'queued'`);
    assert.deepEqual(consumer.read().answers.map(({ questionId, text }) => ({ questionId, text })), [
      { questionId: "sample-color-1", text: "Green sample" },
    ]);
    snapshots.push(await readback(view));
    await tabTo(view, OPEN);
    await enter(view);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'input'`);
    await tabTo(view, `${CARD} textarea`);
    const note = "Example note\n第二行";
    const beforeDraft = consumer.writes.length;
    await view.send("Input.insertText", { text: note });
    assert.equal(consumer.writes.length, beforeDraft, "local text is not written until explicit submission");
    if (height <= 600) {
      await press(view, "Escape");
      await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'false'");
      assert.equal(await view.cdp.evaluate("qaClosed"), 0);
      await enter(view);
      await tabTo(view, `${CARD} textarea`);
      assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD} textarea').value`), note);
    }
    await tabTo(view, `${CARD} button[type=submit]`);
    await enter(view);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'queued'`);
    assert.deepEqual(consumer.read().answers.map(({ questionId, text }) => ({ questionId, text })), [
      { questionId: "sample-color-1", text: "Green sample" }, { questionId: "sample-note-2", text: note },
    ]);
    snapshots.push(await readback(view));
    assert.equal(snapshots[3].request.queue.count, 1);
    assert.notEqual(snapshots[3].request.requestId, snapshots[0].request.requestId, "a later same-count queue has its own request identity");
    await tabTo(view, OPEN);
    await enter(view);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
    assert.equal(await view.cdp.evaluate("qaRoomTerminal.read().options.find(option => option.index === 3).action"), "input");
    await tabTo(view, `${CARD} [data-option-index="3"]`);
    const otherGate = consumer.holdNextWrite();
    await enter(view);
    const otherWrite = await otherGate.arrived;
    assert.equal(otherWrite.sessionId, "room-qa-pty");
    assert.equal(otherWrite.data.includes("\r"), false, "Other navigation never sends Enter");
    assert.equal(consumer.read().answers.length, 2);
    const openingWrites = consumer.writes.length;
    await enter(view);
    assert.equal(consumer.writes.length, openingWrites);
    otherGate.release();
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'input'`);
    snapshots.push(await readback(view));
    assert.equal(snapshots[4].request.state, "pending");
    assert.equal(consumer.read().answers.length, 2, "Other has opened input without consuming the question");
    const field = await tabTo(view, `${CARD} textarea`);
    const custom = "Custom sample\n来自面板";
    await view.send("Input.insertText", { text: custom });
    const geometry = await view.cdp.evaluate(`(() => {
      const chat = document.querySelector('[aria-label="Room conversation"], [aria-label="房间对话"]').getBoundingClientRect();
      const body = document.querySelector('.room-attention-body').getBoundingClientRect();
      const send = document.querySelector('button[aria-label="Send"], button[aria-label="发送"]').getBoundingClientRect();
      return { exposedChat: chat.bottom - Math.max(chat.top, body.bottom), body: body.toJSON(),
        sendVisible: send.top >= 0 && send.bottom <= innerHeight && send.left >= 0 && send.right <= innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    if (height <= 600) assert.ok(geometry.exposedChat >= 80, `real queued input leaves ${geometry.exposedChat}px of chat`);
    assert.equal(geometry.sendVisible, true);
    assert.equal(geometry.horizontalOverflow, false);
    await capturePanel(view, `room-queued-live-other-${tag}`);
    await tabTo(view, `${CARD} button[type=submit]`);
    await enter(view);
    await waitFor(view, "qaRoomTerminal.read() === null && !document.querySelector('.room-attention')");
    assert.equal(consumer.read().stage, "done");
    assert.deepEqual(consumer.read().answers.map(({ questionId, text }) => ({ questionId, text })), [
      { questionId: "sample-color-1", text: "Green sample" }, { questionId: "sample-note-2", text: note },
      { questionId: "sample-color-3", text: custom },
    ]);
    assert.deepEqual(consumer.read().opens, ["sample-color-1", "sample-note-2", "sample-color-3"]);
    assert.equal(consumer.writes.length, 10);
    assert.ok(consumer.writes.every(write => write.sessionId === "room-qa-pty"));
    assert.equal(await view.cdp.evaluate("qaRoomTabStates.find(tab => tab.id === 't2').activity"), "talking");
    assert.deepEqual(await view.cdp.evaluate("qaRoomTerminal.errors"), []);
    await save(`room-queued-live-consumption-${tag}`, { head: process.env.GITHUB_SHA, snapshots, field, geometry,
      consumer: consumer.read(), writes: consumer.writes });
    t.diagnostic(JSON.stringify({ consumerQuestions: consumer.read().answers.map(answer => answer.questionId), writes: consumer.writes.length, geometry }));
  });
}

test("stale queued and answer controls send no extra terminal input", async t => {
  const { consumer, view } = await ready(t, "en", 1440, 900, 14);
  const attempts = [];
  for (const [data, selector, kind] of [["\x1b[1;2D", OPEN, "single"], ["\r", `${CARD} [data-option-index="2"]`, "queued"]]) {
    const frame = await consumer.externalInput(data);
    const attempt = await view.cdp.evaluate(`(async () => {
      const old = document.querySelector(${JSON.stringify(selector)}), before = qaRoomTerminal.read().requestId;
      await qaRoomTerminal.paint(${JSON.stringify(frame.screen)});
      const connected = old.isConnected, after = qaRoomTerminal.read().requestId; old.click();
      return { connected, before, after };
    })()`);
    assert.equal(attempt.connected, true);
    assert.notEqual(attempt.before, attempt.after);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === '${kind}'`);
    assert.deepEqual(consumer.writes, [], "stale connected controls cannot write to the current question");
    attempts.push(attempt);
  }
  assert.deepEqual(consumer.externalWrites, ["\x1b[1;2D", "\r"]);
  assert.deepEqual(consumer.read().answers.map(({ questionId, text }) => ({ questionId, text })), [{ questionId: "sample-color-1", text: "Blue sample" }]);
  assert.equal(consumer.read().questionId, "sample-note-2");
  assert.equal(consumer.read().stage, "queued");
  await save("room-queued-live-stale-controls", { head: process.env.GITHUB_SHA, attempts, readback: await readback(view),
    consumer: consumer.read(), writes: consumer.writes, externalWrites: consumer.externalWrites });
});
