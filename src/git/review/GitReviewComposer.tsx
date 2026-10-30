import { useEffect, useId, useRef } from "react";
import { MessageSquare, Send } from "lucide-react";
import { Select } from "../../components/controls/Select";
import { ICON } from "../../theme/sizing";
import type { GitDiff } from "../contracts";
import { useGitReview } from "./GitReviewProvider";
import { EMPTY_REVIEW, isReviewAnchorCurrent, MAX_REVIEW_COMMENT, reviewKey, reviewLineLabel,
  reviewLocked, reviewTargetLabel, reviewTargets, type ReviewContext, type ReviewReceipt } from "./model";
import { composingKey } from "../../utils/keyboard";
import "./review.css";

export function GitReviewComposer({ context, diff, onRefresh }: {
  context: ReviewContext; diff: GitDiff | null; onRefresh: () => void;
}) {
  const review = useGitReview();
  const fieldId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const draft = review?.drafts[reviewKey(context)] ?? EMPTY_REVIEW;
  const anchor = draft.anchor;
  useEffect(() => { if (anchor) input.current?.focus(); }, [anchor]);
  if (!review || !anchor) return null;
  const locked = reviewLocked(draft);
  const current = isReviewAnchorCurrent(diff, anchor);
  const targets = reviewTargets(review.tabs, context.projectRoot);
  const target = targets.find((tab) => tab.id === draft.targetId);
  const options = targets.map((tab) => ({ value: tab.id, label: reviewTargetLabel(tab),
    description: tab.phase !== "running" ? "会话就绪后发送" : tab.activity === "idle" ? "空闲，可接收反馈"
      : tab.activity === "awaiting-choice" ? "等待确认，反馈将排队" : "正在处理任务，反馈将排队" }));
  const send = () => { if (diff && current && !locked) void review.send(context, diff); };
  const stale = diff !== null && !current;
  const receipt = draft.receipt;
  return <form className="git-review" aria-label="代码审查反馈" onSubmit={(event) => { event.preventDefault(); send(); }}>
    <div className="git-review__head"><MessageSquare size={ICON.sm} aria-hidden="true" />
      <strong>反馈给 Agent</strong><span>{reviewLineLabel(anchor.line)}</span></div>
    <label htmlFor={fieldId} className="sr-only">修改意见</label>
    <textarea ref={input} id={fieldId} value={draft.comment} maxLength={MAX_REVIEW_COMMENT} rows={3} disabled={locked}
      placeholder="说明希望如何修改，例如：这里需要处理空列表，并补一个测试。"
      onChange={(event) => review.edit(context, { comment: event.target.value })}
      onKeyDown={(event) => { if (!composingKey(event.nativeEvent) && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault(); event.stopPropagation(); send();
      } }} />
    {stale && !locked ? <p className="git-review__warning" role="status">所选代码已变化，请重新选行。你的反馈已保留。</p> : null}
    {draft.error ? <div className="git-review__error" role="alert">{draft.error}
      <button type="button" onClick={onRefresh}>刷新 Diff</button></div> : null}
    {!receipt || receipt.state === "cancelled" ? <>
      <div className="git-review__actions"><Select ariaLabel="接收反馈的 Agent" value={target?.id ?? ""} options={options}
        placeholder={targets.length ? "选择 Agent 会话" : "当前项目没有 Agent 会话"}
        onChange={(targetId) => review.edit(context, { targetId })} />
        <button type="submit" className="git-review__send" disabled={!current || !target || !draft.comment.trim()}>
          <Send size={ICON.sm} aria-hidden="true" />发送反馈</button></div>
      <p className="git-review__note">{!targets.length ? "先在当前项目新建 Codex、Claude Code 或 Pi 会话。"
        : draft.targetId && !target ? "原接收会话已不可用，请重新选择。"
          : target && target.activity !== "idle" ? "接收会话忙碌或等待确认，反馈会排队到空闲后发送。"
            : "附带所选行附近的差异和文件位置。⌘ / Ctrl + Enter 发送。"}</p>
    </> : null}
    {receipt ? <div className={`git-review__receipt is-${receipt.state}`} role="status" aria-live="polite">
      <strong>{receiptLabel(receipt)} · {receipt.targetLabel}</strong>
      <p>{receipt.message ?? receiptDetail(receipt)}</p>
      <div className="git-review__receipt-actions">
        {review.tabs.some((tab) => tab.id === receipt.targetId) ? <button type="button"
          onClick={() => review.openSession(receipt.targetId)}>查看会话</button> : null}
        {receipt.state === "queued" ? <button type="button" onClick={() => review.cancel(context)}>取消排队</button> : null}
        {receipt.state === "submitted" ? <button type="button" onClick={() => review.resume(context, true)}>继续反馈</button> : null}
      </div>
    </div> : null}
    {receipt?.state === "attention" ? <p className="git-review__note">请先在会话中核对这条反馈，确认后再
      <button type="button" onClick={() => review.resume(context, true)}>继续反馈</button>。</p> : null}
  </form>;
}

function receiptLabel(receipt: ReviewReceipt) {
  return { checking: "正在核对代码", queued: "已排队", sending: "正在发送", submitted: "已发送",
    attention: "需要核对", cancelled: "未发送" }[receipt.state];
}
function receiptDetail(receipt: ReviewReceipt) {
  if (receipt.state === "queued") return "会话空闲后自动发送。关闭应用会清空尚未发送的队列。";
  if (receipt.state === "sending") return "正在将反馈写入会话，等待提交结果。";
  if (receipt.state === "submitted") return "反馈已提交到会话。Agent 修改后，刷新 Diff 继续审查。";
  if (receipt.state === "checking") return "正在核对磁盘上的最新差异。";
  return "";
}
