import { FileCode2, RefreshCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ICON } from "../theme/sizing";
import type { DiffRequest, GitDiff, GitEntry } from "./contracts";
import { canPreview, DIFF_PAGE_LINES, parseUnifiedDiff } from "./model";

interface Props {
  request: DiffRequest | null;
  file: GitEntry | null | undefined;
  diff: GitDiff | null;
  loading: boolean;
  failure: string | null;
  onRefresh: () => void;
  onOpen: () => void;
}

export function GitDiffView(props: Props) {
  if (!props.request) return <main className="git-diff"><p className="git-empty">选择一个改动，查看只读 Diff</p></main>;
  const stage = { staged: "暂存区", unstaged: "工作区", untracked: "未跟踪" }[props.request.stage];
  return <main className="git-diff" aria-label="文件 Diff">
    <header className="git-diff__head"><div><strong title={props.request.path}>{props.request.path}</strong><small>{stage} · 打开时的快照</small></div>
      <button type="button" className="icon-button icon-button--sm" title="刷新 Diff" aria-label="刷新 Diff"
        disabled={props.loading} onClick={props.onRefresh}><RefreshCcw size={ICON.sm} aria-hidden="true" /></button>
      <button type="button" className="icon-button icon-button--sm" title="打开当前文件" aria-label="打开当前文件"
        disabled={!props.file || !canPreview(props.file)} onClick={props.onOpen}><FileCode2 size={ICON.sm} aria-hidden="true" /></button>
    </header>
    {props.file?.conflicted ? <p className="git-warning">此文件有合并冲突。以下为 Git 提供的合并差异；可打开当前文件查看冲突标记。</p> : null}
    {props.failure ? <p className="git-error" role="alert">{props.failure}</p> : null}
    {props.loading ? <p className="git-hint" role="status">正在读取 Diff…</p> : null}
    {!props.loading && props.diff ? <GitDiffContent key={JSON.stringify(props.request)} diff={props.diff} /> : null}
  </main>;
}

export function GitDiffContent({ diff }: { diff: GitDiff }) {
  const [limit, setLimit] = useState(DIFF_PAGE_LINES);
  const parsed = useMemo(() => parseUnifiedDiff(diff.text, limit), [diff.text, limit]);
  if (diff.binary) return <p className="git-empty">这是二进制文件，无法显示文本 Diff。</p>;
  if (!diff.text) return <p className="git-empty">当前已无该类差异，请刷新 Git 状态。</p>;
  return <>
    <div className="git-diff__scroll"><table className="git-diff__table" aria-label="代码差异">
      <thead><tr><th>旧</th><th>新</th><th>变更内容</th></tr></thead>
      <tbody>{parsed.lines.map((line, index) => <tr key={index} className={`git-line git-line--${line.kind}`}>
        <td>{line.oldLine}</td><td>{line.newLine}</td><td><code>{line.text}</code></td>
      </tr>)}</tbody>
    </table></div>
    {parsed.more ? <button type="button" className="git-more" onClick={() => setLimit((current) => current + DIFF_PAGE_LINES)}>
      显示更多行（{parsed.lines.length} / {parsed.total}）
    </button> : null}
    {diff.truncated ? <p className="git-warning" role="status">Diff 较大，仅读取前 512 KB，内容不完整。请在本地 Git 工具中查看完整差异。</p> : null}
  </>;
}
