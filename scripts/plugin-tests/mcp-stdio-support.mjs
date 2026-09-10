import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const RESPONSE_TIMEOUT_MS = 5000;
export function stdioAdapter(t, session) {
  const child = spawn(process.execPath, [resolve("src-tauri/src/plugins/node/mcp-stdio.mjs")], {
    stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH,
      BELFRY_PLUGIN_MCP_URL: session.url, BELFRY_PLUGIN_MCP_TOKEN: session.token },
  });
  const events = new EventEmitter(); let nextId = 0, stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => events.emit("message", JSON.parse(line)));
  function receive(predicate) {
    return new Promise((resolveMessage, reject) => {
      const listener = (message) => {
        if (!predicate(message)) return;
        clearTimeout(timer); events.off("message", listener); resolveMessage(message);
      };
      const timer = setTimeout(() => { events.off("message", listener); reject(new Error(`MCP stdio timeout: ${stderr}`)); }, RESPONSE_TIMEOUT_MS);
      events.on("message", listener);
    });
  }
  function send(message) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n"); }
  t.after(() => { lines.close(); child.stdin.end(); child.kill(); });
  return {
    request: (method, params = {}) => {
      const id = ++nextId, pending = receive((message) => message.id === id);
      send({ id, method, params }); return pending;
    },
    notify: (method) => send({ method }),
    notification: (method) => receive((message) => message.method === method),
  };
}
