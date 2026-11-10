import type { AgentKind } from "../agent/contracts";
import type { TerminalChoiceOption } from "./choice";

/** A screen request belongs to one live PTY attachment, never just to its text. */
export interface TerminalInteraction {
  requestId: string;
  source: { sessionId: string; agent: AgentKind | null };
  kind: "single" | "multiple" | "confirmation" | "input" | "unknown" | "queued";
  question: string;
  detail: string;
  options: Array<TerminalChoiceOption & { action?: "input" }>;
  selected: number | null;
  selectedIndices: number[];
  input: { label: string; placeholder?: string; optional?: boolean } | null;
  state: "pending" | "opening" | "submitting" | "submitted" | "uncertain";
  /** An entry to the question editor, never enough evidence to submit an answer. */
  queue?: { count: number };
  /** A numbered page is safe to answer locally, but more options remain in the terminal. */
  optionsComplete?: boolean;
}

export type TerminalInteractionAnswer =
  | { kind: "single"; index: number }
  | { kind: "multiple"; indices: number[] }
  | { kind: "input"; text: string };

export interface TerminalInteractionResult {
  status: "sent" | "changed" | "unavailable" | "busy" | "invalid" | "failed" | "uncertain";
  message?: string;
}

export type TerminalInteractionOpenResult =
  | { status: "opened"; requestId: string }
  | { status: Exclude<TerminalInteractionResult["status"], "sent">; message?: string };

/** Parser evidence and input policy stay internal; UI cannot supply raw key sequences. */
export interface ParsedInteraction extends Omit<TerminalInteraction, "requestId" | "source" | "state"> {
  signature: string;
  contextSignature: string;
  control: "arrows" | "checkboxes" | "yes-no" | "text" | "open-questions" | "none";
  /** Visible queue context distinguishes replacements even when the count is unchanged. */
  queueContext?: string;
  /** Verified async question editor, as distinct from an unrelated menu. */
  asyncQuestion?: boolean;
  axis?: "horizontal";
  answers?: string[];
  /** Prefix required before pasting into a verified input surface. */
  inputPrefix?: string;
  inputValue?: string;
}

export interface InteractionWrite {
  navigation?: string;
  keys?: string;
  text?: string;
  /** Rechecked inside the serialized input queue, immediately before writing. */
  valid: () => boolean;
  navigationReady?: () => Promise<boolean>;
  validAfterNavigation?: () => boolean;
  /** Pasting may repaint the input, but the enclosing question must still match. */
  validAfterPaste?: () => boolean;
}
