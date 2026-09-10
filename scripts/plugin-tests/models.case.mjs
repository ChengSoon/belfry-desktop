import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

async function fixture(t, protocol = "responses") {
  const root = await temporary(t), requests = [];
  const server = createServer(async (request, response) => {
    let source = ""; for await (const chunk of request) source += chunk;
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(source) });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(protocol === "responses" ? {
      output: [{ type: "message", content: [{ type: "output_text", text: "model answer" }] }], usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
    } : { content: [{ type: "text", text: "model answer" }], usage: { input_tokens: 4, output_tokens: 6 } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const model = { key: "test/model", providerId: "test", providerName: "Test", modelId: "model", label: "Test model", supportsReasoning: false, thinkingLevels: [] };
  const runtime = await host(t, root, { platform: ({ api, args }) => {
    if (api === "models.list") return [{ ...model, apiKey: "must-not-reach-plugin" }];
    if (api === "models.resolve") return { ...model, protocol, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "test-secret" };
    return null;
  } });
  const entry = await plugin(root, "mine.models", { code: `module.exports.onLoad = () => pi.agent.registerTool({name:"model",description:"Model",execute: args => args.action==='list' ? pi.models.list() : args.action==='context' ? pi.session.getLlmContext() : pi.agent.complete(args.input)});`, manifest: {
    permissions: ["agent.tool.register", "models.list", "agent.complete", "session.read"], contributes: { agentTools: [{ name: "model", description: "Model" }] },
  } });
  await runtime.call("load", entry);
  const call = (args, context) => runtime.call("tool", { pluginId: entry.manifest.id, name: "model", args, context });
  return { runtime, root, call, requests };
}
test("model discovery and Responses completion use configured routes without exposing credentials", async (t) => {
  const { call, requests } = await fixture(t);
  const [model] = await call({ action: "list" });
  assert.equal(model.key, "test/model"); assert.equal(model.apiKey, undefined);
  const result = await call({ input: { modelKey: model.key, system: "be concise", messages: [{ role: "user", content: "hello" }] } });
  assert.equal(result.text, "model answer"); assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 6, totalTokens: 10 });
  assert.equal(requests[0].url, "/v1/responses"); assert.equal(requests[0].headers.authorization, "Bearer test-secret");
  assert.equal(requests[0].body.store, false); assert.equal(requests[0].body.instructions, "be concise");
});
test("Anthropic providers keep their native request and response format", async (t) => {
  const { call, requests } = await fixture(t, "anthropic");
  const result = await call({ input: { modelKey: "test/model", messages: [{ role: "user", content: "hello" }] } });
  assert.equal(result.text, "model answer");
  assert.equal(requests[0].url, "/v1/messages"); assert.equal(requests[0].headers["x-api-key"], "test-secret");
  assert.deepEqual(requests[0].body.messages, [{ role: "user", content: "hello" }]);
});
test("model calls validate input and only include the invoking tool's session", async (t) => {
  const { call, requests, root } = await fixture(t);
  await assert.rejects(call({ input: { modelKey: "test/model", system: "x".repeat(32 * 1024 + 1) } }), { code: "INVALID_ARGUMENT" });
  await assert.rejects(call({ input: { modelKey: "test/model", includeSessionContext: true } }), { code: "INVALID_ARGUMENT" });
  const context = { sessionId: "own-session", workspace: root, agentSession: { agent: "codex", id: "exact-session" }, historyRoot: join(root, "history") };
  await mkdir(context.historyRoot);
  await writeFile(join(context.historyRoot, "rollout-exact-session.jsonl"), [
    { type: "session_meta", payload: { id: "exact-session", cwd: root } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: root }] } },
  ].map((record) => JSON.stringify(record)).join("\n") + "\n");
  const result = await call({ action: "context" }, context);
  assert.equal(result.sessionId, "exact-session"); assert.equal(result.messages[0].content, root);
  await call({ input: { modelKey: "test/model", includeSessionContext: true } }, context);
  assert.equal(requests[0].body.input[0].content, root);
});
