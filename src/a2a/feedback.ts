import { errorMessage, hasTranslation, t } from "../i18n";

/** Keep this formatter until render so native feedback follows language changes. */
export function a2aErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return errorMessage(error);
  const value = error as { code?: unknown; details?: { httpStatus?: unknown; rpcCode?: unknown; outcomeUnknown?: unknown } };
  const key = typeof value.code === "string" ? `a2a.errors.${value.code}` : "";
  if (!key || !hasTranslation(key)) return errorMessage(error);
  const parts = [t(key)];
  if (typeof value.details?.httpStatus === "number") parts.push(t("a2a.errors.httpStatus", { status: value.details.httpStatus }));
  if (typeof value.details?.rpcCode === "number") parts.push(t("a2a.errors.rpcCode", { code: String(value.details.rpcCode) }));
  if (value.details?.outcomeUnknown === true) parts.push(t("a2a.errors.outcomeUnknown"));
  return parts.join(" ");
}
