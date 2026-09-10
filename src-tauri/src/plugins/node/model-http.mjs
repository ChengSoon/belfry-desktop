import { apiError } from "./errors.mjs";

const RESPONSE_LIMIT = 1024 * 1024;
function endpoint(route) {
  let url; try { url = new URL(route.baseUrl); } catch { throw apiError("INVALID_ARGUMENT", "Provider 地址无效"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw apiError("INVALID_ARGUMENT", "Provider 地址无效");
  const suffix = route.protocol === "anthropic" ? "/messages" : "/responses";
  url.pathname = endpointPath(url.pathname, suffix, route.protocol);
  return url;
}
function endpointPath(pathname, suffix, protocol) {
  const path = pathname.replace(/\/$/, "");
  if (path.endsWith(suffix)) return path;
  const version = protocol === "anthropic" && path && !path.endsWith("/v1") ? "/v1" : "";
  return `${path || "/v1"}${version}${suffix}`;
}
function requestBody(route, input) {
  const thinking = input.thinkingLevel && input.thinkingLevel !== "off" ? input.thinkingLevel : undefined;
  if (thinking && (!route.supportsReasoning || !route.thinkingLevels.includes(thinking))) throw apiError("INVALID_ARGUMENT", "该模型不支持所选思考等级");
  if (route.protocol === "responses") return { model: route.modelId, input: input.messages,
    instructions: input.system || undefined, store: false, stream: false,
    ...(thinking ? { reasoning: { effort: thinking } } : {}) };
  if (route.protocol !== "anthropic") throw apiError("UNSUPPORTED", "Provider 协议暂不可用");
  return anthropicBody(route, input, thinking);
}
function anthropicBody(route, input, thinking) {
  const budget = { low: 1024, medium: 4096, high: 8192 }[thinking];
  return { model: route.modelId, messages: input.messages, system: input.system || undefined,
    max_tokens: budget ? budget + 8192 : 8192, stream: false,
    ...(budget ? { thinking: { type: "enabled", budget_tokens: budget } } : {}) };
}
async function responseValue(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw apiError("MODEL_ERROR", `模型请求失败（HTTP ${response.status}），请检查 Provider 配置`);
  }
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > RESPONSE_LIMIT) throw apiError("LIMIT_EXCEEDED", "模型响应超过大小限制");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw apiError("MODEL_ERROR", "模型服务返回了无效的 JSON"); }
}
export async function completeHttp(route, input, signal) {
  const headers = requestHeaders(route);
  const body = requestBody(route, input), url = endpoint(route);
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal });
  const value = await responseValue(response);
  const result = { text: completionText(value, route.protocol), modelKey: route.key, thinkingLevel: input.thinkingLevel };
  if (value.usage) result.usage = completionUsage(value.usage);
  if (Buffer.byteLength(JSON.stringify(result)) > RESPONSE_LIMIT * 0.9) throw apiError("LIMIT_EXCEEDED", "模型回复超过插件传输限制");
  return result;
}
function requestHeaders(route) {
  const headers = { "Content-Type": "application/json" };
  if (route.apiKey) headers.Authorization = `Bearer ${route.apiKey}`;
  if (route.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (route.apiKey) headers["x-api-key"] = route.apiKey;
  }
  return headers;
}
function completionText(value, protocol) {
  if (value.error || value.status === "failed") throw apiError("MODEL_ERROR", "模型服务未能生成回复");
  const parts = protocol === "responses" ? (value.output ?? []).flatMap(item => item.type === "message" ? item.content ?? [] : []) : value.content ?? [];
  const text = parts.filter(item => ["text", "output_text"].includes(item.type)).map(item => item.text ?? "").join("");
  if (!text && value.status === "incomplete") throw apiError("MODEL_ERROR", "模型回复未完成，请调整思考等级后重试");
  return text;
}
function completionUsage(usage) {
  const inputTokens = usage.input_tokens ?? 0, outputTokens = usage.output_tokens ?? 0;
  return { inputTokens, outputTokens, totalTokens: usage.total_tokens ?? inputTokens + outputTokens };
}
