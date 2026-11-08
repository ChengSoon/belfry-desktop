import { TranslationError, localized, t } from "../../i18n";
import type { UsageBucket } from "../insights/contracts";
import { type PriceRule } from "./contracts";

export interface PriceDraft extends Omit<PriceRule, "rates" | "aliases" | "projectRoot"> {
  rates: Record<keyof PriceRule["rates"], string>;
  aliases: string;
  projectRoot: string;
}

export const RATE_FIELDS = localized(() => ([
  { key: "input", label: t("usage.draft.text_8936889d9d") }, { key: "cachedInput", label: t("usage.draft.text_1ded6559f6") },
  { key: "cacheWrite", label: t("usage.draft.text_6078a681a3") }, { key: "output", label: t("usage.draft.text_fb04addb4c") },
] as const));

export function createPriceDraft(rule: PriceRule | null, sample?: UsageBucket): PriceDraft {
  return {
    id: rule?.id ?? crypto.randomUUID(), agent: rule?.agent ?? sample?.agent ?? "codex",
    model: rule?.model ?? sample?.model ?? "", aliases: rule?.aliases.join(", ") ?? "",
    projectRoot: rule?.projectRoot ?? "", currency: rule?.currency ?? "USD",
    effectiveFrom: rule?.effectiveFrom ?? new Date().toISOString().slice(0, 10), source: rule?.source ?? "",
    rates: Object.fromEntries(RATE_FIELDS.map(({ key }) => [key, rule ? String(rule.rates[key]) : ""])) as PriceDraft["rates"],
  };
}

export function priceFromDraft(draft: PriceDraft): PriceRule {
  if (RATE_FIELDS.some(({ key }) => draft.rates[key].trim() === "")) throw new TranslationError("usage.draft.text_0910db838a");
  return {
    ...draft, model: draft.model.trim(), source: draft.source.trim(),
    aliases: draft.aliases.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean),
    projectRoot: draft.projectRoot || null,
    rates: { input: Number(draft.rates.input), cachedInput: Number(draft.rates.cachedInput),
      cacheWrite: Number(draft.rates.cacheWrite), output: Number(draft.rates.output) },
  };
}
