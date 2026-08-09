import type { AppFailure } from "./contracts";

export function toAppFailure(error: unknown): AppFailure {
  if (typeof error === "object" && error) {
    const value = error as Record<string, unknown>;
    return {
      code: typeof value.code === "string" ? value.code : "UNKNOWN",
      message: typeof value.message === "string" ? value.message : String(error),
      retryable: value.retryable === true,
    };
  }
  return { code: "UNKNOWN", message: String(error), retryable: false };
}

export function failureLabel(failure: AppFailure) {
  return `[${failure.code}] ${failure.message}`;
}
