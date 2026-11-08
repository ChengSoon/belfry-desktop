import { expect, it, vi } from "vitest";
import { createServer } from "node:net";
import plugin from "./opencode.mjs";

it("observes OpenCode permissions without mutating them or rebinding from stale and child events", async () => {
  const events = [], hooks = {}, queued = [];
  let wake, aborted = false;
  const server = createServer(socket => {
    let data = "";
    socket.on("data", chunk => { data += chunk; if (data.includes("\n")) { events.push(JSON.parse(data).input); socket.end('{"ok":true}\n'); } });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("BELFRY_HOOK_PORT", String(server.address().port)); vi.stubEnv("BELFRY_HOOK_TOKEN", "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  const ctx = { session: { get: async ({ sessionID }) => ({ parentID: sessionID === "child" ? "native-a" : undefined }) },
    tool: { hook: async (name, handler) => { hooks[name] = handler; } }, event: {
      async *subscribe({ signal }) {
        signal.addEventListener("abort", () => { aborted = true; wake?.(); }, { once: true });
        while (!aborted) {
          if (!queued.length) await new Promise(resolve => { wake = resolve; });
          while (queued.length && !aborted) yield queued.shift();
        }
      },
    } };
  const push = (type, sessionID, rest = {}) => { queued.push({ type, data: { sessionID, ...rest } }); wake?.(); };
  let cleanup;
  try {
    cleanup = await plugin.setup(ctx);
    push("session.execution.started", "native-a");
    await vi.waitFor(() => expect(events).toHaveLength(2));
    const tool = { sessionID: "native-a", id: "call-a", tool: "shell", input: { command: "pwd" } }, before = structuredClone(tool);
    expect(hooks["execute.before"](tool)).toBeUndefined(); expect(tool).toEqual(before);
    push("permission.asked", "native-a", { id: "permission-a", action: "shell", source: { id: "call-a" } });
    push("permission.replied", "native-a", { requestID: "permission-a", reply: "once" });
    await vi.waitFor(() => expect(events).toHaveLength(5));
    hooks["execute.after"]({ ...tool, status: "completed" });
    push("session.execution.started", "child");
    push("session.execution.started", "native-b");
    push("session.execution.succeeded", "native-a");
    push("session.execution.succeeded", "native-b");
    await vi.waitFor(() => expect(events).toHaveLength(9));
    expect(events.map(event => event.event)).toEqual(["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PermissionResult", "PostToolUse", "SessionStart", "UserPromptSubmit", "Stop"]);
    expect(events.slice(3, 5).map(event => event.toolKey)).toEqual(["permission-a", "permission-a"]);
    expect(events.filter(event => event.sessionId === "child")).toHaveLength(0);
    await cleanup(); cleanup = null;
    hooks["execute.before"](tool);
    expect(events).toHaveLength(9); expect(aborted).toBe(true);
  } finally { await cleanup?.(); vi.unstubAllEnvs(); await new Promise(resolve => server.close(resolve)); }
});
