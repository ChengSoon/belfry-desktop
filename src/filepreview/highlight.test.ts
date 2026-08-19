import { describe, expect, it } from "vitest";
import { tokenClass } from "./highlight";

describe("file preview highlighting", () => {
  it("classifies the stable lightweight token categories", () => {
    expect(tokenClass("// note")).toBe("token-comment");
    expect(tokenClass("\"value\"")).toBe("token-string");
    expect(tokenClass("42")).toBe("token-number");
    expect(tokenClass("return")).toBe("token-keyword");
    expect(tokenClass("ProjectFile")).toBe("token-type");
    expect(tokenClass("value")).toBe("token-name");
  });
});
