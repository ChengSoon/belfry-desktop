import { formatNumber } from "../i18n";
import { t, useTranslation } from "../i18n";
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
  useTranslation();
  const [limit, setLimit] = useState(FILE_PAGE_SIZE);
  const count = props.groups.reduce((sum, group) => sum + group.files.length, 0);
  return <aside className="git-files" aria-label={t("git.GitFileList.text_0f27cc1942")}>
    <label className="file-preview__filter"><Search size={ICON.xs} aria-hidden="true" />
      <input aria-label={t("git.GitFileList.text_8f394ad427")} value={props.query} placeholder={t("git.GitFileList.text_32b8d8dc21")}
        onChange={(event) => { props.onQuery(event.target.value); setLimit(FILE_PAGE_SIZE); }} />
    </label>
    {count === 0 ? <p className="git-hint">{props.query ? t("git.GitFileList.text_90df9f728c") : t("git.GitFileList.text_2225715fd1")}</p> : null}
    {props.groups.filter((group) => group.files.length > 0).map((group) => <section key={group.id} className="git-file-group">
      <h3>{group.title}<span>{formatNumber(group.files.length)}</span></h3>
      <ul>{group.files.slice(0, limit).map((file) => <ChangeRow key={file.path} file={file} group={group}
        selected={props.selected?.path === file.path && props.selected.stage === group.stage}
        onSelect={() => props.onSelect(file, group)} onOpen={() => props.onOpen(file)} />)}</ul>
    </section>)}
    {props.groups.some((group) => group.files.length > limit) ? <button className="git-more" type="button"
      onClick={() => setLimit((current) => current + FILE_PAGE_SIZE)}>{t("git.GitFileList.text_f9a3e1d51b")}</button> : null}
  </aside>;
}

function ChangeRow({ file, group, selected, onSelect, onOpen }: {
  file: GitEntry; group: ChangeGroup; selected: boolean; onSelect: () => void; onOpen: () => void;
}) {
  useTranslation();
  const label = statusLabel(file, group.stage);
  return <li className={`git-file${selected ? " is-selected" : ""}`}>
    <button type="button" className="git-file__select" title={t("git.GitFileList.fileDescription", { status: label, path: file.path })} onClick={onSelect} aria-pressed={selected}>
      <span className={`git-file__status${file.conflicted ? " is-conflict" : ""}`}>{label}</span>
      <span className="git-file__path">{file.path}
        {file.originalPath ? <small>← {file.originalPath}</small> : null}
        {file.submodule ? <small>{t("git.GitFileList.text_f25c26da2c")}</small> : null}
      </span>
    </button>
    <button type="button" className="icon-button icon-button--sm" aria-label={t("git.GitFileList.text_aadd4be604", { path: file.path })}
      title={t("git.GitFileList.text_b7121f9f21")} disabled={!canPreview(file)} onClick={onOpen}><FileCode2 size={ICON.xs} aria-hidden="true" /></button>
  </li>;
}
