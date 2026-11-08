import { t, useTranslation } from "../../i18n";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { ICON } from "../../theme/sizing";
import { useDismiss } from "../../workspace/useDismiss";
import type { ApprovalItem } from "../approvalState";
import "./approvalDialog.css";

export function ApprovalDialog({ item, onDecision }: { item: ApprovalItem; onDecision: (allowed: boolean) => void }) {
  useTranslation();
  const panelRef = useDismiss<HTMLDivElement>(true, () => onDecision(false));
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => { previous.current = document.activeElement as HTMLElement; cancelRef.current?.focus(); return () => previous.current?.focus(); }, []);
  return <div className="modal-scrim harness-approval"><div aria-labelledby="approval-title" aria-modal="true" className="modal harness-approval__panel" ref={panelRef} role="dialog">
    <header><AlertTriangle aria-hidden="true" size={ICON.lg} /><div><strong id="approval-title">{t("harness.ApprovalDialog.text_b9e1f29f36")}</strong><span>{item.pluginId} · {item.sessionId.slice(0, 8)}</span></div></header>
    <div className="harness-approval__risk"><ShieldCheck aria-hidden="true" size={ICON.sm} />{t("harness.ApprovalDialog.text_b471dc8150")}</div>
    <dl><dt>{t("harness.ApprovalDialog.text_5ca6730d44")}</dt><dd><code>{item.tool}</code></dd>{details(item)}</dl>
    <div className="modal__actions"><button onClick={() => onDecision(false)} ref={cancelRef} type="button">{t("harness.ApprovalDialog.text_136de7a8c4")}</button><button className="harness-approval__allow" onClick={() => onDecision(true)} type="button">{t("harness.ApprovalDialog.text_3648522a19")}</button></div>
  </div></div>;
}
function details(item: ApprovalItem) {
  if (item.kind === "capability") return <><dt>{t("harness.ApprovalDialog.text_5c5374dd95")}</dt><dd>{item.capabilities.join(" · ") || t("harness.ApprovalDialog.text_484d556139")}</dd></>;
  if (item.kind === "patch") return <><dt>{t("harness.ApprovalDialog.text_77e1ea5c56")}</dt><dd><code>{item.path}</code></dd><dt>{t("harness.ApprovalDialog.text_97fb183d5d")}</dt><dd><code>{t("harness.ApprovalDialog.patchSummary", { removed: item.oldLines, added: item.newLines, bytes: item.finalBytes, digest: item.digest })}</code></dd><dt>Diff</dt><dd className="harness-approval__diff">{item.diff.hunks.map((hunk, index) => <section key={`${hunk.oldStart}-${hunk.newStart}-${index}`}><header>@@ -{hunk.oldStart} +{hunk.newStart} @@</header>{hunk.lines.map((line, lineIndex) => <div data-kind={line.kind} key={lineIndex}><span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><code>{line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "}{line.content}</code></div>)}</section>)}{item.diff.truncated ? <p role="note">{t("harness.ApprovalDialog.text_5bb79bfe29", { omittedHunks: item.diff.omittedHunks, omittedLines: item.diff.omittedLines })}</p> : null}</dd></>;
  return <><dt>Executable</dt><dd><code>{item.executable}</code></dd><dt>Argv</dt><dd><ol>{item.argv.map((arg, index) => <li key={index}><code>{arg}</code></li>)}</ol></dd><dt>CWD / Timeout</dt><dd><code>{item.cwd}</code> · {item.timeoutMs} ms</dd><dt>Env keys</dt><dd>{item.envKeys.join(" · ") || t("harness.ApprovalDialog.text_484d556139")}</dd></>;
}
