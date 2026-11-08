import { afterEach, expect, it, vi } from "vitest";
import { errorMessage, formatCurrency, formatDateTime, formatNumber, localized, setLocalePreference, t, TranslationError } from "./index";
import { toAppFailure } from "../workspace/errors";
import { synchronizeLocale } from "./store";

afterEach(() => { setLocalePreference("system"); vi.restoreAllMocks(); });
it("retains a validation error and structured backend params across language changes", () => {
  setLocalePreference("zh-CN");
  const validation = toAppFailure(new TranslationError("provider.validate.text_a728855726"));
  const wire = { code: "ROOM_ROLE_NAME_LIMIT", params: { max: 24 }, message: "Wire fallback", retryable: false };
  const failure = toAppFailure(wire);
  expect(errorMessage(validation)).toMatch(/\p{Script=Han}/u);
  expect(errorMessage(failure)).toContain("24");
  setLocalePreference("en");
  expect(errorMessage(validation)).not.toMatch(/\p{Script=Han}/u);
  expect(errorMessage(failure)).not.toMatch(/\p{Script=Han}/u);
  expect(errorMessage(failure)).toContain("24");
  expect(wire.message).toBe("Wire fallback");
  expect(errorMessage({ code: "UNKNOWN_NEW_CODE", message: "Specific detail" })).toBe("Specific detail");
});
it("refreshes module-level labels and number/date formatters without replacing the collection", () => {
  const labels = localized(() => [{ label: t("common.close") }]);
  setLocalePreference("zh-CN"); expect(labels.map(value => value.label)).toEqual(["关闭"]);
  setLocalePreference("en"); expect(labels.map(value => value.label)).toEqual(["Close"]);
  expect(formatNumber(1234.5)).toBe("1,234.5");
  expect(formatCurrency(12.5)).toBe("$12.50");
  expect(formatDateTime("2026-11-08T00:00:00Z", { month: "long", day: "numeric", timeZone: "UTC" })).toBe("November 8");
});
it("warns only once per missing development key", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  setLocalePreference("en");
  expect(t("test.missing", { defaultValue: "Fallback" })).toBe("Fallback");
  t("test.missing");
  expect(warn).toHaveBeenCalledTimes(1);
});
it("serializes native language updates and continues after a failed write", async () => {
  const calls: string[] = [];
  let release!: () => void;
  setLocalePreference("zh-CN");
  const stop = synchronizeLocale(async locale => {
    calls.push(locale);
    if (calls.length === 1) { await new Promise<void>(resolve => { release = resolve; }); throw Error("Unavailable"); }
  });
  try {
    await vi.waitFor(() => expect(calls).toEqual(["zh-CN"]));
    setLocalePreference("en"); setLocalePreference("zh-CN");
    expect(calls).toEqual(["zh-CN"]); release();
    await vi.waitFor(() => expect(calls).toEqual(["zh-CN", "en", "zh-CN"]));
  } finally { stop(); }
});
