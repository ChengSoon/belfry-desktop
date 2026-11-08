import { t, useTranslation } from "../../i18n";
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
  useTranslation();
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
    description: tab.phase !== "running" ? t("git.GitReviewComposer.text_9d22ec829e") : tab.activity === "idle" ? t("git.GitReviewComposer.text_c6faf8deb8")
      : tab.activity === "awaiting-choice" ? t("git.GitReviewComposer.text_2695597fe9") : t("git.GitReviewComposer.text_5433e54611") }));
  const send = () => { if (diff && current && !locked) void review.send(context, diff); };
  const stale = diff !== null && !current;
  const receipt = draft.receipt;
  return <form className="git-review" aria-label={t("git.GitReviewComposer.text_75c06d160f")} onSubmit={(event) => { event.preventDefault(); send(); }}>
    <div className="git-review__head"><MessageSquare size={ICON.sm} aria-hidden="true" />
      <strong>{t("git.GitReviewComposer.text_8d8c5c2ade")}</strong><span>{reviewLineLabel(anchor.line)}</span></div>
    <label htmlFor={fieldId} className="sr-only">{t("git.GitReviewComposer.text_e6cd0477dd")}</label>
    <textarea ref={input} id={fieldId} value={draft.comment} maxLength={MAX_REVIEW_COMMENT} rows={3} disabled={locked}
      placeholder={t("git.GitReviewComposer.text_f7c7fe01af")}
      onChange={(event) => review.edit(context, { comment: event.target.value })}
      onKeyDown={(event) => { if (!composingKey(event.nativeEvent) && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault(); event.stopPropagation(); send();
      } }} />
    {stale && !locked ? <p className="git-review__warning" role="status">{t("git.GitReviewComposer.text_5e5992b38c")}</p> : null}
    {draft.error ? <div className="git-review__error" role="alert">{draft.error}
      <button type="button" onClick={onRefresh}>{t("git.GitReviewComposer.text_e01d757f2b")}</button></div> : null}
    {!receipt || receipt.state === "cancelled" ? <>
      <div className="git-review__actions"><Select ariaLabel={t("git.GitReviewComposer.text_fb7c6dff32")} value={target?.id ?? ""} options={options}
        placeholder={targets.length ? t("git.GitReviewComposer.text_1fc363c800") : t("git.GitReviewComposer.text_a200f3f17e")}
        onChange={(targetId) => review.edit(context, { targetId })} />
        <button type="submit" className="git-review__send" disabled={!current || !target || !draft.comment.trim()}>
          <Send size={ICON.sm} aria-hidden="true" />{t("git.GitReviewComposer.text_5146ae493c")}</button></div>
      <p className="git-review__note">{!targets.length ? t("git.GitReviewComposer.text_3286dd6124")
        : draft.targetId && !target ? t("git.GitReviewComposer.text_6fa6c2485b")
          : target && target.activity !== "idle" ? t("git.GitReviewComposer.text_724c337a0f")
            : t("git.GitReviewComposer.text_b7aff9da22")}</p>
    </> : null}
    {receipt ? <div className={`git-review__receipt is-${receipt.state}`} role="status" aria-live="polite">
      <strong>{receiptLabel(receipt)} · {receipt.targetLabel}</strong>
      <p>{receipt.message ?? receiptDetail(receipt)}</p>
      <div className="git-review__receipt-actions">
        {review.tabs.some((tab) => tab.id === receipt.targetId) ? <button type="button"
          onClick={() => review.openSession(receipt.targetId)}>{t("git.GitReviewComposer.text_f2b4237b35")}</button> : null}
        {receipt.state === "queued" ? <button type="button" onClick={() => review.cancel(context)}>{t("git.GitReviewComposer.text_16c1f9b337")}</button> : null}
        {receipt.state === "submitted" ? <button type="button" onClick={() => review.resume(context, true)}>{t("git.GitReviewComposer.text_d16629bb08")}</button> : null}
      </div>
    </div> : null}
    {receipt?.state === "attention" ? <div className="git-review__note"><p>{t("git.GitReviewComposer.verifyBeforeContinuing")}</p><button type="button" onClick={() => review.resume(context, true)}>{t("git.GitReviewComposer.text_d16629bb08")}</button></div> : null}
  </form>;
}

function receiptLabel(receipt: ReviewReceipt) {
  return { checking: t("git.GitReviewComposer.text_7c02f76473"), queued: t("git.GitReviewComposer.text_3cc8745436"), sending: t("git.GitReviewComposer.text_2d88d503d0"), submitted: t("git.GitReviewComposer.text_60823aaec7"),
    attention: t("git.GitReviewComposer.text_884ca53f18"), cancelled: t("git.GitReviewComposer.text_a8f011b329") }[receipt.state];
}
function receiptDetail(receipt: ReviewReceipt) {
  if (receipt.state === "queued") return t("git.GitReviewComposer.text_76adea7bfa");
  if (receipt.state === "sending") return t("git.GitReviewComposer.text_445dee9569");
  if (receipt.state === "submitted") return t("git.GitReviewComposer.text_b40d025c20");
  if (receipt.state === "checking") return t("git.GitReviewComposer.text_6d50f1456e");
  return "";
}
