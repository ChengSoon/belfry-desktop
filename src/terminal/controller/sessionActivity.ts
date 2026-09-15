import type { IDisposable, Terminal } from "@xterm/xterm";
import { HookActivity } from "../../agent/hooks/activity";
import type { HookSnapshot } from "../../agent/hooks/contracts";
import { watchActivity } from "../activity";
import type { MountCallbacks } from "./types";

export class SessionActivity {
  private readonly hook;
  private screen: IDisposable | null;

  constructor(terminal: Terminal, agent: boolean, private readonly callbacks: MountCallbacks) {
    callbacks.onActivity("idle");
    callbacks.onAgentState?.(null);
    this.hook = new HookActivity(({ activity, hook }) => {
      callbacks.onActivity(activity);
      callbacks.onAgentState?.(hook);
    });
    this.screen = agent ? watchActivity(terminal, (activity) => this.hook.screen(activity)) : null;
  }

  accept(snapshot: HookSnapshot) { this.hook.accept(snapshot); }

  stop() {
    this.hook.stop();
    this.screen?.dispose();
    this.screen = null;
    this.callbacks.onActivity("idle");
  }

  dispose() { this.stop(); }
}
