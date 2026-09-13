import { invoke } from "@tauri-apps/api/core";

export const exportBackupFile = (text: string) => invoke<string | null>("backup_export", { text });
export const importBackupFile = () => invoke<string | null>("backup_import");
