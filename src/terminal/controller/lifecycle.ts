import { t } from "../../i18n";
import { Channel } from "@tauri-apps/api/core";
import { agentKindFromProfile } from "../../agent/contracts";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalTheme } from "../../theme/xtermTheme";
import { runStartupOnce } from "../../workspace/projects/launch";
import { acknowledgeTerminalOutput, createTerminal, detachTerminal, resizeTerminal, setTerminalPalette, writeTerminal } from "../api";
import type { CodexThemeSync } from "../codexThemeSync";
import { createTerminalRequest, type PromptDeliveryOptions, type TerminalEvent, type TerminalLaunch, type TerminalSession } from "../contracts";
import { diagnoseTerminalExit, errorMessage, isMissingTerminalSession } from "./diagnostics";
import { hostIsLaidOut, initialGrid } from "./hostSize";
import { TerminalInput } from "./input";
import { TerminalOutput } from "./output";
import { OutputQueue } from "./outputQueue";
import { SessionActivity } from "./sessionActivity";
import type { MountCallbacks } from "./types";
import type { InteractionWrite } from "../interaction";

interface LifecyclePorts {
  host: HTMLDivElement;
  terminal: Terminal;
  fit: FitAddon;
  themeSync: CodexThemeSync;
  theme: TerminalTheme;
  launch: TerminalLaunch;
  callbacks: MountCallbacks;
  onStopped: () => void;
  onReady: () => void;
}

export class TerminalLifecycle {
  current: TerminalSession | null = null;
  private attachment: TerminalSession | null = null;
  private earlyConnection: Pick<TerminalSession, "id" | "connectionId"> | null = null;
  private disposed = false;
  private failed = false;
  private exited = false;
  private readonly channel = new Channel<TerminalEvent>();
  private restoredMissingAttachment = false;
  private resumeSessionId: string | null = null;
  private nativeIdentity: string | null = null;
  private readonly activity;
  private readonly input;
  private readonly output;
  private readonly queue;

  constructor(private readonly ports: LifecyclePorts) {
    this.activity = new SessionActivity(ports.terminal, this.agentKind, ports.callbacks);
    this.input = new TerminalInput({ ...ports, session: () => this.current });
    this.output = new TerminalOutput({ terminal: ports.terminal, themeSync: ports.themeSync,
      onOutput: (text) => ports.callbacks.onOutput?.(text),
      onPasswordPrompt: () => this.input.mute(),
      onGap: () => {
        this.input.gap();
        this.activity.gap();
        ports.callbacks.onError(t("terminal.lifecycle.text_6f9801c626"));
      },
      onExit: (code, tail) => this.finishExit(code, tail),
      onAgentState: (snapshot) => {
        if (snapshot.session) {
          this.nativeIdentity = `${snapshot.session.agent}:${snapshot.session.id}`;
          ports.callbacks.onSessionIdentity?.(snapshot.session);
        }
        this.activity.accept(snapshot);
        this.input.acceptState(snapshot);
      },
      onSessionIdentity: (session) => {
        this.nativeIdentity = `${session.agent}:${session.id}`;
        ports.callbacks.onSessionIdentity?.(session);
      },
    });
    this.queue = new OutputQueue({ render: (events) => this.output.render(events),
      acknowledge: acknowledgeTerminalOutput, fail: (error) => this.fail(error) });
    this.channel.onmessage = (event) => this.receive(event);
  }

  get alive() { return !this.disposed; }
  get agentKind() { return agentKindFromProfile(this.ports.launch.profileId); }
  get outputSettled() { return this.queue.settled; }
  get waitingReason() { return this.activity.waitingReason; }
  get programStatus() { return this.activity.programStatus; }
  get interactionScope() { return this.nativeIdentity ?? this.resumeSessionId; }

  async start() {
    const { host, terminal, fit, launch, theme, callbacks } = this.ports;
    callbacks.onPhase("creating");
    callbacks.onError(null);
    callbacks.onSession(null);
    try {
      // 宿主被藏着（房间打开时的工作台）时 fitAddon 会拟出退化网格：把计算宽度
      // `width: 100%` 误读成 100px、算出十来个列宽。不要拟合，也不要把这种尺寸报给后台。
      if (hostIsLaidOut(host)) fit.fit();
      const grid = initialGrid(host, terminal);
      const request = createTerminalRequest(grid.cols, grid.rows, launch, palette(theme));
      request.resume = callbacks.getResumeSessionId?.() ?? request.resume;
      this.resumeSessionId = request.resume;
      let session: TerminalSession;
      try {
        session = await createTerminal(request, this.channel, launch.attachmentId, !!launch.attachmentId && !!launch.recoverExited);
      } catch (error) {
        if (!launch.attachmentId || !isMissingTerminalSession(error) || this.disposed || this.failed) throw error;
        // 后台已经确认旧身份不存在。只恢复一次，保留 native resume，且不重发启动脚本。
        this.restoredMissingAttachment = true;
        callbacks.onAttachmentLost?.();
        const recoveryRequest = { ...request, resume: callbacks.getResumeSessionId?.() ?? request.resume };
        this.resumeSessionId = recoveryRequest.resume;
        session = await createTerminal(recoveryRequest, this.channel, null, false);
      }
      this.attach(session);
    } catch (error) { this.fail(error); }
  }

  updateSession(session: TerminalSession) {
    if (this.current?.id !== session.id || this.disposed || this.failed) return;
    this.current = session;
    this.ports.callbacks.onSession(session);
  }

  sendText(text: string, options?: PromptDeliveryOptions) { return this.input.sendText(text, options); }

  get inputRevision() { return this.input.inputRevision; }
  get composerEmpty() { return this.input.composerEmpty; }

  sendInteraction(request: InteractionWrite) { return this.input.sendInteraction(request); }

  /** 替用户按下选择键：走和键盘同一条输入通道，PTY 不在时不发。 */
  pressKeys(keys: string): boolean {
    if (this.disposed || this.failed || !this.current) return false;
    this.ports.terminal.input(keys, true);
    return true;
  }

  updatePalette(theme: TerminalTheme) {
    if (!this.current) return;
    void setTerminalPalette(this.current.id, palette(theme)).catch(() => undefined);
    if (this.ports.themeSync.codexStylesEnabled) {
      this.ports.terminal.write("", () => void this.redraw());
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.current = null;
    this.queue.dispose();
    this.output.dispose();
    this.input.dispose();
    this.activity.dispose();
    this.ports.onStopped();
    this.detachActive();
  }

  private receive(event: TerminalEvent) {
    if (this.disposed || this.failed) return;
    if (event.kind === "disconnected") {
      this.fail({ code: "IO_ERROR", message: event.message, retryable: true }, event.sessionId);
      return;
    }
    if (event.kind === "output_batch" && event.connectionId && !this.earlyConnection) {
      this.earlyConnection = { id: event.sessionId, connectionId: event.connectionId };
    }
    const events = event.kind === "output_batch" ? event.events : [event];
    // 创建命令的响应可能晚于退出事件，先关闭输入，避免迟到响应再次发启动命令。
    if (events.some((item) => item.kind === "exit")) { this.exited = true; this.stopInput(); }
    this.queue.push(event);
  }

  private attach(session: TerminalSession) {
    if (this.disposed) { this.detach(session); return; }
    this.attachment = session;
    this.ports.callbacks.onSession(session);
    this.queue.bind(session);
    if (this.failed) { this.detach(session); return; }
    if (this.exited || session.status === "exited") {
      this.exited = true;
      this.stopInput();
      this.ports.callbacks.onPhase("exited");
      return;
    }
    this.current = session;
    this.input.attach(!session.reconnected);
    this.ports.callbacks.onPhase("running");
    this.ports.onReady();
    if ((this.restoredMissingAttachment || this.ports.launch.recoverExited) && !session.reconnected) {
      this.ports.callbacks.onError(this.resumeSessionId
        ? t("terminal.lifecycle.text_2bdbc35554")
        : t("terminal.lifecycle.text_0dd9be7668"));
    }
    const skipStartup = session.reconnected || this.restoredMissingAttachment || this.ports.launch.attachmentId || this.ports.launch.skipStartup;
    void runStartupOnce({ intent: skipStartup ? undefined : this.ports.launch.projectLaunch?.startup,
      sessionId: session.id, current: () => !this.disposed && !this.failed && this.current?.id === session.id,
      write: writeTerminal,
    }).catch((error) => {
      if (this.current?.id === session.id) this.ports.callbacks.onError(t("terminal.lifecycle.text_450722eb7c", { error: errorMessage(error) }));
    });
  }

  private fail(error: unknown, disconnectedId?: string) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.queue.dispose();
    this.output.dispose();
    this.stopSession();
    this.ports.callbacks.onError(errorMessage(error));
    this.ports.callbacks.onPhase("error");
    this.detachActive();
    const attachmentId = disconnectedId ?? this.attachment?.id ?? this.earlyConnection?.id
      ?? (this.restoredMissingAttachment ? null : this.ports.launch.attachmentId ?? null);
    this.ports.callbacks.onConnectionFailure?.(error, attachmentId);
  }

  private stopInput() {
    this.current = null;
    this.input.stop();
    this.ports.onStopped();
  }

  private stopSession() {
    this.stopInput();
    this.activity.stop();
  }

  private finishExit(code: number, tail: string) {
    if (this.disposed || this.failed) return;
    this.stopSession();
    this.ports.callbacks.onPhase("exited");
    this.ports.callbacks.onError(diagnoseTerminalExit(code, tail));
  }

  private detachActive() {
    const session = this.attachment ?? this.earlyConnection;
    if (session) this.detach(session);
  }

  private detach(session: Pick<TerminalSession, "id" | "connectionId">) { void detachTerminal(session).catch(() => undefined); }

  private async redraw() {
    const session = this.current;
    const terminal = this.ports.terminal;
    if (!session || terminal.cols <= 1) return;
    try {
      await resizeTerminal(session.id, terminal.cols - 1, terminal.rows);
      if (this.current?.id === session.id) await resizeTerminal(session.id, terminal.cols, terminal.rows);
    } catch { /* 退出期间辅助重绘失败不影响已经应用的主题。 */ }
  }
}

function palette(theme: TerminalTheme) { return { foreground: theme.foreground, background: theme.background }; }
