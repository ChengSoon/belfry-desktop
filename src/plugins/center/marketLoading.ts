import { centerApi, type MarketSnapshot } from "./api";

interface MarketLoad {
  query: string;
  remote: boolean;
  current: () => boolean;
  apply: (snapshot: MarketSnapshot) => void;
}

export async function loadMarketSnapshot({ query, remote, current, apply }: MarketLoad) {
  const cached = await centerApi.marketSearch(query);
  if (!current()) return;
  // 先显示当前来源的缓存；远程失败时不能留下另一个来源的插件卡片。
  apply(cached);
  if (!remote && (cached.cached !== false || !cached.sourceUrl)) return;
  await centerApi.marketRefresh();
  if (!current()) return;
  const refreshed = await centerApi.marketSearch(query);
  if (current()) apply(refreshed);
}
