import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, clickText, waitFor, capturePanel } from "./production-uiFixture.mjs";

// The unchanged production app owns workspace state and persistence. Only native IPC is synthetic.
const nativeExtension = String.raw`(() => {
  const qa = window.__productionQA;
  const workspaceKey = 'belfry.workspace.v1', namedKey = 'belfry.named-workspaces.v1';
  const nativeKey = 'qa.room-deletion.native';
  const prior = localStorage.getItem(nativeKey);
  let backend;
  if (!prior) {
    const workspace = JSON.parse(localStorage.getItem(workspaceKey));
    const seed = workspace.tabs[0];
    workspace.tabs = ['room-lead', 'room-worker', 'ordinary'].map((id, at) => ({ ...seed, id,
      kind: at < 2 ? 'codex' : 'shell', profileId: at < 2 ? 'agent:codex' : 'system-default',
      title: id, customTitle: null, agentName: at < 2 ? id : null, collaborationMode: at < 2 }));
    workspace.activeTabId = 'room-lead';
    localStorage.setItem(workspaceKey, JSON.stringify(workspace));
    localStorage.setItem(namedKey, JSON.stringify({ version: 1, activeWorkspaceId: 'room-space', workspaces: [
      { id: 'room-space', name: 'Room', tabIds: ['room-lead', 'room-worker'], activeTabId: 'room-lead', layout: null },
      { id: 'ordinary-space', name: 'Ordinary', tabIds: ['ordinary'], activeTabId: 'ordinary', layout: null },
    ] }));
    backend = { deletedMemberTabIds: [], room: { id: 'deletion-room', name: 'Deletion test',
      projectRoot: seed.project.rootPath, createdAt: 1, paused: false, ledgerBytes: 0,
      brief: { objective: '', currentFocus: '', constraints: [], updatedBy: null, updatedAt: null },
      members: ['room-lead', 'room-worker'].map((id, at) => ({ id: 'member-' + at, tabId: id,
        agent: 'codex', title: at === 0 ? 'Lead' : 'Worker', duty: '',
        role: at === 0 ? 'foreman' : 'peer', joinedAt: 1, leftAt: null })),
      tasks: [], nextTask: 1, messages: [], retainedMessages: [],
    } };
    localStorage.setItem(nativeKey, JSON.stringify(backend));
  } else {
    backend = JSON.parse(prior);
    // productionNative.js seeds each test document. Restore the archive actually written by the app.
    for (const key of [workspaceKey, namedKey]) {
      const saved = localStorage.getItem('qa.room-deletion.archive:' + key);
      if (saved) localStorage.setItem(key, saved);
    }
  }
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    setItem.call(this, key, value);
    if (key === workspaceKey || key === namedKey) setItem.call(this, 'qa.room-deletion.archive:' + key, value);
  };
  qa.deletionBackend = backend;
  qa.blockedDeletedCreates = [];
  const original = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === 'room_list') {
      qa.calls.push({ command, args });
      const room = backend.room;
      return structuredClone({ loadError: null, deletedMemberTabIds: backend.deletedMemberTabIds,
        rooms: room ? [{ id: room.id, name: room.name, projectRoot: room.projectRoot, createdAt: 1,
          objective: '', memberCount: room.members.length, memberTabIds: room.members.map(member => member.tabId),
          memberTitles: room.members.map(member => member.title), foreman: 'Lead', openTasks: 0, doneTasks: 0,
          lastMessageAt: null, paused: false, ledgerBytes: 0, lastToUser: null }] : [] });
    }
    if (command === 'room_get') {
      qa.calls.push({ command, args });
      if (!backend.room) throw { code: 'NOT_FOUND', message: 'room missing' };
      return structuredClone(backend.room);
    }
    if (command === 'room_history') return { entries: [], nextCursor: null, ledgerBytes: 0, snapshotBytes: 0 };
    if (command === 'room_delete') {
      qa.calls.push({ command, args });
      if (qa.rejectRoomDeletion) throw { code: 'IO', message: 'synthetic room disk conflict', retryable: true };
      assertRoom(args.id);
      const tabs = backend.room.members.filter(member => member.leftAt === null).map(member => member.tabId);
      backend.deletedMemberTabIds.push(...tabs);
      backend.room = null;
      localStorage.setItem(nativeKey, JSON.stringify(backend));
      return tabs;
    }
    if (command === 'terminal_create' && backend.deletedMemberTabIds.includes(args.request.tabId)) {
      qa.blockedDeletedCreates.push(args.request.tabId);
      throw { code: 'TERMINAL_THE_SESSION_WAS_CLOSED_THE_DELAYED_CREATION', message: 'session deleted with room' };
    }
    return original(command, args);
  };
  function assertRoom(id) { if (backend.room?.id !== id) throw { code: 'NOT_FOUND', message: 'room missing' }; }
})();`;

async function openDeletionDialog(view) {
  await click(view, ".room-trigger");
  await waitFor(view, "document.querySelector('.room-view')?.textContent.includes('Deletion test')");
  await click(view, "button[aria-label=房间操作]");
  await click(view, "[role=menuitem][data-variant=destructive]");
  await waitFor(view, "!!document.querySelector('[data-slot=alert-dialog-content]')");
  assert.match(await view.cdp.evaluate("document.querySelector('[data-slot=alert-dialog-content]').textContent"), /关闭、删除所有成员会话/);
}

test("deleting a room removes its member tabs from the app and all workspace archives, including stale reloads", async (t) => {
  const { view, origin } = await uiFixture(t, { nativeExtension, terminalCount: 3 });
  const staleArchive = await view.cdp.evaluate("localStorage.getItem('belfry.workspace.v1')");
  await openDeletionDialog(view);
  await clickText(view, "删除房间", "[data-slot=alert-dialog-content]");
  await waitFor(view, "JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs.length === 1");
  assert.deepEqual(await view.cdp.evaluate("JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs.map(tab => tab.id)"), ["ordinary"]);
  await waitFor(view, "JSON.parse(localStorage.getItem('belfry.named-workspaces.v1')).workspaces.every(space => space.tabIds.every(id => id === 'ordinary'))");
  await waitFor(view, "document.querySelectorAll('.xterm').length === 1");
  assert.equal(await view.cdp.evaluate("__productionQA.deletionBackend.room"), null);
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'room_delete').length"), 1);
  await capturePanel(view, "room-deletion-members-removed");

  // A stale UI archive cannot start new processes for member tabs deleted by the native host.
  await view.cdp.evaluate("localStorage.setItem('belfry.workspace.v1', " + JSON.stringify(staleArchive) + ")");
  await view.navigate({ url: origin });
  await waitFor(view, "document.querySelectorAll('.xterm').length === 1 && JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs.length === 1");
  assert.deepEqual(await view.cdp.evaluate("JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs.map(tab => tab.id)"), ["ordinary"]);
  assert.deepEqual(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'terminal_create').map(call => call.args.request.tabId)"), ["ordinary"]);
  await capturePanel(view, "room-deletion-stale-archive-cleaned");
});

test("a rejected room deletion keeps member sessions and their workspace archives", async (t) => {
  const { view } = await uiFixture(t, { nativeExtension, terminalCount: 3 });
  await view.cdp.evaluate("__productionQA.rejectRoomDeletion = true");
  await openDeletionDialog(view);
  await clickText(view, "删除房间", "[data-slot=alert-dialog-content]");
  await waitFor(view, "document.querySelector('.room-view [role=alert]')?.textContent.includes('synthetic room disk conflict')");
  assert.deepEqual(await view.cdp.evaluate("JSON.parse(localStorage.getItem('belfry.workspace.v1')).tabs.map(tab => tab.id)"), ["room-lead", "room-worker", "ordinary"]);
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.xterm').length"), 3);
  assert.deepEqual(await view.cdp.evaluate("__productionQA.deletionBackend.deletedMemberTabIds"), []);
  assert.equal(await view.cdp.evaluate("__productionQA.deletionBackend.room.id"), "deletion-room");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'terminal_close_tab').length"), 0);
  await capturePanel(view, "room-deletion-rejected-preserves-sessions");
});
