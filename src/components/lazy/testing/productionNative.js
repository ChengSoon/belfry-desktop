// 仅替代原生 IPC；页面、React、xterm 与动态资源均使用未经改写的 dist。
const callbacks = new Map(), channels = new Map();
let nextCallback = 0;
const project = { id: "production-qa", name: "panel-qa", rootPath: "/qa/panel-project", rootUri: "file:///qa/panel-project" };
const qa = window.__productionQA = { calls: [], creates: 0, writes: [], preloadErrors: [], errors: [], token: crypto.randomUUID() };
window.addEventListener("vite:preloadError", (event) => qa.preloadErrors.push(String(event.payload?.message ?? event.payload)));
window.addEventListener("error", (event) => { if (event.error) qa.errors.push(String(event.error)); });
window.addEventListener("unhandledrejection", (event) => qa.errors.push(String(event.reason)));

function output(sessionId, text) {
  const channel = channels.get(sessionId);
  callbacks.get(channel.id)?.({ index: channel.index++, message: {
    kind: "output", sessionId, sequence: channel.sequence++, eof: true,
    bytes: Array.from(new TextEncoder().encode(text)),
  } });
}

function terminalCreate({ request, onEvent }) {
  qa.creates++;
  const id = `${request.tabId}-pty`;
  channels.set(id, { id: onEvent.id, index: 0, sequence: 0 });
  setTimeout(() => output(id, "production terminal ready\r\n$ "), 20);
  return { id, platform: request.platform, shell: "/bin/sh", cwd: project.rootPath,
    cols: request.cols, rows: request.rows, status: "running", exitCode: null, connectionId: "qa-connection" };
}

const runtime = { available: true, errors: {}, commands: [], tools: [], skills: [], views: [],
  themes: [], services: [], plugins: [], shortcuts: [] };
const handlers = {
  terminal_create: terminalCreate,
  terminal_write: ({ sessionId, bytes }) => { qa.writes.push({ sessionId, bytes }); output(sessionId, new TextDecoder().decode(new Uint8Array(bytes))); },
  terminal_shell_profiles: () => [{ id: "system-default", available: true, executable: "/bin/sh", isDefault: true, reason: null }],
  terminal_background_sessions: () => [],
  terminal_exit_pending: () => false,
  terminal_ack_output: () => true,
  agent_descriptors: () => [], agent_detect: () => [],
  collab_tasks: () => ({ tasks: [] }), collab_pending_tasks: () => [],
  plugins_runtime: () => runtime,
  plugins_list: () => ({ format: "belfry-directory-plugins-v1", storeSchemaVersion: 1, revision: "0", plugins: [] }),
  history_search: () => ({ hits: [], projects: [], scannedFiles: 0, indexedFiles: 0, skippedFiles: 0, skippedLines: 0 }),
  usage_analytics: () => ({ rows: [], quotas: [], scannedFiles: 0, skippedFiles: 0, undatedRecords: 0,
    windowDays: 30, projectRoot: null, startAt: null, endAt: 1, generatedAt: 1 }),
  font_read: () => ({ fonts: [] }), background_read: () => null,
  project_open: () => project, git_status: () => ({ branch: "qa", files: [] }),
};
const voidCommands = new Set(["terminal_resize", "terminal_close", "terminal_close_tab", "terminal_detach",
  "terminal_set_palette", "terminal_exit", "collab_sync_sessions", "history_cancel_search", "usage_cancel_analytics"]);

window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "qa" }, currentWebview: { label: "qa", windowLabel: "qa" } },
  transformCallback: (callback) => { const id = ++nextCallback; callbacks.set(id, callback); return id; },
  unregisterCallback: (id) => callbacks.delete(id), convertFileSrc: (path) => path,
  invoke: async (command, args) => {
    qa.calls.push({ command, args });
    if (command === "plugin:event|listen") return ++nextCallback;
    if (command.startsWith("plugin:event|") || voidCommands.has(command)) return null;
    if (handlers[command]) return handlers[command](args);
    throw new Error(`生产面板 QA 未提供原生命令：${command}`);
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
const tab = { id: "production-terminal", project, kind: "shell", title: "Production terminal", titleHint: null,
  customTitle: null, agentName: null, profileId: "system-default", collaborationMode: false,
  sshTarget: null, resumeSessionId: null, agentSessionRef: null };
localStorage.setItem("belfry.workspace.v1", JSON.stringify({ tabs: [tab], activeTabId: tab.id }));
localStorage.setItem("belfry.recent-projects.v1", JSON.stringify([project]));
