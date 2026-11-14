import type { TerminalTheme } from "../theme/xtermTheme";
import type { TypographyRuntime } from "../typography/contracts";
import { composerLooksEmpty, readScreenTail } from "./activity";
import { CHOICE_TAIL_LINES } from "./choice";
import type { TerminalLaunch } from "./contracts";
import { TerminalLayout } from "./controller/layout";
import { TerminalLifecycle } from "./controller/lifecycle";
import { TerminalView } from "./controller/view";
import type { MountCallbacks, TerminalHandle } from "./controller/types";
import { TerminalInteractions } from "./controller/interaction";
import { usesTerminalStatus } from "../agent/contracts";

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
  const interactions = new TerminalInteractions({ terminal: view.terminal, agent: lifecycle.agentKind,
    session: () => lifecycle.alive ? lifecycle.current?.id ?? null : null,
    scope: () => lifecycle.interactionScope,
    outputSettled: () => lifecycle.outputSettled, waitingReason: () => lifecycle.waitingReason,
    programStatus: () => lifecycle.programStatus,
    write: (request) => lifecycle.sendInteraction(request) });
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
    inputRevision: () => lifecycle.inputRevision,
    composerEmpty: () => lifecycle.alive && (usesTerminalStatus(lifecycle.agentKind) ? lifecycle.composerEmpty
      : composerLooksEmpty(readScreenTail(view.terminal, CHOICE_TAIL_LINES), lifecycle.agentKind)),
    canPasteMultiline: () => lifecycle.alive && view.terminal.modes.bracketedPasteMode,
    readChoice: () => interactions.readChoice(),
    answerChoice: (signature, index) => interactions.answerChoice(signature, index),
    readInteraction: () => interactions.read(),
    answerInteraction: (requestId, answer) => interactions.answer(requestId, answer),
    dispose: () => {
      if (!lifecycle.alive) return;
      interactions.dispose();
      lifecycle.dispose();
      layout.dispose();
      view.dispose();
    },
  };
}
