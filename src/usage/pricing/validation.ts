import { t } from "../../i18n";
import { isAgentKind } from "../../agent/contracts";
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
  if (!object(rule) || !text(rule.id, 128) || !text(rule.model, MAX_MODEL_LENGTH)) return t("usage.validation.text_f3f3a08e7e");
  if (!isAgentKind(rule.agent)) return t("usage.validation.text_d3efce3e55");
  if (rule.projectRoot !== null && !text(rule.projectRoot, MAX_PATH_LENGTH)) return t("usage.validation.text_51df932da8");
  if (!text(rule.source, MAX_SOURCE_LENGTH)) return t("usage.validation.text_152a08573c");
  if (typeof rule.effectiveFrom !== "string" || !validDate(rule.effectiveFrom)) return t("usage.validation.text_06e53b5a5a");
  if (rule.currency !== "USD" && rule.currency !== "CNY") return t("usage.validation.text_dff600697b");
  if (!Array.isArray(rule.aliases) || rule.aliases.length > MAX_ALIASES
      || rule.aliases.some((value) => !text(value, MAX_MODEL_LENGTH))) return t("usage.validation.text_4370e6fdb2");
  if (new Set([rule.model, ...rule.aliases]).size !== rule.aliases.length + 1) return t("usage.validation.text_e76447672c");
  if (!object(rule.rates)) return t("usage.validation.text_32205ea936");
  for (const key of ["input", "cachedInput", "cacheWrite", "output"]) {
    const rate = rule.rates[key];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) {
      return t("usage.validation.text_e0ba199de1");
    }
  }
  return null;
}

function collision(rules: PriceRule[]): string | null {
  const identifiers = new Set<string>();
  const matches = new Set<string>();
  for (const rule of rules) {
    if (identifiers.has(rule.id)) return t("usage.validation.text_2d79b40707");
    identifiers.add(rule.id);
    for (const model of [rule.model, ...rule.aliases]) {
      const key = JSON.stringify([rule.agent, model, rule.projectRoot === null ? null : pathKey(rule.projectRoot), rule.effectiveFrom]);
      if (matches.has(key)) return t("usage.validation.text_eb313db627");
      matches.add(key);
    }
  }
  return null;
}

export function validatePriceBook(value: unknown): { book: PriceBook | null; error: string | null } {
  if (!object(value) || value.version !== 1) return { book: null, error: t("usage.validation.text_3d55a949ca") };
  if (!Array.isArray(value.rules) || value.rules.length > MAX_PRICE_RULES) return { book: null, error: t("usage.validation.text_8054eb56d3") };
  for (const rule of value.rules) {
    const error = ruleError(rule);
    if (error) return { book: null, error };
  }
  const book = value as unknown as PriceBook;
  const error = collision(book.rules);
  return { book: error ? null : book, error };
}
