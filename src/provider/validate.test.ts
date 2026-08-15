import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderDraft } from "./contracts";
import { maskKey, validateDraft } from "./validate";

function draft(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    id: null,
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/anthropic",
    apiKey: "sk-test",
    model: "",
    ...overrides,
  };
}

function existing(name: string, id = "other"): ProviderConfig {
  return {
    id,
    name,
    baseUrl: "https://example.com",
    apiKey: "",
    model: "",
    createdAt: 0,
  };
}

describe("validateDraft", () => {
  it("accepts a well formed draft", () => {
    expect(validateDraft(draft(), [])).toBeNull();
  });

  it("rejects a name that is only whitespace", () => {
    expect(validateDraft(draft({ name: "   " }), [])?.field).toBe("name");
  });

  it("rejects a duplicate name regardless of case", () => {
    // 同名两条在列表里根本分不出谁是谁，切错了也看不出来。
    const issue = validateDraft(draft({ name: "kimi" }), [existing("Kimi")]);
    expect(issue?.field).toBe("name");
  });

  it("lets an entry keep its own name while editing", () => {
    const issue = validateDraft(draft({ id: "self", name: "Kimi" }), [existing("Kimi", "self")]);
    expect(issue).toBeNull();
  });

  it("rejects a base url without a scheme", () => {
    // 少了 scheme 的地址喂给 CLI 只会得到一个难懂的连接错误。
    expect(validateDraft(draft({ baseUrl: "api.moonshot.cn" }), [])?.field).toBe("baseUrl");
  });

  it("rejects a scheme the agents cannot speak", () => {
    expect(validateDraft(draft({ baseUrl: "ftp://relay.example.com" }), [])?.field).toBe("baseUrl");
  });

  it("accepts the single-backslash form found in real config files", () => {
    // 真实的 ~/.claude/settings.json 里就有 `https:\host` 这种写法，而且它在跑。
    // WHATWG 规范里 special scheme 后的 `\` 等价于 `/`，把它判死会让接管进来的
    // 条目一点「编辑」就卡住，可用户根本没动过这个字段。
    expect(validateDraft(draft({ baseUrl: "https:\\sub2api.example.org" }), [])).toBeNull();
  });

  it("accepts plain http for self hosted relays", () => {
    expect(validateDraft(draft({ baseUrl: "http://127.0.0.1:8080/v1" }), [])).toBeNull();
  });

  it("does not require a model", () => {
    // 留空的含义是「沿用 CLI 自己的设置」，不是错误。
    expect(validateDraft(draft({ model: "" }), [])).toBeNull();
  });
});

describe("maskKey", () => {
  it("keeps enough of a long key to tell two apart", () => {
    const masked = maskKey("sk-abcdefghijklmnop1234");
    expect(masked.startsWith("sk-abc")).toBe(true);
    expect(masked.endsWith("1234")).toBe(true);
    expect(masked).not.toContain("defghijklmnop");
  });

  it("does not leak a short key by showing most of it", () => {
    expect(maskKey("sk-123")).toBe("sk······");
  });

  it("says so when there is no key at all", () => {
    expect(maskKey("   ")).toBe("未填 key");
  });
});
