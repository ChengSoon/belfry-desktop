import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, click, fill, press, wait, screenshot, assertClean } from './browser-fixture.mjs';

const id = name => `[data-testid="${name}"]`;
const act = name => `[data-action="${name}"]`;
const state = view => view.cdp.evaluate('belfryRoom.state');
const step = (view, n) => view.cdp.evaluate(`belfryRoom.step(${n});true`);
const roomText = view => view.cdp.evaluate('document.querySelector("#room-content").innerText');
const modalText = view => view.cdp.evaluate('document.querySelector("#modal").innerText');
const currentRoom = async view => {
  const snapshot = await state(view);
  return snapshot.rooms.find(r => r.id === snapshot.roomId);
};

// 测试值全部为合成内容，只存在于一次性的隔离浏览器上下文里。
test('a new room needs only a name, then takes members and dispatches tasks on demand', { timeout: 60000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-room-id]")');
  await click(view, act('new-room'));
  await wait(view, 'document.querySelector("#modal").open');
  assert.equal(await view.cdp.evaluate('!!document.querySelector("#room-goal")'), false, 'Rooms are no longer bound to a goal');
  assert.equal(await view.cdp.evaluate('!!document.querySelector("[data-testid=coordinator-option]")'), false, 'No coordinator picker exists');
  await click(view, id('room-create'));
  assert.equal(await view.cdp.evaluate('document.querySelector("[data-testid=form-error]").textContent'), '房间名称为必填。');
  assert.equal(await view.cdp.evaluate('document.querySelector("#modal").open'), true, 'Dialog stays open on invalid input');
  await fill(view, '#room-name', '结账流程小组');
  await click(view, id('room-create'));
  await wait(view, '!document.querySelector("#modal").open');
  const snapshot = await state(view);
  assert.equal(snapshot.rooms.length, 3);
  const created = snapshot.rooms[2];
  assert.equal(created.name, '结账流程小组');
  assert.equal(created.members.length, 0, 'A fresh room starts empty');
  assert.equal(await view.cdp.evaluate('document.querySelector("#room-title").textContent'), '结账流程小组');
  assert.match(await roomText(view), /房间还是空的/);
  assert.match(await view.cdp.evaluate('document.querySelector("#inspector").innerText'), /没有进行中的任务/);
  await screenshot(view, 'flow-new-room-empty');
  // 先拉一位成员进房间。
  await click(view, act('add-member'));
  await wait(view, 'document.querySelector("#modal").open');
  await fill(view, id('member-role'), '实现');
  await click(view, id('member-add'));
  await wait(view, '!document.querySelector("#modal").open');
  const withMember = await currentRoom(view);
  assert.equal(withMember.members.length, 1);
  const memberId = withMember.members[0].memberId;
  // 不选接收者：普通讨论，不发任务、也不产生任何自动回复。
  await fill(view, '#message-input', '先从失败分支的现状看起。');
  await click(view, '#send-message');
  assert.equal((await currentRoom(view)).messages.at(-1).author, 'user');
  assert.equal((await currentRoom(view)).tasks.length, 0, 'Discussion messages do not create tasks');
  await step(view, 3);
  assert.equal((await currentRoom(view)).messages.length, 3, 'No synthetic auto-reply for plain discussion');
  // 选中接收者再发送：这条消息同时派出一条立即运行的任务。
  await click(view, act('recipients'));
  await wait(view, '!!document.querySelector("#recipients-menu")');
  await click(view, `[data-testid="recipient-option"][data-member-id="${memberId}"]`);
  await click(view, act('close-menu'));
  await wait(view, '!document.querySelector("#recipients-menu")');
  await fill(view, '#message-input', '把结账失败的错误提示做成内联样式，并提供重试。');
  await click(view, '#send-message');
  const dispatched = await currentRoom(view);
  assert.equal(dispatched.tasks.length, 1, 'Picking recipients turns the message into a task');
  const task = dispatched.tasks[0];
  assert.equal(task.state, 'running', 'Dispatch runs immediately');
  assert.deepEqual(task.owners, [memberId]);
  assert.equal(dispatched.messages.at(-1).taskId, task.id, 'Message links to its task');
  assert.equal(await count(view, `[data-msg-id="${dispatched.messages.at(-1).id}"] .msg__task`), 1);
  await step(view, 10);
  const submitted = (await currentRoom(view)).tasks[0];
  assert.equal(submitted.state, 'submitted');
  assert.equal(submitted.evidence.length >= 2, true, 'Evidence recorded on submit');
  assert.equal((await currentRoom(view)).artifacts.length, 1, 'Diff artifact produced on submit');
  // 切回原房间：新房间的讨论、成员与任务都不会串房。
  // 后台任务按全局示例时钟继续推进（并行推进是设计本身），所以按内容种类断言隔离，而不是精确条数。
  await click(view, '[data-room-id="r-login"]');
  assert.equal(await view.cdp.evaluate('document.querySelector("#room-title").textContent'), '登录体验小组');
  const loginAfter = (await state(view)).rooms.find(r => r.id === 'r-login');
  assert.equal(loginAfter.members.length, 4, 'No members leaked into the original room');
  assert.equal(loginAfter.messages.filter(m => m.kind === 'msg').length, 3, 'No discussion leaked into the original room');
  assert.equal(loginAfter.messages.some(m => m.text.includes('结账失败')), false);
  assert.equal(loginAfter.tasks.length, 3, 'No tasks leaked into the original room');
  await assertClean(f);
});

async function count(view, selector) {
  return view.cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

test('duplicate agents become independent members; multi-select recipients dispatch one task to all of them', { timeout: 60000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-room-id]")');
  const beforeIds = (await currentRoom(view)).members.map(m => m.memberId);
  await click(view, act('add-member'));
  await wait(view, 'document.querySelector("#modal").open');
  assert.match(await modalText(view), /本房间已用 2 次/, 'Agent list shows in-room usage');
  await click(view, `${id('agent-option')}[value="claude-code"]`);
  await fill(view, id('member-role'), '登录页实现');
  await fill(view, id('member-duty'), '并行处理过期跳转的第二实现位');
  await click(view, id('member-add'));
  await wait(view, '!document.querySelector("#modal").open');
  const added = await currentRoom(view);
  assert.equal(added.members.length, 5);
  const fresh = added.members.at(-1);
  assert.equal(fresh.agentId, 'claude-code');
  assert.equal(fresh.role, '登录页实现 2', 'Duplicate role name auto-increments');
  assert.equal(beforeIds.includes(fresh.memberId), false, 'Same agent gets a new memberId');
  assert.match(fresh.session, /^sess-/);
  // 成员详情：职责、独立会话标识、负责的任务，且没有模型选择器。
  await click(view, `#member-list [data-member-id="${fresh.memberId}"]`);
  await wait(view, 'document.querySelector("#modal").open');
  const detail = await modalText(view);
  assert.match(detail, /并行处理过期跳转的第二实现位/);
  assert.match(detail, new RegExp(fresh.memberId));
  assert.match(detail, new RegExp(fresh.session));
  assert.match(detail, /暂未负责任务/);
  assert.equal(await view.cdp.evaluate('document.querySelectorAll("#modal select").length'), 0, 'No model selector anywhere');
  // 从成员详情直接把任务派给他：写入 @ 前缀并把接收者指向该 memberId。
  await click(view, id('mention-member'));
  await wait(view, '!document.querySelector("#modal").open');
  assert.match(await view.cdp.evaluate('document.querySelector("#recipient-button").innerText'), /登录页实现 2/);
  assert.match(await view.cdp.evaluate('document.querySelector("#message-input").value'), /^@登录页实现 2 /);
  // 再多选一位成员：菜单保持打开，勾选状态可累计。
  await click(view, act('recipients'));
  await wait(view, '!!document.querySelector("#recipients-menu")');
  assert.equal(await view.cdp.evaluate('document.querySelector("[data-testid=recipient-option][data-member-id=\\"m-cx-review\\"]").getAttribute("aria-checked")'), 'false');
  await click(view, `[data-testid="recipient-option"][data-member-id="m-cx-review"]`);
  await wait(view, '!!document.querySelector("#recipients-menu")');
  assert.equal(await count(view, '[data-testid="recipient-option"][aria-checked="true"]'), 2, 'Both members stay selected');
  await click(view, act('close-menu'));
  await wait(view, '!document.querySelector("#recipients-menu")');
  assert.match(await view.cdp.evaluate('document.querySelector("#recipient-button").innerText'), /登录页实现 2 等 2 人/);
  await fill(view, '#message-input', '一起把过期跳转的用户提示文案定下来。');
  await click(view, '#send-message');
  const dispatched = await currentRoom(view);
  const task = dispatched.tasks.find(t => t.title.includes('过期跳转的用户提示') || t.text.includes('过期跳转的用户提示'));
  assert.ok(task, 'A task is dispatched to both members');
  assert.equal(task.owners.length, 2);
  assert.equal(task.owners.includes(fresh.memberId), true);
  assert.equal(task.owners.includes('m-cx-review'), true);
  assert.equal(dispatched.messages.at(-1).recipientIds.length, 2);
  // 并行推进：种子里运行中的 t-101 与新派发的任务同时前进。
  await step(view, 3);
  const after = await currentRoom(view);
  assert.equal(after.tasks.find(t => t.id === 't-101').progress, 70, 'Seeded task keeps advancing');
  assert.equal(after.tasks.find(t => t.id === task.id).progress, 30, 'New task advances in parallel');
  // 「再添加一位」复制角色后仍创建新 memberId，名称继续递增。
  await click(view, `#member-list [data-member-id="${fresh.memberId}"]`);
  await wait(view, 'document.querySelector("#modal").open');
  await click(view, id('duplicate-member'));
  await wait(view, '!!document.querySelector("#member-role")');
  assert.equal(await view.cdp.evaluate('document.querySelector("#member-role").value'), '登录页实现');
  await click(view, id('member-add'));
  await wait(view, '!document.querySelector("#modal").open');
  const final = await currentRoom(view);
  assert.equal(final.members.length, 6);
  const copy = final.members.at(-1);
  assert.equal(copy.role, '登录页实现 3');
  assert.notEqual(copy.memberId, fresh.memberId);
  await assertClean(f);
});

test('task lifecycle: pause freezes, resume continues, stop confirms and keeps artifacts, verification archives evidence', { timeout: 90000 }, async t => {
  const f = await fixture(t), { view } = f;
  const taskOf = async taskId => (await currentRoom(view)).tasks.find(t => t.id === taskId);
  await wait(view, '!!document.querySelector("[data-room-id]")');
  // 种子任务 t-101 初始为运行中 40%。
  assert.equal((await taskOf('t-101')).state, 'running');
  assert.equal((await taskOf('t-101')).progress, 40);
  await click(view, '[data-testid="run-pause"][data-task-id="t-101"]');
  assert.equal((await taskOf('t-101')).state, 'paused');
  await step(view, 4);
  assert.equal((await taskOf('t-101')).progress, 40, 'Paused progress is frozen');
  await screenshot(view, 'flow-paused');
  await click(view, '[data-testid="run-resume"][data-task-id="t-101"]');
  await step(view, 6);
  const submitted = await taskOf('t-101');
  assert.equal(submitted.state, 'submitted');
  assert.equal(submitted.progress, 100);
  assert.equal(submitted.evidence.length >= 2, true, 'Evidence recorded on submit');
  assert.equal((await currentRoom(view)).artifacts.length, 4, 'Diff artifact appended on submit');
  // 验证独立于提交：先看派活内容、验收条件与证据，再显式通过。
  await click(view, '[data-testid="open-task"][data-task-id="t-101"]');
  await wait(view, 'document.querySelector("#modal").open');
  const dialog = await modalText(view);
  assert.match(dialog, /派活内容/);
  assert.match(dialog, /验收条件/);
  assert.match(dialog, /证据/);
  await click(view, '#modal [data-testid="task-verify"][data-task-id="t-101"]');
  assert.equal((await taskOf('t-101')).state, 'verified');
  assert.equal((await currentRoom(view)).artifacts.length, 5, 'Verification record archived');
  assert.match(await modalText(view), /已通过验证/, 'Dialog refreshes to the verified state');
  await click(view, id('modal-close'));
  await wait(view, '!document.querySelector("#modal").open');
  // 再派一条新任务，然后停止它：需要确认；停止后不再推进，产物保留。
  await click(view, act('recipients'));
  await wait(view, '!!document.querySelector("#recipients-menu")');
  await click(view, `[data-testid="recipient-option"][data-member-id="m-cx-review"]`);
  await click(view, act('close-menu'));
  await wait(view, '!document.querySelector("#recipients-menu")');
  await fill(view, '#message-input', '把过期跳转的提示文案先整理出来。');
  await click(view, '#send-message');
  const dispatched = (await currentRoom(view)).tasks.at(-1);
  await step(view, 2);
  assert.equal((await taskOf(dispatched.id)).progress, 20);
  await click(view, `[data-testid="run-stop"][data-task-id="${dispatched.id}"]`);
  await wait(view, 'document.querySelector("#confirm-modal").open');
  assert.match(await view.cdp.evaluate('document.querySelector("#confirm-modal").innerText'), /保留/);
  await click(view, id('confirm-stop'));
  await wait(view, '!document.querySelector("#confirm-modal").open');
  assert.equal((await taskOf(dispatched.id)).state, 'stopped');
  await step(view, 5);
  const afterStop = await taskOf(dispatched.id);
  assert.equal(afterStop.state, 'stopped');
  assert.equal(afterStop.progress, 20, 'No further progress after stop');
  assert.equal((await currentRoom(view)).artifacts.length, 5, 'Artifacts kept after stop');
  assert.match(await view.cdp.evaluate('document.querySelector("#inspector").innerText'), /已完成 2/);
  await screenshot(view, 'flow-stopped');
  await assertClean(f);
});

test('artifacts present spec, diff and verification record; artifact-less rooms show the empty state', { timeout: 90000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-room-id]")');
  await click(view, '#tab-artifacts');
  assert.equal(await view.cdp.evaluate('document.querySelectorAll("[data-testid=artifact-item]").length'), 3);
  await click(view, '.view-pad > [data-testid="artifact-item"]:nth-child(1)');
  await wait(view, 'document.querySelector("#modal").open');
  const spec = await modalText(view);
  assert.match(spec, /合成示例产物/);
  assert.match(spec, /非目标/);
  await press(view, 'Escape');
  await wait(view, '!document.querySelector("#modal").open');
  await click(view, '.view-pad > [data-testid="artifact-item"]:nth-child(2)');
  await wait(view, 'document.querySelector("#modal").open');
  assert.equal(await view.cdp.evaluate('!!document.querySelector("#modal .diff")'), true, 'Diff renders as readable lines');
  await screenshot(view, 'flow-artifact-diff');
  await press(view, 'Escape');
  await wait(view, '!document.querySelector("#modal").open');
  await click(view, '.view-pad > [data-testid="artifact-item"]:nth-child(3)');
  await wait(view, 'document.querySelector("#modal").open');
  assert.equal(await view.cdp.evaluate('!!document.querySelector("#modal .record-list")'), true, 'Verification record renders as a checklist');
  assert.match(await modalText(view), /合成验证通过/);
  await press(view, 'Escape');
  await wait(view, '!document.querySelector("#modal").open');
  // 没有产物的房间保持空态。
  await click(view, '[data-room-id="r-export"]');
  assert.match(await roomText(view), /还没有产物/);
  await assertClean(f);
});

test('drafts, recipient selections and routing stay isolated; Enter sends, Shift+Enter and IME never do', { timeout: 60000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-room-id]")');
  await fill(view, '#message-input', '草稿留在登录房间');
  await click(view, act('recipients'));
  await wait(view, '!!document.querySelector("#recipients-menu")');
  await click(view, `[data-testid="recipient-option"][data-member-id="m-cx-review"]`);
  await click(view, act('close-menu'));
  await wait(view, '!document.querySelector("#recipients-menu")');
  assert.match(await view.cdp.evaluate('document.querySelector("#recipient-button").innerText'), /@代码审查/);
  assert.match(await view.cdp.evaluate('document.querySelector("#composer-note-text").innerText'), /把任务派给 @代码审查/);
  // 每个房间保留各自的草稿与接收人选。
  await click(view, '[data-room-id="r-export"]');
  assert.equal(await view.cdp.evaluate('document.querySelector("#message-input").value'), '', 'Drafts are per room');
  assert.match(await view.cdp.evaluate('document.querySelector("#recipient-button").innerText'), /选择接收者/);
  await fill(view, '#message-input', '导出房间的草稿');
  await click(view, '[data-room-id="r-login"]');
  assert.equal(await view.cdp.evaluate('document.querySelector("#message-input").value'), '草稿留在登录房间');
  assert.match(await view.cdp.evaluate('document.querySelector("#recipient-button").innerText'), /@代码审查/);
  // Enter 发送：带接收者的消息会派出一条任务，随后接收人重置。
  const before = await currentRoom(view);
  await click(view, '#message-input');
  await press(view, 'Enter');
  const sent = await currentRoom(view);
  assert.equal(sent.messages.length, before.messages.length + 1);
  assert.deepEqual(sent.messages.at(-1).recipientIds, ['m-cx-review']);
  assert.equal(sent.tasks.length, before.tasks.length + 1, 'Recipients turn the message into a running task');
  assert.equal(sent.tasks.at(-1).owners.includes('m-cx-review'), true);
  assert.equal(await view.cdp.evaluate('document.querySelector("#message-input").value'), '');
  assert.match(await view.cdp.evaluate('document.querySelector("#recipient-button").innerText'), /选择接收者/, 'Recipients reset after send');
  // Shift+Enter 换行，不发送。
  await fill(view, '#message-input', '第一行');
  await press(view, 'Enter', 8);
  assert.match(await view.cdp.evaluate('document.querySelector("#message-input").value'), /\n/);
  assert.equal((await currentRoom(view)).messages.length, before.messages.length + 1, 'Shift+Enter keeps editing');
  // 输入法组合态按 Enter 不发送。
  await fill(view, '#message-input', '组合态文字');
  await view.cdp.evaluate(`(()=>{const e=document.querySelector("#message-input");e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}));return true;})()`);
  assert.equal((await currentRoom(view)).messages.length, before.messages.length + 1, 'IME composition never sends');
  assert.equal(await view.cdp.evaluate('document.querySelector("#message-input").value'), '组合态文字');
  // 另一个房间的消息没有被这些草稿影响。
  assert.equal((await state(view)).rooms.find(r => r.id === 'r-export').messages.length, 2);
  await fill(view, '#message-input', '');
  assert.equal(await view.cdp.evaluate('document.querySelector("#send-message").disabled'), true);
  await assertClean(f);
});
