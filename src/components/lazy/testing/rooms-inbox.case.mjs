import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./roomsQaFixture.mjs";

const PAGE = "src/components/lazy/testing/rooms-qa.html?attention=0";

test("room shows its own read-only inbox next to chat and flow", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}&inbox=1`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "!!document.querySelector('[data-room-inbox-tab]')");
  // 角标只算本房间有待处理的会话。
  await waitFor(view, "document.querySelector('[data-room-inbox-tab]').textContent.includes('1')");
  await click(view, "[data-room-inbox-tab]");
  await waitFor(view, "!!document.querySelector('.room-inbox .inbox-session[data-session=sk-t1]')");
  const scoped = await view.cdp.evaluate("qaCalls.filter(c => c.command === 'collab_inbox_sessions').every(c => c.args.roomId === '01m6v2yfg2ps6jak5pk7tx625h')");
  assert.equal(scoped, true, "the room inbox only asks for this room");
  await waitFor(view, "document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)");
  await capturePanel(view, "room-inbox-sessions");
  await click(view, ".room-inbox .inbox-session[data-session=sk-t1]");
  await waitFor(view, "document.querySelectorAll('.room-inbox .inbox-message').length === 2");
  const detail = await view.cdp.evaluate("document.querySelector('.room-inbox .inbox--detail').innerText");
  assert.match(detail, /已回复：从 1 开始。/, "per-question replies are shown");
  assert.match(detail, /待回复/);
  assert.match(detail, /回复 前端：错误码表还用旧的吗？/, "quotes from another session use the backend preview");
  const labels = await view.cdp.evaluate("[...document.querySelectorAll('.room-inbox button')].filter(b => b.offsetParent).map(b => b.innerText.trim())");
  for (const word of ["投递", "合并", "撤回", "暂缓", "答复", "重发", "放弃"]) {
    assert.ok(!labels.some((label) => label.includes(word)), `room inbox must not offer "${word}": ${labels}`);
  }
  await capturePanel(view, "room-inbox-detail");
  await click(view, ".room-inbox .inbox-open");
  assert.deepEqual(await view.cdp.evaluate("qaOpened"), ["t1"], "opening the session reaches the member terminal");
  const writes = await view.cdp.evaluate("qaCalls.filter(c => /^collab_inbox_(offer|prepare|begin|receipt|activate)/.test(c.command)).length");
  assert.equal(writes, 0, "reading the room inbox never triggers delivery");
  // 回到对话，草稿区仍在。
  await click(view, "[role=tab][data-state=inactive]");
  await waitFor(view, "!!document.querySelector('[aria-label=房间对话]')");
});

test("room inbox stays narrow-window usable at 720x480", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}&inbox=1`);
  await view.bounds({ x: 0, y: 0, width: 720, height: 480 });
  await waitFor(view, "!!document.querySelector('[data-room-inbox-tab]')");
  await click(view, "[data-room-inbox-tab]");
  await waitFor(view, "!!document.querySelector('.room-inbox .inbox-session')");
  await click(view, ".room-inbox .inbox-session");
  await waitFor(view, "!!document.querySelector('.room-inbox .inbox-back')");
  const fit = await view.cdp.evaluate(`(() => { const r = document.querySelector('.room-inbox .inbox-back').getBoundingClientRect();
    return r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);
  assert.equal(fit, true, "back button is visible in the minimum window");
  await waitFor(view, "document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)");
  await capturePanel(view, "room-inbox-720");
  await click(view, ".room-inbox .inbox-back");
  await waitFor(view, "!!document.querySelector('.room-inbox .inbox-session') && !document.querySelector('.room-inbox .inbox--detail')");
  await capturePanel(view, "room-inbox-720-sessions");
  await click(view, ".room-inbox .inbox-session");
  await waitFor(view, "!!document.querySelector('.room-inbox .inbox-back')");
  await click(view, ".room-inbox .inbox-back");
  await waitFor(view, "!document.querySelector('.room-inbox .inbox--detail')");
});

test("without the inbox backend the room keeps only chat and flow", async (t) => {
  const { view } = await browserFixture(t, PAGE);
  await waitFor(view, "!!document.querySelector('[aria-label=房间对话]')");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('[data-room-inbox-tab]')"), false);
  assert.equal(await view.cdp.evaluate("qaCalls.some(c => c.command.startsWith('collab_inbox_'))"), false);
});

test("room inbox reads in English and Esc returns to the list without closing the room", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}&inbox=1&locale=en`);
  await view.bounds({ x: 0, y: 0, width: 720, height: 480 });
  await waitFor(view, "!!document.querySelector('[data-room-inbox-tab]')");
  await click(view, "[data-room-inbox-tab]");
  await click(view, ".room-inbox .inbox-session");
  await waitFor(view, "document.querySelectorAll('.room-inbox .inbox-message').length === 2");
  const detail = await view.cdp.evaluate("document.querySelector('.room-inbox .inbox--detail').innerText");
  assert.match(detail, /Awaiting reply/);
  assert.match(detail, /Open session/);
  assert.equal(await view.cdp.evaluate("document.documentElement.scrollWidth > innerWidth"), false, "no horizontal overflow at 720");
  await waitFor(view, "document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)");
  await capturePanel(view, "room-inbox-720-en");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-inbox .inbox--detail') && !!document.querySelector('.room-inbox .inbox-session')");
  assert.equal(await view.cdp.evaluate("qaClosed"), 0, "Esc in the detail only goes back to the list");
});
