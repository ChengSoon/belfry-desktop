import type { SessionActivity } from "../../terminal/contracts";
import type { HookSnapshot } from "./contracts";

export interface ActivityView { activity: SessionActivity; hook: HookSnapshot | null }

const COMPLETION_SETTLE_MS = 1500;

export class HookActivity {
  private screenActivity: SessionActivity = "idle";
  private view: ActivityView = { activity: "idle", hook: null };
  private sequence = -1;
  private pending: HookSnapshot | null = null;
  private ready = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly publish: (view: ActivityView) => void) {}

  screen(activity: SessionActivity) {
    if (this.stopped) return;
    this.screenActivity = activity;
    if (this.pending) { this.finishIfReady(); return; }
    if (!this.view.hook || this.view.hook.source === "screen_heuristic") this.emit(activity, this.view.hook);
    else if (this.view.hook.agent === "antigravity" && this.view.hook.state === "processing") {
      // Antigravity has no permission-request event. A visible approval may close
      // the queue; a quiet screen must never override a running hook to open it.
      this.emit(activity === "awaiting-choice" ? activity : "talking", this.view.hook);
    }
  }

  accept(snapshot: HookSnapshot) {
    if (this.stopped || snapshot.sequence <= this.sequence) return;
    this.sequence = snapshot.sequence;
    this.clearPending();
    if (snapshot.source === "hook" && snapshot.state === "completed") {
      this.pending = snapshot;
      // Stop 之后其他 Hook 仍可能继续当前回合；稳定前保持队列关闭。
      this.emit("talking", this.view.hook);
      this.timer = setTimeout(() => { this.ready = true; this.finishIfReady(); }, COMPLETION_SETTLE_MS);
      return;
    }
    const activity = snapshot.source === "screen_heuristic" ? this.screenActivity
      : snapshot.agent === "antigravity" && snapshot.state === "processing" && this.screenActivity === "awaiting-choice"
        ? "awaiting-choice" : activityFor(snapshot);
    this.emit(activity, snapshot);
  }

  stop() { this.stopped = true; this.clearPending(); }
  dispose() { this.stop(); }

  private finishIfReady() {
    if (!this.pending || !this.ready || this.screenActivity !== "idle") return;
    const snapshot = this.pending;
    this.clearPending();
    this.emit("idle", snapshot);
  }

  private clearPending() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
    this.ready = false;
  }

  private emit(activity: SessionActivity, hook: HookSnapshot | null) {
    if (this.view.activity === activity && this.view.hook === hook) return;
    this.view = { activity, hook };
    this.publish(this.view);
  }
}

function activityFor(snapshot: HookSnapshot): SessionActivity {
  if (snapshot.state === "awaiting_input") return "awaiting-choice";
  if (snapshot.state === "starting" || snapshot.state === "processing") return "talking";
  return "idle";
}
