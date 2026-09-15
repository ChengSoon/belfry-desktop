import { useMemo, useState } from "react";
import type { DiffRequest, GitEntry } from "./contracts";
import { groupChanges, type ChangeGroup } from "./model";
import { useGitStatus } from "./useGitStatus";
import { useGitDiff } from "./useGitDiff";

export function useGitPanel(rootPath: string | null) {
  const status = useGitStatus(rootPath);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<DiffRequest | null>(null);
  const groups = useMemo(() => groupChanges(status.report?.entries ?? []), [status.report]);
  const selected = groups.filter((group) => group.stage === choice?.stage)
    .flatMap((group) => group.files).find((file) => file.path === choice?.path);
  const request = choice?.rootPath === status.report?.rootPath && selected ? choice : null;
  const diff = useGitDiff(request);
  const filtered = useMemo(() => groups.map((group) => ({ ...group, files: group.files.filter((file) =>
    `${file.path}\n${file.originalPath ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) })), [groups, query]);
  const select = (file: GitEntry, group: ChangeGroup) => {
    if (status.report) setChoice({ rootPath: status.report.rootPath, path: file.path, stage: group.stage });
  };
  return { status, diff, groups: filtered, query, setQuery, selected: request ? selected : null, request, select,
    refresh: () => { status.reload(); diff.reload(); },
  };
}
