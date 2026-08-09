import { describe, expect, it } from "vitest";
import { acceptSequence } from "./sequence";

describe("acceptSequence", () => {
  it("advances ordered terminal output", () => {
    expect(acceptSequence(4, 4)).toBe(5);
  });

  it("rejects duplicate or out-of-order output", () => {
    expect(() => acceptSequence(4, 3)).toThrow("expected 4, received 3");
  });
});
