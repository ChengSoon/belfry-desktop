import { Notice } from "../components/Notice";
import { getLocale, t, useTranslation } from "../i18n";
import { FileCode2, MessageSquare, RefreshCcw } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ICON } from "../theme/sizing";
import type { DiffRequest, GitDiff, GitEntry } from "./contracts";
import { canPreview, DIFF_PAGE_LINES, parseUnifiedDiff } from "./model";
import { useGitReview } from "./review/GitReviewProvider";
import { GitReviewComposer } from "./review/GitReviewComposer";
import { canReviewLine, EMPTY_REVIEW, isReviewAnchorCurrent, reviewKey, reviewLineLabel, reviewLocked } from "./review/model";

interface Props {
  projectRoot?: string;
  request: DiffRequest | null;
  file: GitEntry | null | undefined;
  diff: GitDiff | null;
  loading: boolean;
  failure: string | null;
  onRefresh: () => void;
  onOpen: () => void;
}

export function GitDiffView(props: Props) {
  useTranslation();
  const review = useGitReview();
  const context = props.projectRoot && props.request ? {
    projectRoot: props.projectRoot, request: props.request, originalPath: props.file?.originalPath ?? null,
  } : null;
  const draft = context ? review?.drafts[reviewKey(context)] ?? EMPTY_REVIEW : EMPTY_REVIEW;
  const enabled = Boolean(review && context && !props.file?.conflicted && !props.file?.submodule);
  if (!props.request) return <main className="git-diff"><p className="git-empty">{t("git.GitDiffView.text_87f0220b14")}</p></main>;
  const stage = { staged: t("git.GitDiffView.text_dd84afe5be"), unstaged: t("git.GitDiffView.text_3797982942"), untracked: t("git.GitDiffView.text_c2f9d2d89a") }[props.request.stage];
  return <main className="git-diff" aria-label={t("git.GitDiffView.text_5d2dcea6f4")}>
    <header className="git-diff__head"><div><strong title={props.request.path}>{props.request.path}</strong><small>{t("git.GitDiffView.text_abe7d09452", { stage: stage })}</small></div>
      <button type="button" className="icon-button icon-button--sm" title={t("git.GitDiffView.text_e01d757f2b")} aria-label={t("git.GitDiffView.text_e01d757f2b")}
        disabled={props.loading} onClick={props.onRefresh}><RefreshCcw size={ICON.sm} aria-hidden="true" /></button>
      <button type="button" className="icon-button icon-button--sm" title={t("git.GitDiffView.text_583116b492")} aria-label={t("git.GitDiffView.text_583116b492")}
        disabled={!props.file || !canPreview(props.file)} onClick={props.onOpen}><FileCode2 size={ICON.sm} aria-hidden="true" /></button>
    </header>
    {props.file?.conflicted ? <Notice className="git-warning" tone="warning">{t("git.GitDiffView.text_697efcdf39")}</Notice> : null}
    {props.failure ? <Notice className="git-error" action={<button type="button" disabled={props.loading} onClick={props.onRefresh}>{t("git.GitDiffView.text_e01d757f2b")}</button>}>{props.failure}</Notice> : null}
    {props.loading ? <p className="git-hint" role="status">{t("git.GitDiffView.text_970ec71a68")}</p> : null}
    {!props.loading && props.diff ? <GitDiffContent key={JSON.stringify(props.request)} diff={props.diff}
      selectedLine={isReviewAnchorCurrent(props.diff, draft.anchor) ? draft.anchor?.index : null}
      reviewDisabled={reviewLocked(draft)}
      onReviewLine={enabled ? (index) => { if (context && props.diff) review?.select(context, props.diff, index); } : undefined} /> : null}
    {review && context ? <GitReviewComposer context={context} diff={props.diff} onRefresh={props.onRefresh} /> : null}
  </main>;
}

export function GitDiffContent({ diff, onReviewLine, selectedLine, reviewDisabled }: {
  diff: GitDiff; onReviewLine?: (index: number) => void; selectedLine?: number | null; reviewDisabled?: boolean;
}) {
  useTranslation();
  const [limit, setLimit] = useState(DIFF_PAGE_LINES);
  const visibleLimit = Math.max(limit, Math.ceil(((selectedLine ?? 0) + 1) / DIFF_PAGE_LINES) * DIFF_PAGE_LINES);
  const parsed = useMemo(() => parseUnifiedDiff(diff.text, visibleLimit), [diff.text, visibleLimit, getLocale()]);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (selectedLine == null || !viewport) return;
    const reveal = () => {
      const row = selected.current?.getBoundingClientRect();
      if (!row) return;
      const bounds = viewport.getBoundingClientRect();
      const bottom = bounds.top + viewport.clientHeight;
      if (row.top < bounds.top) viewport.scrollTop -= bounds.top - row.top;
      else if (row.bottom > bottom) viewport.scrollTop += row.bottom - bottom;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [selectedLine]);
  if (diff.binary) return <p className="git-empty">{t("git.GitDiffView.text_18be180973")}</p>;
  if (!diff.text) return <p className="git-empty">{t("git.GitDiffView.text_27cc93cccd")}</p>;
  return <>
    <div className="git-diff__scroll" ref={scroll}><table className="git-diff__table" aria-label={t("git.GitDiffView.text_c5760a25cb")}>
      <thead><tr><th>{t("git.GitDiffView.text_4fbc8134f6")}</th><th>{t("git.GitDiffView.text_3cc493bc5b")}</th>{onReviewLine ? <th className="git-review-cell"><span className="sr-only">{t("git.GitDiffView.text_8b2106ca13")}</span></th> : null}<th>{t("git.GitDiffView.text_1fc70b2f3b")}</th></tr></thead>
      <tbody>{parsed.lines.map((line, index) => <tr key={index} ref={selectedLine === index ? selected : undefined}
        className={`git-line git-line--${line.kind}${selectedLine === index ? " is-review-selected" : ""}`}>
        <td>{line.oldLine}</td><td>{line.newLine}</td>
        {onReviewLine ? <td className="git-review-cell">{canReviewLine(line) ? <button type="button" className="git-review-line"
          aria-label={t("git.GitDiffView.text_7bd17308c6", { name: reviewLineLabel(line) })} aria-pressed={selectedLine === index} disabled={reviewDisabled}
          title={t("git.GitDiffView.text_e8cb5eef97", { name: reviewLineLabel(line) })} onClick={() => onReviewLine(index)}><MessageSquare size={13} aria-hidden="true" /></button> : null}</td> : null}
        <td><code>{line.text}</code></td>
      </tr>)}</tbody>
    </table></div>
    {parsed.more ? <button type="button" className="git-more" onClick={() => setLimit(visibleLimit + DIFF_PAGE_LINES)}>{t("git.GitDiffView.text_086d8baadb", { count: parsed.lines.length, total: parsed.total })}</button> : null}
    {diff.truncated ? <Notice className="git-warning" tone="warning" role="status">{t("git.GitDiffView.text_23996f5cfb")}</Notice> : null}
  </>;
}
