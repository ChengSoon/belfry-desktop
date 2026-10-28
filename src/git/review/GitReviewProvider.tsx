import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { PromptQueueUpdate, PromptSubmitOptions, PromptSubmitResult } from "../../prompt/contracts";
import type { WorkspaceTab } from "../../workspace/contracts";
import { toAppFailure } from "../../workspace/errors";
import { readGitDiff } from "../api";
import type { GitDiff } from "../contracts";
import { buildReviewPrompt, createReviewAnchor, EMPTY_REVIEW, isReviewAnchorCurrent, MAX_REVIEW_COMMENT,
  reviewKey, reviewLocked, reviewTargetLabel, reviewTargets, type ReviewContext, type ReviewDraft } from "./model";

interface Props {
  tabs: readonly WorkspaceTab[];
  activeTabId: string | null;
  submit: (tabId: string, text: string, options?: PromptSubmitOptions) => PromptSubmitResult;
  cancel: (id: string) => boolean;
  onActivate: (id: string) => void;
  children: ReactNode;
}
interface ReviewController {
  drafts: Readonly<Record<string, ReviewDraft>>;
  tabs: readonly WorkspaceTab[];
  select: (context: ReviewContext, diff: GitDiff, index: number) => void;
  edit: (context: ReviewContext, changes: Partial<Pick<ReviewDraft, "comment" | "targetId">>) => void;
  send: (context: ReviewContext, diff: GitDiff) => Promise<void>;
  cancel: (context: ReviewContext) => void;
  resume: (context: ReviewContext, clearComment: boolean) => void;
  openSession: (id: string) => void;
}
const ReviewContextValue = createContext<ReviewController | null>(null);
export const useGitReview = () => useContext(ReviewContextValue);

/** 保留关闭面板、切换文件后的草稿和回执；输入不会引起整个 App 重渲染。 */
export function GitReviewProvider(props: Props) {
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const current = useRef(drafts);
  const inputs = useRef(props);
  inputs.current = props;
  const change = (key: string, update: (draft: ReviewDraft) => ReviewDraft) => {
    current.current = { ...current.current, [key]: update(current.current[key] ?? EMPTY_REVIEW) };
    setDrafts(current.current);
  };
  const select: ReviewController["select"] = (context, diff, index) => {
    const anchor = createReviewAnchor(diff, index);
    if (!anchor) return;
    change(reviewKey(context), (draft) => {
      if (reviewLocked(draft)) return draft;
      const candidates = reviewTargets(inputs.current.tabs, context.projectRoot);
      const preferred = candidates.find((tab) => tab.id === inputs.current.activeTabId)
        ?? (candidates.length === 1 ? candidates[0] : undefined);
      return { ...draft, anchor, targetId: draft.targetId || preferred?.id || "", receipt: null, error: null };
    });
  };
  const edit: ReviewController["edit"] = (context, changes) => change(reviewKey(context), (draft) => reviewLocked(draft) ? draft
    : { ...draft, ...changes, comment: (changes.comment ?? draft.comment).slice(0, MAX_REVIEW_COMMENT), receipt: null, error: null });

  const send: ReviewController["send"] = async (context, diff) => {
    const key = reviewKey(context);
    const draft = current.current[key] ?? EMPTY_REVIEW;
    if (reviewLocked(draft)) return;
    const fail = (error: string) => change(key, (value) => ({ ...value, error, receipt: null }));
    const anchor = draft.anchor;
    if (!anchor || !isReviewAnchorCurrent(diff, anchor)) return fail("所选代码已变化，请重新选择要反馈的行。草稿已保留。");
    const target = reviewTargets(inputs.current.tabs, context.projectRoot).find((tab) => tab.id === draft.targetId);
    if (!target) return fail("请选择当前项目中可用的 Agent 会话。");
    let text: string;
    try { text = buildReviewPrompt(context, anchor, draft.comment); }
    catch (error) { return fail(toAppFailure(error).message); }
    const id = crypto.randomUUID();
    change(key, (value) => ({ ...value, error: null, receipt: { id, targetId: target.id,
      targetLabel: reviewTargetLabel(target), state: "checking" } }));
    const update = (event: PromptQueueUpdate) => change(key, (value) => value.receipt?.id !== id ? value
      : { ...value, receipt: { ...value.receipt, ...event } });
    try {
      const latest = await readGitDiff(context.request);
      if (!isReviewAnchorCurrent(latest, anchor)) return fail("所选代码已在磁盘上变化，请刷新 Diff 后重新选行。草稿已保留。");
      if (!reviewTargets(inputs.current.tabs, context.projectRoot).some((tab) => tab.id === target.id)) {
        return fail("接收会话已不可用，反馈未发送。请选择其他会话。");
      }
      const result = inputs.current.submit(target.id, text, { id, projectRoot: context.projectRoot, onUpdate: update });
      if (result === "unavailable") return fail("接收会话暂不可用，反馈未发送，草稿已保留。");
    } catch (error) { fail(`未能发送反馈：${toAppFailure(error).message}`); }
  };

  const cancel = (context: ReviewContext) => {
    const key = reviewKey(context);
    const receipt = current.current[key]?.receipt;
    if (receipt?.state !== "queued") return;
    if (!inputs.current.cancel(receipt.id)) change(key, (value) => ({ ...value,
      error: "反馈已经开始发送，请到接收会话中查看。" }));
  };
  const resume = (context: ReviewContext, clearComment: boolean) => change(reviewKey(context), (draft) => {
    if (draft.receipt && ["checking", "queued", "sending"].includes(draft.receipt.state)) return draft;
    return { ...draft, receipt: null, error: null, comment: clearComment ? "" : draft.comment };
  });
  return <ReviewContextValue.Provider value={{ drafts, tabs: props.tabs, select, edit, send, cancel, resume,
    openSession: (id) => inputs.current.onActivate(id) }}>{props.children}</ReviewContextValue.Provider>;
}
