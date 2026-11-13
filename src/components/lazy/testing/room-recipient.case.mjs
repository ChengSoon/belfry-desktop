import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { recipientFixture } from "./roomRecipientFixture.mjs";
import { click, press, resize, setValue, waitFor, intact } from "./production-uiFixture.mjs";

const TRIGGER = '[role=combobox][aria-label="收件人"]';
async function capture(view, name) {
  const out = process.env.BELFRY_RECIPIENT_ARTIFACTS;
  if (!out) return;
  await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(resolve => setTimeout(resolve, 260)))");
  await mkdir(out, { recursive: true });
  const { data } = await view.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, `${name}.png`), Buffer.from(data, "base64"));
}

for (const mode of ["dark", "light"]) {
  test(`production recipient selector in ${mode} theme`, async t => {
    const { view, baseline, requests } = await recipientFixture(t, { mode });
    await resize(view, 1440, 960);
    await capture(view, `${mode}-closed`);
    await click(view, TRIGGER);
    await waitFor(view, "document.querySelectorAll('[role=option]').length === 6");
    assert.equal(await view.cdp.evaluate("document.querySelectorAll('[role=option][data-state=checked]').length"), 1);
    const menu = await view.cdp.evaluate(`(() => {
      const item = document.querySelector('[role=option]');
      const list = document.querySelector('.room-recipient-content');
      const r = list.getBoundingClientRect();
      return { groups: document.querySelectorAll('.room-recipient-heading').length,
        avatar: document.querySelectorAll('.room-recipient-option [data-slot=avatar]').length,
        descriptions: document.querySelectorAll('.room-recipient-description').length,
        itemHeight: item.getBoundingClientRect().height,
        onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    })()`);
    assert.deepEqual({ groups: menu.groups, avatar: menu.avatar, descriptions: menu.descriptions }, { groups: 2, avatar: 4, descriptions: 6 });
    assert.ok(menu.itemHeight >= 48 && menu.onScreen, "readable items and bounded popup");
    await capture(view, `${mode}-open`);
    await press(view, "Escape");
    await waitFor(view, "!document.querySelector('[role=option]')");
    assert.equal(await view.cdp.evaluate(`document.activeElement === document.querySelector('${TRIGGER}')`), true);
    assert.ok(await view.cdp.evaluate("!!document.querySelector('.room-view')"), "Escape closes the selector before closing the room");
    await intact(view, baseline);
    assert.ok(requests.some(request => /\/assets\/RoomView-.*\.js/.test(request.url)), "load the shipped room bundle");
  });
}

test("keyboard selection preserves explicit, automatic and broadcast routing", async t => {
  const { view, baseline, titles } = await recipientFixture(t);
  let sent = 0;
  for (const [keys, label, to] of [
    [["End"], titles[3], [titles[3]]],
    [["Home"], `统筹（${titles[0]}）`, []],
    [["Home", "ArrowDown"], "全体成员", ["@全体"]],
  ]) {
    await view.cdp.evaluate(`document.querySelector('${TRIGGER}').focus()`);
    await press(view, " ");
    await waitFor(view, "!!document.querySelector('[role=option]')");
    await waitFor(view, "document.activeElement?.getAttribute('role') === 'option'");
    for (const key of keys) await press(view, key);
    await waitFor(view, `document.activeElement?.querySelector('.room-recipient-name')?.textContent === ${JSON.stringify(label)}`);
    await press(view, "Enter");
    await waitFor(view, "!document.querySelector('[role=option]')");
    assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(c => c.command === 'room_say').length"), sent,
      "confirming a recipient must not send a message");
    const text = await view.cdp.evaluate(`document.querySelector('${TRIGGER}').textContent`);
    assert.ok(text.includes(label) && !text.includes("跟进交付") && !text.includes("正文里写"), `trigger contains only the selected label ${label}: ${text}`);
    await setValue(view, ".room-composer textarea", `message to ${label}`);
    await click(view, 'button[aria-label="发送"]');
    await waitFor(view, "document.querySelector('.room-composer textarea').value === ''");
    sent++;
    assert.deepEqual(await view.cdp.evaluate("__productionQA.calls.filter(c => c.command === 'room_say').at(-1).args.to"), to);
  }
  // Reply mode keeps the chosen route locked; closing the reply restores it.
  await view.cdp.evaluate("[...document.querySelectorAll('[aria-label=房间对话] article button')].find(n => n.textContent.trim() === '回复').click()");
  await waitFor(view, "!!document.querySelector('[aria-label=取消回复]')");
  assert.ok(await view.cdp.evaluate(`document.querySelector('${TRIGGER}').disabled`));
  await click(view, "[aria-label=取消回复]");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${TRIGGER}').disabled`), false);
  await intact(view, baseline);
});

for (const mode of ["dark", "light"]) {
  test(`long names and 18 members remain usable at 720x480, 20px (${mode})`, async t => {
    const { view, baseline } = await recipientFixture(t, { mode, longNames: true, many: true, fontSize: 20, platform: "windows" });
    await resize(view, 720, 480);
    await capture(view, `${mode}-narrow-closed`);
    await click(view, TRIGGER);
    await waitFor(view, "document.querySelectorAll('[role=option]').length === 20");
    const geometry = await view.cdp.evaluate(`(() => {
      const q = s => document.querySelector(s), list = q('.room-recipient-content'), r = list.getBoundingClientRect();
      return { onScreen: r.left >= 0 && r.top >= 40 && r.right <= innerWidth && r.bottom <= innerHeight,
        overflow: list.scrollWidth > list.clientWidth,
        fontSize: getComputedStyle(q('.room-recipient-description')).fontSize,
        nameFits: q('.room-recipient-name').scrollWidth <= q('.room-recipient-name').clientWidth + 1 };
    })()`);
    assert.ok(geometry.onScreen && !geometry.overflow && geometry.nameFits, JSON.stringify(geometry));
    assert.equal(geometry.fontSize, "17px", "the actual typography setting scales the popup");
    await capture(view, `${mode}-narrow-open`);
    await press(view, "End");
    await waitFor(view, "document.activeElement?.textContent.includes('协作工程师17')");
    assert.ok(await view.cdp.evaluate(`(() => {
      const r = document.activeElement.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    })()`), "keyboard scrolls the last recipient into view");
    await capture(view, `${mode}-narrow-last`);
    await press(view, "Enter");
    await waitFor(view, "!document.querySelector('[role=option]')");
    assert.ok(await view.cdp.evaluate(`document.querySelector('${TRIGGER}').textContent.includes('协作工程师17')`));
    const fits = await view.cdp.evaluate(`(() => {
      const root = document.querySelector('.room-composer');
      return root.scrollWidth <= root.clientWidth && document.documentElement.scrollWidth <= innerWidth;
    })()`);
    assert.ok(fits, "long labels do not overflow the composer");
    await intact(view, baseline);
  });
}

test("English labels, reduced motion and an absent coordinator", async t => {
  const { view, baseline } = await recipientFixture(t, { locale: "en", noForeman: true });
  await view.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const trigger = '[role=combobox][aria-label="Recipients"]';
  await click(view, trigger);
  await waitFor(view, "!!document.querySelector('.room-recipient-content')");
  const state = await view.cdp.evaluate(`(() => {
    const list = document.querySelector('.room-recipient-content');
    return { text: list.textContent, selected: document.querySelector('[role=option][data-state=checked]').textContent,
      animation: getComputedStyle(list).animationName,
      transition: getComputedStyle(document.querySelector('${trigger}')).transitionDuration };
  })()`);
  assert.ok(state.text.includes("Room members · 4 people") && state.selected.includes("All members") && state.selected.includes("Default"));
  assert.equal(state.animation, "none");
  assert.equal(state.transition, "0s");
  await capture(view, "english-no-coordinator");
  await press(view, "Escape");
  await intact(view, baseline);
});

test("the recipient selector is disabled when the room has no members", async t => {
  const { view } = await recipientFixture(t, { empty: true });
  assert.ok(await view.cdp.evaluate(`document.querySelector('${TRIGGER}').disabled`));
  assert.ok(await view.cdp.evaluate("document.querySelector('button[aria-label=发送]').disabled"));
});
