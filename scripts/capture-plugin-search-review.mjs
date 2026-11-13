// A targeted control for T4. "Before" reproduces the previously unreachable
// light selectors in the final build; it is not an archived pre-change build.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uiFixture, settings, theme, waitFor, click } from "../src/components/lazy/testing/production-uiFixture.mjs";
import { compareDirectories } from "./compare-ui-baseline.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(project);
const directory = resolve(process.env.BELFRY_UI_PLUGIN_REVIEW_OUT ?? "/tmp/belfry-ui-plugin-search-review");

test("plugin search component has correct light-theme surfaces and an unchanged dark-theme control", { timeout: 60000 }, async t => {
  const { view } = await uiFixture(t);
  const root = await view.cdp.evaluate("document.documentElement.dataset.platform ?? 'unknown'");
  const html = await readFile("dist/index.html", "utf8");
  const productionAssets = await Promise.all([...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(async ([, path]) => ({ path, sha256: createHash("sha256").update(await readFile(join(project, "dist", path))).digest("hex") })));
  const common = { generatedAt: new Date().toISOString(), platform: root, browser: await view.process.send("Browser.getVersion"), source: { revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() }, productionAssets, syntheticNativeAdapter: true, realUserData: false };
  const before = { ...common, scenario: "Previously unreachable light selectors reproduced in the final build; not an archived pre-change build", captures: [] };
  const after = { ...common, scenario: "Final build with corrected light selectors", captures: [] };
  const controls = [];
  await mkdir(join(directory, "before"), { recursive: true });
  await mkdir(join(directory, "after"), { recursive: true });
  for (const mode of ["dark", "light"]) {
    await theme(view, mode);
    await settings(view, "插件");
    await waitFor(view, "!!document.querySelector('.plugins-search')");
    await view.cdp.evaluate(`(() => {
      const style = document.createElement('style'); style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.append(style);
      const found = [];
      const visit = rules => { for (const rule of rules) {
        if (rule.cssRules) visit(rule.cssRules);
        const selector = rule.selectorText?.replace(/["']/g, '');
        if (selector === ':root[data-theme=light] .pi-plugins .plugins-search' || selector === ':root[data-theme=light] .pi-plugins .plugins-search:focus-visible') found.push({ rule, selector: rule.selectorText });
      }};
      for (const sheet of document.styleSheets) visit(sheet.cssRules);
      window.__pluginSearchReview = found;
      if (found.length !== 2) throw new Error('Expected the two corrected plugin light-theme selectors; found ' + found.length);
    })()`);
    for (const state of ["default", "focus"]) {
      await view.cdp.evaluate(`document.querySelector('.plugins-search').${state === "focus" ? "focus" : "blur"}()`);
      await view.cdp.evaluate(`__pluginSearchReview.forEach(item => { item.rule.selectorText = '.pi-plugins :root[data-theme="light"] .plugins-search' + (item.selector.endsWith(':focus-visible') ? ':focus-visible' : ''); })`);
      const oldEvidence = await capture(view, before, "before", mode, state);
      await view.cdp.evaluate("__pluginSearchReview.forEach(item => { item.rule.selectorText = item.selector; })");
      const newEvidence = await capture(view, after, "after", mode, state);
      assert.deepEqual(newEvidence.rect, oldEvidence.rect, "Selector fix must not change field geometry");
      assert.deepEqual(newEvidence.nearbyButton, oldEvidence.nearbyButton, "Unrelated market button styles and geometry must stay unchanged");
      assert.equal(newEvidence.focusVisible, state === "focus");
      if (mode === "dark") assert.equal(newEvidence.background, oldEvidence.background);
      if (mode === "light") {
        assert.notEqual(newEvidence.background, oldEvidence.background);
        const expected = await view.cdp.evaluate(`(() => { const probe = document.createElement('div'); probe.style.background = 'var(--${state === "focus" ? "canvas" : "surface"})'; document.body.append(probe); const color=getComputedStyle(probe).backgroundColor;probe.remove();return color; })()`);
        assert.equal(newEvidence.background, expected);
      }
      controls.push({ mode, state, oldEvidence, newEvidence });
    }
    await click(view, 'button[title="关闭设置"]');
    await waitFor(view, "!document.querySelector('.settings-view')");
  }
  await writeFile(join(directory, "before", "manifest.json"), JSON.stringify(before, null, 2) + "\n");
  await writeFile(join(directory, "after", "manifest.json"), JSON.stringify(after, null, 2) + "\n");
  await writeFile(join(directory, "control-evidence.json"), JSON.stringify(controls, null, 2) + "\n");
  const report = await compareDirectories(join(directory, "before"), join(directory, "after"), join(directory, "report"));
  for (const item of report.results) {
    if (item.before.theme === "dark") assert.equal(item.changedPixels, 0, "Dark-theme control must stay identical");
    else {
      assert.ok(item.changedPixels > 0, "Light-theme field must visibly change");
    }
  }
  t.diagnostic(`Plugin search reproduction report: ${join(directory, "report", "index.html")}`);
});

async function capture(view, manifest, side, mode, state) {
  await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 250)))");
  const evidence = await view.cdp.evaluate(`(() => {
    const box = element => { const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}; };
    const input=document.querySelector('.plugins-search'), css=getComputedStyle(input);
    const button=[...document.querySelectorAll('.pi-plugins button')].find(button=>button.textContent.includes('浏览市场'));
    const buttonCss=getComputedStyle(button);
    return {background:css.backgroundColor,shadow:css.boxShadow,focusVisible:input.matches(':focus-visible'),rect:box(input),
      nearbyButton:{rect:box(button),background:buttonCss.backgroundColor,color:buttonCss.color,border:buttonCss.border,borderRadius:buttonCss.borderRadius,shadow:buttonCss.boxShadow}};
  })()`);
  const filename = `plugin-search-${mode}-${state}.png`;
  const { rect } = evidence;
  const x = Math.floor(rect.x) - 3, y = Math.floor(rect.y) - 3;
  const clip = { x, y, width: Math.ceil(rect.x + rect.width) + 3 - x, height: Math.ceil(rect.y + rect.height) + 3 - y, scale: 1 };
  const { data } = await view.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
  const png = Buffer.from(data, "base64");
  await writeFile(join(directory, side, filename), png);
  manifest.captures.push({ filename, width: png.readUInt32BE(16), height: png.readUInt32BE(20), theme: mode, sha256: createHash("sha256").update(png).digest("hex"), evidence, viewport: {width:1440,height:960}, component: ".plugins-search with 3px focus-ring margin" });
  return evidence;
}
