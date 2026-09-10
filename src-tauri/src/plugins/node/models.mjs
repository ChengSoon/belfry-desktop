import { apiError, permission } from "./errors.mjs";
import { completeHttp } from "./model-http.mjs";
import { qualified } from "./mcp-names.mjs";
import { readSessionContext } from "./session-context.mjs";

const SYSTEM_CHARS = 32 * 1024, MESSAGE_CHARS = 200_000, RATE_WINDOW = 60_000, RATE_COUNT = 8, TIMEOUT = 90_000;
function validate(input) {
  if (!input || typeof input.modelKey !== "string" || !/^[^/\s]+\/.{1,256}$/.test(input.modelKey)) throw apiError("INVALID_ARGUMENT", "modelKey 必须为 providerId/modelId");
  const system = input.system ?? "", messages = input.messages ?? [];
  validateMessages(system, messages);
  return { modelKey: input.modelKey, system, messages: messages.map(({ role, content }) => ({ role, content })), thinkingLevel: input.thinkingLevel,
    includeSessionContext: input.includeSessionContext === true };
}
function validateMessages(system, messages) {
  if (typeof system !== "string" || system.length > SYSTEM_CHARS || !Array.isArray(messages)
    || messages.some(item => !item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string")
    || messages.reduce((sum, item) => sum + item.content.length, 0) > MESSAGE_CHARS) throw apiError("INVALID_ARGUMENT", "模型输入格式无效或超过长度限制");
}
function active(context) { if (context.expired) throw apiError("SESSION_EXPIRED", "Agent 会话已失效"); }
export class PluginModels {
  constructor(platform) { this.platform = platform; }
  async list(entry, context) {
    permission(entry, "models.list");
    const models = await this.platform({ api: "models.list", pluginId: entry.manifest.id, args: [] }); active(context);
    if (!Array.isArray(models)) throw apiError("MODEL_ERROR", "模型目录无效");
    return models.map(({ key, providerId, providerName, modelId, label, supportsReasoning, thinkingLevels }) =>
      ({ key, providerId, providerName, modelId, label, supportsReasoning, thinkingLevels }));
  }
  async session(entry, context) {
    permission(entry, "session.read"); active(context);
    if (!context.toolName || !context.sessionId) throw apiError("INVALID_ARGUMENT", "会话上下文仅在 Agent 工具执行期间可用");
    const result = await readSessionContext(context, qualified(entry.manifest.id, context.toolName), async (modelId) => {
      const models = await this.platform({ api: "models.list", pluginId: entry.manifest.id, args: [] });
      const matches = Array.isArray(models) ? models.filter((model) => model.modelId === modelId) : [];
      return matches.length === 1 ? matches[0].key : null;
    });
    active(context); return result;
  }
  rate(entry) {
    if (!entry.completeRate || Date.now() - entry.completeRate.start >= RATE_WINDOW) entry.completeRate = { start: Date.now(), count: 0 };
    if (++entry.completeRate.count > RATE_COUNT) throw apiError("RATE_LIMITED", "插件模型调用过于频繁，请稍后重试");
  }
  async complete(entry, raw, context) {
    permission(entry, "agent.complete"); active(context);
    const input = validate(raw);
    if (input.includeSessionContext) {
      const snapshot = await this.session(entry, context);
      input.messages.unshift(...snapshot.messages.filter(item => item.content && item.toolName !== context.toolName)
        .map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content })));
      while (input.messages.length > 1 && input.messages.reduce((sum, item) => sum + item.content.length, 0) > MESSAGE_CHARS) input.messages.shift();
    }
    this.rate(entry);
    const route = await this.platform({ api: "models.resolve", pluginId: entry.manifest.id, args: [input.modelKey] }); active(context);
    if (!route || route.key !== input.modelKey) throw apiError("NOT_FOUND", "模型已移除或尚未配置");
    const signals = [entry.abort.signal, AbortSignal.timeout(TIMEOUT)];
    if (context.abort?.signal) signals.push(context.abort.signal);
    try {
      const result = await completeHttp(route, input, AbortSignal.any(signals)); active(context); return result;
    } catch (error) {
      active(context);
      if (error.name === "TimeoutError") throw apiError("TIMEOUT", "模型调用超过 90 秒");
      if (error.code) throw error;
      throw apiError("MODEL_ERROR", "模型请求中断或连接失败");
    }
  }
}
