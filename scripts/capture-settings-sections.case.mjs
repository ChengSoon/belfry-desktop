// T20：拍设置 7 个分区的生产实装（亮 / 暗，1440×1200，与 obsidian-screens/shots/sections-*.png 同尺寸），
// 供 docs/design/belfry-ui/settings-sections-fidelity/ 与设计稿并排对照。只用合成数据，不读真实用户数据。
// 运行：pnpm build && BELFRY_SECTIONS_OUT=docs/design/belfry-ui/settings-sections-fidelity/after node --test scripts/capture-settings-sections.case.mjs
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { uiFixture, resize, settings, theme, waitFor } from "../src/components/lazy/testing/production-uiFixture.mjs";

const OUT = process.env.BELFRY_SECTIONS_OUT ?? "docs/design/belfry-ui/settings-sections-fidelity/after";
const SECTIONS = [
  ["provider", "全局 Provider", ".provider-card"],
  ["project", "项目 Provider", ".project-provider"],
  ["hooks", "会话状态", ".hook-agent-card"],
  ["shortcuts", "快捷键", ".shortcut-row"],
  ["backup", "本地备份", ".os-action-card"],
  ["environment", "协作环境", ".environment-checks li"],
  ["about", "关于", ".about-card"],
];

test("capture settings sections for design fidelity", { timeout: 180_000 }, async t => {
  const { view } = await uiFixture(t);
  await mkdir(OUT, { recursive: true });
  for (const mode of ["dark", "light"]) {
    if (await view.cdp.evaluate("!!document.querySelector('.settings-view')")) await view.cdp.evaluate("document.querySelector('button[title=\"关闭设置\"]').click()");
    await theme(view, mode);
    await resize(view, 1440, 1200);
    for (const [id, label, ready] of SECTIONS) {
      await settings(view, label);
      await waitFor(view, `!!document.querySelector(${JSON.stringify(ready)})`);
      await view.cdp.evaluate("document.querySelector('.settings-content').scrollTop = 0; document.fonts.ready.then(() => new Promise(r => setTimeout(r, 400)))");
      const layout = await view.cdp.evaluate(`(() => {
        const content = document.querySelector('.settings-content'), style = getComputedStyle(content);
        return { available: content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          actual: content.firstElementChild.getBoundingClientRect().width, scroll: content.scrollWidth, width: content.clientWidth };
      })()`);
      assert.ok(Math.abs(layout.actual-layout.available) <= 1 && layout.scroll <= layout.width+1,
        `${id}/${mode}: setting section must fill the available width without horizontal overflow: ${JSON.stringify(layout)}`);
      const { data } = await view.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(OUT, `sections-${id}-${mode}.png`), Buffer.from(data, "base64"));
    }
    // 快捷键录制态：进入「打开 / 关闭用量」的行内录制（不保存，拍完取消）。
    await settings(view, "快捷键");
    await view.cdp.evaluate("document.querySelector('#shortcut-edit-toggle-usage').click()");
    await waitFor(view, "!!document.querySelector('.shortcut-row.is-recording')");
    await view.cdp.evaluate("new Promise(r => setTimeout(r, 300))");
    const { data } = await view.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, `sections-shortcuts-recording-${mode}.png`), Buffer.from(data, "base64"));
    await view.cdp.evaluate("[...document.querySelectorAll('.shortcut-editor button')].find(b => b.textContent === '取消').click()");
    await waitFor(view, "!document.querySelector('.shortcut-row.is-recording')");
  }
});
