import assert from "node:assert/strict";
import test from "node:test";
import { browserAvailable } from "./panel-support.mjs";
import { marketUiFixture, click, clickOption, press, waitFor, screenshot } from "./market-ui-support.mjs";

const MODE = 'button[aria-label="设置类型"]';
const MENU = '[role=listbox]';
const values = async (view) => JSON.parse(await view.cdp.evaluate("document.querySelector('#settings-values').textContent"));

async function fixture(t) {
  const f = await marketUiFixture(t);
  await f.view.navigate({ url: `${f.origin}/scripts/plugin-tests/fixtures/dropdown-page.html` });
  await waitFor(f.view, `!!document.querySelector(${JSON.stringify(MODE)})`);
  return f;
}

test("plugin dropdown supports keyboard selection and Escape without closing settings", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await view.cdp.evaluate(`document.querySelector(${JSON.stringify(MODE)}).focus()`);
  await press(view, "ArrowDown");
  assert.equal(true, await view.cdp.evaluate(`!!document.querySelector('${MENU}')`), "方向键应展开下拉框");
  await press(view, "ArrowDown"); await press(view, "Enter");
  assert.equal("2", (await values(view)).mode);
  await press(view, "ArrowDown"); await press(view, "End"); await press(view, "Escape");
  assert.equal("2", (await values(view)).mode);
  assert.equal(true, await view.cdp.evaluate("!!document.querySelector('[role=dialog]')"));
  assert.equal(true, await view.cdp.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(MODE)})`));
  await press(view, "ArrowDown"); await press(view, "End"); await press(view, " ");
  assert.equal(false, (await values(view)).mode);
  await press(view, "ArrowUp"); await press(view, "Home"); await press(view, "Enter");
  assert.equal(2, (await values(view)).mode);
  await press(view, "Escape");
  assert.equal(false, await view.cdp.evaluate("!!document.querySelector('[role=dialog]')"));
});

test("plugin dropdown options stay clickable outside a scrolling settings body", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await view.cdp.evaluate("document.querySelector('.plugins-settings-body').style.height='90px'");
  await click(view, MODE);
  const clickable = await view.cdp.evaluate(`(()=>{const option=document.querySelector('${MENU} [role=option]:last-child');const r=option.getBoundingClientRect();return option.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
  assert.equal(true, clickable, "选项不能被滚动设置面板裁剪");
  await screenshot(view, "dropdown-settings");
  await clickOption(view, "关闭");
  assert.equal(false, (await values(view)).mode);
  await click(view, MODE); await click(view, "#after-settings");
  assert.equal(false, await view.cdp.evaluate(`!!document.querySelector('${MENU}')`));
});

test("dropdown preserves unmatched values and closes when disabled or tabbing away", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  assert.equal("", await view.cdp.evaluate("document.querySelector('button[aria-label=\"未匹配设置\"] .plugins-dropdown-value').textContent"));
  assert.equal(true, await view.cdp.evaluate("document.querySelector('button[aria-label=\"空选项\"]').disabled"));
  await click(view, MODE); await press(view, "Tab");
  assert.equal(false, await view.cdp.evaluate(`!!document.querySelector('${MENU}')`));
  assert.equal(2, (await values(view)).mode);
  await click(view, MODE);
  await view.cdp.evaluate("document.querySelector('#toggle-disabled').click()");
  await waitFor(view, `!document.querySelector('${MENU}')`);
  assert.equal(true, await view.cdp.evaluate(`document.querySelector(${JSON.stringify(MODE)}).disabled`));
  assert.equal(2, (await values(view)).mode);
});

test("long dropdowns stay inside narrow viewports and close when the settings body scrolls", async (t) => {
  if (!await browserAvailable(t)) return;
  const { view } = await fixture(t);
  await view.bounds({ x: 0, y: 0, width: 390, height: 640 });
  await click(view, 'button[aria-label="较长选项"]');
  const fits = await view.cdp.evaluate(`(()=>{const r=document.querySelector('${MENU}').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`);
  assert.equal(true, fits);
  await view.cdp.evaluate("document.querySelector('.plugins-settings-body').dispatchEvent(new Event('scroll'))");
  assert.equal(true, await view.cdp.evaluate(`!!document.querySelector('${MENU}')`), "锚点未移动时忽略晚到的滚动通知");
  await press(view, "End"); await press(view, "Enter");
  assert.equal(19, (await values(view)).long);
  await click(view, 'button[aria-label="较长选项"]');
  await screenshot(view, "dropdown-narrow");
  await view.cdp.evaluate("const body=document.querySelector('.plugins-settings-body');body.scrollTop=0;body.dispatchEvent(new Event('scroll'))");
  await waitFor(view, `!document.querySelector('${MENU}')`);
});
