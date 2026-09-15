import { FileCode2, Search } from "lucide-react";
import { useState } from "react";
import { ICON } from "../theme/sizing";
import type { DiffRequest, GitEntry } from "./contracts";
import { canPreview, statusLabel, type ChangeGroup } from "./model";

const FILE_PAGE_SIZE = 80;
interface Props {
  groups: ChangeGroup[];
  query: string;
  selected: DiffRequest | null;
  onQuery: (value: string) => void;
  onSelect: (file: GitEntry, group: ChangeGroup) => void;
  onOpen: (file: GitEntry) => void;
}

export function GitFileList(props: Props) {
  const [limit, setLimit] = useState(FILE_PAGE_SIZE);
  const count = props.groups.reduce((sum, group) => sum + group.files.length, 0);
  return <aside className="git-files" aria-label="Git 改动文件">
    <label className="file-preview__filter"><Search size={ICON.xs} aria-hidden="true" />
      <input aria-label="筛选改动路径" value={props.query} placeholder="筛选文件路径…"
        onChange={(event) => { props.onQuery(event.target.value); setLimit(FILE_PAGE_SIZE); }} />
    </label>
    {count === 0 ? <p className="git-hint">{props.query ? "没有匹配的文件" : "工作树干净，没有待审查的改动"}</p> : null}
    {props.groups.filter((group) => group.files.length > 0).map((group) => <section key={group.id} className="git-file-group">
      <h3>{group.title}<span>{group.files.length}</span></h3>
      <ul>{group.files.slice(0, limit).map((file) => <ChangeRow key={file.path} file={file} group={group}
        selected={props.selected?.path === file.path && props.selected.stage === group.stage}
        onSelect={() => props.onSelect(file, group)} onOpen={() => props.onOpen(file)} />)}</ul>
    </section>)}
    {props.groups.some((group) => group.files.length > limit) ? <button className="git-more" type="button"
      onClick={() => setLimit((current) => current + FILE_PAGE_SIZE)}>显示更多文件</button> : null}
  </aside>;
}

function ChangeRow({ file, group, selected, onSelect, onOpen }: {
  file: GitEntry; group: ChangeGroup; selected: boolean; onSelect: () => void; onOpen: () => void;
}) {
  const label = statusLabel(file, group.stage);
  return <li className={`git-file${selected ? " is-selected" : ""}`}>
    <button type="button" className="git-file__select" title={`${label}：${file.path}`} onClick={onSelect} aria-pressed={selected}>
      <span className={`git-file__status${file.conflicted ? " is-conflict" : ""}`}>{label}</span>
      <span className="git-file__path">{file.path}
        {file.originalPath ? <small>← {file.originalPath}</small> : null}
        {file.submodule ? <small>子模块</small> : null}
      </span>
    </button>
    <button type="button" className="icon-button icon-button--sm" aria-label={`预览文件 ${file.path}`}
      title="在文件预览中打开" disabled={!canPreview(file)} onClick={onOpen}><FileCode2 size={ICON.xs} aria-hidden="true" /></button>
  </li>;
}
