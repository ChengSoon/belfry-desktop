import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, click, press, waitFor } from "./browserFixture.mjs";

test("retained requests stay visible, reply by short id, and open quoted original content", async (t) => {
  const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0&retained=1");
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "!!document.querySelector('textarea[aria-label=消息]')");
  const id = await view.cdp.evaluate("window.qaRetainedId");
  assert.equal(await view.cdp.evaluate(`!!document.querySelector('[aria-label=房间对话] #room-message-${id}')`), false, "retained content does not become part of the recent timeline");
  await click(view, "[aria-label=待回复与按编号回复]");
  await waitFor(view, "document.querySelectorAll('[data-pending-message]').length === 2");
  assert.equal(await view.cdp.evaluate(`document.querySelectorAll('[data-pending-message="${id}"]').length`), 1);
  await view.cdp.evaluate(`(() => {
    const field = document.querySelector('input[aria-label=消息编号]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(id.slice(-8))});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(view, "[role=dialog] form button");
  await waitFor(view, "!document.querySelector('[role=dialog]') && !!document.querySelector('[aria-label=取消回复]')");
  await view.cdp.evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label=消息]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'reply to retained request');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(view, "button[aria-label=发送]");
  await waitFor(view, "window.qaCalls.some(call => call.command === 'room_say')");
  assert.equal(await view.cdp.evaluate("window.qaCalls.find(call => call.command === 'room_say').args.replyTo"), id);
  await click(view, "[aria-label=房间对话] [data-room-message-at]:last-child [aria-label=查看引用消息]");
  await waitFor(view, "!!document.querySelector('[role=dialog] .room-md')");
  assert.ok(await view.cdp.evaluate("document.querySelector('[role=dialog] .room-md').textContent.includes('这是一条较早的请求，原文仍然可以查看和回复。')"));
  await press(view, "Escape");
});
