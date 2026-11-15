import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { AgentKind } from "../../agent/contracts";
import { terminalStatusFor } from "../../agent/programStatus";
import type { TerminalInputState } from "../contracts";

/** OSC status describes the foreground job, not the editor. Never infer draft ownership from its text. */
export class ProtocolInputOwnership {
  private dirty = true;
  private revision = 0;
  private submitted: number | null = null;
  private submittedSequence = -1;
  private restoredOutputSequence: number | null = null;
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

  attach(fresh: boolean, native?: TerminalInputState | null) {
    // A reattached PTY may contain a draft typed by an earlier frontend.
    if (this.revision !== 0) return;
    if (native) {
      this.dirty = native.status !== "empty";
      this.restoredOutputSequence = native.outputSequence;
      if (native.status === "occupied" && native.submissionSequence != null) {
        this.submitted = this.revision;
        this.submittedSequence = native.submissionSequence;
      }
    } else if (fresh) this.dirty = false;
  }

  isEmptySubmission(key?: string) { return this.ready && submitKey(key); }

  userInput(key?: string) {
    const emptySubmission = this.isEmptySubmission(key);
    this.dirty = !emptySubmission;
    this.revision += 1;
    this.submitted = !emptySubmission && (this.idle || this.blocked && this.dialogEmpty) && submitKey(key) ? this.revision : null;
    this.submittedSequence = this.sequence;
  }

  /** 屏幕明确画出空输入框时，它比“上次提交还没被 working 确认”可靠。 */
  observeEmpty() {
    this.dirty = false;
    this.submitted = null;
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
    if (this.idle) { this.submitted = this.revision; this.submittedSequence = this.sequence; }
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
    if (report.programStatus.state === "working" && this.submitted === this.revision && snapshot.sequence > this.submittedSequence) {
      this.dirty = false;
      this.submitted = null;
    }
  }

  gap(nextSequence?: number) {
    this.position += 1; this.idle = false; this.blocked = false; this.dialogEmpty = false;
    if (nextSequence != null && this.restoredOutputSequence != null && nextSequence <= this.restoredOutputSequence) return;
    this.revision += 1; this.dirty = true; this.submitted = null; this.restoredOutputSequence = null;
  }
}

function submitKey(key?: string) {
  return key === "\r" || key === "\n" || key === "\r\n" || key === "\x1b[13u" || key === "\x1b[13;1u";
}
