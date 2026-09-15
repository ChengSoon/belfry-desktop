import { dateParts } from "../../components/controls/dateModel";
import { numberFromDraft } from "../../components/controls/controlModel";
import { MAX_RATE } from "./contracts";
import { RATE_FIELDS, type PriceDraft } from "./draft";

/** 自定义字段的应用内校验，提交前检查原来由原生表单保护的边界。 */
export function priceFormError(draft: PriceDraft) {
  if (!draft.model.trim()) return "请填写模型名";
  if (!dateParts(draft.effectiveFrom)) return "请填写有效的生效日期（YYYY-MM-DD）";
  for (const { key, label } of RATE_FIELDS) {
    const value = numberFromDraft(draft.rates[key]);
    if (value === null || value < 0 || value > MAX_RATE) return `${label}单价须为 0 至 ${MAX_RATE} 的数字，免费请明确填 0`;
  }
  if (!draft.source.trim()) return "请填写价格来源";
  return null;
}
