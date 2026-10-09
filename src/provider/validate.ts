import type { ProviderConfig, ProviderDraft } from "./contracts";

export interface DraftIssue {
  field: "name" | "baseUrl" | "apiKey";
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
): DraftIssue | null {
  const name = draft.name.trim();
  if (!name) {
    return { field: "name", message: "给它起个名字" };
  }
  const duplicate = existing.some(
    (item) => item.id !== draft.id && item.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    return { field: "name", message: "已经有同名的了" };
  }

  const baseUrl = draft.baseUrl.trim();
  if (!baseUrl) {
    return { field: "baseUrl", message: "Base URL 不能为空" };
  }
  // 用 URL 解析而不是正则匹配 `^https?://`：真实配置里存在 `https:\host` 这种
  // 单反斜杠写法，WHATWG 规范规定 special scheme 后的 `\` 等价于 `/`，CLI 那边
  // 照样跑得通。正则会把这类已经在用的地址判死，而用户根本没动过这个字段。
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { field: "baseUrl", message: "要以 http:// 或 https:// 开头" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { field: "baseUrl", message: "只支持 http / https" };
  }
  if (draft.apiKeyAction === "replace" && !draft.apiKey.trim()) {
    return { field: "apiKey", message: "请输入新密钥；如需移除密钥，请显式选择清除。" };
  }
  const original = existing.find((item) => item.id === draft.id);
  if (draft.apiKeyAction === "keep" && original && original.baseUrl.trim() !== baseUrl) {
    return { field: "apiKey", message: "更改 Base URL 后必须替换或清除密钥，不能保留原密钥。" };
  }
  return null;
}
