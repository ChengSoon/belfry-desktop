import { expect, it, vi } from "vitest";
import { Channel, invoke } from "@tauri-apps/api/core";
import { createTerminal } from "./api";
import { createDefaultRequest, type TerminalEvent } from "./contracts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

it("defaults exited recovery off and forwards it only when explicitly requested", () => {
  const request = createDefaultRequest(80, 24, { foreground: "#ffffff", background: "#000000" }, "Mac");
  const onEvent = new Channel<TerminalEvent>();
  createTerminal(request, onEvent);
  expect(invoke).toHaveBeenLastCalledWith("terminal_create", {
    request, onEvent, attachment: null, recoverExited: false, flowControl: true,
  });
  createTerminal(request, onEvent, "saved-pty", true);
  expect(invoke).toHaveBeenLastCalledWith("terminal_create", {
    request, onEvent, attachment: "saved-pty", recoverExited: true, flowControl: true,
  });
});
