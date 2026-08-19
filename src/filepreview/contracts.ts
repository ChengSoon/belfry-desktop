export type ProjectEntryKind = "directory" | "file";

export interface ProjectEntry {
  name: string;
  relativePath: string;
  kind: ProjectEntryKind;
  size: number;
  modifiedAt: number | null;
}

export interface ProjectDirectory {
  relativePath: string;
  entries: ProjectEntry[];
  truncated: boolean;
}

export interface ProjectFilePreview {
  name: string;
  relativePath: string;
  content: string;
  size: number;
  modifiedAt: number | null;
  language: string | null;
  binary: boolean;
  truncated: boolean;
}
