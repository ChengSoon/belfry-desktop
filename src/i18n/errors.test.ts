import { afterEach, expect, it } from "vitest";
import { errorMessage, setLocalePreference } from ".";
import { failureLabel, toAppFailure } from "../workspace/errors";

afterEach(() => setLocalePreference("zh-CN"));
it("retains backend parameters and translates a stored failure again after a language change", () => {
  setLocalePreference("zh-CN");
  const failure = toAppFailure({ code: "ROOM_ROLE_NAME_LIMIT", params: { max: 24 }, message: "Role names may contain at most 24 characters.", retryable: false });
  expect(failure.params).toEqual({ max: 24 });
  expect(failureLabel(failure)).toBe("[ROOM_ROLE_NAME_LIMIT] 角色名最多 24 个字");
  setLocalePreference("en");
  expect(failureLabel(failure)).toBe("[ROOM_ROLE_NAME_LIMIT] Role names may contain at most 24 characters.");
});
it("keeps the specific English fallback for broad error categories", () => {
  expect(errorMessage({ code: "TIMEOUT", message: "The model catalog request timed out." })).toBe("The model catalog request timed out.");
});
