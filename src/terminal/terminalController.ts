import type { TerminalTheme } from "../theme/xtermTheme";
import type { TypographyRuntime } from "../typography/contracts";
import { composerLooksEmpty, readScreenTail } from "./activity";
import { CHOICE_TAIL_LINES, choiceKeys, parseChoice } from "./choice";
import type { TerminalLaunch } from "./contracts";
import { TerminalLayout } from "./controller/layout";
import { TerminalLifecycle } from "./controller/lifecycle";
import { TerminalView } from "./controller/view";
import type { MountCallbacks, TerminalHandle } from "./controller/types";

export type { MountCallbacks, TerminalHandle } from "./controller/types";
export { diagnoseTerminalExit, errorMessage } from "./controller/diagnostics";

/** 保持宿主调用面稳定，各模块独立管理输入、解析、连接和显示资源。 */
export function mountTerminal(
  host: HTMLDivElement,
  launch: TerminalLaunch,
  theme: TerminalTheme,
  transparent: boolean,
  typography: TypographyRuntime,
  callbacks: MountCallbacks,
): TerminalHandle {
  const view = new TerminalView({ host, theme, transparent, typography,
    codex: launch.profileId === "agent:codex", onOpenFile: callbacks.onOpenFile });
  const lifecycle = new TerminalLifecycle({ host, launch, theme, callbacks,
    terminal: view.terminal, fit: view.fit, themeSync: view.themeSync,
    onStopped: () => layout.cancelPending(), onReady: () => layout.syncSize() });
  const layout = new TerminalLayout({ host, terminal: view.terminal, fit: view.fit,
    session: () => lifecycle.current, update: (session) => lifecycle.updateSession(session), error: callbacks.onError });
  void lifecycle.start();
  return createHandle({ view, lifecycle, layout });
}

function createHandle({ view, lifecycle, layout }: {
  view: TerminalView; lifecycle: TerminalLifecycle; layout: TerminalLayout;
}): TerminalHandle {
  return {
    applyTheme: (theme, transparent) => {
      if (!lifecycle.alive) return;
      view.applyTheme(theme, transparent);
      layout.refreshTypography();
      lifecycle.updatePalette(theme);
    },
    applyTypography: (typography) => {
      if (!lifecycle.alive) return;
      view.applyTypography(typography);
      layout.refreshTypography();
    },
    search: view.search,
    focus: () => { if (lifecycle.alive) view.terminal.focus(); },
    sendText: (text, options) => lifecycle.sendText(text, options),
    composerEmpty: () => lifecycle.alive && composerLooksEmpty(readScreenTail(view.terminal, 6)),
    readChoice: () => lifecycle.alive ? parseChoice(readScreenTail(view.terminal, CHOICE_TAIL_LINES)) : null,
    answerChoice: (signature, index) => {
      if (!lifecycle.alive) return "unavailable";
      // 发之前重读一遍：用户点按钮这几秒里，选择框可能已经换了一个或者消失了。
      const choice = parseChoice(readScreenTail(view.terminal, CHOICE_TAIL_LINES));
      if (!choice || choice.signature !== signature) return "changed";
      const keys = choiceKeys(choice, index, view.terminal.modes.applicationCursorKeysMode);
      if (!keys) return "changed";
      return lifecycle.pressKeys(keys) ? "sent" : "unavailable";
    },
    dispose: () => {
      if (!lifecycle.alive) return;
      lifecycle.dispose();
      layout.dispose();
      view.dispose();
    },
  };
}
