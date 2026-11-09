import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, click, waitFor, capturePanel } from "./browserFixture.mjs";
import { fill } from "../../../../scripts/plugin-tests/market-ui-support.mjs";
import { resize } from "./production-uiFixture.mjs";

async function fixture(t, query = "") {
  let view, errors = [];
  t.after(async () => {
    if (!view) return;
    try { errors = await view.cdp.evaluate("roomCreationQA.errors"); }
    catch (error) { errors = [String(error)]; }
  });
  ({ view } = await browserFixture(t, `src/components/lazy/testing/room-creation.html${query}`));
  t.after(() => assert.deepEqual(errors, []));
  await resize(view, 720, 480);
  await waitFor(view, "!!document.querySelector('.room-main button')");
  await click(view, ".room-main button");
  await waitFor(view, "!!document.querySelector('[data-slot=dialog-content]')");
  return view;
}
const create = "[data-room-create]";
const path = "[data-room-project] input";
const choose = "[data-room-project] button";
async function name(view, text) {
  const id = await view.cdp.evaluate("document.querySelector('[data-slot=dialog-content] input').id");
  await fill(view, `[id=${JSON.stringify(id)}]`, text);
}
async function created(view, expected) {
  const count = await view.cdp.evaluate("roomCreationQA.calls.filter(call => call.command === 'room_create').length");
  await click(view, create);
  await waitFor(view, `!document.querySelector('[data-slot=dialog-content]') && roomCreationQA.launches.length === ${(count + 1) * 3}`);
  const result = await view.cdp.evaluate("({ calls: roomCreationQA.calls.filter(call => call.command === 'room_create'), launches: roomCreationQA.launches })");
  assert.equal(result.calls.length, count + 1);
  assert.equal(result.calls.at(-1).args.projectRoot, expected);
  assert.deepEqual(result.launches.slice(-3).map(launch => launch.project.rootPath), [expected, expected, expected]);
  assert.equal(await view.cdp.evaluate("document.querySelector('.room-sidebar nav button[aria-current=true]').title"), expected);
  assert.equal(await view.cdp.evaluate(`!!document.querySelector('.room-main header [title=${JSON.stringify(expected)}]')`), true);
}

test("new room defaults to the current project and launches its members there", async t => {
  const view = await fixture(t, "?current=1");
  assert.equal(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(path)}).value`), "/qa/current-project");
  assert.match(await view.cdp.evaluate("document.querySelector('[data-room-project]').innerText"), /current-project/);
  await name(view, "Default project room");
  await created(view, "/qa/current-project");
  await click(view, ".room-compact-nav button");
  await click(view, 'button[aria-label="新建房间"]');
  await name(view, "Default project room");
  await click(view, choose);
  await waitFor(view, `document.querySelector(${JSON.stringify(path)}).value === '/qa/other-project'`);
  await created(view, "/qa/other-project");
  assert.deepEqual(await view.cdp.evaluate("[...document.querySelectorAll('.room-sidebar nav button')].map(button => button.title).sort()"),
    ["/qa/current-project", "/qa/other-project"]);
});

for (const locale of ["zh-CN", "en"]) test(`new room selects and validates a project without an open workspace at 720x480 (${locale})`, async t => {
  const view = await fixture(t, `?locale=${locale}`);
  await name(view, "Another project room");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${create}').disabled`), true);
  await view.cdp.evaluate("roomCreationQA.holdValidation = true");
  await click(view, choose);
  await waitFor(view, "roomCreationQA.calls.some(call => call.command === 'project_open')");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${create}').disabled`), true);
  await view.cdp.evaluate(`document.querySelector('${create}').click()`);
  assert.equal(await view.cdp.evaluate("roomCreationQA.calls.some(call => call.command === 'room_create')"), false);
  await view.cdp.evaluate("roomCreationQA.holdValidation = false; roomCreationQA.release()");
  await waitFor(view, `document.querySelector(${JSON.stringify(path)}).value === '/qa/other-project' && !document.querySelector('${create}').disabled`);
  const picker = await view.cdp.evaluate("roomCreationQA.calls.find(call => call.command === 'plugin:dialog|open').args.options");
  assert.equal(picker.directory, true); assert.equal(picker.multiple, false);
  const shape = await view.cdp.evaluate(`(() => { const dialog=document.querySelector('[data-slot=dialog-content]'), r=dialog.getBoundingClientRect();
    const fields=document.querySelector('[data-room-create-fields]'), footer=document.querySelector('[data-slot=dialog-footer]');
    return { top:r.top, bottom:r.bottom, width:dialog.scrollWidth, available:dialog.clientWidth, viewport:innerHeight,
      fieldsBottom:fields.getBoundingClientRect().bottom, footerTop:footer.getBoundingClientRect().top,
      scrolls:fields.scrollHeight > fields.clientHeight, overflow:getComputedStyle(fields).overflowY,
      page:document.documentElement.scrollWidth, pageWidth:innerWidth }; })()`);
  assert.ok(shape.top >= 0 && shape.bottom <= shape.viewport && shape.width <= shape.available && shape.page <= shape.pageWidth, JSON.stringify(shape));
  assert.ok(shape.scrolls && shape.overflow === 'auto' && shape.fieldsBottom <= shape.footerTop, JSON.stringify(shape));
  if (locale === "en") assert.equal(await view.cdp.evaluate("/\\p{Script=Han}/u.test(document.querySelector('[data-slot=dialog-content]').innerText)"), false);
  await capturePanel(view, `room-project-${locale}-720x480`);
  await view.cdp.evaluate("[...document.querySelectorAll('[data-slot=dialog-content] input[aria-label]')].at(-2).setAttribute('data-last-member', '')");
  await click(view, '[data-last-member]');
  assert.equal(await view.cdp.evaluate("document.activeElement === document.querySelector('[data-last-member]')"), true);
  await fill(view, '[data-last-member]', 'Verifier');
  assert.equal(await view.cdp.evaluate(`([...document.querySelectorAll('[data-room-create-fields] [data-slot=badge]')].every(badge => {
    const row=badge.parentElement, input=row.querySelector('input');
    return badge.getBoundingClientRect().right <= input.getBoundingClientRect().left;
  }))`), true, 'member roles do not overlap the name inputs');
  await capturePanel(view, `room-project-roster-${locale}-720x480`);
  await created(view, "/qa/other-project");
});

test("invalid directory blocks creation, cancellation preserves the error and selecting a valid project recovers", async t => {
  const view = await fixture(t, "?current=1");
  await name(view, "Validated room");
  await view.cdp.evaluate("roomCreationQA.pickerPath = '/qa/missing'; roomCreationQA.projectError = 'Directory unavailable'");
  await click(view, choose);
  await waitFor(view, "document.querySelector('[data-room-project] [role=alert]')?.textContent.includes('Directory unavailable')");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${create}').disabled`), true);
  assert.equal(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(path)}).value`), "/qa/missing");
  await view.cdp.evaluate(`document.querySelector('${create}').click(); roomCreationQA.pickerPath = null`);
  await click(view, choose);
  await waitFor(view, `!document.querySelector(${JSON.stringify(choose)}).disabled`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${create}').disabled`), true);
  assert.equal(await view.cdp.evaluate("roomCreationQA.calls.filter(call => call.command === 'room_create').length"), 0);
  await view.cdp.evaluate("qaSetLocale('en')");
  await waitFor(view, "document.querySelector('[data-room-project] [role=alert]')?.textContent.includes('Could not open')");
  await view.cdp.evaluate("roomCreationQA.pickerPath = '/qa/linked-project'; roomCreationQA.projectError = null");
  await click(view, choose);
  await waitFor(view, `!document.querySelector('${create}').disabled`);
  await created(view, "/qa/other-project");
});
