import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { ICON } from "../../theme/sizing";
import { useDismiss } from "../../workspace/useDismiss";
import type { ApprovalItem } from "../approvalState";
import "./approvalDialog.css";

export function ApprovalDialog({ item, onDecision }: { item: ApprovalItem; onDecision: (allowed: boolean) => void }) {
  const panelRef = useDismiss<HTMLDivElement>(true, () => onDecision(false));
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => { previous.current = document.activeElement as HTMLElement; cancelRef.current?.focus(); return () => previous.current?.focus(); }, []);
  return <div className="modal-scrim harness-approval"><div aria-labelledby="approval-title" aria-modal="true" className="modal harness-approval__panel" ref={panelRef} role="dialog">
    <header><AlertTriangle aria-hidden="true" size={ICON.lg} /><div><strong id="approval-title">Harness 请求授权</strong><span>{item.pluginId} · {item.sessionId.slice(0, 8)}</span></div></header>
    <div className="harness-approval__risk"><ShieldCheck aria-hidden="true" size={ICON.sm} />仅批准当前结构化请求；凭证与 approval token 不会进入此界面。</div>
    <dl><dt>工具</dt><dd><code>{item.tool}</code></dd>{details(item)}</dl>
    <div className="modal__actions"><button onClick={() => onDecision(false)} ref={cancelRef} type="button">拒绝</button><button className="harness-approval__allow" onClick={() => onDecision(true)} type="button">批准一次</button></div>
  </div></div>;
}
function details(item: ApprovalItem) {
  if (item.kind === "capability") return <><dt>能力</dt><dd>{item.capabilities.join(" · ") || "无"}</dd></>;
  if (item.kind === "patch") return <><dt>路径</dt><dd><code>{item.path}</code></dd><dt>变更</dt><dd><code>-{item.oldLines} / +{item.newLines}</code> · 最终 {item.finalBytes} bytes · {item.digest}</dd><dt>Diff</dt><dd className="harness-approval__diff">{item.diff.hunks.map((hunk, index) => <section key={`${hunk.oldStart}-${hunk.newStart}-${index}`}><header>@@ -{hunk.oldStart} +{hunk.newStart} @@</header>{hunk.lines.map((line, lineIndex) => <div data-kind={line.kind} key={lineIndex}><span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><code>{line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "}{line.content}</code></div>)}</section>)}{item.diff.truncated ? <p role="note">预览已截断：省略 {item.diff.omittedHunks} 个 hunk、{item.diff.omittedLines} 行；批准仍会应用完整内容。</p> : null}</dd></>;
  return <><dt>Executable</dt><dd><code>{item.executable}</code></dd><dt>Argv</dt><dd><ol>{item.argv.map((arg, index) => <li key={index}><code>{arg}</code></li>)}</ol></dd><dt>CWD / Timeout</dt><dd><code>{item.cwd}</code> · {item.timeoutMs} ms</dd><dt>Env keys</dt><dd>{item.envKeys.join(" · ") || "无"}</dd></>;
}
