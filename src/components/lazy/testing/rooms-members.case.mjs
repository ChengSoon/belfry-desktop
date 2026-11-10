import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { browserFixture, click, waitFor, capturePanel } from "./roomsQaFixture.mjs";
import { fill, clickOption as selectOption } from "../../../../scripts/plugin-tests/market-ui-support.mjs";
import { resize, clickText } from "./production-uiFixture.mjs";

async function clickOption(view, label) {
  await selectOption(view, label);
  // Wait for the closing portal to release pointer/focus capture before the
  // next real click. The production animation and event handlers stay enabled.
  await waitFor(view, "!document.querySelector('[data-slot=select-content]')");
}

async function fixture(t, query = "", width = 1440, height = 900) {
  let view;
  t.after(async () => {
    if (!view) return;
    const state = await view.cdp.evaluate(`({ rooms: roomMembersQA.snapshot(), calls: roomMembersQA.calls,
      launches: roomMembersQA.launches, renames: roomMembersQA.renames, errors: roomMembersQA.errors,
      members: document.querySelector('.room-sidebar section')?.innerText,
      tasks: document.querySelector('.room-taskboard')?.innerText })`);
    const directory = process.env.BELFRY_PANEL_ARTIFACTS;
    if (directory) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `members-${t.name.replace(/[^a-z0-9]+/gi, "-")}.json`), `${JSON.stringify(state, null, 2)}\n`);
    }
    assert.deepEqual(state.errors, []);
  });
  ({ view } = await browserFixture(t, `src/components/lazy/testing/rooms-members.html${query}`));
  await resize(view, width, height);
  await waitFor(view, query.includes("empty") ? "!!document.querySelector('.room-main button')" : "!!document.querySelector('.room-taskboard')");
  return view;
}
const taskTitle = '.room-taskboard form input';
const assignee = '.room-taskboard form button[role=combobox]';
async function selectTaskMember(view, title) {
  await click(view, '.room-taskboard > header button');
  await waitFor(view, `!!document.querySelector('${taskTitle}')`);
  await fill(view, taskTitle, 'Inspect a sample');
  await click(view, assignee); await clickOption(view, title);
}

test("task selection follows the member ID when a role is renamed and its old name is reused", async t => {
  const view = await fixture(t);
  await selectTaskMember(view, "Atlas");
  await view.cdp.evaluate(`(async () => {
    await roomMembersQA.update('room-a', 'room-a-atlas', { title: 'Cedar', duty: 'Map symbols and colors, revised' });
    await roomMembersQA.add('room-a', 'replacement-tab', 'codex', 'Atlas', 'Check pronunciation', false);
  })()`);
  await waitFor(view, "document.querySelector('.room-sidebar section').textContent.includes('Cedar')");
  await capturePanel(view, "member-rename-before-submit");
  await click(view, '.room-taskboard form button[type=submit]');
  await waitFor(view, "roomMembersQA.calls.some(call => call.command === 'room_task')");
  const state = await view.cdp.evaluate("roomMembersQA.snapshot().find(room => room.id === 'room-a')");
  assert.equal(state.tasks[0].assignee, "room-a-atlas", "selection must follow the original member, not whoever owns the old name");
  assert.equal(await view.cdp.evaluate("roomMembersQA.calls.find(call => call.command === 'room_task').args.op.assignee"), "room-a-atlas");
  assert.match(await view.cdp.evaluate("document.querySelector('.room-taskboard article').textContent"), /Cedar/);
});

test("task selection cannot silently move to a replacement member with the same name", async t => {
  const view = await fixture(t);
  await selectTaskMember(view, "Atlas");
  await view.cdp.evaluate(`(async () => {
    await roomMembersQA.remove('room-a', 'room-a-atlas');
    await roomMembersQA.add('room-a', 'replacement-tab', 'codex', 'Atlas', 'Check pronunciation', false);
  })()`);
  await waitFor(view, "document.querySelector('.room-sidebar section').textContent.includes('Check pronunciation')");
  await capturePanel(view, "member-replaced-before-submit");
  await click(view, '.room-taskboard form button[type=submit]');
  const state = await view.cdp.evaluate("({ rooms: roomMembersQA.snapshot(), calls: roomMembersQA.calls })");
  assert.equal(state.rooms.find(room => room.id === "room-a").tasks.length, 0, "a departed selection requires another explicit choice");
  assert.equal(state.calls.filter(call => call.command === "room_task").length, 0, "known departed members must be rejected before saving");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${taskTitle}').value`), "Inspect a sample");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${assignee}').getAttribute('aria-invalid')`), "true");
  assert.match(await view.cdp.evaluate("document.querySelector('.room-taskboard form [role=alert]').textContent"), /selected member has left/);
  await click(view, assignee); await clickOption(view, "Birch");
  await click(view, '.room-taskboard form button[type=submit]');
  await waitFor(view, "!document.querySelector('.room-taskboard form')");
  assert.equal(await view.cdp.evaluate("roomMembersQA.snapshot()[0].tasks[0].assignee"), "room-a-birch");
});

async function rows(view) {
  return view.cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-room-create-fields] div.grid')].filter(row => row.querySelector('input'));
    rows.forEach((row, index) => row.setAttribute('data-qa-row', String(index)));
    return rows.map(row => ({ title: row.querySelectorAll('input')[0].value, duty: row.querySelectorAll('input')[1].value,
      agent: row.querySelector('[role=combobox]').textContent }));
  })()`);
}
async function rosterValue(view, index, title, duty) {
  await rows(view);
  await fill(view, `[data-qa-row="${index}"] input:nth-of-type(1)`, title);
  await fill(view, `[data-qa-row="${index}"] input:nth-of-type(2)`, duty);
}
async function newRoom(view) {
  await click(view, '.room-main button');
  await waitFor(view, "!!document.querySelector('[data-room-create]')");
  await fill(view, '[data-room-create-fields] input', "Roster sample");
}

for (const locale of ["en", "zh-CN"]) test(`roster duties stay on their row through Agent changes and add/remove at 720x480 (${locale})`, async t => {
  const view = await fixture(t, `?empty=1&locale=${locale}`, 720, 480);
  await view.cdp.evaluate("document.documentElement.style.fontSize = '20px'");
  await newRoom(view);
  await rosterValue(view, 0, "Guide", "Coordinate samples / 样例协调");
  await rosterValue(view, 1, "Atlas", "Map symbols / 符号标注");
  await rosterValue(view, 2, "Birch", "Check rhythm / 韵律检查");
  await click(view, '[data-qa-row="1"] [role=combobox]'); await clickOption(view, "Claude Code");
  assert.deepEqual((await rows(view))[1], { title: "Atlas", duty: "Map symbols / 符号标注", agent: "Claude Code" });
  await click(view, '[data-qa-row="1"] [role=combobox]'); await clickOption(view, "Codex");
  await click(view, '[data-qa-row="0"] button:not([role=combobox])');
  assert.deepEqual((await rows(view)).map(({ title, duty }) => ({ title, duty })), [
    { title: "Atlas", duty: "Map symbols / 符号标注" }, { title: "Birch", duty: "Check rhythm / 韵律检查" },
  ]);
  await clickText(view, locale === "en" ? "Add a member" : "加一位成员", '[data-slot=dialog-content]');
  assert.deepEqual((await rows(view))[2], { title: "", duty: "", agent: "Codex" });
  await rosterValue(view, 2, "Cedar", "Check tone / 语调检查");
  await capturePanel(view, `member-roster-${locale}-720x480`);
  await click(view, '[data-room-create]');
  await waitFor(view, "!document.querySelector('[data-slot=dialog-content]') && roomMembersQA.launches.length === 3");
  const state = await view.cdp.evaluate("({ room: roomMembersQA.snapshot()[0], calls: roomMembersQA.calls.filter(call => call.command === 'room_add_member'), launches: roomMembersQA.launches, renames: roomMembersQA.renames })");
  const expected = [
    { title: "Atlas", duty: "Map symbols / 符号标注", agent: "codex", tabId: "launched-0", role: "foreman" },
    { title: "Birch", duty: "Check rhythm / 韵律检查", agent: "codex", tabId: "launched-1", role: "peer" },
    { title: "Cedar", duty: "Check tone / 语调检查", agent: "codex", tabId: "launched-2", role: "peer" },
  ];
  assert.deepEqual(state.room.members.map(({ title, duty, agent, tabId, role }) => ({ title, duty, agent, tabId, role })), expected);
  assert.deepEqual(state.calls.map(call => ({ ...call.args, id: undefined })), expected.map(({ role, ...row }) => ({ id: undefined, ...row, foreman: role === "foreman" })));
  assert.ok(state.room.members.every(member => member.id !== member.tabId), "room identities are assigned by the API, not row positions or session IDs");
  for (const call of state.calls) assert.equal(call.result.members.at(-1).duty, call.args.duty);
  assert.deepEqual(state.renames, expected.map(({ tabId, title }) => ({ tabId, title })));
});

test("adding an existing Agent preserves custom duty and blocks a duplicate role name", async t => {
  const view = await fixture(t);
  await click(view, '.room-sidebar button[aria-label="Add member"]');
  await waitFor(view, "!!document.querySelector('[data-slot=dialog-content]')");
  const scope = '[data-slot=dialog-content]';
  await fill(view, `${scope} input[id$=-title]`, "atlas");
  await fill(view, `${scope} input[id$=-duty]`, "Map vowel patterns / 元音规律");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${scope} [data-slot=dialog-footer] button:last-child').disabled`), true);
  assert.equal(await view.cdp.evaluate("roomMembersQA.calls.some(call => call.command === 'room_add_member')"), false);
  await fill(view, `${scope} input[id$=-title]`, "Elm");
  await click(view, `${scope} button[role=combobox]`); await clickOption(view, "Existing session: available-codex-a");
  await click(view, `${scope} button[role=combobox]`); await clickOption(view, "Existing session: available-codex-b");
  assert.equal(await view.cdp.evaluate(`document.querySelector('${scope} input[id$=-duty]').value`), "Map vowel patterns / 元音规律");
  await view.cdp.evaluate("qaSetLocale('zh-CN'); roomMembersQA.failNext = 'room_add_member'");
  await click(view, `${scope} [data-slot=dialog-footer] button:last-child`);
  await waitFor(view, `!document.querySelector('${scope} [data-slot=dialog-footer] button:last-child').disabled`);
  assert.equal(await view.cdp.evaluate(`document.querySelector('${scope} input[id$=-duty]').value`), "Map vowel patterns / 元音规律");
  assert.equal(await view.cdp.evaluate("roomMembersQA.renames.length"), 0);
  await click(view, `${scope} [data-slot=dialog-footer] button:last-child`);
  await waitFor(view, "!document.querySelector('[data-slot=dialog-content]')");
  const calls = await view.cdp.evaluate("roomMembersQA.calls.filter(call => call.command === 'room_add_member')");
  assert.equal(calls.length, 2); assert.match(calls[0].error, /Isolated save failure/);
  assert.deepEqual(calls[1].args, { id: "room-a", tabId: "available-codex-b", agent: "codex", title: "Elm", duty: "Map vowel patterns / 元音规律", foreman: false });
  assert.equal(calls[1].result.members.at(-1).duty, calls[1].args.duty);
});

test("member API edits and reordered snapshots preserve duty, identity and task display across restoration", async t => {
  const view = await fixture(t);
  await view.cdp.evaluate(`(async () => {
    await roomMembersQA.update('room-a', 'room-a-atlas', { title: 'Cedar', duty: 'Map symbols, revised / 修改职责', tabId: 'available-codex-b' });
    await roomMembersQA.task('room-a', { op: 'add', title: 'Saved sample', assignee: 'Cedar' });
    roomMembersQA.reorder('room-a', ['room-a-birch', 'room-a-planner', 'room-a-atlas']);
  })()`);
  await waitFor(view, "document.querySelector('.room-sidebar section').textContent.includes('Map symbols, revised') && document.querySelector('.room-taskboard article')?.textContent.includes('Cedar')");
  const before = await view.cdp.evaluate("roomMembersQA.snapshot()");
  assert.equal(before[0].members[2].id, "room-a-atlas");
  assert.equal(before[0].members[2].tabId, "available-codex-b");
  assert.equal(before[0].tasks[0].assignee, "room-a-atlas");
  const edited = await view.cdp.evaluate("roomMembersQA.calls.find(call => call.command === 'room_update_member')");
  assert.deepEqual(edited.args, { id: 'room-a', memberId: 'room-a-atlas', title: 'Cedar',
    duty: 'Map symbols, revised / 修改职责', tabId: 'available-codex-b' });
  assert.deepEqual(edited.result.members.find(member => member.id === 'room-a-atlas'), before[0].members[2]);
  if (process.env.BELFRY_PANEL_ARTIFACTS) {
    await mkdir(process.env.BELFRY_PANEL_ARTIFACTS, { recursive: true });
    await writeFile(join(process.env.BELFRY_PANEL_ARTIFACTS, 'members-before-restoration.json'),
      `${JSON.stringify({ edited, rooms: before }, null, 2)}\n`);
  }
  await click(view, '.room-sidebar nav button:nth-child(2)');
  await waitFor(view, "document.querySelector('.room-main header').textContent.includes('Sample room B')");
  assert.match(await view.cdp.evaluate("document.querySelector('.room-sidebar section').textContent"), /Map symbols and colors/);
  assert.doesNotMatch(await view.cdp.evaluate("document.querySelector('.room-sidebar section').textContent"), /修改职责/);
  await view.navigate({ url: await view.cdp.evaluate("location.href") });
  await waitFor(view, "document.querySelector('.room-sidebar section')?.textContent.includes('Map symbols, revised')");
  assert.deepEqual(await view.cdp.evaluate("roomMembersQA.snapshot()"), before);
  assert.match(await view.cdp.evaluate("document.querySelector('.room-taskboard article').textContent"), /Cedar/);
  await click(view, '.room-taskboard article > button');
  await click(view, '.room-taskboard article button[role=combobox]'); await clickOption(view, "Birch");
  await waitFor(view, "roomMembersQA.calls.some(call => call.command === 'room_task')");
  const assigned = await view.cdp.evaluate("roomMembersQA.calls.find(call => call.command === 'room_task')");
  assert.equal(assigned.args.op.assignee, "room-a-birch");
  assert.equal(assigned.result.tasks[0].assignee, "room-a-birch");
  assert.match(await view.cdp.evaluate("document.querySelector('.room-taskboard article > button').textContent"), /Birch/);
});

test("a roster rejects role names that become duplicates after API normalization", async t => {
  const view = await fixture(t, '?empty=1');
  await newRoom(view);
  await rosterValue(view, 0, ' @Atlas ', 'Map symbols');
  await rosterValue(view, 1, '  atlas  ', 'Check rhythm');
  assert.equal(await view.cdp.evaluate("document.querySelector('[data-room-create]').disabled"), true,
    'duplicates must be caught before creating a partial room');
  await view.cdp.evaluate("document.querySelector('[data-room-create]').click()");
  assert.equal(await view.cdp.evaluate("roomMembersQA.calls.some(call => call.command === 'room_create')"), false);
  assert.deepEqual(await view.cdp.evaluate("roomMembersQA.launches"), []);
});

for (const locale of ["en", "zh-CN"]) test(`a departed assignee keeps the task draft and can be replaced at 720x480 (${locale})`, async t => {
  const view = await fixture(t, `?locale=${locale}`, 720, 480);
  await view.cdp.evaluate("document.documentElement.style.fontSize = '20px'");
  await click(view, '.room-compact-nav button:nth-child(2)');
  await selectTaskMember(view, 'Atlas');
  await view.cdp.evaluate(`(() => {
    const input = document.querySelector('.room-taskboard form textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Preserve the sample criteria');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return roomMembersQA.remove('room-a', 'room-a-atlas');
  })()`);
  await waitFor(view, "!!document.querySelector('.room-taskboard form [role=alert]')");
  const alert = await view.cdp.evaluate("document.querySelector('.room-taskboard form [role=alert]').textContent.trim()");
  assert.equal(alert, locale === 'en' ? 'The selected member has left. Choose an assignee again.' : '所选成员已离开，请重新选择负责人。');
  await capturePanel(view, `member-departed-${locale}-720x480`);
  await click(view, assignee); await clickOption(view, 'Birch');
  assert.equal(await view.cdp.evaluate("document.querySelector('.room-taskboard form textarea').value"), 'Preserve the sample criteria');
  await click(view, '.room-taskboard form button[type=submit]');
  await waitFor(view, "!document.querySelector('.room-taskboard form')");
  const saved = await view.cdp.evaluate("roomMembersQA.calls.find(call => call.command === 'room_task')");
  assert.equal(saved.args.op.assignee, 'room-a-birch');
  assert.equal(saved.args.op.outcome, 'Preserve the sample criteria');
  assert.equal(saved.result.tasks[0].assignee, 'room-a-birch');
  assert.equal(await view.cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
});
