import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./roomsQaFixture.mjs";
import { enter } from "../../../../scripts/plugin-tests/market-ui-support.mjs";
import { roomChoiceProcess } from "./roomsChoiceProcess.mjs";

const CARD = '.room-choice-card[data-member-id="fe"]';

async function tabTo(view, selector) {
  for (let step = 0; step < 45; step++) {
    await press(view, "Tab");
    if (await view.cdp.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`)) {
      const visibility = await view.cdp.evaluate(`(() => {
        const element = document.activeElement, r = element.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const scroll = element.closest('.room-attention-scroll'), body = element.closest('.room-attention-body');
        return { visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && element.contains(hit),
          target: r.toJSON(), hit: hit?.outerHTML.slice(0, 400), body: body?.getBoundingClientRect().toJSON(),
          scroll: scroll && { bounds: scroll.getBoundingClientRect().toJSON(), top: scroll.scrollTop,
            height: scroll.clientHeight, content: scroll.scrollHeight } };
      })()`);
      assert.ok(visibility.visible, `keyboard target is visible and clickable: ${selector}: ${JSON.stringify(visibility)}`);
      return visibility;
    }
  }
  assert.fail(`Tab did not reach ${selector}`);
}

async function clickFocused(view) {
  const point = await view.cdp.evaluate(`(() => {
    const r = document.activeElement.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await view.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
}

async function clickDisabled(view, selector) {
  const target = await view.cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)}), r = element.getBoundingClientRect();
    return { disabled: element.matches(':disabled'), x: r.left + r.width / 2, y: r.top + r.height / 2,
      visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight };
  })()`);
  assert.equal(target.disabled, true, "in-flight answer disables its option");
  assert.equal(target.visible, true, "disabled option remains visible for the repeated pointer attempt");
  for (const type of ["mousePressed", "mouseReleased"]) {
    await view.send("Input.dispatchMouseEvent", { type, x: target.x, y: target.y, button: "left", clickCount: 1 });
  }
}

for (const [width, height, font] of [[1440, 900, 14], [720, 480, 20]]) {
  test(`room controls deliver confirmation, multiple and text answers to a real terminal consumer (${width}x${height})`, async t => {
    const consumer = await roomChoiceProcess(t);
    const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0&choices=terminal", { handle: consumer.handle });
    await view.bounds({ x: 0, y: 0, width, height });
    await view.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await view.cdp.evaluate(`document.documentElement.style.fontSize = '${font}px'`);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'confirmation'`);
    assert.deepEqual(consumer.writes, [], "reading and displaying the real request sends no input");
    if (height <= 600) await click(view, ".room-attention-open");
    await tabTo(view, `${CARD} [data-option-index="2"]`);
    const gate = consumer.holdNextWrite();
    if (height <= 600) await enter(view);
    else await clickFocused(view);
    assert.deepEqual(await gate.arrived, { sessionId: "room-qa-pty", data: "\x1b[B" });
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'submitting'`);
    await enter(view);
    await enter(view);
    await clickDisabled(view, `${CARD} [data-option-index="2"]`);
    assert.equal(consumer.writes.length, 1, "repeated keyboard and pointer input cannot duplicate the in-flight answer");
    assert.deepEqual(consumer.read().answers, [], "holding navigation cannot confirm the request");
    gate.release();
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'multiple'`);
    assert.deepEqual(consumer.read().answers, [{ kind: "confirmation", index: 2 }]);
    await capturePanel(view, `room-choice-execution-multiple-${width}`);
    await tabTo(view, `${CARD} .room-choice-option:nth-child(2) [role=checkbox]`);
    await press(view, " ");
    await tabTo(view, `${CARD} .room-choice-option:nth-child(3) [role=checkbox]`);
    await press(view, " ");
    assert.equal(consumer.writes.length, 2, "checkbox edits stay local until explicit submission");
    await tabTo(view, `${CARD} button[type=submit]`);
    await clickFocused(view);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'input'`);
    assert.deepEqual(consumer.read().answers, [{ kind: "confirmation", index: 2 }, { kind: "multiple", indices: [1, 2] }]);
    const input = await tabTo(view, `${CARD} textarea`);
    assert.ok(input.target.top >= input.scroll.bounds.top && input.target.bottom <= input.scroll.bounds.bottom,
      `Tab reveals the entire textarea inside the request region: ${JSON.stringify(input)}`);
    await view.send("Input.insertText", { text: "first step\n下一步" });
    await capturePanel(view, `room-choice-execution-input-${width}`);
    if (height <= 600) {
      await tabTo(view, `${CARD} button[type=submit]`);
      await clickFocused(view);
    } else await press(view, "Enter", 2);
    await waitFor(view, "qaRoomTerminal.read() === null && !document.querySelector('.room-attention')");
    assert.deepEqual(consumer.read().answers, [
      { kind: "confirmation", index: 2 }, { kind: "multiple", indices: [1, 2] }, { kind: "input", text: "first step\n下一步" },
    ]);
    assert.equal(consumer.writes.length, 6);
    assert.ok(consumer.writes.every(write => write.sessionId === "room-qa-pty"));
    assert.deepEqual(consumer.writes.slice(-2).map(write => write.data), ["\x1b[200~first step\r下一步\x1b[201~", "\r"]);
    assert.deepEqual(await view.cdp.evaluate("qaRoomTerminal.errors"), []);
    assert.equal(await view.cdp.evaluate("qaClosed"), 0);
    t.diagnostic(JSON.stringify({ answers: consumer.read().answers, writes: consumer.writes, input }));
  });
}

test("a connected old room option cannot answer a request changed in the real terminal", async t => {
  const consumer = await roomChoiceProcess(t);
  const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0&choices=terminal", { handle: consumer.handle });
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'confirmation'`);
  const frame = await consumer.externalInput("\r");
  // Paint the actual next consumer screen, then click the still-connected old
  // control in the same microtask, before the UI's next 500ms polling tick.
  const attempt = await view.cdp.evaluate(`(async () => {
    const old = document.querySelector('${CARD} [data-option-index="2"]');
    const requestId = qaRoomTerminal.read().requestId;
    await qaRoomTerminal.paint(${JSON.stringify(frame.screen)});
    const connected = old.isConnected;
    old.click();
    return { connected, changed: requestId !== qaRoomTerminal.read().requestId };
  })()`);
  assert.deepEqual(attempt, { connected: true, changed: true });
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'multiple'`);
  assert.deepEqual(consumer.writes, [], "a stale RoomView control sends no keys to the new request");
  assert.deepEqual(consumer.externalWrites, ["\r"]);
  assert.deepEqual(consumer.read().answers, [{ kind: "confirmation", index: 1 }]);
  assert.deepEqual(await view.cdp.evaluate("qaRoomTerminal.read().selectedIndices"), [1, 3]);
  assert.equal(await view.cdp.evaluate("qaRoomTerminal.read().state"), "pending");
  assert.deepEqual(await view.cdp.evaluate("qaRoomTerminal.errors"), []);
  t.diagnostic(JSON.stringify({ attempt, answers: consumer.read().answers, writes: consumer.writes, externalWrites: consumer.externalWrites }));
});
