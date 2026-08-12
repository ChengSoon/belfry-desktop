export type UpdaterStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
}

export const INITIAL_UPDATER_STATE: UpdaterState = {
  status: "idle",
  currentVersion: "…",
  availableVersion: null,
  notes: null,
  progress: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
};
