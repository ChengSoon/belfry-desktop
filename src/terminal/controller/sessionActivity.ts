import type { IDisposable, Terminal } from "@xterm/xterm";
import { HookActivity } from "../../agent/hooks/activity";
import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { AgentKind } from "../../agent/contracts";
import { watchActivity } from "../activity";
import type { MountCallbacks } from "./types";

export class SessionActivity {
  private readonly hook;
  private screen: IDisposable | null;
  private waiting: string | null = null;

  constructor(terminal: Terminal, agent: AgentKind | null, private readonly callbacks: MountCallbacks) {
    callbacks.onActivity("idle");
    callbacks.onAgentState?.(null);
    this.hook = new HookActivity(({ activity, hook }) => {
      this.waiting = activity === "awaiting-choice" ? hook?.reason ?? "" : null;
      callbacks.onActivity(activity);
      callbacks.onAgentState?.(hook);
    });
    this.screen = agent ? watchActivity(terminal, (activity) => this.hook.screen(activity), agent) : null;
  }

  accept(snapshot: HookSnapshot) { this.hook.accept(snapshot); }
  get waitingReason() { return this.waiting; }

  stop() {
    this.waiting = null;
    this.hook.stop();
    this.screen?.dispose();
    this.screen = null;
    this.callbacks.onActivity("idle");
  }

  dispose() { this.stop(); }
}
