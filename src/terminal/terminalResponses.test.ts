import { expect, it, vi } from "vitest";
import type { IFunctionIdentifier, IParser } from "@xterm/xterm";
import { TerminalResponses } from "./terminalResponses";

function fixture() {
  const handlers = new Map<string, (params: (number | number[])[]) => boolean | Promise<boolean>>();
  const dispose = vi.fn();
  const parser = { registerCsiHandler: (id: IFunctionIdentifier, callback: (params: (number | number[])[]) => boolean | Promise<boolean>) => {
    handlers.set(JSON.stringify(id), callback);
    return { dispose };
  } } as unknown as IParser;
  const replies = new TerminalResponses(parser);
  return { replies, dispose, query: (id: IFunctionIdentifier, params: (number | number[])[]) => handlers.get(JSON.stringify(id))!(params) };
}

function pointerFixture() {
  const host = new EventTarget();
  const replies = new TerminalResponses(undefined, host);
  const move = (properties: Partial<MouseEvent> = {}) => {
    const event = Object.assign(new Event("mousemove"), { buttons: 0, ...properties });
    // Node resets eventPhase after its first listener. A DOM event stays active
    // through propagation; the production browser test exercises that lifecycle.
    Object.defineProperty(event, "eventPhase", { value: 2, configurable: true });
    try { host.dispatchEvent(event); }
    finally { Object.defineProperty(event, "eventPhase", { value: 0 }); }
  };
  return { host, replies, move };
}

it.each([
  [{ prefix: "", final: "n" }, [6], "\x1b[12;34R"],
  [{ prefix: "?", final: "n" }, [6], "\x1b[?12;34R"],
  [{ prefix: "", final: "n" }, [5], "\x1b[0n"],
  [{ prefix: "?", final: "n" }, [5], "\x1b[?0n"],
  [{ prefix: "", final: "c" }, [0], "\x1b[?1;2c"],
  [{ prefix: ">", final: "c" }, [0], "\x1b[>0;276;0c"],
  [{ prefix: "?", intermediates: "$", final: "p" }, [2004], "\x1b[?2004;1$y"],
  [{ final: "t" }, [18], "\x1b[8;24;80t"],
] as const)("routes a built-in reply for %j once without replacing xterm's handler", (id, params, response) => {
  const { replies, query } = fixture();
  expect(replies.consume(response)).toBe(false);
  expect(query(id, [...params])).toBe(false);
  expect(replies.consume(`${response}draft`)).toBe(false);
  expect(replies.consume(response)).toBe(true);
  expect(replies.consume(response)).toBe(false);
  replies.dispose();
});

it("never tags a keyboard or pasted response-shaped string, even if a query just ran", () => {
  const { replies, query } = fixture();
  query({ prefix: "", final: "n" }, [6]);
  replies.userInput();
  expect(replies.consume("\x1b[12;34R")).toBe(false);
  replies.dispose();
});

it("expires unsupported queries and removes parser listeners on unmount", async () => {
  const { replies, query, dispose } = fixture();
  query({ prefix: "", final: "n" }, [6]);
  await Promise.resolve();
  expect(replies.consume("\x1b[12;34R")).toBe(false);
  query({ prefix: "", final: "n" }, [[6, 1]]);
  expect(replies.consume("\x1b[12;34R")).toBe(false);
  replies.dispose();
  expect(dispose).toHaveBeenCalledTimes(6);
});

it.each([
  [{}, 35], [{ shiftKey: true }, 39], [{ altKey: true }, 43], [{ ctrlKey: true }, 51],
  [{ shiftKey: true, altKey: true, ctrlKey: true }, 63],
])("tags only the synchronous buttonless pointer report with modifiers %j", (modifiers, code) => {
  const { host, replies, move } = pointerFixture();
  const report = `\x1b[<${code};12;34M`;
  expect(replies.consume(report)).toBe(false);
  const inputs = ["\x1b[<0;12;34M", "\x1b[<32;12;34M", "\x1b[<64;12;34M", "\x1b[<0;12;34m", `${report}draft`, report, report];
  const results: boolean[] = [];
  const generated = () => results.push(...inputs.map(input => replies.consume(input)));
  host.addEventListener("mousemove", generated);
  move(modifiers);
  expect(results).toEqual([false, false, false, false, false, true, false]);
  replies.dispose();
});

it("never lets keyboard, paste, IME or held-button motion borrow a hover marker", () => {
  const { host, replies, move } = pointerFixture();
  const results: boolean[] = [];
  const pasted = () => {
    replies.userInput();
    results.push(replies.consume("\x1b[<35;12;34M"));
  };
  host.addEventListener("mousemove", pasted, { once: true });
  move();
  host.addEventListener("mousemove", () => results.push(replies.consume("\x1b[<35;12;34M")));
  move({ buttons: 1 });
  expect(results).toEqual([false, false]);
  expect(replies.consume("\x1b[<35;12;34M")).toBe(false);
  replies.dispose();
});

it("expires unused hover markers at the end of dispatch and removes their DOM listener on unmount", () => {
  const { host, replies, move } = pointerFixture();
  move();
  expect(replies.consume("\x1b[<35;12;34M")).toBe(false);
  replies.dispose();
  const results: boolean[] = [];
  host.addEventListener("mousemove", () => results.push(replies.consume("\x1b[<35;12;34M")));
  move();
  expect(results).toEqual([false]);
});
