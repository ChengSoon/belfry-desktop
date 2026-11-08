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

test("files can be dropped, pasted and seen in messages", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}?attention=0`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "!!document.querySelector('[aria-label=房间对话] article')");
  // 消息里的附件：图片读出缩略图，文档是文件卡片。
  await waitFor(view, "!!document.querySelector('[aria-label=消息附件] img')");
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('[aria-label=消息附件] button')].some((b) => b.textContent.includes('登录改版需求.pdf') && b.textContent.includes('PDF'))"));

  // 拖进中栏：先出现落点浮层，松开后变成待发送的附件。
  await view.cdp.evaluate(`(() => {
    const zone = document.querySelector('[aria-label=房间对话]').closest('main');
    const data = new DataTransfer();
    data.items.add(new File(['hello'], '需求补充.txt', { type: 'text/plain' }));
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    window.qaDrop = () => zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  })()`);
  await waitFor(view, "[...document.querySelectorAll('span')].some((s) => s.textContent === '松开即可添加文件')");
  await capturePanel(view, "room-drop");
  await view.cdp.evaluate("window.qaDrop()");
  await waitFor(view, "document.querySelectorAll('[aria-label=待发送的附件] [aria-label^=移除附件]').length === 1");
  assert.ok(!(await view.cdp.evaluate("[...document.querySelectorAll('span')].some((s) => s.textContent === '松开即可添加文件')")), "松开后浮层收起");

  // 粘贴一个文件：同样进待发送列表，不往输入框塞文字。
  await view.cdp.evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label=消息]');
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1, 2, 3])], '', { type: 'image/png' }));
    field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  await waitFor(view, "document.querySelectorAll('[aria-label=待发送的附件] [aria-label^=移除附件]').length === 2");
  assert.equal(await view.cdp.evaluate("document.querySelector('textarea[aria-label=消息]').value"), "");
  assert.equal(await view.cdp.evaluate("document.querySelector('button[aria-label=发送]').disabled"), false, "只有附件也能发");
  await capturePanel(view, "room-draft-attachments");

  // 粘贴普通文字：照常进输入框，不当附件。
  await view.cdp.evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label=消息]');
    field.focus();
    const data = new DataTransfer();
    data.setData('text/plain', '先看设计稿');
    field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  await waitFor(view, "document.querySelector('textarea[aria-label=消息]').value === '先看设计稿'");

  // 移除一个草稿附件：副本随之丢弃。
  await click(view, "[aria-label=待发送的附件] [aria-label^=移除附件]");
  await waitFor(view, "document.querySelectorAll('[aria-label=待发送的附件] [aria-label^=移除附件]').length === 1");
  assert.ok(await view.cdp.evaluate("window.qaCalls.some((c) => c.command === 'room_discard_attachment')"));

  // 发送：附件 id 跟着消息走。
  await click(view, "button[aria-label=发送]");
  await waitFor(view, "window.qaCalls.some((c) => c.command === 'room_say')");
  const say = await view.cdp.evaluate("window.qaCalls.find((c) => c.command === 'room_say').args");
  assert.equal(say.text, "先看设计稿");
  assert.equal(say.attachmentIds.length, 1);
  assert.equal(say.ask, true, "默认要求回复");
  await waitFor(view, "document.querySelectorAll('[aria-label=待发送的附件]').length === 0");
});

for (const theme of ["dark", "light"]) {
  test(`flow view shows who dispatches to whom and who is working (${theme})`, async (t) => {
    const { view } = await browserFixture(t, `${PAGE}?theme=${theme}`);
    await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
    await waitFor(view, "!!document.querySelector('[aria-label=房间对话] article')");
    await view.cdp.evaluate("[...document.querySelectorAll('[role=tab]')].find((tab) => tab.textContent.includes('流程')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))");
    await waitFor(view, "document.querySelectorAll('[aria-label=协作流程] .react-flow__node').length === 5");
    await waitFor(view, "document.querySelectorAll('[aria-label=协作流程] .react-flow__edge').length >= 4");
    const flow = await view.cdp.evaluate(`(() => {
      const nodes = [...document.querySelectorAll('[aria-label=协作流程] .react-flow__node')];
      const labels = [...document.querySelectorAll('[aria-label=协作流程] .react-flow__edgelabel-renderer span')].map((s) => s.textContent);
      const rect = (n) => n.getBoundingClientRect();
      const overlap = nodes.some((a, i) => nodes.some((b, j) => j > i && !(rect(a).right <= rect(b).left || rect(b).right <= rect(a).left || rect(a).bottom <= rect(b).top || rect(b).bottom <= rect(a).top)));
      return {
        titles: nodes.map((n) => n.textContent),
        labels,
        animated: document.querySelectorAll('[aria-label=协作流程] .room-flow-pulse').length,
        waiting: !!document.querySelector('[aria-label=协作流程] .room-flow-node--waiting'),
        overlap,
      };
    })()`);
    assert.ok(flow.titles.some((x) => x.includes("你")), "有「你」节点");
    assert.ok(flow.titles.some((x) => x.includes("统筹员")), "有统筹节点");
    assert.ok(flow.labels.includes("等你选择"), `前端在等你选择：${flow.labels}`);
    assert.ok(flow.labels.some((x) => x.includes("T3 进行中")), `后端正在做 T3：${flow.labels}`);
    assert.ok(flow.waiting, "等你选择的节点高亮");
    assert.ok(flow.animated >= 1, "正在做 / 等你的连线在动");
    assert.equal(flow.overlap, false, "节点不重叠");
    await capturePanel(view, `room-flow-${theme}`);
  });
}

test("@ completion, markdown, file links, unread divider and pause", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}?attention=0`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "!!document.querySelector('[aria-label=房间对话] article')");

  // 发给你的消息前有「新消息」分隔线。
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('[role=separator]')].some((s) => s.textContent.includes('新消息'))"));

  // Markdown：代码块、列表、加粗；路径变成可点的链接，点了在预览里打开。
  const md = await view.cdp.evaluate(`(() => {
    const body = [...document.querySelectorAll('.room-md')].find((n) => n.textContent.includes('已加限流'));
    return { pre: !!body.querySelector('pre code'), li: body.querySelectorAll('li').length, strong: !!body.querySelector('strong'),
      files: [...body.querySelectorAll('.room-md-file')].map((b) => b.textContent) };
  })()`);
  assert.deepEqual(md, { pre: true, li: 2, strong: true, files: ["src-tauri/src/sms.rs", "src/api/sms.ts:18"] });
  await view.cdp.evaluate("[...document.querySelectorAll('.room-md-file')].find((b) => b.textContent.includes('sms.ts')).click()");
  await waitFor(view, "window.qaFiles.length === 1");
  assert.deepEqual(await view.cdp.evaluate("window.qaFiles[0]"), { root: "/Users/cheng/work/Project/tool/belfry-win", path: "src/api/sms.ts", line: 18 });

  // @ 补全：打 @后 弹出名单，回车选中，插入「@后端 」。
  await view.cdp.evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label=消息]');
    field.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, '你好 @后');
    field.setSelectionRange(5, 5);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(view, "!!document.querySelector('[aria-label=点名] [role=option]')");
  assert.deepEqual(await view.cdp.evaluate("[...document.querySelectorAll('[aria-label=点名] [role=option] .font-medium')].map((n) => n.textContent)"), ["@后端"]);
  await capturePanel(view, "room-mention");
  await press(view, "Enter");
  await waitFor(view, "document.querySelector('textarea[aria-label=消息]').value === '你好 @后端 '");
  assert.ok(!(await view.cdp.evaluate("!!document.querySelector('[aria-label=点名]')")), "选中后名单收起");
  assert.ok(!(await view.cdp.evaluate("window.qaCalls.some((c) => c.command === 'room_say')")), "选人那一下回车不发送");

  // 暂停：头部菜单里暂停，出现横幅；横幅上恢复。
  await click(view, "button[aria-label=房间操作]");
  await waitFor(view, "[...document.querySelectorAll('[role=menuitem]')].some((i) => i.textContent.includes('暂停房间'))");
  await view.cdp.evaluate("[...document.querySelectorAll('[role=menuitem]')].find((i) => i.textContent.includes('暂停房间')).click()");
  await waitFor(view, "!!document.querySelector('[role=status]') && document.querySelector('[role=status]').textContent.includes('房间已暂停')");
  await capturePanel(view, "room-paused");
  await view.cdp.evaluate("[...document.querySelectorAll('[role=status] button')].find((b) => b.textContent.includes('恢复')).click()");
  await waitFor(view, "!document.querySelector('[role=status]')");
});

test("small scrolls near the bottom are not pulled back and polling does not move the view", async (t) => {
  const { view } = await browserFixture(t, `${PAGE}?attention=0`);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "!!document.querySelector('[aria-label=房间对话] article')");
  const metrics = "(() => { const l = document.querySelector('[aria-label=房间对话]'); return { top: l.scrollTop, max: l.scrollHeight - l.clientHeight }; })()";
  await waitFor(view, `${metrics}.max > 200 && ${metrics}.max - ${metrics}.top < 4`);
  const box = await view.cdp.evaluate("(() => { const r = document.querySelector('[aria-label=房间对话]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  // 触控板一下只滚十来个像素：连滚几下，每一下都要真的往上走。
  for (let step = 0; step < 4; step++) {
    await view.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -12 });
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  const after = await view.cdp.evaluate(metrics);
  assert.ok(after.max - after.top >= 40, `往上滚了却被拽回底部：离底 ${after.max - after.top}px`);
  // 再等两轮轮询（1.5 秒一轮）：没有新消息时视野一动不动。
  await new Promise((resolve) => setTimeout(resolve, 3_400));
  const later = await view.cdp.evaluate(metrics);
  assert.equal(later.top, after.top, "轮询不该挪动正在看历史的视野");
  // 浮标出现，点一下回到底部。
  await waitFor(view, "[...document.querySelectorAll('button')].some((b) => b.textContent.includes('回到底部'))");
  await view.cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('回到底部')).click()");
  await waitFor(view, `${metrics}.max - ${metrics}.top < 4`);
});
