import { Channel } from "@tauri-apps/api/core";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { TerminalTheme } from "../../theme/xtermTheme";
import { runStartupOnce } from "../../workspace/projects/launch";
import { acknowledgeTerminalOutput, createTerminal, detachTerminal, resizeTerminal, setTerminalPalette, writeTerminal } from "../api";
import type { CodexThemeSync } from "../codexThemeSync";
import { createTerminalRequest, type TerminalEvent, type TerminalLaunch, type TerminalSession } from "../contracts";
import { diagnoseTerminalExit, errorMessage } from "./diagnostics";
import { TerminalInput } from "./input";
import { TerminalOutput } from "./output";
import { OutputQueue } from "./outputQueue";
import { SessionActivity } from "./sessionActivity";
import type { MountCallbacks } from "./types";

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
  private readonly activity;
  private readonly input;
  private readonly output;
  private readonly queue;

  constructor(private readonly ports: LifecyclePorts) {
    this.activity = new SessionActivity(ports.terminal, ports.launch.profileId.startsWith("agent:"), ports.callbacks);
    this.input = new TerminalInput({ ...ports, session: () => this.current });
    this.output = new TerminalOutput({ terminal: ports.terminal, themeSync: ports.themeSync,
      onOutput: (text) => ports.callbacks.onOutput?.(text),
      onPasswordPrompt: () => this.input.mute(),
      onGap: () => ports.callbacks.onError("较早输出已超出缓存；原进程仍在继续运行。"),
      onExit: (code, tail) => this.finishExit(code, tail),
      onAgentState: (snapshot) => this.activity.accept(snapshot),
    });
    this.queue = new OutputQueue({ render: (events) => this.output.render(events),
      acknowledge: acknowledgeTerminalOutput, fail: (error) => this.fail(error) });
    this.channel.onmessage = (event) => this.receive(event);
  }

  get alive() { return !this.disposed; }

  async start() {
    const { terminal, fit, launch, theme, callbacks } = this.ports;
    callbacks.onPhase("creating");
    callbacks.onError(null);
    callbacks.onSession(null);
    try {
      fit.fit();
      const session = await createTerminal(createTerminalRequest(terminal.cols, terminal.rows, launch, palette(theme)), this.channel, launch.attachmentId);
      this.attach(session);
    } catch (error) { this.fail(error); }
  }

  updateSession(session: TerminalSession) {
    if (this.current?.id !== session.id || this.disposed || this.failed) return;
    this.current = session;
    this.ports.callbacks.onSession(session);
  }

  sendText(text: string) { return this.input.sendText(text); }

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
    if (event.kind === "disconnected") { this.fail(event.message); return; }
    if (event.kind === "output_batch" && event.connectionId && !this.earlyConnection) {
      this.earlyConnection = { id: event.sessionId, connectionId: event.connectionId };
    }
    const events = event.kind === "output_batch" ? event.events : [event];
    // 创建命令的响应可能晚于退出事件，先关闭输入，避免迟到响应再次发启动命令。
    if (events.some((item) => item.kind === "exit")) { this.exited = true; this.stopSession(); }
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
      this.stopSession();
      this.ports.callbacks.onPhase("exited");
      return;
    }
    this.current = session;
    this.ports.callbacks.onPhase("running");
    this.ports.onReady();
    void runStartupOnce({ intent: session.reconnected ? undefined : this.ports.launch.projectLaunch?.startup,
      sessionId: session.id, current: () => !this.disposed && !this.failed && this.current?.id === session.id,
      write: writeTerminal,
    }).catch((error) => {
      if (this.current?.id === session.id) this.ports.callbacks.onError(`启动命令发送失败，未自动重试：${errorMessage(error)}`);
    });
  }

  private fail(error: unknown) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.queue.dispose();
    this.output.dispose();
    this.stopSession();
    this.ports.callbacks.onError(errorMessage(error));
    this.ports.callbacks.onPhase("error");
    this.detachActive();
  }

  private stopSession() {
    this.current = null;
    this.input.stop();
    this.activity.stop();
    this.ports.onStopped();
  }

  private finishExit(code: number, tail: string) {
    if (this.disposed || this.failed) return;
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
