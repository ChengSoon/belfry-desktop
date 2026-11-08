import { t } from "../../i18n";
import { dateParts } from "../../components/controls/dateModel";
import { numberFromDraft } from "../../components/controls/controlModel";
import { MAX_RATE } from "./contracts";
import { RATE_FIELDS, type PriceDraft } from "./draft";

/** 自定义字段的应用内校验，提交前检查原来由原生表单保护的边界。 */
export function priceFormError(draft: PriceDraft) {
  if (!draft.model.trim()) return t("usage.priceFormValidation.text_e8eba89113");
  if (!dateParts(draft.effectiveFrom)) return t("usage.priceFormValidation.text_a725d0464c");
  for (const { key, label } of RATE_FIELDS) {
    const value = numberFromDraft(draft.rates[key]);
    if (value === null || value < 0 || value > MAX_RATE) return t("usage.priceFormValidation.text_a4255ca31a", { label: label, limit: MAX_RATE });
  }
  if (!draft.source.trim()) return t("usage.priceFormValidation.text_152a08573c");
  return null;
}
