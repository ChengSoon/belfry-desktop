import type { ThemeMode } from "../theme/contracts";
import {
  BACKGROUND_FITS,
  DEFAULT_BACKGROUND,
  MAX_BLUR,
  type BackgroundConfig,
  type BackgroundFit,
} from "./contracts";

/**
 * 不像主题那样有 index.html 的首帧脚本兜底：背景图要等后端把字节读上来才谈得上铺，
 * 首帧根本判不出这张图还在不在（用户可能已经手动删了文件）。
 * 所以 data-background 一律等 Blob 就绪再切，见 BackgroundProvider。
 */
export const BACKGROUND_KEY = "belfry.background.v1";

export function loadBackground(
  storage: Pick<Storage, "getItem"> = localStorage,
): BackgroundConfig {
  try {
    return parseBackground(storage.getItem(BACKGROUND_KEY));
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

export function saveBackground(
  config: BackgroundConfig,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(BACKGROUND_KEY, JSON.stringify(config));
  } catch {
    // 存不下就算了，背景是纯装饰，不值得把一次设置操作整个失败掉。
  }
}

/**
 * 每个字段都独立校验并钳制到合法区间。
 *
 * 这份 JSON 用户随时能在 devtools 里改坏，也可能是旧版本留下的半个结构；
 * 任何一个字段坏掉都只退回它自己的默认值，不牵连其它字段。
 */
export function parseBackground(value: string | null): BackgroundConfig {
  if (!value) return DEFAULT_BACKGROUND;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return DEFAULT_BACKGROUND;
  }
  if (typeof raw !== "object" || raw === null) return DEFAULT_BACKGROUND;
  const record = raw as Record<string, unknown>;

  return {
    fileName: nonEmptyString(record.fileName),
    mime: nonEmptyString(record.mime),
    fit: parseFit(record.fit),
    opacity: clamp(record.opacity, 0, 1, DEFAULT_BACKGROUND.opacity),
    blur: clamp(record.blur, 0, MAX_BLUR, DEFAULT_BACKGROUND.blur),
    veil: parseVeil(record.veil),
    videoPaused: typeof record.videoPaused === "boolean"
      ? record.videoPaused
      : DEFAULT_BACKGROUND.videoPaused,
  };
}

/**
 * veil 从单一数值改成了亮暗两份，旧配置里它是个 number。
 *
 * 迁移只把旧值继承给暗色，亮色一律取新默认值：那时候滑块是主题无关的一根，
 * 用户拖它时表达的是"背景图该透多少"，并没有为亮色单独定过浓度——而亮色恰恰是
 * 55% 明显不够、这次要修的那一侧。继承过去等于把 bug 一起迁移了。
 */
function parseVeil(value: unknown): Record<ThemeMode, number> {
  if (typeof value === "number") {
    return {
      dark: clamp(value, 0, 1, DEFAULT_BACKGROUND.veil.dark),
      light: DEFAULT_BACKGROUND.veil.light,
    };
  }
  const record = typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
  return {
    dark: clamp(record.dark, 0, 1, DEFAULT_BACKGROUND.veil.dark),
    light: clamp(record.light, 0, 1, DEFAULT_BACKGROUND.veil.light),
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseFit(value: unknown): BackgroundFit {
  return BACKGROUND_FITS.includes(value as BackgroundFit)
    ? (value as BackgroundFit)
    : DEFAULT_BACKGROUND.fit;
}

/** NaN / Infinity / 字符串数字一律当没填，退回默认值而不是 0。 */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
