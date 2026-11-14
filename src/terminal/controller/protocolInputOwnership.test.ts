import { describe, expect, it } from "vitest";
import type { TerminalProgramStatus } from "../../agent/contracts";
import { statusReport } from "../fixtures/programStatus";
import { ProtocolInputOwnership } from "./protocolInputOwnership";

describe.each(["codex", "claude"] as const)("%s protocol input ownership", agent => {

const status = (state: TerminalProgramStatus["state"], sequence: number) => statusReport(agent, state, sequence);

it("keeps one input permission through done to idle, but not through a busy interval", () => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(true);
  input.accept(status("done", 1));
  const valid = input.validatePosition();
  input.reserve();
  input.accept(status("idle", 2));
  expect(valid()).toBe(true);
  input.accept(status("idle", 3));
  expect(valid()).toBe(true);
  input.accept(status("blocked", 4));
  input.accept(status("idle", 5));
  expect(valid()).toBe(false);
});

it.each(["\r", "\n", "\r\n", "\x1b[13u", "\x1b[13;1u"])("does not wait forever for a working report after empty Enter %j", key => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(true);
  input.accept(status("done", 1));
  input.userInput(key);
  input.accept(status("idle", 2));
  expect(input.ready).toBe(true);
  input.userInput("draft");
  input.userInput(key);
  input.accept(status("idle", 3));
  expect(input.ready).toBe(false);
});

it("does not carry a permission over missing protocol reports", () => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(true);
  input.accept(status("done", 1));
  const valid = input.validatePosition();
  input.accept(status("idle", 3));
  expect(valid()).toBe(false);
});

it("keeps drafts through idle reports and only releases an acknowledged submission", () => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(true);
  expect(input.empty).toBe(true);
  expect(input.ready).toBe(false);
  input.accept(status("idle", 0));
  expect(input.ready).toBe(true);
  const valid = input.validatePosition();
  input.userInput("a");
  expect(valid()).toBe(false);
  input.accept(status("idle", 1));
  expect(valid()).toBe(false);
  expect(input.ready).toBe(false);
  expect(input.empty).toBe(false);
  input.userInput("\r");
  input.accept(status("blocked", 2));
  expect(input.empty).toBe(false);
  input.accept(status("working", 3));
  input.accept(status("done", 4));
  expect(input.empty).toBe(true);
  expect(input.ready).toBe(true);
});

it("does not erase edits typed after Enter, during a running turn, or after a replay gap", () => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(true);
  input.accept(status("idle", 0));
  input.userInput("\r");
  input.userInput("next draft");
  input.accept(status("working", 1));
  input.accept(status("done", 2));
  expect(input.empty).toBe(false);
  input.userInput("\r");
  input.accept(status("working", 3));
  input.userInput(); // paste / IME
  input.accept(status("done", 4));
  expect(input.empty).toBe(false);
  input.gap();
  input.accept(status("idle", 5));
  expect(input.empty).toBe(false);
});

it("treats reattached editor contents as unknown and ignores Hook acknowledgements", () => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(false);
  input.accept(status("idle", 1));
  expect(input.empty).toBe(false);
  input.userInput("\r");
  input.accept({ ...status("working", 100), source: "hook" });
  expect(input.empty).toBe(false);
  input.accept(status("working", 2));
  expect(input.empty).toBe(true);
  input.accept(status("done", 3));
  const cancel = input.reserve();
  expect(input.empty).toBe(false);
  cancel();
  expect(input.empty).toBe(true);
  const cannotCancelUser = input.reserve();
  input.userInput("draft");
  cannotCancelUser();
  expect(input.empty).toBe(false);
});

it("does not acknowledge a queued draft from repeated working reports", () => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(true);
  input.accept(status("working", 1));
  input.userInput("queued draft");
  input.userInput("\r");
  input.accept(status("working", 2));
  input.accept(status("done", 3));
  expect(input.ready).toBe(false);
});

it("does not treat a paste reservation as an acknowledged submission", () => {
  const input = new ProtocolInputOwnership(agent);
  input.attach(true);
  input.accept(status("idle", 1));
  input.reserve();
  input.accept(status("working", 2));
  input.accept(status("done", 3));
  expect(input.ready).toBe(false);
  input.userInput("\r");
  input.accept(status("working", 4));
  input.accept(status("idle", 5));
  expect(input.ready).toBe(true);
  const cancel = input.reserve();
  input.beginSubmission();
  input.accept(status("working", 6));
  input.accept(status("done", 7));
  expect(input.ready).toBe(true);
  cancel(true); // The native layer rejected Enter after a successful paste.
  expect(input.ready).toBe(false);
});

it("releases dialog answers without erasing a draft from before the dialog", () => {
  for (const draft of [false, true]) {
    const input = new ProtocolInputOwnership(agent);
    input.attach(true);
    input.accept(status("working", 1));
    if (draft) input.userInput("next instruction");
    input.accept(status("blocked", 2));
    input.userInput("answer");
    input.userInput("\r");
    input.accept(status("working", 3));
    input.accept(status("idle", 4));
    expect(input.ready).toBe(!draft);
  }
});
});
