// T23/T27：720×480、最大字号 20，两个平台标记和亮暗主题的设置 7 分区。
// 使用生产构建 + 隔离 Chrome + 合成 IPC；不读取真实配置。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { uiFixture, resize, settings, theme, click, waitFor, intact } from "../src/components/lazy/testing/production-uiFixture.mjs";

const OUT = process.env.BELFRY_SETTINGS_STRESS_OUT ?? "docs/design/belfry-ui/settings-shell/stress";
const sections = [["models", "模型服务", ".patch-bay"], ["hooks", "会话状态", ".hook-agent-card"], ["shortcuts", "快捷键", ".shortcut-row"], ["backup", "数据与备份", ".os-action-card"], ["environment", "协作环境", ".environment-checks li"], ["about", "关于", ".about-card"]];

for (const platform of ["macos", "windows"]) {
  test(`${platform} settings at 720x480 with maximum font size`, { timeout: 90_000 }, async t => {
    const { view, baseline } = await uiFixture(t, { nativeExtension: `
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ${JSON.stringify(platform === "macos" ? "Macintosh" : "Windows NT 10.0")} });
      localStorage.setItem('belfry.typography.v1', JSON.stringify({ fontFamily: 'JetBrains Mono', fontSize: 20, activeImportedFont: null, importedFonts: [] }));
    ` });
    await mkdir(OUT, { recursive: true });
    await resize(view, 720, 480);
    const results = [];
    for (const mode of ["dark", "light"]) {
      if (await view.cdp.evaluate("!!document.querySelector('.settings-view')")) await click(view, 'button[title="关闭设置"]');
      await theme(view, mode);
      for (const [id, label, ready] of sections) {
        await settings(view, label);
        await waitFor(view, `!!document.querySelector(${JSON.stringify(ready)})`);
        await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))");
        const shape = await view.cdp.evaluate(`(() => {
          const el = document.querySelector('.settings-content'), r = el.getBoundingClientRect(), nav = document.querySelector('.settings-nav');
          return { font: document.documentElement.style.getPropertyValue('--app-font-size'), width: el.clientWidth,
            scroll: el.scrollWidth, page: document.documentElement.scrollWidth, right: r.right, bottom: r.bottom,
            nav: nav.scrollWidth, navWidth: nav.clientWidth };
        })()`);
        assert.equal(shape.font, "20px");
        assert.ok(shape.scroll <= shape.width+1 && shape.page <= 720 && shape.nav <= shape.navWidth+1, JSON.stringify({ id, mode, ...shape }));
        assert.ok(shape.right <= 720 && shape.bottom <= 480);
        await view.cdp.evaluate("document.querySelector('.settings-content').scrollTop=0");
        const { data } = await view.send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(OUT, `${platform}-${id}-${mode}-720x480-font20.png`), Buffer.from(data, "base64"));
        results.push({ id, mode, ...shape });
      }
    }
    await writeFile(join(OUT, `${platform}-geometry.json`), JSON.stringify(results, null, 2));
    await intact(view, baseline);
  });
}
