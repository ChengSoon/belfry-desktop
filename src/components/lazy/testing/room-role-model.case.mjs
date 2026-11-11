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

for (const locale of ["zh-CN", "en"]) {
  test(`role model list can be fetched from the role's provider and chosen (${locale})`, async t => {
    const words = labels[locale];
    const { view } = await browserFixture(t, `src/components/lazy/testing/rooms-qa.html?attention=0&locale=${locale}`);
    await view.bounds({ x: 0, y: 0, width: 720, height: 480 });
    await waitFor(view, "!!document.querySelector('.room-sidebar button[aria-haspopup=menu]')");
    await openModel(view, words, words.member, 720);
    await chooseMode(view, words.override);
    await waitFor(view, "document.querySelector('[data-role-model-fetch]')?.disabled === false");
    await click(view, "[data-role-model-fetch]");
    await waitFor(view, "!!document.querySelector('[data-role-model-fetched]')");
    assert.match(await view.cdp.evaluate("document.querySelector('[data-role-model-fetched]').textContent"), /4/);
    const call = await view.cdp.evaluate("qaCalls.find(c => c.command === 'provider_models').args");
    assert.equal(call.kind, "codex");
    assert.deepEqual([call.draft.id, call.draft.apiKeyAction, call.draft.apiKey], ["example", "keep", ""], "uses the saved key without sending it from the page");
    await click(view, `${dialog} button[aria-haspopup="menu"]`);
    await waitFor(view, "document.querySelectorAll('[data-role-model-options] [role=menuitem]').length === 4");
    const items = await view.cdp.evaluate("[...document.querySelectorAll('[data-role-model-options] [role=menuitem]')].map(i => i.textContent)");
    assert.deepEqual(items, ["gpt-5.5", "gpt-5.5-mini", "configured-model", "o5-reasoner"], "fetched models are listed once, configured model not duplicated");
    await click(view, "[data-role-model-options] [role=menuitem]:nth-child(2)");
    await waitFor(view, `document.querySelector('input[aria-label=${JSON.stringify(words.model)}]')?.value === 'gpt-5.5-mini'`);
    await waitFor(view, "!document.querySelector('[data-role-model-options]') && document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)");
    await capturePanel(view, `role-model-fetched-${locale}`);
    const geometry = await view.cdp.evaluate(`(() => { const d = document.querySelector('${dialog}'), b = d.querySelector('button[type="submit"]'), r = b.getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > innerWidth, reachable: r.top >= 0 && r.bottom <= innerHeight }; })()`);
    assert.deepEqual(geometry, { overflow: false, reachable: true });
    await save(view, 1);
    assert.equal(await view.cdp.evaluate("qaCalls.find(c => c.command === 'room_set_member_model').args.modelOverride"), "gpt-5.5-mini");
    assert.equal(await view.cdp.evaluate("qaCalls.filter(c => /provider_(save|switch|select)/.test(c.command)).length"), 0, "fetching does not change provider settings");
  });
}

test("model fetch failure keeps manual input, and official sign-in has nothing to fetch", async t => {
  const words = labels.en;
  const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0&locale=en");
  await waitFor(view, "!!document.querySelector('.room-sidebar button[aria-haspopup=menu]')");
  await openModel(view, words, words.member);
  await chooseMode(view, words.override);
  await inputModel(view, words, "typed-model");
  await view.cdp.evaluate("window.qaModelsFailure = 'Endpoint unreachable'");
  await waitFor(view, "document.querySelector('[data-role-model-fetch]')?.disabled === false");
  await click(view, "[data-role-model-fetch]");
  await waitFor(view, `document.querySelector('${dialog} [role="alert"]')?.textContent.includes('Endpoint unreachable')`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('input[aria-label="Model ID"]').value`), "typed-model");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${dialog} button[type="submit"]').disabled`), false, "manual entry can still be saved");

  const official = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0&locale=en&official=1");
  await waitFor(official.view, "!!document.querySelector('.room-sidebar button[aria-haspopup=menu]')");
  await openModel(official.view, words, words.member);
  await chooseMode(official.view, words.override);
  await waitFor(official.view, `document.querySelector('${dialog}').textContent.includes('official sign-in')`);
  assert.equal(await official.view.cdp.evaluate("document.querySelector('[data-role-model-fetch]').disabled"), true);
  assert.equal(await official.view.cdp.evaluate("qaCalls.some(c => c.command === 'provider_models')"), false);
});
