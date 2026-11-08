import { t } from "../i18n";
import type { ProviderConfig, ProviderDraft } from "./contracts";
import type { AgentKind } from "../agent/contracts";

export interface DraftIssue {
  field: "name" | "baseUrl" | "apiKey" | "model";
  message: string;
}

/**
 * 表单校验。后端还会再拦一道（`ProviderDraft::validate`），这里是为了
 * 在用户按下保存之前就把问题指出来，而不是等一个来回的报错。
 *
 * `existing` 用来查重名——同一个 agent 下两条同名 provider，列表里根本分不出谁是谁。
 */
export function validateDraft(
  draft: ProviderDraft,
  existing: readonly ProviderConfig[],
  kind?: AgentKind,
): DraftIssue | null {
  const name = draft.name.trim();
  if (!name) {
    return { field: "name", get message() { return t("provider.validate.text_a728855726"); } };
  }
  const duplicate = existing.some(
    (item) => item.id !== draft.id && item.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    return { field: "name", get message() { return t("provider.validate.text_65f10a6212"); } };
  }

  const baseUrl = draft.baseUrl.trim();
  if (!baseUrl) {
    return { field: "baseUrl", get message() { return t("provider.validate.text_54bc198421"); } };
  }
  // 用 URL 解析而不是正则匹配 `^https?://`：真实配置里存在 `https:\host` 这种
  // 单反斜杠写法，WHATWG 规范规定 special scheme 后的 `\` 等价于 `/`，CLI 那边
  // 照样跑得通。正则会把这类已经在用的地址判死，而用户根本没动过这个字段。
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { field: "baseUrl", get message() { return t("provider.validate.text_529a58b477"); } };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { field: "baseUrl", get message() { return t("provider.validate.text_db1d56f665"); } };
  }
  if (draft.apiKeyAction === "replace" && !draft.apiKey.trim()) {
    return { field: "apiKey", get message() { return t("provider.validate.text_bd43578716"); } };
  }
  const original = existing.find((item) => item.id === draft.id);
  if (draft.apiKeyAction === "keep" && original && original.baseUrl.trim() !== baseUrl) {
    return { field: "apiKey", get message() { return t("provider.validate.text_0ffa0e2d9e"); } };
  }
  if (kind && ["antigravity", "opencode", "kimi"].includes(kind) && !draft.model.trim()) {
    return { field: "model", get message() { return t("provider.validate.text_5a3cc90819"); } };
  }
  return null;
}
