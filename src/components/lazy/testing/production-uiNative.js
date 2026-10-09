// TEST ONLY: synthetic IPC extension. Never reads HOME, credentials, project files or PTYs.
// Loaded before the unchanged production dist entry, after productionNative.js.
(() => {
  const qa = window.__productionQA;
  const original = window.__TAURI_INTERNALS__.invoke;
  const kinds = ["claude", "codex", "pi"];
  const labels = { claude: "Claude Code", codex: "Codex", pi: "Pi" };
  const rootPath = "/qa/synthetic-project/very-long-directory-name-for-layout-coverage/packages/workbench";
  const project = { id: "production-ui-project", name: "Synthetic Graphite workbench with a deliberately long project name", rootPath, rootUri: `file://${rootPath}` };
  const workspace = JSON.parse(localStorage.getItem("belfry.workspace.v1"));
  workspace.tabs = ["Alpha", "Beta"].map((name, index) => ({ ...workspace.tabs[0], id: `ui-terminal-${index}`, project,
    title: `${name} synthetic terminal with a deliberately long descriptive session name`, customTitle: `${name} synthetic terminal with a deliberately long descriptive session name` }));
  workspace.activeTabId = workspace.tabs[0].id;
  localStorage.setItem("belfry.workspace.v1", JSON.stringify(workspace));
  localStorage.setItem("belfry.recent-projects.v1", JSON.stringify([project]));
  qa.synthetic = true; qa.unhandled = []; qa.savedProviders = [];
  qa.catalog = { agents: kinds.map(kind => ({ kind, currentId: null, providers: [{ id: `${kind}-qa`, name: `Synthetic ${labels[kind]} service with a long descriptive name`, baseUrl: "https://synthetic.invalid/v1", hasApiKey: true, model: "synthetic-model", createdAt: 1 }] })), envConflicts: [] };
  qa.tasks = [{ id: "qa-waiting", shortId: "qa-wait", fromLabel: "synthetic-reviewer", toLabel: "synthetic-builder", instruction: "Review the synthetic Graphite workbench and keyboard focus behavior", state: "pendingapproval", hop: 1, createdAt: Date.now(), result: null },
    { id: "qa-complete", shortId: "qa-done", fromLabel: "synthetic-builder", toLabel: "synthetic-reviewer", instruction: "Inspect synthetic layout", state: "done", hop: 1, createdAt: Date.now(), result: "Synthetic result: layout review complete; no real user data was accessed." }];
  const descriptor = kind => ({ id: `agent:${kind}`, kind, displayName: labels[kind], command: kind, capabilities: { launch: true, resume: true, history: true, prompt: true, structuredState: false } });
  const history = { agent: "claude", id: "synthetic-history", title: "Synthetic Graphite history search and resume session with a long title", cwd: rootPath, startedAt: 1700000000, lastActiveAt: 1700000100, sessionRef: { agent: "claude", id: "synthetic-history" } };
  const filename = "synthetic-workbench-file-with-a-long-descriptive-name.ts";
  const manifest = { schemaVersion: 1, id: "qa.synthetic", name: "Synthetic permissions plugin with a long name", version: "1.0.0", author: "QA", description: "Synthetic host UI fixture", icon: null,
    compatibility: { pluginApi: 1, minAppVersion: "0.0.0", maxAppVersionExclusive: null }, permissions: ["fs.read.workspace", "clipboard.write"], activationEvents: [], contributes: { commands: [], skills: [], settings: [] } };
  const registry = { format: "belfry-directory-plugins-v1", storeSchemaVersion: 1, revision: "0", plugins: [{ manifest, enabled: true, source: "installed", sourcePath: "/qa/synthetic-plugin", installedAt: 1, updatedAt: 1, error: null }] };
  const runtime = { available: true, errors: {}, commands: [], tools: [], skills: [], views: [], themes: [], services: [], plugins: [], shortcuts: [] };
  const management = { settings: { pluginMarketSource: "personal", pluginMarketCustomUrl: "" }, plugins: {} };
  const market = { id: "qa.market", name: "Synthetic marketplace plugin", description: "Test-only market entry", author: "QA", latestVersion: "1.0.0", updatedAt: "2026-10-09", permissionSummary: ["clipboard.write"], trust: "community", installable: true };
  const runtimeHandlers = {
    catalog: () => runtime,
    "launcher.status": () => ({ registered: true, error: null }),
    context: params => { qa.pluginContext = params; return null; },
    "management.get": () => management,
    "management.source": ({ settings }) => { management.settings = settings; return management; },
    "management.plugin": ({ id, patch }) => { management.plugins[id] = patch; return management; },
    "market.search": ({ query = "" }) => ({ plugins: market.name.toLowerCase().includes(query.toLowerCase()) ? [market] : [], sourceUrl: "https://synthetic.invalid/market.json" }),
    "market.refresh": () => ({ pluginCount: 1, sourceUrl: "https://synthetic.invalid/market.json" }),
    "market.personal.info": () => ({ directory: "/qa/synthetic-market", name: "Synthetic local market", pluginCount: 1, versionCount: 1 }),
    "market.detail": () => ({ ...market, permissions: ["clipboard.write"], readmeMarkdown: "# Synthetic plugin\nHost UI only; no third-party content is under test.", versions: [{ version: "1.0.0", publishedAt: "2026-10-09", shasum: "0".repeat(64), url: "https://synthetic.invalid/plugin.zip", sizeBytes: 100, permissions: ["clipboard.write"] }] }),
    "market.updates": () => ({ updates: [] }),
  };
  const handlers = {
    agent_descriptors: () => kinds.map(descriptor),
    agent_detect: () => kinds.map(kind => ({ kind, descriptor: descriptor(kind), available: true, executable: `/qa/bin/${kind}`, version: "synthetic-1.0", reason: null })),
    agent_resume_plan: ({ session }) => ({ schemaVersion: 1, session, supported: true, arguments: ["--resume", session.id] }),
    project_open: () => project,
    provider_list: () => qa.catalog,
    provider_save: ({ kind, draft }) => {
      qa.savedProviders.push({ kind, draft: { ...draft } });
      const group = qa.catalog.agents.find(item => item.kind === kind), previous = group.providers.find(item => item.id === draft.id);
      const entry = { id: draft.id ?? `${kind}-new`, name: draft.name, baseUrl: draft.baseUrl, model: draft.model, createdAt: 1,
        hasApiKey: draft.apiKeyAction === "keep" ? previous?.hasApiKey ?? false : draft.apiKeyAction === "replace" };
      group.providers = [...group.providers.filter(item => item.id !== entry.id), entry]; return qa.catalog;
    },
    provider_switch: ({ kind, id }) => { qa.catalog.agents.find(item => item.kind === kind).currentId = id; return { catalog: qa.catalog, effectiveImmediately: kind === "claude" }; },
    provider_config_preview_for_draft: ({ revealSecrets }) => {
      if (!revealSecrets) throw new Error("Synthetic raw config requires explicit consent");
      return [{ path: "/qa/synthetic-home/long-directory/cli/settings.json", format: "json", content: '{"synthetic":true,"apiKey":"synthetic-test-secret-not-a-real-key"}' }];
    },
    provider_config_save: () => null,
    project_provider_report: () => ({ rootPath, envConflicts: [], agents: kinds.map(kind => ({ kind, providerId: null, source: "global", effectiveName: "官方登录", missing: false, choices: qa.catalog.agents.find(item => item.kind === kind).providers.map(item => ({ ...item, configured: item.hasApiKey })) })) }),
    agent_hooks_report: () => kinds.map(kind => ({ kind, version: "synthetic-1", supported: true, configPath: `/qa/${kind}/config`, installed: 0, expected: 1, stale: 0, disabled: false, note: "Synthetic fixture", error: null })),
    setup_diagnose: () => ({ overall: "ok", checkedAt: Date.now(), checks: [{ id: "synthetic", label: "Synthetic CLI environment", state: "ok", summary: "Fixture only; no real CLI was launched" }] }),
    agent_release_report: () => kinds.map(kind => ({ kind, displayName: labels[kind], command: kind, executable: `/qa/bin/${kind}`, currentVersion: "1.0.0", latestVersion: "1.0.0", package: "synthetic", state: "ready", notice: "Synthetic fixture", installCommand: null })),
    ssh_aliases: () => ({ aliases: [], warnings: [] }),
    collab_tasks: () => ({ tasks: qa.tasks }),
    collab_approve: ({ id }) => { qa.tasks.find(task => task.id === id).state = "done"; return null; },
    collab_reject: ({ id }) => { qa.tasks.find(task => task.id === id).state = "abandoned"; return null; },
    project_list_directory: ({ relativePath }) => ({ relativePath: relativePath ?? "", entries: [{ name: filename, relativePath: filename, kind: "file", size: 41, modifiedAt: 1 }], truncated: false }),
    project_read_file: ({ relativePath }) => ({ name: filename, relativePath, content: "export const syntheticGraphite = true;\n", size: 41, modifiedAt: 1, language: "typescript", binary: false, truncated: false }),
    git_status: () => ({ repository: true, rootPath, branch: "qa/long-synthetic-graphite-branch-name", head: "abcdef", upstream: null, ahead: 0, behind: 0, entries: [{ path: filename, originalPath: null, indexStatus: " ", worktreeStatus: "M", untracked: false, conflicted: false, submodule: false }], truncated: false }),
    git_diff: () => ({ text: `diff --git a/${filename} b/${filename}\n--- a/${filename}\n+++ b/${filename}\n@@ -1 +1 @@\n-export const syntheticGraphite = false;\n+export const syntheticGraphite = true;\n`, binary: false, truncated: false }),
    history_search: ({ request }) => ({ hits: !request.query.text || history.title.toLowerCase().includes(request.query.text.toLowerCase()) ? [{ session: history, snippet: "Synthetic Graphite session transcript" }] : [], projects: [rootPath], scannedFiles: 1, indexedFiles: 1, skippedFiles: 0, skippedLines: 0 }),
    plugins_list: () => registry,
    plugins_runtime: ({ method = "catalog", params = {} }) => {
      if (!runtimeHandlers[method]) { qa.unhandled.push(`plugins_runtime:${method}`); throw new Error(`Synthetic fixture missing runtime method ${method}`); }
      return runtimeHandlers[method](params);
    },
    "plugin:app|version": () => "0.0.0-synthetic",
    "plugin:notification|is_permission_granted": () => false,
    "plugin:window|set_badge_count": ({ count }) => { qa.badgeCount = count; return null; },
    "plugin:updater|check": () => null,
  };
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (handlers[command]) { qa.calls.push({ command, args }); return structuredClone(await handlers[command](args)); }
    try { return await original(command, args); }
    catch (error) { qa.unhandled.push(command); throw error; }
  };
})();
