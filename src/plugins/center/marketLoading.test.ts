import { beforeEach, describe, expect, it, vi } from "vitest";
import { centerApi, type MarketSnapshot } from "./api";
import { loadMarketSnapshot } from "./marketLoading";

vi.mock("./api", () => ({ centerApi: { marketSearch: vi.fn(), marketRefresh: vi.fn() } }));
const api = vi.mocked(centerApi);
const empty = (sourceUrl: string, cached = false): MarketSnapshot => ({ plugins: [], sourceUrl, cached });
const options = () => ({ query: "", remote: false, current: () => true, apply: vi.fn() });

describe("市场来源加载", () => {
  beforeEach(() => vi.resetAllMocks());

  it("新来源返回 404 时清除旧来源的卡片并保留失败地址", async () => {
    const target = empty("https://example.test/missing/catalog.json");
    api.marketSearch.mockResolvedValue(target);
    api.marketRefresh.mockRejectedValue(new Error("MARKET_NOT_FOUND: HTTP 404"));
    const input = options();
    await expect(loadMarketSnapshot(input)).rejects.toThrow("HTTP 404");
    expect(input.apply).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("同一来源刷新失败后仍显示该来源已验证的缓存", async () => {
    const target = empty("https://example.test/catalog.json", true);
    api.marketSearch.mockResolvedValue(target);
    api.marketRefresh.mockRejectedValue(new Error("offline"));
    const input = { ...options(), remote: true };
    await expect(loadMarketSnapshot(input)).rejects.toThrow("offline");
    expect(input.apply).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("填写自有市场地址之前不请求空地址", async () => {
    api.marketSearch.mockResolvedValue(empty(""));
    const input = options();
    await loadMarketSnapshot(input);
    expect(input.apply).toHaveBeenCalledExactlyOnceWith(empty(""));
    expect(api.marketRefresh).not.toHaveBeenCalled();
  });

  it("切换来源后忽略晚到的搜索结果", async () => {
    const input = { ...options(), current: () => false };
    api.marketSearch.mockResolvedValue(empty("https://old.test/catalog.json"));
    await loadMarketSnapshot(input);
    expect(input.apply).not.toHaveBeenCalled();
    expect(api.marketRefresh).not.toHaveBeenCalled();
  });

  it("远程请求期间切换来源后不再读取并展示旧请求的结果", async () => {
    let active = true;
    const input = { ...options(), remote: true, current: () => active };
    const target = empty("https://old.test/catalog.json", true);
    api.marketSearch.mockResolvedValue(target);
    api.marketRefresh.mockImplementation(async () => { active = false; return { sourceUrl: target.sourceUrl, pluginCount: 0 }; });
    await loadMarketSnapshot(input);
    expect(input.apply).toHaveBeenCalledExactlyOnceWith(target);
    expect(api.marketSearch).toHaveBeenCalledTimes(1);
  });
});
