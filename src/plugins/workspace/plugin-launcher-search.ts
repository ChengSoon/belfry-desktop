// Adapted from PI-Desktop, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { pinyin } from "pinyin-pro";
import type { PluginSummary } from "../center/types";

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function pinyinTokens(value: string): { full: string; initials: string } {
  return {
    full: normalizeSearchText(
      pinyin(value, { toneType: "none", type: "array" }).join(""),
    ),
    initials: normalizeSearchText(
      pinyin(value, {
        pattern: "first",
        toneType: "none",
        type: "array",
      }).join(""),
    ),
  };
}

export function isLaunchablePlugin(plugin: PluginSummary): boolean {
  return Boolean(plugin.enabled && plugin.status === "ready" && plugin.ui?.panel);
}

export function searchLaunchablePlugins(
  plugins: readonly PluginSummary[],
  query: string,
  recentIds?: readonly string[],
): PluginSummary[] {
  const normalizedQuery = normalizeSearchText(query);
  const recencyRank = new Map(recentIds?.map((id, index) => [id, index]) ?? []);
  return plugins
    .filter(isLaunchablePlugin)
    .map((plugin, index) => {
      return {
        plugin,
        score: searchScore(plugin, normalizedQuery),
        index,
        recentRank: recencyRank.get(plugin.id) ?? recencyRank.size,
      };
    })
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.recentRank - right.recentRank ||
        left.plugin.name.localeCompare(right.plugin.name) ||
        left.index - right.index,
    )
    .map(({ plugin }) => plugin);
}

function searchScore(plugin: PluginSummary, query: string) {
  if (!query) return 0;
  const names = [plugin.name, plugin.id].map(normalizeSearchText);
  const romanized = pinyinTokens(plugin.name);
  const matches = [names.includes(query), names.some((name) => name.startsWith(query)),
    romanized.full.startsWith(query), romanized.initials.startsWith(query), names.some((name) => name.includes(query)),
    [romanized.full, romanized.initials].some((name) => name.includes(query)), normalizeSearchText(plugin.description ?? "").includes(query)];
  const rank = matches.indexOf(true);
  return rank < 0 ? Number.POSITIVE_INFINITY : rank + 1;
}
