const runtime = { available: true, errors: {}, commands: [], tools: [], skills: [], views: [],
  themes: [], services: [], plugins: [], shortcuts: [] };
const handlers: Record<string, () => unknown> = {
  usage_analytics: () => ({ rows: [], quotas: [], scannedFiles: 0, skippedFiles: 0, undatedRecords: 0,
    windowDays: 30, projectRoot: null, startAt: null, endAt: 1, generatedAt: 1 }),
  usage_cancel_analytics: () => null,
  history_search: () => ({ hits: [], projects: [], scannedFiles: 0, indexedFiles: 0, skippedFiles: 0, skippedLines: 0 }),
  history_cancel_search: () => null,
  plugins_runtime: () => runtime,
  plugins_list: () => ({ format: "belfry-directory-plugins-v1", storeSchemaVersion: 1, revision: "0", plugins: [] }),
};
let callback = 0;
Object.assign(window, {
  __TAURI_INTERNALS__: { metadata: { currentWindow: { label: "qa" }, currentWebview: { label: "qa", windowLabel: "qa" } },
    transformCallback: () => ++callback, unregisterCallback: () => {},
    invoke: async (command: string) => {
      if (command.startsWith("plugin:event|")) return ++callback;
      if (handlers[command]) return handlers[command]();
      throw new Error(`QA 未提供原生命令：${command}`);
    } },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
});
