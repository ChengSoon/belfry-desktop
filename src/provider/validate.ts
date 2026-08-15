import type { ProviderConfig, ProviderDraft } from "./contracts";

export interface DraftIssue {
  field: "name" | "baseUrl";
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
  return null;
}

/** 列表里显示用：把 key 抹成只剩头尾，够认出是哪一把就行。 */
export function maskKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) return "未填 key";
  if (value.length <= 12) return `${value.slice(0, 2)}${"·".repeat(6)}`;
  return `${value.slice(0, 6)}${"·".repeat(6)}${value.slice(-4)}`;
}
