import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createA2AFixture } from "./fixtures/a2a-server.mjs";
import { waitFor } from "./support.mjs";

async function fixture(t, options) { const server = await createA2AFixture(options); t.after(() => server.close()); return server; }
function userMessage(text, extra = {}) { return { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text }], ...extra }; }
async function rpc(server, method, params, { headers = {}, signal } = {}) {
  const id = randomUUID();
  const response = await fetch(server.rpcUrl, { method: "POST", headers: { "A2A-Version": "1.0", "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, tenant: "fixture-tenant" } }), signal });
  const data = await response.json(); if (response.status === 200) assert.equal(data.id, id);
  return { status: response.status, data };
}

test("independent A2A HTTP fixture follows 1.0 Card, SendMessage union and direct Task retrieval/cancellation", async t => {
  const server = await fixture(t);
  const card = await (await fetch(server.cardUrl)).json();
  assert.deepEqual(card.supportedInterfaces, [{ url: server.rpcUrl, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "fixture-tenant" }]);
  assert.equal(card.skills[0].id, "fixture");
  const instant = (await rpc(server, "SendMessage", { message: userMessage("instant: hello") })).data.result;
  assert.equal(instant.task, undefined); assert.equal(instant.message.role, "ROLE_AGENT"); assert.equal(instant.message.parts[0].text, "hello");
  const initial = (await rpc(server, "SendMessage", { message: userMessage("needs-input: clarify this task"), configuration: { returnImmediately: true, acceptedOutputModes: ["text/plain"], historyLength: 0 } })).data.result.task;
  assert.equal(initial.status.state, "TASK_STATE_INPUT_REQUIRED");
  const followup = (await rpc(server, "SendMessage", { message: userMessage("more detail", { taskId: initial.id, contextId: initial.contextId }), configuration: { returnImmediately: true } })).data.result.task;
  assert.equal(followup.status.state, "TASK_STATE_WORKING");
  assert.equal((await rpc(server, "GetTask", { id: initial.id, historyLength: 0 })).data.result.status.state, "TASK_STATE_WORKING");
  const completed = (await rpc(server, "GetTask", { id: initial.id, historyLength: 2 })).data.result;
  assert.equal(completed.task, undefined); assert.equal(completed.status.state, "TASK_STATE_COMPLETED");
  assert.equal(completed.artifacts[0].artifactId, "fixture-answer"); assert.equal(completed.history.length, 2);
  assert.match(completed.artifacts[0].parts[0].text, /more detail/);
  const other = (await rpc(server, "SendMessage", { message: userMessage("cancel this task"), configuration: { returnImmediately: true } })).data.result.task;
  const cancelled = (await rpc(server, "CancelTask", { id: other.id })).data.result;
  assert.equal(cancelled.task, undefined); assert.equal(cancelled.status.state, "TASK_STATE_CANCELED");
  assert.equal(new Set(server.requests.filter(request => request.method === "SendMessage").map(request => request.params.message.messageId)).size, 4);
});

test("independent A2A HTTP fixture waits by default or explicit false and returns interrupted/cancelled tasks with bounded history", async t => {
  const server = await fixture(t);
  for (const configuration of [undefined, { returnImmediately: false, historyLength: 1 }]) {
    const task = (await rpc(server, "SendMessage", { message: userMessage("wait for completion"), ...(configuration ? { configuration } : {}) })).data.result.task;
    assert.equal(task.status.state, "TASK_STATE_COMPLETED");
    assert.equal(task.artifacts[0].artifactId, "fixture-answer");
    assert.equal(task.history?.length ?? 0, configuration?.historyLength ?? 0);
    if (!configuration) assert.equal(Object.hasOwn(task, "history"), false);
  }
  const input = (await rpc(server, "SendMessage", { message: userMessage("needs-input: clarify") })).data.result.task;
  assert.equal(input.status.state, "TASK_STATE_INPUT_REQUIRED");
  const completed = (await rpc(server, "SendMessage", { message: userMessage("clarification", { taskId: input.id, contextId: input.contextId }), configuration: { returnImmediately: false, historyLength: 1 } })).data.result.task;
  assert.equal(completed.status.state, "TASK_STATE_COMPLETED");
  assert.equal(completed.history.length, 1); assert.equal(completed.history[0].parts[0].text, "clarification");
  const pending = rpc(server, "SendMessage", { message: userMessage("unspecified: wait until explicitly cancelled") });
  assert.ok(await waitFor(() => server.tasks.size === 4));
  const id = [...server.tasks.keys()].at(-1);
  assert.equal((await rpc(server, "CancelTask", { id })).data.result.status.state, "TASK_STATE_CANCELED");
  assert.equal((await pending).data.result.task.status.state, "TASK_STATE_CANCELED");
  assert.equal(server.stats.abortedRequests, 0);
});

test("independent A2A HTTP fixture advertises and enforces static Bearer and Header API-key with the correct binding headers", async t => {
  for (const auth of ["bearer", "apiKey"]) {
    const server = await fixture(t, { auth });
    const card = await (await fetch(server.cardUrl)).json();
    assert.deepEqual(card.securityRequirements, [{ schemes: { fixture: { list: [] } } }]);
    assert.deepEqual(card.securitySchemes.fixture, auth === "bearer" ? { httpAuthSecurityScheme: { scheme: "bearer" } } : { apiKeySecurityScheme: { location: "header", name: "X-API-Key" } });
    assert.equal((await rpc(server, "SendMessage", { message: userMessage("instant: hello") })).status, 401);
    const headers = auth === "bearer" ? { Authorization: "Bearer fixture-key" } : { "X-API-Key": "fixture-key" };
    assert.equal((await rpc(server, "SendMessage", { message: userMessage("instant: hello") }, { headers })).status, 200);
    assert.equal((await rpc(server, "SendMessage", { message: userMessage("instant: hello") }, { headers: { ...headers, "A2A-Version": "1.0.1" } })).status, 400);
    assert.equal(server.stats.sends, 1);
  }
});

test("independent A2A HTTP fixture preserves incomplete/error states and observes local request abort without remote cancellation", async t => {
  const server = await fixture(t);
  for (const [prefix, state] of [["auth-required:", "TASK_STATE_AUTH_REQUIRED"], ["unspecified:", "TASK_STATE_UNSPECIFIED"], ["fail:", "TASK_STATE_FAILED"]]) {
    const task = (await rpc(server, "SendMessage", { message: userMessage(prefix), configuration: { returnImmediately: true } })).data.result.task;
    assert.equal((await rpc(server, "GetTask", { id: task.id })).data.result.status.state, state);
  }
  const uncancelable = (await rpc(server, "SendMessage", { message: userMessage("uncancelable: task"), configuration: { returnImmediately: true } })).data.result.task;
  assert.equal((await rpc(server, "CancelTask", { id: uncancelable.id })).data.error.code, -32002);
  const controller = new AbortController(), pending = rpc(server, "SendMessage", { message: userMessage("slow: task"), configuration: { returnImmediately: true } }, { signal: controller.signal });
  assert.ok(await waitFor(() => server.stats.sends === 5)); controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(await waitFor(() => server.stats.abortedRequests === 1));
  assert.equal(server.stats.cancels, 1); assert.equal(server.stats.sends, 5);
});
