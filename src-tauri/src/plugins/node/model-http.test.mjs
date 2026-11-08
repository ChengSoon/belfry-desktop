import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { completeHttp } from "./model-http.mjs";

const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function api(reply) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
    response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(reply));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}
const input = { system: "Be concise", messages: [{ role: "user", content: "First" }, { role: "assistant", content: "Second" }, { role: "user", content: "Third" }] };

describe("native plugin model gateway", () => {
  it.each(["opencode", "kimi"])("calls %s Chat Completions with the selected route", async agent => {
    const server = await api({ choices: [{ message: { content: "Answer" } }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } });
    const result = await completeHttp({ key: `${agent}/model`, protocol: "chat-completions", baseUrl: `${server.baseUrl}/v1/`, apiKey: "test-provider-key", modelId: "model" }, input);
    expect(result.text).toBe("Answer"); expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].url).toBe("/v1/chat/completions");
    expect(server.requests[0].headers.authorization).toBe("Bearer test-provider-key");
    expect(server.requests[0].body).toEqual({ model: "model", stream: false, messages: [{ role: "system", content: "Be concise" }, ...input.messages] });
  });
  it("uses Gemini authentication, model roles, and output plus thought usage for Antigravity", async () => {
    const server = await api({ candidates: [{ content: { parts: [{ text: "private reasoning", thought: true }, { text: "Public answer" }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 20 } });
    const result = await completeHttp({ key: "agy/model", protocol: "gemini", baseUrl: `${server.baseUrl}/v1beta`, apiKey: "test-gemini-key", modelId: "models/gemini-test" }, input);
    expect(result.text).toBe("Public answer"); expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
    const request = server.requests[0];
    expect(request.url).toBe("/v1beta/models/gemini-test:generateContent");
    expect(request.headers["x-goog-api-key"]).toBe("test-gemini-key"); expect(request.headers.authorization).toBeUndefined();
    expect(request.body.systemInstruction).toEqual({ parts: [{ text: "Be concise" }] });
    expect(request.body.contents.map(value => value.role)).toEqual(["user", "model", "user"]);
  });
  it("rejects unsupported reasoning before making a request", async () => {
    const server = await api({});
    await expect(completeHttp({ protocol: "gemini", baseUrl: server.baseUrl, modelId: "model", supportsReasoning: false }, { ...input, thinkingLevel: "high" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(server.requests).toHaveLength(0);
  });
});
