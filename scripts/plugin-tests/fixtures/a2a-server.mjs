import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const terminal = new Set(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);
const readyToReturn = state => terminal.has(state) || state === "TASK_STATE_INPUT_REQUIRED" || state === "TASK_STATE_AUTH_REQUIRED";
const json = (response, status, value) => {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
};
const agentMessage = text => ({ messageId: randomUUID(), role: "ROLE_AGENT", parts: [{ text }] });

/** Independent A2A 1.0 HTTP fixture. It never launches a model or reads a project.
 * Both tests and the usage guide can start the exact same controllable service. */
export async function createA2AFixture({ port = 0, auth = "none", credential = "fixture-key", headerName = "X-API-Key", slowDelayMs = 10000, blockingDelayMs = 50 } = {}) {
  if (!["none", "bearer", "apiKey"].includes(auth)) throw new Error("Fixture auth must be none, bearer or apiKey");
  const tasks = new Map(), requests = [], timers = new Set(), stats = { sends: 0, gets: 0, cancels: 0, abortedRequests: 0 };
  let origin;
  const authorized = request => auth === "none" || (auth === "bearer"
    ? request.headers.authorization === `Bearer ${credential}` : request.headers[headerName.toLowerCase()] === credential);
  function card() {
    return { name: "Belfry A2A fixture", description: "Local deterministic Agent for configuration and task acceptance. No model or external service is called.",
      version: "1.0.0-fixture", supportedInterfaces: [{ url: `${origin}/rpc`, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "fixture-tenant" }],
      capabilities: {}, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"],
      skills: [{ id: "fixture", name: "Deterministic fixture tasks", description: "Use instant:, needs-input:, fail: or uncancelable: prefixes to exercise different outcomes.", tags: ["fixture", "test"] }],
      ...(auth === "none" ? {} : { securitySchemes: { fixture: auth === "bearer"
        ? { httpAuthSecurityScheme: { scheme: "bearer" } } : { apiKeySecurityScheme: { location: "header", name: headerName } } },
        securityRequirements: [{ schemes: { fixture: { list: [] } } }] }) };
  }
  function snapshot(entry, historyLength = 0) {
    const { task, messages } = entry;
    return { ...structuredClone(task), ...(historyLength ? { history: structuredClone(messages.slice(-historyLength)) } : {}) };
  }
  function schedule(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
  }
  function notify(entry) {
    if (readyToReturn(entry.task.status.state)) for (const reply of [...entry.waiters]) reply();
  }
  function complete(entry) {
    if (entry.task.status.state !== "TASK_STATE_WORKING") return;
    entry.task.status = { state: "TASK_STATE_COMPLETED" };
    entry.task.artifacts = [{ artifactId: "fixture-answer", name: "Fixture result", parts: [{ text: `Completed: ${entry.messages.at(-1).parts.map(part => part.text).join("\n")}` }] }];
    notify(entry);
  }
  async function receive(request, response) {
    if (request.method === "GET" && request.url === "/.well-known/agent-card.json") return json(response, 200, card());
    if (request.method !== "POST" || request.url !== "/rpc") return json(response, 404, { error: "Not found" });
    if (!authorized(request)) {
      if (auth === "bearer") response.setHeader("WWW-Authenticate", 'Bearer realm="a2a-fixture"');
      return json(response, 401, { error: "Fixture credential required" });
    }
    if (request.headers["a2a-version"] !== "1.0" || !request.headers["content-type"]?.startsWith("application/json")) {
      return json(response, 400, { error: "Expected A2A-Version: 1.0 and Content-Type: application/json" });
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024 * 1024) return json(response, 413, { error: "Fixture request too large" }); chunks.push(chunk); }
    const rpc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ method: rpc.method, params: structuredClone(rpc.params), id: rpc.id,
      version: request.headers["a2a-version"], contentType: request.headers["content-type"], authorized: true });
    const reply = value => json(response, 200, { jsonrpc: "2.0", id: rpc.id, result: value });
    const error = (code, message) => json(response, 200, { jsonrpc: "2.0", id: rpc.id, error: { code, message } });
    if (rpc.jsonrpc !== "2.0" || rpc.params?.tenant !== "fixture-tenant") return error(-32602, "Invalid JSON-RPC or missing interface tenant");
    if (rpc.method === "SendMessage") {
      stats.sends++;
      const message = rpc.params.message;
      if (!message || message.role !== "ROLE_USER" || !message.messageId || !Array.isArray(message.parts)
        || message.parts.some(part => typeof part.text !== "string" || Object.hasOwn(part, "kind"))) return error(-32602, "Expected A2A 1.0 user text Message");
      const text = message.parts.map(part => part.text).join("\n");
      const configuration = rpc.params.configuration ?? {};
      if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)
        || (configuration.returnImmediately !== undefined && typeof configuration.returnImmediately !== "boolean")) return error(-32602, "Invalid SendMessage configuration");
      const historyLength = configuration.historyLength ?? 0;
      if (!Number.isInteger(historyLength) || historyLength < 0 || historyLength > 20) return error(-32602, "historyLength must be between 0 and 20");
      if (text.startsWith("instant:")) return reply({ message: agentMessage(text.slice(8).trim() || "Hello from the fixture") });
      if (text.startsWith("bad-task:")) return reply({ task: { id: "malformed-task" } });
      let entry;
      if (message.taskId) {
        entry = tasks.get(message.taskId);
        if (!entry) return error(-32001, "Task not found");
        if (terminal.has(entry.task.status.state)) return error(-32602, "Task is terminal");
        if (message.contextId !== entry.task.contextId) return error(-32602, "Follow-up context mismatch");
        entry.task.status = { state: "TASK_STATE_WORKING" }; entry.reads = 0; entry.messages.push(structuredClone(message));
      } else {
        let state = "TASK_STATE_WORKING";
        if (text.startsWith("needs-input:")) state = "TASK_STATE_INPUT_REQUIRED";
        if (text.startsWith("auth-required:")) state = "TASK_STATE_AUTH_REQUIRED";
        if (text.startsWith("fail:")) state = "TASK_STATE_FAILED";
        if (text.startsWith("reject:")) state = "TASK_STATE_REJECTED";
        if (text.startsWith("unspecified:")) state = "TASK_STATE_UNSPECIFIED";
        const id = `fixture-task-${tasks.size + 1}`;
        entry = { task: { id, contextId: `fixture-context-${tasks.size + 1}`, status: { state } }, messages: [structuredClone(message)], reads: 0, waiters: new Set(),
          uncancelable: text.startsWith("uncancelable:"), text };
        if (state === "TASK_STATE_INPUT_REQUIRED") entry.task.status.message = agentMessage("Please provide follow-up input for this task.");
        if (state === "TASK_STATE_FAILED") entry.task.status.message = agentMessage("Synthetic task failure requested.");
        tasks.set(id, entry);
      }
      if (configuration.returnImmediately === true && text.startsWith("slow:")) {
        const timer = schedule(() => reply({ task: snapshot(entry, historyLength) }), slowDelayMs);
        response.once("close", () => { clearTimeout(timer); if (!response.writableEnded) stats.abortedRequests++; });
        return;
      }
      if (configuration.returnImmediately === true || readyToReturn(entry.task.status.state)) return reply({ task: snapshot(entry, historyLength) });
      // A2A 1.0 defaults to waiting for a terminal/interrupted state. Disconnecting
      // only drops this HTTP waiter; it does not cancel the accepted remote task.
      const finished = () => { entry.waiters.delete(finished); reply({ task: snapshot(entry, historyLength) }); };
      entry.waiters.add(finished);
      response.once("close", () => { entry.waiters.delete(finished); if (!response.writableEnded) stats.abortedRequests++; });
      if (entry.task.status.state === "TASK_STATE_WORKING") schedule(() => complete(entry), text.startsWith("slow:") ? slowDelayMs : blockingDelayMs);
      return;
    }
    const entry = tasks.get(rpc.params.id);
    if (!entry) return error(-32001, "Task not found");
    if (rpc.method === "GetTask") {
      stats.gets++;
      const historyLength = rpc.params.historyLength ?? 0;
      if (!Number.isInteger(historyLength) || historyLength < 0 || historyLength > 20) return error(-32602, "historyLength must be between 0 and 20");
      if (entry.task.status.state === "TASK_STATE_WORKING" && !entry.uncancelable && ++entry.reads >= 2) {
        complete(entry);
      }
      return reply(snapshot(entry, historyLength));
    }
    if (rpc.method === "CancelTask") {
      stats.cancels++;
      if (entry.uncancelable || terminal.has(entry.task.status.state)) return error(-32002, "Task cannot be cancelled");
      entry.task.status = { state: "TASK_STATE_CANCELED" }; notify(entry); return reply(snapshot(entry));
    }
    return error(-32601, "Method not found");
  }
  const server = createServer((request, response) => receive(request, response).catch(error => json(response, 400, { error: error.message })));
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, cardUrl: `${origin}/.well-known/agent-card.json`, rpcUrl: `${origin}/rpc`, card, tasks, requests, stats,
    async close() { for (const timer of timers) clearTimeout(timer); timers.clear(); server.closeAllConnections(); await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const port = Number(argument("--port", "17777")), auth = argument("--auth", "none");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid --port");
  const fixture = await createA2AFixture({ port, auth });
  process.stdout.write(JSON.stringify({ fixture: true, cardUrl: fixture.cardUrl, rpcUrl: fixture.rpcUrl, auth,
    ...(auth === "none" ? {} : { fixtureCredential: "fixture-key", ...(auth === "apiKey" ? { headerName: "X-API-Key" } : {}) }) }, null, 2) + "\n");
  process.once("SIGINT", async () => { await fixture.close(); process.exitCode = 0; });
  process.once("SIGTERM", async () => { await fixture.close(); process.exitCode = 0; });
}
