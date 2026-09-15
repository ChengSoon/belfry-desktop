import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { TerminalViewport } from "./TerminalViewport";

const ports = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  focus: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => unknown) => ports.effects.push(effect),
}));
vi.mock("../terminal/useTerminalSession", () => ({
  useTerminalSession: () => ({
    phase: "running", error: null, lastInput: null, activity: "idle", search: null,
    commandTarget: { focus: ports.focus, sendText: vi.fn() },
  }),
}));
vi.mock("../agent/hooks/HookStatusBar", () => ({ HookStatusBar: () => null }));
vi.mock("../usage/session/SessionStatisticsControl", () => ({ SessionStatisticsControl: () => null }));

beforeEach(() => { ports.effects.length = 0; ports.focus.mockClear(); });

it.each([
  { focused: true, visible: true, expected: 1, name: "saved active pane" },
  { focused: false, visible: true, expected: 0, name: "other visible pane" },
  { focused: true, visible: false, expected: 0, name: "offstage pane" },
])("restores keyboard focus only for the $name", ({ focused, visible, expected }) => {
  renderToStaticMarkup(<TerminalViewport focused={focused} visible={visible}
    launch={{ profileId: "shell:bash", cwd: "file:///tmp", tabId: "focus-tab",
      collaborationMode: false, resumeSessionId: null, ssh: null }} onSnapshot={vi.fn()} />);
  ports.effects.forEach((effect) => effect());
  expect(ports.focus).toHaveBeenCalledTimes(expected);
});
