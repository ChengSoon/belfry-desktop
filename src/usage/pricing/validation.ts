import { MAX_PRICE_RULES, MAX_RATE, type PriceBook, type PriceRule } from "./contracts";
import { pathKey } from "../../workspace/path";

const MAX_MODEL_LENGTH = 512;
const MAX_PATH_LENGTH = 32_768;
const MAX_SOURCE_LENGTH = 500;
const MAX_ALIASES = 12;

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function ruleError(rule: unknown): string | null {
  if (!object(rule) || !text(rule.id, 128) || !text(rule.model, MAX_MODEL_LENGTH)) return "价格条目缺少有效标识或模型名";
  if (rule.agent !== "codex" && rule.agent !== "claude") return "请选择 Codex 或 Claude Code";
  if (rule.projectRoot !== null && !text(rule.projectRoot, MAX_PATH_LENGTH)) return "项目路径无效";
  if (!text(rule.source, MAX_SOURCE_LENGTH)) return "请填写价格来源";
  if (typeof rule.effectiveFrom !== "string" || !validDate(rule.effectiveFrom)) return "生效日期无效";
  if (rule.currency !== "USD" && rule.currency !== "CNY") return "只支持 USD 或 CNY，币种之间不自动换算";
  if (!Array.isArray(rule.aliases) || rule.aliases.length > MAX_ALIASES
      || rule.aliases.some((value) => !text(value, MAX_MODEL_LENGTH))) return "模型别名无效或超过 12 个";
  if (new Set([rule.model, ...rule.aliases]).size !== rule.aliases.length + 1) return "模型名与别名不能重复";
  if (!object(rule.rates)) return "请填写四类 Token 单价";
  for (const key of ["input", "cachedInput", "cacheWrite", "output"]) {
    const rate = rule.rates[key];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) {
      return "四类单价均须为 0 到 1000000 之间的有限数值";
    }
  }
  return null;
}

function collision(rules: PriceRule[]): string | null {
  const identifiers = new Set<string>();
  const matches = new Set<string>();
  for (const rule of rules) {
    if (identifiers.has(rule.id)) return "价格条目标识重复";
    identifiers.add(rule.id);
    for (const model of [rule.model, ...rule.aliases]) {
      const key = JSON.stringify([rule.agent, model, rule.projectRoot === null ? null : pathKey(rule.projectRoot), rule.effectiveFrom]);
      if (matches.has(key)) return "同一项目、模型和生效日期存在重复价格或冲突别名";
      matches.add(key);
    }
  }
  return null;
}

export function validatePriceBook(value: unknown): { book: PriceBook | null; error: string | null } {
  if (!object(value) || value.version !== 1) return { book: null, error: "价格存档版本不受支持，原内容已保留" };
  if (!Array.isArray(value.rules) || value.rules.length > MAX_PRICE_RULES) return { book: null, error: "价格条目无效或超过 256 条" };
  for (const rule of value.rules) {
    const error = ruleError(rule);
    if (error) return { book: null, error };
  }
  const book = value as unknown as PriceBook;
  const error = collision(book.rules);
  return { book: error ? null : book, error };
}
