import assert from "node:assert/strict";
import { click, waitFor } from "./productionFixture.mjs";
import { clickText } from "./production-uiFixture.mjs";
import { fill } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

export async function englishPanel(view, selector) {
  const result = await view.cdp.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    const text = root.innerText + [...root.querySelectorAll('[title],[aria-label],[placeholder],[aria-valuetext]')].flatMap(el => ['title','aria-label','placeholder','aria-valuetext'].map(name => el.getAttribute(name) ?? '')).join(' ');
    return {text, pageWidth:document.documentElement.scrollWidth, width:innerWidth, overflow:root.scrollWidth-root.clientWidth};
  })()`);
  assert.doesNotMatch(result.text, /\p{Script=Han}/u, selector);
  assert.ok(result.pageWidth <= result.width && result.overflow <= 1, JSON.stringify(result));
  return result.text;
}

export async function openAction(view, query) {
  const visible = await view.cdp.evaluate("!!document.querySelector('button[aria-label=\"Quick Open\"]')?.getBoundingClientRect().width");
  if (visible) await click(view, 'button[aria-label="Quick Open"]');
  else {
    await click(view, '.workbench-more > button');
    await clickText(view, 'Quick Open', '.workbench-menu');
  }
  await waitFor(view, "!!document.querySelector('.quick-open input')");
  await fill(view, '.quick-open input', query);
  await waitFor(view, "document.querySelectorAll('.quick-open__item').length === 1");
  assert.match(await englishPanel(view, '.quick-open'), /1 result/);
  await click(view, '.quick-open__item');
}

export async function switchLanguage(view, locale) {
  await view.cdp.evaluate(`localStorage.setItem("belfry.locale.v1", ${JSON.stringify(locale)}); window.dispatchEvent(new StorageEvent("storage", { key: "belfry.locale.v1", newValue: ${JSON.stringify(locale)} }))`);
  await waitFor(view, `document.documentElement.lang === ${JSON.stringify(locale)}`);
}
