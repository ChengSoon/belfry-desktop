import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./browserFixture.mjs";
import { enter } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

const labels = {
  "zh-CN": { brief: "需求简报", conversation: "房间对话", message: "消息", send: "发送", tasks: "任务板", edit: "编辑", save: "保存" },
  en: { brief: "Brief", conversation: "Room conversation", message: "Message", send: "Send", tasks: "Task board", edit: "Edit", save: "Save" },
};
const longBrief = locale => ({
  objective: (locale === "en" ? "T29: Keep the conversation usable while reviewing the complete project requirements. " : "T29：查看完整项目需求时，仍然可以阅读房间对话、编辑简报和发送消息。 ").repeat(9),
  currentFocus: (locale === "en" ? "Check the release, renderer, project directory and cross-platform verification results. " : "发布、主分支和文档已同步，继续核对房间渲染、项目目录与跨平台验证结果。 ").repeat(10),
  constraints: [
    "/Users/cheng/项目目录/" + "long-project-directory-without-a-break/".repeat(12),
    "https://example.test/" + "ContinuousEnglishWord".repeat(30),
    "d8a6fb57a22b240285cc672b10d7235010e3fc16".repeat(12),
  ],
  updatedAt: 1, updatedBy: "user",
});

async function ready(t, locale, width, height, fontSize, brief) {
  const { view } = await browserFixture(t, `src/components/lazy/testing/rooms-qa.html?attention=0&locale=${locale}`);
  await view.bounds({ x: 0, y: 0, width, height });
  // BrowserTarget bounds cap desktop captures at 1600px; this case also covers the supplied 1920px layout.
  await view.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const section = `section[aria-label="${labels[locale].brief}"]`;
  await waitFor(view, `!!document.querySelector(${JSON.stringify(section)}) && typeof qaSetBrief === 'function'`);
  await view.cdp.evaluate(`document.documentElement.style.fontSize = '${fontSize}px'; qaSetBrief(${JSON.stringify(brief)})`);
  await waitFor(view, `document.querySelector(${JSON.stringify(section)}).textContent.includes(${JSON.stringify(brief.objective)})`);
  await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))");
  return { view, section };
}

async function geometry(view, section, locale) {
  return view.cdp.evaluate(`(() => {
    const brief = document.querySelector(${JSON.stringify(section)}), main = brief.closest('main');
    const bounds = main.getBoundingClientRect(), panel = brief.getBoundingClientRect();
    const edit = [...brief.querySelectorAll('button')].find(button => button.textContent.includes(${JSON.stringify(labels[locale].edit)}));
    const conversation = document.querySelector('[aria-label="${labels[locale].conversation}"]');
    const ownPoint = element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); };
    return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, main: { left: bounds.left, right: bounds.right },
      panel: { left: panel.left, right: panel.right, height: panel.height }, conversationHeight: conversation.clientHeight, editHit: ownPoint(edit),
      escaped: [...brief.querySelectorAll('p, [data-slot=badge]')].map(element => { const r = element.getBoundingClientRect(); return { text: element.textContent.slice(0, 50), left: r.left, right: r.right }; }).filter(r => r.left < bounds.left - 1 || r.right > bounds.right + 1) };
  })()`);
}

for (const locale of ["zh-CN", "en"]) {
  for (const [width, height] of [[1920, 1304], [720, 480]]) {
    for (const fontSize of [14, 20]) {
      test(`long room brief stays in its column and expands without hiding chat (${locale}, ${width}x${height}, ${fontSize}px)`, async t => {
        const brief = longBrief(locale), text = labels[locale];
        const { view, section } = await ready(t, locale, width, height, fontSize, brief);
        const collapsed = await geometry(view, section, locale);
        t.diagnostic(JSON.stringify({ collapsed }));
        await capturePanel(view, `room-brief-${locale}-${width}-${fontSize}-collapsed`);
        assert.deepEqual(collapsed.escaped, [], "brief text stays inside the center column");
        assert.equal(collapsed.width, width, "the requested viewport is active");
        assert.equal(collapsed.pageWidth, width, "the page has no horizontal overflow");
        assert.ok(collapsed.editHit, "the edit button owns its visible click position");
        assert.ok(collapsed.conversationHeight >= 80, "the conversation retains room for messages and their controls");

        const toggle = `${section} button[aria-expanded]`;
        await waitFor(view, `document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-expanded') === 'false'`);
        const lines = await view.cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(section + " [data-brief-text]")})].map(element => ({ height: element.clientHeight, line: parseFloat(getComputedStyle(element).lineHeight) }))`);
        assert.equal(lines.length, brief.constraints.length + 2);
        assert.ok(lines.every(item => item.height <= item.line * 2 + 1), "each long summary is at most two lines");
        await view.cdp.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus()`);
        await enter(view);
        await waitFor(view, `document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-expanded') === 'true'`);
        const full = await view.cdp.evaluate(`(() => {
          const button = document.querySelector(${JSON.stringify(toggle)}), content = document.getElementById(button.getAttribute('aria-controls'));
          const range = document.createRange(); range.selectNodeContents(content);
          getSelection().removeAllRanges(); getSelection().addRange(range);
          return { text: getSelection().toString(), height: content.clientHeight, scroll: content.scrollHeight, userSelect: getComputedStyle(content).userSelect };
        })()`);
        for (const value of [brief.objective, brief.currentFocus, ...brief.constraints]) assert.ok(full.text.includes(value), "expanded text can be selected in full");
        assert.equal(full.userSelect, "text");
        assert.ok(full.height > 0 && full.scroll > full.height, "the full brief has a bounded scroll area");
        const expanded = await geometry(view, section, locale);
        t.diagnostic(JSON.stringify({ expanded, fullHeight: full.height, fullScroll: full.scroll }));
        assert.deepEqual(expanded.escaped, []);
        assert.equal(expanded.pageWidth, width);
        assert.ok(expanded.editHit && expanded.conversationHeight >= 80);
        await view.cdp.evaluate("getSelection().removeAllRanges()");
        await capturePanel(view, `room-brief-${locale}-${width}-${fontSize}-expanded`);
        await view.cdp.evaluate(`document.getElementById(document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-controls')).focus()`);
        await press(view, "End");
        await waitFor(view, `document.getElementById(document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-controls')).scrollTop > 0`);
        await capturePanel(view, `room-brief-${locale}-${width}-${fontSize}-expanded-end`);
        const field = `textarea[aria-label="${text.message}"]`;
        await view.cdp.evaluate(`(() => { const field = document.querySelector(${JSON.stringify(field)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'T29 send'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await click(view, `button[aria-label="${text.send}"]`);
        await waitFor(view, "qaCalls.some(call => call.command === 'room_say' && call.args.text === 'T29 send')");
        await view.cdp.evaluate(`document.querySelector(${JSON.stringify(toggle)}).focus()`);
        await enter(view);
        await waitFor(view, `document.querySelector(${JSON.stringify(toggle)})?.getAttribute('aria-expanded') === 'false'`);
        assert.equal(await view.cdp.evaluate(`document.getElementById(document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-controls')).scrollTop`), 0, "collapsing returns to the start of the summary");
        await capturePanel(view, `room-brief-${locale}-${width}-${fontSize}-recollapsed`);
        if (width === 720) await click(view, ".room-compact-nav button:nth-child(2)");
        await waitFor(view, `document.querySelector('aside[aria-label="${text.tasks}"]').clientWidth > 0`);
        await click(view, `aside[aria-label="${text.tasks}"] header button`);
        await waitFor(view, `!!document.querySelector('aside[aria-label="${text.tasks}"] input')`);
      });
    }
  }

  test(`short brief needs no expansion and editing preserves complete text (${locale})`, async t => {
    const brief = { objective: "T29 short", currentFocus: "Ready", constraints: ["Keep version"], updatedAt: 1, updatedBy: "user" };
    const { view, section } = await ready(t, locale, 720, 480, 20, brief);
    t.diagnostic(JSON.stringify({ short: await geometry(view, section, locale) }));
    assert.equal(await view.cdp.evaluate(`document.querySelectorAll(${JSON.stringify(section + " button[aria-expanded]")}).length`), 0);
    const full = longBrief(locale);
    await view.cdp.evaluate(`qaSetBrief(${JSON.stringify(full)})`);
    await waitFor(view, `document.querySelector(${JSON.stringify(section)}).textContent.includes(${JSON.stringify(full.objective)})`);
    await view.cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(section + " button")})].find(button => button.textContent.includes(${JSON.stringify(labels[locale].edit)})).focus()`);
    await enter(view);
    await waitFor(view, `!!document.querySelector(${JSON.stringify(section + " textarea")})`);
    const values = await view.cdp.evaluate(`(() => { const section = document.querySelector(${JSON.stringify(section)}); return { objective: section.querySelectorAll('textarea')[0].value, focus: section.querySelector('input').value, constraints: section.querySelectorAll('textarea')[1].value, focused: document.activeElement === section.querySelector('textarea') }; })()`);
    assert.deepEqual(values, { objective: full.objective, focus: full.currentFocus, constraints: full.constraints.join("\n"), focused: true });
    await view.cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(section + " button")})].find(button => button.textContent.includes(${JSON.stringify(labels[locale].save)})).focus()`);
    await enter(view);
    await waitFor(view, "qaCalls.some(call => call.command === 'room_update_brief')");
    const saved = await view.cdp.evaluate("qaCalls.find(call => call.command === 'room_update_brief').args");
    const id = await view.cdp.evaluate("qaRoomIds[0]");
    assert.deepEqual(saved, { id, objective: full.objective, focus: full.currentFocus, constraints: full.constraints });
    await waitFor(view, `!document.querySelector(${JSON.stringify(section + " textarea")})`);
    await view.cdp.evaluate(`qaSetBrief(${JSON.stringify(brief)})`);
    await waitFor(view, `document.querySelector(${JSON.stringify(section)}).textContent.includes('T29 short') && !document.querySelector(${JSON.stringify(section + " button[aria-expanded]")})`);
  });
}
