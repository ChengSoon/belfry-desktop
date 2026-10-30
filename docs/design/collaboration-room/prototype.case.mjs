import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, click, fill, press, wait, screenshot, assertClean } from './browser-fixture.mjs';

const id = name => `[data-testid="${name}"]`;
const act = name => `[data-action="${name}"]`;
const state = view => view.cdp.evaluate('belfryRoom.state');
const roomText = view => view.cdp.evaluate('document.querySelector("#room-content").innerText');
const count = (view, selector) => view.cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

// 原型全部为合成数据；用例只操作隔离的一次性 Chrome 与本地静态文件，不接触真实 Agent 或用户数据。
test('rooms, tabs and search behave inside the active room only', { timeout: 60000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-room-id]")');
  const initial = await state(view);
  assert.equal(initial.rooms.length, 2, 'Two synthetic rooms are seeded');
  assert.equal(initial.roomId, 'r-login');
  assert.equal(await count(view, '#room-list [data-room-id]'), 2);
  assert.equal(await view.cdp.evaluate('document.querySelector("#room-title").textContent'), '登录体验小组');
  assert.equal(await view.cdp.evaluate('document.querySelector("#member-count").textContent'), '4');
  assert.equal(await count(view, '.timeline .msg'), 3, 'Seeded messages are visible');
  assert.equal(await count(view, '.sys-event--decision'), 1, 'Confirmed decision appears in the timeline');
  assert.equal(await count(view, '[data-msg-id="msg-104"] .msg__task'), 1, 'Dispatch message carries its task card');
  await click(view, '#tab-tasks');
  assert.equal(await count(view, id('task-item')), 3);
  assert.match(await roomText(view), /运行中/);
  assert.match(await roomText(view), /已提交待验证/);
  assert.match(await roomText(view), /验证通过/);
  await click(view, '#tab-artifacts');
  assert.equal(await count(view, id('artifact-item')), 3);
  assert.match(await roomText(view), /规格/);
  // 搜索只过滤当前房间的讨论；从其他标签开始搜索会切回讨论视图。
  await click(view, '#tab-tasks');
  await click(view, act('search'));
  await fill(view, '#message-search', '不存在的关键词');
  assert.equal((await state(view)).view, 'discussion');
  assert.match(await roomText(view), /没有匹配的消息/);
  await fill(view, '#message-search', '重试');
  assert.match(await view.cdp.evaluate('document.querySelector("[data-testid=search-note]").innerText'), /匹配 3 条消息/);
  await click(view, act('close-search'));
  assert.match(await roomText(view), /重试/);
  // 房间切换后内容、成员与任务计数互相隔离。
  await click(view, '[data-room-id="r-export"]');
  assert.equal(await view.cdp.evaluate('document.querySelector("#room-title").textContent'), '导出性能小组');
  assert.equal(await count(view, '.timeline .msg'), 1);
  await click(view, '#tab-artifacts');
  assert.match(await roomText(view), /还没有产物/);
  await click(view, '#tab-tasks');
  assert.equal(await count(view, id('task-item')), 1);
  await click(view, '#tab-discussion');
  assert.match(await roomText(view), /热点/);
  await click(view, '[data-room-id="r-login"]');
  assert.equal(await view.cdp.evaluate('document.querySelector("#room-title").textContent'), '登录体验小组');
  assert.equal((await state(view)).roomId, 'r-login');
  await assertClean(f);
});

test('dialogs trap focus, Escape closes and refocuses the opener; narrow screens use drawers', { timeout: 60000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-room-id]")');
  await click(view, act('new-room'));
  await wait(view, 'document.querySelector("#modal").open');
  for (let i = 0; i < 14; i++) {
    await press(view, 'Tab');
    assert.equal(await view.cdp.evaluate('document.querySelector("#modal").contains(document.activeElement)'), true, 'Tab stays inside the dialog');
  }
  await press(view, 'Escape');
  await wait(view, '!document.querySelector("#modal").open');
  await wait(view, '!!document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-action=new-room]") !== null');
  // 窄屏：左右栏成为抽屉，遮罩与 Escape 都能退出，输入区始终可见。
  await view.bounds({ x: 0, y: 0, width: 390, height: 844 });
  // 840 断点生效时侧栏会从 0 滑出屏幕；等它真正不可见（visibility 过渡结束）再点，
  // 指针才不会落在还在滑动的抽屉上。
  await wait(view, 'getComputedStyle(document.querySelector("#sidebar")).visibility === "hidden"');
  await click(view, act('sidebar'));
  await wait(view, 'document.querySelector("#sidebar").getBoundingClientRect().left >= -1');
  assert.equal(await view.cdp.evaluate('document.querySelector(".drawer-backdrop").hidden'), false);
  await screenshot(view, 'mobile-sidebar-drawer');
  // 抽屉遮罩铺满全屏，中心点会落在抽屉上；这里直接触发遮罩自身的点击处理。
  await view.cdp.evaluate('document.querySelector(".drawer-backdrop").click();true');
  await wait(view, 'document.querySelector(".drawer-backdrop").hidden === true');
  await click(view, act('inspector'));
  await wait(view, 'getComputedStyle(document.querySelector("#inspector")).display !== "none"');
  assert.equal(await view.cdp.evaluate('document.querySelector("#inspector").getBoundingClientRect().right <= innerWidth + 1'), true);
  await press(view, 'Escape');
  await wait(view, 'document.querySelector(".drawer-backdrop").hidden === true');
  assert.equal(await view.cdp.evaluate('(()=>{const r=document.querySelector("#composer-wrap").getBoundingClientRect();return r.height > 0 && r.bottom <= innerHeight + 1;})()'), true, 'Composer stays visible on mobile');
  await view.bounds({ x: 0, y: 0, width: 1440, height: 960 });
  await assertClean(f);
});

test('layouts, themes and checked viewports keep the shell usable and readable', { timeout: 90000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-room-id]")');
  await screenshot(view, 'rooms-dark-1440');
  // 布局切换：专注讨论收起右栏并限制行宽；紧凑工作保留字号只缩间距。
  await click(view, act('design'));
  await wait(view, 'document.querySelector("#modal").open');
  await click(view, `${id('layout-option')}[value="focus"]`);
  assert.equal(await view.cdp.evaluate('document.documentElement.dataset.layout'), 'focus');
  assert.equal(await view.cdp.evaluate('getComputedStyle(document.querySelector("#inspector")).display'), 'none');
  await click(view, id('modal-close'));
  await wait(view, '!document.querySelector("#modal").open');
  assert.equal(await view.cdp.evaluate('document.querySelector(".conversation-column").getBoundingClientRect().width <= 860'), true, 'Focus layout limits reading width');
  await screenshot(view, 'rooms-focus-dark');
  await click(view, act('design'));
  await wait(view, 'document.querySelector("#modal").open');
  await click(view, `${id('layout-option')}[value="compact"]`);
  assert.equal(await view.cdp.evaluate('document.documentElement.dataset.layout'), 'compact');
  await click(view, id('modal-close'));
  await wait(view, '!document.querySelector("#modal").open');
  assert.notEqual(await view.cdp.evaluate('getComputedStyle(document.querySelector("#inspector")).display'), 'none', 'Inspector returns outside focus layout');
  await screenshot(view, 'rooms-compact-dark');
  await click(view, act('design'));
  await wait(view, 'document.querySelector("#modal").open');
  await click(view, `${id('layout-option')}[value="balanced"]`);
  await click(view, id('modal-close'));
  await wait(view, '!document.querySelector("#modal").open');
  // 双主题下按实际计算色核对正文与辅助文字对画布的对比度。
  for (const theme of ['dark', 'light']) {
    if ((await state(view)).theme !== theme) await click(view, act('theme'));
    const ratios = await view.cdp.evaluate(`(()=>{
      const probe=document.createElement('span');document.body.append(probe);
      const rgb=value=>{probe.style.color=value;return getComputedStyle(probe).color.match(/[\\d.]+/g).slice(0,3).map(Number);};
      const lum=c=>c.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
      const css=getComputedStyle(document.documentElement),bg=lum(rgb(css.getPropertyValue('--canvas')));
      const out=['--text','--text-muted'].map(key=>{const x=lum(rgb(css.getPropertyValue(key)));return (Math.max(x,bg)+.05)/(Math.min(x,bg)+.05);});
      probe.remove();return out;})()`);
    assert.equal(ratios.every(r => r >= 4.5), true, `${theme} base/muted contrast ${ratios}`);
  }
  await screenshot(view, 'rooms-light-1440');
  // 检查过的尺寸：1440×960、1024×768、820×900、390×844，页面均无横向滚动。
  for (const [width, height] of [[1440, 960], [1024, 768], [820, 900], [390, 844]]) {
    await view.bounds({ x: 0, y: 0, width, height });
    assert.equal(await view.cdp.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, `No page overflow at ${width}`);
    assert.equal(await view.cdp.evaluate('(()=>{const r=document.querySelector("#composer-wrap").getBoundingClientRect();return r.height > 0 && r.bottom <= innerHeight + 1;})()'), true, `Composer visible at ${width}`);
    if (width === 1024) {
      await screenshot(view, 'rooms-light-1024');
      await click(view, act('theme'));
      assert.equal((await state(view)).theme, 'dark');
    }
    if (width === 390) await screenshot(view, 'rooms-dark-390');
  }
  await view.bounds({ x: 0, y: 0, width: 1440, height: 960 });
  await assertClean(f);
});
