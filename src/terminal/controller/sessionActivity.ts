import type { IDisposable, Terminal } from "@xterm/xterm";
import { HookActivity } from "../../agent/hooks/activity";
import type { HookSnapshot } from "../../agent/hooks/contracts";
import { usesTerminalStatus, type AgentKind } from "../../agent/contracts";
import { protocolActivity, terminalStatusFor } from "../../agent/programStatus";
import { watchActivity } from "../activity";
import type { MountCallbacks } from "./types";

export class SessionActivity {
  private readonly hook;
  private screen: IDisposable | null;
  private waiting: string | null = null;
  private protocolSequence = -1;
  private stopped = false;
  private protocol: HookSnapshot | null = null;

  constructor(terminal: Terminal, private readonly agent: AgentKind | null, private readonly callbacks: MountCallbacks) {
    callbacks.onActivity(usesTerminalStatus(agent) ? "talking" : "idle");
    callbacks.onAgentState?.(null);
    this.hook = new HookActivity(({ activity, hook }) => {
      this.waiting = activity === "awaiting-choice" ? hook?.reason ?? "" : null;
      callbacks.onActivity(activity);
      callbacks.onAgentState?.(hook);
    });
    this.screen = agent && !usesTerminalStatus(agent) ? watchActivity(terminal, (activity) => this.hook.screen(activity), agent) : null;
  }

  accept(snapshot: HookSnapshot) {
    if (this.stopped) return;
    if (!usesTerminalStatus(this.agent)) { this.hook.accept(snapshot); return; }
    if (!terminalStatusFor(this.agent, snapshot) || snapshot.sequence <= this.protocolSequence) return;
    this.protocolSequence = snapshot.sequence;
    this.protocol = snapshot;
    const activity = protocolActivity(snapshot);
    this.waiting = activity === "awaiting-choice" ? snapshot.programStatus?.message ?? snapshot.reason : null;
    this.callbacks.onActivity(activity);
    this.callbacks.onAgentState?.(snapshot);
  }
  get waitingReason() { return this.waiting; }
  get programStatus() { return this.protocol; }

  gap() {
    if (!usesTerminalStatus(this.agent)) return;
    this.waiting = null;
    this.protocol = null;
    this.callbacks.onActivity("talking");
    this.callbacks.onAgentState?.(null);
  }

  stop() {
    this.stopped = true;
    this.protocol = null;
    this.waiting = null;
    this.hook.stop();
    this.screen?.dispose();
    this.screen = null;
    this.callbacks.onActivity("idle");
  }

  dispose() { this.stop(); }
}
