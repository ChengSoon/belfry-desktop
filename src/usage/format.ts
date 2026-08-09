import type { TokenTotals } from "./contracts";

export function totalTokens(tokens: TokenTotals) {
  return tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;
}

/**
 * 紧凑 token 计数。用量常达上亿，完整数字在窄侧栏里放不下也不便比较。
 * 保留一位小数，整数则省略小数位（1.0M → 1M）。
 */
export function formatTokens(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0";
  const units: { limit: number; suffix: string }[] = [
    { limit: 1e9, suffix: "B" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "k" },
  ];
  for (const { limit, suffix } of units) {
    if (value >= limit) {
      const scaled = value / limit;
      const text = scaled >= 100 ? Math.round(scaled).toString() : trimZero(scaled.toFixed(1));
      return `${text}${suffix}`;
    }
  }
  return Math.round(value).toString();
}

function trimZero(value: string) {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/** 精确数字，用于 title 悬浮提示，补足紧凑显示丢掉的精度。 */
export function formatExact(value: number) {
  return value.toLocaleString("zh-CN");
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  const clamped = Math.min(Math.max(value, 0), 100);
  return `${clamped % 1 === 0 ? clamped : Number(clamped.toFixed(1))}%`;
}

/** 进度条宽度，超过 100% 的异常值截到 100 避免溢出容器。 */
export function percentWidth(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

/** 额度窗口长度。日志给的是分钟，换成人读的天/小时。 */
export function formatWindow(minutes: number | null) {
  if (!minutes || minutes <= 0) return null;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时窗口`;
  return `${minutes} 分钟窗口`;
}

/** epoch 秒 → 本地日期时间。 */
export function formatMoment(epochSeconds: number | null) {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 相对当下的粗粒度描述，用于"最后使用"。 */
export function formatRelative(epochSeconds: number | null, now = Date.now()) {
  if (!epochSeconds) return null;
  const deltaSeconds = Math.floor(now / 1000) - epochSeconds;
  if (deltaSeconds < 0) return "刚刚";
  if (deltaSeconds < 60) return "刚刚";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)} 分钟前`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)} 小时前`;
  return `${Math.floor(deltaSeconds / 86400)} 天前`;
}

export function agentLabel(agent: string) {
  return agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : agent;
}
