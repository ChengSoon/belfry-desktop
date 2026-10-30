import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { uiFixture, click, clickText, press, waitFor, fill, setValue, resize, intact, evidence, capturePanel, imeEnter } from "./production-uiFixture.mjs";

// 房间的合成原生命令单独装：只有这个用例会改写 room_* 一组命令与合成房间存储，
// 其他生产用例连房间视图都不会打开。
const ROOM_NATIVE = await readFile(new URL("./rooms-uiNative.js", import.meta.url), "utf8");
const ROOM = 'button[title="协作房间"]';
const CLOSE_ROOM = 'button[aria-label="关闭协作房间"]';
const COMPOSER = 'textarea[aria-label="房间消息"]';

test("production UI collaboration room dispatch, verify, stop and mutual exclusion", { timeout: 120_000 }, async t => {
  const { view, baseline } = await uiFixture(t, { nativeExtension: ROOM_NATIVE });
  // 命令面板是键盘入口：搜「协作房间」直接打开。
  await click(view, 'button[aria-label="Quick Open"]');
  await waitFor(view, "document.activeElement?.getAttribute('role') === 'combobox'");
  await fill(view, ".quick-open input", "协作房间");
  await press(view, "ArrowDown");
  await press(view, "Home");
  await press(view, "Enter");
  await waitFor(view, "!!document.querySelector('.room-view') && document.querySelector('.room-empty')?.textContent.includes('还没有房间')");
  assert.equal(await view.cdp.evaluate("document.querySelector('.app-shell').classList.contains('is-rooms')"), true);
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.sidebar-shell')).display"), "none");
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.workbench')).display"), "none");
  await evidence(view, "room-empty", [CLOSE_ROOM]);

  await clickText(view, "新建房间", ".room-view");
  await waitFor(view, "!!document.querySelector('.room-dialog input')");
  await fill(view, ".room-dialog input", "发布检查");
  await clickText(view, "创建", ".room-dialog");
  await waitFor(view, "document.querySelector('.room-stream__title strong')?.textContent === '发布检查'");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_create' && call.args.name === '发布检查')"));

  // 独立窗口入口：点「在新窗口打开」把当前房间交给 room_open_window。
  await click(view, 'button[aria-label="在新窗口打开"]');
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_open_window' && call.args.roomName === '发布检查')");

  // 成员走「选 Agent → 创建」：Agent 用应用自己的下拉控件（不是系统 select），
  // 选完真实拉起一条会话，再把它绑定进房间。
  await click(view, 'button[aria-label="添加成员"]');
  await waitFor(view, "!!document.querySelector('.room-dialog [role=\"combobox\"]:not(:disabled)')");
  await click(view, '.room-dialog [role="combobox"]');
  await waitFor(view, "!!document.querySelector('.ui-popover [role=\"listbox\"] .ui-option')");
  await click(view, ".ui-popover .ui-option:not(:disabled)");
  await waitFor(view, "!document.querySelector('.ui-popover [role=\"listbox\"]')");
  await fill(view, '.room-dialog input[placeholder="如 前端 / reviewer"]', "前端");
  await clickText(view, "创建", ".room-dialog");
  await waitFor(view, "document.querySelector('.room-member strong')?.textContent === '前端'");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_add_member' && call.args.role === '前端' && typeof call.args.projectRoot === 'string')"));
  await waitFor(view, `__productionQA.creates >= ${baseline.creates + 1}`);

  // 成员空闲后才能被选中：界面和派活闸门是同一条线。
  await waitFor(view, "[...document.querySelectorAll('.room-recipient')].some(button => button.textContent.includes('前端') && !button.disabled)");
  await setValue(view, COMPOSER, "统一登录失败的错误提示");
  await clickText(view, "前端", ".room-composer");
  await waitFor(view, "document.querySelector('.room-recipient[aria-pressed=true]')?.textContent.includes('前端')");
  await clickText(view, "派发（1）", ".room-composer");
  await waitFor(view, "!!document.querySelector('.room-taskcard')");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_dispatch' && call.args.memberIds.length === 1)"));
  assert.equal(await view.cdp.evaluate("document.querySelector('.room-taskcard .room-chip').textContent"), "排队投递中");
  assert.equal(await view.cdp.evaluate("document.querySelector('.room-aside__section h3 small').textContent"), "1");
  // 任务卡收在一行里：状态、标题、计数、箭头同排，箭头不掉到第二行。
  assert.ok(await view.cdp.evaluate("(() => { const card = document.querySelector('.room-taskcard'); const arrow = card.querySelector(':scope > svg'); return card.getBoundingClientRect().height < 48 && !!arrow && arrow.getBoundingClientRect().width > 0; })()"), "任务卡保持单行，箭头在行内");
  assert.ok(await view.cdp.evaluate("document.querySelectorAll('.room-target__spin').length >= 1"), "还在回复的收件人带转圈");

  // 成员交差后由轮询推进到「已提交待验证」；完成不靠猜。
  await view.cdp.evaluate("__roomsQA.settle()");
  await waitFor(view, "document.querySelector('.room-taskcard .room-chip')?.textContent === '已提交待验证'");
  await evidence(view, "room-submitted", [CLOSE_ROOM, COMPOSER]);

  await click(view, ".room-taskcard");
  await waitFor(view, "!!document.querySelector('.room-dialog') && document.querySelector('.room-delivery .room-chip')?.textContent === '已交差'");
  await waitFor(view, "!!document.querySelector('.room-artifact')");
  await fill(view, ".room-dialog input", "已在合成环境确认");
  await clickText(view, "验证通过", ".room-dialog");
  await waitFor(view, "!document.querySelector('.room-dialog')");
  await waitFor(view, "document.querySelector('.room-taskcard .room-chip')?.textContent === '验证通过'");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_verify_task' && call.args.note === '已在合成环境确认')"));
  assert.equal(await view.cdp.evaluate("document.querySelector('.room-aside__empty')?.textContent"), "没有正在跑的任务");

  await click(view, ".room-message:last-of-type .room-message__mark");
  await waitFor(view, "!!document.querySelector('.room-message__marked') && !!document.querySelector('.room-decision')");

  // 退回重做：验证不通过要带上反馈，并立刻生成跟进派活。
  await setValue(view, COMPOSER, "再补一条回归检查");
  await clickText(view, "前端", ".room-composer");
  await clickText(view, "派发（1）", ".room-composer");
  await waitFor(view, "document.querySelectorAll('.room-taskcard').length === 2");
  await view.cdp.evaluate("__roomsQA.settle()");
  await waitFor(view, "document.querySelectorAll('.room-taskcard .room-chip')[1]?.textContent === '已提交待验证'");
  await clickText(view, "验证", ".room-aside");
  await waitFor(view, "!!document.querySelector('.room-dialog')");
  await fill(view, ".room-dialog input", "网络超时没覆盖");
  await clickText(view, "退回重做", ".room-dialog");
  await waitFor(view, "!document.querySelector('.room-dialog')");
  await waitFor(view, "document.querySelectorAll('.room-taskcard').length === 3");
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.room-taskcard .room-chip')[1]?.textContent"), "已退回重做");
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.room-taskcard .room-chip')[2]?.textContent"), "排队投递中");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_reject_task' && call.args.feedback === '网络超时没覆盖')"));

  // 停止跟进任务：停止要确认，已交差的记录与产物保留。
  await clickText(view, "停止", ".room-aside");
  await waitFor(view, "!!document.querySelector('.modal__danger')");
  await clickText(view, "停止", ".modal__actions");
  await waitFor(view, "!document.querySelector('.modal__danger')");
  await waitFor(view, "document.querySelectorAll('.room-taskcard .room-chip')[2]?.textContent === '已停止'");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_stop_task')"));

  // 收尾全貌：验证通过、退回重做、已停止三种终态同屏，右栏任务列表同步收口。
  await evidence(view, "room-final", [CLOSE_ROOM, COMPOSER]);

  // 讨论搜索：只筛当前房间的时间线；Escape 先清搜索、再关搜索条，不会顺手把房间关了。
  await click(view, 'button[aria-label="搜索讨论"]');
  await fill(view, 'input[aria-label="搜索讨论"]', "网络超时");
  await waitFor(view, "document.querySelectorAll('.room-message').length === 1 && document.querySelectorAll('.room-event').length === 0 && document.querySelector('.room-search__count')?.textContent === '1 条匹配'");
  assert.ok(await view.cdp.evaluate("document.querySelector('.room-message')?.textContent.includes('网络超时没覆盖')"));
  await press(view, "Escape");
  await waitFor(view, "document.querySelector('input[aria-label=\"搜索讨论\"]')?.value === '' && !!document.querySelector('.room-view')");
  await waitFor(view, "document.querySelectorAll('.room-message').length === 3");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('input[aria-label=\"搜索讨论\"]') && !!document.querySelector('.room-view')");

  // 布局变体：专注收起两栏，紧凑收窄三栏，选择记进本地。
  await clickText(view, "专注", ".room-stream__head");
  await waitFor(view, "localStorage.getItem('belfry.rooms.v1.layout') === 'focus' && getComputedStyle(document.querySelector('.room-rail')).display === 'none' && getComputedStyle(document.querySelector('.room-aside')).display === 'none'");
  await clickText(view, "紧凑", ".room-stream__head");
  await waitFor(view, "getComputedStyle(document.querySelector('.room-rail')).display !== 'none' && parseFloat(getComputedStyle(document.querySelector('.room-rail')).width) < 210");
  await clickText(view, "标准", ".room-stream__head");
  await waitFor(view, "parseFloat(getComputedStyle(document.querySelector('.room-rail')).width) >= 210");

  // 右栏拖拽：把「任务与决定」的左缘往左拉宽，宽度入档；双击把手复位回默认。
  // 指针捕获在合成输入下未必生效，所以每一步都重新对准把手中心再挪 2px——
  // 捕获生效时结果一样，没生效时指针也始终落在把手上。
  const handleCenter = () => view.cdp.evaluate(`(() => {
    const el = document.querySelector('.room-view > .panel-resize-handle');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  const dragStart = await handleCenter();
  assert.ok(dragStart && dragStart.width > 0 && dragStart.height > 0, `缺少右栏拖拽把手 ${JSON.stringify(dragStart)}`);
  const hitTarget = await view.cdp.evaluate(`(() => {
    const el = document.elementFromPoint(${dragStart.x}, ${dragStart.y});
    return el ? el.className : null;
  })()`);
  assert.ok(String(hitTarget).includes("panel-resize-handle"), `把手中心应命中把手，实际命中 ${hitTarget}`);
  const asideBefore = await view.cdp.evaluate("parseFloat(getComputedStyle(document.querySelector('.room-aside')).width)");
  await view.send("Input.dispatchMouseEvent", { type: "mousePressed", x: dragStart.x, y: dragStart.y, button: "left", clickCount: 1 });
  for (let step = 0; step < 30; step++) {
    const center = await handleCenter();
    await view.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x - 2, y: center.y, buttons: 1 });
  }
  const dragEnd = await handleCenter();
  await view.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragEnd.x, y: dragEnd.y, button: "left", clickCount: 1 });
  await waitFor(view, `parseFloat(getComputedStyle(document.querySelector('.room-aside')).width) >= ${asideBefore + 40}`);
  const asideAfter = await view.cdp.evaluate("parseFloat(getComputedStyle(document.querySelector('.room-aside')).width)");
  assert.equal(await view.cdp.evaluate("Number(localStorage.getItem('belfry.rooms.v1.aside-width'))"), Math.round(asideAfter), "拖动后的宽度记进本地");
  // 双击复位：第二下带 clickCount=2 才会合成 dblclick。
  const resetPoint = await handleCenter();
  for (const clickCount of [1, 2]) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await view.send("Input.dispatchMouseEvent", { type, x: resetPoint.x, y: resetPoint.y, button: "left", clickCount });
    }
  }
  await waitFor(view, "Math.abs(parseFloat(getComputedStyle(document.querySelector('.room-aside')).width) - 300) <= 1");
  assert.equal(await view.cdp.evaluate("Number(localStorage.getItem('belfry.rooms.v1.aside-width'))"), 300, "双击复位后宽度入档");

  // 单成员重派：一条投递结果未知时，只把它补投回去，其他人一个字不动。
  await setValue(view, COMPOSER, "把回归脚本也补上");
  await clickText(view, "前端", ".room-composer");
  await clickText(view, "派发（1）", ".room-composer");
  await waitFor(view, "document.querySelectorAll('.room-taskcard').length === 4");
  await view.cdp.evaluate("__roomsQA.markUnknown()");
  await waitFor(view, "document.querySelectorAll('.room-taskcard .room-chip')[3]?.textContent === '结果未知'");
  assert.equal(await view.cdp.evaluate("[...document.querySelectorAll('.room-message')].find(el => el.textContent.includes('把回归脚本也补上'))?.querySelectorAll('.room-target--gone').length"), 1, "结果未知的收件人标签有独立标识");
  await clickText(view, "把回归脚本也补上", ".room-stream");
  await waitFor(view, "!!document.querySelector('.room-dialog')");
  await clickText(view, "重派", ".room-dialog");
  await waitFor(view, "document.querySelector('.room-dialog .room-delivery .room-chip')?.textContent === '排队等对方空闲'");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_retry_task' && call.args.memberIds?.length === 1)"));
  await clickText(view, "关闭", ".room-dialog");
  await waitFor(view, "!document.querySelector('.room-dialog')");

  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-view')");
  assert.equal(await view.cdp.evaluate("document.querySelector('.app-shell').classList.contains('is-rooms')"), false);
  await click(view, 'button[title^="额度用量"]');
  await waitFor(view, "!!document.querySelector('.usage-head')");
  await click(view, ROOM);
  await waitFor(view, "!!document.querySelector('.room-view')");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.usage-head')"), false, "打开房间会收起用量");

  await resize(view, 1024, 768);
  await evidence(view, "room-compact-1024", [CLOSE_ROOM, COMPOSER]);
  await resize(view, 1440, 960);
  await click(view, CLOSE_ROOM);
  await waitFor(view, "!document.querySelector('.room-view') && getComputedStyle(document.querySelector('.workbench')).display !== 'none'");

  // 待验证提醒：房间关着时，新交差的任务要发系统通知（标题带房间名、正文带任务名）。
  await view.cdp.evaluate("__roomsQA.settle()");
  await waitFor(view, "(__productionQA.notifications ?? []).some(entry => JSON.stringify(entry).includes('把回归脚本也补上'))");

  // 回执里的文件路径可以直接打开预览：房间让位给预览面板。
  await click(view, ROOM);
  await waitFor(view, "!!document.querySelector('.room-view')");
  await click(view, ".room-taskcard");
  await waitFor(view, "!!document.querySelector('.room-dialog') && !!document.querySelector('.room-filelink')");
  await clickText(view, "复制记录", ".room-dialog");
  await waitFor(view, "(__productionQA.clipboard ?? []).some(text => text.includes('房间：发布检查') && text.includes('已交差') && text.includes('证据：') && text.includes('验证备注：已在合成环境确认'))");
  await click(view, ".room-filelink");
  await waitFor(view, "!document.querySelector('.room-view')");
  await waitFor(view, "!!document.querySelector('.file-preview__content') && document.querySelector('.file-preview__content').textContent.includes('syntheticGraphite')");

  // 房间模板：选「实现 + 审查」自动填名并预览班子，创建即拉起两条成员会话。
  await click(view, 'button[title="关闭文件预览"]');
  await waitFor(view, "!document.querySelector('.file-preview__content')");
  await click(view, ROOM);
  await waitFor(view, "!!document.querySelector('.room-view')");
  await click(view, 'button[aria-label="新建房间"]');
  await waitFor(view, "!!document.querySelector('.room-dialog')");
  await clickText(view, "实现 + 审查", ".room-dialog");
  await waitFor(view, "document.querySelector('.room-dialog input')?.value === '实现 + 审查' && document.querySelectorAll('.room-roster li').length === 2");
  // 对话框输入同一个守卫：选词回车不得把房间建出去，对话框原地留着。
  await imeEnter(view, ".room-dialog input");
  assert.ok(await view.cdp.evaluate("!!document.querySelector('.room-dialog') && !__productionQA.calls.some(call => call.command === 'room_create' && call.args.name === '实现 + 审查')"), "选词回车不得提交对话框");
  await clickText(view, "创建", ".room-dialog");
  await waitFor(view, "document.querySelector('.room-stream__title strong')?.textContent === '实现 + 审查'");
  await waitFor(view, "[...document.querySelectorAll('.room-member strong')].filter(el => ['实现', '审查'].includes(el.textContent)).length === 2");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_create' && call.args.name === '实现 + 审查')"));
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_add_member' && ['实现', '审查'].includes(call.args.role)).length"), 2);
  // 成员会话是在房间打开时创建的，工作台此刻被 display:none 藏着。若照着这个没被布局的
  // 宿主去算终端尺寸，上报的就是 10x4 这种退化值：成员 Agent 的状态行无处可画，左侧
  // 成员行的活动判定永远读到「空闲」，而它其实还在干活。尺寸必须可用。
  const memberSizes = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'terminal_create').map(call => ({ tabId: call.args.request.tabId, cols: call.args.request.cols, rows: call.args.request.rows }))");
  assert.ok(memberSizes.every((size) => size.cols >= 40 && size.rows >= 10), `会话不得以退化尺寸创建：${JSON.stringify(memberSizes)}`);

  // 群聊语义：不选接收者直接发送＝一条群聊消息——不派活、不生成任务卡。
  await setValue(view, COMPOSER, "大家同步一下，今天定接口");
  await clickText(view, "发到群聊", ".room-composer");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_broadcast' && call.args.text === '大家同步一下，今天定接口')");
  await waitFor(view, "document.querySelector('.room-message--self .room-message__bubble')?.textContent.includes('大家同步一下，今天定接口')");
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.room-taskcard').length"), 0, "群聊消息不生成任务卡");
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-delivery-note')].some(el => el.textContent.includes('发给了') && el.textContent.includes('实现') && el.textContent.includes('审查'))"), "群聊消息标出送达对象");
  // 送达回执：真实实现里由对账把「进过谁的终端」写回消息；夹具直接模拟那一下。
  await view.cdp.evaluate("__roomsQA.delivered()");
  await waitFor(view, "[...document.querySelectorAll('.room-delivery-note')].some(el => el.textContent.includes('已送达') && el.textContent.includes('实现') && el.textContent.includes('审查'))");
  assert.ok(await view.cdp.evaluate("document.querySelectorAll('.room-day').length >= 1"), "时间线带日期分隔");

  // 输入法选词回车（用户报告「打字回车触发系统的回车事件」）：macOS WKWebView 上按回车
  // 确认候选词时 compositionend 先于 keydown，isComposing 已是 false，只剩 keyCode 229
  // 能认（WebKit bug 165004）。照真实形状派发这一下：消息不得发出、草稿原样保留。
  await setValue(view, COMPOSER, "选词的回车不该发出去");
  await imeEnter(view, COMPOSER);
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => /^room_(broadcast|send_message|dispatch)$/.test(call.command) && JSON.stringify(call.args).includes('选词的回车不该发出去')).length"), 0, "选词回车不得发送");
  assert.equal(await view.cdp.evaluate("document.querySelector('" + COMPOSER + "').value"), "选词的回车不该发出去", "选词回车后草稿原样保留");
  // 同一条草稿的真回车（keyCode 13）照常发送——守卫只挡输入法那一下。
  await press(view, "Enter");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_broadcast' && call.args.text === '选词的回车不该发出去')");
  await waitFor(view, "[...document.querySelectorAll('.room-message--self')].some(el => el.textContent.includes('选词的回车不该发出去'))");

  // @ 补全（修订十一）：打 @ 弹出点名单（与后端点名同一把尺），过滤、回车选中；
  // 这一下回车只选人、不发送；Escape 只收名单、不关房间。
  await setValue(view, COMPOSER, "@");
  await waitFor(view, "document.querySelectorAll('.room-mention [role=option]').length === 2");
  await setValue(view, COMPOSER, "看下 @审");
  await waitFor(view, "document.querySelectorAll('.room-mention [role=option]').length === 1 && document.querySelector('.room-mention [role=option]').textContent.includes('审查')");
  await press(view, "Enter");
  await waitFor(view, `document.querySelector(${JSON.stringify(COMPOSER)}).value === '看下 @审查 '`);
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => (call.command === 'room_broadcast' || call.command === 'room_send_message') && String(call.args.text ?? '').startsWith('看下 @审查')).length"), 0, "选中成员不该把消息发出去");
  await setValue(view, COMPOSER, "写点 @实");
  await waitFor(view, "!!document.querySelector('.room-mention')");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-mention') && !!document.querySelector('.room-view')");
  await setValue(view, COMPOSER, "看下 @审查 命名吧");
  // 点名收窄：发送按钮直接显示真实投递对象（不再是「发到群聊」）。
  await clickText(view, "发给 审查", ".room-composer");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_broadcast' && call.args.text === '看下 @审查 命名吧')");
  await waitFor(view, "[...document.querySelectorAll('.room-message--self')].some(el => el.textContent.includes('看下 @审查 命名吧'))");
  assert.ok(await view.cdp.evaluate("(() => { const el = [...document.querySelectorAll('.room-message--self')].find(el => el.textContent.includes('看下 @审查 命名吧')); const note = el?.querySelector('.room-delivery-note'); return !!note && note.textContent.includes('发给了 审查') && !note.textContent.includes('实现'); })()"), "点名收窄：送达注记只写被点的人");

  // 现场感：成员刷一帧「生成中」，时间线出现「正在回复…」。
  await view.cdp.evaluate("__roomsQA.busy('实现')");
  await waitFor(view, "!!document.querySelector('.room-typing') && document.querySelector('.room-typing').textContent.includes('实现') && document.querySelector('.room-typing').textContent.includes('正在回复')");
  // 收掉这一帧：回到空闲，后面的「清除上下文」才有 Prompt 队列投递窗口
  //（忙会话的命令会一直排队等空闲，合成环境里它自己不会停）。
  await view.cdp.evaluate("__roomsQA.idle('实现')");
  await waitFor(view, "[...document.querySelectorAll('.room-member')].some(el => el.textContent.includes('实现') && el.textContent.includes('空闲'))");

  // 房间群聊：成员说的话按角色名出现在时间线里，点名带出收件人标签。
  // 先把时间线垫到真正可滚动：之前内容太少，「翻历史」其实是空翻——scrollTop 恒为 0，
  // 下面的滚动断言全在打空靶（浮标也就没有存在的余地）。垫满后断言才有实际含义。
  const chatter = [
    ["实现", "早，接口草稿快好了"],
    ["审查", "好，我先把命名规范过一遍"],
    ["实现", "分页那块我再确认下边界"],
    ["审查", "边界我列了几个 case 发你"],
    ["实现", "收到，午前给你回"],
    ["审查", "测试我下午补上"],
    ["实现", "行，我先把 mock 换成真接口"],
    ["审查", "换完喊我一声"],
    ["实现", "这就换，顺便把日志补上"],
    ["审查", "日志级别按上次说的来"],
    ["实现", "嗯，debug 只在本地开"],
    ["审查", "可以，先这样"],
  ];
  for (const [role, text] of chatter) await view.cdp.evaluate(`__roomsQA.say(${JSON.stringify(role)}, ${JSON.stringify(text)}, [])`);
  await waitFor(view, "document.querySelectorAll('.room-message--member').length >= 12");
  const scrollable = await view.cdp.evaluate("(() => { const el = document.querySelector('.room-timeline'); return el.scrollHeight - el.clientHeight; })()");
  assert.ok(scrollable > 100, `时间线要先垫到可滚动，「翻历史」断言才不是空靶：${scrollable}`);
  // 翻回最早一段：此时新回话不该把人拽回底部；回到底部后再收一条，应该自动跟随。
  await view.cdp.evaluate("(() => { document.querySelector('.room-timeline').scrollTop = 0; })()");
  await view.cdp.evaluate("__roomsQA.say('实现', '@审查 我把接口草稿推上去了，你看下', ['审查'])");
  // 等这条新消息本身：前面的连发里也有「接口草稿」，只按它等会被旧消息提前满足。
  await waitFor(view, "[...document.querySelectorAll('.room-message--member .room-message__bubble')].some(el => el.textContent.includes('我把接口草稿推上去了'))");
  // @ 点名在气泡里高亮成芯片：读对话时一眼看清在叫谁（修订十六）。
  assert.ok(await view.cdp.evaluate("(() => { const el = [...document.querySelectorAll('.room-message__bubble .room-mention-chip')]; return el.some(chip => chip.textContent === '@审查'); })()"), "@点名在气泡里画成芯片");
  const chipText = await view.cdp.evaluate("(() => { const bubble = [...document.querySelectorAll('.room-message--member .room-message__bubble')].find(el => el.textContent.includes('@审查')); return bubble ? bubble.textContent : null; })()");
  assert.ok(typeof chipText === 'string' && chipText.includes('@审查') && chipText.includes('接口草稿推上去了'), `高亮后正文完整可读（芯片不吞字），实际：${JSON.stringify(chipText)}`);
  assert.ok(await view.cdp.evaluate("document.querySelector('.room-timeline').scrollTop <= 2"), "翻着历史时新回话不拽回底部");
  // 「回到底部」浮标（修订十二）：翻历史时新消息攒条数，点一下回到最新、浮标收起。
  await waitFor(view, "!!document.querySelector('.room-jump__button')");
  assert.ok(await view.cdp.evaluate("document.querySelector('.room-jump__button')?.textContent.includes('1 条新消息')"), "浮标带新消息条数");
  await click(view, ".room-jump__button");
  await waitFor(view, "(() => { const el = document.querySelector('.room-timeline'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 2 && !document.querySelector('.room-jump__button'); })()");
  // 发出去的消息要看得见：翻到最老再发送，视野自动回到底部（发完落在自己那条上）。
  await view.cdp.evaluate("(() => { document.querySelector('.room-timeline').scrollTop = 0; })()");
  await setValue(view, COMPOSER, "自己发的也要看得到");
  await clickText(view, "发到群聊", ".room-composer");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_broadcast' && call.args.text === '自己发的也要看得到')");
  await waitFor(view, "(() => { const el = document.querySelector('.room-timeline'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 2 && !document.querySelector('.room-jump__button'); })()");
  await view.cdp.evaluate("__roomsQA.say('审查', '命名我调了一版，你再看一眼', [])");
  await waitFor(view, "[...document.querySelectorAll('.room-message--member')].some(el => el.textContent.includes('命名我调了一版'))");
  await waitFor(view, "(() => { const el = document.querySelector('.room-timeline'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 2; })()");
  // 同一位成员的连发合并成一段：第二条不再重复头像与名字。
  await view.cdp.evaluate("__roomsQA.say('审查', '顺手把测试也补了', [])");
  await waitFor(view, "[...document.querySelectorAll('.room-message--member')].some(el => el.textContent.includes('顺手把测试也补了'))");
  assert.ok(await view.cdp.evaluate("document.querySelectorAll('.room-message--continued').length >= 1"), "两分钟内的连发合并");
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-message--member .room-target')].some(el => el.textContent.includes('审查'))"));
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-message--member .room-avatar')].some(el => el.textContent === '实')"), "成员消息带角色首字头像");
  assert.ok(await view.cdp.evaluate("document.querySelector('.room-message--member .room-message__bubble')?.textContent.includes('接口草稿')"), "正文收在气泡里");
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.room-message--self')).flexDirection"), "row-reverse", "自己的消息靠右");
  assert.ok(await view.cdp.evaluate("document.querySelector('.room-message--member .room-avatar')?.getAttribute('style')?.includes('--avatar-hue')"), "成员头像按作者着色");
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-message time')].every(el => (el.getAttribute('title') ?? '').includes('月') || (el.getAttribute('title') ?? '').startsWith('今天') || (el.getAttribute('title') ?? '').startsWith('昨天'))"), "时间悬停给出完整日期");
  // 聊天里出现的文件路径同样可点：拿房间项目根发一条带绝对路径的消息，
  // 气泡里应渲染出可打开的链接（复用任务回执那一套解析与打开路径）。
  await view.cdp.evaluate("__roomsQA.say('实现', '改动在 ' + __roomsQA.rooms[0].projectRoot + '/src/login.ts，你们看看', [])");
  await waitFor(view, "[...document.querySelectorAll('.room-message__bubble .room-filelink')].some(el => el.textContent.includes('src/login.ts'))");

  // 成员的引用回复：`room say --reply` 回话后，气泡上渲染引用块（与用户侧共用同一套渲染）。
  const quoteSourceId = await view.cdp.evaluate("(() => { for (const room of __roomsQA.rooms) { const found = room.messages.find(m => m.text.includes('接口草稿')); if (found) return found.id; } return null; })()");
  assert.ok(quoteSourceId, "应有可引用的消息");
  await view.cdp.evaluate(`__roomsQA.say('审查', '按这个说法改了一版', [], ${JSON.stringify(quoteSourceId)})`);
  await waitFor(view, "[...document.querySelectorAll('.room-message--member')].some(el => el.textContent.includes('按这个说法改了一版') && el.querySelector('.room-quote')?.textContent.includes('接口草稿'))");

  // 表情回应：悬停出现快捷回应，点 👍 后气泡下出现芯片（计数与自己高亮），再点芯片取消。
  await view.cdp.evaluate("(() => { const el = [...document.querySelectorAll('.room-message')].find(el => el.textContent.includes('按这个说法改了一版')); el?.querySelector('button[aria-label=\"回应 👍\"]')?.click(); })()");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_react' && call.args.emoji === '👍')");
  await waitFor(view, "[...document.querySelectorAll('.room-message')].some(el => el.textContent.includes('按这个说法改了一版') && el.querySelector('.room-reaction')?.textContent.includes('1'))");
  assert.ok(await view.cdp.evaluate("!!document.querySelector('.room-reaction--mine')"), "自己点的回应要高亮");
  await view.cdp.evaluate("(() => { const chip = [...document.querySelectorAll('.room-message')].find(el => el.textContent.includes('按这个说法改了一版'))?.querySelector('.room-reaction'); chip?.click(); })()");
  await waitFor(view, "![...document.querySelectorAll('.room-message')].some(el => el.textContent.includes('按这个说法改了一版') && el.querySelector('.room-reaction'))");

  // 引用回复：对某条消息点「回复这条」，输入区出现回复横幅；发出后气泡带引用块，
  // 点引用块能跳回原消息；横幅随发送清掉。
  await view.cdp.evaluate("[...document.querySelectorAll('.room-message')].find(el => el.textContent.includes('接口草稿'))?.querySelector('.room-message__reply')?.click()");
  await waitFor(view, "!!document.querySelector('.room-reply-banner') && document.querySelector('.room-reply-banner').textContent.includes('接口草稿')");
  await setValue(view, COMPOSER, "收到，我这边同步一下");
  await clickText(view, "发到群聊", ".room-composer");
  await waitFor(view, "!document.querySelector('.room-reply-banner')");
  await waitFor(view, "[...document.querySelectorAll('.room-message--self')].some(el => el.textContent.includes('收到，我这边同步一下') && el.querySelector('.room-quote')?.textContent.includes('接口草稿'))");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_broadcast' && call.args.replyTo)"), "引用随消息送达后端");

  // 撤回自己刚发的消息：确认后时间线标记已撤回、正文不再显示、撤回按钮消失。
  await view.cdp.evaluate("[...document.querySelectorAll('.room-message--self')].find(el => el.textContent.includes('收到，我这边同步一下'))?.querySelector('.room-message__recall')?.click()");
  await waitFor(view, "document.querySelector('.modal__title')?.textContent.includes('撤回这条消息')");
  await clickText(view, "撤回", ".modal__actions");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_recall')");
  await waitFor(view, "[...document.querySelectorAll('.room-message--self')].some(el => el.querySelector('.room-message__bubble--recalled'))");
  assert.ok(await view.cdp.evaluate("(() => { const el = [...document.querySelectorAll('.room-message--self')].find(el => el.querySelector('.room-message__bubble--recalled')); return !!el && el.textContent.includes('已撤回') && !el.textContent.includes('收到，我这边同步一下') && !el.querySelector('.room-message__recall'); })()"), "撤回后：正文隐藏、标已撤回、撤回按钮消失");

  // 隔离：房间成员会话不在侧栏露面；关掉房间时名单立即刷新，普通会话照常列出。
  const memberTabIds = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_add_member' && ['前端', '实现', '审查'].includes(call.args.role)).map(call => call.args.tabId)");
  assert.equal(memberTabIds.length, 3, "三条成员会话都应该建出来了");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-view') && getComputedStyle(document.querySelector('.sidebar-shell')).display !== 'none'");
  await waitFor(view, `(() => { const ids = ${JSON.stringify(memberTabIds)}; return ids.every(id => !document.querySelector('.session-row[data-tab-id="' + id + '"]')); })()`);
  assert.ok(await view.cdp.evaluate("document.querySelectorAll('.session-row').length >= 1"), "普通会话照常列出");

  await intact(view, baseline, 3);

  // 未读分隔线：关着房间时成员说了话，重进时落在第一条未读上（分隔线在视口里），
  // 画在新消息之前；点掉之前已读位不推进，点掉即视为读到最新。
  await view.cdp.evaluate("__roomsQA.say('实现', '我不在的时候补了一句', [])");
  await click(view, ROOM);
  await waitFor(view, "!!document.querySelector('.room-view')");
  await waitFor(view, "!!document.querySelector('.room-unread')");
  // 分隔线要落在视口里，且时间线确实滚到了未读位置（分隔线之后只有一条新消息时，
  // 滚动最多只能把它顶到视口下半部——内容不够再往上顶，这是正确行为）。
  const dividerState = await view.cdp.evaluate(`(() => {
    const el = document.querySelector('.room-unread');
    const r = el.getBoundingClientRect();
    const tl = document.querySelector('.room-timeline');
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight, scrollTop: Math.round(tl.scrollTop) };
  })()`);
  assert.ok(dividerState.top < dividerState.height && dividerState.bottom > 0, `分隔线应落在视口内：${JSON.stringify(dividerState)}`);
  assert.ok(dividerState.scrollTop > 0, `应滚向未读位置而不是停在时间线顶部：${JSON.stringify(dividerState)}`);
  assert.ok(await view.cdp.evaluate(`(() => {
    const divider = document.querySelector('.room-unread');
    const target = [...document.querySelectorAll('.room-message')].find(el => el.textContent.includes('我不在的时候补了一句'));
    if (!divider || !target) return false;
    return !!(divider.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`), "分隔线画在新消息之前");
  const seenState = await view.cdp.evaluate(`(() => {
    const room = __roomsQA.rooms.find(r => r.messages.some(m => m.text.includes('我不在的时候补了一句')));
    const target = room.messages.find(m => m.text.includes('我不在的时候补了一句'));
    const latest = room.messages[room.messages.length - 1];
    return { seen: Number(localStorage.getItem('belfry.rooms.v1.seen.' + room.id)), target: target.at, latest: latest.at };
  })()`);
  assert.ok(seenState.seen < seenState.target, "点掉之前已读位不推进（否则下次分隔线会莫名消失）");
  await click(view, ".room-unread");
  await waitFor(view, "!document.querySelector('.room-unread')");
  const seenAfter = await view.cdp.evaluate(`(() => {
    const room = __roomsQA.rooms.find(r => r.messages.some(m => m.text.includes('我不在的时候补了一句')));
    return Number(localStorage.getItem('belfry.rooms.v1.seen.' + room.id));
  })()`);
  assert.ok(seenAfter >= seenState.latest, "点掉分隔线即视为读到最新");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-view')");

  // 房间列表未读标记（修订九）：不在房间时成员说了话，列表条目亮未读点；
  // 进房读到（点掉分隔线）后熄灭——徽标与分隔线与每房间本地的已读位同源。
  await view.cdp.evaluate("__roomsQA.say('实现', '列表未读点：这句是我不在时说的', [])");

  // 房间内关闭成员会话：结束进程并移出房间（隔离之后，这里是唯一的关闭入口）。
  await click(view, ROOM);
  await waitFor(view, "!!document.querySelector('.room-view')");
  await waitFor(view, "!!document.querySelector('.room-list__item.has-unread')");
  const badge = await view.cdp.evaluate("(() => { const lit = [...document.querySelectorAll('.room-list__item.has-unread')]; return { count: lit.length, text: lit.at(0)?.textContent ?? '' }; })()");
  assert.equal(badge.count, 1, `应只有刚说话的这间房亮未读：${JSON.stringify(badge)}`);
  assert.ok(badge.text.includes('实现 + 审查') && badge.text.includes('有新消息') && badge.text.includes('刚刚'), `未读点落在说话的那间房，带无障碍文本与最近活动时间：${JSON.stringify(badge)}`);
  assert.ok(await view.cdp.evaluate("document.querySelector('.room-list__item')?.textContent.includes('实现 + 审查')"), "最近有动静的房间排最前");
  await clickText(view, "实现 + 审查", ".room-list");
  await waitFor(view, "document.querySelector('.room-stream__title strong')?.textContent === '实现 + 审查'");
  // 进房落在未读处；点掉分隔线＝读到最新，列表未读点同步熄灭。
  await waitFor(view, "!!document.querySelector('.room-unread')");
  assert.ok(await view.cdp.evaluate("document.querySelector('.room-unread')?.textContent.includes('1 条新消息')"), "分隔线带新消息条数");
  await click(view, ".room-unread");
  await waitFor(view, "!document.querySelector('.room-unread') && !document.querySelector('.room-list__item.has-unread')");
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-member')].some(el => el.textContent.includes('审查') && el.textContent.includes('codex'))"), "成员副行显示在场状态与 Agent 类型");
  // 左栏可读性：用户报「开发工程师」被截成「开发…」、「空闲 · claude」被截断。
  // 用真实渲染宽度量常见长角色名与副行：不溢出即不截断。
  assert.ok(await view.cdp.evaluate(`(() => {
    const probe = (el, text) => {
      const original = el.textContent;
      el.textContent = text;
      const fits = el.scrollWidth <= el.clientWidth;
      el.textContent = original;
      return fits;
    };
    const roles = [...document.querySelectorAll('.room-member strong')];
    const notes = [...document.querySelectorAll('.room-member small')];
    return roles.length > 0 && notes.length > 0
      && roles.every((el) => probe(el, '后端开发工程师'))
      && notes.every((el) => probe(el, '空闲 · claude'));
  })()`), "左栏长角色名与在场副行不得截断");
  // 看终端与切换：先看「实现」，不收起直接点「审查」换过去——终端整块重挂，
  // 接驳身份跟着新标签走。带着上一位的会话号去接新成员，守护进程会整条拒绝
  // （「后台任务的项目或类型已改变」），这条路径曾经就这么坏过。
  const implTabId = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_add_member' && call.args.role === '实现').at(-1)?.args.tabId");
  const reviewTabId = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_add_member' && call.args.role === '审查').at(-1)?.args.tabId");
  await click(view, 'button[aria-label="查看 实现 的终端"]');
  await waitFor(view, "!!document.querySelector('section.room-watch[aria-label=\"实现 的终端\"] .terminal-canvas')");
  const createsBeforeSwitch = await view.cdp.evaluate("__productionQA.creates");
  await click(view, 'button[aria-label="查看 审查 的终端"]');
  await waitFor(view, "!!document.querySelector('section.room-watch[aria-label=\"审查 的终端\"] .terminal-canvas')");
  assert.equal(await view.cdp.evaluate("__productionQA.creates"), createsBeforeSwitch + 1, "换成员整块重挂终端视图");
  const switched = await view.cdp.evaluate("(() => { const last = __productionQA.calls.filter(call => call.command === 'terminal_create').at(-1); return { tabId: last?.args?.request?.tabId ?? null, attachment: last?.args?.attachment ?? null }; })()");
  assert.equal(switched.tabId, reviewTabId, "切换后接的是新成员自己的会话");
  assert.ok(switched.attachment === null || !String(switched.attachment).includes(implTabId), "接驳身份不带上一位成员的会话号");
  await click(view, 'button[aria-label="收起终端"]');
  await waitFor(view, "!document.querySelector('.room-watch')");

  // 清除上下文：把该 Agent 自己的重置命令经同一条 Prompt 队列送进它的终端
  //（审查是 codex → /new，实现是 claude → /clear）。进程与会话不动，成员也不离房。
  await click(view, 'button[aria-label="清除 审查 的上下文"]');
  await waitFor(view, "document.querySelector('.modal__title')?.textContent.includes('清除 审查 的上下文')");
  await clickText(view, "清除", ".modal__actions");
  await waitFor(view, `__productionQA.writes.some(call => new TextDecoder().decode(new Uint8Array(call.bytes)).includes('/new'))`);
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-member strong')].some(el => el.textContent === '审查')"), "清除上下文不移出成员");
  await click(view, 'button[aria-label="清除 实现 的上下文"]');
  await waitFor(view, "document.querySelector('.modal__title')?.textContent.includes('清除 实现 的上下文')");
  // 确认框留一张生产像素证据：框里写明要发出的命令（悬停才现身的按钮本身不入画）。
  await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(resolve => setTimeout(resolve, 240)))");
  await capturePanel(view, "production-ui-room-clear-context");
  await clickText(view, "清除", ".modal__actions");
  await waitFor(view, `__productionQA.writes.some(call => new TextDecoder().decode(new Uint8Array(call.bytes)).includes('/clear'))`);
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => /^terminal_close/.test(call.command)).length"), 0, "清除上下文不关会话");

  await click(view, 'button[aria-label="关闭 审查 的会话"]');
  await waitFor(view, "!!document.querySelector('.modal__actions')");
  await clickText(view, "关闭", ".modal__actions");
  await waitFor(view, "__productionQA.calls.some(call => /^terminal_close/.test(call.command))");
  await waitFor(view, "[...document.querySelectorAll('.room-member strong')].every(el => el.textContent !== '审查')");
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'room_remove_member')"));
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-view')");

  // 看成员的终端：点成员行，终端嵌进房间右栏，讨论留在原地看着它干活；
  // 收起后右栏让回给「任务与决定」，全程不离开房间。
  // 重新打开房间应回到刚才那间（记住选择），所以「实现」那一行一定在。
  await click(view, ROOM);
  await waitFor(view, "!!document.querySelector('.room-view')");
  // 房间数据是异步取回的：先等标题落定，再等成员行按钮出现（裸 click 不轮询等待）。
  await waitFor(view, "document.querySelector('.room-stream__title strong')?.textContent === '实现 + 审查'");
  // 重开这间房：时间线应落在最新一条（数据回来后才滚动，所以用 waitFor 等收口）。
  await waitFor(view, "(() => { const el = document.querySelector('.room-timeline'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 2; })()");
  await waitFor(view, '!!document.querySelector(\'button[aria-label="查看 实现 的终端"]\')');
  const watchTabOf = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_add_member' && call.args.role === '实现').at(-1)?.args.tabId");
  const watchCreatesBefore = await view.cdp.evaluate("__productionQA.creates");
  await click(view, 'button[aria-label="查看 实现 的终端"]');
  await waitFor(view, "!!document.querySelector('.room-watch .terminal-canvas')");
  assert.equal(await view.cdp.evaluate("__productionQA.creates"), watchCreatesBefore + 1, "看终端只为成员会话挂一条新视图");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'terminal_create').at(-1)?.args.request?.tabId"), watchTabOf, "看终端接的是成员那条会话");
  assert.equal(await view.cdp.evaluate("document.querySelector('.app-shell').classList.contains('is-rooms') && getComputedStyle(document.querySelector('.workbench')).display === 'none' && getComputedStyle(document.querySelector('.room-rail')).display !== 'none'"), true, "看终端不离开房间，讨论还在旁边");
  // 同一条会话两路并存：看终端打开时，工作台那一路的输出不能断。
  // 驱动成员刷一帧「生成中」——左侧成员行读的正是工作台那一路的活动判定，
  // 要是被看终端顶掉，它就会冻在「空闲」而右边明明在动（这次报的 bug）。
  await view.cdp.evaluate("__roomsQA.busy('实现')");
  await waitFor(view, "[...document.querySelectorAll('.room-member')].some(el => el.textContent.includes('实现') && el.textContent.includes('正忙'))");
  await click(view, 'button[aria-label="收起终端"]');
  await waitFor(view, "!document.querySelector('.room-watch') && !!document.querySelector('.room-aside')");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-view')");

  // 房间级操作：切回「发布检查」房——它有完整的终态任务（验证通过 / 已退回 / 已停止），
  // 清空聊天记录后正好验证右栏「已结束」区的可达性。
  await click(view, ROOM);
  await waitFor(view, "!!document.querySelector('.room-view')");
  await clickText(view, "发布检查", ".room-list");
  await waitFor(view, "document.querySelector('.room-stream__title strong')?.textContent === '发布检查'");

  // 一键清除所有成员上下文：每位成员各收到自己的重置命令（前端是 claude → /clear）。
  const clearsBefore = await view.cdp.evaluate("__productionQA.writes.filter(call => new TextDecoder().decode(new Uint8Array(call.bytes)).includes('/clear')).length");
  await click(view, 'button[aria-label="清除所有成员的上下文"]');
  await waitFor(view, "document.querySelector('.modal__title')?.textContent.includes('清除所有成员的上下文')");
  await clickText(view, "清除", ".modal__actions");
  await waitFor(view, `__productionQA.writes.filter(call => new TextDecoder().decode(new Uint8Array(call.bytes)).includes('/clear')).length >= ${clearsBefore + 1}`);
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-member strong')].some(el => el.textContent === '前端')"), "一键清除不移出成员");

  // 清空聊天记录：时间线归空并出现空态；任务、决定与投递记录保留——
  // 右栏「已结束」区仍能打开终态任务详情（否则清空等于把历史任务变得不可达）。
  assert.ok(await view.cdp.evaluate("document.querySelectorAll('.room-message, .room-event').length > 0"), "清空前时间线应有内容");
  await click(view, 'button[aria-label="清空聊天记录"]');
  await waitFor(view, "document.querySelector('.modal__title')?.textContent.includes('聊天记录')");
  await clickText(view, "清空", ".modal__actions");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'room_clear_messages')");
  await waitFor(view, "document.querySelectorAll('.room-message').length === 0 && document.querySelectorAll('.room-event').length === 0 && !!document.querySelector('.room-timeline__empty')");
  assert.ok(await view.cdp.evaluate("document.querySelectorAll('.room-decision').length >= 1"), "决定保留");
  assert.ok(await view.cdp.evaluate("[...document.querySelectorAll('.room-finished')].some(el => el.textContent.includes('统一登录失败的错误提示') && el.textContent.includes('验证通过'))"), "已结束区仍列出终态任务");
  await clickText(view, "统一登录失败的错误提示", ".room-aside");
  await waitFor(view, "document.querySelector('.room-dialog')?.textContent.includes('复制记录')");
  await clickText(view, "关闭", ".room-dialog");
  await waitFor(view, "!document.querySelector('.room-dialog')");
  await evidence(view, "room-cleared", [CLOSE_ROOM, COMPOSER]);
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.room-view')");

  // 房间独立窗口：带 ?room= 启动只画那一间房，没有工作台外壳；
  // 成员在场状态从协作名册还原；加成员留在主窗口。
  const standaloneUrl = await view.cdp.evaluate("(() => { const room = __roomsQA.rooms[0]; return `${location.href.split(/[?#]/)[0]}?room=${room.id}`; })()");
  await view.send("Page.navigate", { url: standaloneUrl });
  await waitFor(view, "!!document.querySelector('.room-view') && !document.querySelector('.app-shell')");
  await waitFor(view, "document.querySelector('.room-stream__title strong')?.textContent === '发布检查'");
  await waitFor(view, "[...document.querySelectorAll('.room-member')].some(el => el.textContent.includes('前端') && el.textContent.includes('空闲'))");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('button[aria-label^=\"清除\"]')"), false, "独立窗口不提供清除上下文：那里没有终端投递队列");
  // 独立窗口里看终端：名册切片没有接驳字段，靠后端按标签回查同一条会话，照样留在房里看。
  const frontendTabId = memberTabIds[0];
  await click(view, 'button[aria-label="查看 前端 的终端"]');
  await waitFor(view, "!!document.querySelector('.room-watch .terminal-canvas')");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'terminal_create').at(-1)?.args.request?.tabId"), frontendTabId, "独立窗口看终端接的是成员那条会话");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.room-watch') && !document.querySelector('.app-shell')"), true, "独立窗口看终端同样不离开房间");
  await click(view, 'button[aria-label="收起终端"]');
  await waitFor(view, "!document.querySelector('.room-watch') && !!document.querySelector('.room-aside')");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('button[aria-label=\"添加成员\"]')"), false, "独立窗口里加成员留给主窗口");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('button[aria-label=\"清除所有成员的上下文\"]')"), false, "独立窗口没有终端投递队列，房间级清除不提供");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('button[aria-label=\"清空聊天记录\"]')"), true, "独立窗口同样可以清空聊天记录");
});
