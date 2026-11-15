import { afterEach, expect, it } from "vitest";
import { setLocalePreference } from "../i18n";
import { a2aErrorMessage } from "./feedback";

afterEach(() => { setLocalePreference("zh-CN"); });

it("keeps HTTP/RPC evidence and uncertain outcomes readable after changing language", () => {
  const failure = { code: "A2A_HTTP_ERROR", message: "Native error", details: { httpStatus: 503, rpcCode: -32002, outcomeUnknown: true } };
  setLocalePreference("zh-CN"); expect(a2aErrorMessage(failure)).toContain("发送结果未知");
  setLocalePreference("en");
  const message = a2aErrorMessage(failure);
  expect(message).toContain("503"); expect(message).toContain("-32002"); expect(message).toContain("send outcome is unknown");
  expect(message).not.toMatch(/\p{Script=Han}/u);
});
