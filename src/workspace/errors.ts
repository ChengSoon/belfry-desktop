import type { AppFailure } from "./contracts";
import { errorMessage } from "../i18n";

export function toAppFailure(error: unknown): AppFailure {
  if (typeof error === "object" && error) {
    const value = error as Record<string, unknown>;
    const params = value.params && typeof value.params === "object" && !Array.isArray(value.params)
      ? Object.fromEntries(Object.entries(value.params).filter(([, item]) => typeof item === "string" || typeof item === "number")) as Record<string, string | number>
      : undefined;
    return {
      code: typeof value.code === "string" ? value.code : "UNKNOWN",
      get message() { return errorMessage(error); },
      retryable: value.retryable === true,
      ...(params ? { params } : {}),
    };
  }
  return { code: "UNKNOWN", message: String(error), retryable: false };
}

export function failureLabel(failure: AppFailure) {
  return `[${failure.code}] ${errorMessage(failure)}`;
}
