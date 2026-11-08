import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, click, press, waitFor } from "./browserFixture.mjs";

test("English room UI, history and dialogs fit 720x480 and switching language keeps the draft", async (t) => {
  const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?locale=en&attention=0&history=1");
  await view.bounds({ x: 0, y: 0, width: 720, height: 480 });
  await waitFor(view, "!!document.querySelector('textarea[aria-label=Message]')");
  assert.equal(await view.cdp.evaluate("/\\p{Script=Han}/u.test(document.body.innerText)"), false);
  assert.ok(await view.cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await waitFor(view, "!!document.querySelector('textarea[aria-label=Message]')");
  await view.cdp.evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label=Message]');
    if (!field) throw new Error(document.body.innerText.slice(0, 1000));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Keep this draft');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await view.cdp.evaluate("window.qaField = document.querySelector('textarea[aria-label=Message]'); window.qaSetLocale('zh-CN')");
  await waitFor(view, "!!document.querySelector('textarea[aria-label=消息]')");
  assert.ok(await view.cdp.evaluate("document.querySelector('textarea[aria-label=消息]') === window.qaField && window.qaField.value === 'Keep this draft'"));
  await view.cdp.evaluate("window.qaSetLocale('en')");
  await waitFor(view, "!!document.querySelector('textarea[aria-label=Message]')");
  await click(view, "button[aria-label='Room actions']");
  await click(view, "[data-room-information-open]");
  await waitFor(view, "!!document.querySelector('[data-room-information]')");
  assert.equal(await view.cdp.evaluate("/\\p{Script=Han}/u.test(document.querySelector('[data-room-information]').innerText)"), false);
  assert.ok(await view.cdp.evaluate("document.querySelector('[data-room-information]').scrollWidth <= document.querySelector('[data-room-information]').clientWidth"));
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('[role=dialog]') && document.body.style.pointerEvents !== 'none'");
  await view.cdp.evaluate("document.querySelector('[aria-label=\"Room conversation\"]').scrollTop = 0");
  await click(view, "[data-room-history-load]");
  await waitFor(view, "!!document.querySelector('[data-history-record=\"1000\"]')");
  assert.equal(await view.cdp.evaluate("/\\p{Script=Han}/u.test(document.body.innerText)"), false);
  await click(view, "button[aria-label=Send]");
  await waitFor(view, "window.qaCalls.some(call => call.command === 'room_say')");
  assert.equal(await view.cdp.evaluate("window.qaCalls.find(call => call.command === 'room_say').args.text"), "Keep this draft");
});
