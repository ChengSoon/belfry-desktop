import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, click, press, waitFor } from "./browserFixture.mjs";

const timeline = "[aria-label=房间对话]";
const visibleAnchor = `(() => {
  const list = document.querySelector('${timeline}'), top = list.getBoundingClientRect().top;
  const row = [...list.querySelectorAll('[data-timeline-key]')].find(row => row.getBoundingClientRect().bottom > top);
  return { key: row.dataset.timelineKey, top: row.getBoundingClientRect().top };
})()`;
async function openHistory(t) {
  const result = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?history=1&attention=0");
  await result.view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(result.view, "!!document.querySelector('textarea[aria-label=消息]')");
  assert.ok(await result.view.cdp.evaluate("!!document.querySelector('[data-room-history-load]')"), "timeline offers earlier history");
  await result.view.cdp.evaluate(`document.querySelector('${timeline}').scrollTop = 0`);
  return result;
}

test("history pagination preserves opaque cursors, live messages and the current scroll anchor", async (t) => {
  const { view } = await openHistory(t);
  await click(view, "[data-room-history-load]");
  await waitFor(view, "!!document.querySelector('[data-history-record=\"1000\"]')");
  assert.deepEqual(await view.cdp.evaluate("window.qaCalls.filter(c => c.command === 'room_history').map(c => c.args.cursor)"), [null, "opaque / cursor+a=="]);
  assert.equal(await view.cdp.evaluate("document.querySelector('[data-history-record=\"1000\"]').textContent.includes('等你回复')"), false, "ledger requests do not invent pending state");
  await view.cdp.evaluate(`document.querySelector('${timeline}').scrollTop = 0; window.qaHoldNext('room_history')`);
  await click(view, "[data-room-history-load]");
  await waitFor(view, "window.qaCalls.filter(c => c.command === 'room_history').length === 3");
  await view.cdp.evaluate(`(() => { const list = document.querySelector('${timeline}'); list.scrollTop = Math.min(200, (list.scrollHeight - list.clientHeight) / 2); list.dispatchEvent(new Event('scroll')); })()`);
  const beforeArrival = await view.cdp.evaluate(visibleAnchor);
  const ids = await view.cdp.evaluate("window.qaRollMessage()");
  await waitFor(view, "document.querySelector('[aria-label=房间对话]').textContent.includes('Live arrival while browsing history')");
  const arrivalTop = await view.cdp.evaluate(`document.querySelector('[data-timeline-key="${beforeArrival.key}"]').getBoundingClientRect().top`);
  assert.ok(Math.abs(arrivalTop - beforeArrival.top) < 3, "live arrivals preserve the reading anchor");
  const anchor = await view.cdp.evaluate(visibleAnchor);
  await view.cdp.evaluate("window.qaRelease('room_history')");
  await waitFor(view, "!!document.querySelector('[data-room-history-end]')");
  const top = await view.cdp.evaluate(`document.querySelector('[data-timeline-key="${anchor.key}"]').getBoundingClientRect().top`);
  assert.ok(Math.abs(top - anchor.top) < 3, `reading anchor moved by ${top - anchor.top}px`);
  for (const id of [ids.removedId, ids.newId]) assert.equal(await view.cdp.evaluate(`document.querySelectorAll('[data-timeline-key="message:${id}"]').length`), 1);
  assert.equal(await view.cdp.evaluate("window.qaCalls.filter(c => c.command === 'room_history').at(-1).args.cursor"), "opaque:last?cursor=%2F");
  for (const offset of ["0", "100", "500", "700"]) assert.ok(await view.cdp.evaluate(`!!document.querySelector('[data-history-record="${offset}"]')`));
  assert.ok(await view.cdp.evaluate("document.querySelector('[data-history-record=\"100\"]').textContent.includes('截断')"));
  assert.ok(await view.cdp.evaluate("document.querySelector('[data-history-record=\"700\"]').textContent.includes('future.kind')"));
  assert.equal(await view.cdp.evaluate("document.querySelector('[data-history-record=\"0\"] script') === null"), true);
});

test("history capacity is explained and late pages cannot enter a different room", async (t) => {
  const { view } = await openHistory(t);
  await click(view, "button[aria-label=房间操作]");
  await click(view, "[data-room-information-open]");
  await waitFor(view, "!!document.querySelector('[data-room-information]')");
  assert.ok(await view.cdp.evaluate("document.querySelector('[data-room-information]').textContent.includes('1.5 MB')"));
  assert.ok(await view.cdp.evaluate("document.querySelector('[data-room-information]').textContent.includes('历史原文保留到删除房间，长期保存请先备份应用数据目录')"));
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('[role=dialog]') && document.body.style.pointerEvents !== 'none'");
  await view.cdp.evaluate(`document.querySelector('${timeline}').scrollTop = 0; window.qaHoldNext('room_history')`);
  await click(view, "[data-room-history-load]");
  await waitFor(view, "window.qaCalls.some(c => c.command === 'room_history')");
  await click(view, "nav[aria-label=房间列表] button:nth-child(2)");
  await waitFor(view, "document.querySelectorAll('nav[aria-label=房间列表] button')[1].getAttribute('aria-current') === 'true'");
  await view.cdp.evaluate("window.qaRelease('room_history')");
  await waitFor(view, "!!document.querySelector('textarea[aria-label=消息]')");
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('[data-history-record]').length"), 0);
});
