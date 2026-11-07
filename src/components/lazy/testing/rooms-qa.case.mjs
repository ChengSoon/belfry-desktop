import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./browserFixture.mjs";

const PAGE = "src/components/lazy/testing/rooms-qa.html";

for (const theme of ["dark", "light"]) {
  test(`room view renders with shadcn components (${theme})`, async (t) => {
    const { view } = await browserFixture(t, `${PAGE}?theme=${theme}`);
    await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
    await waitFor(view, "!!document.querySelector('[aria-label=房间对话] article')");
    const checks = await view.cdp.evaluate(`(() => {
      const q = (s) => document.querySelector(s);
      const style = (el) => el && getComputedStyle(el);
      const send = q('button[aria-label=发送]');
      return {
        columns: style(q('.room-view')).gridTemplateColumns.split(' ').length,
        rail: !!q('nav[aria-label=房间列表] button[aria-current=true]'),
        members: document.querySelectorAll('section[aria-label=成员] [data-slot=avatar]').length,
        choiceOptions: document.querySelectorAll('section[aria-label=需要你处理] [data-slot=button] [data-slot=kbd]').length,
        paused: (q('section[aria-label=需要你处理]')?.textContent ?? '').includes('暂停了'),
        tasks: document.querySelectorAll('aside[aria-label=任务板] article').length,
        sendRadius: style(send)?.borderRadius,
        sendBg: style(send)?.backgroundColor,
        bodyMarginInRoom: style(q('.room-view p'))?.marginTop,
      };
    })()`);
    assert.equal(checks.columns, 3, "三栏布局");
    assert.ok(checks.rail, "房间列表选中项");
    assert.equal(checks.members, 4, "四位成员的头像");
    assert.equal(checks.choiceOptions, 3, "选择卡片读出三个选项");
    assert.ok(checks.paused, "暂停投递卡片");
    assert.equal(checks.tasks, 5, "任务板五张卡片");
    assert.notEqual(checks.sendBg, "rgba(0, 0, 0, 0)", "发送按钮有主色底");
    assert.equal(checks.bodyMarginInRoom, "0px", "房间内的段落没有浏览器默认外边距");
    // 选择卡片冒出来、时间线变矮之后，最新一条消息仍然在视野里。
    await waitFor(view, `(() => { const list = document.querySelector('[aria-label=房间对话]');
      return list.scrollHeight - list.scrollTop - list.clientHeight < 4; })()`);
    assert.equal(await view.cdp.evaluate("document.querySelector('button[aria-label=要求回复]').dataset.state"), "on", "默认要求回复");
    await capturePanel(view, `room-${theme}`);
  });
}

test("Escape closes an open menu first and only then the room", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}?attention=0`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "!!document.querySelector('[aria-label=房间对话] article')");
  await capturePanel(view, "room-dark-calm");
  await click(view, "button[aria-label=房间操作]");
  await waitFor(view, "!!document.querySelector('[data-radix-popper-content-wrapper]')");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('[data-radix-popper-content-wrapper]')");
  assert.equal(await view.cdp.evaluate("window.qaClosed"), 0, "收起菜单的那一下不能关掉房间");
  await press(view, "Escape");
  await waitFor(view, "window.qaClosed === 1");
});
