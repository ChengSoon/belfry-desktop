import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./roomsQaFixture.mjs";
import { enter } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

const PAGE = "src/components/lazy/testing/rooms-qa.html?attention=0&choices=queued";
const CARD = '.room-choice-card[data-member-id="fe"]';
const OPEN = `${CARD} .room-choice-open`;

async function ready(t, { locale = "zh-CN", width = 1440, height = 900, font = 14 } = {}) {
  const { view } = await browserFixture(t, `${PAGE}&locale=${locale}`);
  await view.bounds({ x: 0, y: 0, width, height });
  await view.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await view.cdp.evaluate(`document.documentElement.style.fontSize = '${font}px'`);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'queued' && Array.isArray(window.qaRoomTabStates)`);
  return view;
}

async function tabTo(view, selector) {
  for (let step = 0; step < 45; step++) {
    await press(view, "Tab");
    if (await view.cdp.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`)) return;
  }
  assert.fail(`Tab did not reach ${selector}`);
}

async function visibleControl(view, selector) {
  const geometry = await view.cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)}), bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    const scroll = element.closest('.room-attention-scroll')?.getBoundingClientRect();
    return { bounds: bounds.toJSON(), scroll: scroll?.toJSON(),
      visible: bounds.width > 0 && bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight && element.contains(hit) };
  })()`);
  assert.ok(geometry.visible, `control is visible and receives clicks: ${JSON.stringify(geometry)}`);
  return geometry;
}

async function roomGeometry(view) {
  return view.cdp.evaluate(`(() => {
    const chat = document.querySelector('[aria-label="Room conversation"], [aria-label="房间对话"]').getBoundingClientRect();
    const body = document.querySelector('.room-attention-body').getBoundingClientRect();
    const composer = document.querySelector('.room-composer').getBoundingClientRect();
    const send = document.querySelector('button[aria-label="Send"], button[aria-label="发送"]').getBoundingClientRect();
    return { exposedChat: chat.bottom - Math.max(chat.top, body.bottom), body: body.toJSON(), composer: composer.toJSON(),
      sendVisible: send.top >= 0 && send.bottom <= innerHeight && send.left >= 0 && send.right <= innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
}

test("a Working member exposes a queued question and opening it does not submit an answer", async t => {
  const view = await ready(t);
  assert.deepEqual(await view.cdp.evaluate("qaRoomTabStates.find(tab => tab.id === 't2')"),
    { id: "t2", phase: "running", activity: "talking" });
  assert.deepEqual(await view.cdp.evaluate("({ opens: qaOpenCalls, answers: qaChoiceCalls })"), { opens: [], answers: [] });
  await capturePanel(view, "room-queued-discovery");
  assert.ok(await view.cdp.evaluate(`!!document.querySelector('${OPEN}')`), "a queued card must provide an explicit open-question action");
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${CARD} [data-option-index], ${CARD} textarea').length`), 0,
    "a closed queue has no guessed options or answer field");
  await click(view, OPEN);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD}').dataset.requestState`), "pending");
  assert.deepEqual(await view.cdp.evaluate("qaOpenCalls"), [{ tabId: "t2", requestId: "queue-1", sessionId: "session-t2" }]);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [], "opened is distinct from sent");
  assert.match(await view.cdp.evaluate(`document.querySelector('${CARD} h3').textContent`), /Which sample color/);
  await click(view, `${CARD} [data-option-index="2"]`);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'submitted'`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [
    { tabId: "t2", requestId: "question-1", sessionId: "session-t2", answer: { kind: "single", index: 2 } },
  ]);
  assert.equal(await view.cdp.evaluate("qaRoomTabStates.find(tab => tab.id === 't2').activity"), "talking");
});

test("an in-flight queue open survives collapse and rejects repeated pointer and keyboard activation", async t => {
  const view = await ready(t, { width: 720, height: 480, font: 20 });
  await tabTo(view, ".room-attention-open");
  await enter(view);
  await tabTo(view, OPEN);
  await visibleControl(view, OPEN);
  await view.cdp.evaluate("qaHoldOpen('t2')");
  await enter(view);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'opening'`);
  await enter(view);
  await enter(view);
  await view.cdp.evaluate(`document.querySelector('${OPEN}').click()`);
  assert.equal(await view.cdp.evaluate("qaOpenCalls.length"), 1);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${OPEN}').disabled`), true);
  await press(view, "Escape");
  await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'false'");
  assert.equal(await view.cdp.evaluate("qaClosed"), 0);
  await enter(view);
  await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'true'");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD}').dataset.requestState`), "opening");
  await capturePanel(view, "room-queued-opening-compact");
  await view.cdp.evaluate("qaResolveOpen('t2', { status: 'opened', requestId: 'question-1' })");
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD}').dataset.requestState`), "pending");
  assert.equal(await view.cdp.evaluate("qaOpenCalls.length"), 1);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
});

for (const locale of ["zh-CN", "en"]) {
  test(`queued questions keep keyboard access, drafts and 80px of chat in a small window (${locale})`, async t => {
    const view = await ready(t, { locale, width: 720, height: 480, font: 20 });
    await view.cdp.evaluate(`qaSetOpenedInteraction('t2', { ...qaReadInteraction('t2'), requestId: 'opened-input', kind: 'input', queue: undefined,
      question: 'What should the isolated example show?', input: { label: 'Example text' } })`);
    await tabTo(view, ".room-attention-open");
    await enter(view);
    await tabTo(view, OPEN);
    await visibleControl(view, OPEN);
    await capturePanel(view, `room-queued-entry-${locale}`);
    await enter(view);
    await waitFor(view, `!!document.querySelector('${CARD} textarea')`);
    await tabTo(view, `${CARD} textarea`);
    const field = await visibleControl(view, `${CARD} textarea`);
    assert.ok(field.bounds.top >= field.scroll.top && field.bounds.bottom <= field.scroll.bottom,
      `the entire input is inside the request region: ${JSON.stringify(field)}`);
    const text = "First example\n第二行";
    await view.send("Input.insertText", { text });
    await press(view, "Escape");
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'false'");
    assert.equal(await view.cdp.evaluate("document.activeElement?.matches('.room-attention-open')"), true);
    assert.equal(await view.cdp.evaluate("qaClosed"), 0);
    await enter(view);
    await tabTo(view, `${CARD} textarea`);
    assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD} textarea').value`), text);
    for (const height of [700, 480]) {
      await view.bounds({ x: 0, y: 0, width: 720, height });
      await view.send("Emulation.setDeviceMetricsOverride", { width: 720, height, deviceScaleFactor: 1, mobile: false });
    }
    await waitFor(view, "document.querySelector('.room-attention')?.dataset.expanded === 'true'");
    assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD} textarea').value`), text);
    const geometry = await roomGeometry(view);
    assert.ok(geometry.exposedChat >= 80, `conversation reserve is ${geometry.exposedChat}px`);
    assert.equal(geometry.sendVisible, true);
    assert.equal(geometry.horizontalOverflow, false);
    await capturePanel(view, `room-queued-input-${locale}`);
    await tabTo(view, `${CARD} button[type=submit]`);
    await visibleControl(view, `${CARD} button[type=submit]`);
    assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
    await enter(view);
    await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'submitted'`);
    assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [
      { tabId: "t2", requestId: "opened-input", sessionId: "session-t2", answer: { kind: "input", text } },
    ]);
    assert.equal(await view.cdp.evaluate("qaRoomTabStates.find(tab => tab.id === 't2').activity"), "talking");
    t.diagnostic(JSON.stringify({ field, geometry }));
  });
}

test("queue counts and opening state refresh without opening or answering automatically", async t => {
  const view = await ready(t, { locale: "en" });
  await view.cdp.evaluate("qaPatchInteraction('t2', { queue: { count: 3 }, state: 'opening' })");
  await waitFor(view, `document.querySelector('${CARD} h3')?.textContent === '3 queued questions' && document.querySelector('${OPEN}').disabled`);
  await view.cdp.evaluate("qaPatchInteraction('t2', { queue: { count: 2 }, state: 'pending' })");
  await waitFor(view, `document.querySelector('${CARD} h3')?.textContent === '2 queued questions' && !document.querySelector('${OPEN}').disabled`);
  assert.deepEqual(await view.cdp.evaluate("({ opens: qaOpenCalls, answers: qaChoiceCalls })"), { opens: [], answers: [] });
});

test("old connected queue controls cannot open a replacement request or terminal session", async t => {
  const view = await ready(t);
  for (const change of [
    "qaPatchInteraction('t2', { requestId: 'queue-same-count' })",
    "qaPatchInteraction('t2', { source: { sessionId: 'replacement-t2', agent: 'codex' } })",
  ]) {
    const connected = await view.cdp.evaluate(`(() => {
      const old = document.querySelector('${OPEN}'); ${change};
      const connected = old.isConnected; old.click(); return connected;
    })()`);
    assert.equal(connected, true, "the original control is still connected when clicked");
    assert.deepEqual(await view.cdp.evaluate("qaOpenCalls"), []);
    await waitFor(view, `!!document.querySelector('${OPEN}') && !document.querySelector('${OPEN}').disabled`);
  }
  await click(view, OPEN);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
  assert.deepEqual(await view.cdp.evaluate("qaOpenCalls"), [
    { tabId: "t2", requestId: "queue-same-count", sessionId: "replacement-t2" },
  ]);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
});

test("late open receipts cannot mark a replacement input as sent or overwrite its draft", async t => {
  const view = await ready(t);
  await view.cdp.evaluate("qaHoldOpen('t2')");
  await click(view, OPEN);
  await waitFor(view, "qaOpenCalls.length === 1");
  await view.cdp.evaluate(`qaPatchInteraction('t2', { requestId: 'new-input', kind: 'input', queue: undefined, state: 'pending',
    question: 'A new isolated question', input: { label: 'New answer' } })`);
  await waitFor(view, `!!document.querySelector('${CARD} textarea')`);
  await click(view, `${CARD} textarea`);
  await view.send("Input.insertText", { text: "Keep the current draft" });
  await view.cdp.evaluate("qaResolveOpen('t2', { status: 'opened', requestId: 'question-1' })");
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'pending'`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD} textarea').value`), "Keep the current draft");
  assert.equal(await view.cdp.evaluate(`document.activeElement?.matches('${CARD} textarea')`), true);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
});

test("leaving the room member list invalidates an outstanding open", async t => {
  const view = await ready(t);
  await view.cdp.evaluate("qaHoldOpen('t2')");
  await click(view, OPEN);
  await waitFor(view, "qaOpenCalls.length === 1");
  await view.cdp.evaluate("qaRemoveMember('fe')");
  await waitFor(view, `!document.querySelector('${CARD}')`);
  await view.cdp.evaluate("qaResolveOpen('t2', { status: 'opened', requestId: 'question-1' })");
  assert.equal(await view.cdp.evaluate(`!!document.querySelector('${CARD}')`), false);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
});

test("an unconfirmed open stays locked and uses opening feedback instead of reply feedback", async t => {
  const view = await ready(t, { locale: "en" });
  await view.cdp.evaluate("qaOpenResult('t2', { status: 'failed', message: 'Isolated open failure' })");
  await click(view, OPEN);
  await waitFor(view, `document.querySelector('${CARD} [role=alert]')?.textContent.includes('Isolated open failure')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${OPEN}').disabled`), false);
  assert.match(await view.cdp.evaluate(`document.querySelector('${CARD} [role=alert]').textContent`), /question could not be opened/);
  await view.cdp.evaluate("qaOpenResult('t2', { status: 'uncertain' })");
  await click(view, OPEN);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'uncertain'`);
  assert.match(await view.cdp.evaluate(`document.querySelector('${CARD} [role=alert]').textContent`), /Opening could not be confirmed/);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${OPEN}').disabled`), true);
  await view.cdp.evaluate(`document.querySelector('${OPEN}').click()`);
  assert.equal(await view.cdp.evaluate("qaOpenCalls.length"), 2);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await click(view, `${CARD} .room-choice-terminal`);
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t2"]);
  await capturePanel(view, "room-queued-uncertain");
});

test("an unknown queue or unavailable open handler retains the terminal action", async t => {
  const view = await ready(t);
  await view.cdp.evaluate("qaDropOpenHandler('t2')");
  await click(view, OPEN);
  await waitFor(view, `!!document.querySelector('${CARD} [role=alert]')`);
  assert.deepEqual(await view.cdp.evaluate("qaOpenCalls"), []);
  await view.cdp.evaluate("qaPatchInteraction('t2', { requestId: 'unknown-draft', kind: 'unknown', queue: { count: 2 } })");
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'unknown'`);
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${OPEN}, ${CARD} textarea, ${CARD} [data-option-index]').length`), 0);
  await click(view, `${CARD} .room-choice-terminal`);
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t2"]);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
});

test("the Other option opens a text editor without submitting an answer", async t => {
  const view = await ready(t, { locale: "en" });
  await click(view, OPEN);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
  await view.cdp.evaluate("qaHoldOpen('t2')");
  await click(view, `${CARD} [data-option-index="3"]`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [], "Other is an open-input action, not a single-choice answer");
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'opening'`);
  await view.cdp.evaluate(`document.querySelector('${CARD} [data-option-index="3"]').click()`);
  assert.equal(await view.cdp.evaluate("qaOpenCalls.length"), 2, "repeated Other activation cannot open twice");
  await view.cdp.evaluate("qaResolveOpen('t2', { status: 'opened', requestId: 'question-1-input' })");
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'input'`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD}').dataset.requestState`), "pending");
  assert.deepEqual(await view.cdp.evaluate("qaOpenCalls"), [
    { tabId: "t2", requestId: "queue-1", sessionId: "session-t2" },
    { tabId: "t2", requestId: "question-1", sessionId: "session-t2", optionIndex: 3 },
  ]);
  await tabTo(view, `${CARD} textarea`);
  await view.send("Input.insertText", { text: "A custom isolated example" });
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await tabTo(view, `${CARD} button[type=submit]`);
  await enter(view);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'submitted'`);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), [
    { tabId: "t2", requestId: "question-1-input", sessionId: "session-t2", answer: { kind: "input", text: "A custom isolated example" } },
  ]);
});

test("Other failures report an unconfirmed open and never a sent reply", async t => {
  const view = await ready(t, { locale: "en" });
  await click(view, OPEN);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
  await view.cdp.evaluate("qaOpenResult('t2', { status: 'failed' })");
  await click(view, `${CARD} [data-option-index="3"]`);
  await waitFor(view, `document.querySelector('${CARD} [role=alert]')?.textContent.includes('question could not be opened')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${CARD} [data-option-index="3"]').disabled`), false);
  await view.cdp.evaluate("qaOpenResult('t2', { status: 'uncertain' })");
  await click(view, `${CARD} [data-option-index="3"]`);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestState === 'uncertain'`);
  assert.match(await view.cdp.evaluate(`document.querySelector('${CARD} [role=alert]').textContent`), /Opening could not be confirmed/);
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('${CARD} [data-option-index]:disabled').length`), 3);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await click(view, `${CARD} .room-choice-terminal`);
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t2"]);
});

test("Other with no open capability or a stale action stays out of the answer path", async t => {
  const view = await ready(t);
  await click(view, OPEN);
  await waitFor(view, `document.querySelector('${CARD}')?.dataset.requestKind === 'single'`);
  await view.cdp.evaluate(`(() => {
    const old = document.querySelector('${CARD} [data-option-index="3"]');
    const options = qaReadInteraction('t2').options.map(option => ({ ...option, action: undefined }));
    qaPatchInteraction('t2', { options }); old.click();
  })()`);
  await waitFor(view, `!!document.querySelector('${CARD} [role=alert]')`);
  assert.equal(await view.cdp.evaluate("qaOpenCalls.length"), 1);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await view.cdp.evaluate(`qaPatchInteraction('t2', { requestId: 'question-without-handler',
    options: qaReadInteraction('t2').options.map(option => option.index === 3 ? { ...option, action: 'input' } : option) }); qaDropOpenHandler('t2')`);
  await waitFor(view, `!!document.querySelector('${CARD} [data-option-index="3"] [id*="action"]')`);
  await click(view, `${CARD} [data-option-index="3"]`);
  await waitFor(view, `!!document.querySelector('${CARD} [role=alert]')`);
  assert.equal(await view.cdp.evaluate("qaOpenCalls.length"), 1);
  assert.deepEqual(await view.cdp.evaluate("qaChoiceCalls"), []);
  await click(view, `${CARD} .room-choice-terminal`);
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t2"]);
});
