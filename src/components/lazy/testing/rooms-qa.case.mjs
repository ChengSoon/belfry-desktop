import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./roomsQaFixture.mjs";

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
  const listeners = await view.cdp.evaluate("qaCalls.filter(call => call.command === 'plugin:event|listen').map(call => call.args.event).sort()");
  assert.ok(listeners.length > 0, "房间已注册原生拖放事件");
  await press(view, "Escape");
  await waitFor(view, "window.qaClosed === 1");
  await waitFor(view, `qaCalls.filter(call => call.command === 'plugin:event|unlisten').length === ${listeners.length}`);
  assert.deepEqual(await view.cdp.evaluate("qaCalls.filter(call => call.command === 'plugin:event|unlisten').map(call => call.args.event).sort()"), listeners);
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
    assert.ok(flow.animated >= 1, "正在做的连线在动");
    assert.equal(flow.overlap, false, "节点不重叠");
    await capturePanel(view, `room-flow-${theme}`);
  });
}

for (const theme of ["dark", "light"]) {
  test(`busy sessions animate without task cards and stop with activity changes (${theme})`, async (t) => {
    const { view } = await browserFixture(t, `${PAGE}?theme=${theme}&attention=0&flow=untracked`);
    await view.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
    await waitFor(view, "!!document.querySelector('[role=tab]') && typeof window.qaSetActivity === 'function'");
    await view.cdp.evaluate("[...document.querySelectorAll('[role=tab]')].find((tab) => tab.textContent.includes('流程')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))");
    await waitFor(view, "document.querySelectorAll('.room-flow-edge--animated').length === 3");
    assert.equal(await view.cdp.evaluate("document.querySelectorAll('.room-flow-node--busy').length"), 3, "统筹和两位成员都显示工作状态");
    assert.equal(await view.cdp.evaluate("document.querySelectorAll('aside[aria-label=任务板] article').length"), 0, "复现没有登记任务的场景");
    assert.ok(await view.cdp.evaluate("document.querySelector('[data-id=foreman]').textContent.includes('2 位成员忙碌')"));

    // 比较真实渲染帧：仅存在动画元素并不能证明动效在运行。
    const frames = await view.cdp.evaluate(`new Promise(resolve => {
      const clock = element => {
        const animation = element?.getAnimations().find(animation => animation instanceof CSSAnimation);
        if (!animation) return null;
        const timing = animation.effect.getComputedTiming();
        return { name: animation.animationName, currentTime: animation.currentTime, startTime: animation.startTime,
          pending: animation.pending, playState: animation.playState, duration: timing.duration, progress: timing.progress };
      };
      const sample = () => {
        const edges = [...document.querySelectorAll('.react-flow__edge')].filter(edge => edge.querySelector('.room-flow-edge--animated')).map(edge => {
          const path = edge.querySelector('.room-flow-edge--animated'), base = path.getCTM();
          const pulse = edge.querySelector('.room-flow-pulse')?.getCTM();
          // Measure particle movement along the path, independently of fitView pan/zoom.
          const point = base && pulse && base.a * base.d !== base.b * base.c ? base.inverse().multiply(pulse) : null;
          return { id: edge.dataset.id, path: path.getAttribute('d'), dash: getComputedStyle(path).strokeDashoffset,
            x: point?.e ?? null, y: point?.f ?? null, clock: clock(path) };
        });
        const bar = document.querySelector('.room-flow-activity i');
        return { at: performance.now(), timeline: document.timeline.currentTime, visibility: document.visibilityState,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, edges,
          bar: bar && { transform: getComputedStyle(bar).transform, clock: clock(bar) } };
      };
      const active = clock => clock && clock.duration > 0 && clock.playState === 'running' && !clock.pending && clock.currentTime !== null;
      const initial = sample();
      let before = null, after = initial, count = 0, frame = 0;
      const finish = () => { clearTimeout(timeout); cancelAnimationFrame(frame); resolve({ initial, before, after, count }); };
      // A wall-clock sleep can expire while Chromium's animation clock is still at zero.
      const timeout = setTimeout(finish, 10_000);
      const tick = () => {
        after = sample(); count++;
        if (after.edges.length === 3 && active(after.bar?.clock) && after.edges.every(edge => active(edge.clock) && Number.isFinite(edge.x) && Number.isFinite(edge.y))) {
          if (!before || after.edges.some((edge, i) => edge.id !== before.edges[i].id || edge.path !== before.edges[i].path)) before = after;
          const moved = after.edges.every((edge, i) => edge.clock.currentTime - before.edges[i].clock.currentTime >= 350
            && edge.dash !== before.edges[i].dash && Math.hypot(edge.x - before.edges[i].x, edge.y - before.edges[i].y) > 1);
          if (moved && after.bar.clock.currentTime - before.bar.clock.currentTime >= 350 && after.bar.transform !== before.bar.transform) return finish();
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })`);
    t.diagnostic(JSON.stringify({ roomMotion: frames }));
    assert.ok(frames.before, "工作动画已启动且连线可测量");
    assert.equal(frames.before.edges.length, 3);
    assert.equal(frames.after.edges.length, 3);
    assert.ok(frames.after.bar, "采样结束时工作指示仍在");
    for (let i = 0; i < frames.before.edges.length; i++) {
      const before = frames.before.edges[i], after = frames.after.edges[i];
      assert.ok(after.clock?.currentTime - before.clock.currentTime >= 350, `${before.id} 的动画时钟确实推进`);
      assert.notEqual(before.dash, after.dash, `${before.id} 的虚线确实流动`);
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 1, `${before.id} 的光点确实移动`);
    }
    assert.notEqual(frames.before.bar.transform, frames.after.bar.transform, "节点上的工作指示持续变化");
    await capturePanel(view, `room-flow-untracked-${theme}`);

    assert.ok(await view.cdp.evaluate("document.querySelector('aside[aria-label=任务板]').textContent.includes('尚未登记任务')"));
    await view.cdp.evaluate("[...document.querySelectorAll('aside[aria-label=任务板] button')].find((button) => button.textContent.includes('查看统筹终端')).click()");
    assert.deepEqual(await view.cdp.evaluate("window.qaOpened"), ["t1"]);

    await view.cdp.evaluate("['t1', 't2', 't3'].forEach((id) => window.qaSetActivity(id, 'idle'))");
    await waitFor(view, "document.querySelectorAll('.room-flow-node--busy, .room-flow-edge--animated, .room-flow-pulse').length === 0");
    const stopped = await view.cdp.evaluate("[...document.querySelectorAll('.react-flow__edge-path')].flatMap(path => path.getAnimations().map(animation => ({ name: animation.animationName, playState: animation.playState, currentTime: animation.currentTime })))");
    t.diagnostic(JSON.stringify({ roomMotionStopped: stopped }));
    assert.deepEqual(stopped, [], "成员空闲后连线没有遗留动画");
    await view.cdp.evaluate("window.qaSetActivity('t2', 'awaiting-choice')");
    await waitFor(view, "!!document.querySelector('.room-flow-node--waiting')");
    assert.equal(await view.cdp.evaluate("document.querySelectorAll('.room-flow-edge--animated').length"), 0, "等待确认不冒充工作中的流动");

    await view.cdp.evaluate("window.qaSetActivity('t2', 'talking')");
    await waitFor(view, "document.querySelectorAll('.room-flow-edge--animated').length === 1");
    await view.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await waitFor(view, "getComputedStyle(document.querySelector('.room-flow-edge--animated')).animationName === 'none'");
    const reduced = await view.cdp.evaluate(`({
      bar: getComputedStyle(document.querySelector('.room-flow-activity i')).animationName,
      halo: getComputedStyle(document.querySelector('.room-flow-node--busy'), '::after').animationName,
      particle: getComputedStyle(document.querySelector('.room-flow-pulse')).display,
      text: document.querySelector('.room-flow-node--busy').textContent,
    })`);
    assert.equal(reduced.bar, "none");
    assert.equal(reduced.halo, "none");
    assert.equal(reduced.particle, "none");
    assert.ok(reduced.text.includes("处理中"), "减少动态效果时仍然明确显示工作状态");
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
  // Fonts and the asynchronously loaded attachment can still resize the timeline.
  await waitFor(view, `(() => {
    const image = document.querySelector('[aria-label=消息附件] img');
    return document.fonts.status === 'loaded' && image?.complete && image.naturalWidth > 0;
  })()`);
  await view.cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  const metrics = "(() => { const l = document.querySelector('[aria-label=房间对话]'); return { top: l.scrollTop, max: l.scrollHeight - l.clientHeight, scrollHeight: l.scrollHeight, clientHeight: l.clientHeight, roomGets: qaCalls.filter(call => call.command === 'room_get').length }; })()";
  await waitFor(view, `${metrics}.max > 200 && ${metrics}.max - ${metrics}.top < 4`);
  const box = await view.cdp.evaluate("(() => { const r = document.querySelector('[aria-label=房间对话]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  const steps = [];
  const polling = {};
  t.after(() => t.diagnostic(JSON.stringify({ scrollSteps: steps, polling })));
  // 触控板一下只滚十来个像素：连滚几下，每一下都要真的往上走。
  for (let step = 0; step < 4; step++) {
    const before = await view.cdp.evaluate(metrics);
    const sample = { step, before };
    steps.push(sample);
    await view.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -12 });
    // CDP acknowledges dispatch before the compositor commits the scroll.
    await waitFor(view, `${metrics}.top <= ${before.top - 12}`);
    sample.after = await view.cdp.evaluate(metrics);
  }
  const after = await view.cdp.evaluate(metrics);
  polling.before = after;
  assert.ok(after.max - after.top >= 40, `往上滚了却被拽回底部：离底 ${after.max - after.top}px`);
  // 再等两轮轮询（1.5 秒一轮）：没有新消息时视野一动不动。
  await new Promise((resolve) => setTimeout(resolve, 3_400));
  const later = await view.cdp.evaluate(metrics);
  polling.after = later;
  assert.equal(later.top, after.top, "轮询不该挪动正在看历史的视野");
  // 浮标出现，点一下回到底部。
  await waitFor(view, "[...document.querySelectorAll('button')].some((b) => b.textContent.includes('回到底部'))");
  await view.cdp.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('回到底部')).click()");
  await waitFor(view, `${metrics}.max - ${metrics}.top < 4`);
});
