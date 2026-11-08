import { TranslationError, t } from "../../i18n";
import { isAgentKind } from "../../prompt/contracts";
import { AGENT_METADATA } from "../../agent/contracts";
import type { PromptQueueUpdate } from "../../prompt/contracts";
import type { WorkspaceTab } from "../../workspace/contracts";
import { pathKey } from "../../workspace/path";
import type { DiffRequest, GitDiff } from "../contracts";
import { parseUnifiedDiff, type DiffLine } from "../model";

export const MAX_REVIEW_COMMENT = 4_000;
const MAX_EXCERPT_LINE = 800;

export interface ReviewContext {
  projectRoot: string;
  request: DiffRequest;
  originalPath: string | null;
}
export interface ReviewAnchor {
  index: number;
  line: DiffLine;
  excerpt: DiffLine[];
}
export interface ReviewReceipt {
  id: string;
  targetId: string;
  targetLabel: string;
  state: PromptQueueUpdate["state"] | "checking";
  message?: string;
}
export interface ReviewDraft {
  anchor: ReviewAnchor | null;
  comment: string;
  targetId: string;
  receipt: ReviewReceipt | null;
  error: string | null;
}
export const EMPTY_REVIEW: ReviewDraft = { anchor: null, comment: "", targetId: "", receipt: null, error: null };

export function reviewKey(context: ReviewContext) {
  return JSON.stringify([pathKey(context.projectRoot), pathKey(context.request.rootPath), context.request.path, context.request.stage]);
}

export function reviewTargets(tabs: readonly WorkspaceTab[], projectRoot: string) {
  return tabs.filter((tab) => isAgentKind(tab.kind) && tab.phase !== "exited" && tab.phase !== "error"
    && pathKey(tab.project.rootPath) === pathKey(projectRoot));
}

export function reviewTargetLabel(tab: WorkspaceTab) {
  const name = tab.agentName || tab.title;
  const agent = isAgentKind(tab.kind) ? AGENT_METADATA[tab.kind].name : tab.kind;
  return `${name} · ${agent}`;
}

export function reviewLineLabel(line: DiffLine) {
  if (line.kind === "remove") return t("git.model.text_f4f18b080e", { oldLine: line.oldLine });
  return t("git.model.text_e332578a50", { newLine: line.newLine });
}

export function canReviewLine(line: DiffLine) {
  return (line.kind === "add" || line.kind === "remove" || line.kind === "context")
    && (line.oldLine !== null || line.newLine !== null);
}

export function createReviewAnchor(diff: GitDiff, index: number): ReviewAnchor | null {
  if (diff.binary || !Number.isInteger(index) || index < 0) return null;
  const { lines } = parseUnifiedDiff(diff.text, index + 4);
  const line = lines[index];
  if (!line || !canReviewLine(line)) return null;
  return { index, line, excerpt: lines.slice(Math.max(0, index - 3), index + 4)
    .map((item) => ({ ...item, text: item.text.slice(0, MAX_EXCERPT_LINE) })) };
}

/** 同时核对位置、旧/新行号和完整行内容，不把已移动的批注静默挂到另一行。 */
export function isReviewAnchorCurrent(diff: GitDiff | null, anchor: ReviewAnchor | null) {
  if (!diff || !anchor) return false;
  const current = createReviewAnchor(diff, anchor.index);
  return current !== null && JSON.stringify(current) === JSON.stringify(anchor);
}

export function reviewLocked(draft: ReviewDraft) {
  return draft.receipt !== null && draft.receipt.state !== "cancelled";
}

export function buildReviewPrompt(context: ReviewContext, anchor: ReviewAnchor, comment: string) {
  const feedback = comment.trim();
  if (!feedback || feedback.length > MAX_REVIEW_COMMENT) throw new TranslationError("git.model.text_a02eaf844c");
  const metadata = {
    project: context.projectRoot,
    worktree: context.request.rootPath,
    file: context.request.path,
    previousFile: context.originalPath,
    stage: context.request.stage,
    selectedLine: { kind: anchor.line.kind, oldLine: anchor.line.oldLine, newLine: anchor.line.newLine },
    diffExcerpt: anchor.excerpt,
    feedback,
  };
  // JSON 转义源码/路径中的控制字符，避免终端将 ESC 等字节解释为按键。
  return [
    t("git.model.text_5650f8fba2"),
    t("git.model.text_bf909ce5a9"),
    t("git.model.text_758c8d39ec"),
    JSON.stringify(metadata, null, 2),
  ].join("\n\n");
}
