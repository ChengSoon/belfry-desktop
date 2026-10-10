import assert from "node:assert/strict";
import test from "node:test";
import { productionFixture, click, waitFor } from "./productionFixture.mjs";

test("settings content fills the available width without horizontal overflow", async (t) => {
  const { view } = await productionFixture(t);
  await click(view, 'button[title^="设置"]');
  await waitFor(view, "!!document.querySelector('.settings-content > .appearance')");

  for (const width of [1920, 1440, 640]) {
    await view.send("Emulation.setDeviceMetricsOverride", {
      width, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await view.cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const layout = await view.cdp.evaluate(`(() => {
      const content = document.querySelector('.settings-content');
      const section = content.firstElementChild;
      const style = getComputedStyle(content);
      return {
        available: content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        actual: section.getBoundingClientRect().width,
        scrollWidth: content.scrollWidth,
        clientWidth: content.clientWidth,
      };
    })()`);
    assert.ok(Math.abs(layout.actual - layout.available) <= 1,
      `${width}px: settings should fill available width: ${JSON.stringify(layout)}`);
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1,
      `${width}px: settings should not overflow horizontally: ${JSON.stringify(layout)}`);
  }
});
