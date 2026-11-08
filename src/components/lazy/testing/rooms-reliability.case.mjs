import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, click, waitFor } from "./browserFixture.mjs";

const PAGE = "src/components/lazy/testing/rooms-qa.html?attention=0";
const FIELD = "textarea[aria-label=消息]";
const attachments = "document.querySelectorAll('[aria-label=待发送的附件] [aria-label^=移除附件]').length";
async function ready(t, width = 1440, height = 900) {
  const { view } = await browserFixture(t, PAGE);
  await view.bounds({ x: 0, y: 0, width, height });
  await waitFor(view, `!!document.querySelector('${FIELD}')`);
  return view;
}
async function type(view, value) {
  await view.cdp.evaluate(`(() => {
    const field = document.querySelector('${FIELD}');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(view, `document.querySelector('${FIELD}').value === ${JSON.stringify(value)}`);
}
async function switchRoom(view, index) {
  await view.cdp.evaluate(`document.querySelectorAll('nav[aria-label=房间列表] button')[${index}].click()`);
  await waitFor(view, `!!document.querySelector('${FIELD}') && document.querySelectorAll('nav[aria-label=房间列表] button')[${index}].getAttribute('aria-current') === 'true'`);
}
async function drop(view) {
  await view.cdp.evaluate(`(() => {
    const data = new DataTransfer();
    data.items.add(new File(['draft'], 'draft.txt', { type: 'text/plain' }));
    document.querySelector('${FIELD}').closest('main').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  })()`);
}

test("send success preserves subsequent typing and does not resubmit across panel remounts", async (t) => {
  const view = await ready(t);
  await type(view, "submitted snapshot");
  await view.cdp.evaluate("window.qaHoldNext('room_say')");
  await click(view, "button[aria-label=发送]");
  await waitFor(view, "window.qaCalls.filter(c => c.command === 'room_say').length === 1");
  await type(view, "new text while sending");
  await view.cdp.evaluate("window.qaShowRoom(false)");
  await waitFor(view, `!document.querySelector('${FIELD}')`);
  await view.cdp.evaluate("window.qaShowRoom(true)");
  await waitFor(view, `!!document.querySelector('${FIELD}')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FIELD}').value`), "new text while sending");
  assert.equal(await view.cdp.evaluate("document.querySelector('button[aria-label=发送]').disabled"), true);
  await view.cdp.evaluate("window.qaRelease('room_say')");
  await waitFor(view, "!document.querySelector('button[aria-label=发送]').disabled");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FIELD}').value`), "new text while sending");
  assert.equal(await view.cdp.evaluate("window.qaCalls.filter(c => c.command === 'room_say').length"), 1);
});

test("each room keeps text, recipients, reply target and attachments after switching and closing", async (t) => {
  const view = await ready(t);
  await type(view, "room A draft");
  await drop(view); await waitFor(view, `${attachments} === 1`);
  await click(view, "[aria-label=收件人]");
  await waitFor(view, "!!document.querySelector('[role=option]')");
  await view.cdp.evaluate("[...document.querySelectorAll('[role=option]')].find(n => n.textContent.includes('后端')).click()");
  await view.cdp.evaluate("[...document.querySelectorAll('[aria-label=房间对话] article button')].find(n => n.textContent.trim() === '回复').click()");
  await waitFor(view, "!!document.querySelector('[aria-label=取消回复]')");
  await switchRoom(view, 1);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FIELD}').value`), "");
  await type(view, "room B draft");
  await switchRoom(view, 0);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FIELD}').value`), "room A draft");
  assert.equal(await view.cdp.evaluate(attachments), 1);
  assert.ok(await view.cdp.evaluate("!!document.querySelector('[aria-label=取消回复]')"));
  assert.ok(await view.cdp.evaluate("document.querySelector('[aria-label=收件人]').textContent.includes('后端')"));
  await view.cdp.evaluate("window.qaShowRoom(false)");
  await waitFor(view, `!document.querySelector('${FIELD}')`);
  await view.cdp.evaluate("window.qaShowRoom(true)");
  await waitFor(view, `!!document.querySelector('${FIELD}')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FIELD}').value`), "room A draft");
  assert.equal(await view.cdp.evaluate(attachments), 1);
  assert.equal(await view.cdp.evaluate("window.qaCalls.filter(c => c.command === 'room_discard_attachment').length"), 0);
  await switchRoom(view, 1);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FIELD}').value`), "room B draft");
});

test("imports and failed sends retain the source room draft while another room is open", async (t) => {
  const view = await ready(t);
  await type(view, "retry me");
  await view.cdp.evaluate("window.qaHoldNext('room_paste_attachment')");
  await drop(view);
  await waitFor(view, "window.qaCalls.some(c => c.command === 'room_paste_attachment')");
  await switchRoom(view, 1);
  await view.cdp.evaluate("window.qaRelease('room_paste_attachment')");
  await switchRoom(view, 0);
  await waitFor(view, `${attachments} === 1 && !document.querySelector('button[aria-label=发送]').disabled`);
  await view.cdp.evaluate("window.qaHoldNext('room_say')");
  await click(view, "button[aria-label=发送]");
  await waitFor(view, "window.qaCalls.some(c => c.command === 'room_say')");
  await switchRoom(view, 1);
  await view.cdp.evaluate("window.qaRelease('room_say', 'synthetic send failure')");
  await switchRoom(view, 0);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${FIELD}').value`), "retry me");
  assert.equal(await view.cdp.evaluate(attachments), 1);
  assert.equal(await view.cdp.evaluate("window.qaCalls.filter(c => c.command === 'room_say').length"), 1);
});

for (const mode of ["flow", "background", "hidden", "away"]) {
  test(`new messages stay unread while ${mode}, then become read when shown`, async (t) => {
    const view = await ready(t);
    await view.cdp.evaluate("Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })");
    if (mode === "flow") {
      await view.cdp.evaluate("[...document.querySelectorAll('[role=tab]')].find(n => n.textContent.includes('流程')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))");
      await waitFor(view, "!!document.querySelector('[aria-label=协作流程]')");
    } else if (mode === "background") {
      await view.cdp.evaluate("Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false }); window.dispatchEvent(new Event('blur'))");
    } else if (mode === "hidden") {
      await view.cdp.evaluate("Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))");
    } else {
      await view.cdp.evaluate("const l = document.querySelector('[aria-label=房间对话]'); l.scrollTop = 0; l.dispatchEvent(new Event('scroll'))");
    }
    const at = await view.cdp.evaluate("window.qaPushMessage()");
    await waitFor(view, "document.querySelector('[aria-label=房间对话]').textContent.includes('请确认这一条新消息')");
    // Allow effects/observer frames to finish before inspecting the persisted read cursor.
    await view.cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const seen = "Number(localStorage.getItem('belfry.rooms.v2.seen.' + window.qaRoomIds[0]) || 0)";
    assert.ok(await view.cdp.evaluate(`${seen} < ${at}`), `${mode} must not advance the read cursor`);
    if (mode === "flow") {
      await view.cdp.evaluate("[...document.querySelectorAll('[role=tab]')].find(n => n.textContent.includes('对话')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))");
    } else if (mode === "background") {
      await view.cdp.evaluate("Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true }); window.dispatchEvent(new Event('focus'))");
    } else if (mode === "hidden") {
      await view.cdp.evaluate("Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'))");
    } else {
      await view.cdp.evaluate("[...document.querySelectorAll('button')].find(n => n.textContent.includes('条新消息')).click()");
    }
    await waitFor(view, `${seen} >= ${at}`);
  });
}

for (const fontSize of [14, 20]) {
  test(`send, reply, recipient and task controls remain reachable at 720x480 and ${fontSize}px`, async (t) => {
    const view = await ready(t, 720, 480);
    await view.cdp.evaluate(`document.documentElement.style.fontSize = '${fontSize}px'`);
    await type(view, "narrow window send");
    const hit = await view.cdp.evaluate(`(() => {
      const button = document.querySelector('button[aria-label=发送]');
      const r = button.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        && button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    })()`);
    assert.ok(hit, "send button must own its visible click position");
    await click(view, "[aria-label=收件人]");
    await waitFor(view, "!!document.querySelector('[role=option]')");
    await view.cdp.evaluate("document.querySelector('[role=option]').click()");
    await waitFor(view, "!document.querySelector('[role=option]') && getComputedStyle(document.body).pointerEvents !== 'none'");
    await click(view, "button[aria-label=发送]");
    await waitFor(view, "window.qaCalls.some(c => c.command === 'room_say')");
    await click(view, "[aria-label=房间对话] [data-room-message-at]:last-child article button");
    await waitFor(view, "!!document.querySelector('[aria-label=取消回复]')");
    await click(view, "[aria-label=取消回复]");
    await click(view, ".room-compact-nav button:nth-child(2)");
    await waitFor(view, "document.querySelector('aside[aria-label=任务板]').clientWidth > 0");
    await click(view, "aside[aria-label=任务板] header button");
    await waitFor(view, "!!document.querySelector('aside[aria-label=任务板] input')");
    await click(view, ".room-compact-nav button:first-child");
    await waitFor(view, "document.querySelector('.room-sidebar').clientWidth > 0");
    await click(view, "nav[aria-label=房间列表] button");
    await waitFor(view, "document.querySelector('.room-sidebar').clientWidth === 0");
  });
}
