import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { AgentKind } from "../../agent/contracts";
import { terminalStatusFor } from "../../agent/programStatus";

/** OSC status describes the foreground job, not the editor. Never infer draft ownership from its text. */
export class ProtocolInputOwnership {
  private dirty = true;
  private revision = 0;
  private submitted: number | null = null;
  private sequence = -1;
  private position = 0;
  private idle = false;
  private blocked = false;
  private dialogEmpty = false;

  constructor(private readonly agent: AgentKind | null) {}

  get empty() { return !this.dirty; }
  get ready() { return this.idle && this.empty; }

  validatePosition() {
    const position = this.position;
    const revision = this.revision;
    return () => this.idle && this.position === position && this.revision === revision;
  }

  attach(fresh: boolean) {
    // A reattached PTY may contain a draft typed by an earlier frontend.
    if (fresh && this.revision === 0) this.dirty = false;
  }

  isEmptySubmission(key?: string) { return this.ready && submitKey(key); }

  userInput(key?: string) {
    const emptySubmission = this.isEmptySubmission(key);
    this.dirty = !emptySubmission;
    this.revision += 1;
    this.submitted = !emptySubmission && (this.idle || this.blocked && this.dialogEmpty) && submitKey(key) ? this.revision : null;
  }

  reserve() {
    const previous = this.dirty;
    const revision = this.revision;
    this.dirty = true;
    this.submitted = null;
    return (written = false) => {
      if (this.revision === revision) {
        this.dirty = written || previous;
        this.submitted = null;
      }
    };
  }

  beginSubmission() {
    if (this.idle) this.submitted = this.revision;
  }

  accept(snapshot: HookSnapshot) {
    const report = terminalStatusFor(this.agent, snapshot);
    if (!report || snapshot.sequence <= this.sequence) return;
    const idle = report.programStatus.state === "idle" || report.programStatus.state === "done";
    if (!idle || !this.idle || snapshot.sequence !== this.sequence + 1) this.position += 1;
    this.sequence = snapshot.sequence;
    if (report.programStatus.state === "blocked" && !this.blocked) this.dialogEmpty = !this.dirty;
    this.blocked = report.programStatus.state === "blocked";
    this.idle = idle;
    // Enter alone may insert a newline or answer a dialog. Only the agent's subsequent
    // foreground working report acknowledges it; later edits continue to own the editor.
    if (report.programStatus.state === "working" && this.submitted === this.revision) {
      this.dirty = false;
      this.submitted = null;
    }
  }

  gap() { this.revision += 1; this.dirty = true; this.submitted = null; this.idle = false; this.blocked = false; this.dialogEmpty = false; }
}

function submitKey(key?: string) {
  return key === "\r" || key === "\n" || key === "\r\n" || key === "\x1b[13u" || key === "\x1b[13;1u";
}
