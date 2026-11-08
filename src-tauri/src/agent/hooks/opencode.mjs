// OpenCode 2.2 public lifecycle events; observation only, no permission decisions are changed.
import { createConnection } from "node:net";

const EVENTS = {
  "session.execution.started": "UserPromptSubmit",
  "session.execution.succeeded": "Stop",
  "session.execution.failed": "StopFailure",
  "session.execution.interrupted": "Interrupt",
  "session.compaction.started": "PreCompact",
  "session.compaction.ended": "PostCompact",
  "permission.asked": "PermissionRequest",
  "permission.replied": "PermissionResult",
};

export default {
  id: "belfry-status",
  async setup(ctx) {
    const port = Number(process.env.BELFRY_HOOK_PORT), token = process.env.BELFRY_HOOK_TOKEN;
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9]{26}$/.test(token ?? "")) return;
    const controller = new AbortController(), primary = new Map();
    let pending = Promise.resolve(), current = null, stopped = false;
    const send = (input) => new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const done = () => { socket.destroy(); resolve(); };
      socket.setTimeout(400, done).on("error", done).on("data", done).on("close", resolve);
      socket.on("connect", () => socket.write(JSON.stringify({ version: 1, token, agent: "opencode", input: { occurredAt: Date.now(), isInterrupt: false, backgroundWork: false, ...input } }) + "\n"));
    });
    const observe = (event, data) => {
      if (stopped) return;
      const sessionId = data.sessionID;
      if (typeof sessionId !== "string") return;
      pending = pending.then(async () => {
        if (!primary.has(sessionId)) {
          const info = await ctx.session.get({ sessionID: sessionId });
          primary.set(sessionId, !info.parentID);
        }
        if (!primary.get(sessionId)) return;
        // A late completion from the previous tab must not rebind this terminal.
        if (current && current !== sessionId && event !== "UserPromptSubmit") return;
        if (current !== sessionId) {
          current = sessionId;
          await send({ event: "SessionStart", sessionId, source: "resume" });
        }
        await send({ event, sessionId, toolName: data.tool ?? data.action, toolKey: data.requestID ?? data.id ?? data.source?.id });
      }).catch(() => {});
    };
    await ctx.tool.hook("execute.before", (data) => observe("PreToolUse", data));
    await ctx.tool.hook("execute.after", (data) => observe(data.status === "error" ? "PostToolUseFailure" : "PostToolUse", data));
    void (async () => {
      for await (const event of ctx.event.subscribe({ types: Object.keys(EVENTS), signal: controller.signal })) {
        observe(EVENTS[event.type], event.data);
      }
    })().catch(() => {});
    return async () => { stopped = true; controller.abort(); await pending; };
  },
};
