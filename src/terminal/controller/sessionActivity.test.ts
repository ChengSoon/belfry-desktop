import type { Terminal } from "@xterm/xterm";
import { expect, it, vi } from "vitest";
import { statusReport } from "../fixtures/programStatus";
import type { MountCallbacks } from "./types";
import { SessionActivity } from "./sessionActivity";

it.each(["codex", "claude"] as const)("%s follows only monotonic root reports without reading terminal text", agent => {
  const callbacks = { onActivity: vi.fn(), onAgentState: vi.fn() };
  // No screen APIs: any attempt to inspect footer text makes this test fail.
  const activity = new SessionActivity({} as Terminal, agent, callbacks as unknown as MountCallbacks);
  const state = (value: Parameters<typeof statusReport>[1], sequence: number) => statusReport(agent, value, sequence);
  expect(callbacks.onActivity).toHaveBeenLastCalledWith("talking");
  activity.accept({ ...state("done", 100), source: "hook" });
  expect(callbacks.onActivity).toHaveBeenCalledTimes(1);
  activity.accept(state("idle", 1));
  expect(callbacks.onActivity).toHaveBeenLastCalledWith("idle");
  activity.accept(state("blocked", 2));
  expect(callbacks.onActivity).toHaveBeenLastCalledWith("awaiting-choice");
  activity.accept(state("idle", 1));
  expect(callbacks.onActivity).toHaveBeenLastCalledWith("awaiting-choice");
  activity.accept(state("working", 3));
  expect(callbacks.onActivity).toHaveBeenLastCalledWith("talking");
  activity.accept(state("done", 4));
  activity.gap();
  expect(callbacks.onActivity).toHaveBeenLastCalledWith("talking");
  expect(callbacks.onAgentState).toHaveBeenLastCalledWith(null);
  activity.dispose();
});
