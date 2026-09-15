import { expect, it } from "vitest";
import { Utf8Boundary } from "./utf8Boundary";

const encoder = new TextEncoder();

it("keeps each emitted UTF-8 chunk valid and retains at most three source bytes", () => {
  const boundary = new Utf8Boundary();
  const source = encoder.encode("A状态怀念𠀁😀中文\x1b[31m");
  const output: number[] = [];
  for (const [index, byte] of source.entries()) {
    const chunk = boundary.push(Uint8Array.of(byte));
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(chunk)).not.toThrow();
    output.push(...chunk);
    expect(index + 1 - output.length).toBeLessThanOrEqual(3);
  }
  expect(output).toEqual(Array.from(source));
});

it("preserves invalid source bytes and flushes a real truncated EOF without inventing characters", () => {
  const boundary = new Utf8Boundary();
  const invalid = Uint8Array.of(0xff, 0xc0, 0x80);
  expect(boundary.push(invalid)).toEqual(invalid);
  expect(boundary.push(Uint8Array.of(0xe6, 0x80))).toHaveLength(0);
  expect(boundary.push(new Uint8Array(), true)).toEqual(Uint8Array.of(0xe6, 0x80));
  expect(boundary.push(encoder.encode("后续"))).toEqual(encoder.encode("后续"));
});

it("resynchronizes only the first orphan continuation run after a known replay gap", () => {
  const boundary = new Utf8Boundary();
  boundary.push(Uint8Array.of(0xe6, 0x80));
  boundary.reset(true);
  expect(boundary.push(Uint8Array.of(0x80))).toHaveLength(0);
  expect(boundary.push(new Uint8Array())).toHaveLength(0);
  const resumed = Uint8Array.of(0x81, ...encoder.encode("状态"));
  expect(boundary.push(resumed)).toEqual(encoder.encode("状态"));
  expect(boundary.push(Uint8Array.of(0x80))).toEqual(Uint8Array.of(0x80));
});
