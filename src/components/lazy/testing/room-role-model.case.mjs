import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, waitFor } from "./browserFixture.mjs";
import { clickOption, fill } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

const labels = {
  "zh-CN": { member: "前端", other: "后端", actions: title => `${title} 的操作`, menu: "设置角色模型", inherit: "沿用默认", override: "单独指定", model: "模型标识", next: "下次启动", conflict: "角色绑定或模型设置已变化" },
  en: { member: "Frontend", other: "Backend", actions: title => `Actions for ${title}`, menu: "Set role model", inherit: "Use default", override: "Specify a model", model: "Model ID", next: "next time", conflict: "The role binding or model setting has changed" },
};
const dialog = '[data-slot="dialog-content"]';

async function openModel(view, words, title, width = 1440) {
  if (width < 1080) {
    const open = await view.cdp.evaluate(`document.querySelector('.room-compact-nav button')?.getAttribute('aria-expanded') === 'true'`);
    if (!open) await click(view, ".room-compact-nav button");
  }
  const selector = `button[aria-label=${JSON.stringify(words.actions(title))}]`;
  await view.cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await click(view, selector);
  // The model entry is first, with the remaining existing member actions below it.
  await waitFor(view, `document.querySelector('[role="menuitem"]')?.textContent.includes(${JSON.stringify(words.menu)})`);
  await click(view, '[role="menuitem"]');
  await waitFor(view, `!!document.querySelector('${dialog}') && getComputedStyle(document.querySelector('${dialog}')).pointerEvents === 'auto'`);
}

async function chooseMode(view, label) {
  await click(view, "#role-model-mode");
  await clickOption(view, label);
  await waitFor(view, "!document.querySelector('[data-slot=select-content]')");
}

async function inputModel(view, words, value) {
  await fill(view, `input[aria-label=${JSON.stringify(words.model)}]`, value);
}

async function save(view, count) {
  await click(view, `${dialog} button[type="submit"]`);
  await waitFor(view, `!document.querySelector('${dialog}') && qaCalls.filter(call => call.command === 'room_set_member_model').length === ${count}`);
}

for (const [locale, width, height] of [["zh-CN", 1440, 900], ["en", 720, 480]]) {
  test(`role models can be set independently and cleared (${locale}, ${width}x${height})`, async t => {
    const words = labels[locale];
    const { view } = await browserFixture(t, `src/components/lazy/testing/rooms-qa.html?attention=0&locale=${locale}`);
    await view.bounds({ x: 0, y: 0, width, height });
    await waitFor(view, "!!document.querySelector('.room-sidebar button[aria-haspopup=menu]')");
    await openModel(view, words, words.member, width);
    assert.ok(await view.cdp.evaluate(`document.querySelector('${dialog}').textContent.includes(${JSON.stringify(words.next)})`));
    await chooseMode(view, words.override);
    await click(view, `${dialog} button[aria-haspopup="menu"]`);
    await waitFor(view, "document.querySelector('[role=menuitem]')?.textContent.includes('configured-model')");
    await click(view, '[role="menuitem"]');
    await waitFor(view, "!document.querySelector('[role=menu]')");
    await waitFor(view, `document.querySelector('input[aria-label=${JSON.stringify(words.model)}]')?.value === 'configured-model'`);
    await inputModel(view, words, "builder-model");
    await capturePanel(view, `role-model-${locale}-${width}`);
    const geometry = await view.cdp.evaluate(`(() => { const d = document.querySelector('${dialog}'), b = d.querySelector('button[type="submit"]'), r = b.getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > innerWidth, reachable: r.top >= 0 && r.bottom <= innerHeight && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; })()`);
    assert.deepEqual(geometry, { overflow: false, reachable: true });
    await save(view, 1);
    await openModel(view, words, words.other, width);
    await chooseMode(view, words.override);
    await inputModel(view, words, "reviewer-model");
    await save(view, 2);
    await openModel(view, words, words.member, width);
    assert.equal(await view.cdp.evaluate(`document.querySelector('input[aria-label=${JSON.stringify(words.model)}]').value`), "builder-model");
    await chooseMode(view, words.inherit);
    await save(view, 3);
    const calls = await view.cdp.evaluate("qaCalls.filter(call => call.command === 'room_set_member_model').map(call => call.args)");
    assert.deepEqual(calls.map(call => [call.memberId, call.expectedTabId, call.expectedModelOverride, call.modelOverride]), [
      ["fe", "t2", null, "builder-model"], ["be", "t3", null, "reviewer-model"], ["fe", "t2", "builder-model", null],
    ]);
    assert.ok(calls.every(call => call.expectedAgent === "codex"));
    assert.equal(await view.cdp.evaluate("qaCalls.filter(call => /terminal_(create|write)|provider_(save|select)/.test(call.command)).length"), 0, "saving does not restart a session or mutate provider settings");
  });
}

test("failed role-model saves preserve the draft and reject a stale setting", async t => {
  const words = labels.en;
  const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0&locale=en");
  await waitFor(view, "!!document.querySelector('.room-sidebar button[aria-haspopup=menu]')");
  await openModel(view, words, words.member);
  await chooseMode(view, words.override);
  await inputModel(view, words, "my-draft");
  await view.cdp.evaluate("qaHoldNext('room_set_member_model')");
  await click(view, `${dialog} button[type="submit"]`);
  await waitFor(view, "qaCalls.filter(call => call.command === 'room_set_member_model').length === 1");
  assert.ok(await view.cdp.evaluate(`document.querySelector('${dialog} button[type="submit"]').disabled`));
  await view.cdp.evaluate("qaRelease('room_set_member_model', 'Disk unavailable')");
  await waitFor(view, `document.querySelector('${dialog} [role="alert"]')?.textContent.includes('Disk unavailable')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('input[aria-label="Model ID"]').value`), "my-draft");
  // Let a newer setting reach the room poll before saving again. The form must keep its original CAS value.
  await view.cdp.evaluate("qaSetMemberModel('fe', 'newer-setting')");
  await waitFor(view, "document.querySelector('.room-sidebar').textContent.includes('newer-setting')");
  await click(view, `${dialog} button[type="submit"]`);
  await waitFor(view, `document.querySelector('${dialog} [role="alert"]')?.textContent.includes(${JSON.stringify(words.conflict)})`);
  const calls = await view.cdp.evaluate("qaCalls.filter(call => call.command === 'room_set_member_model').map(call => call.args)");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.expectedModelOverride === null && call.modelOverride === "my-draft"));
  await capturePanel(view, "role-model-conflict");
  await view.cdp.evaluate("qaSetMemberTab('fe', 'replacement-tab')");
  await waitFor(view, `!document.querySelector('${dialog}')`);
});
